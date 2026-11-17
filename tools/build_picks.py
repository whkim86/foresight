"""쇼츠에 나온 종목을 가입 없이 볼 수 있는 공개 페이지(s/<종목>/) + 목록(s/) + sitemap.xml 을 만든다.

python tools/build_picks.py            # 최신 쇼츠 데이터로 다시 만듦
- 데이터: 각 쇼츠 폴더의 data/*.json (업비트·나스닥·코스피 TOP5, 코스피·코스닥 지수, 집중 쇼츠 6종목)
- 빗썸은 넣지 않음 (빗썸 쇼츠에는 홈페이지 안내를 하지 않기로 함)
- 페이지는 종목마다 하나(s/NEO/)이고 새 데이터가 오면 덮어씀 → 쇼츠·검색에서 같은 주소로 들어옴
- 회원 화면의 52개 모델 차트·전체 순위는 공개하지 않음: 요약(판정·모델 수·중앙값과 25~75% 범위)만
- 적중률 숫자는 넣지 않음 (회원 화면에도 노출 금지 방침)
"""
import ast
import datetime as dt
import html
import json
import re
import sys
from pathlib import Path
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]          # 클로드폴더
SITE_DIR = Path(__file__).resolve().parents[1]      # foresight
OUT = SITE_DIR / "s"
SITE = "https://www.ai-sinhodeung.co.kr"
VER = "20261118a"   # 페이지가 쓰는 style.css·app.js 캐시 버전 (다른 html 과 같게)
KST = dt.timezone(dt.timedelta(hours=9))

# 시장 → 화면 이름·대시보드 주소·가격 단위
MK = {
    "upbit": dict(label="코인 · 업비트", dash="m=coin&ex=upbit", unit="원", kind="코인"),
    "nasdaq": dict(label="미국 주식", dash="m=nasdaq", unit="달러", kind="종목"),
    "kospi": dict(label="코스피200", dash="m=kospi", unit="원", kind="종목"),
    "index": dict(label="코스피 지수", dash="m=kospi", unit="", kind="지수"),
}
FOCUS_MK = {"coin": "upbit", "us": "nasdaq", "kr": "kospi"}
INDEX_SLUG = {"코스피": ("KOSPI", "코스피"), "코스닥": ("KOSDAQ", "코스닥")}
DISALLOW = ["admin.html", "analytics.html", "accuracy.html", "models.html", "patterns.html", "views.html", "ai.html",
            "mypage.html", "write.html", "dashboard.html", "boards/"]


def esc(s):
    return html.escape(str(s), quote=True)


def lit(v):
    """쇼츠 데이터의 chart 는 가끔 파이썬 표기 문자열로 저장돼 있음"""
    if isinstance(v, str):
        try:
            return ast.literal_eval(v)
        except (ValueError, SyntaxError):
            return None
    return v


def latest(folder, pattern="*.json"):
    files = sorted((ROOT / folder / "data").glob(pattern), key=lambda p: p.stem[-10:])
    return files[-1] if files else None


def parse_votes(text):
    """'52개 모델: 상승 (52개 중 44개)' / '52개 중 47개 상승' / '52개 모델 중 상승 38 · 하락 10' → (판정, 설명)"""
    text = text or ""
    v = next((w for w in ("상승", "하락", "혼돈") if w in text), "혼돈")
    m = re.search(r"(\d+)개 중 (\d+)개", text)
    if m:
        return v, f"{m.group(1)}개 모델 중 {m.group(2)}개가 {v}"
    m = re.search(r"(\d+)개 모델 중 상승 (\d+) · 하락 (\d+)", text)
    if m:
        return v, f"{m.group(1)}개 모델 중 상승 {m.group(2)} · 하락 {m.group(3)}"
    m = re.search(r"(\d+)개 모델", text)
    return v, (f"{m.group(1)}개 모델 의견이 갈렸어요" if m else "모델 의견이 갈렸어요")


