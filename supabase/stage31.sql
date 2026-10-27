-- AI 범돌이 전용 계정으로 바꾸기 — stage30 다음, 여러 번 실행해도 안전
--   준비: 사이트에서 닉네임 'AI범돌이' 로 새 계정을 가입해 둔다 (운영자 계정과 별개 · 이메일은 아무거나 받을 수 있는 주소)
--   · 자동 투자(쇼츠 1위)는 이제 이 계정으로 걸림. 운영자 계정은 사람이 직접 하는 플레이로 비교용
--   · 캐릭터: 호랑이(범돌이) · 시작 100,000P · 순위표에 닉네임 'AI범돌이' 공개

do $$
declare bot uuid;
begin
  select id into bot from public.profiles where nickname = 'AI범돌이';
  if bot is null then raise exception '닉네임 AI범돌이 계정이 없어요. 사이트에서 먼저 가입해 주세요'; end if;
  insert into public.game_players (user_id, animal, points, show_name)
  values (bot, 'tiger', (select start_points from public.game_config where id = 1), true)
  on conflict (user_id) do update set animal = 'tiger', show_name = true;
  update public.game_config set bot_user = bot where id = 1;
end $$;

-- 확인
select p.nickname as 범돌이_계정, gp.animal, gp.level, gp.points, gp.show_name
  from public.game_config c join public.profiles p on p.id = c.bot_user join public.game_players gp on gp.user_id = c.bot_user where c.id = 1;
