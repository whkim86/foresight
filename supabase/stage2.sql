-- 예측 포털 2단계: 무료체험 · 탭별 이용기간 · 입금 신청/승인
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)

-- ---------- 1. 탭별 이용 만료 시각 ----------
alter table public.profiles
  add column if not exists coin_until   timestamptz,
  add column if not exists nasdaq_until timestamptz,
  add column if not exists kospi_until  timestamptz;
alter table public.profiles
  drop column if exists expires_at,
  drop column if exists allowed_tabs;

-- ---------- 2. 운영자 여부 ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

drop policy if exists "운영자 전체 조회" on public.profiles;
create policy "운영자 전체 조회" on public.profiles for select using (public.is_admin());

-- ---------- 3. 가격 (1달 정가, 3/6/12달은 10/20/40% 할인 후 1,000원 단위 내림) ----------
create or replace function public.plan_price(n_tabs int, months int)
returns int language sql immutable as $$
  select case months
    when 1 then (array[4900, 8900, 12900])[n_tabs]
    else (floor((array[4900, 8900, 12900])[n_tabs] * months *
          (case months when 3 then 0.9 when 6 then 0.8 when 12 then 0.6 end) / 1000) * 1000)::int
  end;
$$;

-- ---------- 4. 입금 신청 ----------
create table if not exists public.payment_requests (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  tabs           text[] not null,
  months         int not null check (months in (1, 3, 6, 12)),
  amount         int not null,
  phone          text,
  refund_agreed  boolean not null,
  status         text not null default 'pending'
                 check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  created_at     timestamptz not null default now(),
  processed_at   timestamptz,
  admin_memo     text
);
alter table public.payment_requests enable row level security;

-- 직접 쓰기 권한은 주지 않고, 아래 함수로만 신청·취소·승인 (금액을 서버에서 계산하기 위해)
drop policy if exists "본인 신청 조회" on public.payment_requests;
create policy "본인 신청 조회" on public.payment_requests
  for select using (user_id = auth.uid() or public.is_admin());

-- 회원: 입금 신청
create or replace function public.request_payment(p_tabs text[], p_months int, p_phone text, p_agree boolean)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  v_tabs text[];
  v_id   bigint;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  select array_agg(distinct t order by t) into v_tabs
    from unnest(p_tabs) as t where t in ('coin', 'nasdaq', 'kospi');
  if v_tabs is null then raise exception '볼 탭을 하나 이상 골라주세요'; end if;
  if p_months not in (1, 3, 6, 12) then raise exception '이용 기간을 다시 골라주세요'; end if;
  if not coalesce(p_agree, false) then raise exception '환불 정책에 동의해 주세요'; end if;
  if exists (select 1 from payment_requests where user_id = auth.uid() and status = 'pending') then
    raise exception '이미 확인을 기다리는 신청이 있어요';
  end if;

  insert into payment_requests (user_id, tabs, months, amount, phone, refund_agreed)
  values (auth.uid(), v_tabs, p_months, plan_price(array_length(v_tabs, 1), p_months),
          nullif(trim(p_phone), ''), true)
  returning id into v_id;
  return v_id;
end;
$$;

-- 회원: 대기 중인 신청 취소
create or replace function public.cancel_payment(p_id bigint)
returns void language plpgsql security definer set search_path = public as $$
begin
  update payment_requests set status = 'cancelled', processed_at = now()
   where id = p_id and user_id = auth.uid() and status = 'pending';
  if not found then raise exception '취소할 수 있는 신청이 없어요'; end if;
end;
$$;

-- 운영자: 입금 확인 → 신청한 탭 기간 연장
-- 남은 기간(또는 무료체험 종료일) 뒤에 이어 붙임
create or replace function public.approve_payment(p_id bigint, p_memo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  r    payment_requests;
  p    profiles;
  t    text;
  cur  timestamptz;
  days int;
begin
  if not is_admin() then raise exception '운영자만 할 수 있어요'; end if;
  select * into r from payment_requests where id = p_id and status = 'pending' for update;
  if not found then raise exception '대기 중인 신청이 아니에요'; end if;
  select * into p from profiles where id = r.user_id for update;

  days := case r.months when 1 then 30 when 3 then 90 when 6 then 180 else 365 end;
  foreach t in array r.tabs loop
    cur := case t when 'coin' then p.coin_until when 'nasdaq' then p.nasdaq_until else p.kospi_until end;
    execute format('update profiles set %I = $1 where id = $2', t || '_until')
      using greatest(now(), p.joined_at + interval '7 days', coalesce(cur, now())) + make_interval(days => days),
            r.user_id;
  end loop;

  update payment_requests set status = 'approved', processed_at = now(), admin_memo = p_memo where id = p_id;
end;
$$;

-- 운영자: 신청 거절 (입금이 확인되지 않을 때)
create or replace function public.reject_payment(p_id bigint, p_memo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '운영자만 할 수 있어요'; end if;
  update payment_requests set status = 'rejected', processed_at = now(), admin_memo = p_memo
   where id = p_id and status = 'pending';
  if not found then raise exception '대기 중인 신청이 아니에요'; end if;
end;
$$;

-- 운영자: 탭 만료일 직접 수정 (환불·보상 등). p_until 이 null 이면 해당 탭 이용권 삭제
create or replace function public.admin_set_until(p_user uuid, p_tab text, p_until timestamptz)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception '운영자만 할 수 있어요'; end if;
  if p_tab not in ('coin', 'nasdaq', 'kospi') then raise exception '알 수 없는 탭이에요'; end if;
  execute format('update profiles set %I = $1 where id = $2', p_tab || '_until') using p_until, p_user;
end;
$$;

-- ---------- 5. 운영자 지정 ----------
update public.profiles set role = 'admin' where nickname = 'whkim86';
