-- AI 신호등 18단계: 회원 탈퇴 (마이페이지에서 직접) + 탈퇴 사유 기록
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
--
-- 탈퇴하면: 로그인 계정(auth.users) 삭제 → 프로필·입금 신청·글·댓글·AI 사용량이 함께 지워짐(기존 on delete cascade)
-- 남기는 것 (개인을 알아볼 수 없게):
--   · withdrawals: 탈퇴 사유·가입 기간·유료 이용 여부 (개선용, 운영자만 조회)
--   · payment_archive: 승인된 입금 내역 (전자상거래법상 대금 결제 기록 5년 보관 의무) — 운영자만 조회
--   · events(방문 기록): 회원 id 를 지워 익명으로

create table if not exists public.withdrawals (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  reasons     text[] not null default '{}',   -- accuracy, hard, missing, price, rarely, other_service, privacy, etc
  memo        text,                           -- 기타 직접 입력 (200자)
  member_days int,                            -- 가입 후 며칠 만에 탈퇴
  was_paid    boolean,                        -- 유료 이용 이력
  had_active  boolean                         -- 탈퇴 시점에 남은 이용 기간이 있었는지
);
alter table public.withdrawals enable row level security;
drop policy if exists "운영자 조회" on public.withdrawals;
create policy "운영자 조회" on public.withdrawals for select to authenticated using (public.is_admin());

create table if not exists public.payment_archive (
  id            bigint primary key,             -- 원래 입금 신청 번호
  nickname      text,
  tabs          text[],
  months        int,
  amount        int,
  requested_at  timestamptz,
  approved_at   timestamptz,
  archived_at   timestamptz not null default now()
);
alter table public.payment_archive enable row level security;
drop policy if exists "운영자 조회" on public.payment_archive;
create policy "운영자 조회" on public.payment_archive for select to authenticated using (public.is_admin());

create or replace function public.delete_my_account(p_reasons text[] default '{}', p_memo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  p   profiles%rowtype;
begin
  if uid is null then raise exception '로그인이 필요해요'; end if;
  if public.is_admin() then raise exception '운영자 계정은 여기서 탈퇴할 수 없어요'; end if;
  select * into p from profiles where id = uid;

  insert into withdrawals (reasons, memo, member_days, was_paid, had_active)
  values (
    coalesce((select array_agg(r) from unnest(p_reasons) r
               where r in ('accuracy', 'hard', 'missing', 'price', 'rarely', 'other_service', 'privacy', 'etc')), '{}'),
    left(nullif(trim(p_memo), ''), 200),
    case when p.joined_at is not null then (now()::date - p.joined_at::date) end,
    exists (select 1 from payment_requests where user_id = uid and status = 'approved'),
    coalesce(greatest(p.coin_until, p.nasdaq_until, p.kospi_until) > now(), false)
  );

  insert into payment_archive (id, nickname, tabs, months, amount, requested_at, approved_at)
  select r.id, p.nickname, r.tabs, r.months, r.amount, r.created_at, r.processed_at
    from payment_requests r where r.user_id = uid and r.status = 'approved'
  on conflict (id) do nothing;

  update events set user_id = null where user_id = uid;
  delete from auth.users where id = uid;   -- 프로필·글·댓글·입금 신청 등은 연결된 규칙대로 함께 삭제
end;
$$;
revoke execute on function public.delete_my_account(text[], text) from anon;
grant execute on function public.delete_my_account(text[], text) to authenticated;
