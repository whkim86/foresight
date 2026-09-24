// 모든 페이지 공통: Supabase 클라이언트, 로그인 확인, 이용 권한 계산, 상단 헤더
(function () {
  const cfg = window.PORTAL_CONFIG;
  const configured = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  const sb = configured ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const DAY = 86400000;

  const LOGO =
    '<span class="brand-mark"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg></span>';

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
           ${me.acc.isAdmin ? link("admin.html", "운영자", ["admin.html", "accuracy.html"]) : ""}
           ${link("mypage.html", "마이페이지")}
           ${link("board.html", "게시판", ["board.html", "post.html", "write.html"])}
           <span class="nav-sep"></span>
           <span class="me"><span class="avatar" aria-hidden="true">${esc(nick.slice(0, 1))}</span>
           <button class="linkbtn" id="logoutBtn" type="button">로그아웃</button></span>
         </nav>`
      : "";
    document.body.insertAdjacentHTML(
      "afterbegin",
      `<header class="topbar"><a class="brand" href="index.html">${LOGO}<span>예측 포털</span></a>${right}</header>`
    );
    const btn = document.getElementById("logoutBtn");
    if (btn) btn.addEventListener("click", async () => { await sb.auth.signOut(); location.replace("login.html"); });
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

  window.Portal = { sb, cfg, configured, requireUser, renderHeader, esc, won, ymd, ago, daysLeft, price, access, errText, confirmClick, ICONS, DAY };
})();
