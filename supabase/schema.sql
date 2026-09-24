-- 예측 포털 1단계 DB 설정
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run

-- 회원 프로필 (가입하면 자동 생성)
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  nickname     text not null unique,
  email        text,
  role         text not null default 'member' check (role in ('member', 'admin')),
  joined_at    timestamptz not null default now(),
  -- 아래 세 항목은 2단계(결제 상태 관리)에서 사용
  expires_at   date,
  allowed_tabs text[] not null default '{}',
  memo         text
);

alter table public.profiles enable row level security;

-- 회원은 자기 프로필만 읽을 수 있음. 수정 권한은 주지 않음(만료일을 스스로 바꾸지 못하게)
drop policy if exists "본인 프로필 조회" on public.profiles;
create policy "본인 프로필 조회" on public.profiles
  for select using (auth.uid() = id);

-- 가입 시 닉네임과 함께 프로필 행 자동 생성
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, nickname, email)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data->>'nickname'), ''), split_part(new.email, '@', 1)),
    new.email
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
