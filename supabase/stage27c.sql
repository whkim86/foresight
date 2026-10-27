-- 신호등 친구들 보강 2: 투자 취소 · 종목 정렬용 정보 · 즐겨찾기 (stage27b 다음, 여러 번 실행해도 안전)
--   취소: 모든 시장 공통, 장 마감(close_at) cancel_hours(3시간) 전까지 → 장 중 흐름 보고 빼는 것도 허용 (재미 우선)
--         → 포인트 전액 반환, 그날 투자 횟수도 돌아옴, 같은 종목 다시 걸기 가능 (status = 'void')

alter table public.game_config add column if not exists cancel_hours int not null default 3;

-- 취소한 종목은 다시 걸 수 있게: 중복 금지를 '취소 안 한 투자'에만 적용
alter table public.game_bets drop constraint if exists game_bets_user_id_market_symbol_pred_date_key;
create unique index if not exists game_bets_one_live on public.game_bets (user_id, market, symbol, pred_date) where status <> 'void';

-- ---------- 즐겨찾기 ----------
create table if not exists public.game_favorites (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  market     text not null check (market in ('coin','bithumb','nasdaq','kospi')),
  symbol     text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, market, symbol)
);
alter table public.game_favorites enable row level security;
drop policy if exists "본인 조회" on public.game_favorites;
create policy "본인 조회" on public.game_favorites for select to authenticated using (user_id = auth.uid());
grant select on public.game_favorites to authenticated;
grant all on public.game_favorites to service_role;

-- 즐겨찾기 켜기/끄기 → 켜졌으면 true
create or replace function public.game_fav(p_market text, p_symbol text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not game_allowed() then return false; end if;
  delete from game_favorites where user_id = auth.uid() and market = p_market and symbol = p_symbol;
  if found then return false; end if;
  insert into game_favorites (user_id, market, symbol) values (auth.uid(), p_market, p_symbol);
  return true;
end;
$$;
grant execute on function public.game_fav(text, text) to authenticated;
revoke execute on function public.game_fav(text, text) from anon;

-- ---------- 걸 수 있는 종목 + 정렬용 정보 ----------
--   prev_close: 그 전 예측의 직전 종가 → chg = 최근 하루 등락률 (어제 상승·하락 순)
--   up_n/dn_n/n_models: D+1 상승·하락 예측 모델 수, med1: AI 예상 D+1 등락률(중앙값)
drop function if exists public.game_symbols(text);
create or replace function public.game_symbols(p_market text)
returns table (symbol text, verdict text, pred_date date, d1_date date, base_close double precision, cutoff_at timestamptz, close_at timestamptz,
               prev_close double precision, chg double precision, up_n int, dn_n int, n_models int, med1 double precision, fav boolean)
language sql stable security definer set search_path = public as $$
  with last as (select max(pred_date) d from predictions where market = p_market)
  select p.symbol, p.verdict, p.pred_date, p.d1_date, p.base_close, t.cutoff_at, t.close_at,
         pv.base_close, case when pv.base_close > 0 then p.base_close / pv.base_close - 1 end,
         p.up_n, p.dn_n, p.n_models, p.med1,
         exists (select 1 from game_favorites f where f.user_id = auth.uid() and f.market = p_market and f.symbol = p.symbol)
    from predictions p cross join last
    cross join lateral game_times(p_market, p.d1_date) t
    left join lateral (select q.base_close from predictions q
                        where q.market = p_market and q.symbol = p.symbol and q.pred_date < p.pred_date and q.base_date < p.base_date
                        order by q.pred_date desc limit 1) pv on true
   where game_allowed() and p.market = p_market and p.pred_date = last.d
     and p.verdict in ('up','mx','dn') and p.base_close > 0 and p.d1_date is not null and now() < t.cutoff_at
   order by p.symbol;
$$;
grant execute on function public.game_symbols(text) to authenticated;
revoke execute on function public.game_symbols(text) from anon;

-- ---------- 취소 가능 여부 ----------
create or replace function public.game_cancel_until(b game_bets)
returns timestamptz language sql stable set search_path = public as $$
  select b.close_at - make_interval(hours => (select cancel_hours from game_config where id = 1));
$$;

create or replace function public.game_cancel(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b game_bets;
begin
  if not game_allowed() then return jsonb_build_object('ok', false, 'msg', '아직 열리지 않았어요'); end if;
  select * into b from game_bets where id = p_id and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'msg', '투자 기록을 찾지 못했어요'); end if;
  if b.status <> 'open' then return jsonb_build_object('ok', false, 'msg', '이미 정산 중이거나 끝난 투자예요'); end if;
  if now() >= game_cancel_until(b) then
    return jsonb_build_object('ok', false, 'msg', '장 마감 ' || (select cancel_hours from game_config where id = 1) || '시간 전까지만 취소할 수 있어요');
  end if;
  update game_bets set status = 'void' where id = b.id;
  update game_players set points = points + b.amount where user_id = b.user_id;
  return jsonb_build_object('ok', true, 'refund', b.amount);
end;
$$;
grant execute on function public.game_cancel(bigint) to authenticated;
revoke execute on function public.game_cancel(bigint) from anon;

-- ---------- 내 정보: 기록에 취소 가능 시각 추가, 취소한 건은 기록에서 뺌 ----------
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
        select g.id, g.market, g.symbol, g.pred_date, g.d1_date, g.amount, g.base_close, g.verdict, g.close_at, g.actual_close, g.ret, g.payout, g.exp_delta, g.settle_at,
               case when g.status = 'open' and now() >= g.close_at then 'review' else g.status end as status, g.created_at,
               case when g.status = 'open' and now() < game_cancel_until(g) then game_cancel_until(g) end as cancel_until
          from game_bets g where g.user_id = me.user_id and g.status <> 'void' order by g.created_at desc limit 30) x), '[]'::jsonb));
end;
$$;

-- 투자: 취소(void)한 종목은 다시 걸 수 있게
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
  if exists (select 1 from game_bets where user_id = me.user_id and market = p_market and symbol = p_symbol and pred_date = s.pred_date and status <> 'void') then
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
