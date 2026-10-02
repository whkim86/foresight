#!/usr/bin/env python3
"""대시보드 업데이트 점검: GitHub 원본 CSV 6개와 포털 반영 상태를 한 표로 보여준다.

    python tools/check_status.py

- 업로드 시각, 파일 안 예측일, 포털 반영 여부
- 예전 데이터 경고: 업로드 시각이면 들어 있어야 할 최신 종가보다 파일의 마지막 실제값이 오래됐을 때
  (코인 오전 9시 일봉 마감 · 나스닥 한국 시간 새벽 6시경 마감 · 코스피 오후 3시 30분 마감, 주말·휴장일 제외)
- 우선순위와 가격 차트의 예측일이 서로 다를 때

읽기 토큰: 환경변수 SOURCE_TOKEN, 없으면 ../auto/.github_token
"""
import csv
import importlib.util
import io
import json
import os
import re
import sys
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

# 휴장일·날짜 해석은 수집 스크립트와 같은 것을 씀
_spec = importlib.util.spec_from_file_location("ingest", ROOT / "ingest" / "ingest.py")
ingest = importlib.util.module_from_spec(_spec)
sys.argv = [sys.argv[0], "--dry-run"]  # ingest 가 Supabase 키 없이 로드되도록
_spec.loader.exec_module(ingest)


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


def prev_trading_day(d, holidays):
    while d.weekday() >= 5 or d.isoformat() in holidays:
        d -= timedelta(days=1)
    return d


def expected_last_close(market, at):
    """업로드 시각(KST) 기준으로 이미 마감됐어야 할 가장 최근 종가 날짜"""
    if market == "coin":   # 업비트 일봉: 오전 9시에 전날 일봉 마감
        return (at - timedelta(hours=9)).date() - timedelta(days=1)
    if market == "nasdaq":  # 미국 장 마감 = 한국 시간 새벽 5~6시 → 넉넉히 7시 기준
        return prev_trading_day((at - timedelta(hours=7)).date() - timedelta(days=1), ingest.US_HOLIDAYS)
    # 코스피: 오후 3시 30분 마감 → 넉넉히 오후 5시 기준
    return prev_trading_day((at - timedelta(hours=17)).date(), ingest.KRX_HOLIDAYS)


def main():
    tok = token()
    gh = {"Authorization": f"Bearer {tok}"} if tok else {}
    cfg = (ROOT / "config.js").read_text(encoding="utf-8")
    supa = re.search(r'SUPABASE_URL: "([^"]+)"', cfg).group(1)
    anon = re.search(r'SUPABASE_ANON_KEY: "([^"]+)"', cfg).group(1)

    teaser = json.loads(get(f"{supa}/rest/v1/rpc/landing_teaser", {
        "apikey": anon, "Authorization": f"Bearer {anon}", "Content-Type": "application/json"}, b"{}"))
    portal = {r["market"]: r for r in teaser}

    # 마지막으로 '끝난' 수집 실행 (대기·진행 중인 실행은 아직 반영 전)
    runs = json.loads(get("https://api.github.com/repos/whkim86/foresight/actions/runs?per_page=10&event=workflow_dispatch"))["workflow_runs"]
    done = [r for r in runs if r["status"] == "completed" and r["conclusion"] in ("success", "failure")]
    last_run = datetime.fromisoformat(done[0]["created_at"].replace("Z", "+00:00")).astimezone(KST) if done else None
    running = runs and runs[0]["status"] != "completed"

    now = datetime.now(KST)
    print(f"점검 시각 {now:%m-%d %H:%M} KST · 마지막 완료 수집 {last_run:%m-%d %H:%M}"
          + (" · 지금 수집 중" if running else "") + "\n" if last_run else "")

    warnings = []
    for name, m in REPOS.items():
        print(f"■ {name}")
        preds = {}
        for kind, label in (("priority", "우선순위"), ("chart", "가격 차트")):
            repo = m[kind]
            c = json.loads(get(f"https://api.github.com/repos/whkim86/{repo}/commits?per_page=1", gh))[0]
            at = datetime.fromisoformat(c["commit"]["author"]["date"].replace("Z", "+00:00")).astimezone(KST)
            text = ingest.decode(get(f"https://api.github.com/repos/whkim86/{repo}/contents/{FILES[kind]}",
                                     {**gh, "Accept": "application/vnd.github.raw"}))
            rows = list(csv.DictReader(io.StringIO(text)))
            days = Counter(r["pred_day"] for r in rows)
            pred = ingest.to_date(max(days, key=days.get), at.date()) if days else None
            preds[kind] = pred
            note = []

            if kind == "chart":
                p = portal.get(m["key"])
                shown = p["pred_date"] if p else None
                note.append(f"포털 {shown[5:] if shown else '-'}" + (" ✅" if pred and shown == pred.isoformat() else " ⏳ 아직 반영 전"))
                hist = [ingest.to_date(r["date"], at.date()) for r in rows if r["SEQ"] == "0"]
                last = max(hist) if hist else None
                want = expected_last_close(m["key"], at)
                note.append(f"· 마지막 종가 {last:%m-%d}" if last else "")
                if last and last < want:
                    note.append("⚠️")
                    warnings.append(f"{name} 가격 차트: {at:%m-%d %H:%M}에 올라왔는데 마지막 종가가 {last:%m-%d}예요. "
                                    f"이 시각이면 {want:%m-%d} 종가까지 있어야 해요 → 예전 데이터를 다시 올렸거나 시세를 못 받아왔을 수 있어요.")
            elif last_run:
                note.append("포털 반영됨 ✅" if last_run > at else "⏳ 다음 수집 때 반영")
            print(f"  {label:6s} 업로드 {at:%m-%d %H:%M} · 파일 예측일 {pred:%m-%d} · {' '.join(n for n in note if n)}"
                  if pred else f"  {label:6s} 업로드 {at:%m-%d %H:%M} · 파일을 읽지 못했어요")

        if preds.get("priority") and preds.get("chart") and preds["priority"] != preds["chart"]:
            warnings.append(f"{name}: 우선순위({preds['priority']:%m-%d})와 가격 차트({preds['chart']:%m-%d})의 예측일이 달라요 → 둘 중 하나가 덜 올라왔을 수 있어요.")
        print()

    if warnings:
        print("⚠️ 확인이 필요해요")
        for w in warnings:
            print("  · " + w)
    else:
        print("✅ 모든 파일이 업로드 시각에 맞는 최신 데이터예요.")


if __name__ == "__main__":
    main()
