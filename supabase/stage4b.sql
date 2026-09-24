-- 예측 포털 4-2단계: 예측 CSV 를 이용권이 있는 회원에게만 내려주기
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)

-- 이 회원이 해당 시장 탭을 볼 수 있는지: 운영자 / 가입 7일 무료체험 / 탭 이용권 유효
-- (화면 쪽 assets/app.js access() 와 같은 규칙)
create or replace function public.has_tab(p_market text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
     where p.id = auth.uid()
       and (p.role = 'admin'
            or now() < p.joined_at + interval '7 days'
            or case p_market when 'coin'   then p.coin_until
                             when 'nasdaq' then p.nasdaq_until
                             when 'kospi'  then p.kospi_until end > now())
  );
$$;

-- forecasts 버킷: 경로 첫 폴더(coin/nasdaq/kospi)의 이용권이 있어야 읽기 가능. 쓰기는 수집 스크립트(service_role)만
drop policy if exists "이용권 있는 탭의 예측 데이터 읽기" on storage.objects;
create policy "이용권 있는 탭의 예측 데이터 읽기" on storage.objects
  for select to authenticated
  using (bucket_id = 'forecasts' and public.has_tab((storage.foldername(name))[1]));
