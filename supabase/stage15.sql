-- AI 신호등 15단계: 우선순위 화면에 '가격 차트 판정' 칸 (두 신호 나란히 보기)
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 안전)
--
-- 시장(coin·bithumb·nasdaq·kospi)의 가장 최근 예측일 종목별 D+1 판정. 그 탭을 볼 수 있는 회원에게만 내려줌
-- (predictions 표는 운영자만 직접 읽을 수 있어서 이 함수로 필요한 칸만 꺼냄)
create or replace function public.board_verdicts(p_market text)
returns table (symbol text, verdict text, up_n int, dn_n int, n_models int, pred_date date)
language sql stable security definer set search_path = public as $$
  select p.symbol, p.verdict, p.up_n, p.dn_n, p.n_models, p.pred_date
    from predictions p
   where p.market = p_market
     and public.has_tab(p_market)
     and p.pred_date = (select max(pred_date) from predictions where market = p_market);
$$;
grant execute on function public.board_verdicts(text) to authenticated;
