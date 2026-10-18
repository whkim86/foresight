-- AI 신호등 21단계: 공지 글 올리기 (공지로 고정 → 게시판 맨 위 + 홈 화면 상단 공지 띠)
-- Supabase 대시보드 > SQL Editor > New query 에 전체 붙여넣고 Run (여러 번 실행해도 같은 글이 또 생기지 않음)
-- 글 내용을 고치려면 게시판에서 운영자 계정으로 '수정'하면 돼요. 내리려면 글에서 '공지 해제'
--   1) AI 패턴해석 소개      → 코인 · 나스닥 · 코스피 게시판
--   2) 새 종목 추가 예정 안내 → 나스닥 · 코스피 게시판

do $$
declare
  admin_id uuid := (select id from profiles where role = 'admin' order by joined_at limit 1);
  b text;
  pattern_body text := $t$가격 차트 화면에 'AI 패턴해석' 주석이 새로 생겼어요.

■ 무엇을 보여주나요?
가격 차트에서 종목을 고르면 차트 아래에 'AI 패턴해석 #1 · 6일 흐름'이 표시돼요.
AI 모델 52개가 그린 6일 치 예측선이 직전 종가보다 아래 또는 위로 크게 몰려 있는지 알려드려요.
· 하락 기운 강함 : 예측값의 70% 이상이 직전 종가보다 아래에 있어요
· 상승 기운 강함 : 예측값의 70% 이상이 직전 종가보다 위에 있어요
· 한쪽으로 뚜렷하지 않음 : 어느 쪽도 70%를 넘지 않아요

■ D+1 판정과는 무엇이 다른가요?
기존 'D+1 판정(상승·혼돈·하락)'은 바로 다음 날 하루만 봐요.
패턴해석은 6일 전체 흐름이 한쪽으로 기울었는지를 봐요. 그래서 둘이 다르게 나올 수 있어요.
예를 들어 내일은 혼돈이어도 6일 흐름은 하락 기운일 수 있어요.

■ 알아두세요
· 지금은 검증 중인 참고 해석이에요. 실제로 얼마나 맞는지 매일 확인하고 있어요.
· 확인 결과에 따라 기준을 다듬고, 앞으로 패턴해석 #2, #3도 하나씩 추가할 예정이에요.
· 모든 신호는 과거 가격 흐름을 바탕으로 한 참고 정보이며, 투자 권유가 아니에요.

궁금한 점이나 '이런 해석도 있으면 좋겠다'는 의견은 댓글로 남겨주세요!$t$;
begin
  if admin_id is null then raise exception '운영자 계정이 없어요'; end if;

  -- 1) AI 패턴해석 소개
  foreach b in array array['coin', 'nasdaq', 'kospi'] loop
    insert into posts (board, user_id, author, title, body, pinned, auto_key)
    values (b, admin_id, 'AI 신호등', '[공지] 🧩 새 기능: 가격 차트 아래 ''AI 패턴해석''이 생겼어요', pattern_body, true, 'notice-pattern1-' || b)
    on conflict (auto_key) do nothing;
  end loop;

  -- 2) 새 종목 추가 예정 — 나스닥
  insert into posts (board, user_id, author, title, body, pinned, auto_key)
  values ('nasdaq', admin_id, 'AI 신호등', '[공지] 📢 코인 관련 미국 종목·환율 21개가 곧 추가돼요',
$t$많이 찾으시던 코인 관련 미국 종목을 나스닥 예측에 곧 추가해요.
지금 AI 모델 학습 중이고, 준비가 끝나면 우선순위와 가격 차트 화면에 바로 나와요. 추가되면 이 게시판에 다시 알려드릴게요.

■ 비트코인 · 이더리움 ETF
· 비트코인 현물 : IBIT(아이셰어즈), FBTC(피델리티)
· 비트코인 2배 : BITX, BITU
· 이더리움 : ETHA(현물), ETHU(2배)

■ 코인 관련 기업
· 코인베이스(COIN) · 코인베이스 2배(CONL)
· 스트래티지(MSTR) · 스트래티지 2배(MSTU, MSTX)
· 로빈후드(HOOD) · 서클(CRCL) · 갤럭시디지털(GLXY) · 비트마인(BMNR) · 샤프링크(SBET)

■ 비트코인 채굴
· MARA · 라이엇(RIOT) · 클린스파크(CLSK)

■ 환율
· 원/달러 · 엔/원

■ 알아두세요
· 2배 레버리지 상품은 기초 자산의 하루 등락을 2배로 따라가요. 변동이 크니 꼭 참고만 해주세요.
· 서클·갤럭시디지털·비트마인처럼 최근 상장한 종목은 학습 기간이 짧아 예측이 덜 안정적일 수 있어요.
· 모든 신호는 과거 가격 흐름을 바탕으로 한 참고 정보이며, 투자 권유가 아니에요.

보고 싶은 종목이 더 있으면 댓글이나 '종목 추가 요청' 게시판에 남겨주세요!$t$, true, 'notice-newsym-202610-nasdaq')
  on conflict (auto_key) do nothing;

  -- 2) 새 종목 추가 예정 — 코스피
  insert into posts (board, user_id, author, title, body, pinned, auto_key)
  values ('kospi', admin_id, 'AI 신호등', '[공지] 📢 인기 ETF·아시아 지수 29개가 곧 추가돼요',
$t$많이 찾으시던 국내 ETF와 아시아 지수를 코스피 예측에 곧 추가해요.
지금 AI 모델 학습 중이고, 준비가 끝나면 우선순위와 가격 차트 화면에 바로 나와요. 추가되면 이 게시판에 다시 알려드릴게요.

■ 대표 지수 ETF + 레버리지 · 인버스
· KODEX 200 · KODEX 레버리지 · KODEX 인버스 · KODEX 200선물인버스2X(곱버스)
· KODEX 코스닥150 · 코스닥150레버리지 · 코스닥150선물인버스

■ 국내 상장 해외 ETF
· 미국S&P500 (TIGER · KODEX) · 미국나스닥100 (TIGER · KODEX)
· TIGER 미국필라델피아반도체 · TIGER 미국테크TOP10
· TIGER 미국배당다우존스 · ACE 미국30년국채액티브(H)

■ 업종 · 자산 ETF
· 반도체 (KODEX 반도체 · TIGER 반도체TOP10)
· 2차전지 (KODEX 2차전지산업 · TIGER 2차전지테마)
· KODEX 은행 · 증권 · 자동차 · 바이오
· KODEX 골드선물(H) · WTI원유선물(H) · 미국달러선물

■ 아시아 지수
· 닛케이225 · 항셍 · 상해종합

■ 알아두세요
· 레버리지·인버스 ETF는 기초 지수의 하루 등락을 2배(인버스는 반대 방향)로 따라가요. 인버스의 '상승 신호'는 시장 하락을 예상한다는 뜻이에요.
· 모든 신호는 과거 가격 흐름을 바탕으로 한 참고 정보이며, 투자 권유가 아니에요.

보고 싶은 종목이 더 있으면 댓글이나 '종목 추가 요청' 게시판에 남겨주세요!$t$, true, 'notice-newsym-202610-kospi')
  on conflict (auto_key) do nothing;
end $$;