def collect():
    picks = {}

    def add(p):
        old = picks.get(p["slug"])
        # 같은 종목이 여러 쇼츠에 나오면 더 최신 날짜, 같은 날이면 집중 쇼츠(설명이 더 많음)를 씀
        if old and (old["date"], old.get("rich", 0)) > (p["date"], p.get("rich", 0)):
            return
        picks[p["slug"]] = p

    for market, folder in (("upbit", "upbit_shorts"), ("nasdaq", "nasdaq_shorts"), ("kospi", "kospi_shorts")):
        f = latest(folder)
        if not f:
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        for t in d.get("top5", []):
            sym = t.get("name") or t.get("ticker")
            ko = t.get("name_ko") or ""
            if market == "nasdaq":
                verdict, votes = parse_votes(f"{t.get('d1_votes', '')} {t.get('d1_verdict', '')}")
            else:
                verdict, votes = parse_votes(t.get("cross"))
            add(dict(slug=sym, sym=sym, ko=ko if ko != sym else "", market=market, date=d["date"], verdict=verdict,
                     votes=votes, chart=lit(t.get("chart")), reason=t.get("reason") or "", rank=t.get("rank"),
                     today=True))
        if market == "kospi":
            idx = d.get("market") if isinstance(d.get("market"), list) else []   # 코스피·코스닥 지수 요약
            for x in idx:
                if x.get("name") not in INDEX_SLUG:
                    continue
                slug, ko = INDEX_SLUG[x["name"]]
                verdict, votes = parse_votes(f"{x.get('detail', '')} {x.get('d1', '')}")
                add(dict(slug=slug, sym=slug, ko=ko, market="index", date=d["date"], verdict=verdict, votes=votes,
                         chart=lit(x.get("chart")), reason="", today=True))

    seen = {}
    for f in sorted((ROOT / "focus_shorts" / "data").glob("*.json"), key=lambda p: p.stem[-10:]):
        d = json.loads(f.read_text(encoding="utf-8"))
        seen[d["key"]] = d
    newest = max((d["date"] for d in seen.values()), default="")
    for key, d in seen.items():
        market = FOCUS_MK.get(d.get("kind"), "upbit")
        models = d.get("models") or 0
        verdict = d.get("verdict") or "혼돈"
        votes = f"{models}개 모델 중 상승 {d.get('up', 0)} · 하락 {d.get('dn', 0)}"
        extra = d.get("pattern") or ""
        add(dict(slug=key, sym=d.get("en") or key, ko=d.get("name") or "", market=market, date=d["date"], verdict=verdict,
                 votes=votes, chart=lit(d.get("chart")), reason=extra, rich=1,
                 today=d["date"] >= (dt.date.fromisoformat(newest) - dt.timedelta(days=1)).isoformat() if newest else False))
    return [p for p in picks.values() if p.get("chart") and p["chart"].get("hist") and p["chart"].get("fc")]


# ---------- 차트 (SVG, 외부 라이브러리 없이) ----------

def fmt_price(x, unit):
    if x >= 1000:
        s = f"{x:,.0f}"
    elif x >= 10:
        s = f"{x:,.2f}".rstrip("0").rstrip(".")
    else:
        s = f"{x:.4g}"
    return s + ({"원": "원", "달러": "$"}.get(unit, ""))


