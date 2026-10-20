-- AI 신호등 26단계: 쿠폰 — 'AI신호등' 입력하면 코인·나스닥·코스피 중 1개 시장 3개월 무료 (선착순 50명, 계정당 1번)
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
-- 회원은 마이페이지의 쿠폰 칸에서 씀 (mypage.html → redeem_coupon). 운영자는 아래 '확인용' 쿼리로 사용 현황을 봄

-- ---------- 1. 쿠폰 · 사용 기록 ----------
create table if not exists public.coupons (
  code       text primary key,          -- 비교용 코드: 띄어쓰기 없이 대문자 (예: AI신호등)
  label      text not null,             -- 화면에 보이는 이름
  max_uses   int  not null,             -- 선착순 인원
  used       int  not null default 0,
  months     int  not null,             -- 무료 기간(개월)
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.coupon_redemptions (
  code        text not null references public.coupons(code),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  market      text not null check (market in ('coin', 'nasdaq', 'kospi')),
  until_after timestamptz not null,     -- 쿠폰 적용 뒤 만료일
  redeemed_at timestamptz not null default now(),
  primary key (code, user_id)           -- 계정당 1번
);
alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
drop policy if exists "운영자 조회" on public.coupons;
create policy "운영자 조회" on public.coupons for select to authenticated using (public.is_admin());
drop policy if exists "본인·운영자 조회" on public.coupon_redemptions;
create policy "본인·운영자 조회" on public.coupon_redemptions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

insert into public.coupons (code, label, max_uses, months)
values ('AI신호등', 'AI신호등', 50, 3)
on conflict (code) do nothing;

-- ---------- 2. 쿠폰 쓰기 ----------
-- p_code: 회원이 입력한 코드 (띄어쓰기·대소문자 무시), p_market: coin / nasdaq / kospi
-- 성공하면 그 시장 만료일을 (지금 또는 남아 있는 만료일 중 늦은 날) + 3개월로 늘리고 새 만료일을 돌려줌
create or replace function public.redeem_coupon(p_code text, p_market text)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  c coupons;
  k text := upper(regexp_replace(coalesce(p_code, ''), '\s', '', 'g'));
  cur timestamptz;
  new_until timestamptz;
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  if p_market not in ('coin', 'nasdaq', 'kospi') then raise exception '시장을 골라주세요'; end if;
  select * into c from coupons where code = k and active for update;  -- 동시에 여러 명이 써도 인원이 넘지 않게 잠금
  if not found then raise exception '쿠폰 코드를 다시 확인해 주세요'; end if;
  if exists (select 1 from coupon_redemptions where code = k and user_id = auth.uid()) then
    raise exception '이미 이 쿠폰을 사용했어요';
  end if;
  if c.used >= c.max_uses then raise exception '선착순 인원이 모두 마감됐어요'; end if;

  execute format('select %I from profiles where id = $1', p_market || '_until') into cur using auth.uid();
  new_until := greatest(coalesce(cur, now()), now()) + make_interval(months => c.months);
  execute format('update profiles set %I = $1 where id = $2', p_market || '_until') using new_until, auth.uid();
  insert into coupon_redemptions (code, user_id, market, until_after) values (k, auth.uid(), p_market, new_until);
  update coupons set used = used + 1 where code = k;
  return new_until;
end;
$$;
revoke execute on function public.redeem_coupon(text, text) from public, anon;
grant execute on function public.redeem_coupon(text, text) to authenticated;

-- 확인용 (운영자): 사용 인원과 사용한 회원
select code, used, max_uses, months, active from public.coupons;
select r.redeemed_at, p.nickname, r.market, r.until_after
  from public.coupon_redemptions r join public.profiles p on p.id = r.user_id
 order by r.redeemed_at desc;
