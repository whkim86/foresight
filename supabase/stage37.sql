-- stage37: 카카오·구글 간편 가입 대비 — 가입 시 프로필 자동 생성 함수 보완
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run
--
-- 바뀌는 점
-- 1) 이메일 가입(닉네임 직접 입력)은 지금과 똑같음: 닉네임이 겹치면 오류 → 화면에서 '이미 사용 중인 닉네임' 안내
-- 2) 간편 가입(닉네임 입력 없음): 카카오/구글 프로필 이름 → 이메일 앞부분 → '회원' 순서로 닉네임을 정하고,
--    겹치면 뒤에 숫자 4자리를 붙여 자동으로 피함 (카카오는 이메일을 안 줄 수도 있어서 이메일이 비어도 가입되게)
-- 새 테이블이 없어서 grant 는 필요 없음

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  typed text := nullif(trim(new.raw_user_meta_data->>'nickname'), '');
  base  text;
  nick  text;
  i     int := 0;
begin
  if typed is not null then
    insert into public.profiles (id, nickname, email) values (new.id, typed, new.email);
    return new;
  end if;

  base := left(coalesce(
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'user_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'preferred_username'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    '회원'), 14);
  nick := base;
  while exists (select 1 from public.profiles where nickname = nick) and i < 30 loop
    nick := base || lpad((floor(random() * 10000))::int::text, 4, '0');
    i := i + 1;
  end loop;

  insert into public.profiles (id, nickname, email) values (new.id, nick, new.email);
  return new;
end;
$$;
