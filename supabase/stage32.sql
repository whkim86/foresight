-- 신호등 친구들: 걸기 마감 = 취소 마감 = 종가 cancel_hours(3시간) 전 (A안, 2026-10-28 결정) — stage31 다음, 여러 번 실행해도 안전
--   업비트: 다음 날 06:00 · 빗썸: D+1 당일 21:00 · 코스피: 12:30 · 나스닥: 미국 13:00 (종가는 그대로)
--   이미 걸린 투자는 걸 때 저장된 마감 시각 그대로 (취소 마감은 원래부터 종가 3시간 전)

create or replace function public.game_times(p_market text, p_d1 date, out cutoff_at timestamptz, out close_at timestamptz)
language sql stable as $$
  with c as (
    select case p_market
             when 'coin'    then ((p_d1 + 1)::timestamp + time '09:00') at time zone 'Asia/Seoul'
             when 'bithumb' then ((p_d1 + 1)::timestamp) at time zone 'Asia/Seoul'
             when 'kospi'   then (p_d1::timestamp + time '15:30') at time zone 'Asia/Seoul'
             when 'nasdaq'  then (p_d1::timestamp + time '16:00') at time zone 'America/New_York'
           end as close_at)
  select c.close_at - make_interval(hours => (select cancel_hours from public.game_config where id = 1)), c.close_at from c;
$$;
