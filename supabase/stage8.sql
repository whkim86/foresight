-- AI 신호등 8단계: 프리미엄 'AI 해설' (BTC 아래 질문칸)
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
--
-- 이용: 운영자 + 운영자가 'AI 만료일'을 넣어준 회원만. 1인 하루 20개.
-- 질문·답변은 운영자 확인용으로 기록 (회원 본인도 자기 기록만 볼 수 있음)

-- ---------- 1. AI 해설 이용권 ----------
alter table public.profiles add column if not exists ai_until timestamptz;

create or replace function public.has_ai()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and (role = 'admin' or ai_until > now()));
$$;

-- 운영자 화면에서 'ai' 만료일도 고칠 수 있게 (기존 함수 확장)
create or replace function public.admin_set_until(p_user uuid, p_tab text, p_until timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '운영자만 할 수 있어요'; end if;
  if p_tab not in ('coin', 'nasdaq', 'kospi', 'ai') then raise exception '알 수 없는 탭이에요'; end if;
  execute format('update profiles set %I = $1 where id = $2', p_tab || '_until') using p_until, p_user;
end;
$$;

-- ---------- 2. 하루 사용량 ----------
create table if not exists public.ai_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day     date not null,
  count   int  not null default 0,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
drop policy if exists "본인 사용량 조회" on public.ai_usage;
create policy "본인 사용량 조회" on public.ai_usage for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- 화면용: 이용 가능 여부와 오늘 남은 질문 수 (한국 날짜 기준)
create or replace function public.ai_status()
returns table (allowed boolean, used int, daily_limit int)
language sql stable security definer set search_path = public as $$
  select public.has_ai(),
         coalesce((select count from ai_usage where user_id = auth.uid()
                    and day = (now() at time zone 'Asia/Seoul')::date), 0),
         20;
$$;

-- 서버(Edge Function)용: 한도 안이면 1 올리고 true
create or replace function public.ai_take_quota(p_user uuid, p_limit int)
returns boolean language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into ai_usage (user_id, day, count)
  values (p_user, (now() at time zone 'Asia/Seoul')::date, 1)
  on conflict (user_id, day) do update set count = ai_usage.count + 1
  where ai_usage.count < p_limit
  returning count into v;
  return v is not null;
end;
$$;
-- 서버(Edge Function)용: AI 호출이 실패했을 때 1 되돌림
create or replace function public.ai_refund_quota(p_user uuid)
returns void language sql security definer set search_path = public as $$
  update ai_usage set count = greatest(0, count - 1)
   where user_id = p_user and day = (now() at time zone 'Asia/Seoul')::date;
$$;

revoke execute on function public.ai_take_quota(uuid, int) from public, anon, authenticated;
revoke execute on function public.ai_refund_quota(uuid) from public, anon, authenticated;

-- ---------- 3. 질문·답변 기록 ----------
create table if not exists public.ai_logs (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles(id) on delete set null,
  market     text not null,
  symbol     text not null,
  question   text not null,
  answer     text,
  input_tokens  int,
  output_tokens int,
  created_at timestamptz not null default now()
);
alter table public.ai_logs enable row level security;
drop policy if exists "본인·운영자 조회" on public.ai_logs;
create policy "본인·운영자 조회" on public.ai_logs for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
