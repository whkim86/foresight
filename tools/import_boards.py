#!/usr/bin/env python3
"""GitHub 의 원본 대시보드(index.html)를 가져와 포털용 boards/*.html 로 변환한다.

원본 대시보드를 고친 뒤 포털에도 반영하려면:  python tools/import_boards.py
(원본 저장소가 비공개면 환경변수 SOURCE_TOKEN 에 읽기 토큰을 넣고 실행)

바꾸는 것
- 같은 폴더 CSV 를 받던 fetch(...) → portalFetch() : 로그인 세션으로 Supabase 에서 받음
- HTML 안에 통째로 들어 있던 예전 데이터(#csv) → 머리글만 남기고 삭제
- 안내 문구 중 '같은 폴더', '내장 데이터' 표현을 포털에 맞게 수정
"""
import os
import re
import sys
import urllib.request
from pathlib import Path

OWNER = "whkim86"
# 포털 보드 파일 이름 → (원본 저장소, 시장, 종류, 바꿀 문구)
#   시장은 Supabase 백업 경로(forecasts/<시장>/<종류>/latest.csv)와 같음. bithumb 은 코인 탭 안의 빗썸 전환
BOARDS = {
    "coin_upbit": ("coin_upbit", "coin", "priority", {}),
    "coin_upbitline": ("coin_upbitline", "coin", "chart", {}),
    "coin_bithumb": ("coin-bithumb", "bithumb", "priority", {}),
    # 빗썸 가격 차트는 원본 화면이 없어 업비트 가격 차트 화면을 그대로 쓰고 이름만 바꿈
    "coin_bithumbline": ("coin_upbitline", "bithumb", "chart", {"(업비트, 6일예측)": "(빗썸, 6일예측)"}),
    "coin_nasdaq": ("coin_nasdaq", "nasdaq", "priority", {}),
    "coin_nasdaqline": ("coin_nasdaqline", "nasdaq", "chart", {}),
    "coin_kospi": ("coin_kospi", "kospi", "priority", {}),
    "coin_kospiline": ("coin_kospiline", "kospi", "chart", {}),
}
# 보드별로 추가로 붙이는 기능 스크립트 (assets/ 아래)
EXTRA_JS = {
    ("coin", "priority"): ["ask-ai.js"],  # BTC 아래 'AI에게 물어보기' (프리미엄)
}
ALL_JS = ["dual-signal.js"]  # 모든 보드에 붙임
# 가격 차트: 모델이 많을 때(15개 초과, 예: 52개) 기본은 '중앙값 선 + 25~75% 범위'만 보이고 개별 모델 선은 골라서 켜기.
# 중앙값·범위는 판정과 같게 항상 전체 모델 기준. 원본 코드 조각이 바뀌면 오류로 알려줌
CHART_PATCHES = [
    ("function legendSample(i){",
     "var MANY=15;\n"
     "function qtl(s,p){var i=(s.length-1)*p,lo=Math.floor(i),hi=Math.ceil(i);return s[lo]+(s[hi]-s[lo])*(i-lo);}\n"
     "function topList(){return (window.portalTop&&window.portalTop.list)||[];}\n"
     "function topSet(){return new Set(topList().map(function(t){return t.name}));}\n"
     "function topHidden(P,co){var T=topSet();return new Set(co.modelNames.filter(function(m){return !(P.top&&T.has(m))}));}\n"
     "window.portalApplyTop=function(){(window.portalPanels||[]).forEach(function(P){ if(P.coin) P.setCoin(P.coin); });};\n"
     "function legendSample(i){"),
    ("else if(b.dataset.act==='all'){ P.hidden.clear(); }",
     "else if(b.dataset.act==='all'){ P.hidden.clear(); }\n"
     "    else if(b.dataset.act==='none'){ co.modelNames.forEach(function(m){P.hidden.add(m)}); }\n"
     "    else if(b.dataset.act==='top'){ P.topUser=!P.top; P.top=P.topUser&&topList().length>0; P.hidden=topHidden(P,co); }\n"
     "    if(b.dataset.act==='all'||b.dataset.act==='none'){ P.top=false; P.topUser=false; }"),
    ("P.el.legend.addEventListener('pointerleave',function(){P.setHi(null)});",
     "P.el.legend.addEventListener('pointerleave',function(){P.setHi(null)});\n"
     "  P.el.legend.addEventListener('toggle',function(ev){ if(ev.target.classList.contains('lg-more')) P.moreOpen=ev.target.open; },true);\n"
     "  (window.portalPanels=window.portalPanels||[]).push(P);"),
    ("P.coin=name; P.hidden=new Set(); P.hi=null;",
     "P.coin=name; P.hidden=new Set(); P.hi=null;\n"
     "    if(co.modelNames.length>MANY){ P.median=true; P.top=(P.topUser==null||P.topUser)&&topList().length>0; P.hidden=topHidden(P,co); }"),
    ("""    co.modelNames.forEach(function(m){
      var i=cur.D.idx[m];
      h+='<button class="lg" data-model="'+esc(m)+'" aria-pressed="'+(!P.hidden.has(m))+'">'+legendSample(i)+esc(m)+'</button>';
    });
    h+='<button class="lg tool" data-act="all">전체 켜기</button>';
    if(P.a.outliers.length) h+='<button class="lg tool" data-act="out">튀는 모델 끄기</button>';
    h+='<button class="lg tool" data-act="med" aria-pressed="'+P.median+'">중앙값 선</button>';""",
     """    var mb='';
    co.modelNames.forEach(function(m){
      var i=cur.D.idx[m];
      mb+='<button class="lg" data-model="'+esc(m)+'" aria-pressed="'+(!P.hidden.has(m))+'">'+legendSample(i)+esc(m)+'</button>';
    });
    if(co.modelNames.length>MANY){
      var TL=topList().filter(function(t){return co.models[t.name]});
      h+='<button class="lg tool" data-act="med" aria-pressed="'+P.median+'">중앙값·25~75% 범위</button>';
      if(TL.length) h+='<button class="lg tool" data-act="top" aria-pressed="'+!!P.top+'">상승 적중 TOP'+TL.length+'</button>';
      h+='<button class="lg tool" data-act="all">모델 선 모두 켜기</button><button class="lg tool" data-act="none">모델 선 모두 끄기</button>';
      if(TL.length&&P.top){
        h+='<div class="lg-top"><span class="lg-cap" title="최근 '+window.portalTop.days+'일 동안 각 모델이 상승을 예측한 경우 중 실제로 오른 비율(D+1~D+6 합산). 예측 수가 너무 적은 모델은 제외">최근 '+window.portalTop.days+'일 상승 예측 적중률 상위</span>';
        TL.forEach(function(t){ h+='<button class="lg" data-model="'+esc(t.name)+'" aria-pressed="'+(!P.hidden.has(t.name))+'" title="상승 예측 '+t.up_n+'번 중 '+t.up_hit+'번 적중">'+legendSample(cur.D.idx[t.name])+esc(t.name)+' <b>'+t.rate+'%</b></button>'; });
        h+='</div>';
      }
      if(P.a.outliers.length) h+='<button class="lg tool" data-act="out">튀는 모델 끄기</button>';
      h+='<details class="lg-more"'+(P.moreOpen?' open':'')+'><summary>개별 모델 '+co.modelNames.length+'개 골라 보기 (켜진 선 '+(co.modelNames.length-P.hidden.size)+'개)</summary><div class="lg-list">'+mb+'</div></details>';
    }else{
      h+=mb;
      h+='<button class="lg tool" data-act="all">전체 켜기</button>';
      if(P.a.outliers.length) h+='<button class="lg tool" data-act="out">튀는 모델 끄기</button>';
      h+='<button class="lg tool" data-act="med" aria-pressed="'+P.median+'">중앙값 선</button>';
    }"""),
    ("    var actual=co.hist;\n    var vals=[];",
     """    var actual=co.hist;
    var band=[];
    if(P.median){
      var byAll={}; co.modelNames.forEach(function(m){co.models[m].forEach(function(p){ if(isFinite(p[k])) (byAll[p.n]||(byAll[p.n]=[])).push(p[k]); })});
      Object.keys(byAll).map(Number).sort(function(a,b){return a-b}).forEach(function(n){
        var s=byAll[n].slice().sort(function(a,b){return a-b});
        band.push({n:n,v:median(s),q1:qtl(s,.25),q3:qtl(s,.75),cnt:s.length});
      });
    }
    var vals=[]; band.forEach(function(b){vals.push(b.q1,b.q3,b.v)});"""),
    ("if(!vals.length){ box.innerHTML='<p class=\"empty\">표시할 모델이 없어요. 범례에서 모델을 켜 주세요.</p>'; return; }",
     "if(!vals.length){ box.innerHTML='<p class=\"empty\">표시할 모델이 없어요. 범례에서 모델이나 중앙값을 켜 주세요.</p>'; return; }"),
    ("    series.forEach(function(s){\n      var d=s.pts.map(",
     """    if(band.length>1){
      g+='<path class="band" d="'+band.map(function(b,i){return (i?'L':'M')+X(b.n).toFixed(1)+' '+Y(b.q3).toFixed(1)}).join('')
        +band.slice().reverse().map(function(b){return 'L'+X(b.n).toFixed(1)+' '+Y(b.q1).toFixed(1)}).join('')+'Z"/>';
    }
    series.forEach(function(s){
      var d=s.pts.map("""),
    ("""    var medPts=[];
    if(P.median){
      var byN={}; series.forEach(function(s){s.pts.forEach(function(p){(byN[p.n]||(byN[p.n]=[])).push(p[k])})});
      Object.keys(byN).map(Number).sort(function(a,b){return a-b}).forEach(function(n){medPts.push({n:n,v:median(byN[n])})});
      if(medPts.length) g+=""",
     """    var medPts=band;
    if(P.median){
      if(medPts.length) g+="""),
    ("      if(!html) return;",
     """      if(!html){
        var bp=band.filter(function(b){return b.n===n})[0];
        if(bp){
          html='<div class="th"><i style="background:var(--ink)"></i>모델 '+bp.cnt+'개 중앙값 · '+esc(fmtDate(dateOf[n]))+'</div>';
          html+='<div class="tr"><span>'+METRIC[P.metric]+' 중앙값</span><b>'+fmtNum(bp.v)+'</b></div>';
          if(base) html+='<div class="tr"><span>직전 종가 대비</span><b>'+pct(bp.v/base.c-1)+'</b></div>';
          html+='<div class="tm">25~75% 범위 '+fmtNum(bp.q1)+' ~ '+fmtNum(bp.q3)+'</div>';
          dotV=bp.v;
        }
      }
      if(!html) return;"""),
    ("15개 모델의 D+1 종가를", "'+cur.D.order.length+'개 모델의 D+1 종가를"),
    ("</style>",
     ".band{fill:var(--ink);opacity:.09}\n"
     ".lg-more{width:100%;font-size:12.5px;color:var(--muted)}\n"
     ".lg-more summary{cursor:pointer;padding:4px 2px}\n"
     ".lg-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}\n"
     ".lg-top{width:100%;display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:8px 0 2px}\n"
     ".lg-cap{font-size:12px;color:var(--muted);margin-right:4px}.lg-top .lg b{font-weight:600}\n"
     "</style>"),
]

