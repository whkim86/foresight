-- AI 신호등 25단계: 새 종목 '추가 완료' 공지 (나스닥 21개 · 코스피 29개) + '곧 추가돼요' 공지 고정 해제
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 같은 글이 또 생기지 않음)

-- 1) '곧 추가돼요' 공지는 고정만 풀기 (글은 남겨둠)
update public.posts set pinned = false
 where auto_key in ('notice-newsym-202610-nasdaq', 'notice-newsym-202610-kospi');

do $$
declare
  admin_id uuid := (select id from profiles where role = 'admin' order by joined_at limit 1);
begin
  if admin_id is null then raise exception '운영자 계정이 없어요'; end if;

  -- 2) 나스닥 추가 완료
  insert into posts (board, user_id, author, title, body, pinned, auto_key)
  values ('nasdaq', admin_id, 'AI 신호등', '[공지] ✅ 코인 관련 미국 종목·환율 21개가 추가됐어요',
$t$기다리시던 코인 관련 미국 종목과 환율이 나스닥 예측에 추가됐어요.
지금 우선순위와 가격 차트 화면에서 바로 볼 수 있어요.

■ 추가된 종목
· 비트코인 현물 ETF : IBIT(아이셰어즈), FBTC(피델리티)
· 비트코인 2배 : BITX, BITU
· 이더리움 : ETHA(현물), ETHU(2배)
· 코인 관련 기업 : 코인베이스(COIN) · 코인베이스 2배 · 스트래티지(MSTR) · 스트래티지 2배(MSTU, MSTX)
  로빈후드 · 서클 · 갤럭시디지털 · 비트마인 · 샤프링크
· 비트코인 채굴 : MARA · 라이엇 · 클린스파크
· 환율 : 원/달러 · 엔/원

■ 이렇게 찾아보세요
· 종목 이름 옆에 한글명이 함께 보여요. 예) COINBASE(코인베이스)
· 검색칸에 한글로 '코인베이스', '스트래티지'처럼 입력해도 찾아져요.
· 새로 생긴 '종목 카탈로그'에서 '비트코인·코인 관련' 테마를 누르면 코인과 미국 코인주를 한 화면에서 볼 수 있어요.

■ 알아두세요
· 2배 레버리지 상품은 기초 자산의 하루 등락을 2배로 따라가요. 변동이 크니 참고만 해주세요.
· 서클·갤럭시디지털·비트마인처럼 최근 상장한 종목은 학습 기간이 짧아 예측이 덜 안정적일 수 있어요.
· 모든 신호는 과거 가격 흐름을 바탕으로 한 참고 정보이며, 투자 권유가 아니에요.

보고 싶은 종목이 더 있으면 댓글이나 '종목 추가 요청' 게시판에 남겨주세요!$t$, true, 'notice-newsym-202610-nasdaq-done')
  on conflict (auto_key) do nothing;

  -- 3) 코스피 추가 완료
  insert into posts (board, user_id, author, title, body, pinned, auto_key)
  values ('kospi', admin_id, 'AI 신호등', '[공지] ✅ 인기 ETF·아시아 지수 29개가 추가됐어요',
$t$기다리시던 국내 ETF와 아시아 지수가 코스피 예측에 추가됐어요.
지금 우선순위와 가격 차트 화면에서 바로 볼 수 있어요.

■ 추가된 종목
· 대표 지수 ETF : KODEX 200 · 레버리지 · 인버스 · 200선물인버스2X(곱버스)
  KODEX 코스닥150 · 코스닥150레버리지 · 코스닥150선물인버스
· 국내 상장 해외 ETF : 미국S&P500(TIGER·KODEX) · 미국나스닥100(TIGER·KODEX)
  TIGER 미국필라델피아반도체 · 미국테크TOP10 · 미국배당다우존스 · ACE 미국30년국채액티브(H)
· 업종·자산 ETF : 반도체(KODEX·TIGER) · 2차전지(KODEX·TIGER) · KODEX 은행 · 증권 · 자동차 · 바이오
  KODEX 골드선물(H) · WTI원유선물(H) · 미국달러선물
· 아시아 지수 : 닛케이225 · 항셍 · 상해종합

■ 이렇게 찾아보세요
· 검색칸에 'KODEX', '반도체', '닛케이'처럼 입력하면 바로 찾아져요.
· 새로 생긴 '종목 카탈로그'에서 반도체·금·환율 같은 테마를 누르면 코스피·나스닥·코인 종목을 한 화면에서 볼 수 있어요.

■ 알아두세요
· 레버리지·인버스 ETF는 기초 지수의 하루 등락을 2배(인버스는 반대 방향)로 따라가요. 인버스의 '상승 신호'는 시장 하락을 예상한다는 뜻이에요.
· 모든 신호는 과거 가격 흐름을 바탕으로 한 참고 정보이며, 투자 권유가 아니에요.

보고 싶은 종목이 더 있으면 댓글이나 '종목 추가 요청' 게시판에 남겨주세요!$t$, true, 'notice-newsym-202610-kospi-done')
  on conflict (auto_key) do nothing;
end $$;

-- 확인용: '곧 추가돼요' 2개는 pinned = false, '추가됐어요' 2개는 pinned = true 면 정상
select board, title, pinned from public.posts where auto_key like 'notice-newsym-202610-%' order by board, created_at;
