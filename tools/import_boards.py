#!/usr/bin/env python3
"""GitHub 의 원본 대시보드 6개(index.html)를 가져와 포털용 boards/*.html 로 변환한다.

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
BOARDS = {  # 원본 저장소 → (시장, 종류)
    "coin_upbit": ("coin", "priority"),
    "coin_upbitline": ("coin", "chart"),
    "coin_nasdaq": ("nasdaq", "priority"),
    "coin_nasdaqline": ("nasdaq", "chart"),
    "coin_kospi": ("kospi", "priority"),
    "coin_kospiline": ("kospi", "chart"),
}
OUT = Path(__file__).resolve().parent.parent / "boards"
TOKEN = os.environ.get("SOURCE_TOKEN")

LOAD_ERR = "데이터를 불러오지 못했어요. 새로고침하거나 로그인·이용 기간을 확인해 주세요"


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


def convert(html, market, kind):
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

    # 4) 포털 도우미 스크립트 삽입 (대시보드 스크립트보다 먼저 실행되도록 <head> 안)
    inject = (
        f'<script>window.PORTAL_BOARD={{market:"{market}",kind:"{kind}"}};</script>\n'
        '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>\n'
        '<script src="../config.js"></script>\n'
        '<script src="../assets/board-data.js"></script>\n'
    )
    html = sub_once(r"</head>", inject + "</head>", html, "<head> 삽입")
    return html


def main():
    OUT.mkdir(exist_ok=True)
    for repo, (market, kind) in BOARDS.items():
        src = fetch_index(repo)
        out = convert(src, market, kind)
        (OUT / f"{repo}.html").write_text(out, encoding="utf-8", newline="\n")
        print(f"{repo:16s} → boards/{repo}.html  {len(src) // 1024:5d}KB → {len(out) // 1024:4d}KB")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        sys.exit(f"실패: {e}")