# 두 신호 나란히 보기 (assets/dual-signal.js 가 채움)
#  · 우선순위 순위표: '가격 차트 판정' 칸 추가 — D+1 종가 신호(매수·관망·매도)와 가격 차트 판정(상승·혼돈·하락) 비교
#  · 가격 차트: 코인 이름 옆에 우선순위 D+1 종가 신호
PRIORITY_PATCHES = [
    ("<th>종가 상승 평균</th></tr></thead>", "<th>종가 상승 평균</th><th>가격 차트 판정</th></tr></thead>"),
    ("+round(s.avg.c)+'%</td></tr>';",
     "+round(s.avg.c)+'%</td><td class=\"pv\" data-coin=\"'+esc(s.co.name)+'\" data-sig=\"'+((s.co.days[0]||{}).c||{}).s+'\"></td></tr>';"),
    ("$('#rankBody').innerHTML=h;",
     "$('#rankBody').innerHTML=h; if(window.portalDualRank) window.portalDualRank($('#rankBody'),state.pred);"),
]
DUAL_CHART_PATCH = ("b.textContent=(v==='stale'||v==='hold')?VLAB[v]:'D+1 '+VLAB[v];",
                    "b.textContent=(v==='stale'||v==='hold')?VLAB[v]:'D+1 '+VLAB[v];\n"
                    "    if(window.portalDual) window.portalDual(root,name,v,cur.pd,P.a);")

