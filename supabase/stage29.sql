-- 범돌이 투자일기 (운영자 캐릭터 자동 투자 + 매일 21시 영상용 데이터) — stage28 다음, 여러 번 실행해도 안전
--   · 쇼츠를 만드는 PC(auto/game_bot.py)가 각 시장(업비트·코스피·나스닥) 쇼츠 1위 종목에 bot_amount(20,000P)씩 자동으로 걸음
--   · PC 는 로그인 없이 비밀 키로만 부름. DB 에는 키의 SHA-256 값만 저장 (키 원문은 그 PC 의 auto/.game_bot_key 에만 있음)
--   · 걸리는 계정 = 운영자(role = 'admin') 계정의 캐릭터 (아래 bot_user)

create extension if not exists pgcrypto with schema extensions;

alter table public.game_config
  add column if not exists bot_user uuid references public.profiles(id),
  add column if not exists bot_key_hash text,
  add column if not exists bot_amount bigint not null default 20000;

update public.game_config
   set bot_key_hash = 'b5e269299b656ebbed2f865a660cabdb1d0afa1d2bae2bd1c7f5418c01282cb9',
       bot_user = coalesce(bot_user, (select id from public.profiles where role = 'admin' order by joined_at limit 1))
 where id = 1;

create or replace function public.game_bot_ok(p_key text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select bot_key_hash from game_config where id = 1) = encode(extensions.digest(convert_to(coalesce(p_key, ''), 'UTF8'), 'sha256'), 'hex'), false);
$$;
revoke execute on function public.game_bot_ok(text) from public, anon, authenticated;

-- 자동 투자: p_d1 = 쇼츠의 D+1 날짜 (DB 에 그날 예측이 아직 없으면 'not_ready' → PC 가 5분 뒤 다시 시도)
create or replace function public.game_bot_bet(p_key text, p_market text, p_symbol text, p_d1 date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c game_config; me game_players; p predictions; tm record; amt bigint; today date := (now() at time zone 'Asia/Seoul')::date; cnt int;
begin
  if not game_bot_ok(p_key) then return jsonb_build_object('ok', false, 'code', 'key'); end if;
  select * into c from game_config where id = 1;
  select * into me from game_players where user_id = c.bot_user for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'no_player', 'msg', '운영자 계정에 캐릭터가 없어요'); end if;
  select * into p from predictions where market = p_market and symbol = p_symbol and d1_date = p_d1 order by pred_date desc limit 1;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_ready', 'msg', 'DB 에 아직 그날 예측이 없어요'); end if;
  if p.verdict not in ('up','mx','dn') or coalesce(p.base_close, 0) <= 0 then return jsonb_build_object('ok', false, 'code', 'bad_pred'); end if;
  select * into tm from game_times(p_market, p.d1_date);
  if now() >= tm.cutoff_at then return jsonb_build_object('ok', false, 'code', 'closed', 'msg', '이미 마감됐어요'); end if;
  if exists (select 1 from game_bets where user_id = me.user_id and market = p_market and symbol = p_symbol and pred_date = p.pred_date and status <> 'void') then
    return jsonb_build_object('ok', true, 'code', 'already'); end if;
  select count(*) into cnt from game_bets where user_id = me.user_id and bet_day = today and status <> 'void';
  if cnt >= 5 then return jsonb_build_object('ok', false, 'code', 'limit'); end if;
  if me.broke_at is not null then return jsonb_build_object('ok', false, 'code', 'broke'); end if;
  amt := least(c.bot_amount, floor(me.points / 2 / 1000) * 1000);
  if amt < 1000 then return jsonb_build_object('ok', false, 'code', 'no_points'); end if;
  insert into game_bets (user_id, market, symbol, pred_date, d1_date, amount, base_close, verdict, cutoff_at, close_at)
  values (me.user_id, p_market, p_symbol, p.pred_date, p.d1_date, amt, p.base_close, p.verdict, tm.cutoff_at, tm.close_at);
  update game_players
     set points = points - amt,
         exp = exp + case when last_play is distinct from today then 3 else 0 end,
         level = game_level(exp + case when last_play is distinct from today then 3 else 0 end),
         last_play = today
   where user_id = me.user_id;
  return jsonb_build_object('ok', true, 'code', 'bet', 'amount', amt);
end;
$$;
revoke execute on function public.game_bot_bet(text, text, text, date) from public, authenticated;
grant execute on function public.game_bot_bet(text, text, text, date) to anon;

-- 영상용 데이터: 범돌이 상태 + 최근 30시간 안에 지급된 결과 + 지금 진행 중인 투자 (종목별 상승 예측 모델 수·AI 예상 포함)
create or replace function public.game_bot_diary(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c game_config; me game_players;
begin
  if not game_bot_ok(p_key) then return jsonb_build_object('ok', false, 'code', 'key'); end if;
  select * into c from game_config where id = 1;
  perform game_settle();
  select * into me from game_players where user_id = c.bot_user;
  if not found then return jsonb_build_object('ok', false, 'code', 'no_player'); end if;
  return jsonb_build_object('ok', true,
    'character', me.animal, 'level', me.level, 'exp', me.exp, 'level_floor', game_level_floor(me.level),
    'level_next', case when me.level >= 30 then null else game_level_floor(me.level + 1) end,
    'hat', me.hat, 'outfit', me.outfit, 'shoes', me.shoes, 'points', me.points,
    'invested', (select coalesce(sum(amount), 0) from game_bets where user_id = me.user_id and status in ('open','review')),
    'total_ret', game_total_ret(me.user_id),
    'days', (select count(distinct bet_day) from game_bets where user_id = me.user_id and status <> 'void'),
    'results', coalesce((select jsonb_agg(jsonb_build_object('market', market, 'symbol', symbol, 'amount', amount, 'ret', ret, 'payout', payout,
                         'exp', exp_delta, 'd1', d1_date) order by market) from game_bets
                         where user_id = me.user_id and status = 'settled' and settle_at >= now() - interval '30 hours'), '[]'::jsonb),
    'open', coalesce((select jsonb_agg(jsonb_build_object('market', g.market, 'symbol', g.symbol, 'amount', g.amount, 'd1', g.d1_date,
                       'cutoff', g.cutoff_at, 'close', g.close_at, 'verdict', g.verdict, 'up_n', p.up_n, 'n_models', p.n_models, 'med1', p.med1) order by g.market)
                       from game_bets g left join predictions p on p.market = g.market and p.symbol = g.symbol and p.pred_date = g.pred_date
                      where g.user_id = me.user_id and g.status in ('open','review')), '[]'::jsonb));
end;
$$;
revoke execute on function public.game_bot_diary(text) from public, authenticated;
grant execute on function public.game_bot_diary(text) to anon;

-- 확인: 범돌이로 쓰일 운영자 계정 (닉네임이 맞는지 보세요)
select p.nickname as 범돌이_계정, gp.animal, gp.level, gp.points
  from public.game_config c join public.profiles p on p.id = c.bot_user left join public.game_players gp on gp.user_id = c.bot_user where c.id = 1;
