// 신호등 친구들: 홈 화면 '내 신호등 친구' 카드 · 마이페이지 '내 친구 방' (supabase/stage28.sql game_card)
//  · 쓰는 곳: <div id="friendCard"></div> (홈) / <div id="friendRoom"></div> (마이페이지) 를 두고 GameCard.mount() 부르기
//  · 데이터·캐릭터 그림은 app.js 의 Portal.gameCard() · Portal.loadChars() 를 같이 씀 (한 화면에서 한 번만 받음)
(function () {
  const fmt = (n) => Math.round(n || 0).toLocaleString("ko-KR") + "P";
  const pct = (x) => (x >= 0 ? "+" : "") + (x * 100).toFixed(1) + "%";
  const left = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60, p = (n) => String(n).padStart(2, "0");
    return h ? `${h}시간 ${p(m)}분 ${p(x)}초` : `${m}분 ${p(x)}초`; };
  setInterval(() => document.querySelectorAll("[data-fc-until]").forEach((el) => {
    const ms = new Date(el.dataset.fcUntil) - Date.now();
    el.textContent = ms > 0 ? left(ms) : "마감";
  }), 1000);

  function missions(c) {
    const m = c.missions || {};
    const it = (on, label, href) => `<a class="${on ? "done" : ""}" href="${href}">${on ? "✅" : "⬜"} ${label}</a>`;
    return `<div class="fc-mis"><b>🎁 오늘의 미션 <small style="font-weight:400;color:var(--sub)">각 +${fmt(m.points || 1000)}</small></b>
      ${it(m.login, "출석", "game.html")}${it(m.chart, "차트 보기", "dashboard.html")}${it(m.post, "글쓰기", "board.html?b=game")}</div>`;
  }
  function expBar(c) {
    const span = c.level_next ? c.level_next - c.level_floor : 1, cur = c.level_next ? c.exp - c.level_floor : span;
    return `<div class="fc-bar"><i style="width:${Math.max(3, Math.min(100, cur / span * 100))}%"></i></div>`;
  }
  const zOf = (G, c) => G.Z.find((x) => x.id === c.character) || G.Z[2];

  function home(el, c, G) {
    if (!c.joined) {
      el.innerHTML = `<div class="card friend-card"><div class="fc-char">${G.draw("tiger", {}, "fc0", true)}</div>
        <div><h3>🐯 신호등 친구들 모의투자</h3><p class="fc-sub">12지 친구를 고르면 <b>100,000P</b>로 시작해요. AI 신호를 보고 포인트를 걸어 레벨을 올려 보세요!</p>
        <a class="btn" href="game.html">친구 고르러 가기</a></div></div>`;
      return;
    }
    const z = zOf(G, c), r = c.recent || {};
    const recent = r.n ? `<span>최근 정산 <b class="${r.profit >= 0 ? "pos" : "neg"}">${r.profit >= 0 ? "+" : ""}${fmt(r.profit)}</b>${r.ret != null ? ` (${pct(r.ret)})` : ""} ${r.profit >= 0 ? "🎉" : "💦"}</span>` : "";
    el.innerHTML = `<div class="card friend-card"><a class="fc-char" href="game.html">${G.draw(c.character, Portal.dressOf(c), "fc", false)}</a>
      <div><h3>내 신호등 친구 · ${z.n} <small style="color:var(--sub);font-weight:600">Lv.${c.level}</small></h3>${expBar(c)}
        <div class="fc-stats"><span>보유 <b>${fmt(c.points)}</b></span>${recent}<span>오늘 투자 <b>${5 - c.today_left}/5</b></span>
          ${c.next_cutoff ? `<span>⏰ 다음 마감까지 <b data-fc-until="${c.next_cutoff}">${left(new Date(c.next_cutoff) - Date.now())}</b></span>` : ""}</div>
        ${missions(c)}
        <div class="fc-btns"><a class="btn" href="game.html">${c.broke ? "😵 친구 보러 가기" : "🐾 오늘 투자하러 가기"}</a></div></div></div>`;
  }

  function room(el, c, G) {
    if (!c.joined) { home(el, c, G); return; }
    const z = zOf(G, c);
    el.innerHTML = `<div class="card friend-card friend-room"><a class="fc-char" href="game.html">${G.draw(c.character, Portal.dressOf(c), "fr", false)}</a>
      <div><h3>🏠 내 친구 방 · ${z.n} <small style="color:var(--sub);font-weight:600">Lv.${c.level}</small></h3>
        <p class="fc-sub">${z.a}띠 · ${z.s}</p>${expBar(c)}
        <div class="fc-stats"><span>보유 <b>${fmt(c.points)}</b></span><span>투자 중 <b>${fmt(c.invested)}</b></span>
          <span>총 수익률 <b class="${(c.total_ret || 0) >= 0 ? "pos" : "neg"}">${pct(c.total_ret || 0)}</b></span></div>
        ${missions(c)}
        <label style="display:flex;gap:6px;align-items:center;font-size:13px;margin-bottom:10px;cursor:pointer">
          <input type="checkbox" id="fcName" ${c.show_name ? "checked" : ""}> 순위표·영상에 내 닉네임 공개 <small style="color:var(--sub)">(끄면 '익명 ${z.a} #번호')</small></label>
        <div class="fc-btns"><a class="btn" href="game.html#closet">👕 꾸미기</a><a class="btn ghost" href="game.html">🐾 모의투자</a></div></div></div>`;
    el.querySelector("#fcName").onchange = async (e) => {
      const { data, error } = await Portal.sb.rpc("game_show_name", { p_on: e.target.checked });
      if (error) { e.target.checked = !e.target.checked; return; }
      c.show_name = !!data; Portal.toast(data ? "🙋 순위표에 닉네임이 보여요" : "🙈 순위표에 익명으로 보여요");
    };
  }

  async function mount() {
    const h = document.getElementById("friendCard"), r = document.getElementById("friendRoom");
    if (!h && !r) return;
    const [c, G] = await Promise.all([Portal.gameCard(), Portal.loadChars()]);
    if (!c || !c.allowed || !G) return;
    if (h) home(h, c, G);
    if (r) room(r, c, G);
  }
  window.GameCard = { mount };
})();
