#!/usr/bin/env python3
"""대시보드 업데이트 점검: GitHub 원본 CSV 6개와 포털 반영 상태를 한 표로 보여준다.

    python tools/check_status.py

읽기 토큰: 환경변수 SOURCE_TOKEN, 없으면 ../auto/.github_token
"""
import csv
import io
import json
import os
import re
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
KST = timezone(timedelta(hours=9))
FILES = {"priority": "final_rst_dfa_web_Day_v3.csv", "chart": "final_rst_dfa_web_Day_raw_v3.csv"}
REPOS = {
    "코인": {"priority": "coin_upbit", "chart": "coin_upbitline", "key": "coin"},
    "나스닥": {"priority": "coin_nasdaq", "chart": "coin_nasdaqline", "key": "nasdaq"},
    "코스피200": {"priority": "coin_kospi", "chart": "coin_kospiline", "key": "kospi"},
}


def token():
    t = os.environ.get("SOURCE_TOKEN")
    if t:
        return t.strip()
    f = ROOT.parent / "auto" / ".github_token"
    return f.read_text().strip() if f.exists() else None


def get(url, headers=None, data=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "foresight-check", **(headers or {})})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def main():
    tok = token()
    gh = {"Authorization": f"Bearer {tok}"} if tok else {}
    cfg = (ROOT / "config.js").read_text(encoding="utf-8")
    supa = re.search(r'SUPABASE_URL: "([^"]+)"', cfg).group(1)
    anon = re.search(r'SUPABASE_ANON_KEY: "([^"]+)"', cfg).group(1)

    # 포털에 반영된 가격 차트 예측일 (비로그인 공개 요약)
    teaser = json.loads(get(f"{supa}/rest/v1/rpc/landing_teaser", {
        "apikey": anon, "Authorization": f"Bearer {anon}", "Content-Type": "application/json"}, b"{}"))
    portal = {r["market"]: r for r in teaser}

    # 마지막 수집 실행
    runs = json.loads(get("https://api.github.com/repos/whkim86/foresight/actions/runs?per_page=1&event=workflow_dispatch"))["workflow_runs"]
    last_run = datetime.fromisoformat(runs[0]["created_at"].replace("Z", "+00:00")).astimezone(KST) if runs else None

    now = datetime.now(KST)
    print(f"점검 시각 {now:%m-%d %H:%M} KST · 마지막 수집 {last_run:%m-%d %H:%M} ({runs[0]['conclusion'] or runs[0]['status']})\n" if last_run else "")
    for name, m in REPOS.items():
        print(f"■ {name}")
        for kind, label in (("priority", "우선순위"), ("chart", "가격 차트")):
            repo = m[kind]
            c = json.loads(get(f"https://api.github.com/repos/whkim86/{repo}/commits?per_page=1", gh))[0]
            at = datetime.fromisoformat(c["commit"]["author"]["date"].replace("Z", "+00:00")).astimezone(KST)
            raw = get(f"https://api.github.com/repos/whkim86/{repo}/contents/{FILES[kind]}", {**gh, "Accept": "application/vnd.github.raw"})
            try:
                text = raw.decode("utf-8-sig")
            except UnicodeDecodeError:
                text = raw.decode("cp949")
            days = Counter(r["pred_day"].replace(" Day", "") for r in csv.DictReader(io.StringIO(text)))
            pred = max(days, key=days.get) if days else "?"
            note = []
            if kind == "chart":
                p = portal.get(m["key"])
                shown = p["pred_date"][5:] if p else "-"
                note.append(f"포털 {shown}" + (" ✅" if shown == pred else " ⏳ 아직 반영 전"))
            elif last_run:
                note.append("포털 반영됨 ✅" if last_run > at else "⏳ 다음 수집 때 반영")
            print(f"  {label:6s} 업로드 {at:%m-%d %H:%M} · 파일 예측일 {pred} · {' '.join(note)}")
        print()


if __name__ == "__main__":
    main()
