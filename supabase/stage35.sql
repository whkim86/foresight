-- 가입인사 게시판(board = 'hello') + 첫 가입인사 보너스 — stage34 다음, 여러 번 실행해도 안전
--   가입인사 게시판에 10자 이상(앞뒤 공백 빼고) 글을 처음 쓰면 모의투자 hello_points(50,000P) 한 번 지급
--   · 계정당 한 번 (game_hello 에 기록) — 글을 지웠다 다시 써도 다시 안 줌, 지워도 회수 안 함
--   · 아직 모의투자 친구를 안 골랐으면 '받을 예정'으로 두었다가 game_join 때 지급
--   · 받은 보너스는 granted(받은 포인트 합계)에도 더함 → 총 수익률엔 영향 없음 (미션 보너스와 같음)

alter table public.posts drop constraint if exists posts_board_check;
alter table public.posts add constraint posts_board_check check (board in ('coin', 'nasdaq', 'kospi', 'game', 'hello', 'request', 'payment'));

alter table public.game_config add column if not exists hello_points bigint not null default 50000;

create table if not exists public.game_hello (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  post_id    bigint,
  points     bigint not null,
  created_at timestamptz not null default now(),
  given_at   timestamptz                         -- null = 모의투자 시작하면 지급
);
alter table public.game_hello enable row level security;
drop policy if exists "본인 조회" on public.game_hello;
create policy "본인 조회" on public.game_hello for select to authenticated using (user_id = auth.uid());
grant select on public.game_hello to authenticated;
grant all on public.game_hello to service_role;

-- 내부용: 받을 예정인 가입인사 보너스가 있고 모의투자 친구가 있으면 지급 → 지급한 포인트 (없으면 0)
create or replace function public.game_hello_pay(p_user uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare pts bigint;
begin
  if not exists (select 1 from game_players where user_id = p_user) then return 0; end if;
  update game_hello set given_at = now() where user_id = p_user and given_at is null returning points into pts;
  if pts is null then return 0; end if;
  update game_players set points = points + pts, granted = granted + pts where user_id = p_user;
  return pts;
end;
$$;
revoke execute on function public.game_hello_pay(uuid) from public, anon, authenticated;

-- 가입인사 글이 올라오면: 첫 글(10자 이상)만 기록하고 바로 지급 시도
create or replace function public.game_hello_on_post()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- 고정 공지(운영자)는 제외
  if new.board = 'hello' and new.user_id is not null and not coalesce(new.pinned, false) and char_length(btrim(new.body)) >= 10 then
    insert into game_hello (user_id, post_id, points)
    values (new.user_id, new.id, (select hello_points from game_config where id = 1))
    on conflict (user_id) do nothing;
    perform game_hello_pay(new.user_id);
  end if;
  return new;
end;
$$;
revoke execute on function public.game_hello_on_post() from public, anon, authenticated;
drop trigger if exists game_hello_on_post on public.posts;
create trigger game_hello_on_post after insert on public.posts for each row execute function public.game_hello_on_post();

-- 화면용: 내 가입인사 보너스 상태 → {done, given, pending, points}
create or replace function public.game_hello_status()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'done',    h.user_id is not null,
    'given',   h.given_at is not null,
    'pending', h.user_id is not null and h.given_at is null,
    'points',  coalesce(h.points, (select hello_points from game_config where id = 1)))
    from (select 1) one left join game_hello h on h.user_id = auth.uid();
$$;
grant execute on function public.game_hello_status() to authenticated;
revoke execute on function public.game_hello_status() from public, anon;

-- 친구 고를 때: 받을 예정인 가입인사 보너스도 지급 (stage27 의 game_join + 지급 한 줄)
create or replace function public.game_join(p_character text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare got bigint;
begin
  if not game_allowed() then return jsonb_build_object('ok', false, 'msg', '아직 열리지 않았어요'); end if;
  insert into game_players (user_id, animal, points)
  values (auth.uid(), p_character, (select start_points from game_config where id = 1))
  on conflict (user_id) do update set animal = excluded.animal;
  got := game_hello_pay(auth.uid());
  return jsonb_build_object('ok', true, 'hello', got);
end;
$$;
grant execute on function public.game_join(text) to authenticated;
revoke execute on function public.game_join(text) from anon;

-- 오픈 공지 (가입인사 게시판 고정글)
insert into public.posts (board, user_id, author, title, body, pinned, auto_key)
select 'hello', (select id from public.profiles where role = 'admin' order by joined_at limit 1), 'AI 신호등',
       '[공지] 👋 가입인사 남기고 모의투자 50,000P 받아 가세요!',
$body$안녕하세요, AI 신호등 운영자입니다 🚦
가입해 주셔서 정말 반가워요!

━━━━━━━━━━━━━━━━
🎁 가입인사 이벤트
이 게시판에 가입인사를 남기면 '신호등 친구들 모의투자' 50,000P를 드려요.
· 10자 이상으로 써 주세요 (예: 어떤 시장을 보는지, AI 신호등을 어떻게 알게 됐는지)
· 계정당 한 번만 받을 수 있어요
· 아직 모의투자 친구를 안 골랐다면, 친구를 고르는 순간 들어가요

━━━━━━━━━━━━━━━━
💬 이런 이야기 환영해요
· 주로 보는 시장 (코인·나스닥·코스피)
· 투자 경력이나 관심 종목
· AI 신호등에 바라는 점

※ 포인트는 게임 안에서만 쓰이며 현금·결제에 쓸 수 없어요.$body$, true, 'notice-hello-open'
on conflict (auto_key) do nothing;

select id, board, title, author, pinned from public.posts where board = 'hello' order by id desc limit 3;
