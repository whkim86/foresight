-- AI 신호등 24단계: 종목 카탈로그 (catalog.html)
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
--   catalog_symbols : 시장별 최신 예측에 있는 종목 목록 — 비회원(anon)도 볼 수 있음 (신호는 없음)
--   catalog_signals : 종목별 D+1 판정 · 패턴해석(70%) — 로그인한 회원 중 그 탭을 볼 수 있는 사람(무료체험·결제·운영자)에게만

create or replace function public.catalog_symbols()
returns table (market text, symbol text, pred_date date)
language sql stable security definer set search_path = public as $$
  select p.market, p.symbol, p.pred_date
    from predictions p
    join (select market, max(pred_date) as d from predictions group by market) l
      on l.market = p.market and l.d = p.pred_date
   order by 1, 2;
$$;
grant execute on function public.catalog_symbols() to anon, authenticated;

create or replace function public.catalog_signals()
returns table (market text, symbol text, verdict text, pattern text, med1 double precision, pred_date date)
language sql stable security definer set search_path = public as $$
  select p.market, p.symbol, p.verdict, p.patterns ->> 'p1_70', p.med1, p.pred_date
    from predictions p
    join (select market, max(pred_date) as d from predictions group by market) l
      on l.market = p.market and l.d = p.pred_date
   where public.has_tab(p.market);
$$;
revoke execute on function public.catalog_signals() from public, anon;
grant execute on function public.catalog_signals() to authenticated;
