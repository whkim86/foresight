// 지난 예측 보기 — 우선순위·가격 차트 위에 '예측 수행일' 선택 (최근 7개 날짜)
//  Storage 의 날짜별 백업 forecasts/<시장>/<종류>/YYYY-MM-DD.csv(.gz) 를 고른 날짜만 받아서 화면에 넘김
//  가격 차트는 원본 화면(window.portalHist.show)이 그 뒤 실제 가격을 예측선 위에 이어 그림 (자리는 tools/import_boards.py)
(function () {
  const board = window.PORTAL_BOARD, sb = window.portalSb;
  if (!board || !sb || window.top === window) return;
  const DAYS = 7;
  const SNAP = /^(\d{4}-\d{2}-\d{2})\.csv(\.gz)?$/;
  const dir = `${board.market}/${board.kind}`;
  const cache = new Map();

  const css = document.createElement("style");
  css.textContent = `
  .hist-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:4px 0 14px;font-size:14px}
  .hist-bar label{font-weight:600}
  .hist-bar select{border:1px solid var(--line-strong,#C3CBD8);border-radius:10px;background:var(--paper,#fff);color:inherit;padding:7px 10px;font-size:14px}
  .hist-bar .hb-msg{font-size:13px;color:var(--muted)}
  .hist-bar .hb-past{font-size:12.5px;border-radius:999px;padding:2px 10px;background:var(--fc-bg,#FFF6E0);border:1px solid var(--line,#DCE1EA)}
  .past-note{margin:8px 0 0;font-size:13px;line-height:1.7}
  .past-note b{font-weight:700}
  .past-note .lg{margin-left:6px}`;
  document.head.appendChild(css);

  function label(iso, latest) {
    const d = new Date(iso + "T00:00:00Z");
    return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${"일월화수목금토"[d.getUTCDay()]}) 예측${latest ? " · 최신" : ""}`;
  }

  async function files() {
    const { data, error } = await sb.storage.from("forecasts").list(dir, { limit: 100, sortBy: { column: "name", order: "desc" } });
    if (error || !data) return [];
    const by = new Map();  // 같은 날짜에 .csv 와 .csv.gz 가 함께 있으면 .gz(새 것)
    data.forEach((it) => {
      const m = it.name.match(SNAP);
      if (m && (!by.has(m[1]) || m[2])) by.set(m[1], it.name);
    });
    return [...by.keys()].sort().reverse().slice(0, DAYS).map((d) => ({ date: d, name: by.get(d) }));
  }

  async function text(f) {
    if (cache.has(f.date)) return cache.get(f.date);
    const { data, error } = await sb.storage.from("forecasts").download(`${dir}/${f.name}`);
    if (error || !data) throw new Error((error && error.message) || "download");
    const blob = f.name.endsWith(".gz") ? await window.portalGunzip(data) : data;
    const t = await blob.text();
    cache.set(f.date, t);
    return t;
  }

  // 원본 화면이 최신 데이터를 다 그린 뒤 시작
  let tries = 0;
  (function wait() {
    const h = window.portalHist;
    if (h && h.ready()) return start(h);
    if (++tries < 240) setTimeout(wait, 250);
  })();

  async function start(h) {
    const list = await files();
    if (list.length < 2) return;  // 지난 날짜가 아직 없으면 표시 안 함
    const app = document.getElementById("app");
    if (!app) return;
    const bar = document.createElement("div");
    bar.className = "hist-bar";
    bar.innerHTML = `<label for="histSel">📅 지난 예측 보기</label>
      <select id="histSel">${list.map((f, i) => `<option value="${f.date}">${label(f.date, i === 0)}</option>`).join("")}</select>
      <span class="hb-msg" role="status"></span>`;
    app.insertAdjacentElement("beforebegin", bar);
    const sel = bar.querySelector("select"), msg = bar.querySelector(".hb-msg");
    const hint = board.kind === "chart"
      ? "<span class=\"hb-past\">지난 예측 · 그 뒤 실제 가격을 굵은 선으로 이어 붙였어요</span>"
      : "<span class=\"hb-past\">지난 예측을 보고 있어요</span>";
    sel.onchange = async () => {
      const f = list.find((x) => x.date === sel.value);
      sel.disabled = true;
      msg.textContent = "불러오는 중…";
      try {
        if (f === list[0]) h.show(null);
        else h.show(await text(f), label(f.date) + " 데이터");
        msg.innerHTML = f === list[0] ? "" : hint;
      } catch (e) {
        msg.textContent = "그날 데이터를 불러오지 못했어요";
      }
      sel.disabled = false;
    };
  }
})();
