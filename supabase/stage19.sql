-- AI 신호등 19단계: 운영자 회원 목록에 '최근 방문 · 30일 방문 일수 · 주로 본 시장'
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
-- 방문 기록(stage17 events)에서 회원별 요약만 꺼냄. 화면별 동선은 보여주지 않음. 운영자만 호출 가능

create or replace function public.member_activity()
returns table (user_id uuid, last_visit timestamptz, days_30 int, visits_30 int, top_market text)
language sql stable security definer set search_path = public as $$
  with e as (
    select * from events
     where user_id is not null and public.is_admin()
  ),
  last as (select user_id, max(ts) as last_visit from e group by user_id),
  m30 as (
    select user_id,
           count(distinct (ts at time zone 'Asia/Seoul')::date)::int as days_30,
           count(distinct session_id)::int as visits_30
      from e where ts >= now() - interval '30 days' group by user_id
  ),
  mk as (
    select distinct on (user_id) user_id, split_part(page, ':', 2) as top_market
      from e
     where kind = 'view' and page like 'dash:%' and page not like '%:locked'
     group by user_id, split_part(page, ':', 2)
     order by user_id, count(*) desc
  )
  select l.user_id, l.last_visit, coalesce(m.days_30, 0), coalesce(m.visits_30, 0), k.top_market
    from last l left join m30 m using (user_id) left join mk k using (user_id);
$$;
grant execute on function public.member_activity() to authenticated;
