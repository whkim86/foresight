-- AI 신호등 13단계: 코인 탭 안에 빗썸 추가 (업비트 | 빗썸 전환)
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
--
-- 데이터 시장 이름은 'bithumb' (백업 경로 forecasts/bithumb/..., 판정·모델 성적도 market = 'bithumb').
-- 이용권은 따로 없고 코인 이용권(coin_until)으로 함께 열람. 게시판 요약 글은 코인 게시판에 올라감.

-- ---------- 1. 판정 표에 'bithumb' 허용 ----------
do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'public.predictions'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%market%'
  loop
    execute format('alter table public.predictions drop constraint %I', c);
  end loop;
end $$;
alter table public.predictions
  add constraint predictions_market_check check (market in ('coin', 'bithumb', 'nasdaq', 'kospi'));

-- ---------- 2. 열람 권한: 빗썸 = 코인 이용권 ----------
create or replace function public.has_tab(p_market text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from profiles p
     where p.id = auth.uid()
       and (p.role = 'admin'
            or now() < p.joined_at + interval '7 days'
            or case p_market when 'coin'    then p.coin_until
                             when 'bithumb' then p.coin_until
                             when 'nasdaq'  then p.nasdaq_until
                             when 'kospi'   then p.kospi_until end > now())
  );
$$;

-- ---------- 3. 첫 화면 '오늘의 신호': 빗썸 기준 종목 BTC ----------
create or replace function public.market_signals()
returns table (
  market text, pred_date date,
  up_n int, mx_n int, dn_n int,
  lead_symbol text, lead_verdict text, lead_med1 double precision,
  unlocked boolean
) language sql stable security definer set search_path = public as $$
  with latest as (
    select p.market, max(p.pred_date) as d from predictions p group by p.market
  ), lead as (
    select * from (values ('coin', 'BTC'), ('bithumb', 'BTC'), ('nasdaq', 'SP500'), ('kospi', 'SK하이닉스')) as v(market, symbol)
  )
  select l.market, l.d,
         count(*) filter (where p.verdict = 'up')::int,
         count(*) filter (where p.verdict = 'mx')::int,
         count(*) filter (where p.verdict = 'dn')::int,
         ld.symbol,
         case when has_tab(l.market) then max(p.verdict) filter (where p.symbol = ld.symbol) end,
         case when has_tab(l.market) then max(p.med1) filter (where p.symbol = ld.symbol) end,
         has_tab(l.market)
    from latest l
    join predictions p on p.market = l.market and p.pred_date = l.d
    join lead ld on ld.market = l.market
   where auth.uid() is not null
   group by l.market, l.d, ld.symbol;
$$;

-- ---------- 4. 수집 예약: 빗썸(0시 R 실행, 가격 차트는 1시 10분 전후)에 맞춰 새벽 1시 40분까지 ----------
do $$ begin perform cron.unschedule(jobname) from cron.job where jobname = 'ingest-night-3'; end $$;
select cron.schedule('ingest-night-3', '*/10 15 * * *',    'select public.trigger_ingest()');  -- KST 00:00~00:50
do $$ begin perform cron.unschedule(jobname) from cron.job where jobname = 'ingest-night-4'; end $$;
select cron.schedule('ingest-night-4', '0-40/10 16 * * *', 'select public.trigger_ingest()');  -- KST 01:00~01:40

-- 지금 바로 한 번 수집 (빗썸 첫 백업)
select public.trigger_ingest();

-- 확인용
-- select jobname, schedule from cron.job order by jobname;
