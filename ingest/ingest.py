#!/usr/bin/env python3
"""R 이 매일 GitHub 에 올리는 예측 CSV 를 Supabase 로 옮긴다 (GitHub Actions 에서 실행).

1. 저장소 6개의 CSV 를 받아 내용이 바뀌었으면 Supabase Storage(forecasts 버킷)에 날짜별로 보관, 7일 지난 건 삭제
2. 가격 차트 CSV 로 종목별 D+1 판정(대시보드와 같은 공식)과 6일 합의도를 계산해 predictions 에 저장
3. 새 CSV 의 실제 종가(SEQ=0)로 지난 예측을 채점
4. 업로드 예정 시각 + 50분이 지나도 새 CSV 가 없으면 ingest_log 에 '미수신' 기록 (GitHub 이 실패 메일을 보냄)
   단, 주말·휴장일(KRX_HOLIDAYS, US_HOLIDAYS)은 원래 새 결과가 없으니 제외

로컬 점검:  python ingest/ingest.py --dry-run   (Supabase 없이 판정 결과만 출력)
"""
import csv
import hashlib
import io
import json
import math
import os
import re
import statistics
import sys
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
OWNER = "whkim86"
BUCKET = "forecasts"
KEEP_DAYS = 7          # Storage 에 남길 날짜 수
LATE_MINUTES = 50      # R 시작 후 이 시간이 지나도 새 CSV 가 없으면 미수신
FILES = {"priority": "final_rst_dfa_web_Day_v3.csv", "chart": "final_rst_dfa_web_Day_raw_v3.csv"}
MARKETS = {
    # start: R 이 도는 시각(KST)
    "coin": {"start": (9, 0), "repos": {"priority": "coin_upbit", "chart": "coin_upbitline"}},
    "nasdaq": {"start": (8, 0), "repos": {"priority": "coin_nasdaq", "chart": "coin_nasdaqline"}},
    "kospi": {"start": (23, 0), "repos": {"priority": "coin_kospi", "chart": "coin_kospiline"}},
}

# 휴장일에는 R 결과가 같아서 커밋이 없음 → 미수신으로 보지 않음. 매년 말에 다음 해 날짜를 추가해 주세요
KRX_HOLIDAYS = {  # 한국거래소 휴장일
    "2026-09-24", "2026-09-25", "2026-10-05", "2026-10-09", "2026-12-25", "2026-12-31",
}
US_HOLIDAYS = {   # 미국 증시 휴장일 (현지 날짜)
    "2026-11-26", "2026-12-25", "2027-01-01",
}


def trading_expected(market, run_day):
    """run_day(KST)에 R 이 새 결과를 올릴 거라고 기대할 수 있는지"""
    if market == "kospi":   # 23시 실행 → 그날 한국 장 마감 데이터
        return run_day.weekday() < 5 and run_day.isoformat() not in KRX_HOLIDAYS
    if market == "nasdaq":  # 아침 8시 실행 → 전날 미국 장 마감 데이터
        us_day = run_day - timedelta(days=1)
        return us_day.weekday() < 5 and us_day.isoformat() not in US_HOLIDAYS
    return True             # 코인은 매일


DRY = "--dry-run" in sys.argv
SUPA = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
GH_TOKEN = os.environ.get("SOURCE_TOKEN") or os.environ.get("GITHUB_TOKEN")


# ---------------------------------------------------------------- HTTP
def http(method, url, body=None, headers=None):
    data = body if body is None or isinstance(body, bytes) else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            return r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {url.split('?')[0]} → {e.code} {e.read().decode(errors='replace')[:300]}") from None


def supa(method, path, body=None, **headers):
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json", **headers}
    raw = http(method, SUPA + path, body, h)
    return json.loads(raw) if raw else None


def fetch_source(repo, fname):
    h = {"Accept": "application/vnd.github.raw", "User-Agent": "foresight-ingest"}
    if GH_TOKEN:
        h["Authorization"] = f"Bearer {GH_TOKEN}"
    return http("GET", f"https://api.github.com/repos/{OWNER}/{repo}/contents/{fname}", headers=h)


def decode(raw):
    # 코인·나스닥은 UTF-8, 코스피는 CP949 로 올라옴
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return raw.decode("cp949")


# ---------------------------------------------------------------- 날짜
def to_date(label, ref):
    """'09-24 Day' → ref 에 가장 가까운 연도의 date"""
    m = re.match(r"\s*(\d{1,2})\s*-\s*(\d{1,2})", label or "")
    if not m:
        return None
    mo, d = int(m.group(1)), int(m.group(2))
    cands = []
    for y in (ref.year - 1, ref.year, ref.year + 1):
        try:
            cands.append(date(y, mo, d))
        except ValueError:
            pass
    return min(cands, key=lambda c: abs((c - ref).days)) if cands else None


