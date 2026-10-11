-- AI 신호등 16-2단계: '상승 예측 상위 모델' 함수가 회원에게 모델 이름(순서)만 내려주게 — 적중률 숫자는 비공개
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
-- 고르는 기준은 stage16.sql 과 같음. 운영자는 '모델 성적' 탭에서 숫자를 그대로 볼 수 있음

drop function if exists public.top_up_models(text, int, int);
create function public.top_up_models(p_market text, p_days int default 7, p_n int default 5)
returns table (model text)
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
  select s.model
    from s, cut
   where s.up_n >= cut.min_n and s.days >= cut.min_days
   order by s.up_hit::double precision / s.up_n desc, s.up_hit desc
   limit greatest(1, least(p_n, 10));
$$;
grant execute on function public.top_up_models(text, int, int) to authenticated;
