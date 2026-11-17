// 가격 차트의 '긴 기간' 보기 — 기간(2주~5년)·라인/캔들·보조지표 (차트 개편 3단계, 2026-11-17)
//  · '예측 중심'(기본)을 고르면 원래 화면(모델 52개 선·중앙값·고점/저점) 그대로
//  · 기간을 고르면 그 자리에 TradingView Lightweight Charts 로 가격 원장(ingest/prices.py, <시장>/prices/) + 예측 중앙값·25~75% 범위
//  · 원본 화면이 종목을 그릴 때 portalLong(P, co, pd) 를 부름 (자리는 tools/import_boards.py 가 넣음)
//  · 고른 설정은 브라우저에 저장 (longChart.v1). 미리보기 화면(boards/chart_preview.html)과 계산 방식이 같음
(function () {
  const board = window.PORTAL_BOARD;
  if (!board || board.kind !== "chart") return;
  const LIB = "https://cdn.jsdelivr.net/npm/lightweight-charts@5.0.9/dist/lightweight-charts.standalone.production.js";
  const PERIODS = [[0, "예측 중심"], [14, "2주"], [31, "1달"], [92, "3달"], [183, "6달"], [366, "1년"], [1830, "5년"]];
  const KEY = "longChart.v1";
  let pref = { period: 0, type: "candle", ma: [20], bb: false, fib: false, sub: "vol" };
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
  .lc-chip[aria-pressed="true"]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
  .lc-box{position:relative;height:440px}
  .lc-chart{position:absolute;inset:0}
  .lc-leg{position:absolute;left:8px;top:6px;z-index:3;pointer-events:none;font-size:12.5px;line-height:1.5;background:color-mix(in srgb,var(--surface) 82%,transparent);border-radius:8px;padding:4px 8px;max-width:calc(100% - 80px)}
  .lc-leg b{font-weight:600}.lc-leg .k{color:var(--muted);margin-right:3px}.lc-leg span+span{margin-left:8px}
  .lc-leg .u{color:var(--up-text)}.lc-leg .d{color:var(--dn-ink)}
  .lc-empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--muted);padding:20px;z-index:4;background:var(--surface)}
  .lc-fine{font-size:12.5px;color:var(--muted);margin-top:8px}
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
      PERIODS.map(([d, t]) => `<button type="button" data-p="${d}">${t}</button>`).join("") + "</div></div>" +
      '<div class="lc-more"><div class="lc-row"><span class="lc-cap">차트</span><div class="seg" role="group" aria-label="차트 종류"><button type="button" data-t="line">라인</button><button type="button" data-t="candle">캔들</button></div></div>' +
      '<div class="lc-row"><span class="lc-cap">겹쳐 보기</span>' +
      [5, 15, 20, 60, 120].map((n, i) => `<button type="button" class="lc-chip" data-ma="${n}"><i style="background:var(--ma${n})"></i>${i ? n : "이동평균 5"}</button>`).join("") +
      '<button type="button" class="lc-chip" data-o="bb"><i style="background:var(--bb)"></i>볼린저 밴드</button>' +
      '<button type="button" class="lc-chip" data-o="fib"><i style="background:var(--fib)"></i>피보나치 되돌림</button></div>' +
      '<div class="lc-row"><span class="lc-cap">아래 칸</span><div class="seg" role="group" aria-label="아래 칸 지표">' +
      '<button type="button" data-s="">없음</button><button type="button" data-s="vol">거래량</button><button type="button" data-s="rsi">RSI</button><button type="button" data-s="macd">MACD</button></div></div></div>';
    const box = document.createElement("div");
    box.className = "lc-wrap";
    box.innerHTML = '<div class="lc-box"><div class="lc-chart"></div><div class="lc-leg"></div><div class="lc-empty">불러오는 중…</div></div>' +
      '<p class="lc-fine"></p><p class="lc-fine">오른쪽 음영 구간이 예측이에요: 굵은 점선은 모델 중앙값, 옅은 띠는 모델 25~75% 범위예요. 1년·5년은 주봉이에요. 끌어서 지난 기간도 볼 수 있어요. 모델별 선·고점·저점은 \'예측 중심\'에서 봐요. 보조지표는 과거 가격으로 계산한 참고값이에요. 차트: TradingView Lightweight Charts™</p>';
    const top = card.querySelector(".chart-top");
    top.insertAdjacentElement("afterend", bar);
    P.el.chart.insertAdjacentElement("afterend", box);
    P.lc = { bar, box, el: { chart: box.querySelector(".lc-chart"), leg: box.querySelector(".lc-leg"), empty: box.querySelector(".lc-empty"), note: box.querySelector(".lc-fine") }, chart: null, S: {}, data: null };
    bar.addEventListener("click", (ev) => {
      const b = ev.target.closest("button"); if (!b) return;
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

  function sync(P) {
    const L = P.lc, long = pref.period > 0;
    L.bar.querySelectorAll("[data-p]").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.p === pref.period));
    L.bar.querySelectorAll("[data-t]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.t === pref.type));
    L.bar.querySelectorAll("[data-ma]").forEach((b) => b.setAttribute("aria-pressed", pref.ma.includes(+b.dataset.ma)));
    L.bar.querySelectorAll("[data-o]").forEach((b) => b.setAttribute("aria-pressed", !!pref[b.dataset.o]));
    L.bar.querySelectorAll("[data-s]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.s === (pref.sub || "")));
    L.bar.querySelector(".lc-more").hidden = !long;
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

  // 원래 화면의 예측(co.models)·실제값(co.hist) + 가격 원장
  async function load(P) {
    const L = P.lc, co = P.lcCo, pd = P.lcPd, sym = P.coin;
    L.el.empty.hidden = false; L.el.empty.textContent = "불러오는 중…";
    try {
      const [, src] = await Promise.all([loadLib(), loadPrices(sym)]);
      if (P.coin !== sym) return;
      const today = new Date(), ref = src ? new Date(src.d[src.d.length - 1] + "T00:00:00Z") : today;
      const hist = co.hist.map((h) => ({ time: isoFromMD(h.date, ref), c: h.c, h: h.h, l: h.l })).filter((h) => h.time);
      const base = hist.length ? hist[hist.length - 1].time : null;
      let bars = src ? src.d.map((d, i) => ({ time: d, open: src.o[i], high: src.h[i], low: src.l[i], close: src.c[i], value: src.v[i] })) : [];
      // 지난 예측을 보는 중이면, 그 예측 시점까지만 실제값을 그리고 그 뒤 실제값은 따로 굵은 선
      let after = [];
      if (base && co.after && co.after.length) { after = bars.filter((b) => b.time > base); bars = bars.filter((b) => b.time <= base); }
      // 원장보다 새로운 실제값(예측 CSV)은 이어 붙임 — 시가가 없어 전날 종가로 대신
      hist.forEach((h) => {
        const last = bars[bars.length - 1];
        if (!last || h.time > last.time) bars.push({ time: h.time, open: last ? last.close : h.c, high: Math.max(h.h, h.l, h.c), low: Math.min(h.h, h.l, h.c), close: h.c, value: 0, est: true });
      });
      if (bars.length < 2) { L.el.empty.textContent = "이 종목은 아직 쌓인 가격 기록이 없어요. '예측 중심'으로 봐 주세요."; L.data = null; return; }
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
      L.el.empty.textContent = "긴 기간 가격을 불러오지 못했어요. '예측 중심'으로 보거나 잠시 뒤 다시 시도해 주세요.";
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

    if (fc.length) {  // 예측 구간 음영
      S.bg = chart.addSeries(LW.HistogramSeries, { priceScaleId: "lcbg", color: css("--fc-bg"), priceLineVisible: false, lastValueVisible: false });
      chart.priceScale("lcbg").applyOptions({ visible: false, scaleMargins: { top: 0, bottom: 0 } });
      S.bg.setData(fc.map((f) => ({ time: f.time, value: 1 })));
    }
    if (pref.type === "candle") {
      S.main = chart.addSeries(LW.CandlestickSeries, { priceFormat: PF, upColor: up, downColor: dn, borderUpColor: up, borderDownColor: dn, wickUpColor: up, wickDownColor: dn, priceLineVisible: false });
      S.main.setData(bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })));
    } else {
      S.main = chart.addSeries(LW.LineSeries, { priceFormat: PF, color: ink, lineWidth: 2, priceLineVisible: false });
      S.main.setData(bars.map((b) => ({ time: b.time, value: b.close })));
    }
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
      const panes = chart.panes(); if (panes[1]) panes[1].setHeight(Math.round(L.el.chart.clientHeight * 0.26));
    }
    // 보이는 기간
    const end = fc.length ? fc[fc.length - 1].time : D.after.length ? D.after[D.after.length - 1].time : bars[bars.length - 1].time;
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

  // 원본 화면이 종목을 고를 때마다 부름
  window.portalLong = function (P, co, pd) {
    setup(P);
    P.lcCo = co; P.lcPd = pd;
    if (P.lc.data && P.lc.data.sym !== P.coin) P.lc.data = null;
    P.lc.data = null;  // 지난 예측 보기 등으로 같은 종목이라도 예측이 바뀔 수 있음
    sync(P);
    if (pref.period > 0) load(P);
  };
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => (window.portalPanels || []).forEach((P) => P.lc && draw(P)));
})();
