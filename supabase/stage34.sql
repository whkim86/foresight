-- 순위표: 사람마다 '가장 잘 번 종목' 하나 (stage28 의 game_rank 를 바꿈) — stage33 다음, 여러 번 실행해도 안전
--   종목별 누적 = 결과가 나온(settled) 걸기의 방향 반영 등락률 합
--     상승에 걸기: +등락률 / 하락에 걸기: −등락률  (맞히면 +, 틀리면 −)
--   합계가 가장 큰 종목 하나 (0 이하면 표시 안 함), 같으면 횟수 많은 쪽

drop function if exists public.game_rank(text);
create or replace function public.game_rank(p_kind text default 'ret')
returns table (nickname text, animal text, level int, points bigint, week_ret double precision, total_ret double precision, revives int, broke boolean, is_me boolean,
               hat text, outfit text, shoes text,
               best_market text, best_symbol text, best_ret double precision, best_n int)
language sql stable security definer set search_path = public as $$
  with w as (
    select user_id, sum(payout - amount)::double precision / nullif(sum(amount), 0) r
      from game_bets where status = 'settled' and created_at >= now() - interval '7 days' group by user_id),
  inv as (select user_id, sum(amount) s from game_bets where status in ('open','review') group by user_id),
  sym as (
    select user_id, market, symbol,
           sum(case when side = 'dn' then -ret else ret end) r, count(*)::int n
      from game_bets where status = 'settled' and ret is not null group by user_id, market, symbol),
  best as (
    select distinct on (user_id) user_id, market, symbol, r, n
      from sym where r > 0 order by user_id, r desc, n desc)
  select game_display_name(gp.user_id), gp.animal, gp.level, gp.points + coalesce(inv.s, 0),
         coalesce(w.r, 0), (gp.points + coalesce(inv.s, 0) - gp.granted)::double precision / nullif(gp.granted, 0),
         gp.revives, gp.broke_at is not null, gp.user_id = auth.uid(), gp.hat, gp.outfit, gp.shoes,
         best.market, best.symbol, best.r, best.n
    from game_players gp
    left join w on w.user_id = gp.user_id left join inv on inv.user_id = gp.user_id
    left join best on best.user_id = gp.user_id
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
