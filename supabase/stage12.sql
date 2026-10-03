-- AI 신호등 12단계: 조회수 (게시글 · 화면)
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
-- 열 때마다 +1 (중복 제거 없음). 운영자 계정의 조회는 세지 않음

-- ---------- 1. 게시글 조회수 ----------
alter table public.posts add column if not exists view_count int not null default 0;

create or replace function public.view_post(p_id bigint)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  if public.is_admin() then
    select view_count into v from posts where id = p_id;
    return v;
  end if;
  perform set_config('portal.counter', 'on', true);  -- posts_guard 가 집계 칸 변경을 허용하도록
  update posts set view_count = view_count + 1
   where id = p_id and (not is_secret or user_id = auth.uid())
  returning view_count into v;
  perform set_config('portal.counter', 'off', true);
  return v;
end;
$$;
revoke execute on function public.view_post(bigint) from anon;

-- 글 저장 규칙(stage7)에 조회수 보호 추가: 회원이 자기 글 조회수를 직접 고칠 수 없게
create or replace function public.posts_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is null then
      if new.user_id is null then raise exception '자동 글에는 작성자(user_id)가 필요해요'; end if;
      new.author := coalesce(nullif(new.author, ''), (select nickname from profiles where id = new.user_id));
    else
      new.user_id := auth.uid();
      new.author := (select nickname from profiles where id = auth.uid());
      if not is_admin() then new.pinned := false; end if;
    end if;
    new.comment_count := 0;
    new.report_count := 0;
    new.view_count := 0;
    new.created_at := now();
  else
    new.user_id := old.user_id;
    new.author := old.author;
    new.board := old.board;
    new.created_at := old.created_at;
    new.auto_key := old.auto_key;
    if current_setting('portal.counter', true) is distinct from 'on' then
      new.comment_count := old.comment_count;
      new.report_count := old.report_count;
      new.view_count := old.view_count;
      if auth.uid() is not null and not is_admin() then new.pinned := old.pinned; end if;
      if new.title is distinct from old.title or new.body is distinct from old.body then
        new.updated_at := now();
      end if;
    end if;
  end if;
  if new.board = 'payment' then new.is_secret := true; end if;
  return new;
end;
$$;

-- ---------- 2. 화면별 조회수 (날짜별) ----------
create table if not exists public.page_views (
  page  text not null,                 -- 예: home, landing, dash:coin:priority, board:coin, mypage
  day   date not null,
  count int  not null default 0,
  primary key (page, day)
);
alter table public.page_views enable row level security;
drop policy if exists "운영자 조회" on public.page_views;
create policy "운영자 조회" on public.page_views for select to authenticated using (public.is_admin());

create or replace function public.track_page(p_page text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_page is null or p_page !~ '^[a-z0-9:_-]{1,60}$' or public.is_admin() then return; end if;
  insert into page_views (page, day, count)
  values (p_page, (now() at time zone 'Asia/Seoul')::date, 1)
  on conflict (page, day) do update set count = page_views.count + 1;
end;
$$;
grant execute on function public.track_page(text) to anon, authenticated;

-- 운영자 화면용: 화면별 오늘 / 최근 7일 / 최근 30일
create or replace function public.page_view_stats()
returns table (page text, today bigint, week bigint, month bigint)
language sql stable security definer set search_path = public as $$
  with d as (select (now() at time zone 'Asia/Seoul')::date as t)
  select page,
         coalesce(sum(count) filter (where day = d.t), 0),
         coalesce(sum(count) filter (where day > d.t - 7), 0),
         coalesce(sum(count) filter (where day > d.t - 30), 0)
    from page_views, d
   where public.is_admin()
   group by page
   order by 4 desc;
$$;
