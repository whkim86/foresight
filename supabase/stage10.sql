-- AI 신호등 10단계: 예측 모델별 성적 (운영자 전용, 요약만 저장)
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
--
-- 수집 스크립트가 새 실제 종가를 받을 때마다, 7일 백업 CSV 의 모델별 예측을 실제와 비교해
-- (시장 · 모델 · D+n · 예측일 · 대상일) 단위로 집계한 숫자만 저장. 종목별 원본은 저장하지 않음.

create table if not exists public.model_scores (
  market       text not null,
  model        text not null,          -- R 원래 이름 (Pred1 …). 화면에서 config.js MODEL_LABELS 로 '모델 A' 표시
  horizon      int  not null check (horizon between 1 and 6),
  pred_date    date not null,          -- 예측 수행일
  target_date  date not null,          -- 예측 대상일 (이 날 실제 종가와 비교)
  n            int  not null,          -- 비교한 종목 수
  dir_n        int  not null,          -- 방향을 판단할 수 있었던 종목 수 (예측·실제가 기준가와 같으면 제외)
  dir_hit      int  not null,          -- 오름/내림 방향이 맞은 종목 수
  abs_err_sum  double precision not null,  -- |예측 종가 − 실제 종가| ÷ 실제 종가 의 합 (평균 오차 = abs_err_sum / n)
  updated_at   timestamptz not null default now(),
  primary key (market, model, horizon, pred_date, target_date)
);
create index if not exists model_scores_target_idx on public.model_scores (market, target_date);

alter table public.model_scores enable row level security;
drop policy if exists "운영자 조회" on public.model_scores;
create policy "운영자 조회" on public.model_scores for select to authenticated using (public.is_admin());

-- 운영자 화면용: 시장·기간(대상일 기준 최근 p_days 일)별 모델 × D+n 성적
create or replace function public.model_accuracy(p_market text, p_days int default 30)
returns table (model text, horizon int, days int, n bigint, dir_n bigint, dir_hit bigint, mape double precision)
language sql stable security definer set search_path = public as $$
  select model, horizon, count(distinct target_date)::int, sum(n), sum(dir_n), sum(dir_hit),
         sum(abs_err_sum) / nullif(sum(n), 0)
    from model_scores
   where public.is_admin() and market = p_market
     and target_date >= (now() at time zone 'Asia/Seoul')::date - p_days
   group by model, horizon
   order by model, horizon;
$$;
