// AI 패턴해석 — 가격 차트 아래 주석 (검증 중인 참고 해석, D+1 판정과 별개)
//  #1 · 6일 흐름: 모델×D+1~D+6 예측 종가 중 직전 실제 종가보다 아래(위)인 비율이 70% 이상이면 하락(상승) 기운 강함
//  기준·계산은 ingest/ingest.py 의 PATTERNS["p1_70"] 과 같음. 운영자는 '패턴해석' 탭에서 60%·70% 기준 성적을 비교
//  원본 화면이 종목을 그릴 때 portalPattern 을 부름 (자리는 tools/import_boards.py 가 넣음). 적중률 숫자는 회원에게 보여주지 않음
(function () {
  const board = window.PORTAL_BOARD;
  if (!board || board.kind !== "chart") return;
  const T = 0.7;

  const css = document.createElement("style");
  css.textContent = `
  .pat-note{margin:12px 0 2px;padding:10px 12px 9px;border:1px dashed var(--line-strong,#C3CBD8);border-radius:12px;font-size:13px;line-height:1.6}
  .pat-note .pn-h{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-weight:600}
  .pat-note .pn-h b{font-weight:600;border-radius:999px;padding:1px 10px;font-size:12.5px;white-space:nowrap}
  .pat-note .pn-tag{font-size:11.5px;font-weight:500;color:var(--muted);border:1px solid var(--line,#DCE1EA);border-radius:999px;padding:0 7px}
  .pat-note p{margin:4px 0 0}
  .pat-note .pn-f{font-size:12px;color:var(--muted)}`;
  document.head.appendChild(css);

  window.portalPattern = function (root, co, a) {
    let box = root.querySelector(".pat-note");
    if (!box) {
      box = document.createElement("div");
      box.className = "pat-note";
      const after = root.querySelector(".legend");
      if (after) after.insertAdjacentElement("afterend", box); else return;
    }
    const base = a && a.base && a.base.c;
    if (!base || !a || a.verdict === "stale" || a.verdict === "hold") { box.hidden = true; return; }
    let below = 0, above = 0, n = 0;
    co.modelNames.forEach((m) => co.models[m].forEach((p) => {
      if (p.seq >= 1 && p.seq <= 6 && isFinite(p.c)) { n++; if (p.c < base) below++; else if (p.c > base) above++; }
    }));
    if (!n) { box.hidden = true; return; }
    const dn = below / n, up = above / n, pc = (x) => Math.round(x * 100) + "%";
    const sig = dn >= T ? "dn" : up >= T ? "up" : "none";
    const chip = sig === "dn" ? `<b class="s-dn">하락 기운 강함</b>` : sig === "up" ? `<b class="s-up">상승 기운 강함</b>` : `<b class="s-na">한쪽으로 뚜렷하지 않음</b>`;
    const body = sig === "none"
      ? `모델 ${co.modelNames.length}개의 6일 치 예측값 중 직전 종가보다 아래 ${pc(dn)} · 위 ${pc(up)}로, 한쪽이 ${pc(T)}를 넘지 않아요.`
      : `모델 ${co.modelNames.length}개의 6일 치 예측값 ${n}개 중 <b style="padding:0">${pc(sig === "dn" ? dn : up)}</b>가 직전 종가보다 ${sig === "dn" ? "아래" : "위"}에 있어요.`;
    const extra = board.market === "nasdaq" ? " 나스닥은 다음 날보다 며칠 뒤 흐름을 볼 때 참고하세요." : "";
    box.hidden = false;
    box.innerHTML = `<div class="pn-h">🧩 AI 패턴해석 #1 · 6일 흐름 ${chip}<span class="pn-tag">검증 중</span></div>
      <p>${body}</p>
      <p class="pn-f">여러 모델의 예측선이 한쪽으로 몰린 정도를 본 참고 해석이에요. D+1 판정과는 별개이고, 정확도를 확인하는 중이에요.${extra}</p>`;
  };
})();
