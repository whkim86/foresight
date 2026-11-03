-- 게시판 좋아요 + 모의투자 포인트 내역 — stage35 다음, 여러 번 실행해도 안전
--   좋아요: 글마다 한 사람 한 번 (다시 누르면 취소) · 내 글·비밀글엔 못 누름 · 포인트 보상 없음
--   포인트 내역: 시작 · 걸기 · 정산 · 미션 보너스 · 가입인사 보너스 · 부활 을 시간순으로 모아 보여 줌 (본인만)
--     취소한 걸기(void)는 빠져나갔다 그대로 돌아온 것이라 내역에서 뺌
--     부활은 이 파일부터 기록(game_revive_log) — 그 전 부활은 시각이 없어 내역에 안 나옴

-- ========== 1. 좋아요 ==========
alter table public.posts add column if not exists like_count int not null default 0;

create table if not exists public.post_likes (
  post_id    bigint not null references public.posts(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.post_likes enable row level security;
drop policy if exists "좋아요 조회" on public.post_likes;
create policy "좋아요 조회" on public.post_likes for select to authenticated using (user_id = auth.uid());
drop policy if exists "좋아요 추가" on public.post_likes;
create policy "좋아요 추가" on public.post_likes for insert to authenticated
  with check (user_id = auth.uid()
              and exists (select 1 from public.posts p where p.id = post_id and p.user_id <> auth.uid() and not p.is_secret));
drop policy if exists "좋아요 취소" on public.post_likes;
create policy "좋아요 취소" on public.post_likes for delete to authenticated using (user_id = auth.uid());
grant select, insert, delete on public.post_likes to authenticated;
grant all on public.post_likes to service_role;

-- 댓글 수 · 신고 수 · 좋아요 수 자동 집계 (stage3 의 bump_counts + 좋아요)
create or replace function public.bump_counts()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid   bigint := coalesce(new.post_id, old.post_id);
  delta int := case tg_op when 'INSERT' then 1 else -1 end;
begin
  perform set_config('portal.counter', 'on', true);
  if tg_table_name = 'comments' then
    update posts set comment_count = greatest(0, comment_count + delta) where id = pid;
  elsif tg_table_name = 'post_likes' then
    update posts set like_count = greatest(0, like_count + delta) where id = pid;
  else
    update posts set report_count = greatest(0, report_count + delta) where id = pid;
  end if;
  perform set_config('portal.counter', 'off', true);
  return null;
end;
$$;
drop trigger if exists likes_count on public.post_likes;
create trigger likes_count after insert or delete on public.post_likes
  for each row execute function public.bump_counts();

-- 글 저장 규칙(stage12)에 좋아요 수 보호 추가: 회원이 좋아요 수를 직접 고칠 수 없게
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
    new.like_count := 0;
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
      new.like_count := old.like_count;
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

-- ========== 2. 부활 기록 ==========
create table if not exists public.game_revive_log (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  points     bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists game_revive_log_user_idx on public.game_revive_log (user_id, created_at desc);
alter table public.game_revive_log enable row level security;
drop policy if exists "본인 조회" on public.game_revive_log;
create policy "본인 조회" on public.game_revive_log for select to authenticated using (user_id = auth.uid());
grant select on public.game_revive_log to authenticated;
grant all on public.game_revive_log to service_role;

-- 기절 표시 · 부활 처리 (stage27b 의 game_revive + 부활 기록 한 줄)
create or replace function public.game_revive()
returns void language plpgsql security definer set search_path = public as $$
declare d int; pts bigint;
begin
  select revive_days, revive_points into d, pts from game_config where id = 1;
  -- 부활 시각이 지난 친구 → 부활 (+ 기록)
  with r as (
    update game_players
       set points = points + pts, granted = granted + pts, revives = revives + 1, broke_at = null
     where broke_at is not null and broke_at + make_interval(days => d) <= now()
    returning user_id)
  insert into game_revive_log (user_id, points) select user_id, pts from r;
  -- 새로 기절한 친구
  update game_players gp set broke_at = now()
   where gp.broke_at is null and gp.points < 1000
     and not exists (select 1 from game_bets b where b.user_id = gp.user_id and b.status in ('open', 'review'));
end;
$$;
revoke execute on function public.game_revive() from public, anon;
grant execute on function public.game_revive() to authenticated, service_role;

-- ========== 3. 포인트 내역 (본인, 최근 p_days 일) ==========
--   balance = 그 일이 끝난 뒤 보유 포인트 (지금 보유에서 거꾸로 계산)
create or replace function public.game_ledger(p_days int default 60)
returns table (at timestamptz, kind text, market text, symbol text, side text, ret double precision, delta bigint, balance bigint)
language sql stable security definer set search_path = public as $$
  with me as (select user_id, points, created_at from game_players where user_id = auth.uid()),
  ev as (
    select me.created_at at, 'start'::text kind, null::text market, null::text symbol, null::text side, null::double precision ret,
           (select start_points from game_config where id = 1) delta, 0 ord
      from me
    union all
    select b.created_at, 'bet', b.market, b.symbol, b.side, null, -b.amount, 1
      from game_bets b join me on me.user_id = b.user_id where b.status <> 'void'
    union all
    select coalesce(b.settle_at, b.close_at), 'settle', b.market, b.symbol, b.side,
           case when b.side = 'dn' then -b.ret else b.ret end, b.payout, 2
      from game_bets b join me on me.user_id = b.user_id where b.status = 'settled' and b.payout is not null
    union all
    select g.created_at, 'bonus_' || g.kind, null, null, null, null, g.points, 3
      from game_bonus_log g join me on me.user_id = g.user_id
    union all
    select h.given_at, 'hello', null, null, null, null, h.points, 3
      from game_hello h join me on me.user_id = h.user_id where h.given_at is not null and h.points > 0
    union all
    select r.created_at, 'revive', null, null, null, null, r.points, 3
      from game_revive_log r join me on me.user_id = r.user_id),
  run as (
    select ev.*, (select points from me)
             - coalesce(sum(delta) over (order by at desc, ord desc rows between unbounded preceding and 1 preceding), 0) bal
      from ev)
  select at, kind, market, symbol, side, ret, delta, bal::bigint
    from run
   where at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 60), 365)))
   order by at desc, ord desc
   limit 500;
$$;
grant execute on function public.game_ledger(int) to authenticated;
revoke execute on function public.game_ledger(int) from public, anon;
