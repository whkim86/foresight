-- stage38: 운영자 전용 보고서 보관함 (룰 성적표 등)
-- GitHub Actions(ingest/rules.py)가 service_role 로 시장별 결과(JSON)를 덮어쓰고, 운영자 화면(rules.html)만 읽음
-- Storage 의 시장 폴더는 무료체험 회원도 읽을 수 있어서, 적중률이 담긴 보고서는 여기에 둠
create table if not exists public.admin_reports (
  key        text primary key,            -- 예: 'rules:coin'
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.admin_reports enable row level security;
drop policy if exists "운영자 조회" on public.admin_reports;
create policy "운영자 조회" on public.admin_reports for select to authenticated using (public.is_admin());

grant select on public.admin_reports to authenticated;
grant all on public.admin_reports to service_role;
