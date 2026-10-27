// 모든 페이지 공통: Supabase 클라이언트, 로그인 확인, 이용 권한 계산, 상단 헤더
(function () {
  const cfg = window.PORTAL_CONFIG;
  const configured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const DAY = 86400000;

  // 로고: 빨강·노랑·파랑 신호등
  const LOGO = '<span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span>';

  const ICONS = {
    coin: '<span class="icon-box red"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#D92D3A" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 8v8M9.5 10a2.4 2.4 0 0 1 2.5-1.8c1.4 0 2.5.8 2.5 1.8s-1 1.6-2.5 1.8c-1.5.2-2.5.8-2.5 1.8s1.1 1.8 2.5 1.8a2.4 2.4 0 0 0 2.5-1.8"/></svg></span>',
    nasdaq: '<span class="icon-box blue"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563D9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 16l5-6 4 3 7-9"/><path d="M15 4h5v5"/></svg></span>',
    kospi: '<span class="icon-box blue"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563D9" stroke-width="2" stroke-linecap="round"><rect x="5" y="10" width="3" height="9"/><rect x="10.5" y="6" width="3" height="13"/><rect x="16" y="13" width="3" height="6"/></svg></span>',
    lock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  };

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const won = (n) => Number(n).toLocaleString("ko-KR") + "원";
  function ymd(d) {
    if (!d) return "";
    d = new Date(d);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  // "방금 전", "3시간 전", "어제", 그 이상은 날짜
  function ago(d) {
    const s = (Date.now() - new Date(d)) / 1000;
    if (s < 60) return "방금 전";
    if (s < 3600) return Math.floor(s / 60) + "분 전";
    if (s < 86400) return Math.floor(s / 3600) + "시간 전";
    if (s < 172800) return "어제";
    if (s < 604800) return Math.floor(s / 86400) + "일 전";
    return ymd(d);
  }
  const daysLeft =(d) => Math.max(0, Math.ceil((new Date(d) - Date.now()) / DAY));

  // 가격: 1달은 정가, 장기는 할인 후 1,000원 단위 내림 (stage2.sql plan_price 와 동일)
  function price(nTabs, months) {
    if (!nTabs) return 0;
    const base = cfg.PRICE_1M[nTabs - 1];
    const plan = cfg.PLANS.find((p) => p.months === months);
    if (months === 1) return base;
    return Math.floor((base * months * (1 - plan.discount)) / 1000) * 1000;
  }

  // 탭별 열람 가능 여부. 무료체험 중이면 전부 열림, 이후엔 탭별 만료일 기준
  function access(profile) {
    const joined = new Date(profile.joined_at);
    const trialEnd = new Date(joined.getTime() + cfg.TRIAL_DAYS * DAY);
    const now = new Date();
    const inTrial = now < trialEnd;
    const isAdmin = profile.role === "admin";
    const tabs = {};
    for (const key of Object.keys(cfg.MARKETS)) {
      const until = profile[key + "_until"] ? new Date(profile[key + "_until"]) : null;
      const paid = Boolean(until && until > now);
      tabs[key] = { open: isAdmin || inTrial || paid, paid, until: paid ? until : null };
    }
    return { joined, trialEnd, inTrial, isAdmin, tabs, anyOpen: Object.values(tabs).some((t) => t.open) };
  }

  function setupNotice() {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="page"><div class="card center-note msg warn">
        Supabase 연결 정보가 아직 없어요. <code>config.js</code>에 <b>SUPABASE_URL</b>과 <b>SUPABASE_ANON_KEY</b>를 넣어주세요.
      </div></div>`
    );
  }

  // 로그인 안 돼 있으면 로그인 화면으로 보냄. 로그인돼 있으면 { user, profile, acc } 반환
  async function requireUser() {
    if (!sb) { setupNotice(); return null; }
    const { data: { session } } = await sb.auth.getSession();
    if (!session) {
      location.replace("login.html?next=" + encodeURIComponent(location.pathname.split("/").pop() + location.search));
      return null;
    }
    const user = session.user;
    const { data: profile } = await sb.from("profiles").select("*").eq("id", user.id).maybeSingle();
    const p = profile || {
      nickname: user.user_metadata?.nickname || user.email.split("@")[0],
      joined_at: user.created_at,
      role: "member",
    };
    return { user, profile: p, acc: access(p) };
  }

  function renderHeader(me) {
    const nick = me?.profile?.nickname || "";
    const here = location.pathname.split("/").pop();
    const link = (href, label, pages = [href]) => `<a href="${href}" ${pages.includes(here) ? 'aria-current="page"' : ""}>${label}</a>`;
    const right = me
      ? `<nav class="nav">
           ${me.acc.isAdmin ? link("admin.html", "운영자", ["admin.html", "accuracy.html", "ai.html", "models.html", "patterns.html", "views.html", "analytics.html"]) : ""}
           ${link("game.html", `<span class="lbl-l">🐯 모의투자</span><span class="lbl-s">🐯</span>`)}
           ${link("catalog.html", `<span class="lbl-l">종목 카탈로그</span><span class="lbl-s">종목</span>`)}
           ${link("mypage.html", "마이페이지")}
           ${link("board.html", "게시판", ["board.html", "post.html", "write.html"])}
           <span class="nav-sep"></span>
           <span class="me"><span class="avatar" aria-hidden="true">${esc(nick.slice(0, 1))}</span>
           <button class="linkbtn" id="logoutBtn" type="button">로그아웃</button></span>
         </nav>`
      : "";
    document.body.insertAdjacentHTML(
      "afterbegin",
      `<header class="topbar"><a class="brand" href="index.html">${LOGO}<b><span class="ai">AI</span>신호등</b></a>${right}</header>`
    );
    const btn = document.getElementById("logoutBtn");
    if (btn) btn.addEventListener("click", async () => { await sb.auth.signOut(); location.replace("login.html"); });
    if (me) friendNav();
    try { const t = sessionStorage.getItem("portalToast"); if (t) { sessionStorage.removeItem("portalToast"); setTimeout(() => toast(t), 400); } } catch (e) {}
  }

  // ---------- 신호등 친구들 (supabase/stage28.sql game_card) ----------
  // 내 친구 카드: 한 화면에서 한 번만 부름 (부를 때 출석 보너스도 지급됨)
  let cardP = null;
  const gameCard = () => cardP || (cardP = sb.rpc("game_card").then((r) => r.error ? null : r.data).catch(() => null));
  // 캐릭터 그림(game-chars.js)은 필요할 때만 불러옴
  let charsP = null;
  const loadChars = () => window.GameChars ? Promise.resolve(window.GameChars) : charsP || (charsP = new Promise((ok) => {
    const s = document.createElement("script");
    s.src = (document.querySelector('script[src*="assets/app.js"]').getAttribute("src").replace(/app\.js.*$/, "")) + "game-chars.js?v=20261029f";
    s.onload = () => ok(window.GameChars); s.onerror = () => ok(null);
    document.head.appendChild(s);
  }));
  const dressOf = (c) => ({ hat: c.hat, outfit: c.outfit, shoes: c.shoes, pt: (c.points || 0) + (c.invested || 0) });
  // 상단 메뉴 '🐯 모의투자' → 내 캐릭터 얼굴 + Lv, 출석 보너스를 받았으면 잠깐 알림
  async function friendNav() {
    const c = await gameCard();
    if (!c || !c.joined) return;
    const G = await loadChars();
    const a = document.querySelector('.topbar a[href="game.html"]');
    if (!G || !a) return;
    a.classList.add("nav-friend");
    a.innerHTML = `<span class="nf-face">${G.draw(c.character, dressOf(c), "nav", true).replace(/viewBox="[^"]*"/, 'viewBox="38 2 124 124"')}</span><span class="lbl-l">Lv.${c.level}</span>`;
    if (c.bonus_now > 0) toast(`🎁 출석 보너스 +${Number(c.bonus_now).toLocaleString("ko-KR")}P`);
  }
  // 화면을 옮기기 직전에 생긴 알림은 다음 화면에서 보여 줌
  function toast(text, nextPage) {
    if (nextPage) { try { sessionStorage.setItem("portalToast", text); } catch (e) {} return; }
    const t = document.createElement("div");
    t.className = "portal-toast"; t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("out"), 2600);
    setTimeout(() => t.remove(), 3200);
  }
  // 오늘의 보너스 (chart: 대시보드 보드를 열었을 때 / post: 글을 쓴 뒤)
  async function gameBonus(kind) {
    const c = await gameCard();
    if (!c || !c.joined || (c.missions && c.missions[kind])) return;
    const { data } = await sb.rpc("game_bonus", { p_kind: kind });
    if (data && data.given > 0) { c.missions[kind] = true; toast(`🎁 ${kind === "post" ? "글쓰기" : "차트 보기"} 보너스 +${Number(data.given).toLocaleString("ko-KR")}P`, kind === "post"); }
  }

  // Supabase 오류 메시지에서 우리가 raise 한 한국어 문장만 꺼냄
  const errText = (e) => (e && (e.message || e.details)) || "알 수 없는 오류가 났어요";

  // 팝업(confirm) 대신 버튼 두 번 누르기로 확인. 첫 클릭엔 문구가 바뀌고 false, 4초 안에 다시 누르면 true
  // (앱 내장 브라우저 등 confirm 창이 막힌 환경에서도 동작하도록)
  function confirmClick(btn, text) {
    if (btn.dataset.armed) {
      clearTimeout(btn._disarm);
      delete btn.dataset.armed;
      btn.textContent = btn._label;
      btn.classList.remove("red");
      return true;
    }
    btn._label = btn.textContent;
    btn.dataset.armed = "1";
    btn.textContent = text;
    btn.classList.add("red");
    btn._disarm = setTimeout(() => {
      delete btn.dataset.armed;
      btn.textContent = btn._label;
      btn.classList.remove("red");
    }, 4000);
    return false;
  }

  // ---------- 방문 흐름 기록 (supabase/stage17.sql log_event, 운영자 화면 analytics.html) ----------
  // 방문(세션): 같은 브라우저 탭에서 30분 넘게 쉬지 않고 이어진 이용. 30분 쉬면 새 방문
  // 머문 시간: 그 화면이 실제로 보이는 동안(다른 탭·최소화 제외), 마지막 조작(클릭·스크롤·키·터치) 후 5분까지만 셈
  const PortalEvents = (function () {
    if (!sb) return { view() {}, leave() {}, log() {}, act() {} };
    const IDLE = 5 * 60 * 1000, GAP = 30 * 60 * 1000;
    let sid = null;
    try {
      const s = JSON.parse(sessionStorage.getItem("ai_sid") || "null");
      if (s && Date.now() - s.t < GAP) sid = s.id;
    } catch (e) {}
    if (!sid) sid = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    const touch = () => { try { sessionStorage.setItem("ai_sid", JSON.stringify({ id: sid, t: Date.now() })); } catch (e) {} };
    touch();

    let token = cfg.SUPABASE_ANON_KEY;  // 로그인했으면 회원 토큰으로 (운영자 제외·회원 구분은 서버에서)
    sb.auth.getSession().then(({ data }) => { if (data.session) token = data.session.access_token; });
    sb.auth.onAuthStateChange((_e, s) => { token = s ? s.access_token : cfg.SUPABASE_ANON_KEY; });

    // 페이지를 닫는 순간에도 전송되도록 keepalive
    function send(body) {
      touch();
      try {
        fetch(cfg.SUPABASE_URL + "/rest/v1/rpc/log_event", {
          method: "POST", keepalive: true,
          headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify(Object.assign({ p_session: sid }, body)),
        }).catch(() => {});
      } catch (e) {}
    }

    let page = null, acc = 0, since = 0, lastAct = Date.now();
    const visible = () => document.visibilityState === "visible";
    function pause() {  // 지금까지의 시간을 더하고 멈춤 (마지막 조작 후 5분 넘은 부분은 빼고)
      if (since) { acc += Math.max(0, Math.min(Date.now(), lastAct + IDLE) - since); since = 0; }
    }
    function resume() { if (page && !since && visible()) since = Date.now(); }
    function act() {
      const now = Date.now();
      if (since && now - lastAct > IDLE) { acc += Math.max(0, lastAct + IDLE - since); since = now; }
      lastAct = now;
      resume();
    }
    function flush(force) {  // 머문 시간 보내기 (화면을 떠날 때, 탭을 숨길 때)
      pause();
      if (page && (force || acc >= 500)) send({ p_kind: "leave", p_page: page, p_dur_ms: Math.round(acc) });
      acc = 0;
    }
    function leave() { flush(true); page = null; }
    function view(p) {
      if (page) leave();
      page = p; acc = 0; lastAct = Date.now();
      resume();
      send({ p_kind: "view", p_page: p });
    }
    ["pointerdown", "keydown", "touchstart", "mousemove", "wheel"].forEach((t) => addEventListener(t, act, { passive: true, capture: true }));
    addEventListener("scroll", act, { passive: true, capture: true });
    document.addEventListener("visibilitychange", () => {
      if (visible()) { lastAct = Date.now(); resume(); } else flush(false);
    });
    addEventListener("pagehide", () => flush(false));
    return { view, leave, act, log: (body) => send(body) };
  })();
  window.PortalEvents = PortalEvents;  // 대시보드 안 보드(iframe)가 종목 선택·검색을 여기로 보냄

  // 화면 조회수 +1 (운영자는 서버에서 제외) + 방문 흐름 기록. 실패해도 화면에는 영향 없음
  function track(page) {
    if (sb) sb.rpc("track_page", { p_page: page }).then(() => {}, () => {});
    PortalEvents.view(page);
  }

  // 수집·통계 단위 시장 목록: 코인 탭은 거래소별(업비트=coin, 빗썸=bithumb)로 펼침
  const DATA_MARKETS = Object.entries(cfg.MARKETS).flatMap(([tab, m]) =>
    (m.exchanges || [{ data: tab }]).map((x) => ({ key: x.data, tab, name: x.label ? `${m.name}(${x.label})` : m.name })));
  const marketName = (k) => DATA_MARKETS.find((x) => x.key === k)?.name || cfg.MARKETS[k]?.name || k;

  window.Portal = { sb, cfg, DATA_MARKETS, marketName, configured, requireUser, renderHeader, esc, won, ymd, ago, daysLeft, price, access, errText, confirmClick, track, ICONS, DAY, gameCard, loadChars, dressOf, gameBonus, toast };
})();
