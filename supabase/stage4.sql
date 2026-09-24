-- 예측 포털 4-1단계: CSV 백업 · D+1 판정 기록 · 적중률 · 6일 합의도 · 수집 상태
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
-- 데이터는 GitHub Actions(ingest/ingest.py)가 service_role 키로 넣음. 회원은 읽을 수 없고 운영자만 조회.

-- ---------- 1. CSV 백업 저장소 (비공개) ----------
insert into storage.buckets (id, name, public)
values ('forecasts', 'forecasts', false)
on conflict (id) do nothing;

-- ---------- 2. 종목별 D+1 판정 (영구 보관) ----------
create table if not exists public.predictions (
  market       text not null check (market in ('coin', 'nasdaq', 'kospi')),
  symbol       text not null,
  pred_date    date not null,                  -- 예측 수행일 (CSV pred_day)
  d1_date      date,                           -- D+1 날짜
  base_date    date,                           -- 판정 기준이 된 직전 실제 종가의 날짜
  base_close   double precision,
  verdict      text not null check (verdict in ('up', 'dn', 'mx', 'hold', 'stale')),
  n_models     int,
  up_n         int,                            -- D+1 종가를 기준보다 높게 본 모델 수
  dn_n         int,
  med1         double precision,               -- D+1 종가 중앙값 변화율
  thr          double precision,               -- 상승/하락 판단 기준 변화율
  cons_up      real,                           -- 6일 합의도: 모델×6일 예측값 중 기준 종가보다 높은 비율
  cons_dn      real,                           --             기준 종가보다 낮은 비율
  actual_close double precision,               -- D+1 실제 종가 (다음 CSV 의 실제값에서 채움)
  hit          boolean,                        -- 상승·하락 판정만 채점, 혼돈 등은 null
  graded_at    timestamptz,
  created_at   timestamptz not null default now(),
  primary key (market, symbol, pred_date)
);
create index if not exists predictions_ungraded_idx on public.predictions (market, d1_date) where graded_at is null;

alter table public.predictions enable row level security;
drop policy if exists "운영자 조회" on public.predictions;
create policy "운영자 조회" on public.predictions for select to authenticated using (public.is_admin());

-- ---------- 3. 수집 기록 (성공 · 미수신 · 오류) ----------
create table if not exists public.ingest_log (
  id           bigint generated always as identity primary key,
  market       text not null,
  kind         text not null,                  -- priority(우선순위 CSV) / chart(가격 차트 CSV) / check(미수신 점검)
  status       text not null check (status in ('ok', 'missing', 'error')),
  pred_date    date,
  content_hash text,
  row_count    int,
  message      text,
  created_at   timestamptz not null default now()
);
create index if not exists ingest_log_idx on public.ingest_log (market, kind, created_at desc);

alter table public.ingest_log enable row level security;
drop policy if exists "운영자 조회" on public.ingest_log;
create policy "운영자 조회" on public.ingest_log for select to authenticated using (public.is_admin());

-- ---------- 4. 채점: 실제 종가 목록을 받아 아직 채점 안 된 예측에 반영 ----------
-- p_actuals: [{"s": 종목, "d": "2026-09-24", "c": 종가}, ...]
create or replace function public.grade_predictions(p_market text, p_actuals jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update predictions p
     set actual_close = a.c,
         hit = case p.verdict when 'up' then a.c > p.base_close
                              when 'dn' then a.c < p.base_close end,
         graded_at = now()
    from jsonb_to_recordset(p_actuals) as a(s text, d date, c double precision)
   where p.market = p_market and p.symbol = a.s and p.d1_date = a.d and p.graded_at is null;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.grade_predictions(text, jsonb) from public, anon, authenticated;

-- ---------- 5. 운영자 화면용 적중률 집계 (날짜·시장별) ----------
-- 확신 높음: D+1 판정과 같은 방향의 6일 합의도가 0.8 이상
create or replace function public.accuracy_stats(p_days int default 30)
returns table (
  market text, pred_date date,
  up_n int, up_hit int, dn_n int, dn_hit int, mx_n int, pending int,
  hc_n int, hc_hit int
) language sql stable security definer set search_path = public as $$
  select market, pred_date,
         count(*) filter (where verdict = 'up' and hit is not null)::int,
         count(*) filter (where verdict = 'up' and hit)::int,
         count(*) filter (where verdict = 'dn' and hit is not null)::int,
         count(*) filter (where verdict = 'dn' and hit)::int,
         count(*) filter (where verdict in ('mx', 'hold', 'stale'))::int,
         count(*) filter (where verdict in ('up', 'dn') and graded_at is null)::int,
         count(*) filter (where hit is not null and ((verdict = 'up' and cons_up >= 0.8) or (verdict = 'dn' and cons_dn >= 0.8)))::int,
         count(*) filter (where hit and ((verdict = 'up' and cons_up >= 0.8) or (verdict = 'dn' and cons_dn >= 0.8)))::int
    from predictions
   where public.is_admin() and pred_date >= current_date - p_days
   group by market, pred_date
   order by pred_date desc, market;
$$;
