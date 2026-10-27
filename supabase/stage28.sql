-- 신호등 친구들 2단계 (2-A 꾸미기 · 2-B 보이는 곳 · 보너스 포인트 · 닉네임 공개 선택) — stage27d 다음, 여러 번 실행해도 안전
--   꾸미기: 모자·옷·신발을 레벨로 잠금 해제 (game-chars.js 의 HAT/OUT/SHO 와 같은 레벨)
--   보너스: 하루 한 번씩 출석 / 가격차트·우선순위 보기 / 게시판 글쓰기(20자 이상) → 각 bonus_points(1,000P)
--           받은 보너스는 granted(받은 포인트 합계)에도 더함 → 총 수익률엔 영향 없음
--   닉네임: show_name 을 켠 친구만 순위표(·영상)에 닉네임, 끄면 '익명 호랑이 #123'

alter table public.game_config add column if not exists bonus_points bigint not null default 1000;

alter table public.game_players
  add column if not exists hat       text not null default 'cap',
  add column if not exists outfit    text not null default 'tee',
  add column if not exists shoes     text not null default 'sneakers',
  add column if not exists show_name boolean not null default false;

-- ---------- 꾸미기 ----------
create or replace function public.game_item_lv(p_kind text, p_id text)
returns int language sql immutable as $$
  select case p_kind
    when 'hat'    then case p_id when 'none' then 1 when 'cap' then 1 when 'beanie' then 3 when 'party' then 5 when 'helmet' then 10 when 'tophat' then 20 when 'crown' then 30 end
    when 'outfit' then case p_id when 'none' then 1 when 'tee' then 1 when 'hoodie' then 5 when 'hanbok' then 10 when 'suit' then 15 when 'cape' then 25 end
    when 'shoes'  then case p_id when 'none' then 1 when 'sneakers' then 1 when 'boots' then 7 when 'loafers' then 15 when 'gold' then 28 end
  end;
$$;

create or replace function public.game_dress(p_hat text, p_outfit text, p_shoes text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me game_players;
begin
  if not game_allowed() then return jsonb_build_object('ok', false, 'msg', '아직 열리지 않았어요'); end if;
  select * into me from game_players where user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'msg', '먼저 캐릭터를 골라 주세요'); end if;
  if game_item_lv('hat', p_hat) is null or game_item_lv('outfit', p_outfit) is null or game_item_lv('shoes', p_shoes) is null then
    return jsonb_build_object('ok', false, 'msg', '없는 아이템이에요'); end if;
  if greatest(game_item_lv('hat', p_hat), game_item_lv('outfit', p_outfit), game_item_lv('shoes', p_shoes)) > me.level then
    return jsonb_build_object('ok', false, 'msg', '아직 잠긴 아이템이 있어요'); end if;
  update game_players set hat = p_hat, outfit = p_outfit, shoes = p_shoes where user_id = me.user_id;
  return jsonb_build_object('ok', true);
end;
$$;
grant execute on function public.game_dress(text, text, text) to authenticated;
revoke execute on function public.game_dress(text, text, text) from anon;

-- ---------- 닉네임 공개 선택 ----------
create or replace function public.game_show_name(p_on boolean)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update game_players set show_name = coalesce(p_on, false) where user_id = auth.uid();
  return coalesce(p_on, false);
end;
$$;
grant execute on function public.game_show_name(boolean) to authenticated;
revoke execute on function public.game_show_name(boolean) from anon;

create or replace function public.game_animal_ko(a text)
returns text language sql immutable as $$
  select case a when 'rat' then '쥐' when 'ox' then '소' when 'tiger' then '호랑이' when 'rabbit' then '토끼' when 'dragon' then '용'
    when 'snake' then '뱀' when 'horse' then '말' when 'sheep' then '양' when 'monkey' then '원숭이' when 'rooster' then '닭'
    when 'dog' then '강아지' when 'pig' then '돼지' else '친구' end;
