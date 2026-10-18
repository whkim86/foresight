// 종목 한글명 — 심볼 옆에 '(한글명)'을 붙여 보여줌
//  · 코인: 업비트·빗썸 공개 마켓 목록에서 받아옴 (브라우저에 12시간 보관). 새로 상장한 코인도 자동으로 반영
//  · 나스닥·코스피: 아래 표 (auto/build_data.py 의 NASDAQ_KO 와 같은 이름). 새 종목을 R 에 넣으면 여기에도 한 줄 추가
//  · 보드(iframe) 안: 종목 버튼·차트 제목·대표 종목 제목에 붙이고, 검색칸 자동완성에도 한글명 표시
//  · 홈 화면: window.PortalNames.load() 로 받아서 대표 종목 옆에 표시
(function () {
  const STATIC = {
    nasdaq: {
      SP500: "S&P500", NASDAQ: "나스닥", NASDAQ100: "나스닥100", DOW: "다우존스", RUSSELL2000: "러셀2000",
      NVIDIA: "엔비디아", APPLE: "애플", ALPHABET_A: "알파벳 A", ALPHABET_C: "알파벳 C", MICROSOFT: "마이크로소프트",
      AMAZON: "아마존", BROADCOM: "브로드컴", META: "메타", TESLA: "테슬라", COSTCO: "코스트코", NETFLIX: "넷플릭스",
      PALANTIR: "팔란티어", INTEL: "인텔", PEPSICO: "펩시코", ADOBE: "어도비", T_MOBILE: "티모바일", COMCAST: "컴캐스트",
      CISCO: "시스코", APPLVIN: "앱러빈", LINDE: "린데", INTUIT: "인튜이트", AMGEN: "암젠", QUALCOMM: "퀄컴",
      GILEAD: "길리어드", BOOKING: "부킹홀딩스", TEXAS_INSTRUMENTS: "텍사스 인스트루먼트", SANDISK: "샌디스크",
      APPLIED_MATERIALS: "어플라이드 머티리얼즈", AUTOMATIC_DATA_PROCESSING: "ADP", MERCADOLIBRE: "메르카도리브레",
      MICRON: "마이크론", MARVELL: "마벨", CROWDSTRIKE: "크라우드스트라이크", VERTIV: "버티브", ASTERA_LABS: "아스테라 랩스",
      CONSTELLATION_ENERGY: "컨스텔레이션 에너지", DOORDASH: "도어대시", LUMENTUM: "루멘텀", DATADOG: "데이터독",
      MONSTER_BEVERAGE: "몬스터 베버리지", MARRIOTT: "메리어트", EQUINIX: "에퀴닉스", CME_GROUP: "CME 그룹",
      AIRBNB: "에어비앤비", REGENERON: "리제네론",
      NVDA_2X: "엔비디아 2배", NVDA_3X: "엔비디아 3배", NASDAQ_2X: "나스닥 2배", NASDAQ_3X: "나스닥 3배",
      NASDAQ_INV_3X: "나스닥 3배 인버스", SEMICONDUCTOR_3X: "반도체 3배", SEMICONDUCTOR_INV_3X: "반도체 3배 인버스",
      SP500_2X: "S&P500 2배", SP500_3X: "S&P500 3배", SP500_INV_3X: "S&P500 3배 인버스",
      // 2026-10 추가 예정 (코인 관련 · 환율)
      BITCOIN_2X: "비트코인 2배", BITCOIN_2X_PROSHARES: "비트코인 2배 프로셰어즈", BITCOIN_ETF_ISHARES: "비트코인 현물 아이셰어즈",
      BITCOIN_ETF_FIDELITY: "비트코인 현물 피델리티", ETHEREUM_ETF_ISHARES: "이더리움 현물 아이셰어즈", ETHEREUM_2X: "이더리움 2배",
      COINBASE: "코인베이스", COINBASE_2X: "코인베이스 2배", STRATEGY: "스트래티지", STRATEGY_2X_TREX: "스트래티지 2배 티렉스",
      STRATEGY_2X_DEFIANCE: "스트래티지 2배 디파이언스", ROBINHOOD: "로빈후드", CIRCLE: "서클", GALAXY_DIGITAL: "갤럭시 디지털",
      BITMINE: "비트마인", SHARPLINK: "샤프링크", MARA: "마라 홀딩스", RIOT: "라이엇 플랫폼스", CLEANSPARK: "클린스파크",
      USD_KRW: "원/달러 환율", JPY_KRW: "엔/원 환율",
    },
    kospi: {
      KOSPI: "코스피", KOSDAQ: "코스닥", NAVER: "네이버", "S-Oil": "에쓰오일", "LS ELECTRIC": "LS일렉트릭",
      NIKKEI225: "닛케이225", HANGSENG: "항셍", SHANGHAI: "상해종합",
    },
  };
  const EXCHANGE = { coin: "https://api.upbit.com/v1/market/all", bithumb: "https://api.bithumb.com/v1/market/all" };
  const KEEP = 12 * 3600 * 1000;
  const cache = {};

  async function load(market) {
    if (cache[market]) return cache[market];
    if (STATIC[market]) return (cache[market] = STATIC[market]);
    const url = EXCHANGE[market];
    if (!url) return (cache[market] = {});
    const key = "portalNames:" + market;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (saved && Date.now() - saved.t < KEEP) return (cache[market] = saved.m);
    } catch (e) { /* 저장소를 못 쓰면 매번 받아옴 */ }
    try {
      const rows = await (await fetch(url)).json();
      const m = {};
      // 원화 마켓 이름 우선, 없으면 BTC·USDT 마켓 이름
      rows.forEach((r) => {
        const [q, sym] = String(r.market || "").split("-");
        if (sym && r.korean_name && (q === "KRW" || !m[sym])) m[sym] = r.korean_name;
      });
      try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), m })); } catch (e) { /* 무시 */ }
      return (cache[market] = m);
    } catch (e) {
      return {};  // 거래소 응답이 없으면 한글명 없이 심볼만
    }
  }
  // 심볼과 한글명이 사실상 같으면(AMD, PDD 등) 붙이지 않음
  function ko(map, sym) {
    const k = map && map[sym];
    return k && k.replace(/\s/g, "").toUpperCase() !== String(sym).replace(/[\s_]/g, "").toUpperCase() ? k : "";
  }
  window.PortalNames = { load, ko };

  // ---------- 보드(iframe) 안 표시 ----------
  const board = window.PORTAL_BOARD;
  if (!board) return;
  const css = document.createElement("style");
  css.textContent = `.kn{font-weight:400;color:var(--muted,#5A6478);font-size:.82em;margin-left:3px;white-space:nowrap}
  h2 .kn,h3 .kn{font-size:.6em;margin-left:6px}`;
  document.head.appendChild(css);

  const TARGETS = "button[data-coin], .pname, h2.ticker";
  let map = null, queued = false;
  function decorate() {
    queued = false;
    document.querySelectorAll(TARGETS).forEach((el) => {
      if (el.querySelector(":scope > .kn")) return;
      const t = [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
      if (!t) return;
      const name = ko(map, t.nodeValue.trim());
      if (!name) return;
      const s = document.createElement("span");
      s.className = "kn"; s.textContent = `(${name})`;
      t.after(s);
    });
    // 검색칸 자동완성 목록: 한글명도 함께 보이고 한글로도 찾을 수 있게
    document.querySelectorAll("datalist option").forEach((o) => {
      const name = ko(map, o.value);
      if (name && o.label !== name) o.label = name;
    });
  }
  function queue() { if (map && !queued) { queued = true; setTimeout(decorate, 20); } }  // 화면이 가려져 있어도 동작하게 타이머
  load(board.market).then((m) => {
    map = m;
    queue();
    new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
  });
})();
