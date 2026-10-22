// 포털 안의 대시보드(boards/*.html)가 CSV 를 GitHub 대신 Supabase 에서 받게 하는 도우미.
// 로그인한 회원의 세션으로 받기 때문에, 이용권이 있는 탭의 데이터만 내려옴 (supabase/stage4b.sql 의 Storage 권한)
(function () {
  const board = window.PORTAL_BOARD; // { market: "coin", kind: "chart" } — tools/import_boards.py 가 넣음
  const cfg = window.PORTAL_CONFIG;

  // 포털 밖에서 이 페이지를 직접 열면 포털 화면으로 보냄 (빗썸처럼 탭 안 거래소면 그 탭으로)
  if (window.top === window) {
    let q = `m=${board.market}`;
    for (const [tab, m] of Object.entries(cfg.MARKETS)) {
      const x = (m.exchanges || []).find((e) => e.data === board.market);
      if (x) q = `m=${tab}&ex=${x.key}`;
    }
    location.replace(`../dashboard.html?${q}&v=${board.kind}`);
    return;
  }

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  window.portalSb = sb; // 같은 페이지의 추가 기능(ask-ai.js 등)이 함께 씀

  // 가격 차트의 예측 모델 이름: Pred1 → '모델 A' (config.js MODEL_LABELS)
  window.portalModelName = function (v) {
    const label = (cfg.MODEL_LABELS || {})[v];
    return label ? "모델 " + label : String(v).replace(/^Pred\s*/i, "모델 ");
  };

  // gzip 풀기: 브라우저 기본 기능, 없으면(아주 오래된 브라우저) 작은 라이브러리를 받아서
  async function gunzip(blob) {
    if (typeof DecompressionStream === "function") {
      return new Response(blob.stream().pipeThrough(new DecompressionStream("gzip"))).blob();
    }
    if (!window.fflate) {
      await new Promise((ok, fail) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js";
        s.onload = ok; s.onerror = fail;
        document.head.appendChild(s);
      });
    }
    return new Blob([window.fflate.gunzipSync(new Uint8Array(await blob.arrayBuffer()))]);
  }

  window.portalGunzip = gunzip;  // 지난 예측 보기(assets/history.js)도 씀

  // 원래 대시보드의 fetch('같은 폴더 CSV') 자리에 들어감. fetch 와 같은 Response 를 돌려줌
  // 가격 차트는 압축본(latest.csv.gz)을 먼저, 없으면 예전 latest.csv
  window.portalFetch = async function () {
    const dir = `${board.market}/${board.kind}`;
    const store = sb.storage.from("forecasts");
    let { data, error } = board.kind === "chart" ? await store.download(`${dir}/latest.csv.gz`) : { error: true };
    if (!error && data) {
      try {
        return new Response(await gunzip(data), { status: 200 });
      } catch (e) {
        return new Response("", { status: 500, statusText: "압축 풀기 실패" });
      }
    }
    ({ data, error } = await store.download(`${dir}/latest.csv`));
    if (error || !data) return new Response("", { status: 403, statusText: (error && error.message) || "forbidden" });
    return new Response(data, { status: 200 });
  };
})();