OUT = Path(__file__).resolve().parent.parent / "boards"
TOKEN = os.environ.get("SOURCE_TOKEN")

# CSS·JS 주소 뒤 ?v= 값. 브라우저 캐시 때문에 디자인·코드를 바꾸면 모든 html 의 ?v= 와 함께 올려야 바로 반영됨
ASSET_VERSION = "20261012d"

LOAD_ERR ="데이터를 불러오지 못했어요. 새로고침하거나 로그인·이용 기간을 확인해 주세요"


def fetch_index(repo):
    h = {"Accept": "application/vnd.github.raw", "User-Agent": "foresight-import"}
    if TOKEN:
        h["Authorization"] = f"Bearer {TOKEN}"
    req = urllib.request.Request(f"https://api.github.com/repos/{OWNER}/{repo}/contents/index.html", headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8")


def sub_once(pattern, repl, text, what, flags=0):
    new, n = re.subn(pattern, repl, text, flags=flags)
    if n != 1:
        raise RuntimeError(f"{what}: {n}곳이 바뀜 (1곳이어야 함) — 원본 구조가 달라졌는지 확인해 주세요")
    return new


def convert(html, market, kind, texts=None):
    for a, b in (texts or {}).items():
        if a not in html:
            raise RuntimeError(f"바꿀 문구 '{a}'가 원본에 없어요")
        html = html.replace(a, b)

    # 1) 내장 데이터: 머리글 한 줄만 남김
    def keep_header(m):
        body = m.group(2).lstrip("\r\n")
        return m.group(1) + body.split("\n", 1)[0].rstrip("\r") + "\n" + m.group(3)
    html = sub_once(r'(<script type="text/plain" id="csv">)(.*?)(</script>)', keep_header, html, "내장 데이터", re.S)

    # 2) 처음에 내장 데이터를 그리던 호출 제거 (Supabase 데이터가 오면 그때 그림)
    html = sub_once(r"load\(\$\('#csv'\)\.textContent,[^;]*\);", "void 0;", html, "내장 데이터 표시")

    # 3) 같은 폴더 CSV → Supabase
    html = sub_once(r"fetch\([^)]*?,\{cache:'no-store'\}\)", "portalFetch()", html, "CSV 불러오기")
    html = sub_once(r"\.catch\(function\(\)\{\s*setMsg\([^;]*?'err'\);\s*\}\)",
                    f".catch(function(){{ setMsg('{LOAD_ERR}','err'); }})", html, "불러오기 실패 문구")
    html = html.replace("같은 폴더의 최신 CSV를 불러왔어요", "최신 예측을 불러왔어요").replace("같은 폴더의 CSV 파일", "최신 예측 데이터")

    # 3-1) 가격 차트: 예측 모델 이름 Pred1 → '모델 A' (board-data.js portalModelName), 정렬도 알파벳 순서가 되게
    if kind == "chart":
        html = sub_once(r"va=\(r\[ix\.variable\]\|\|''\)\.trim\(\);",
                        "va=portalModelName((r[ix.variable]||'').trim());", html, "모델 이름")
        # 이름표가 A~Z 다음 AA, AB… 로 이어지므로 글자 이름은 26진수로 정렬
        numkey = (r"function numKey(n){var s=String(n),m=s.match(/\d+/);if(m)return parseInt(m[0],10);"
                  r"var l=s.match(/([A-Z]+)$/);if(!l)return 1e9;var v=0;for(var i=0;i<l[1].length;i++)v=v*26+l[1].charCodeAt(i)-64;return 1000+v}")
        html = sub_once(r"function numKey\(n\)\{[^}]*\}", lambda _m: numkey, html, "모델 정렬")

    # 3-2) 모델 52개 대비(CHART_PATCHES), 두 신호 나란히 보기(DUAL_CHART_PATCH, PRIORITY_PATCHES)
    patches = (CHART_PATCHES + [DUAL_CHART_PATCH]) if kind == "chart" else PRIORITY_PATCHES
    for a, b in patches:
        if html.count(a) != 1:
            raise RuntimeError(f"{kind} 화면 수정 위치를 못 찾음 ({html.count(a)}곳): {a[:40]!r}")
        html = html.replace(a, b)

    # 4) 포털 도우미 스크립트 삽입 (대시보드 스크립트보다 먼저 실행되도록 <head> 안)
    inject = (
        f'<script>window.PORTAL_BOARD={{market:"{market}",kind:"{kind}"}};</script>\n'
        '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\n'
        f'<script src="../config.js?v={ASSET_VERSION}"></script>\n'
        f'<script src="../assets/board-data.js?v={ASSET_VERSION}"></script>\n'
    )
    html = sub_once(r"</head>", inject + "</head>", html, "<head> 삽입")

    # 5) 보드별 추가 기능 (대시보드 스크립트가 #app 을 만든 뒤 실행되도록 </body> 앞)
    extra = "".join(f'<script src="../assets/{js}?v={ASSET_VERSION}"></script>\n'
                    for js in ALL_JS + EXTRA_JS.get((market, kind), []))
    if extra:
        html = sub_once(r"</body>", extra + "</body>", html, "</body> 삽입")
    return html


def main():
    OUT.mkdir(exist_ok=True)
    cache = {}
    for name, (repo, market, kind, texts) in BOARDS.items():
        src = cache.get(repo) or cache.setdefault(repo, fetch_index(repo))
        out = convert(src, market, kind, texts)
        (OUT / f"{name}.html").write_text(out, encoding="utf-8", newline="\n")
        print(f"{repo:16s} → boards/{name}.html  {len(src) // 1024:5d}KB → {len(out) // 1024:4d}KB")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.exit(f"실패: {e}")
