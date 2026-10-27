-- 신호등 친구들 1단계: 포인트 모의투자 + 12지 캐릭터 + 레벨 (blog_assets/모의투자_게임_설계.md)
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
-- 처음엔 운영자만 사용 (game_config.open_all = false). 전체 공개는 open_all 을 true 로.
--
-- 투자 1건 = 그날 AI 예측 1건(predictions 의 market·symbol·pred_date)에 포인트를 거는 것.
--   기준가 = 예측의 base_close(직전 실제 종가), 결과 = 수집 작업이 채우는 actual_close(D+1 실제 종가)
--   정산 = 걸은 포인트 × (D+1 종가 / 직전 종가)   — 실제 등락률 그대로
--   정산 시각(D+1 종가 시각)이 지나면 '검토 중', 실제 종가가 들어오면 7분 뒤 지급 (검토 시간)

-- ---------- 1. 설정 ----------
create table if not exists public.game_config (
  id        int primary key default 1 check (id = 1),
  open_all  boolean not null default false,   -- false: 운영자만
  start_points bigint not null default 100000,
  review_minutes int not null default 7
);
insert into public.game_config (id) values (1) on conflict (id) do nothing;
alter table public.game_config enable row level security;
drop policy if exists "누구나 조회" on public.game_config;
create policy "누구나 조회" on public.game_config for select using (true);
grant select on public.game_config to anon, authenticated;
grant all on public.game_config to service_role;

-- ---------- 2. 플레이어 (캐릭터·포인트·경험치) ----------
create table if not exists public.game_players (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  animal     text not null check (animal in ('rat','ox','tiger','rabbit','dragon','snake','horse','sheep','monkey','rooster','dog','pig')),
  points     bigint not null default 100000,
  exp        int not null default 0,
  level      int not null default 1,
  last_play  date,                              -- 마지막 투자 날짜(KST) — 출석 경험치
  created_at timestamptz not null default now()
);
alter table public.game_players enable row level security;
drop policy if exists "본인 조회" on public.game_players;
create policy "본인 조회" on public.game_players for select to authenticated using (user_id = auth.uid() or public.is_admin());
grant select on public.game_players to authenticated;
grant all on public.game_players to service_role;

-- ---------- 3. 투자 ----------
create table if not exists public.game_bets (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  market      text not null check (market in ('coin','bithumb','nasdaq','kospi')),
  symbol      text not null,
  pred_date   date not null,
  d1_date     date not null,
  amount      bigint not null check (amount >= 1000),
  base_close  double precision not null,
  verdict     text,                               -- 걸 때 AI 판정 (up/mx/dn) — 기록용
  cutoff_at   timestamptz not null,               -- 이 시각까지 걸 수 있음
  close_at    timestamptz not null,               -- D+1 종가 시각 (지나면 '검토 중')
  actual_close double precision,
  ret         double precision,                   -- 등락률
  payout      bigint,                             -- 돌려받는 포인트 (원금 포함)
  exp_delta   int,
  settle_at   timestamptz,                        -- 지급 예정 시각 (실제 종가 확인 + 검토 시간)
  status      text not null default 'open' check (status in ('open','review','settled','void')),
  created_at  timestamptz not null default now(),
  bet_day     date not null default (now() at time zone 'Asia/Seoul')::date,
  unique (user_id, market, symbol, pred_date)
);
create index if not exists game_bets_user_idx on public.game_bets (user_id, created_at desc);
create index if not exists game_bets_open_idx on public.game_bets (market, symbol, pred_date) where status in ('open','review');
alter table public.game_bets enable row level security;
drop policy if exists "본인 조회" on public.game_bets;
create policy "본인 조회" on public.game_bets for select to authenticated using (user_id = auth.uid() or public.is_admin());
grant select on public.game_bets to authenticated;
grant all on public.game_bets to service_role;