def chart_svg(p):
    c = p["chart"]
    hist, fc = c["hist"][-8:], c["fc"]   # 최근 8일만: 휴대폰에서 예측 구간이 넓게 보이게
    hd = c.get("hd") or []
    d0 = str(hd[-len(hist)])[:5] if len(hd) >= len(hist) else c.get("d0", "")
    W, H, L, R, T, B = 520, 300, 10, 14, 30, 34
    vals = hist + [v for q in fc for v in q]
    lo, hi = min(vals), max(vals)
    pad = (hi - lo) * 0.08 or hi * 0.02 or 1
    lo, hi = lo - pad, hi + pad
    n = len(hist) + len(fc)
    X = lambda i: L + (W - L - R) * i / (n - 1)
    Y = lambda v: T + (H - T - B) * (1 - (v - lo) / (hi - lo))
    col = {"상승": "#E5383B", "하락": "#2463EB"}.get(p["verdict"], "#C99700")
    i0 = len(hist) - 1
    base = hist[-1]
    band_top = [(X(i0), Y(base))] + [(X(i0 + 1 + k), Y(q[2])) for k, q in enumerate(fc)]
    band_bot = [(X(i0 + 1 + k), Y(q[0])) for k, q in enumerate(fc)][::-1] + [(X(i0), Y(base))]
    pts = lambda arr: " ".join(f"{x:.1f},{y:.1f}" for x, y in arr)
    hist_line = pts([(X(i), Y(v)) for i, v in enumerate(hist)])
    med_line = pts([(X(i0), Y(base))] + [(X(i0 + 1 + k), Y(q[1])) for k, q in enumerate(fc)])
    ex, ey = X(n - 1), Y(fc[-1][1])
    chg = fc[-1][1] / base - 1
    return f"""<svg viewBox="0 0 {W} {H}" role="img" aria-label="최근 {len(hist)}일 종가와 앞으로 {len(fc)}일 예측 범위" class="pk-chart">
  <line x1="{X(i0):.1f}" y1="{T}" x2="{X(i0):.1f}" y2="{H - B}" stroke="#C5CAD6" stroke-dasharray="4 4"/>
  <polygon points="{pts(band_top + band_bot)}" fill="{col}" fill-opacity=".14"/>
  <polyline points="{hist_line}" fill="none" stroke="#12182B" stroke-width="2.4" stroke-linejoin="round"/>
  <polyline points="{med_line}" fill="none" stroke="{col}" stroke-width="3" stroke-linejoin="round"/>
  <circle cx="{X(i0):.1f}" cy="{Y(base):.1f}" r="4.5" fill="#12182B"/>
  <circle cx="{ex:.1f}" cy="{ey:.1f}" r="6" fill="#fff" stroke="{col}" stroke-width="3"/>
  <text x="{W - R}" y="{20}" text-anchor="end" font-size="18" font-weight="700" fill="{col}">6일 뒤 {chg * 100:+.1f}%</text>
  <text x="{L}" y="{H - 10}" font-size="15" fill="#8A93A6">{esc(d0)}</text>
  <text x="{X(i0):.1f}" y="{H - 10}" font-size="15" fill="#12182B" text-anchor="middle" font-weight="600">{esc(c.get('dl', ''))} 기준</text>
  <text x="{W - R}" y="{H - 10}" font-size="15" fill="#8A93A6" text-anchor="end">{esc(c.get('de', ''))}</text>
</svg>""", chg, col


# ---------- 페이지 ----------

