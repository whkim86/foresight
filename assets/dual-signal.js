// 두 신호 나란히 보기 — 우선순위 D+1 종가 신호(매수·관망·매도)와 가격 차트 D+1 판정(상승·혼돈·하락)
//  · 우선순위 화면: 순위표의 '가격 차트 판정' 칸 (판정은 supabase/stage15.sql 의 board_verdicts)
//  · 가격 차트 화면: 코인 이름 옆에 우선순위 신호 (우선순위 CSV 백업에서)
// 칸·자리는 tools/import_boards.py 가 원본 화면에 넣고, 원본이 그릴 때 portalDualRank / portalDual 을 부름
(function () {
  const sb = window.portalSb, board = window.PORTAL_BOARD;
  if (!sb || !board) return;

  const css = document.createElement("style");
  css.textContent = `
  .dv{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13px}
  .dv .k{font-size:12px;color:var(--muted)}
  .dv b,.pv b{font-weight:600;border-radius:999px;padding:2px 10px;line-height:1.5;white-space:nowrap;font-size:12.5px}
  .s-up{background:#FCE4E5;color:#B3222D}.s-dn{background:#E4ECFB;color:#1D4FB0}.s-mx{background:#FFF0D2;color:#8A5300}.s-na{background:#ECEEF3;color:#5A6478}
  .ag{font-size:12px;font-weight:600;white-space:nowrap}.ag.ok{color:#1E8A4C}.ag.part{color:var(--muted)}.ag.bad{color:#B86E00}
  .pv{white-space:nowrap}.pv .ag{margin-left:6px}.pv .wait{font-size:12px;color:var(--muted)}
  @media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .s-up{background:#4A1D22;color:#FF9AA0}
   :root:not([data-theme="light"]) .s-dn{background:#1C2A4A;color:#9DBBFF}:root:not([data-theme="light"]) .s-mx{background:#45360F;color:#FFD27A}
   :root:not([data-theme="light"]) .s-na{background:#262F47;color:#AEB7CC}:root:not([data-theme="light"]) .ag.ok{color:#5FD08F}:root:not([data-theme="light"]) .ag.bad{color:#FFB547}}
  :root[data-theme="dark"] .s-up{background:#4A1D22;color:#FF9AA0}:root[data-theme="dark"] .s-dn{background:#1C2A4A;color:#9DBBFF}
  :root[data-theme="dark"] .s-mx{background:#45360F;color:#FFD27A}:root[data-theme="dark"] .s-na{background:#262F47;color:#AEB7CC}`;
  document.head.appendChild(css);

  const VERDICT = { up: ["상승", "s-up"], dn: ["하락", "s-dn"], mx: ["혼돈", "s-mx"], hold: ["보류", "s-na"], stale: ["지연", "s-na"] };
  const SIGNAL = { buy: ["매수", "s-up"], wait: ["관망", "s-na"], sell: ["매도", "s-dn"] };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // 상승↔매수, 하락↔매도, 혼돈↔관망이면 일치 / 상승↔매도, 하락↔매수면 엇갈림 / 나머지는 부분 일치
  function agree(v, s) {
    if (!VERDICT[v] || v === "hold" || v === "stale" || !SIGNAL[s]) return "";
    const same = { up: "buy", dn: "sell", mx: "wait" }[v] === s;
    const opp = (v === "up" && s === "sell") || (v === "dn" && s === "buy");
    const [cls, txt, tip] = same ? ["ok", "✓ 일치", "두 신호가 같은 방향이에요"]
      : opp ? ["bad", "⚠ 엇갈림", "두 신호가 반대 방향이에요"] : ["part", "– 부분", "한쪽만 방향이 뚜렷해요"];
    return `<span class="ag ${cls}" title="${tip}">${txt}</span>`;
  }
  // '10-11 Day', '2026-10-11' → '10-11'
  function mmdd(s) {
    s = String(s || "");
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(5, 10);
    const m = s.match(/(\d{1,2})\s*-\s*(\d{1,2})/);
    return m ? m[1].padStart(2, "0") + "-" + m[2].padStart(2, "0") : "";
  }

  // ---------- 우선순위 화면: 가격 차트 판정 칸 ----------
  let verdicts = null, verdictDate = null, rankArgs = null;
  window.portalDualRank = function (tbody, pred) {
    rankArgs = [tbody, pred];
    if (verdicts) fillRank();
  };
  function fillRank() {
    const [tbody, pred] = rankArgs;
    const same = verdictDate && mmdd(verdictDate) === mmdd(pred);
    tbody.querySelectorAll("td.pv").forEach((td) => {
      const r = verdicts.get(td.dataset.coin);
      if (!same) { td.innerHTML = `<span class="wait" title="가격 차트가 아직 이 예측일로 업데이트되지 않았어요">업데이트 전</span>`; return; }
      if (!r) { td.innerHTML = `<span class="wait">—</span>`; return; }
      const [label, cls] = VERDICT[r.verdict] || ["-", "s-na"];
      const tip = r.n_models ? `${r.n_models}개 모델 중 상승 ${r.up_n}, 하락 ${r.dn_n}` : "";
      td.innerHTML = `<b class="${cls}" title="${tip}">${label}</b>${agree(r.verdict, td.dataset.sig)}`;
    });
  }
  if (board.kind === "priority") {
    sb.rpc("board_verdicts", { p_market: board.market }).then(({ data, error }) => {
      if (error) { console.warn("가격 차트 판정 불러오기 실패", error.message); return; }
      verdicts = new Map((data || []).map((r) => [r.symbol, r]));
      verdictDate = data && data[0] && data[0].pred_date;
      if (rankArgs) fillRank();
    });
  }

  // ---------- 가격 차트 화면: 코인 옆 우선순위 신호 ----------
  let signals = null, signalDate = null;
  const panels = new Map(); // 패널 → [코인, 판정, 예측일]
  window.portalDual = function (root, name, v, pd) {
    panels.set(root, [name, v, pd]);
    if (signals) fillPanel(root);
  };
  function fillPanel(root) {
    const [name, v, pd] = panels.get(root);
    const head = root.querySelector(".ptitle");
    if (!head) return;
    let box = head.querySelector(".dv");
    if (!box) { box = document.createElement("span"); box.className = "dv"; head.appendChild(box); }
    const s = signals.get(name);
    if (!s || mmdd(signalDate) !== mmdd(pd)) { box.innerHTML = ""; return; }
    const [label, cls] = SIGNAL[s.s] || ["-", "s-na"];
    box.innerHTML = `<span class="k">우선순위 D+1</span><b class="${cls}" title="종가 상승 확률 ${s.p}% · 신호 강도 ${s.n}">${label} ${s.p}%</b>${agree(v, s.s)}`;
  }

  // 따옴표 안 쉼표('39%,(Wait,20)')까지 처리하는 작은 CSV 읽기
  function parseCSV(text) {
    const rows = [];
    let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(f); f = ""; if (row.length > 1 || row[0]) rows.push(row); row = [];
      } else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  if (board.kind === "chart") {
    sb.storage.from("forecasts").download(`${board.market}/priority/latest.csv`).then(async ({ data, error }) => {
      if (error || !data) return;
      const rows = parseCSV((await data.text()).replace(/^﻿/, ""));
      const head = rows.shift().map((h) => h.trim());
      const ix = (k) => head.indexOf(k);
      const [iCoin, iSeq, iClose, iPred] = [ix("coin"), ix("SEQ"), ix("close_up"), ix("pred_day")];
      if ([iCoin, iSeq, iClose, iPred].some((i) => i < 0)) return;
      const first = new Map();
      for (const r of rows) {
        const seq = parseInt(r[iSeq], 10), m = String(r[iClose] || "").match(/(\d+(?:\.\d+)?)%\s*,\s*\(\s*(\w+)\s*,\s*(\d+)/);
        if (!m || isNaN(seq)) continue;
        const name = r[iCoin].trim(), old = first.get(name);
        if (!old || seq < old.seq) first.set(name, { seq, p: Math.round(+m[1]), s: m[2].toLowerCase(), n: +m[3] });
        signalDate = signalDate || r[iPred];
      }
      signals = first;
      panels.forEach((_, root) => fillPanel(root));
    });
  }
})();