-- ---------- 4. 레벨 보상 (이용권) 기록 ----------
create table if not exists public.game_rewards (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  level      int not null,
  market     text,                                -- 받은 시장 (보상 받기 시 고름) — 2단계에서 지급 처리
  granted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, level)
);
alter table public.game_rewards enable row level security;
drop policy if exists "본인 조회" on public.game_rewards;
create policy "본인 조회" on public.game_rewards for select to authenticated using (user_id = auth.uid() or public.is_admin());
grant select on public.game_rewards to authenticated;
grant all on public.game_rewards to service_role;

-- ---------- 5. 도우미 ----------
-- 참여 가능 여부 (테스트 기간: 운영자만)
create or replace function public.game_allowed()
returns boolean language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and (public.is_admin() or (select open_all from game_config where id = 1));
$$;

-- 마감 시각(=이 시각까지 걸 수 있음)과 D+1 종가 시각
--   업비트: D+1 일봉(09:00~다음날 09:00) → 다음날 09:00 종가, 마감도 그때
--   빗썸:   D+1 일봉(00:00~다음날 00:00) → 다음날 00:00 종가, 마감도 그때
--   코스피: D+1 장 시작 09:00 마감, 15:30 종가
--   나스닥: D+1 미국장 시작(뉴욕 09:30, 한국 22:30/23:30) 마감, 뉴욕 16:00 종가
create or replace function public.game_times(p_market text, p_d1 date, out cutoff_at timestamptz, out close_at timestamptz)
language sql stable as $$
  select case p_market
           when 'coin'    then ((p_d1 + 1)::timestamp + time '09:00') at time zone 'Asia/Seoul'
           when 'bithumb' then ((p_d1 + 1)::timestamp) at time zone 'Asia/Seoul'
           when 'kospi'   then (p_d1::timestamp + time '09:00') at time zone 'Asia/Seoul'
           when 'nasdaq'  then (p_d1::timestamp + time '09:30') at time zone 'America/New_York'
         end,
         case p_market
           when 'coin'    then ((p_d1 + 1)::timestamp + time '09:00') at time zone 'Asia/Seoul'
           when 'bithumb' then ((p_d1 + 1)::timestamp) at time zone 'Asia/Seoul'
           when 'kospi'   then (p_d1::timestamp + time '15:30') at time zone 'Asia/Seoul'
           when 'nasdaq'  then (p_d1::timestamp + time '16:00') at time zone 'America/New_York'
         end;
$$;

-- 레벨: Lv.n → n+1 에 50 + 10n EXP (Lv.30 최대). 누적 EXP 로 계산
create or replace function public.game_level(p_exp int)
returns int language plpgsql immutable as $$
declare lv int := 1; need int := 0;
begin
  while lv < 30 loop
    need := need + 50 + 10 * lv;
    exit when p_exp < need;
    lv := lv + 1;
  end loop;
  return lv;
end;
$$;

-- 레벨 n 이 시작되는 누적 EXP (경험치가 이보다 밑으로는 안 내려감 = 레벨다운 없음)
create or replace function public.game_level_floor(p_level int)
returns int language sql immutable as $$
  select coalesce(sum(50 + 10 * n), 0)::int from generate_series(1, p_level - 1) n;
$$;

-- 수익률 → EXP
create or replace function public.game_exp(p_ret double precision)
returns int language sql immutable as $$
  select case when p_ret >= 0.03 then 15 when p_ret > 0.001 then 10 when p_ret >= -0.001 then 2 else -4 end;
$$;