HEAD = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="AI 신호등">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{site}/assets/og-image.png">
<meta property="og:locale" content="ko_KR">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="{up}assets/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{up}assets/style.css?v={ver}">
<style>
.pk {{ max-width: 760px; margin: 0 auto; padding: 28px 16px 56px; display: flex; flex-direction: column; gap: 18px; }}
.pk-hero {{ color: #fff; display: flex; flex-direction: column; gap: 8px; }}
.pk-hero small {{ color: #B7BFD0; font-size: 13px; }}
.pk-hero h1 {{ margin: 0; font-size: clamp(26px, 6vw, 36px); line-height: 1.25; }}
.pk-verdict {{ display: flex; align-items: center; gap: 14px; }}
.pk-verdict b {{ font-size: 28px; }}
.pk-verdict span {{ color: var(--sub); font-size: 14.5px; }}
.pk-chart {{ width: 100%; height: auto; display: block; }}
.pk-legend {{ display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 12.5px; color: var(--muted); }}
.pk-legend i {{ display: inline-block; width: 14px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 5px; }}
.pk-cta {{ display: flex; flex-direction: column; gap: 10px; text-align: center; }}
.pk-cta .btn {{ width: 100%; }}
.pk-cta p {{ margin: 0; font-size: 13px; color: var(--muted); }}
.pk-list {{ display: grid; gap: 10px; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); }}
.pk-item {{ display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 14px 16px; text-decoration: none; color: var(--ink); }}
.pk-item small {{ display: block; color: var(--muted); font-size: 12px; margin-top: 2px; }}
.pk-note {{ font-size: 12px; color: var(--faint); line-height: 1.6; text-align: center; }}
.v-up {{ color: var(--up); }} .v-mx {{ color: var(--mx-ink); }} .v-dn {{ color: var(--dn); }}
</style>
<script type="application/ld+json">{ld}</script>
</head>
<body class="home landing">
<header class="topbar">
  <a class="brand" href="{up}index.html"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><b><span class="ai">AI</span>신호등</b></a>
  <nav class="nav">
    <a href="{up}s/">오늘의 무료 종목</a>
    <a class="btn sm cta-top" href="{signup}">무료로 시작하기</a>
  </nav>
</header>
"""

TAIL = """
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="{up}config.js?v={ver}"></script>
<script src="{up}assets/app.js?v={ver}"></script>
<script>
// 방문 흐름 기록(운영자 '방문 흐름' 화면) + 이미 로그인한 회원은 버튼을 바로 그 종목 차트로
(async function () {{
  try {{ Portal.track("{track}"); }} catch (e) {{}}
  try {{
    const {{ data: {{ session }} }} = await Portal.sb.auth.getSession();
    if (session) document.querySelectorAll("a[data-member]").forEach((a) => {{ a.href = a.dataset.member; a.textContent = a.dataset.memberText || a.textContent; }});
  }} catch (e) {{}}
}})();
</script>
</body>
</html>
"""

VCLS = {"상승": "v-up", "하락": "v-dn", "혼돈": "v-mx"}
LAMP = {"상승": "up", "하락": "dn", "혼돈": "mx"}


def name_of(p):
    return f"{p['ko']}({p['sym']})" if p["ko"] and p["ko"] != p["sym"] else (p["ko"] or p["sym"])


def dash_next(p):
    return f"dashboard.html?{MK[p['market']]['dash']}&v=chart&s={quote(p['sym'] if p['market'] != 'index' else p['slug'])}"


def signup_url(next_path, up=""):
    return f"{up}login.html?next={quote(next_path, safe='')}#signup"


def mmdd(date):
    return f"{int(date[5:7])}/{int(date[8:10])}"


def page(p):
    up = "../../"
    m = MK[p["market"]]
    nm = name_of(p)
    svg, chg, col = chart_svg(p)
    when = mmdd(p["date"])
    title = f"{nm} 전망 {when} · AI 52개 모델 6일 예측 | AI 신호등"
    desc = (f"{when} 기준 {nm} 다음 거래일 AI 판정은 '{p['verdict']}'. {p['votes']}. "
            f"6일 뒤 예측 중앙값 {chg * 100:+.1f}%. 52개 예측 모델의 6일 가격 흐름을 신호등으로 정리했어요.")
    url = f"{SITE}/s/{quote(p['slug'])}/"
    nxt = dash_next(p)
    signup = signup_url(nxt, up)
    ld = json.dumps({"@context": "https://schema.org", "@type": "Article", "headline": title, "description": desc,
                     "dateModified": p["date"], "inLanguage": "ko", "url": url,
                     "publisher": {"@type": "Organization", "name": "AI 신호등", "url": SITE}}, ensure_ascii=False)
    reason = f"<p style=\"margin:10px 0 0;color:var(--sub);font-size:14px\">참고: {esc(p['reason'])}</p>" if p["reason"] else ""
    base = p["chart"]["hist"][-1]
    body = f"""
<main class="pk">
  <section class="pk-hero on-night">
    <small>{esc(m['label'])} · {esc(when)} 예측 · AI 모델 {p['chart'].get('n', 52)}개</small>
    <h1>{esc(nm)} 전망</h1>
  </section>

  <section class="card">
    <div class="pk-verdict">
      <div class="lamp {LAMP.get(p['verdict'], 'mx')}" aria-hidden="true"><i></i><i></i><i></i></div>
      <div><small style="color:var(--muted);font-size:12.5px">다음 거래일(D+1) AI 판정</small><br>
        <b class="{VCLS.get(p['verdict'], 'v-mx')}">{esc(p['verdict'])}</b><br><span>{esc(p['votes'])}</span></div>
    </div>
    {reason}
  </section>

  <section class="card">
    <h3 style="margin-bottom:6px">6일 예측 흐름</h3>
    <p class="hint" style="margin:0 0 10px;font-size:13px">기준가 {esc(fmt_price(base, m['unit']))} · 6일 뒤 예측 중앙값 <b class="{VCLS.get(p['verdict'], 'v-mx')}">{chg * 100:+.1f}%</b></p>
    {svg}
    <div class="pk-legend"><span><i style="background:#12182B"></i>실제 종가</span><span><i style="background:{col}"></i>모델 예측 중앙값</span><span><i style="background:{col};height:8px;opacity:.2"></i>모델 25~75% 범위</span></div>
  </section>

  <section class="card pk-cta">
    <b style="font-size:17px">{esc(nm)}의 모델별 6일 차트와 전체 순위</b>
    <a class="btn big red" href="{signup}" data-member="{up}{esc(nxt)}" data-member-text="{esc(nm)} 차트 바로 보기">7일 무료로 전체 차트 보기</a>
    <p>닉네임·이메일만으로 가입 · 카드 등록 없음 · 가입하면 바로 이 {esc(m['kind'])} 차트로 이동해요</p>
  </section>

  <a class="btn ghost" href="{up}s/" style="align-self:center">오늘 무료로 공개된 다른 종목 보기 →</a>

  <p class="pk-note">이 페이지는 여러 예측 모델의 출력을 요약한 참고 자료이며, 투자 권유나 종목 추천이 아닙니다.<br>투자 판단과 그 결과에 대한 책임은 이용자 본인에게 있습니다.</p>
  <p class="legal-links"><a href="{up}terms.html">이용약관</a>·<a href="{up}privacy.html"><b>개인정보처리방침</b></a></p>
</main>"""
    return (HEAD.format(title=esc(title), desc=esc(desc), url=url, site=SITE, up=up, ver=VER, ld=ld, signup=signup)
            + body + TAIL.format(up=up, ver=VER, track="pick"))


def index_page(picks):
    up = "../"
    today = [p for p in picks if p.get("today")]
    rest = [p for p in picks if not p.get("today")]
    order = list(MK)

    def item(p):
        return (f'<a class="card pk-item" href="{quote(p["slug"])}/"><span><b>{esc(name_of(p))}</b>'
                f'<small>{esc(MK[p["market"]]["label"])} · {mmdd(p["date"])} 예측</small></span>'
                f'<b class="{VCLS.get(p["verdict"], "v-mx")}">{esc(p["verdict"])}</b></a>')

    def sort_key(p):
        return (order.index(p["market"]), p.get("rank") or 0, p["slug"])

    sec = f'<div class="pk-list">{"".join(item(p) for p in sorted(today, key=sort_key))}</div>'
    older = (f'<h2 style="font-size:17px;margin:12px 0 0">지난 공개 종목</h2><div class="pk-list">'
             f'{"".join(item(p) for p in sorted(rest, key=lambda p: p["date"], reverse=True))}</div>') if rest else ""
    title = "오늘의 무료 공개 종목 · AI 신호등"
    desc = "유튜브 쇼츠에 나온 코인·미국 주식·코스피 종목의 AI 52개 모델 6일 예측을 가입 없이 무료로 확인하세요."
    url = f"{SITE}/s/"
    ld = json.dumps({"@context": "https://schema.org", "@type": "CollectionPage", "name": title, "url": url,
                     "inLanguage": "ko"}, ensure_ascii=False)
    body = f"""
<main class="pk">
  <section class="pk-hero on-night">
    <small>매일 업데이트 · 가입 없이 무료</small>
    <h1>오늘의 무료 공개 종목</h1>
    <p style="margin:0;color:#B7BFD0">유튜브 쇼츠에 나온 종목의 AI 판정과 6일 예측 흐름을 누구나 볼 수 있어요</p>
  </section>
  {sec}
  {older}
  <section class="card pk-cta">
    <b style="font-size:17px">전체 종목 순위와 모델별 차트는 회원 화면에서</b>
    <a class="btn big red" href="{signup_url('index.html', up)}" data-member="{up}index.html" data-member-text="내 포털로 가기">7일 무료로 시작하기</a>
    <p>닉네임·이메일만으로 가입 · 카드 등록 없음 · 7일 뒤 자동 결제 없음</p>
  </section>
  <p class="pk-note">이 페이지는 여러 예측 모델의 출력을 요약한 참고 자료이며, 투자 권유나 종목 추천이 아닙니다.</p>
  <p class="legal-links"><a href="{up}terms.html">이용약관</a>·<a href="{up}privacy.html"><b>개인정보처리방침</b></a></p>
</main>"""
    return (HEAD.format(title=esc(title), desc=esc(desc), url=url, site=SITE, up=up, ver=VER, ld=ld,
                        signup=signup_url("index.html", up)) + body + TAIL.format(up=up, ver=VER, track="pick_list"))


def sitemap(picks):
    now = dt.datetime.now(KST).date().isoformat()
    urls = [(f"{SITE}/", now, "daily", "1.0"), (f"{SITE}/s/", now, "daily", "0.9"),
            (f"{SITE}/privacy.html", now, "yearly", "0.3"), (f"{SITE}/terms.html", now, "yearly", "0.3"),
            (f"{SITE}/catalog.html", now, "weekly", "0.6"), (f"{SITE}/game.html", now, "weekly", "0.5")]
    urls += [(f"{SITE}/s/{quote(p['slug'])}/", p["date"], "daily", "0.8") for p in picks]
    rows = "\n".join(f"  <url><loc>{u}</loc><lastmod>{d}</lastmod><changefreq>{c}</changefreq><priority>{pr}</priority></url>"
                     for u, d, c, pr in urls)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{rows}\n</urlset>\n'


def robots():
    return "User-agent: *\nAllow: /\n" + "".join(f"Disallow: /{p}\n" for p in DISALLOW) + f"\nSitemap: {SITE}/sitemap.xml\n"


def main():
    picks = collect()
    if not picks:
        sys.exit("쇼츠 데이터가 없어요")
    OUT.mkdir(exist_ok=True)
    # 예전에 만든 페이지도 목록에 남김 (데이터 폴더에서 빠져도 페이지는 유지)
    manifest_path = OUT / "picks.json"
    old = {p["slug"]: p for p in json.loads(manifest_path.read_text(encoding="utf-8"))} if manifest_path.exists() else {}
    for p in picks:
        d = OUT / p["slug"]
        d.mkdir(exist_ok=True)
        (d / "index.html").write_text(page(p), encoding="utf-8")
    keep = {p["slug"]: p for p in picks}
    for slug, p in old.items():
        if slug not in keep and (OUT / slug / "index.html").exists():
            keep[slug] = dict(p, today=False)
    allp = list(keep.values())
    (OUT / "index.html").write_text(index_page(allp), encoding="utf-8")
    slim = [{k: p.get(k) for k in ("slug", "sym", "ko", "market", "date", "verdict", "votes", "rank", "today")} for p in allp]
    manifest_path.write_text(json.dumps(slim, ensure_ascii=False, indent=1), encoding="utf-8")
    (SITE_DIR / "sitemap.xml").write_text(sitemap(allp), encoding="utf-8")
    (SITE_DIR / "robots.txt").write_text(robots(), encoding="utf-8")
    today = [p["slug"] for p in allp if p.get("today")]
    print(json.dumps({"pages": len(allp), "today": today}, ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
