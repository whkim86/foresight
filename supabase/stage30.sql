-- 신호등 친구들: 하락에 걸기 + 코인 마감 시각 보정 — stage29 다음, 여러 번 실행해도 안전
--   · 하락에 걸기(side = 'dn'): 내린 만큼 벌고 오른 만큼 잃음 → 돌려받는 포인트 = 건 포인트 × (2 − D+1 종가 / 직전 종가), 0 밑으로는 안 내려감
--     EXP 도 '내 쪽으로 움직인 정도'(하락이면 −등락률)로 계산
--   · 코인 마감 보정: 업비트·빗썸은 마감 = 종가 시각(다음 날 09:00 / 00:00)이라, 하루 움직임을 거의 다 보고 막판에 걸 수 있었음
--     → 업비트는 D+1 당일 12:00, 빗썸은 D+1 당일 06:00 까지만 걸 수 있게 (예측 공개 업비트 ~09:20 · 빗썸 ~01:30 이후 약 3~4시간)
--     이미 걸린 투자는 걸 때 저장된 마감 시각 그대로라 영향 없음

alter table public.game_bets add column if not exists side text not null default 'up';
do $$ begin
  alter table public.game_bets add constraint game_bets_side_chk check (side in ('up', 'dn'));
exception when duplicate_object then null; end $$;

-- ---------- 마감·종가 시각 ----------
create or replace function public.game_times(p_market text, p_d1 date, out cutoff_at timestamptz, out close_at timestamptz)
language sql stable as $$
  select case p_market
           when 'coin'    then (p_d1::timestamp + time '12:00') at time zone 'Asia/Seoul'
           when 'bithumb' then (p_d1::timestamp + time '06:00') at time zone 'Asia/Seoul'
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

-- ---------- 정산 (하락에 건 투자는 반대로) ----------
create or replace function public.game_settle()
returns int language plpgsql security definer set search_path = public as $$
declare n int := 0; b record; mins int;
begin
  select review_minutes into mins from game_config where id = 1;
  update game_bets g
     set actual_close = p.actual_close,
         ret = p.actual_close / g.base_close - 1,
         payout = greatest(0, floor(g.amount * case when g.side = 'dn' then 2 - p.actual_close / g.base_close else p.actual_close / g.base_close end))::bigint,
         exp_delta = game_exp(case when g.side = 'dn' then 1 - p.actual_close / g.base_close else p.actual_close / g.base_close - 1 end),
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
  insert into game_rewards (user_id, level)
  select gp.user_id, l from game_players gp, unnest(array[10, 20, 30]) l where gp.level >= l
  on conflict do nothing;
  return n;
end;
$$;

-- ---------- 걸기: 상승(up) / 하락(dn) ----------
drop function if exists public.game_bet(text, text, bigint);
create or replace function public.game_bet(p_market text, p_symbol text, p_amount bigint, p_side text default 'up')
returns jsonb language plpgsql security definer set search_path = public as $$
declare me game_players; s record; today date := (now() at time zone 'Asia/Seoul')::date; cnt int;
begin
  if coalesce(p_side, 'up') not in ('up', 'dn') then return jsonb_build_object('ok', false, 'msg', '상승 또는 하락을 골라 주세요'); end if;
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
  insert into game_bets (user_id, market, symbol, pred_date, d1_date, amount, base_close, verdict, cutoff_at, close_at, side)
  values (me.user_id, p_market, p_symbol, s.pred_date, s.d1_date, p_amount, s.base_close, s.verdict, s.cutoff_at, s.close_at, coalesce(p_side, 'up'));
  update game_players
     set points = points - p_amount,
         exp = exp + case when last_play is distinct from today then 3 else 0 end,
         level = game_level(exp + case when last_play is distinct from today then 3 else 0 end),
         last_play = today
   where user_id = me.user_id;
  return jsonb_build_object('ok', true, 'left', 4 - cnt);
end;
$$;
grant execute on function public.game_bet(text, text, bigint, text) to authenticated;
revoke execute on function public.game_bet(text, text, bigint, text) from anon;

-- ---------- 내 정보: 기록에 side ----------
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
    'hat', me.hat, 'outfit', me.outfit, 'shoes', me.shoes, 'show_name', me.show_name,
    'display_name', game_display_name(me.user_id), 'missions', game_missions(me.user_id),
    'bets', coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
        select g.id, g.market, g.symbol, g.side, g.pred_date, g.d1_date, g.amount, g.base_close, g.verdict, g.close_at, g.actual_close, g.ret, g.payout, g.exp_delta, g.settle_at,
               case when g.status = 'open' and now() >= g.close_at then 'review' else g.status end as status, g.created_at,
               case when g.status = 'open' and now() < game_cancel_until(g) then game_cancel_until(g) end as cancel_until
          from game_bets g where g.user_id = me.user_id and g.status <> 'void' order by g.created_at desc limit 30) x), '[]'::jsonb));
end;
$$;
