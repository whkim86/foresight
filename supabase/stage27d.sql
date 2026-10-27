-- 신호등 친구들 전체 공개 (2026-10-29): 로그인한 회원 모두 모의투자 사용
update public.game_config set open_all = true where id = 1;
select open_all from public.game_config where id = 1;
