-- 신호등 친구들 1단계 보강: 총 수익률 · 다 잃으면 부활 (stage27.sql 다음에 실행, 여러 번 실행해도 안전)
--   총 수익률 = (보유 + 투자 중 원금 − 받은 포인트 합계) / 받은 포인트 합계   (받은 포인트 = 시작 100,000P + 부활 포인트)
--   기절: 보유 < 1,000P 이고 진행 중(정산 전) 투자가 없으면 → revive_days 뒤 revive_points 로 부활

alter table public.game_config
  add column if not exists revive_days int not null default 3,
  add column if not exists revive_points bigint not null default 50000;

alter table public.game_players
  add column if not exists granted bigint not null default 100000,   -- 받은 포인트 합계 (시작 + 부활)
  add column if not exists revives int not null default 0,           -- 부활 횟수
  add column if not exists broke_at timestamptz;                     -- 기절한 시각 (null = 정상)

-- 기절 표시 · 부활 처리 (game_my 가 열 때마다 부름)
create or replace function public.game_revive()
returns void language plpgsql security definer set search_path = public as $$
declare d int; pts bigint;
begin
  select revive_days, revive_points into d, pts from game_config where id = 1;
  -- 부활 시각이 지난 친구 → 부활
  update game_players
     set points = points + pts, granted = granted + pts, revives = revives + 1, broke_at = null
   where broke_at is not null and broke_at + make_interval(days => d) <= now();
  -- 새로 기절한 친구
  update game_players gp set broke_at = now()
   where gp.broke_at is null and gp.points < 1000
     and not exists (select 1 from game_bets b where b.user_id = gp.user_id and b.status in ('open', 'review'));
end;
$$;
revoke execute on function public.game_revive() from public, anon;
grant execute on function public.game_revive() to authenticated, service_role;

-- 총 수익률
create or replace function public.game_total_ret(p_user uuid)
returns double precision language sql stable security definer set search_path = public as $$
  select (gp.points + coalesce((select sum(amount) from game_bets b where b.user_id = gp.user_id and b.status in ('open','review')), 0) - gp.granted)::double precision
         / nullif(gp.granted, 0)
    from game_players gp where gp.user_id = p_user;
$$;

-- 내 정보 (총 수익률 · 기절/부활 정보 추가)
create or replace function public.game_my()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me game_players; today date := (now() at time zone 'Asia/Seoul')::date; d int;
begin
  if not game_allowed() then return jsonb_build_object('allowed', false); end if;
  perform game_settle();
  perform game_revive();
  select * into me from game_players where user_id = auth.uid();
  if not found then return jsonb_build_object('allowed', true, 'joined', false); end if;
  select revive_days into d from game_config where id = 1;
  return jsonb_build_object(
    'allowed', true, 'joined', true,
    'nickname', (select nickname from profiles where id = me.user_id),
    'character', me.animal, 'points', me.points, 'exp', me.exp, 'level', me.level,
    'level_floor', game_level_floor(me.level), 'level_next', case when me.level >= 30 then null else game_level_floor(me.level + 1) end,
    'today_left', 5 - (select count(*) from game_bets where user_id = me.user_id and bet_day = today and status <> 'void'),
    'invested', (select coalesce(sum(amount), 0) from game_bets where user_id = me.user_id and status in ('open','review')),
    'granted', me.granted, 'revives', me.revives, 'total_ret', game_total_ret(me.user_id),
    'broke_at', me.broke_at, 'revive_at', me.broke_at + make_interval(days => d),
    'revive_points', (select revive_points from game_config where id = 1),
    'bets', coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
        select id, market, symbol, pred_date, d1_date, amount, base_close, verdict, close_at, actual_close, ret, payout, exp_delta, settle_at,
               case when status = 'open' and now() >= close_at then 'review' else status end as status, created_at
          from game_bets where user_id = me.user_id order by created_at desc limit 30) x), '[]'::jsonb));
end;
$$;

-- 기절 중엔 걸 수 없음 (game_bet 앞단 검사)
create or replace function public.game_bet(p_market text, p_symbol text, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me game_players; s record; today date := (now() at time zone 'Asia/Seoul')::date; cnt int;
begin
  if not game_allowed() then return jsonb_build_object('ok', false, 'msg', '아직 열리지 않았어요'); end if;
  select * into me from game_players where user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'msg', '먼저 캐릭터를 골라 주세요'); end if;
  if me.broke_at is not null then return jsonb_build_object('ok', false, 'msg', '친구가 기절해 있어요. 부활하면 다시 걸 수 있어요'); end if;
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
  update game_players
     set points = points - p_amount,
         exp = exp + case when last_play is distinct from today then 3 else 0 end,
         level = game_level(exp + case when last_play is distinct from today then 3 else 0 end),
         last_play = today
   where user_id = me.user_id;
  return jsonb_build_object('ok', true, 'left', 4 - cnt);
end;
$$;

-- 순위표: 'ret'(주간 수익률) / 'total'(총 수익률) / 'level' / 'points'(총자산)
drop function if exists public.game_rank(text);
create or replace function public.game_rank(p_kind text default 'ret')
returns table (nickname text, animal text, level int, points bigint, week_ret double precision, total_ret double precision, revives int, broke boolean, is_me boolean)
language sql stable security definer set search_path = public as $$
  with w as (
    select user_id, sum(payout - amount)::double precision / nullif(sum(amount), 0) r
      from game_bets where status = 'settled' and created_at >= now() - interval '7 days' group by user_id),
  inv as (select user_id, sum(amount) s from game_bets where status in ('open','review') group by user_id)
  select coalesce(pr.nickname, '익명'), gp.animal, gp.level, gp.points + coalesce(inv.s, 0),
         coalesce(w.r, 0), (gp.points + coalesce(inv.s, 0) - gp.granted)::double precision / nullif(gp.granted, 0),
         gp.revives, gp.broke_at is not null, gp.user_id = auth.uid()
    from game_players gp join profiles pr on pr.id = gp.user_id
    left join w on w.user_id = gp.user_id left join inv on inv.user_id = gp.user_id
   where game_allowed()
   order by case p_kind
              when 'level'  then gp.level::double precision
              when 'points' then (gp.points + coalesce(inv.s, 0))::double precision
              when 'total'  then (gp.points + coalesce(inv.s, 0) - gp.granted)::double precision / nullif(gp.granted, 0)
              else coalesce(w.r, -1) end desc nulls last,
            gp.points desc
   limit 50;
$$;
grant execute on function public.game_rank(text) to authenticated;
revoke execute on function public.game_rank(text) from anon;