$$;
-- 순위표·영상에 보일 이름
create or replace function public.game_display_name(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select case when gp.show_name then coalesce(pr.nickname, '익명')
              else '익명 ' || game_animal_ko(gp.animal) || ' #' || lpad((abs(hashtext(gp.user_id::text)) % 1000)::text, 3, '0') end
    from game_players gp left join profiles pr on pr.id = gp.user_id where gp.user_id = p_user;
$$;
revoke execute on function public.game_display_name(uuid) from public, anon;

-- ---------- 보너스 포인트 ----------
create table if not exists public.game_bonus_log (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  day        date not null,
  kind       text not null check (kind in ('login','chart','post')),
  points     bigint not null,
  created_at timestamptz not null default now(),
  primary key (user_id, day, kind)
);
alter table public.game_bonus_log enable row level security;
drop policy if exists "본인 조회" on public.game_bonus_log;
create policy "본인 조회" on public.game_bonus_log for select to authenticated using (user_id = auth.uid());
grant select on public.game_bonus_log to authenticated;
grant all on public.game_bonus_log to service_role;

-- 내부용: 오늘 그 보너스를 아직 안 받았으면 지급 → 지급한 포인트 (이미 받았으면 0)
create or replace function public.game_give_bonus(p_user uuid, p_kind text)
returns bigint language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Seoul')::date; pts bigint; n int;
begin
  if not exists (select 1 from game_players where user_id = p_user) then return 0; end if;
  select bonus_points into pts from game_config where id = 1;
  insert into game_bonus_log (user_id, day, kind, points) values (p_user, today, p_kind, pts) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return 0; end if;
  update game_players set points = points + pts, granted = granted + pts where user_id = p_user;
  return pts;
end;
$$;
revoke execute on function public.game_give_bonus(uuid, text) from public, anon, authenticated;

-- 화면에서 부름: 'chart' (대시보드 보드를 열었을 때) / 'post' (글 쓴 뒤 — 오늘 쓴 20자 이상 공개 글이 있어야 함)
create or replace function public.game_bonus(p_kind text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare today date := (now() at time zone 'Asia/Seoul')::date; got bigint;
begin
  if not game_allowed() or p_kind not in ('chart', 'post') then return jsonb_build_object('ok', false, 'given', 0); end if;
  if p_kind = 'post' and not exists (
      select 1 from posts where user_id = auth.uid() and board <> 'payment' and char_length(body) >= 20
         and (created_at at time zone 'Asia/Seoul')::date = today) then
    return jsonb_build_object('ok', false, 'given', 0, 'msg', '오늘 20자 이상 쓴 글이 있어야 받을 수 있어요');
  end if;
  got := game_give_bonus(auth.uid(), p_kind);
  return jsonb_build_object('ok', true, 'given', got);
end;
$$;
grant execute on function public.game_bonus(text) to authenticated;
revoke execute on function public.game_bonus(text) from anon;

create or replace function public.game_missions(p_user uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'login', exists (select 1 from game_bonus_log where user_id = p_user and day = (now() at time zone 'Asia/Seoul')::date and kind = 'login'),
    'chart', exists (select 1 from game_bonus_log where user_id = p_user and day = (now() at time zone 'Asia/Seoul')::date and kind = 'chart'),
    'post',  exists (select 1 from game_bonus_log where user_id = p_user and day = (now() at time zone 'Asia/Seoul')::date and kind = 'post'),
    'points', (select bonus_points from game_config where id = 1));
$$;
revoke execute on function public.game_missions(uuid) from public, anon;

-- ---------- 가벼운 내 친구 카드 (상단 메뉴 · 홈 · 마이페이지) — 부를 때 출석 보너스도 지급 ----------
create or replace function public.game_card()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me game_players; bonus bigint := 0; y record; cut timestamptz;
begin
  if not game_allowed() then return jsonb_build_object('allowed', false); end if;
  if not exists (select 1 from game_players where user_id = auth.uid()) then return jsonb_build_object('allowed', true, 'joined', false); end if;
  perform game_settle();
  bonus := game_give_bonus(auth.uid(), 'login');
  select * into me from game_players where user_id = auth.uid();
  -- 최근 24시간 안에 지급된 정산
  select count(*) n, coalesce(sum(payout - amount), 0) profit, sum(payout - amount)::double precision / nullif(sum(amount), 0) ret into y
    from game_bets where user_id = me.user_id and status = 'settled' and settle_at >= now() - interval '24 hours';
  -- 지금 걸 수 있는 시장 중 가장 가까운 마감
  select min(t.cutoff_at) into cut
    from (select distinct on (market) market, d1_date from predictions where d1_date is not null order by market, pred_date desc) x
    cross join lateral game_times(x.market, x.d1_date) t where t.cutoff_at > now();
  return jsonb_build_object(
    'allowed', true, 'joined', true, 'character', me.animal, 'level', me.level, 'exp', me.exp,
    'level_floor', game_level_floor(me.level), 'level_next', case when me.level >= 30 then null else game_level_floor(me.level + 1) end,
    'hat', me.hat, 'outfit', me.outfit, 'shoes', me.shoes, 'show_name', me.show_name,
    'points', me.points, 'invested', (select coalesce(sum(amount), 0) from game_bets where user_id = me.user_id and status in ('open','review')),
    'total_ret', game_total_ret(me.user_id), 'broke', me.broke_at is not null,
    'today_left', 5 - (select count(*) from game_bets where user_id = me.user_id and bet_day = (now() at time zone 'Asia/Seoul')::date and status <> 'void'),
    'recent', jsonb_build_object('n', y.n, 'profit', y.profit, 'ret', y.ret),
    'next_cutoff', cut, 'bonus_now', bonus, 'missions', game_missions(me.user_id));
end;
$$;
grant execute on function public.game_card() to authenticated;
revoke execute on function public.game_card() from anon;

-- ---------- 내 정보: 꾸미기 · 닉네임 공개 · 오늘의 미션 추가 (stage27c 와 같고 끝에 필드만 더함) ----------
create or replace function public.game_my()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me game_players; today date := (now() at time zone 'Asia/Seoul')::date; d int;
begin
  if not game_allowed() then return jsonb_build_object('allowed', false); end if;
  perform game_settle();
  perform game_revive();
  select * into me from game_players where user_id = auth.uid();
  if not found then return jsonb_build_object('allowed', true, 'joined', false); end if;
  select revive_days into d from game_config where id = 1;
  return jsonb_build_object(
    'allowed', true, 'joined', true,
    'nickname', (select nickname from profiles where id = me.user_id),
    'character', me.animal, 'points', me.points, 'exp', me.exp, 'level', me.level,
    'level_floor', game_level_floor(me.level), 'level_next', case when me.level >= 30 then null else game_level_floor(me.level + 1) end,
    'today_left', 5 - (select count(*) from game_bets where user_id = me.user_id and bet_day = today and status <> 'void'),
    'invested', (select coalesce(sum(amount), 0) from game_bets where user_id = me.user_id and status in ('open','review')),
    'granted', me.granted, 'revives', me.revives, 'total_ret', game_total_ret(me.user_id),
    'broke_at', me.broke_at, 'revive_at', me.broke_at + make_interval(days => d),
    'revive_points', (select revive_points from game_config where id = 1),
    'hat', me.hat, 'outfit', me.outfit, 'shoes', me.shoes, 'show_name', me.show_name,
    'display_name', game_display_name(me.user_id), 'missions', game_missions(me.user_id),
    'bets', coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
        select g.id, g.market, g.symbol, g.pred_date, g.d1_date, g.amount, g.base_close, g.verdict, g.close_at, g.actual_close, g.ret, g.payout, g.exp_delta, g.settle_at,
               case when g.status = 'open' and now() >= g.close_at then 'review' else g.status end as status, g.created_at,
               case when g.status = 'open' and now() < game_cancel_until(g) then game_cancel_until(g) end as cancel_until
          from game_bets g where g.user_id = me.user_id and g.status <> 'void' order by g.created_at desc limit 30) x), '[]'::jsonb));