def day_delta(a, b):
    """대시보드 wrapDelta 와 같음: 연도 무시한 월-일 차이"""
    d = (date(2001, *map(int, re.match(r"\s*(\d+)-(\d+)", a).groups())) -
         date(2001, *map(int, re.match(r"\s*(\d+)-(\d+)", b).groups()))).days
    return d - 365 if d > 182 else d + 365 if d < -182 else d


# ---------------------------------------------------------------- 판정 (index.html 의 analyze() 와 동일)
def analyze(text, today):
    """가격 차트 CSV → (pred_date, [예측 행], [실제 종가])"""
    by_pred = {}
    for r in csv.DictReader(io.StringIO(text)):
        try:
            pd_, sym, dt, var = r["pred_day"].strip(), r["coin"].strip(), r["date"].strip(), r["variable"].strip()
            seq, c, h, l = int(r["SEQ"]), float(r["value_close"]), float(r["value_high"]), float(r["value_low"])
        except (KeyError, ValueError, AttributeError, TypeError):
            continue
        if not pd_ or not sym or not dt or not all(map(math.isfinite, (c, h, l))):
            continue
        co = by_pred.setdefault(pd_, {}).setdefault(sym, {"hist": {}, "mod": {}})
        if seq == 0:
            co["hist"][dt] = c
        elif var:
            co["mod"].setdefault(var, {})[seq] = (dt, c)
    if not by_pred:
        raise RuntimeError("가격 차트 CSV 에서 읽을 수 있는 행이 없어요")

    pred_label = max(by_pred, key=lambda p: to_date(p, today))
    pred_date = to_date(pred_label, today)
    preds, actuals = [], []

    for sym, co in by_pred[pred_label].items():
        hist = sorted(co["hist"].items(), key=lambda kv: to_date(kv[0], pred_date))
        for dt, c in hist[-15:]:
            actuals.append({"s": sym, "d": to_date(dt, pred_date).isoformat(), "c": c})

        names = list(co["mod"])  # CSV 에 나온 순서 = 대시보드와 같음
        if not names:
            continue
        d1 = next((co["mod"][n][1][0] for n in names if 1 in co["mod"][n]), None)
        stale = d1 is not None and not (0 <= day_delta(d1, pred_label) <= 1)
        # 한 번에 upsert 하는 행은 칸 구성이 모두 같아야 해서, 지연·보류 종목도 모든 칸을 갖게 함
        row = dict.fromkeys(("base_date", "base_close", "up_n", "dn_n", "med1", "thr", "cons_up", "cons_dn"))
        row.update({"market": None, "symbol": sym, "pred_date": pred_date.isoformat(),
                    "d1_date": to_date(d1, pred_date).isoformat() if d1 else None, "n_models": len(names)})

        if stale or not hist:
            row["verdict"] = "stale" if stale else "hold"
            preds.append(row)
            continue

        base_label, base = hist[-1]
        closes = [c for _, c in hist]
        moves = [abs(closes[i] / closes[i - 1] - 1) for i in range(1, len(closes)) if closes[i - 1] > 0]
        vol = statistics.median(moves) if len(moves) >= 4 else 0.02
        thr = max(0.002, 0.25 * vol)
        r = [co["mod"][n][1][1] / base - 1 for n in names if 1 in co["mod"][n]]
        up = sum(x > thr for x in r)
        dn = sum(x < -thr for x in r)
        m = len(r) or 1
        med1 = statistics.median(r) if r else 0.0
        verdict = "up" if up / m >= 0.6 and med1 > thr else "dn" if dn / m >= 0.6 and med1 < -thr else "mx"

        # 6일 합의도: 모델 × D+1~D+6 예측 종가 중 기준 종가보다 높은/낮은 비율
        allv = [co["mod"][n][s][1] for n in names for s in range(1, 7) if s in co["mod"][n]]
        row.update({
            "base_date": to_date(base_label, pred_date).isoformat(), "base_close": base,
            "verdict": verdict, "up_n": up, "dn_n": dn, "med1": med1, "thr": thr,
            "cons_up": round(sum(v > base for v in allv) / len(allv), 4) if allv else None,
            "cons_dn": round(sum(v < base for v in allv) / len(allv), 4) if allv else None,
        })
        preds.append(row)
    return pred_date, preds, actuals


# ---------------------------------------------------------------- Supabase 작업
def already_ingested(market, kind, digest):
    q = f"/rest/v1/ingest_log?select=id&market=eq.{market}&kind=eq.{kind}&status=eq.ok&content_hash=eq.{digest}&limit=1"
    return bool(supa("GET", q))


def log(market, kind, status, **kw):
    print(f"  [{market}/{kind}] {status} {kw.get('message', '')}")
    if not DRY:
        supa("POST", "/rest/v1/ingest_log", {"market": market, "kind": kind, "status": status, **kw}, Prefer="return=minimal")


def upload(path, text):
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "text/csv; charset=utf-8", "x-upsert": "true"}
    http("POST", f"{SUPA}/storage/v1/object/{BUCKET}/{path}", text.encode("utf-8"), h)


