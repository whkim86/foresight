-- 예측 포털 4-4: 수집 예약 시간대 넓히기 (토큰은 그대로, 예약만 다시 등록)
-- 가격 차트 CSV 는 우선순위보다 1시간쯤 늦게 올라옴 (예: 코인·나스닥 10:30 전후, 코스피 22:45 전후)
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)

do $$ begin perform cron.unschedule(jobname) from cron.job where jobname like 'ingest-%'; end $$;

-- 시각은 UTC (KST = UTC+9). 10분마다
select cron.schedule('ingest-morning-1', '*/10 23 * * *',    'select public.trigger_ingest()');  -- KST 08:00~08:50
select cron.schedule('ingest-morning-2', '*/10 0-1 * * *',   'select public.trigger_ingest()');  -- KST 09:00~10:50
select cron.schedule('ingest-morning-3', '0-30/10 2 * * *',  'select public.trigger_ingest()');  -- KST 11:00~11:30
select cron.schedule('ingest-night-1',   '30-50/10 13 * * *','select public.trigger_ingest()');  -- KST 22:30~22:50
select cron.schedule('ingest-night-2',   '*/10 14 * * *',    'select public.trigger_ingest()');  -- KST 23:00~23:50
select cron.schedule('ingest-night-3',   '0-30/10 15 * * *', 'select public.trigger_ingest()');  -- KST 00:00~00:30

-- 지금 바로 한 번 수집
select public.trigger_ingest();

-- 확인용
-- select jobname, schedule from cron.job order by jobname;
