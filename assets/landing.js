// 가입 전 소개 화면 (index.html 에서 로그인 안 된 방문자에게 표시)
// 데이터: supabase/stage6.sql 의 landing_teaser(), landing_posts() — 로그인 없이 호출 가능
window.renderLanding = async function () {
  const { sb, cfg, esc, ago, won, ICONS } = Portal;
  const MK = Object.keys(cfg.MARKETS);
  const NOUN = { coin: "코인", nasdaq: "종목", kospi: "종목" };

  const [teaserRes, postsRes] = await Promise.all([sb.rpc("landing_teaser"), sb.rpc("landing_posts")]);
  const teaser = Object.fromEntries((teaserRes.data || []).map((r) => [r.market, r]));
  const posts = postsRes.data || [];

  const pct = (x) => (x == null ? "-" : Math.round(x * 100) + "%");
  const signed = (x) => (x == null ? "" : (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%");
  const SIGNUP = "login.html#signup";

  // ---------- 시장별 맛보기 카드 ----------
  const cards = MK.map((key) => {
    const m = cfg.MARKETS[key];
    const t = teaser[key];
    const total = t ? t.up_n + t.mx_n + t.dn_n : 0;
    const w = (n) => (total ? (n / total) * 100 : 0);
    const top = t && t.top_symbol
      ? `<div class="t-row first">
           <span class="rank">1</span>
           <span class="sym"><b>${esc(t.top_symbol)}</b><small title="D+1 모델 중앙값 ${signed(t.top_med1)}">모델 ${t.top_up_n}/${t.top_models} 상승</small></span>
           <span class="badge red" title="15개 모델 × 6일 예측 중 기준가보다 높은 비율">합의 ${pct(t.top_cons_up)}</span>
         </div>`
      : `<div class="t-row first"><span class="sym"><b style="color:var(--muted)">오늘은 상승 신호가 뚜렷한 ${NOUN[key]}이 없어요</b></span></div>`;
    const ghost = [2, 3].map((n) => `
      <div class="t-row ghosted" aria-hidden="true"><span class="rank">${n}</span><span class="sym"><i></i><i class="s"></i></span><span class="pill-g"></span></div>`).join("");
    return `
      <div class="card teaser-card">
        <div class="top"><span class="market-head">${ICONS[key] || ""}${esc(m.name)}</span>
          <small>${t ? t.pred_date.slice(5).replace("-", ".") + " 예측" : ""}</small></div>
        <div class="t-label">오늘 AI 상승 신호가 가장 강한 ${NOUN[key]}</div>
        <div class="t-list">
          ${top}
          <div class="ghost-wrap">${ghost}
            <a class="unlock" href="${SIGNUP}">${ICONS.lock} 가입하면 전체 순위가 열려요</a>
          </div>
        </div>
        ${t ? `
        <div class="dist">
          <div class="bar" role="img" aria-label="상승 ${t.up_n}, 혼돈 ${t.mx_n}, 하락 ${t.dn_n}">
            <i class="u" style="width:${w(t.up_n)}%"></i><i class="m" style="width:${w(t.mx_n)}%"></i><i class="d" style="width:${w(t.dn_n)}%"></i>
          </div>
          <div class="nums"><span class="v-up">상승 <b>${t.up_n}</b></span><span class="v-mx">혼돈 <b>${t.mx_n}</b></span><span class="v-dn">하락 <b>${t.dn_n}</b></span></div>
        </div>` : ""}
      </div>`;
  }).join("");

  // ---------- 게시판 미리보기 ----------
  const boardCols = MK.map((key) => {
    const list = posts.filter((p) => p.board === key);
    return `
      <div class="card board-card">
        <div class="head"><span>${esc(cfg.BOARDS[key].name)} 게시판</span></div>
        <div class="mini-posts">
          ${list.length ? list.map((p) => `<a href="${SIGNUP}"><b>${esc(p.title)}</b><span>${ago(p.created_at)} · 댓글 ${p.comment_count}</span></a>`).join("")
            : `<span class="none">첫 글의 주인공이 되어보세요</span>`}
        </div>
      </div>`;
  }).join("");

  const FEATURES = [
    ["우선순위 순위표", "매일 아침 전체 종목을 신호 강도순으로 줄 세워, 가장 먼저 볼 종목을 알려줘요",
      '<path d="M4 6h16M4 12h10M4 18h6"/>'],
    ["6일 가격 예측 차트", "15개 예측 모델이 그린 앞으로 6일의 종가·고점·저점 흐름을 한 차트로 비교해요",
      '<path d="M4 17l5-6 4 3 7-9"/><path d="M15 5h5v5"/>'],
    ["D+1 신호등과 해석", "모델들이 얼마나 한 방향으로 모였는지로 상승·혼돈·하락을 판정하고, 이유를 풀어서 설명해요",
      '<circle cx="12" cy="6" r="2.2"/><circle cx="12" cy="12" r="2.2"/><circle cx="12" cy="18" r="2.2"/>'],
  ];
  const features = FEATURES.map(([t, d, icon]) => `
    <div class="feature">
      <span class="f-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg></span>
      <b>${t}</b><p>${d}</p>
    </div>`).join("");

  const LOGO = '<span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>';
  document.body.classList.add("home", "landing");
  document.body.insertAdjacentHTML("beforeend", `
    <header class="topbar">
      <a class="brand" href="index.html">${LOGO}<b><span class="ai">AI</span>신호등</b></a>
      <nav class="nav">
        <a href="login.html">로그인</a>
        <a class="btn sm cta-top" href="${SIGNUP}">무료로 시작하기</a>
      </nav>
    </header>

    <main class="page">
      <section class="l-hero on-night">
        <div class="l-copy">
          <span class="badge l-badge">가입 후 ${cfg.TRIAL_DAYS}일 무료</span>
          <h1>코인·나스닥·코스피<br>내일의 방향을 <span class="hl">신호등</span>으로</h1>
          <p class="lead">15개 AI 모델이 매일 그리는 6일 예측을 상승·혼돈·하락 세 가지 불빛으로 정리해 드려요. 복잡한 차트 전에 신호부터 확인하세요.</p>
          <div class="l-cta">
            <a class="btn big" href="${SIGNUP}">${cfg.TRIAL_DAYS}일 무료로 시작하기</a>
            <a class="btn big ghost-night" href="login.html">로그인</a>
          </div>
          <p class="l-note">닉네임과 이메일만 있으면 가입돼요 · 카드 등록 없음</p>
        </div>
        <div class="l-lamp" aria-hidden="true">
          <div class="lamp big up"><i></i><i></i><i></i></div>
        </div>
      </section>

      <section class="section">
        <div class="section-head on-night">
          <div><h2>오늘의 신호 미리보기</h2>
          <p class="hint">매일 업데이트돼요. 가입하면 전체 순위와 차트, 해석까지 모두 볼 수 있어요</p></div>
        </div>
        <div class="grid3">${cards}</div>
      </section>

      <section class="section">
        <div><h2>이런 걸 볼 수 있어요</h2><p class="hint">시장마다 우선순위와 가격 차트 두 화면으로 나눠 보여드려요</p></div>
        <div class="grid3 features">${features}</div>
      </section>

      <section class="card pricing">
        <div>
          <h2>가격</h2>
          <p class="hint">가입 후 ${cfg.TRIAL_DAYS}일은 모든 탭이 무료예요. 이후 보고 싶은 시장만 골라서 이어 보세요</p>
        </div>
        <div class="price-row">
          <div><small>시장 1개</small><b>${won(cfg.PRICE_1M[0])}</b><span>/ 1달</span></div>
          <div><small>시장 2개</small><b>${won(cfg.PRICE_1M[1])}</b><span>/ 1달</span></div>
          <div><small>3개 전체</small><b>${won(cfg.PRICE_1M[2])}</b><span>/ 1달</span></div>
        </div>
        <p class="hint" style="font-size:12.5px">3달 10% · 6달 20% · 1년 40% 할인 · 계좌이체</p>
      </section>

      <section class="section">
        <div><h2>회원 커뮤니티</h2><p class="hint">시장별 게시판에서 서로 의견을 나눠요</p></div>
        <div class="grid3">${boardCols}</div>
      </section>

      <section class="l-final">
        <div class="lamp small" aria-hidden="true"><i></i><i></i><i></i></div>
        <h2>오늘의 신호, 지금 무료로 확인하세요</h2>
        <p>가입 후 ${cfg.TRIAL_DAYS}일 동안 코인·나스닥·코스피200 전체를 볼 수 있어요</p>
        <a class="btn big" href="${SIGNUP}">무료로 시작하기</a>
      </section>

      <p class="hint" style="font-size:12px;color:var(--faint);line-height:1.6;text-align:center">
        이 사이트의 정보는 예측 모델의 출력을 정리해 보여주는 참고 자료이며, 투자 권유나 종목 추천이 아닙니다.<br>
        투자 판단과 그 결과에 대한 책임은 이용자 본인에게 있습니다.
      </p>
    </main>`);

  // 큰 신호등: 빨강 → 노랑 → 파랑 순서로 천천히 바뀜 (움직임 줄이기 설정이면 멈춤)
  const lamp = document.querySelector(".lamp.big");
  if (lamp && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const seq = ["up", "mx", "dn"];
    let i = 0;
    setInterval(() => { lamp.classList.remove(seq[i]); i = (i + 1) % 3; lamp.classList.add(seq[i]); }, 2200);
  }
};
