// Supabase 연결 정보 — Supabase 대시보드 > Project Settings > API Keys 에서 복사
// anon(publishable) 키는 브라우저에 공개돼도 되는 키예요. service_role(secret) 키는 절대 넣지 마세요.
window.PORTAL_CONFIG = {
  SUPABASE_URL: "https://qtzmfuaqzutzvnulfdel.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0em1mdWFxenV0enZudWxmZGVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAyNDIwNTQsImV4cCI6MjEwNTgxODA1NH0.YoqzhOP3eMBvPP7kl3Tgu17yCBYaGMbp3ou0on-MAUE",

  TRIAL_DAYS: 7,

  // 입금 계좌 — 계좌번호가 생기면 ACCOUNT만 바꾸면 돼요
  BANK: { name: "신한은행", holder: "김우형", account: "[계좌번호 준비 중]" },

  // 1달 정가(탭 1/2/3개). 3·6·12달은 할인 후 1,000원 단위 내림 — supabase/stage2.sql 의 plan_price 와 같아야 함
  PRICE_1M: [4900, 8900, 12900],
  PLANS: [
    { months: 1, days: 30, label: "1달", discount: 0 },
    { months: 3, days: 90, label: "3달", discount: 0.1 },
    { months: 6, days: 180, label: "6달", discount: 0.2 },
    { months: 12, days: 365, label: "1년", discount: 0.4 },
  ],

  // 게시판 — key 는 supabase/stage3.sql 의 posts.board 값과 같아야 함
  BOARDS: {
    coin: { name: "코인", desc: "코인 예측과 매매에 대해 자유롭게 이야기해요" },
    nasdaq: { name: "나스닥", desc: "나스닥·S&P500 종목 이야기를 나눠요" },
    kospi: { name: "코스피200", desc: "코스피200 종목 이야기를 나눠요" },
    request: { name: "종목 추가 요청", desc: "새로 예측해줬으면 하는 코인·종목을 자유롭게 요청해주세요" },
    payment: { name: "입금 문의", desc: "계좌이체·연장 관련 문의예요. 글쓴이와 운영자만 볼 수 있어요", secret: true },
  },

  MARKETS: {
    coin: {
      name: "코인",
      desc: "업비트 알트코인 6일 예측과 우선순위, 해석을 한 화면에서 봐요",
      note: "매일 오전 9시 업데이트되는 업비트 예측이에요",
      views: [
        { key: "priority", label: "우선순위", url: "https://whkim86.github.io/coin_upbit/" },
        { key: "chart", label: "가격 차트", url: "https://whkim86.github.io/coin_upbitline/" },
      ],
    },
    nasdaq: {
      name: "나스닥",
      desc: "S&P500과 나스닥 종목의 6일 예측을 확인해요",
      note: "나스닥·S&P500 종목의 6일 예측이에요",
      views: [
        { key: "priority", label: "우선순위", url: "https://whkim86.github.io/coin_nasdaq/" },
        { key: "chart", label: "가격 차트", url: "https://whkim86.github.io/coin_nasdaqline/" },
      ],
    },
    kospi: {
      name: "코스피200",
      desc: "SK하이닉스, 삼성전자를 기준으로 종목별 예측을 봐요",
      note: "코스피200 종목의 6일 예측이에요",
      views: [
        { key: "priority", label: "우선순위", url: "https://whkim86.github.io/coin_kospi/" },
        { key: "chart", label: "가격 차트", url: "https://whkim86.github.io/coin_kospiline/" },
      ],
    },
  },
};
