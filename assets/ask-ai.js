// 'AI에게 물어보기' — 코인 우선순위 대시보드의 BTC 영역 바로 아래에 붙는 질문칸
// 이용권(운영자 또는 AI 만료일이 남은 회원)이 없으면 아무것도 표시하지 않음
(function () {
  const sb = window.portalSb;
  if (!sb) return;

  const EXAMPLES = ["6일 합의도가 무슨 뜻이야?", "오늘 D+1 판정은 왜 이렇게 나왔어?", "D+3 확률이 낮은 이유가 뭐야?"];
  const css = `
  .ai-ask{margin:18px 0 28px;border:1px solid #E2E5EC;border-radius:16px;background:#fff;padding:20px 22px;font-family:inherit;color:#12182B;position:relative;overflow:hidden}
  .ai-ask::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:linear-gradient(90deg,#E5383B 0 33.3%,#F2B705 33.3% 66.6%,#2463EB 66.6%)}
  .ai-ask .hd{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}
  .ai-ask .hd b{font-size:16px;display:flex;align-items:center;gap:8px}
  .ai-ask .tag{font-size:11px;font-weight:700;color:#8A6400;background:#FFF5D1;border-radius:999px;padding:3px 9px}
  .ai-ask .left{font-size:12.5px;color:#8A93A6}
  .ai-ask .ex{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
  .ai-ask .ex button{border:1px solid #E2E5EC;background:#F5F6FA;border-radius:999px;padding:6px 12px;font:inherit;font-size:12.5px;color:#5B6478;cursor:pointer}
  .ai-ask .ex button:hover{border-color:#12182B;color:#12182B}
  .ai-ask .log{display:flex;flex-direction:column;gap:10px;margin-bottom:12px}
  .ai-ask .q{align-self:flex-end;max-width:85%;background:#0F1424;color:#fff;border-radius:14px 14px 4px 14px;padding:10px 14px;font-size:14px;white-space:pre-wrap}
  .ai-ask .a{align-self:flex-start;max-width:92%;background:#F5F6FA;border-radius:14px 14px 14px 4px;padding:12px 15px;font-size:14px;line-height:1.65;white-space:pre-wrap}
  .ai-ask .a.err{background:#FDECEC;color:#A11D28}
  .ai-ask .a.wait{color:#8A93A6}
  .ai-ask form{display:flex;gap:8px;align-items:flex-end}
  .ai-ask textarea{flex:1;min-height:46px;max-height:140px;resize:vertical;border:1px solid #E2E5EC;border-radius:12px;padding:12px 14px;font:inherit;font-size:14px;outline:none}
  .ai-ask textarea:focus{border-color:#12182B;box-shadow:0 0 0 3px rgba(18,24,43,.08)}
  .ai-ask .send{height:46px;padding:0 18px;border:0;border-radius:12px;background:#0F1424;color:#fff;font:inherit;font-size:14px;font-weight:700;cursor:pointer}
  .ai-ask .send:disabled{opacity:.45;cursor:default}
  .ai-ask .note{margin:10px 0 0;font-size:11.5px;color:#ADB3C1;line-height:1.5}`;

  function build(status) {
    const el = document.createElement("section");
    el.className = "ai-ask";
    el.setAttribute("aria-label", "AI에게 물어보기");
    el.innerHTML = `
      <div class="hd"><b>AI에게 물어보기 · BTC <span class="tag">프리미엄 베타</span></b>
        <span class="left"></span></div>
      <div class="ex">${EXAMPLES.map((q) => `<button type="button">${q}</button>`).join("")}</div>
      <div class="log" aria-live="polite"></div>
      <form>
        <label for="aiq" style="position:absolute;left:-9999px">질문</label>
        <textarea id="aiq" maxlength="500" placeholder="오늘 BTC 데이터에 대해 궁금한 점을 물어보세요 (Enter 전송, Shift+Enter 줄바꿈)"></textarea>
        <button class="send" type="submit">보내기</button>
      </form>
      <p class="note">AI는 이 화면의 BTC 예측 데이터만 풀어서 설명해요. 매수·매도 판단이나 목표가는 답하지 않아요.</p>`;

    const $ = (s) => el.querySelector(s);
    const log = $(".log"), ta = $("textarea"), btn = $(".send");
    let left = status.daily_limit - status.used;
    const showLeft = () => ($(".left").textContent = `오늘 남은 질문 ${left}/${status.daily_limit}`);
    showLeft();

    function bubble(cls, text) {
      const d = document.createElement("div");
      d.className = cls;
      d.textContent = text;
      log.appendChild(d);
      return d;
    }

    async function ask(q) {
      q = q.trim();
      if (!q || btn.disabled) return;
      if (left <= 0) { bubble("a err", "오늘 질문을 모두 쓰셨어요. 내일 다시 이용해 주세요."); return; }
      bubble("q", q);
      ta.value = "";
      btn.disabled = true;
      const wait = bubble("a wait", "AI가 데이터를 살펴보는 중이에요…");
      const { data, error } = await sb.functions.invoke("ask-ai", { body: { question: q } });
      if (error) {
        let msg = "답변을 가져오지 못했어요. 잠시 뒤 다시 시도해 주세요.";
        try { msg = (await error.context.json()).error || msg; } catch (e) { /* 기본 문구 */ }
        wait.className = "a err";
        wait.textContent = msg;
      } else {
        wait.className = "a";
        wait.textContent = data.answer;
        left = data.remaining;
        showLeft();
      }
      btn.disabled = false;
      ta.focus();
    }

    $("form").addEventListener("submit", (e) => { e.preventDefault(); ask(ta.value); });
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(ta.value); }
    });
    el.querySelectorAll(".ex button").forEach((b) => b.addEventListener("click", () => ask(b.textContent)));
    return el;
  }

  (async function init() {
    const { data, error } = await sb.rpc("ai_status");
    const status = data && data[0];
    if (error || !status || !status.allowed) return;

    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const panel = build(status);

    // 대시보드가 다시 그려질 때마다(예측일·필터 변경) BTC 영역 바로 아래로 같은 칸을 옮겨 붙임 — 대화 내용 유지
    const place = () => {
      const btc = document.querySelector("#app section.btc");
      if (btc && btc.nextElementSibling !== panel) btc.after(panel);
    };
    new MutationObserver(place).observe(document.getElementById("app"), { childList: true, subtree: true });
    place();
  })();
})();
