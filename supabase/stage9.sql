-- AI 신호등 9단계: 운영자 화면 'AI 해설' 사용량·충전 대비 잔액
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)

-- ---------- 1. 운영 설정값 (충전 금액 등) ----------
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "운영자 조회" on public.app_settings;
create policy "운영자 조회" on public.app_settings for select to authenticated using (public.is_admin());
drop policy if exists "운영자 저장" on public.app_settings;
create policy "운영자 저장" on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- 2. 사용량 집계 (운영자만) ----------
-- 기간별 질문 수와 토큰 합계. 기간: all(전체) / month(이번 달, 한국 시간) / today(오늘)
create or replace function public.ai_admin_stats()
returns table (scope text, questions int, input_tokens bigint, output_tokens bigint)
language sql stable security definer set search_path = public as $$
  with l as (
    select created_at at time zone 'Asia/Seoul' as kst, coalesce(input_tokens, 0) as i, coalesce(output_tokens, 0) as o
      from ai_logs where public.is_admin()
  ), now_kst as (select now() at time zone 'Asia/Seoul' as t)
  select 'all', count(*)::int, coalesce(sum(i), 0)::bigint, coalesce(sum(o), 0)::bigint from l
  union all
  select 'month', count(*)::int, coalesce(sum(i), 0)::bigint, coalesce(sum(o), 0)::bigint
    from l, now_kst where date_trunc('month', l.kst) = date_trunc('month', now_kst.t)
  union all
  select 'today', count(*)::int, coalesce(sum(i), 0)::bigint, coalesce(sum(o), 0)::bigint
    from l, now_kst where l.kst::date = now_kst.t::date;
$$;

-- 회원별 최근 30일 사용량
create or replace function public.ai_admin_users()
returns table (nickname text, questions int, input_tokens bigint, output_tokens bigint, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  select coalesce(p.nickname, '(탈퇴 회원)'), count(*)::int,
         coalesce(sum(a.input_tokens), 0)::bigint, coalesce(sum(a.output_tokens), 0)::bigint, max(a.created_at)
    from ai_logs a left join profiles p on p.id = a.user_id
   where public.is_admin() and a.created_at > now() - interval '30 days'
   group by p.nickname
   order by count(*) desc;
$$;
