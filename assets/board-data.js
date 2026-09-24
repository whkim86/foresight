// 포털 안의 대시보드(boards/*.html)가 CSV 를 GitHub 대신 Supabase 에서 받게 하는 도우미.
// 로그인한 회원의 세션으로 받기 때문에, 이용권이 있는 탭의 데이터만 내려옴 (supabase/stage4b.sql 의 Storage 권한)
(function () {
  const board = window.PORTAL_BOARD; // { market: "coin", kind: "chart" } — tools/import_boards.py 가 넣음

  // 포털 밖에서 이 페이지를 직접 열면 포털 화면으로 보냄
  if (window.top === window) {
    location.replace(`../dashboard.html?m=${board.market}&v=${board.kind}`);
    return;
  }

  const cfg = window.PORTAL_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  // 원래 대시보드의 fetch('같은 폴더 CSV') 자리에 들어감. fetch 와 같은 Response 를 돌려줌
  window.portalFetch = async function () {
    const { data, error } = await sb.storage.from("forecasts").download(`${board.market}/${board.kind}/latest.csv`);
    if (error || !data) return new Response("", { status: 403, statusText: (error && error.message) || "forbidden" });
    return new Response(data, { status: 200 });
  };
})();