end;
$$;

-- ---------- 순위표: 꾸민 모습 + 공개 선택한 닉네임 ----------
drop function if exists public.game_rank(text);
create or replace function public.game_rank(p_kind text default 'ret')
returns table (nickname text, animal text, level int, points bigint, week_ret double precision, total_ret double precision, revives int, broke boolean, is_me boolean,
               hat text, outfit text, shoes text)
language sql stable security definer set search_path = public as $$
  with w as (
    select user_id, sum(payout - amount)::double precision / nullif(sum(amount), 0) r
      from game_bets where status = 'settled' and created_at >= now() - interval '7 days' group by user_id),
  inv as (select user_id, sum(amount) s from game_bets where status in ('open','review') group by user_id)
  select game_display_name(gp.user_id), gp.animal, gp.level, gp.points + coalesce(inv.s, 0),
         coalesce(w.r, 0), (gp.points + coalesce(inv.s, 0) - gp.granted)::double precision / nullif(gp.granted, 0),
         gp.revives, gp.broke_at is not null, gp.user_id = auth.uid(), gp.hat, gp.outfit, gp.shoes
    from game_players gp
    left join w on w.user_id = gp.user_id left join inv on inv.user_id = gp.user_id
   where game_allowed()
   order by case p_kind
              when 'level'  then gp.level::double precision
              when 'points' then (gp.points + coalesce(inv.s, 0))::double precision
              when 'total'  then (gp.points + coalesce(inv.s, 0) - gp.granted)::double precision / nullif(gp.granted, 0)
              else coalesce(w.r, -1) end desc nulls last,
            gp.points desc
   limit 50;
$$;
grant execute on function public.game_rank(text) to authenticated;
revoke execute on function public.game_rank(text) from anon;
