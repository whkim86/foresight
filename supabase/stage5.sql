-- AI 신호등 5단계: 포털 첫 화면 '오늘의 신호' 요약
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
--
-- 시장별 최신 예측일의 상승·혼돈·하락 종목 수 + 대표 종목(코인 BTC, 나스닥 SP500, 코스피 SK하이닉스) 판정.
-- 종목 수는 로그인한 회원 누구나, 대표 종목 판정은 그 탭을 볼 수 있는 회원에게만 내려줌.
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
    select * from (values ('coin', 'BTC'), ('nasdaq', 'SP500'), ('kospi', 'SK하이닉스')) as v(market, symbol)
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
