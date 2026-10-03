-- AI 신호등 11단계: 모델 성적을 상승·하락·혼돈 예측으로 나눠 보기
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
--
-- 모델 하나하나의 예측을 대시보드 신호등과 같은 기준값(종목별 평소 변동폭)으로 분류:
--   상승 예측: 기준가 대비 +기준값 초과 / 하락 예측: −기준값 미만 / 혼돈: 그 사이 (방향 채점에서 제외)

alter table public.model_scores
  add column if not exists up_n   int not null default 0,   -- 상승 예측 수
  add column if not exists up_hit int not null default 0,   -- 그중 실제로 오른 수
  add column if not exists dn_n   int not null default 0,   -- 하락 예측 수
  add column if not exists dn_hit int not null default 0,   -- 그중 실제로 내린 수
  add column if not exists mx_n   int not null default 0;   -- 혼돈(약한 예측) 수

drop function if exists public.model_accuracy(text, int);
create or replace function public.model_accuracy(p_market text, p_days int default 30)
returns table (
  model text, horizon int, days int, n bigint,
  dir_n bigint, dir_hit bigint,
  up_n bigint, up_hit bigint, dn_n bigint, dn_hit bigint, mx_n bigint,
  mape double precision
) language sql stable security definer set search_path = public as $$
  select model, horizon, count(distinct target_date)::int, sum(n),
         sum(dir_n), sum(dir_hit),
         sum(up_n), sum(up_hit), sum(dn_n), sum(dn_hit), sum(mx_n),
         sum(abs_err_sum) / nullif(sum(n), 0)
    from model_scores
   where public.is_admin() and market = p_market
     and target_date >= (now() at time zone 'Asia/Seoul')::date - p_days
   group by model, horizon
   order by model, horizon;
$$;