def prune(prefix, today):
    """{prefix}/YYYY-MM-DD.csv 중 KEEP_DAYS 보다 오래된 것 삭제 (latest.csv 는 유지)"""
    items = supa("POST", f"/storage/v1/object/list/{BUCKET}", {"prefix": prefix + "/", "limit": 1000}) or []
    cutoff = today - timedelta(days=KEEP_DAYS - 1)
    old = [f"{prefix}/{it['name']}" for it in items
           if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.csv", it["name"]) and date.fromisoformat(it["name"][:10]) < cutoff]
    if old:
        supa("DELETE", f"/storage/v1/object/{BUCKET}", {"prefixes": old})
        print(f"  {prefix}: 오래된 백업 {len(old)}개 삭제")


def ingest_market(market, cfg, today):
    for kind, repo in cfg["repos"].items():
        text = decode(fetch_source(repo, FILES[kind]))
        digest = hashlib.sha256(text.encode()).hexdigest()
        if not DRY and already_ingested(market, kind, digest):
            print(f"  [{market}/{kind}] 변경 없음")
            continue

        if kind == "chart":
            pred_date, preds, actuals = analyze(text, today)
            for p in preds:
                p["market"] = market
            counts = {v: sum(p["verdict"] == v for p in preds) for v in ("up", "dn", "mx", "hold", "stale")}
            print(f"  [{market}/chart] {pred_date} 종목 {len(preds)}개 판정 {counts}")
            if DRY:
                for p in [p for p in preds if p["symbol"] in ("BTC", "SK하이닉스", "SP500", "APPLE")]:
                    print("   ", {k: p.get(k) for k in ("symbol", "d1_date", "base_date", "base_close", "verdict", "up_n", "dn_n", "cons_up", "cons_dn")})
                continue
            # 같은 CSV 가 수정돼 다시 올라와도 채점 전 판정은 최신으로 덮어씀
            for i in range(0, len(preds), 500):
                supa("POST", "/rest/v1/predictions?on_conflict=market,symbol,pred_date", preds[i:i + 500],
                     Prefer="resolution=merge-duplicates,return=minimal")
            graded = supa("POST", "/rest/v1/rpc/grade_predictions", {"p_market": market, "p_actuals": actuals})
            print(f"  [{market}/chart] 지난 예측 {graded}건 채점")
        else:
            first = next(csv.DictReader(io.StringIO(text)), None)
            pred_date = to_date(first["pred_day"], today) if first else today
            if DRY:
                print(f"  [{market}/priority] {pred_date}")
                continue

        upload(f"{market}/{kind}/{pred_date.isoformat()}.csv", text)
        upload(f"{market}/{kind}/latest.csv", text)
        prune(f"{market}/{kind}", today)
        log(market, kind, "ok", pred_date=pred_date.isoformat(), content_hash=digest, row_count=text.count("\n"))


def check_missing(market, cfg, now):
    """R 시작 시각 + 50분이 지났는데 그 이후 새 가격 차트 CSV 가 없으면 한 번만 '미수신' 기록"""
    for back in (0, 1):  # 코스피(23시)는 자정을 넘길 수 있어 어제 시작분도 확인
        d = (now - timedelta(days=back)).date()
        start = datetime(d.year, d.month, d.day, *cfg["start"], tzinfo=KST)
        if not (start + timedelta(minutes=LATE_MINUTES) <= now <= start + timedelta(hours=3)):
            continue
        if not trading_expected(market, d):
            return False
        since = start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        base = f"/rest/v1/ingest_log?select=id&market=eq.{market}&created_at=gte.{since}&limit=1"
        if supa("GET", base + "&kind=eq.chart&status=eq.ok") or supa("GET", base + "&status=eq.missing"):
            return False
        log(market, "check", "missing",
            message=f"{start:%m-%d %H:%M} 시작 후 {LATE_MINUTES}분이 지나도 새 CSV 가 없어요. R 실행을 확인해 주세요.")
        return True
    return False


def main():
    if not DRY and not (SUPA and KEY):
        sys.exit("SUPABASE_URL, SUPABASE_SERVICE_KEY 환경변수가 필요해요 (점검만 하려면 --dry-run)")
    now = datetime.now(KST)
    today = now.date()
    problems = []
    for market, cfg in MARKETS.items():
        print(f"== {market}")
        try:
            ingest_market(market, cfg, today)
        except Exception as e:  # 한 시장이 실패해도 나머지는 계속
            problems.append(f"{market}: {e}")
            try:
                log(market, "chart", "error", message=str(e)[:500])
            except Exception:
                pass
        if not DRY:
            try:
                if check_missing(market, cfg, now):
                    problems.append(f"{market}: 새 CSV 미수신")
            except Exception as e:
                problems.append(f"{market} 미수신 점검 실패: {e}")
    if problems:
        # 실패로 끝나면 GitHub 이 저장소 주인에게 메일을 보냄
        sys.exit("문제 발생:\n" + "\n".join(problems))


if __name__ == "__main__":
    main()
