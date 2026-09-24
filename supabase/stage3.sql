-- 예측 포털 3단계: 게시판 (글 · 댓글 · 신고 · 공지 고정 · 비밀글)
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)

-- ---------- 1. 테이블 ----------
create table if not exists public.posts (
  id            bigint generated always as identity primary key,
  board         text not null check (board in ('coin', 'nasdaq', 'kospi', 'request', 'payment')),
  user_id       uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  author        text not null default '',          -- 작성자 닉네임 (트리거가 채움)
  title         text not null check (char_length(title) between 1 and 100),
  body          text not null check (char_length(body) between 1 and 5000),
  is_secret     boolean not null default false,    -- 본인·운영자만 열람
  pinned        boolean not null default false,    -- 공지 고정 (운영자만)
  comment_count int not null default 0,
  report_count  int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz
);
create index if not exists posts_board_idx on public.posts (board, pinned desc, created_at desc);

create table if not exists public.comments (
  id         bigint generated always as identity primary key,
  post_id    bigint not null references public.posts(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  author     text not null default '',
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments (post_id, created_at);

create table if not exists public.post_reports (
  post_id    bigint not null references public.posts(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)                   -- 한 사람이 한 글에 한 번만 신고
);

-- ---------- 2. 글 저장 전 규칙 강제 ----------
create or replace function public.posts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.user_id := auth.uid();
    new.author := (select nickname from profiles where id = auth.uid());
    new.comment_count := 0;
    new.report_count := 0;
    new.created_at := now();
    if not is_admin() then new.pinned := false; end if;
  else
    -- 작성자·게시판·집계값은 바꿀 수 없고, 공지 고정은 운영자만
    new.user_id := old.user_id;
    new.author := old.author;
    new.board := old.board;
    new.created_at := old.created_at;
    if current_setting('portal.counter', true) is distinct from 'on' then
      new.comment_count := old.comment_count;
      new.report_count := old.report_count;
      if not is_admin() then new.pinned := old.pinned; end if;
      if new.title is distinct from old.title or new.body is distinct from old.body then
        new.updated_at := now();
      end if;
    end if;
  end if;
  if new.board = 'payment' then new.is_secret := true; end if;  -- 입금 문의는 항상 비밀글
  return new;
end;
$$;
drop trigger if exists posts_guard on public.posts;
create trigger posts_guard before insert or update on public.posts
  for each row execute function public.posts_guard();

create or replace function public.comments_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  new.author := (select nickname from profiles where id = auth.uid());
  new.created_at := now();
  return new;
end;
$$;
drop trigger if exists comments_guard on public.comments;
create trigger comments_guard before insert on public.comments
  for each row execute function public.comments_guard();

-- 댓글 수 · 신고 수 자동 집계
create or replace function public.bump_counts()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid   bigint := coalesce(new.post_id, old.post_id);
  delta int := case tg_op when 'INSERT' then 1 else -1 end;
begin
  perform set_config('portal.counter', 'on', true);
  if tg_table_name = 'comments' then
    update posts set comment_count = greatest(0, comment_count + delta) where id = pid;
  else
    update posts set report_count = greatest(0, report_count + delta) where id = pid;
  end if;
  perform set_config('portal.counter', 'off', true);
  return null;
end;
$$;
drop trigger if exists comments_count on public.comments;
create trigger comments_count after insert or delete on public.comments
  for each row execute function public.bump_counts();
drop trigger if exists reports_count on public.post_reports;
create trigger reports_count after insert or delete on public.post_reports
  for each row execute function public.bump_counts();

-- ---------- 3. 권한 (RLS) ----------
alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_reports enable row level security;

-- 글: 로그인한 회원 누구나 읽기 (비밀글은 본인·운영자만)
drop policy if exists "글 읽기" on public.posts;
create policy "글 읽기" on public.posts for select to authenticated
  using (not is_secret or user_id = auth.uid() or public.is_admin());
drop policy if exists "글 쓰기" on public.posts;
create policy "글 쓰기" on public.posts for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "글 수정" on public.posts;
create policy "글 수정" on public.posts for update to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "글 삭제" on public.posts;
create policy "글 삭제" on public.posts for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- 댓글: 볼 수 있는 글에만 읽기·쓰기 (posts 의 RLS 가 서브쿼리에도 적용됨)
drop policy if exists "댓글 읽기" on public.comments;
create policy "댓글 읽기" on public.comments for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
drop policy if exists "댓글 쓰기" on public.comments;
create policy "댓글 쓰기" on public.comments for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id));
drop policy if exists "댓글 삭제" on public.comments;
create policy "댓글 삭제" on public.comments for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- 신고: 본인 신고만 보고 추가·취소
drop policy if exists "신고 조회" on public.post_reports;
create policy "신고 조회" on public.post_reports for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
drop policy if exists "신고 추가" on public.post_reports;
create policy "신고 추가" on public.post_reports for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id));
drop policy if exists "신고 취소" on public.post_reports;
create policy "신고 취소" on public.post_reports for delete to authenticated
  using (user_id = auth.uid());