-- ---------- 6. 정산 ----------
-- (1) 실제 종가가 들어온 투자 → '검토 중' + 지급 예정 시각 / (2) 지급 예정 시각이 지난 투자 → 포인트·EXP 지급
--     수집 작업(ingest.py)이 채점 직후 부르고, 화면이 열릴 때(game_my)도 부름 → 따로 예약 작업 없이도 지급됨
create or replace function public.game_settle()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; b record; mins int;
begin
  select review_minutes into mins from game_config where id = 1;
  update game_bets g
     set actual_close = p.actual_close,
         ret = p.actual_close / g.base_close - 1,
         payout = floor(g.amount * p.actual_close / g.base_close)::bigint,
         exp_delta = game_exp(p.actual_close / g.base_close - 1),
         settle_at = greatest(now(), g.close_at) + make_interval(mins => mins),
         status = 'review'
    from predictions p
   where g.status = 'open' and p.market = g.market and p.symbol = g.symbol and p.pred_date = g.pred_date
     and p.actual_close is not null and g.base_close > 0;
  for b in select * from game_bets where status = 'review' and settle_at <= now() for update skip locked loop
    update game_players gp
       set points = gp.points + b.payout,
           exp = greatest(game_level_floor(gp.level), gp.exp + b.exp_delta),
           level = game_level(greatest(game_level_floor(gp.level), gp.exp + b.exp_delta))
     where gp.user_id = b.user_id;
    update game_bets set status = 'settled' where id = b.id;
    n := n + 1;
  end loop;
  -- 레벨 보상 자리 만들기 (Lv.10·20·30 달성 시, 받기는 2단계)
  insert into game_rewards (user_id, level)
  select gp.user_id, l from game_players gp, unnest(array[10, 20, 30]) l where gp.level >= l
  on conflict do nothing;
  return n;
end;
$$;
revoke execute on function public.game_settle() from public, anon;
grant execute on function public.game_settle() to authenticated, service_role;

