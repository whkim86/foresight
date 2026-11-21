// 가격 차트의 '긴 기간' 보기 — 기간(2주~5년)·라인/캔들·보조지표 (차트 개편 3단계, 2026-11-17)
//  · 기본은 2주 새 차트. '예측 모델 선 보기'를 누르면 원래 화면(모델 52개 선·중앙값·고점/저점) 그대로
//  · 기간을 고르면 그 자리에 TradingView Lightweight Charts 로 가격 원장(ingest/prices.py, <시장>/prices/) + 예측 중앙값·25~75% 범위
//  · 원본 화면이 종목을 그릴 때 portalLong(P, co, pd) 를 부름 (자리는 tools/import_boards.py 가 넣음)
//  · 고른 설정은 브라우저에 저장 (longChart.v1). 미리보기 화면(boards/chart_preview.html)과 계산 방식이 같음
(function () {
  const board = window.PORTAL_BOARD;
  if (!board || board.kind !== "chart") return;
  const LIB = "https://cdn.jsdelivr.net/npm/lightweight-charts@5.0.9/dist/lightweight-charts.standalone.production.js";
  const PERIODS = [[14, "2주"], [31, "1달"], [92, "3달"], [183, "6달"], [366, "1년"], [1830, "5년"]];
  const KEY = "longChart.v2";  // v2: 기본을 2주 새 차트로 (2026-11-17 사용자 요청)
  let pref = { period: 14, type: "candle", ma: [20], bb: false, fib: false, sub: "vol", rules: true };  // rules: 📐 차트 분석 (2026-11-20 처음부터 켬)
  try { Object.assign(pref, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch (e) {} };

  const style = document.createElement("style");
  style.textContent = `
  :root{--ma5:#F59E0B;--ma15:#10B981;--ma20:#8B5CF6;--ma60:#0EA5E9;--ma120:#EC4899;--bb:#64748B;--fib:#B45309;--rsi:#7C3AED;--macd:#2563EB;--sig:#F97316;--lc-band:rgba(16,26,51,.10)}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ma5:#FBBF24;--ma15:#34D399;--ma20:#A78BFA;--ma60:#38BDF8;--ma120:#F472B6;--bb:#94A3B8;--fib:#F0B75A;--rsi:#C084FC;--macd:#60A5FA;--sig:#FB923C;--lc-band:rgba(233,237,246,.13)}}
  :root[data-theme="dark"]{--ma5:#FBBF24;--ma15:#34D399;--ma20:#A78BFA;--ma60:#38BDF8;--ma120:#F472B6;--bb:#94A3B8;--fib:#F0B75A;--rsi:#C084FC;--macd:#60A5FA;--sig:#FB923C;--lc-band:rgba(233,237,246,.13)}
  .lc-bar{display:flex;flex-direction:column;gap:7px;margin:2px 0 10px}
  .lc-row{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}
  .lc-cap{font-size:12.5px;color:var(--muted);min-width:52px}
  .lc-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line-strong);background:transparent;border-radius:999px;padding:3px 11px 3px 9px;font-size:12.5px;font-weight:500}
  .lc-chip i{width:14px;height:3px;border-radius:2px;display:inline-block}
  .lc-model{font-weight:600;border-color:var(--ink)}
  .lc-chip[aria-pressed="true"]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
  .lc-box{position:relative;height:440px}
  .lc-chart{position:absolute;inset:0}
  .lc-leg{position:absolute;left:8px;top:6px;z-index:3;pointer-events:none;font-size:12.5px;line-height:1.5;background:color-mix(in srgb,var(--surface) 82%,transparent);border-radius:8px;padding:4px 8px;max-width:calc(100% - 80px)}
  .lc-leg b{font-weight:600}.lc-leg .k{color:var(--muted);margin-right:3px}.lc-leg span+span{margin-left:8px}
  .lc-leg .u{color:var(--up-text)}.lc-leg .d{color:var(--dn-ink)}
  .lc-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--muted);padding:20px;z-index:4;background:var(--surface)}
  .lc-fine{font-size:12.5px;color:var(--muted);margin-top:8px}
.lc-fsb{margin-left:auto}
  html.lc-fs-lock{overflow:hidden}
  .chart-card.lc-fs{position:fixed;inset:0;z-index:9999;margin:0;border-radius:0;border:0;max-width:none;width:100vw;height:100vh;height:100dvh;overflow:auto;
    background:var(--surface);padding:12px 14px;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto minmax(0,1fr);gap:6px}
  .chart-card.lc-fs>*:not(.chart-top):not(.lc-bar):not(.lc-wrap){display:none!important}
  .chart-card.lc-fs .chart-top{margin:0}
  .chart-card.lc-fs .lc-bar{margin:0}
  .chart-card.lc-fs .lc-wrap{display:flex;flex-direction:column;min-height:0}
  .chart-card.lc-fs .lc-box{flex:1;height:auto;min-height:300px}
  .chart-card.lc-fs .lc-fine{display:none}
  .chart-card.lc-fs .lc-row{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:thin;padding-bottom:2px}
  .chart-card.lc-fs .lc-row>*,.chart-card.lc-fs .seg{flex:none}
  .chart-card.lc-fs .seg{display:inline-flex;flex-wrap:nowrap}
  .chart-card.lc-fs .lc-fsb{position:fixed;top:10px;right:12px;z-index:10;background:var(--ink);color:var(--paper)}
  .chart-card.lc-fs .chart-top{padding-right:150px}
  @media (min-width:1000px),(orientation:landscape) and (min-width:640px){
    .chart-card.lc-fs .lc-row{flex-wrap:wrap;overflow:visible}
    .chart-card.lc-fs .seg{flex-wrap:wrap}
    .chart-card.lc-fs{grid-template-columns:minmax(0,1fr) clamp(220px,24vw,290px);grid-template-rows:auto minmax(0,1fr);padding:14px 18px;gap:8px 18px}
    .chart-card.lc-fs .chart-top{grid-column:1/-1}
    .chart-card.lc-fs .lc-bar{grid-column:2;grid-row:2;align-self:start;gap:14px;overflow:auto;max-height:100%}
    .chart-card.lc-fs .lc-wrap{grid-column:1;grid-row:2}
    .chart-card.lc-fs .lc-row{gap:7px}
    .chart-card.lc-fs .lc-cap{width:100%;font-weight:600}
    .chart-card.lc-fs .lc-fsb{position:static;margin-left:0;order:-1;width:100%;justify-content:center}
    .chart-card.lc-fs .chart-top{padding-right:0}
  }
  @media (max-width:560px){.lc-box{height:370px}.lc-bar{gap:5px}.lc-row{gap:5px 6px}.lc-cap{min-width:0;font-size:12px}
    .lc-bar .seg button{padding:4px 8px}.lc-chip{padding:2px 9px 2px 7px}}`;
  document.head.appendChild(style);

  /* ---------- 데이터 ---------- */
  let libP = null, idxP = null;
  const prices = {};
  function loadLib() {
    if (window.LightweightCharts) return Promise.resolve();
    return libP || (libP = new Promise((ok, fail) => { const s = document.createElement("script"); s.src = LIB; s.onload = ok; s.onerror = fail; document.head.appendChild(s); }));
  }
  async function getText(path, gz) {
    const { data, error } = await window.portalSb.storage.from("forecasts").download(path);
    if (error || !data) throw { code: 403 };
    return gz ? await (await window.portalGunzip(data)).text() : await data.text();
  }
  function loadIndex() { return idxP || (idxP = getText(`${board.market}/prices/index.json`).then(JSON.parse).catch((e) => { idxP = null; throw e; })); }
  async function loadPrices(sym) {
    const idx = await loadIndex(), f = idx.files[sym];
    if (!f) return null;
    return prices[sym] || (prices[sym] = getText(`${board.market}/prices/${f}`, true).then(JSON.parse).catch((e) => { delete prices[sym]; throw e; }));
  }

  /* ---------- 계산 ---------- */
  // 📐 차트 분석 데이터 (비공개 계산기 whkim86/chart-rules → <시장>/rules/, 2026-11-20 B안)
  let rIdxP = null;
  const rules = {};
  function loadRules(sym) {
    if (!rIdxP) rIdxP = getText(`${board.market}/rules/index.json`).then(JSON.parse).catch(() => ({ files: {} }));
    return rules[sym] || (rules[sym] = rIdxP.then((idx) => {
      const f = idx.files && idx.files[sym];
      return f ? getText(`${board.market}/rules/${f}`).then(JSON.parse) : null;
    }).catch(() => null));
  }
  // 종목 고르기 '🧩 패턴순' 정렬용 (2026-11-22): index.json 의 pat = {종목: [점수, "상승 깃발 완성", [경고]]}
  window.portalRulesIndex = function () {
    if (!rIdxP) rIdxP = getText(`${board.market}/rules/index.json`).then(JSON.parse).catch(() => ({ files: {} }));
    return rIdxP;
  };

  function isoFromMD(md, ref) {
    const m = String(md).match(/(\d{1,2})\s*-\s*(\d{1,2})/); if (!m) return null;
    let best = null;
    [-1, 0, 1].forEach((k) => { const t = Date.UTC(ref.getUTCFullYear() + k, +m[1] - 1, +m[2]); if (best === null || Math.abs(t - ref) < Math.abs(best - ref)) best = t; });
    return new Date(best).toISOString().slice(0, 10);
  }
  const qtl = (s, p) => { const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
  function sma(v, n) { const o = []; let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= n) s -= v[i - n]; o.push(i >= n - 1 ? s / n : null); } return o; }
  function ema(v, n) { const o = [], k = 2 / (n + 1); let e = null; for (let i = 0; i < v.length; i++) { e = e === null ? v[i] : v[i] * k + e * (1 - k); o.push(i >= n - 1 ? e : null); } return o; }
  function stdev(v, n, m) { return v.map((_, i) => { if (m[i] === null) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) s += (v[j] - m[i]) ** 2; return Math.sqrt(s / n); }); }
  function rsi(v, n) {
    const o = [null]; let g = 0, l = 0;
    for (let i = 1; i < v.length; i++) {
      const d = v[i] - v[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n) { g += up; l += dn; if (i === n) { g /= n; l /= n; o.push(l === 0 ? 100 : 100 - 100 / (1 + g / l)); } else o.push(null); }
      else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; o.push(l === 0 ? 100 : 100 - 100 / (1 + g / l)); }
    }
    return o;
  }
  function weekly(bars) {
    const out = []; let cur = null;
    bars.forEach((b) => {
      const t = new Date(b.time + "T00:00:00Z"), wk = new Date(t - ((t.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
      if (!cur || cur.time !== wk) { cur = Object.assign({}, b, { time: wk, value: b.value || 0 }); out.push(cur); }
      else { cur.high = Math.max(cur.high, b.high); cur.low = Math.min(cur.low, b.low); cur.close = b.close; cur.value += b.value || 0; cur.est = cur.est || b.est; }
    });
    return out;
  }
  function fmt(v) {
    if (v == null || !isFinite(v)) return "-";
    const a = Math.abs(v);
    if (a >= 1000) return Math.round(v).toLocaleString("ko-KR");
    if (a >= 1) return v.toLocaleString("ko-KR", { maximumFractionDigits: 2 });
    return v.toLocaleString("ko-KR", { maximumSignificantDigits: 4 });
  }
  const fmtVol = (v) => { const a = Math.abs(v); return a >= 1e8 ? (v / 1e8).toFixed(1) + "억" : a >= 1e4 ? (v / 1e4).toFixed(1) + "만" : fmt(v); };
  const pct = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(2) + "%";
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const PF = { type: "custom", formatter: fmt, minMove: 1e-8 };

  /* ---------- 패널마다 ---------- */
  function setup(P) {
    if (P.lc) return P.lc;
    const card = P.root.querySelector(".chart-card");
    const bar = document.createElement("div");
    bar.className = "lc-bar";
    bar.innerHTML =
      '<div class="lc-row"><span class="lc-cap">기간</span><div class="seg lc-per" role="group" aria-label="기간">' +
      PERIODS.map(([d, t]) => `<button type="button" data-p="${d}">${t}</button>`).join("") + "</div>" +
      '<button type="button" class="lc-chip lc-model" data-p="0" title="최근 2주 실제값과 예측 모델 52개의 선을 하나씩 켜고 끄며 봐요">예측 모델 선 보기</button><button type="button" class="lc-chip lc-fsb" data-fs="1" title="차트를 화면 가득 크게 봐요 (Esc 로 닫기)">⛶ 전체화면</button></div>' +
      '<div class="lc-more"><div class="lc-row"><span class="lc-cap">차트</span><div class="seg" role="group" aria-label="차트 종류"><button type="button" data-t="line">라인</button><button type="button" data-t="candle">캔들</button></div><button type="button" class="lc-chip" data-o="log" title="가격 축을 비율(로그)로 바꿔요. 오르내린 폭이 큰 종목에서 추세선이 고점·저점에 곧게 맞아요">로그 축</button></div>' +
      '<div class="lc-row"><span class="lc-cap">겹쳐 보기</span>' +
      [5, 15, 20, 60, 120].map((n, i) => `<button type="button" class="lc-chip" data-ma="${n}"><i style="background:var(--ma${n})"></i>${i ? n : "이동평균 5"}</button>`).join("") +
      '<button type="button" class="lc-chip" data-o="bb"><i style="background:var(--bb)"></i>볼린저 밴드</button>' +
      '<button type="button" class="lc-chip" data-o="fib"><i style="background:var(--fib)"></i>피보나치 되돌림</button>' +
      '<button type="button" class="lc-chip" data-o="rules" title="저항선·지지선·앞으로 볼 자리·예상 흐름을 자동으로 그려요"><i style="background:#7C4DFF"></i>📐 차트 분석</button></div>' +
      '<div class="lc-row"><span class="lc-cap">아래 칸</span><div class="seg" role="group" aria-label="아래 칸 지표">' +
      '<button type="button" data-s="">없음</button><button type="button" data-s="vol">거래량</button><button type="button" data-s="rsi">RSI</button><button type="button" data-s="macd">MACD</button></div></div></div>';
    const box = document.createElement("div");
    box.className = "lc-wrap";
    box.innerHTML = '<div class="lc-box"><div class="lc-chart"></div><div class="lc-leg"></div><div class="lc-empty">불러오는 중…</div></div>' +
      '<p class="lc-fine"></p><p class="lc-fine">오른쪽 음영 구간이 예측이에요: 굵은 점선은 모델 중앙값, 옅은 띠는 모델 25~75% 범위예요. 1년·5년은 주봉이에요. 끌어서 지난 기간도 볼 수 있어요. 모델별 선·고점·저점은 \'예측 모델 선 보기\'에서 봐요. 보조지표는 과거 가격으로 계산한 참고값이에요. 차트: TradingView Lightweight Charts™</p>';
    const top = card.querySelector(".chart-top");
    top.insertAdjacentElement("afterend", bar);
    P.el.chart.insertAdjacentElement("afterend", box);
    P.lc = { bar, box, el: { chart: box.querySelector(".lc-chart"), leg: box.querySelector(".lc-leg"), empty: box.querySelector(".lc-empty"), note: box.querySelector(".lc-fine") }, chart: null, S: {}, data: null };
    bar.addEventListener("click", (ev) => {
      const b = ev.target.closest("button"); if (!b) return;
      if (b.dataset.fs) { fullscreen(P); return; }
      if (b.dataset.p !== undefined) pref.period = +b.dataset.p;
      else if (b.dataset.t) pref.type = b.dataset.t;
      else if (b.dataset.ma) { const n = +b.dataset.ma, i = pref.ma.indexOf(n); if (i >= 0) pref.ma.splice(i, 1); else pref.ma.push(n); pref.ma.sort((a, c) => a - c); }
      else if (b.dataset.o) pref[b.dataset.o] = !pref[b.dataset.o];
      else if (b.dataset.s !== undefined) pref.sub = b.dataset.s;
      else return;
      save();
      (window.portalPanels || []).forEach((Q) => { if (Q.lc) apply(Q, b.dataset.p !== undefined); });
    });
    return P.lc;
  }

  // 전체화면 (2026-11-21): 차트 카드를 화면 가득. 넓은 화면은 선택 버튼을 오른쪽, 좁은 화면은 위쪽
  function fsOn(P) { return P.root.querySelector(".chart-card").classList.contains("lc-fs"); }
  function fullscreen(P, off) {
    const card = P.root.querySelector(".chart-card");
    const on = off ? false : !fsOn(P);
    if (on) {
      card.classList.add("lc-fs"); document.documentElement.classList.add("lc-fs-lock");
      if (card.requestFullscreen) card.requestFullscreen().catch(() => {});
    } else {
      card.classList.remove("lc-fs"); document.documentElement.classList.remove("lc-fs-lock");
      if (document.fullscreenElement === card) document.exitFullscreen().catch(() => {});
    }
    const b = P.lc.bar.querySelector("[data-fs]"); b.setAttribute("aria-pressed", on); b.textContent = on ? "✕ 전체화면 닫기" : "⛶ 전체화면";
    setTimeout(() => { if (P.lc.data && pref.period > 0) draw(P); }, 200);  // 아래 칸 높이 비율을 새 크기로
  }
  document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement) (window.portalPanels || []).forEach((Q) => { if (Q.lc && fsOn(Q)) fullscreen(Q, true); }); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") (window.portalPanels || []).forEach((Q) => { if (Q.lc && fsOn(Q)) fullscreen(Q, true); }); });

  function sync(P) {
    const L = P.lc, long = pref.period > 0;
    L.bar.querySelectorAll("[data-p]").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.p === pref.period));
    L.bar.querySelectorAll("[data-t]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.t === pref.type));
    L.bar.querySelectorAll("[data-ma]").forEach((b) => b.setAttribute("aria-pressed", pref.ma.includes(+b.dataset.ma)));
    L.bar.querySelectorAll("[data-o]").forEach((b) => b.setAttribute("aria-pressed", !!pref[b.dataset.o]));
    L.bar.querySelectorAll("[data-s]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.s === (pref.sub || "")));
    L.bar.querySelector(".lc-more").hidden = !long;
    L.bar.querySelector("[data-fs]").hidden = !long;
    if (!long && fsOn(P)) fullscreen(P, true);
    L.box.hidden = !long;
    // 원래 화면 부분: 종가·고점·저점 전환, 모델 범례, 그래프
    P.el.chart.hidden = long;
    P.el.legend.hidden = long;
    if (P.el.seg) P.el.seg.hidden = long;
    const pat = P.root.querySelector(".pat-note"); if (pat) pat.style.display = long ? "none" : "";
  }

  function apply(P, periodChanged) {
    sync(P);
    if (pref.period > 0) { if (P.lc.data && P.lc.data.sym === P.coin) draw(P); else load(P); }
    else if (periodChanged) P.draw();  // 숨겨져 있던 원래 그래프를 지금 폭으로 다시
  }

  // 일봉: 가격 원장 + 원장보다 새로운 실제값(예측 CSV). 지난 예측을 보는 중이면 그 예측 시점까지만 (그 뒤는 after)
  async function daily(co, sym) {
    const src = await loadPrices(sym);
    const ref = src ? new Date(src.d[src.d.length - 1] + "T00:00:00Z") : new Date();
    const hist = co.hist.map((h) => ({ time: isoFromMD(h.date, ref), c: h.c, h: h.h, l: h.l })).filter((h) => h.time);
    const base = hist.length ? hist[hist.length - 1].time : null;
    let bars = src ? src.d.map((d, i) => ({ time: d, open: src.o[i], high: src.h[i], low: src.l[i], close: src.c[i], value: src.v[i] })) : [];
    let after = [];
    if (base && co.after && co.after.length) { after = bars.filter((b) => b.time > base); bars = bars.filter((b) => b.time <= base); }
    // 시가가 없어 전날 종가로 대신 (est)
    hist.forEach((h) => {
      const last = bars[bars.length - 1];
      if (!last || h.time > last.time) bars.push({ time: h.time, open: last ? last.close : h.c, high: Math.max(h.h, h.l, h.c), low: Math.min(h.h, h.l, h.c), close: h.c, value: 0, est: true });
    });
    return { src, ref, bars, after };
  }

  // 원래 화면의 예측(co.models)·실제값(co.hist) + 가격 원장
  async function load(P) {
    const L = P.lc, co = P.lcCo, sym = P.coin;
    L.el.empty.hidden = false; L.el.empty.textContent = "불러오는 중…";
    try {
      const [, dd, rj] = await Promise.all([loadLib(), daily(co, sym), loadRules(sym)]);
      L.rules = rj;
      if (P.coin !== sym) return;
      const { src, ref, bars } = dd;
      let after = dd.after;
      if (bars.length < 2) { L.el.empty.textContent = "이 종목은 아직 쌓인 가격 기록이 없어요. '예측 모델 선 보기'로 봐 주세요."; L.data = null; return; }
      const byDay = {};
      co.modelNames.forEach((m) => co.models[m].forEach((p) => { const t = isoFromMD(p.date, ref); if (t && isFinite(p.c)) (byDay[t] || (byDay[t] = [])).push(p.c); }));
      const lastT = bars[bars.length - 1].time;
      const fc = Object.keys(byDay).sort().filter((t) => t > lastT).map((t) => { const s = byDay[t].sort((a, b) => a - b); return { time: t, med: qtl(s, 0.5), q1: qtl(s, 0.25), q3: qtl(s, 0.75) }; });
      const fcEnd = fc.length ? fc[fc.length - 1].time : lastT;
      after = after.filter((b) => b.time <= fcEnd);
      L.data = { sym, bars, fc, after, n: co.modelNames.length, lastClose: bars[bars.length - 1].close, hasVol: bars.some((b) => b.value > 0),
        src: src ? (src.src.startsWith("yahoo") ? "야후 파이낸스" : src.src === "upbit" ? "업비트" : "빗썸") : "" };
      L.el.note.textContent = `실제값 ${bars.length.toLocaleString()}일치 (${bars[0].time}부터)` + (L.data.src ? ` · 출처 ${L.data.src}` : "") + (L.data.hasVol ? "" : " · 거래량 정보 없음");
      L.el.empty.hidden = true;
      draw(P);
    } catch (e) {
      console.error(e);
      L.el.empty.textContent = "긴 기간 가격을 불러오지 못했어요. '예측 모델 선 보기'로 보거나 잠시 뒤 다시 시도해 주세요.";
    }
  }

  function draw(P) {
    const L = P.lc, D = L.data, LW = window.LightweightCharts;
    if (!D || !LW || L.box.hidden) return;
    if (L.chart) L.chart.remove();
    const theme = {
      layout: { background: { type: "solid", color: css("--surface") }, textColor: css("--muted"), fontFamily: getComputedStyle(document.body).fontFamily, fontSize: 12 },
      grid: { vertLines: { color: css("--line") }, horzLines: { color: css("--line") } },
      rightPriceScale: { borderColor: css("--line-strong"), scaleMargins: { top: 0.06, bottom: 0.06 } },
      timeScale: { borderColor: css("--line-strong"), rightOffset: 3, barSpacing: 6 },
    };
    const chart = L.chart = LW.createChart(L.el.chart, Object.assign({ autoSize: true, crosshair: { mode: LW.CrosshairMode.Normal }, localization: { locale: "ko-KR", dateFormat: "yyyy-MM-dd" } }, theme));
    const S = L.S = {};
    const line = (color, o, pane) => chart.addSeries(LW.LineSeries, Object.assign({ priceFormat: PF, color, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, o || {}), pane || 0);
    const wk = pref.period > 200, bars = wk ? weekly(D.bars) : D.bars, closes = bars.map((b) => b.close);
    const up = css("--up"), dn = css("--dn"), ink = css("--ink"), fc = D.fc;
    const W = (arr) => bars.map((b, i) => (arr[i] === null ? { time: b.time } : { time: b.time, value: arr[i] }));
    // 📐 차트 분석: 켜져 있고, 데이터가 있고, 지난 예측 보기가 아닐 때만
    const RJ = pref.rules && L.rules && L.rules.res && !D.after.length ? L.rules : null;
    const lastT = bars[bars.length - 1].time;
    const fut = RJ ? (RJ.fut || []).filter((t) => t > lastT).map((t) => ({ time: t })) : [];  // 앞날 빈 칸 (예상 흐름이 눌리지 않게)

    if (fc.length) {  // 예측 구간 음영
      S.bg = chart.addSeries(LW.HistogramSeries, { priceScaleId: "lcbg", color: css("--fc-bg"), priceLineVisible: false, lastValueVisible: false });
      chart.priceScale("lcbg").applyOptions({ visible: false, scaleMargins: { top: 0, bottom: 0 } });
      S.bg.setData(fc.map((f) => ({ time: f.time, value: 1 })));
    }
    if (pref.type === "candle") {
      S.main = chart.addSeries(LW.CandlestickSeries, { priceFormat: PF, upColor: up, downColor: dn, borderUpColor: up, borderDownColor: dn, wickUpColor: up, wickDownColor: dn, priceLineVisible: false });
      S.main.setData(bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })).concat(fut));
    } else {
      S.main = chart.addSeries(LW.LineSeries, { priceFormat: PF, color: ink, lineWidth: 2, priceLineVisible: false });
      S.main.setData(bars.map((b) => ({ time: b.time, value: b.close })).concat(fut));
    }
    if (pref.log) S.main.priceScale().applyOptions({ mode: LW.PriceScaleMode.Logarithmic });  // 로그 축은 위 가격 칸만 (2026-11-21)
    pref.ma.forEach((n) => { line(css("--ma" + n)).setData(W(sma(closes, n))); });
    if (pref.bb) {
      const m = sma(closes, 20), sd = stdev(closes, 20, m);
      [2, 0, -2].forEach((k) => line(css("--bb"), { lineWidth: 1, lineStyle: k ? LW.LineStyle.Solid : LW.LineStyle.Dashed }).setData(W(m.map((x, i) => (x === null ? null : x + k * sd[i])))));
    }
    if (fc.length) {  // 예측: 마지막 실제 종가에서 이어지는 중앙값 + 25~75% 띠 (위쪽 면적 위에 음영색 면적을 덮어 띠 모양)
      const lb = D.bars[D.bars.length - 1], start = { time: lb.time, med: lb.close, q1: lb.close, q3: lb.close };
      const pts = [wk ? Object.assign({}, start, { time: bars[bars.length - 1].time }) : start].concat(fc);
      const band = pts.filter((p, i) => i > 0 || !wk);
      const area = (c) => chart.addSeries(LW.AreaSeries, { priceFormat: PF, topColor: c, bottomColor: c, lineColor: "rgba(0,0,0,0)", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      area(css("--lc-band")).setData(band.map((p) => ({ time: p.time, value: p.q3 })));
      area(css("--fc-bg")).setData(band.map((p) => ({ time: p.time, value: p.q1 })));
      S.med = line(ink, { lineWidth: 2.5, lineStyle: LW.LineStyle.Dashed, crosshairMarkerVisible: true, lastValueVisible: true, title: "예측" });
      S.med.setData(pts.map((p) => ({ time: p.time, value: p.med })));
    }
    if (D.after.length) {  // 지난 예측: 그 뒤 실제 종가
      const lb = D.bars[D.bars.length - 1];
      line(ink, { lineWidth: 3.5, crosshairMarkerVisible: true, title: "실제" }).setData([{ time: wk ? bars[bars.length - 1].time : lb.time, value: lb.close }].concat(D.after.map((b) => ({ time: b.time, value: b.close }))));
    }
    const hasSub = !!pref.sub && !(pref.sub === "vol" && !D.hasVol);
    if (hasSub) {
      const o = { priceLineVisible: false, lastValueVisible: false };
      if (pref.sub === "vol") {
        chart.addSeries(LW.HistogramSeries, Object.assign({ priceFormat: { type: "custom", formatter: fmtVol } }, o), 1)
          .setData(bars.map((b, i) => ({ time: b.time, value: b.value || 0, color: (b.close >= (i ? bars[i - 1].close : b.open) ? up : dn) + "88" })));
      } else if (pref.sub === "rsi") {
        const s = line(css("--rsi"), Object.assign({}, o, { priceFormat: { type: "custom", formatter: (v) => v.toFixed(0) } }), 1);
        s.setData(W(rsi(closes, 14)));
        [70, 30].forEach((p) => s.createPriceLine({ price: p, color: css("--muted"), lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: true, title: p === 70 ? "과열" : "침체" }));
      } else {
        const e12 = ema(closes, 12), e26 = ema(closes, 26), mac = closes.map((_, i) => (e12[i] === null || e26[i] === null ? null : e12[i] - e26[i]));
        const first = mac.findIndex((x) => x !== null), sig = new Array(closes.length).fill(null);
        if (first >= 0) ema(mac.slice(first), 9).forEach((x, j) => { sig[first + j] = x; });
        chart.addSeries(LW.HistogramSeries, Object.assign({ priceFormat: PF }, o), 1)
          .setData(bars.map((b, i) => (mac[i] === null || sig[i] === null ? { time: b.time } : { time: b.time, value: mac[i] - sig[i], color: (mac[i] - sig[i] >= 0 ? up : dn) + "77" })));
        line(css("--macd"), o, 1).setData(W(mac));
        line(css("--sig"), o, 1).setData(W(sig));
      }
      if (pref.log) try { chart.priceScale("right", 1).applyOptions({ mode: LW.PriceScaleMode.Normal }); } catch (e) { /* 아래 칸 없음 */ }
      const panes = chart.panes(); if (panes[1]) panes[1].setHeight(Math.round(L.el.chart.clientHeight * 0.26));
    }
    if (RJ) {  // 📐 차트 분석 선·태그·예상 흐름
      const pt = (a) => ({ time: a[0], value: a[1] });
      const haveT = new Set(bars.map((b) => b.time));  // 주봉일 때는 봉이 있는 날·앞날만 (없는 날짜가 끼면 축이 벌어짐)
      const ok = (arr) => arr.filter((a, i) => a && a[0] && (!wk || i === 0 || i === arr.length - 1 || haveT.has(a[0]) || a[0] > lastT)).map(pt).sort((x, y) => (x.time < y.time ? -1 : 1));
      const rl = (color, o) => line(color, Object.assign({ lineWidth: 2 }, o || {}));
      rl("#7C4DFF", { lineWidth: 2.5 }).setData(ok(RJ.res));
      if (RJ.sup && RJ.sup.length) rl("#1E9E6A", { lineStyle: LW.LineStyle.Dashed }).setData(ok(RJ.sup));
      rl("#1E9E6A", { lineStyle: LW.LineStyle.LargeDashed }).setData(ok(RJ.up));
      rl("#E5484D", { lineStyle: LW.LineStyle.LargeDashed }).setData(ok(RJ.dn));
      const TC = { goal: ["#1E9E6A", 0], watch: ["#7C4DFF", 0], watch2: ["#7C4DFF", 2], risk: ["#E5484D", 0] };
      const hiShown = Math.max(...bars.slice(-Math.max(10, Math.round(pref.period * 0.7))).map((b) => b.high));
      (RJ.tags || []).forEach((g, j) => {
        if (g.k === "goal" && j > 0 && g.p > hiShown * 1.6) return;  // 너무 먼 목표 ②③은 뺌
        const [col, st] = TC[g.k] || ["#8A93A6", 0];
        S.main.createPriceLine({ price: g.p, color: col, lineWidth: 2, lineStyle: st, axisLabelVisible: true, title: g.t });
      });
      // 🧩 새 패턴 (상승 4종): 완성 = 실선, 완성 직전 = 점선 + 목표·손절 가격선 (2026-11-22)
      const NP = ((RJ.card || {}).newpat || {}).items || [];
      const npOn = NP.filter((x) => x.state !== "아님");
      const npCol = (lab) => (/상단|BP/.test(lab) ? "#E5484D" : /하단/.test(lab) ? "#3B6FE0" : "#C99700");
      npOn.forEach((x) => {
        (x.lines || []).forEach((g) => {
          if (!g[0] || !g[2] || g[0] >= g[2]) return;  // 두 점 선 (주봉이어도 처음·끝 점은 그대로 둠)
          const pts = [[g[0], g[1]], [g[2], g[3]]];
          rl(npCol(g[5]), { lineWidth: 2, lineStyle: x.state === "완성" ? LW.LineStyle.Solid : LW.LineStyle.Dotted }).setData(ok(pts));
        });
      });
      const npBest = npOn.sort((a, b) => (a.state === b.state ? 0 : a.state === "완성" ? -1 : 1))[0];
      if (npBest) {
        const sh = npBest.name.replace("과장 상승 다이버전스", "과장 다이버").replace("3 Tight Closes", "3TC");
        if (npBest.target) S.main.createPriceLine({ price: npBest.target, color: "#1E9E6A", lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: true, title: `${sh} 목표` });
        if (npBest.stop) S.main.createPriceLine({ price: npBest.stop, color: "#E5484D", lineWidth: 1, lineStyle: LW.LineStyle.Dotted, axisLabelVisible: true, title: `${sh} 손절` });
        if (npBest.state === "완성 직전" && npBest.trigger) S.main.createPriceLine({ price: npBest.trigger, color: "#C99700", lineWidth: 1, lineStyle: LW.LineStyle.Dashed, axisLabelVisible: true, title: `${sh} 완성 자리` });
      }
      if (!wk && LW.createSeriesMarkers && RJ.touches) {
        const have = new Set(bars.map((b) => b.time));
        const mk = RJ.touches.filter((t) => have.has(t)).map((t) => ({ time: t, position: "aboveBar", shape: "circle", color: "#7C4DFF", size: 0.6 }));
        npOn.forEach((x) => {
          const t = x.state === "완성" ? x.since : lastT;
          if (have.has(t)) mk.push({ time: t, position: "belowBar", shape: "arrowUp", color: x.state === "완성" ? "#E5484D" : "#C99700", text: `${x.name} ${x.state}`, size: 1.2 });
        });
        (RJ.patmarks || []).filter((m) => have.has(m.d)).forEach((m) => {  // 패턴 자리: 왼어깨·머리·오른어깨, 컵, W·M (2026-11-21)
          const col = m.side === "up" ? "#E5484D" : m.side === "down" ? "#3B6FE0" : "#C99700";
          mk.push({ time: m.d, position: m.pos === "below" ? "belowBar" : "aboveBar", shape: m.pos === "below" ? "arrowUp" : "arrowDown", color: col, text: m.t, size: 1 });
        });
        mk.sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
        LW.createSeriesMarkers(S.main, mk);
      }
    }
    // 보이는 기간
    let end = fc.length ? fc[fc.length - 1].time : D.after.length ? D.after[D.after.length - 1].time : bars[bars.length - 1].time;
    if (RJ && RJ.up && RJ.up.length && pref.period <= 366) { const ue = RJ.up[RJ.up.length - 1][0]; if (ue > end) end = ue; }
    const from = new Date(Date.parse(D.bars[D.bars.length - 1].time) - pref.period * 864e5).toISOString().slice(0, 10);
    let shown = bars.filter((b) => b.time >= from); if (shown.length < 2) shown = bars.slice(-5);
    chart.timeScale().setVisibleRange({ from: shown[0].time, to: end });
    if (pref.fib && shown.length > 1) {  // 보이는 기간의 최고·최저 기준
      let hi = shown[0], lo = shown[0];
      shown.forEach((b) => { if (b.high > hi.high) hi = b; if (b.low < lo.low) lo = b; });
      const upT = lo.time < hi.time, span = hi.high - lo.low, wide = L.el.chart.clientWidth > 520;
      [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].forEach((r) => S.main.createPriceLine({
        price: upT ? hi.high - span * r : lo.low + span * r, color: css("--fib"), lineWidth: 1,
        lineStyle: r === 0 || r === 1 ? LW.LineStyle.Solid : LW.LineStyle.Dashed, axisLabelVisible: wide, title: +(r * 100).toFixed(1) + "%" }));
    }
    L.view = { bars, wk };
    legend(P, null);
    chart.subscribeCrosshairMove((p) => legend(P, p && p.time ? (typeof p.time === "string" ? p.time : null) : null));
  }

  function legend(P, t) {
    const L = P.lc, D = L.data, bars = L.view.bars;
    const f = t ? D.fc.find((x) => x.time === t) : null, a = t ? D.after.find((x) => x.time === t) : null;
    let h;
    if (f) {
      h = `<b>${t} 예측</b><span><span class="k">중앙값</span>${fmt(f.med)}</span><span><span class="k">25~75%</span>${fmt(f.q1)} ~ ${fmt(f.q3)}</span><span class="${f.med >= D.lastClose ? "u" : "d"}">${pct(f.med / D.lastClose - 1)}</span>` +
        (a ? `<span><span class="k">실제</span>${fmt(a.close)}</span>` : "");
    } else {
      let i = t ? bars.findIndex((b) => b.time === t) : -1; if (i < 0) i = bars.length - 1;
      const b = bars[i], prev = i ? bars[i - 1].close : b.open, ch = b.close / prev - 1;
      h = `<b>${b.time}${L.view.wk ? " 주" : ""}</b><span><span class="k">시</span>${fmt(b.open)}</span><span><span class="k">고</span>${fmt(b.high)}</span><span><span class="k">저</span>${fmt(b.low)}</span><span><span class="k">종</span>${fmt(b.close)}</span><span class="${ch >= 0 ? "u" : "d"}">${pct(ch)}</span>` +
        (b.est ? '<span class="k">(시가는 전날 종가로 대신)</span>' : "");
    }
    L.el.leg.innerHTML = h;
  }

  /* ---------- 오른쪽 카드: 차트 지표 해석 (일봉 고정 · 20일·60일선 · RSI 14일 · 볼린저 20일 ±2σ) ---------- */
  // 규칙 기반 문장. 강조할 부분은 굵게 + 밑줄(.ta-em, 상승 쪽 .u / 하락 쪽 .d). 점수: 반등·상승 쪽 +, 하락 쪽 -
  const em = (t, c) => `<b class="ta-em${c ? " " + c : ""}">${t}</b>`;
  function taRead(bars, verdict) {
    const n = bars.length;
    if (n < 30) return null;
    const C = bars.map((b) => b.close), last = bars[n - 1], prev = bars[n - 2];
    const ma5 = sma(C, 5), ma20 = sma(C, 20), ma60 = sma(C, 60);
    const m5 = ma5[n - 1], m20 = ma20[n - 1], m60 = ma60[n - 1], c = last.close;
    const out = [];
    let score = 0;

    // ① 추세: 20일·60일선 위치와 배열, 20일선 기울기
    if (m60 != null) {
      const above20 = c >= m20, above60 = c >= m60, slope = ma20[n - 6] ? m20 / ma20[n - 6] - 1 : 0;
      let t;
      if (m5 > m20 && m20 > m60) { t = `이동평균이 ${em("정배열(5>20>60일)", "u")}이라 상승 추세예요`; score += 1; }
      else if (m5 < m20 && m20 < m60) { t = `이동평균이 ${em("역배열(5<20<60일)", "d")}이라 하락 추세예요`; score -= 1; }
      else t = "이동평균이 엉켜 있어 뚜렷한 추세가 없어요";
      t += `. 종가는 20일선 ${above20 ? "위" : "아래"}(${pct(c / m20 - 1)}), 60일선 ${above60 ? "위" : "아래"}(${pct(c / m60 - 1)})`;
      t += Math.abs(slope) < 0.005 ? "이고 20일선은 평평해요." : slope > 0 ? "이고 20일선은 오르는 중이에요." : "이고 20일선은 내려가는 중이에요.";
      if (above20 && !(C[n - 2] >= ma20[n - 2])) { t += ` 오늘 ${em("20일선을 위로 돌파", "u")}했어요.`; score += 1; }
      if (!above20 && C[n - 2] >= ma20[n - 2]) { t += ` 오늘 ${em("20일선 아래로 이탈", "d")}했어요.`; score -= 1; }
      out.push(["📈 추세", t]);
    } else {
      out.push(["📈 추세", `종가는 20일선 ${c >= m20 ? "위" : "아래"}(${pct(c / m20 - 1)})예요. 60일선은 기록이 짧아 아직 없어요.`]);
    }

    // ② 볼린저 밴드: 밴드 안 위치(%B)와 폭(최근 120일 중 순위)
    const sd = stdev(C, 20, ma20), up = m20 + 2 * sd[n - 1], lo = m20 - 2 * sd[n - 1], pb = (c - lo) / (up - lo || 1);
    const widths = []; for (let i = Math.max(19, n - 120); i < n; i++) if (ma20[i]) widths.push((4 * sd[i]) / ma20[i]);
    const wr = widths.filter((w) => w <= widths[widths.length - 1]).length / widths.length;
    let bt;
    if (pb < 0) { bt = `종가가 ${em("하단 밴드 밖으로 내려갔어요", "d")}. 통계적으로 많이 내려온 자리라 ${em("되돌림 반등", "u")}이 나오기도 해요`; score += 1; }
    else if (pb < 0.15) { bt = `종가가 ${em("하단 밴드 근처", "d")}예요. 밴드 아래쪽은 반등이 자주 나오는 자리예요`; score += 0.5; }
    else if (pb > 1) { bt = `종가가 ${em("상단 밴드 위로 올라갔어요", "u")}. 강한 상승이지만 ${em("단기 과열", "d")}일 수 있어요`; score -= 0.5; }
    else if (pb > 0.85) bt = `종가가 ${em("상단 밴드 근처", "u")}예요. 힘이 강하지만 저항을 받기 쉬운 자리예요`;
    else bt = `종가가 밴드 안 ${pb >= 0.5 ? "위쪽" : "아래쪽"}(위치 ${Math.round(pb * 100)}%)에 있어요`;
    if (wr <= 0.15) bt += `. 밴드 폭이 최근 6달 중 ${em("가장 좁은 편")}이라 곧 큰 움직임이 나올 수 있어요.`;
    else if (wr >= 0.85) bt += `. 밴드 폭이 최근 6달 중 ${em("가장 넓은 편")}이라 변동성이 큰 구간이에요.`;
    else bt += ".";
    out.push(["🎯 볼린저", bt]);

    // ③ RSI 14일
    const R = rsi(C, 14), r = R[n - 1], r3 = R[n - 4];
    if (r != null) {
      let rt = `RSI ${Math.round(r)}`;
      if (r < 30) { rt += `로 ${em("침체 구간(30 아래)", "u")}이에요. 많이 판 상태라 반등 신호로 봐요`; score += 1; }
      else if (r > 70) { rt += `로 ${em("과열 구간(70 위)", "d")}이에요. 많이 산 상태라 쉬어 갈 수 있어요`; score -= 1; }
      else if (r < 45) rt += "로 약세 쪽이에요";
      else if (r > 55) rt += "로 강세 쪽이에요";
      else rt += "로 중립이에요";
      if (r3 != null) rt += r - r3 > 5 ? `. 최근 3일 ${em("올라오는 중", "u")}이에요.` : r3 - r > 5 ? `. 최근 3일 ${em("내려가는 중", "d")}이에요.` : ".";
      // 다이버전스: 최근 20일 중 오늘 가격이 최저인데 RSI 는 그 전 저점보다 높음 → 상승 다이버전스
      const lowIdx = (from) => { let k = from; for (let i = from; i < n - 3; i++) if (C[i] < C[k]) k = i; return k; };
      const k = lowIdx(n - 20);
      if (c <= Math.min(...C.slice(n - 20)) && R[k] != null && r > R[k] + 3 && k < n - 3) { rt += ` 가격은 새 저점인데 RSI는 덜 내려가 ${em("상승 다이버전스", "u")}가 보여요.`; score += 1; }
      out.push(["🌡 RSI", rt]);
    }

    // ④ 거래량: 20일 평균 대비, 최근 3일 오른 날·내린 날 거래량
    if (bars.slice(-25).some((b) => b.value > 0)) {
      const vb = bars.filter((b) => !b.est), vn = vb.length;
      const avg = vb.slice(-21, -1).reduce((s, b) => s + b.value, 0) / 20, lv = vb[vn - 1].value, ratio = avg ? lv / avg : 0;
      let upV = 0, dnV = 0;
      vb.slice(-3).forEach((b, i, a) => { const pc = i ? a[i - 1].close : vb[vn - 4].close; if (b.close >= pc) upV += b.value; else dnV += b.value; });
      let vt = `${vb[vn - 1].time.slice(5)} 거래량은 20일 평균의 ${ratio.toFixed(1)}배`;
      vt += ratio >= 2 ? `로 ${em("크게 늘었어요")}` : ratio >= 1.3 ? "로 늘었어요" : ratio <= 0.6 ? "로 한산해요" : "로 평소 수준이에요";
      if (dnV > upV * 1.8) { vt += `. 최근 3일은 ${em("내린 날 거래가 몰려", "d")} 파는 힘이 강했어요.`; score -= 0.5; }
      else if (upV > dnV * 1.8) { vt += `. 최근 3일은 ${em("오른 날 거래가 몰려", "u")} 사는 힘이 강했어요.`; score += 0.5; }
      else vt += ".";
      if (last.est) vt += " (마지막 날 거래량은 아직 집계 전)";
      out.push(["📊 거래량", vt]);
    }

    // ⑤ 봉 모양: 마지막 봉(시가가 있는 날만), 연속 봉
    const cb = bars.filter((b) => !b.est), m = cb.length, b1 = cb[m - 1], b0 = cb[m - 2];
    const body = (b) => Math.abs(b.close - b.open), rng = (b) => b.high - b.low || 1e-12;
    const upW = (b) => b.high - Math.max(b.open, b.close), loW = (b) => Math.min(b.open, b.close) - b.low;
    const avgBody = cb.slice(-21, -1).reduce((s, b) => s + body(b), 0) / 20;
    const downTrend = b1.close < (ma20[bars.indexOf(b1)] || b1.close), upTrend = !downTrend;
    let ct = null;
    if (b0 && b0.close < b0.open && b1.close > b1.open && b1.close >= b0.open && b1.open <= b0.close) {
      if (downTrend) { ct = `하락 흐름에서 ${em("상승 장악형", "u")}(전날 음봉을 감싸는 양봉)이 나왔어요. 반등 신호로 봐요`; score += 1; }
      else { ct = `${em("상승 장악형", "u")}(전날 음봉을 감싸는 양봉)이에요. 오르는 흐름이 이어지는 모양이에요`; score += 0.5; } }
    else if (b0 && b0.close > b0.open && b1.close < b1.open && b1.open >= b0.close && b1.close <= b0.open) {
      if (upTrend) { ct = `상승 흐름에서 ${em("하락 장악형", "d")}(전날 양봉을 감싸는 음봉)이 나왔어요. 꺾임 신호로 봐요`; score -= 1; }
      else { ct = `${em("하락 장악형", "d")}(전날 양봉을 감싸는 음봉)이에요. 짧은 반등이 꺾이고 내리는 흐름이 이어지는 모양이에요`; score -= 0.5; } }
    else if (loW(b1) >= 2 * body(b1) && upW(b1) <= Math.max(body(b1), rng(b1) * 0.1) && downTrend) { ct = `${em("망치형", "u")}(긴 아랫꼬리)이 나왔어요. 아래에서 사는 힘이 들어온 모양이에요`; score += 1; }
    else if (upW(b1) >= 2 * body(b1) && loW(b1) <= Math.max(body(b1), rng(b1) * 0.1) && upTrend) { ct = `${em("유성형", "d")}(긴 윗꼬리)이 나왔어요. 위에서 파는 힘이 나온 모양이에요`; score -= 1; }
    else if (body(b1) <= rng(b1) * 0.1) ct = `${em("도지")}(시가≈종가)가 나왔어요. 사고파는 힘이 팽팽해 방향을 고르는 중이에요`;
    else if (body(b1) >= avgBody * 1.8) ct = b1.close > b1.open ? `평소보다 ${em("큰 양봉", "u")}이에요` : `평소보다 ${em("큰 음봉", "d")}이에요`;
    let run = 0; const dir = Math.sign(b1.close - b1.open);
    for (let i = m - 1; i >= 0 && dir && Math.sign(cb[i].close - cb[i].open) === dir; i--) run++;
    if (run >= 3) ct = (ct ? ct + ". " : "") + (dir > 0 ? `${em(run + "일 연속 양봉", "u")}이에요` : `${em(run + "일 연속 음봉", "d")}이에요`);
    if (!ct) ct = "특별한 모양 없이 보통 크기의 봉이에요";
    out.push(["🕯 봉 모양", ct + `. (${b1.time.slice(5)} 봉 기준)`]);

    // ⑥ 가까운 저항·지지: 최근 20일 고점·저점
    const w20 = bars.slice(-20), hi = Math.max(...w20.map((b) => b.high)), lo20 = Math.min(...w20.map((b) => b.low));
    out.push(["🧱 지지·저항", `최근 20일 고점 ${em(fmt(hi))}(${pct(hi / c - 1)}), 저점 ${em(fmt(lo20))}(${pct(lo20 / c - 1)})이에요.`]);

    // 종합: 지표 점수와 모델 판정 비교
    const side = score >= 1.5 ? "u" : score <= -1.5 ? "d" : "m";
    const vTxt = { up: "상승", dn: "하락", mx: "혼돈" }[verdict];
    const trDn = m60 != null && m5 < m20 && m20 < m60, trUp = m60 != null && m5 > m20 && m20 > m60;
    const oversold = (r != null && r < 30) || pb < 0.15, overbought = (r != null && r > 70) || pb > 1;
    let sum;
    if (side === "m" && trDn && oversold) sum = `차트 지표는 ${em("하락 추세 속 과매도", "d")}예요. 단기 반등이 나올 수 있는 자리지만 추세는 아직 하락이에요`;
    else if (side === "m" && trUp && overbought) sum = `차트 지표는 ${em("상승 추세 속 과열", "u")}이에요. 힘은 강하지만 쉬어 갈 수 있는 자리예요`;
    else sum = `차트 지표는 ${em({ u: "반등·상승 쪽", d: "하락 쪽", m: "엇갈림" }[side], side === "m" ? "" : side)}이에요`;
    if (vTxt) {
      if ((verdict === "up" && side === "u") || (verdict === "dn" && side === "d")) sum += `. 모델 D+1 판정(${vTxt})과 ${em("같은 방향", side)}이에요.`;
      else if ((verdict === "up" && side === "d") || (verdict === "dn" && side === "u")) sum += `. 모델 D+1 판정(${vTxt})과 ${em("반대 방향")}이라 더 조심해서 봐요.`;
      else sum += `. 모델 D+1 판정은 ${vTxt}이에요.`;
    }
    if (side === "u" && m60 != null && c < m60 && m20 < m60) sum += " 다만 큰 추세는 아직 하락이라 반등이 짧을 수 있어요.";
    if (side === "d" && m60 != null && c > m60 && m20 > m60) sum += " 다만 큰 추세는 아직 상승이라 눌림일 수 있어요.";
    return { items: out, sum, asOf: last.time, side, trDn, trUp, oversold, overbought };
  }

  const taCss = document.createElement("style");
  taCss.textContent = `.ta-em{font-weight:700;text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1.5px}
  .ta-em.u{color:var(--up-text);text-decoration-color:var(--up)}.ta-em.d{color:var(--dn-ink);text-decoration-color:var(--dn)}
  .ta-list{list-style:none;padding:0;margin:6px 0 0;display:flex;flex-direction:column;gap:8px}
  .ta-list li{font-size:14.5px;line-height:1.65}.ta-list .k{display:inline-block;font-weight:600;margin-right:6px}
  .ta-sum{margin-top:10px;padding:10px 12px;border-radius:10px;background:var(--fc-bg);font-size:14.5px;line-height:1.65}
  .ta-fine{font-size:12px;color:var(--muted);margin-top:8px}`;
  document.head.appendChild(taCss);

  async function taRender(P) {
    const co = P.lcCo, sym = P.coin, read = P.el.read;
    if (!read) return;
    let sec = read.querySelector(".ta-sec");
    try {
      const dd = await daily(co, sym);
      if (P.coin !== sym) return;
      const t = taRead(dd.bars, P.a && P.a.verdict);
      P.taT = t;
      sec = read.querySelector(".ta-sec");  // 기다리는 사이 카드가 다시 그려졌을 수 있음
      if (!sec) {
        sec = document.createElement("div");
        sec.className = "read-sec ta-sec";
        const rule = read.querySelector("details.rule");
        if (rule) read.insertBefore(sec, rule); else read.appendChild(sec);
      }
      if (!t) { sec.hidden = true; return; }
      sec.hidden = false;
      sec.innerHTML = `<h4>차트 지표 해석 · 일봉 (${t.asOf.slice(5)} 기준)</h4><ul class="ta-list">` +
        t.items.map(([k, v]) => `<li><span class="k">${k}</span>${v}</li>`).join("") + `</ul><p class="ta-sum">🤝 ${t.sum}</p>` +
        `<p class="ta-fine">20일·60일 이동평균, 볼린저 밴드(20일, ±2σ), RSI 14일로 계산한 규칙 기반 참고 해석이에요. 투자 권유가 아니에요.</p>`;
    } catch (e) { if (sec) sec.hidden = true; }
  }

  // 📐 차트 신호 점검 (오른쪽 카드, '차트 지표 해석' 아래) — 무료 페이지와 같은 계산, AI 포함 점수·AI 한 줄은 여기서 계산
  const crCss = document.createElement("style");
  crCss.textContent = `.cr-scs{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:8px 0}
  .cr-sc{background:var(--fc-bg);border-radius:10px;padding:8px 10px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .cr-sc small{width:100%;color:var(--muted);font-size:12px}.cr-sc b{font-size:26px;line-height:1}
  .cr-sc span{color:#fff;font-size:12.5px;font-weight:700;border-radius:999px;padding:2px 9px}
  .cr-chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.cr-chip{background:var(--fc-bg);border-radius:999px;padding:3px 10px;font-size:13px}
  .cr-list{list-style:none;padding:0;margin:6px 0 0;display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:2px 10px;font-size:13.5px}
  .cr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px}.cr-grid div{display:flex;justify-content:space-between;gap:6px;border:1.5px solid;border-radius:9px;padding:5px 9px;font-size:13px;background:var(--fc-bg)}
  .cr-grid span{font-weight:600}.cr-grid .off{border-color:var(--line);color:var(--muted)}.cr-grid .off span{font-weight:400}
  .cr-warn{list-style:none;padding:0;margin:6px 0 0;color:var(--dn-ink);font-size:13.5px}
  .cr-lv{display:flex;flex-direction:column;gap:5px;margin-top:8px}.cr-lv div{display:flex;justify-content:space-between;gap:8px;border-left:4px solid;padding:5px 9px;border-radius:8px;background:var(--fc-bg);font-size:13.5px}
  .cr-lv .goal{border-color:#1E9E6A}.cr-lv .watch{border-color:#7C4DFF}.cr-lv .risk{border-color:#E5484D}.cr-lv b{font-variant-numeric:tabular-nums}
  .cr-combo{margin-top:10px;padding:10px 12px;border-radius:10px;border:1.5px solid #C99700;font-size:14px;line-height:1.6}`;
  document.head.appendChild(crCss);
  const GC = { 강: "#E5484D", 중: "#C99700", 약: "#8A93A6" };
  const grade = (x) => (x >= 70 ? "강" : x >= 40 ? "중" : "약");
  const escH = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[x]);
  // 🧩 매매 패턴 4종 (목표·손절 5년 검증에서 통한 것) + 돌파 직전 경고 (2026-11-22, 형님_차트분석법.md 29)
  const npCss = document.createElement("style");
  npCss.textContent = `.cr-np .done{background:#E5484D;border-color:#E5484D!important;color:#fff}.cr-np .done b{color:#fff!important}
  .cr-np .near{border-color:#C99700!important;background:color-mix(in srgb,#C99700 14%,var(--fc-bg))}.cr-np .near b{color:#A87E00!important}
  .cr-npd{list-style:none;padding:0;margin:6px 0 0;font-size:13.5px;line-height:1.6}.cr-npd li{margin:3px 0}`;
  document.head.appendChild(npCss);
  const shortD = (s) => (s ? `${+s.slice(5, 7)}/${+s.slice(8, 10)}` : "");
  function newpatHtml(np) {
    if (!np || !np.items) return "";
    const on = np.items.filter((x) => x.state !== "아님");
    let h = `<p style="margin:12px 0 4px;font-weight:600">🧩 매매 패턴 <small style="font-weight:400;color:var(--muted)">목표·손절 5년 검증에서 통한 4가지</small></p><div class="cr-grid cr-np">`;
    h += np.items.map((x) => `<div class="${x.state === "완성" ? "done" : x.state === "완성 직전" ? "near" : "off"}"><span>${escH(x.name)}</span><b>${escH(x.state)}</b></div>`).join("") + "</div>";
    if (on.length) {
      h += `<ul class="cr-npd">${on.map((x) => {
        const head = x.state === "완성" ? `🔴 <b>${escH(x.name)} 완성</b> (${shortD(x.since)}${x.ago ? `, ${x.ago}봉 전` : ", 오늘"})`
          : `🟡 <b>${escH(x.name)} 완성 직전</b>` + (x.trigger ? ` — ${fmt(x.trigger)} 위로 마감하면 완성` : x.wait ? ` — 이 저점이 ${x.wait}봉 더 안 깨지면 완성` : "");
        return `<li>${head}<br><small style="color:var(--muted)">${escH(x.text || "")}${x.target ? ` · 목표 ${fmt(x.target)}` : ""}${x.stop ? ` · 손절 ${fmt(x.stop)}` : ""}</small></li>`;
      }).join("")}</ul>`;
    }
    if ((np.warn || []).length) h += `<ul class="cr-warn"><li>⚠️ 돌파 직전 경고: 최근 10봉 안 ${np.warn.map(escH).join(", ")} — 5년 검증에서 이런 때 나온 돌파는 손익비가 크게 낮았어요</li></ul>`;
    return h;
  }
  async function rulesRender(P) {
    const sym = P.coin, read = P.el.read;
    if (!read) return;
    let sec = read.querySelector(".cr-sec");
    try {
      const rj = await loadRules(sym);
      if (P.coin !== sym) return;
      P.rjLast = rj && rj.card ? rj : null;
      sec = read.querySelector(".cr-sec");
      if (!rj || !rj.card) { if (sec) sec.hidden = true; return; }
      if (!sec) {
        sec = document.createElement("div");
        sec.className = "read-sec cr-sec";
        const after = read.querySelector(".ta-sec"), rule = read.querySelector("details.rule");
        if (after && after.nextSibling) read.insertBefore(sec, after.nextSibling); else if (rule) read.insertBefore(sec, rule); else read.appendChild(sec);
      }
      const c = rj.card, sc = c.score, v = P.a && P.a.verdict;
      const vw = v === "up" || v === "상승" ? "상승" : v === "dn" || v === "하락" ? "하락" : v ? "혼돈" : null;
      let html = `<h4>📐 차트 분석 · 신호 점검 (${escH(rj.date.slice(5))} 기준)</h4>`;
      html += `<p style="margin:6px 0 0">지금 모양: <b>${escH(c.pattern || "-")}</b> <span style="color:var(--muted);font-size:13px">${escH(c.pattern_help || "")}</span></p>`;
      if (sc) {
        const ai = vw ? Math.round(sc.chart * 0.8 + { 상승: 20, 혼돈: 10, 하락: 0 }[vw]) : null;
        const badge = (lab, x) => `<div class="cr-sc"><small>${lab}</small><b style="color:${GC[grade(x)]}">${x}</b><span style="background:${GC[grade(x)]}">${grade(x)}</span></div>`;
        html += `<div class="cr-scs">${badge("차트만 본 점수", sc.chart)}${ai != null ? badge(`AI 예측까지 넣은 점수 (판정 ${vw})`, ai) : ""}</div>`;
        const ic = { up: "🔴", down: "🔵", neutral: "⚪" };  // 국내 관례: 오름 빨강·내림 파랑 (패턴 점검 칸과 같게)
        html += `<div class="cr-chips">${(sc.patterns || []).map((p) => `<span class="cr-chip">${ic[p.side] || "⚪"} ${escH(p.name)} · ${escH(p.status)}</span>`).join("") || '<span class="cr-chip">⚪ 뚜렷한 모양 없음</span>'}</div>`;
        if ((c.grid || []).length) {  // 패턴 점검 8칸 (2026-11-21)
          const gc = { up: "#E5484D", down: "#3B6FE0", neutral: "#C99700" };
          html += `<p style="margin:10px 0 4px;font-weight:600">🔎 패턴 점검</p><div class="cr-grid">${c.grid.map((g) => `<div class="${g.side === "off" ? "off" : ""}" style="${gc[g.side] ? "border-color:" + gc[g.side] : ""}"><span>${escH(g.name)}</span><b style="color:${gc[g.side] || "var(--muted)"}">${escH(g.word.replace(" (형성 중)", ""))}</b></div>`).join("")}</div>`;
        }
        html += newpatHtml(c.newpat);
        html += `<ul class="cr-list">${Object.entries(sc.checklist || {}).map(([k, x]) => `<li>${x ? "✅" : "▫️"} ${escH(k)}</li>`).join("")}</ul>`;
        if (sc.warnings && sc.warnings.length) html += `<ul class="cr-warn">${sc.warnings.map((w) => `<li>⚠️ ${escH(w)}</li>`).join("")}</ul>`;
      }
      html += `<div class="cr-lv">${(c.levels || []).map((x) => `<div class="${x.kind}"><span>${escH(x.label)} <small style="color:var(--muted)">${escH(x.note)}</small></span><b>${fmt(x.price)}</b></div>`).join("")}</div>`;
      // AI 6일 예측과 같이 보면 (무료 페이지와 같은 규칙)
      const L = P.lc, fcv = L && L.data && L.data.sym === sym ? L.data.fc : null;
      if (fcv && fcv.length && rj.ep1) {
        const lastF = fcv[fcv.length - 1];
        const s = lastF.q3 >= rj.ep1 ? "AI 6일 예측 범위 위쪽이 돌파 확인 자리까지 닿아요 → 이번 주 돌파 시도를 지켜볼 만해요."
          : lastF.med >= rj.line * 0.97 ? "AI 6일 예측 중앙값이 저항선 근처까지 와요 → 저항선에서 막히는지 넘는지가 관건이에요."
          : `AI 6일 예측 중앙값(${fmt(lastF.med)})으로는 저항선(${fmt(rj.line)})까지 못 미쳐요 → 당분간은 아래 지지 자리를 지키는지 보는 구간이에요.`;
        html += `<p class="cr-combo">🤖 ${s}</p>`;
      }
      if ((c.notes || []).length || c.market) html += `<ul class="ta-list" style="margin-top:10px">${(c.notes || []).concat(c.market ? [c.market] : []).map((n) => `<li>${escH(n)}</li>`).join("")}</ul>`;
      html += `<p class="ta-fine">추세선·패턴·기본 점검표 7개·시장 상태를 규칙대로 센 점수예요 (차트 점수 = 모양 40 + 점검표 42 + 시장 18, AI 포함 = 차트×0.8 + AI 판정 20·10·0, 70↑ 강 · 40~69 중 · 40↓ 약). 차트 분석은 D+1 예측과 별개로 큰 흐름·모양·목표 구간·위험 구간을 보는 보조 정보예요. 앞으로 오를 확률이 아니며 투자 권유가 아니에요. 차트 위 선은 '긴 기간' 보기에서 '📐 차트 분석'으로 켜고 끌 수 있어요.</p>`;
      sec.innerHTML = html;
      sec.hidden = false;
    } catch (e) { if (sec) sec.hidden = true; }
  }

  // 오른쪽 판단 카드 한 줄 + 차트 위 한눈에 요약 (2026-11-21). 차트 분석은 보조 정보: 큰 흐름·모양·목표·위험 구간
  const exCss = document.createElement("style");
  exCss.textContent = `.cr-one{margin-top:10px;padding:8px 11px;border-left:3px solid #7C4DFF;background:var(--fc-bg);border-radius:8px;font-size:13.5px;line-height:1.6}
  .lc-sum{margin:4px 0 12px;padding:10px 13px;border-radius:10px;background:var(--fc-bg);font-size:14.5px;line-height:1.65}
  .lc-sum b.h{margin-right:6px}`;
  document.head.appendChild(exCss);
  function chartFacts(rj) {
    if (!rj) return null;
    const c = rj.close, lv = rj.card.levels || [], sc = rj.card.score || {};
    const goal1 = lv.filter((x) => x.kind === "goal" && x.price > c).sort((a, b) => a.price - b.price)[0];
    const risk = lv.find((x) => x.kind === "risk");
    const done = (sc.patterns || []).find((p) => p.side === "up" && p.status === "완성");
    const broke = rj.ep1 && c >= rj.ep1;
    const npi = ((rj.card.newpat || {}).items || []).filter((x) => x.state !== "아님").sort((a, b) => (a.state === b.state ? 0 : a.state === "완성" ? -1 : 1));
    return { c, pat: rj.card.pattern || "뚜렷한 모양 없음", goal1, risk, done, broke, ep1: rj.ep1, gap: rj.ep1 ? rj.ep1 / c - 1 : null,
      np: npi[0] || null, npWarn: (rj.card.newpat || {}).warn || [] };
  }
  function npLine(x) {  // 🧩 매매 패턴 한 줄 (완성 / 완성 직전)
    if (!x) return "";
    const tg = (x.target ? ` 목표 ${fmt(x.target)}` : "") + (x.stop ? `${x.target ? "," : ""} 손절 ${fmt(x.stop)}` : "");
    if (x.state === "완성") return `🧩 ${em(x.name + " 완성", "u")}(${shortD(x.since)})!` + (tg ? ` 패턴 기준${tg}.` : "");
    return `🧩 ${em(x.name + " 완성 직전", "")}` + (x.trigger ? ` — ${fmt(x.trigger)} 위로 마감하면 완성` : x.wait ? ` — 저점이 ${x.wait}봉 더 버티면 완성` : "") + (tg ? ` (${tg.trim()}).` : ".");
  }
  function oneLine(P) {
    const read = P.el.read, sec = read && read.querySelector(".read-sec");
    if (!sec) return;
    let el = sec.querySelector(".cr-one");
    const f = chartFacts(P.rjLast);
    if (!f) { if (el) el.remove(); return; }
    let t;
    if (f.done) t = `${em(f.done.name + " 완성", "u")} 모양이에요.` + (f.goal1 ? ` 위로는 목표 ① ${fmt(f.goal1.price)}을 봐요.` : "");
    else if (f.broke) t = `${escH(f.pat)} 저항선을 ${em("넘어선 자리", "u")}예요.` + (f.goal1 ? ` 다음 목표 ① ${fmt(f.goal1.price)}.` : "");
    else if (f.ep1) t = `${em(escH(f.pat), "")} 저항선 아래예요. 흐름이 바뀌려면 ${fmt(f.ep1)} 위 마감(지금보다 ${pct(f.gap)})이 먼저예요.`;
    else t = `지금 모양: ${escH(f.pat)}.`;
    if (f.risk) t += ` ${fmt(f.risk.price)} 아래로 내려가면 ${em("조심할 자리", "d")}예요.`;
    if (f.np) t += " " + npLine(f.np);
    if (!el) { el = document.createElement("p"); el.className = "cr-one"; sec.appendChild(el); }
    el.innerHTML = "📐 차트로 보면: " + t;
  }
  const ieyo = (w) => { const ch = w.replace(/[^가-힣]+$/, "").slice(-1).charCodeAt(0) - 0xac00; return ch >= 0 && ch % 28 ? "이에요" : "예요"; };
  function summary(P) {
    const card = P.root.querySelector(".chart-card"), meta = P.el.meta;
    if (!card || !meta) return;
    let el = card.querySelector(".lc-sum");
    const a = P.a || {}, t = P.taT, f = chartFacts(P.rjLast), parts = [];
    let s1 = "";
    if (a.verdict === "up" || a.verdict === "dn" || a.verdict === "mx") {
      const vw = { up: "상승", dn: "하락", mx: "혼돈" }[a.verdict];
      s1 = `AI 예측은 내일 ${em(vw, a.verdict === "up" ? "u" : a.verdict === "dn" ? "d" : "")}`;
      const d6 = a.path && a.path[5];
      if (isFinite(d6)) s1 += `, 6일 뒤 중앙값 ${em(pct(d6), d6 >= 0 ? "u" : "d")}`;
    }
    if (t) {
      const ta = t.trDn && t.oversold ? "하락 추세 속 과매도" : t.trUp && t.overbought ? "상승 추세 속 과열" : t.side === "u" ? "반등·상승 쪽" : t.side === "d" ? (t.trDn ? "하락 추세" : "하락 쪽") : t.trDn ? "하락 추세(신호는 엇갈림)" : t.trUp ? "상승 추세(신호는 엇갈림)" : "엇갈림";
      s1 += (s1 ? "이고, " : "") + `차트 지표는 ${ta}${ieyo(ta)}.`;
    } else if (s1) s1 += "이에요.";
    if (s1) parts.push(s1);
    if (f) {
      let s2 = "차트로는 ";
      if (f.done) s2 += `${f.done.name} 완성 자리라` + (f.goal1 ? ` 목표 ① ${fmt(f.goal1.price)}을 보고` : "");
      else if (f.broke) s2 += "저항선을 넘어선 자리라" + (f.goal1 ? ` 목표 ① ${fmt(f.goal1.price)}을 보고` : "");
      else if (f.ep1) s2 += `${f.pat} 저항선 아래라 ${fmt(f.ep1)} 위로 마감해야 흐름이 바뀌고`;
      else s2 += `${f.pat} 모양이고`;
      s2 = f.risk ? s2 + `, ${fmt(f.risk.price)} 아래로 내려가면 조심할 자리예요.` : `차트로는 ${f.pat} 모양이에요.`;
      if (f.np) parts.push(npLine(f.np));
      parts.push(s2);
      if (f.npWarn.length && (f.ep1 && f.gap < 0.05)) parts.push(`⚠️ 다만 최근 ${escH(f.npWarn[0])}가 있어 돌파가 나와도 조심해서 봐요.`);
    }
    if (!parts.length) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement("p"); el.className = "lc-sum"; meta.insertAdjacentElement("afterend", el); }
    el.innerHTML = `<b class="h">🧭 한눈에</b>${parts.join(" ")}`;
  }
  // 🧩 패턴 한 줄 (2026-11-22): 요약과 차트 사이 작은 칸. 해당 = 진한 색, 근접 = 빗금, 아님 = 흐리게 (해당·근접이 앞)
  const stCss = document.createElement("style");
  stCss.textContent = `.lc-strip{display:flex;flex-wrap:wrap;gap:4px;margin:-6px 0 10px}
  .lc-strip button{font:inherit;font-size:12px;line-height:1.3;padding:3px 8px;border-radius:6px;border:1px solid var(--line);background:var(--surface);color:var(--muted);cursor:pointer;white-space:nowrap}
  .lc-strip .off{opacity:.55;font-size:11.5px}.lc-strip .sep{width:1px;background:var(--line);margin:0 2px}
  .lc-strip .u{background:#E5484D;border-color:#E5484D;color:#fff;font-weight:600}.lc-strip .d{background:#3B6FE0;border-color:#3B6FE0;color:#fff;font-weight:600}
  .lc-strip .uh{border-color:#E5484D;color:#C0242F;font-weight:600;background:repeating-linear-gradient(135deg,rgba(229,72,77,.28) 0 3px,transparent 3px 7px)}
  .lc-strip .dh{border-color:#3B6FE0;color:#1D4FB0;font-weight:600;background:repeating-linear-gradient(135deg,rgba(59,111,224,.28) 0 3px,transparent 3px 7px)}
  .cr-flash{animation:crf 1.6s ease-out}@keyframes crf{0%,40%{box-shadow:0 0 0 3px #C99700}100%{box-shadow:0 0 0 0 transparent}}`;
  document.head.appendChild(stCss);
  function stripItems(c) {
    const out = [];
    (c.grid || []).forEach((g) => {
      const ma = g.name === "이동평균";
      const cls = g.side === "off" ? "off" : ma || g.word === "완성" ? (g.side === "up" ? "u" : g.side === "down" ? "d" : "uh") : g.side === "up" ? "uh" : "dh";
      out.push({ t: ma ? g.word : g.name.replace("(W)", "").replace("(M)", "").trim(), cls, key: g.name, grp: 0 });
    });
    ((c.newpat || {}).items || []).forEach((x) => out.push({ t: x.name.replace("과장 상승 다이버전스", "과장 상승 다이버"), cls: x.state === "완성" ? "u" : x.state === "완성 직전" ? "uh" : "off", key: x.name, grp: 1 }));
    const rank = { u: 0, d: 0, uh: 1, dh: 1, off: 2 };
    return out.map((x, i) => Object.assign(x, { i })).sort((a, b) => rank[a.cls] - rank[b.cls] || a.grp - b.grp || a.i - b.i);
  }
  function strip(P) {
    const card = P.root.querySelector(".chart-card"), rj = P.rjLast;
    if (!card) return;
    let el = card.querySelector(".lc-strip");
    if (!rj || !rj.card || !(rj.card.grid || []).length) { if (el) el.remove(); return; }
    const items = stripItems(rj.card);
    let html = "", seenOff = false;
    items.forEach((x) => {
      if (x.cls === "off" && !seenOff) { seenOff = true; if (html) html += '<span class="sep"></span>'; }
      const tip = x.cls === "u" || x.cls === "d" ? "해당" : x.cls === "off" ? "아님" : "근접 (가능성·완성 직전)";
      html += `<button type="button" class="${x.cls}" data-k="${escH(x.key)}" title="${escH(x.key)} · ${tip} — 누르면 오른쪽 설명으로">${escH(x.t)}</button>`;
    });
    if (!el) {
      el = document.createElement("div"); el.className = "lc-strip"; el.setAttribute("aria-label", "패턴 점검 한 줄 (진한 색 = 해당, 빗금 = 근접)");
      const sum = card.querySelector(".lc-sum"), meta = P.el.meta;
      (sum || meta).insertAdjacentElement("afterend", el);
      el.addEventListener("click", (ev) => {
        const b = ev.target.closest("button[data-k]"); if (!b) return;
        const read = P.el.read, sec = read && read.querySelector(".cr-sec"); if (!sec) return;
        const k = b.dataset.k;
        const cell = [...sec.querySelectorAll(".cr-grid > div")].find((d) => (d.querySelector("span") || {}).textContent === k) || sec;
        if (fsOn(P)) fullscreen(P, true);
        cell.scrollIntoView({ behavior: "smooth", block: "center" });
        cell.classList.remove("cr-flash"); void cell.offsetWidth; cell.classList.add("cr-flash");
      });
    } else {
      const sum = card.querySelector(".lc-sum");
      if (sum && el.previousElementSibling !== sum) sum.insertAdjacentElement("afterend", el);
    }
    el.innerHTML = html;
  }
  function extras(P) { try { oneLine(P); summary(P); strip(P); } catch (e) { /* 보조 표시라 실패해도 화면은 그대로 */ } }

  // 원본 화면이 종목을 고를 때마다 부름
  window.portalLong = function (P, co, pd) {
    setup(P);
    P.lcCo = co; P.lcPd = pd;
    if (P.lc.data && P.lc.data.sym !== P.coin) P.lc.data = null;
    P.lc.data = null;  // 지난 예측 보기 등으로 같은 종목이라도 예측이 바뀔 수 있음
    sync(P);
    if (pref.period > 0) load(P);
    P.taT = null; P.rjLast = null;
    setTimeout(() => taRender(P).then(() => rulesRender(P)).then(() => extras(P)), 0);  // 오른쪽 카드는 원본이 이 뒤에 다시 그리므로 그다음에 붙임 (차트 분석은 지표 해석 아래)
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => (window.portalPanels || []).forEach((P) => P.lc && draw(P)));
})();
