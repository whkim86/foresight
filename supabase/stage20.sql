-- AI 신호등 20단계: AI 패턴해석 — 종목별 패턴 신호를 저장하고 D+1·D+3·D+6 실제 종가로 채점
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
-- 패턴 신호는 GitHub Actions(ingest/ingest.py 의 PATTERNS)가 매일 넣음. 성적은 운영자만 '패턴해석' 탭에서 봄
--   p1_60 / p1_70 : 패턴해석 #1 · 6일 흐름 — 모델×D+1~D+6 예측값 중 직전 종가보다 아래(위)인 비율이 60% / 70% 이상이면 하락(상승) 기운
--   회원 화면에는 70% 기준만 주석으로 보여줌

-- ---------- 1. 예측 기록에 D+3·D+6 날짜와 실제 종가, 패턴 신호 칸 추가 ----------
alter table public.predictions
  add column if not exists d3_date  date,
  add column if not exists d6_date  date,
  add column if not exists actual3  double precision,   -- D+3 실제 종가
  add column if not exists actual6  double precision,   -- D+6 실제 종가
  add column if not exists patterns jsonb;              -- {"p1_60": "dn", "p1_70": "none", ...}  (up / dn / none)

-- ---------- 2. D+3·D+6 채점: 실제 종가 목록을 받아 비어 있는 칸만 채움 (D+1 은 grade_predictions) ----------
-- p_actuals: [{"s": 종목, "d": "2026-10-18", "c": 종가}, ...]
create or replace function public.grade_horizons(p_market text, p_actuals jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n3 int; n6 int;
begin
  update predictions p set actual3 = a.c
    from jsonb_to_recordset(p_actuals) as a(s text, d date, c double precision)
   where p.market = p_market and p.symbol = a.s and p.d3_date = a.d and p.actual3 is null;
  get diagnostics n3 = row_count;
  update predictions p set actual6 = a.c
    from jsonb_to_recordset(p_actuals) as a(s text, d date, c double precision)
   where p.market = p_market and p.symbol = a.s and p.d6_date = a.d and p.actual6 is null;
  get diagnostics n6 = row_count;
  return n3 + n6;
end;
$$;
revoke execute on function public.grade_horizons(text, jsonb) from public, anon, authenticated;

-- ---------- 3. 소급: 지난 예측 기록에 D+3·D+6 날짜와 패턴 신호만 채움 (판정·채점 결과는 건드리지 않음) ----------
-- p_rows: [{"symbol": .., "pred_date": .., "d3_date": .., "d6_date": .., "patterns": {..}}, ...]
create or replace function public.set_pattern_info(p_market text, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update predictions p
     set d3_date = r.d3_date, d6_date = r.d6_date, patterns = r.patterns
    from jsonb_to_recordset(p_rows) as r(symbol text, pred_date date, d3_date date, d6_date date, patterns jsonb)
   where p.market = p_market and p.symbol = r.symbol and p.pred_date = r.pred_date;
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.set_pattern_info(text, jsonb) from public, anon, authenticated;

-- ---------- 4. 운영자 화면용 패턴 성적 (날짜·시장·패턴·기간·신호별 합계) ----------
-- pattern = 'verdict' 는 지금의 D+1 판정(상승·하락), '_all' 은 같은 날 채점된 전체 종목(비교 기준선, hit = 실제로 내린 수)
-- hit: 상승 신호는 실제 종가 > 기준 종가, 하락 신호는 실제 종가 < 기준 종가. 실제 종가가 기준과 같으면 제외
-- ret: (실제 종가 / 기준 종가 - 1) 합계 → 평균 등락률 계산용
create or replace function public.pattern_stats(p_days int default 35)
returns table (market text, pattern text, pred_date date, horizon int, signal text, n int, hit int, ret double precision)
language sql stable security definer set search_path = public as $$
  with h as (
    select p.market, p.pred_date, p.verdict, p.patterns, x.horizon, x.a / p.base_close - 1 as r
      from predictions p
      cross join lateral (values (1, p.actual_close), (3, p.actual3), (6, p.actual6)) as x(horizon, a)
     where public.is_admin()
       and p.pred_date >= (now() at time zone 'Asia/Seoul')::date - p_days
       and p.base_close > 0 and x.a is not null and x.a <> p.base_close
  ), s as (
    select h.market, pt.key as pattern, h.pred_date, h.horizon, pt.value as signal, h.r
      from h cross join lateral jsonb_each_text(coalesce(h.patterns, '{}'::jsonb)) as pt(key, value)
     where pt.value in ('up', 'dn')
    union all
    select h.market, 'verdict', h.pred_date, h.horizon, h.verdict, h.r from h where h.verdict in ('up', 'dn')
  )
  select s.market, s.pattern, s.pred_date, s.horizon, s.signal, count(*)::int,
         count(*) filter (where (s.signal = 'up' and s.r > 0) or (s.signal = 'dn' and s.r < 0))::int, sum(s.r)
    from s group by 1, 2, 3, 4, 5
  union all
  select h.market, '_all', h.pred_date, h.horizon, 'all', count(*)::int, count(*) filter (where h.r < 0)::int, sum(h.r)
    from h group by 1, 2, 3, 4
  order by 3 desc, 1, 2, 4, 5;
$$;
revoke execute on function public.pattern_stats(int) from public, anon;
grant execute on function public.pattern_stats(int) to authenticated;