-- ---------- 7. 회원용 함수 ----------
-- 캐릭터 고르고 시작 (이미 있으면 캐릭터만 바꿈)
create or replace function public.game_join(p_character text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not game_allowed() then return jsonb_build_object('ok', false, 'msg', '아직 열리지 않았어요'); end if;
  insert into game_players (user_id, animal, points)
  values (auth.uid(), p_character, (select start_points from game_config where id = 1))
  on conflict (user_id) do update set animal = excluded.animal;
  return jsonb_build_object('ok', true);
end;
$$;

-- 걸 수 있는 종목 (오늘 AI 예측 중 마감 전, 판정 있는 것)
create or replace function public.game_symbols(p_market text)
returns table (symbol text, verdict text, pred_date date, d1_date date, base_close double precision, cutoff_at timestamptz, close_at timestamptz)
language sql stable security definer set search_path = public as $$
  with last as (select max(pred_date) d from predictions where market = p_market)
  select p.symbol, p.verdict, p.pred_date, p.d1_date, p.base_close, t.cutoff_at, t.close_at
    from predictions p, last, lateral game_times(p_market, p.d1_date) t
   where game_allowed() and p.market = p_market and p.pred_date = last.d
     and p.verdict in ('up','mx','dn') and p.base_close > 0 and p.d1_date is not null and now() < t.cutoff_at
   order by p.symbol;
$$;

-- 포인트 걸기 (하루 5건 · 보유 포인트의 50% 이하 · 같은 예측에 한 번)
create or replace function public.game_bet(p_market text, p_symbol text, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me game_players; s record; today date := (now() at time zone 'Asia/Seoul')::date; cnt int;
begin
  if not game_allowed() then return jsonb_build_object('ok', false, 'msg', '아직 열리지 않았어요'); end if;
  select * into me from game_players where user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'msg', '먼저 캐릭터를 골라 주세요'); end if;
  select * into s from game_symbols(p_market) where symbol = p_symbol;
  if not found then return jsonb_build_object('ok', false, 'msg', '지금은 걸 수 없는 종목이에요 (마감됐거나 예측이 없어요)'); end if;
  select count(*) into cnt from game_bets where user_id = me.user_id and bet_day = today and status <> 'void';
  if cnt >= 5 then return jsonb_build_object('ok', false, 'msg', '오늘은 5개를 모두 걸었어요'); end if;
  if p_amount < 1000 then return jsonb_build_object('ok', false, 'msg', '최소 1,000P부터 걸 수 있어요'); end if;
  if p_amount > me.points / 2 then return jsonb_build_object('ok', false, 'msg', '보유 포인트의 50%까지 걸 수 있어요'); end if;
  if exists (select 1 from game_bets where user_id = me.user_id and market = p_market and symbol = p_symbol and pred_date = s.pred_date) then
    return jsonb_build_object('ok', false, 'msg', '이 종목은 이미 걸었어요'); end if;
  insert into game_bets (user_id, market, symbol, pred_date, d1_date, amount, base_close, verdict, cutoff_at, close_at)
  values (me.user_id, p_market, p_symbol, s.pred_date, s.d1_date, p_amount, s.base_close, s.verdict, s.cutoff_at, s.close_at);
  -- 포인트 차감 + 하루 첫 투자면 출석 EXP +3
  update game_players
     set points = points - p_amount,
         exp = exp + case when last_play is distinct from today then 3 else 0 end,
         level = game_level(exp + case when last_play is distinct from today then 3 else 0 end),
         last_play = today
   where user_id = me.user_id;
  return jsonb_build_object('ok', true, 'left', 4 - cnt);
end;
$$;

-- 내 정보 + 최근 기록 (열 때마다 정산도 진행)
create or replace function public.game_my()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me game_players; today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not game_allowed() then return jsonb_build_object('allowed', false); end if;
  perform game_settle();
  select * into me from game_players where user_id = auth.uid();
  if not found then return jsonb_build_object('allowed', true, 'joined', false); end if;
  return jsonb_build_object(
    'allowed', true, 'joined', true,
    'nickname', (select nickname from profiles where id = me.user_id),
    'character', me.animal, 'points', me.points, 'exp', me.exp, 'level', me.level,
    'level_floor', game_level_floor(me.level), 'level_next', case when me.level >= 30 then null else game_level_floor(me.level + 1) end,
    'today_left', 5 - (select count(*) from game_bets where user_id = me.user_id and bet_day = today and status <> 'void'),
    'invested', (select coalesce(sum(amount), 0) from game_bets where user_id = me.user_id and status in ('open','review')),
    'bets', coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
        select id, market, symbol, pred_date, d1_date, amount, base_close, verdict, close_at, actual_close, ret, payout, exp_delta, settle_at,
               case when status = 'open' and now() >= close_at then 'review' else status end as status, created_at
          from game_bets where user_id = me.user_id order by created_at desc limit 30) x), '[]'::jsonb));
end;
$$;

-- 순위표: kind = 'ret'(최근 7일 수익률) / 'level' / 'points'
create or replace function public.game_rank(p_kind text default 'ret')
returns table (nickname text, animal text, level int, points bigint, week_ret double precision, is_me boolean)
language sql stable security definer set search_path = public as $$
  with w as (
    select user_id, sum(payout - amount)::double precision / nullif(sum(amount), 0) r
      from game_bets where status = 'settled' and created_at >= now() - interval '7 days' group by user_id)
  select coalesce(pr.nickname, '익명'), gp.animal, gp.level, gp.points, coalesce(w.r, 0), gp.user_id = auth.uid()
    from game_players gp join profiles pr on pr.id = gp.user_id left join w on w.user_id = gp.user_id
   where game_allowed()
   order by case p_kind when 'level' then gp.level::double precision when 'points' then gp.points::double precision else coalesce(w.r, -1) end desc,
            gp.points desc
   limit 50;
$$;

grant execute on function public.game_allowed(), public.game_join(text), public.game_symbols(text), public.game_bet(text, text, bigint),
                          public.game_my(), public.game_rank(text) to authenticated;
revoke execute on function public.game_join(text), public.game_symbols(text), public.game_bet(text, text, bigint),
                           public.game_my(), public.game_rank(text) from anon;
