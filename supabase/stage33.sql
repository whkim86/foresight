-- 모의투자 게시판(board = 'game') 추가 + 오픈 공지(고정글) — stage32 다음, 여러 번 실행해도 안전 (stage21 공지와 같은 방식: auto_key)
--   공지는 운영자 계정으로 올라가고, 고정글이라 회원 홈 맨 위 '공지' 막대에도 보임

alter table public.posts drop constraint if exists posts_board_check;
alter table public.posts add constraint posts_board_check check (board in ('coin', 'nasdaq', 'kospi', 'game', 'request', 'payment'));

insert into public.posts (board, user_id, author, title, body, pinned, auto_key)
select 'game', (select id from public.profiles where role = 'admin' order by joined_at limit 1), 'AI 신호등',
       '[공지] 🐯 신호등 친구들 모의투자 오픈! 가입하면 10만P · 하락에도 걸 수 있어요',
$body$안녕하세요, AI 신호등 운영자입니다 🚦
AI 신호를 보고 포인트로 투자해 보는 '신호등 친구들 모의투자'가 열렸어요!
진짜 돈 걱정 없이, 포인트로 연습하면서 투자 고수가 되어 보세요.

━━━━━━━━━━━━━━━━
✅ 이렇게 해요
1. 상단 메뉴 '🐯 모의투자' → 12지 친구 고르기 → 100,000P 지급
2. 종목 고르기 (업비트·빗썸·나스닥·코스피)
   · 어제 많이 오른 순, 상승 예측 모델 많은 순, 분야별로 찾기 · ⭐ 즐겨찾기
   · 📈 가격 차트 · 🚦 우선순위 바로가기로 AI 신호 확인
3. 📈 상승 / 📉 하락 중 고르고 포인트 걸기 (보유의 50%까지 · 하루 5종목)
4. 다음 날 실제 종가로 정산 → 오른 만큼(하락에 걸었으면 내린 만큼) 포인트가 늘어요

⏰ 걸기·취소 마감 = 종가 3시간 전
   업비트 다음 날 06:00 · 빗썸 21:00 · 코스피 12:30 · 나스닥 미국 13:00
   마감 전에는 언제든 취소 가능 (포인트·투자 횟수 그대로 돌려받아요)
   👉 시장별 시간표: https://www.ai-sinhodeung.co.kr/game.html#schedule

━━━━━━━━━━━━━━━━
🎮 재미 요소
· 레벨 1~30 · 레벨이 오르면 모자·옷·신발이 열려요 (👕 꾸미기)
· 🎁 오늘의 미션: 출석 · 차트 보기 · 글쓰기 각 +1,000P (하루 한 번씩)
· 🏆 순위표: 주간 수익률 · 총 수익률 · 레벨 · 총자산
· 🤖 AI범돌이: 매일 각 시장 AI 1위 종목에 자동으로 거는 AI 친구! 사람이 AI를 이길 수 있을까요?
· 😵 다 잃어도 3일 뒤 50,000P로 부활
· 🎁 레벨 보상: Lv.10 7일 이용권 · Lv.20 1개월 · Lv.30 3개월

━━━━━━━━━━━━━━━━
💬 이 게시판에서
수익 인증, 오늘 건 종목, 전략, 궁금한 점, 바라는 기능을 자유롭게 남겨 주세요.
20자 이상 글을 쓰면 '글쓰기' 미션 +1,000P도 받아요!

※ 포인트는 게임 안에서만 쓰이며 현금·결제에 쓸 수 없어요. AI 신호는 참고용 정보이며 투자 권유가 아닙니다.
※ 비회원도 로그인 화면의 '가입 없이 둘러보기'로 맛보기를 할 수 있어요 (저장은 안 돼요).$body$, true, 'notice-game-open'
on conflict (auto_key) do nothing;

select id, board, title, author, pinned from public.posts where board = 'game' order by id desc limit 3;
