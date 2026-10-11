-- AI 신호등 16단계: 가격 차트에 '최근 7일 상승 예측 적중률 상위 5개 모델' 선 보여주기
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
--
-- 모델 성적표(model_scores)에서 최근 p_days 일(대상일 기준) 동안 D+1~D+6 상승 예측을 합쳐
-- 적중률(실제로 오른 수 ÷ 상승 예측 수)이 높은 순으로 p_n 개. 그 탭을 볼 수 있는 회원에게만 내려줌.
-- 우연히 몇 번만 맞힌 모델이 1등이 되지 않게: 상승 예측 수가 30번 미만이거나 모델들 중 하위 25%면 제외,
-- 채점된 날이 3일(또는 가장 많은 모델의 날 수) 미만이면 제외 (새로 추가된 모델은 며칠 쌓인 뒤 후보가 됨)
create or replace function public.top_up_models(p_market text, p_days int default 7, p_n int default 5)
returns table (model text, up_n bigint, up_hit bigint, hit_rate double precision, days int)
language sql stable security definer set search_path = public as $$
  with s as (
    select m.model, sum(m.up_n) as up_n, sum(m.up_hit) as up_hit, count(distinct m.target_date)::int as days
      from model_scores m
     where m.market = p_market
       and public.has_tab(p_market)
       and m.target_date >= (now() at time zone 'Asia/Seoul')::date - p_days
     group by m.model
  ), cut as (
    select greatest(30, coalesce(percentile_cont(0.25) within group (order by up_n), 0)) as min_n,
           least(3, coalesce(max(days), 0)) as min_days
      from s
  )
  select s.model, s.up_n, s.up_hit, s.up_hit::double precision / s.up_n, s.days
    from s, cut
   where s.up_n >= cut.min_n and s.days >= cut.min_days
   order by s.up_hit::double precision / s.up_n desc, s.up_hit desc
   limit greatest(1, least(p_n, 10));
$$;
grant execute on function public.top_up_models(text, int, int) to authenticated;
