"""가격 원장: 종목별 일봉(시가·고가·저가·종가·거래량)을 최대 5년치 모아 Supabase Storage 에 보관
- 저장 위치: forecasts/<시장>/prices/<파일>.json.gz  (시장 = coin·bithumb·nasdaq·kospi → 기존 '이용권 있는 탭' 규칙으로 보호)
  목록: forecasts/<시장>/prices/index.json  {"files": {종목: 파일}, "last": {종목: 마지막 날짜}, "checked": 확인 시각}
- 파일 모양(열 단위): {"sym","src","d":[날짜…],"o":[…],"h":[…],"l":[…],"c":[…],"v":[…]}
- 종목 목록은 각 시장의 최신 가격 차트 CSV(<시장>/chart/latest.csv.gz) 에서 꺼냄 → R 에 종목이 늘면 자동으로 따라감
- 출처: 업비트·빗썸 공식 공개 API (원화 마켓), 나스닥·코스피는 야후(ingest/price_tickers.json, R 수집과 같은 티커)
- 처음 보는 종목은 5년치를 한 번에 채우고, 그 뒤로는 최근 2주만 다시 받아 덮어씀 (거래소가 값을 고치는 경우 대비)
- 끝난 날의 봉만 저장: 업비트 09시 기준, 빗썸 0시 기준, 코스피 장 마감 16시 뒤, 나스닥 현지 16시 30분 뒤

사용:
  python ingest/prices.py                       # 모든 시장 (GitHub Actions, SUPABASE_SERVICE_KEY 필요)
  python ingest/prices.py --market coin --only BTC,ETH
  python ingest/prices.py --local DIR           # Storage 대신 DIR 에 저장 (시험용, 종목은 C:/csv_backup 에서)
"""
import argparse
import csv
import gzip
import io
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
BUCKET = "forecasts"
YEARS_DAYS = 5 * 366 + 5          # 보관 기간
REFRESH_DAYS = 14                 # 매일 다시 받는 최근 구간
RECHECK_HOURS = 3                 # 휴장일 등으로 새 봉이 없을 때 다시 확인하는 간격
HERE = Path(__file__).resolve().parent
TICKERS = json.loads((HERE / "price_tickers.json").read_text(encoding="utf-8"))
SRC = {"coin": "upbit", "bithumb": "bithumb", "nasdaq": "yahoo", "kospi": "yahoo"}
LOCAL_CSV = {"coin": "upbit", "bithumb": "bithumb", "nasdaq": "nasdaq", "kospi": "kospi"}  # C:/csv_backup 폴더 이름

SUPA = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
LOCAL = None  # --local 경로


# ---------- 공통 HTTP ----------
class Rate:
    """출처별 초당 요청 수 제한 (업비트·빗썸 캔들 API 는 초당 10회)"""
    def __init__(self, per_sec):
        self.gap, self.next, self.lock = 1 / per_sec, 0.0, threading.Lock()

    def wait(self):
        with self.lock:
            now = time.monotonic()
            t = max(now, self.next)
            self.next = t + self.gap
        if t > now:
            time.sleep(t - now)


RATES = {"upbit": Rate(8), "bithumb": Rate(8), "yahoo": Rate(4)}


def get_json(url, src, tries=4):
    for i in range(tries):
        RATES[src].wait()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(1.5 * (i + 1))
                continue
            raise
        except (urllib.error.URLError, TimeoutError):
            if i < tries - 1:
                time.sleep(1.5 * (i + 1))
                continue
            raise


# ---------- 저장소 (Supabase Storage 또는 로컬 폴더) ----------
def _supa(method, path, body=None, headers=None):
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
    h.update(headers or {})
    for i in range(3):
        try:
            req = urllib.request.Request(f"{SUPA}{path}", data=body, method=method, headers=h)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (400, 404) and method == "GET":
                return None
            if e.code >= 500 and i < 2:
                time.sleep(2)
                continue
            raise


def store_get(path):
    if LOCAL:
        p = LOCAL / path
        return p.read_bytes() if p.exists() else None
    return _supa("GET", f"/storage/v1/object/{BUCKET}/{path}")


def store_put(path, data, ctype):
    if LOCAL:
        p = LOCAL / path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return
    _supa("POST", f"/storage/v1/object/{BUCKET}/{path}", data,
          {"Content-Type": ctype, "x-upsert": "true", "cache-control": "max-age=300"})


def load_series(path):
    raw = store_get(path)
    if not raw:
        return None
    try:
        return json.loads(gzip.decompress(raw))
    except OSError:
        return json.loads(raw)


def save_series(path, s):
    body = json.dumps(s, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    store_put(path, gzip.compress(body, 9, mtime=0), "application/gzip")


# ---------- 종목 목록 ----------
def decode(raw):
    for enc in ("utf-8-sig", "cp949"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass
    return raw.decode("utf-8", "replace")


def symbols(market):
    if LOCAL:
        import glob
        files = sorted(glob.glob(f"C:/csv_backup/{LOCAL_CSV[market]}/*_chart.csv"))
        raw = Path(files[-1]).read_bytes()
    else:
        raw = store_get(f"{market}/chart/latest.csv.gz")
        raw = gzip.decompress(raw) if raw else store_get(f"{market}/chart/latest.csv")
    if not raw:
        raise RuntimeError(f"{market}: 가격 차트 CSV 없음")
    syms = []
    for row in csv.DictReader(io.StringIO(decode(raw))):
        s = (row.get("coin") or "").strip()
        if s and s not in syms:
            syms.append(s)
    return syms


def file_name(market, sym):
    """Storage 키는 영문·숫자 위주만 안전 → 코인은 기호 그대로, 주식은 야후 티커(^·= 등은 _ 로)"""
    base = sym if SRC[market] != "yahoo" else TICKERS[market][sym]
    return re.sub(r"[^A-Za-z0-9._-]", "_", base) + ".json.gz"


# ---------- '끝난 날' 기준 ----------
def cutoff(market, now=None):
    """이 날짜까지의 봉은 확정 (그 뒤 진행 중인 봉은 버림)"""
    now = now or datetime.now(KST)
    if market == "coin":      # 업비트 일봉: 09:00 KST 시작
        return (now - timedelta(hours=9)).date() - timedelta(days=1)
    if market == "bithumb":   # 빗썸 일봉: 00:00 KST 시작
        return now.date() - timedelta(days=1)
    if market == "kospi":     # 15:30 마감 → 16시부터 그날 확정
        return now.date() if now.hour >= 16 else now.date() - timedelta(days=1)
    try:                      # 나스닥: 뉴욕 16:00 마감 → 16:30 부터 확정
        from zoneinfo import ZoneInfo
        ny = now.astimezone(ZoneInfo("America/New_York"))
    except Exception:         # tzdata 가 없는 PC: 미국 동부 표준시(-5)로 근사
        ny = now.astimezone(timezone(timedelta(hours=-5)))
    return ny.date() if (ny.hour, ny.minute) >= (16, 30) else ny.date() - timedelta(days=1)


# ---------- 출처별 받기 → [(날짜, o, h, l, c, v)] ----------
def fetch_exchange(src, sym, since):
    base = "https://api.upbit.com" if src == "upbit" else "https://api.bithumb.com"
    rows, to = {}, None
    while True:
        q = {"market": f"KRW-{sym}", "count": 200}
        if to:
            q["to"] = to
        data = get_json(f"{base}/v1/candles/days?{urllib.parse.urlencode(q)}", src)
        if not data or not isinstance(data, list):
            break
        for c in data:
            d = c["candle_date_time_kst"][:10]
            rows[d] = (d, c["opening_price"], c["high_price"], c["low_price"], c["trade_price"],
                       c.get("candle_acc_trade_volume") or 0)
        first = data[-1]
        if len(data) < 200 or first["candle_date_time_kst"][:10] <= since.isoformat():
            break
        # 업비트 to 는 UTC(…Z), 빗썸 to 는 KST('YYYY-MM-DD HH:MM:SS') — 둘 다 그 시각 '이전' 봉부터
        to = first["candle_date_time_utc"] + "Z" if src == "upbit" else first["candle_date_time_kst"].replace("T", " ")
    return [rows[d] for d in sorted(rows) if d >= since.isoformat()]


def fetch_yahoo(ticker, since):
    p1 = int(datetime(since.year, since.month, since.day, tzinfo=timezone.utc).timestamp()) - 86400
    p2 = int(time.time()) + 86400
    url = (f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}"
           f"?period1={p1}&period2={p2}&interval=1d&events=history")
    data = get_json(url, "yahoo")
    res = ((data or {}).get("chart") or {}).get("result") or []
    if not res:
        return []
    r = res[0]
    off = r["meta"].get("gmtoffset", 0)
    q = r["indicators"]["quote"][0]
    rows = {}
    for i, t in enumerate(r.get("timestamp") or []):
        o, h, l, c = q["open"][i], q["high"][i], q["low"][i], q["close"][i]
        if None in (o, h, l, c):
            continue
        d = datetime.fromtimestamp(t + off, timezone.utc).date().isoformat()
        rows[d] = (d, o, h, l, c, q["volume"][i] or 0)
    return [rows[d] for d in sorted(rows) if d >= since.isoformat()]


def rnd(x):
    """소수점 아래 유효숫자만 (파일 크기 줄이기). 1 이상이면 소수 4자리, 아주 작은 코인 값은 유효숫자 6자리"""
    if x == 0:
        return 0
    if abs(x) >= 1:
        v = round(x, 4)
    else:
        v = float(f"{x:.6g}")
    return int(v) if v == int(v) else v


# ---------- 종목 하나 갱신 ----------
def update_symbol(market, sym, fname, have_last, cut, full=False):
    src = SRC[market]
    path = f"{market}/prices/{fname}"
    old = None if full else load_series(path)
    start_full = cut - timedelta(days=YEARS_DAYS)
    since = start_full if not old or not old.get("d") else \
        min(date.fromisoformat(old["d"][-1]), cut) - timedelta(days=REFRESH_DAYS)
    if src == "yahoo":
        new = fetch_yahoo(TICKERS[market][sym], since)
    else:
        new = fetch_exchange(src, sym, since)
    merged = {}
    if old and old.get("d"):
        for i, d in enumerate(old["d"]):
            merged[d] = (d, old["o"][i], old["h"][i], old["l"][i], old["c"][i], old["v"][i])
    for row in new:
        merged[row[0]] = row
    keep = [merged[d] for d in sorted(merged) if start_full.isoformat() <= d <= cut.isoformat()]
    if not keep:
        return sym, None, "데이터 없음"
    if old and old.get("d") and old["d"][-1] == keep[-1][0] and len(old["d"]) == len(keep):
        return sym, keep[-1][0], "변화 없음"
    s = {"sym": sym, "src": src if src != "yahoo" else f"yahoo:{TICKERS[market][sym]}",
         "d": [r[0] for r in keep], "o": [rnd(r[1]) for r in keep], "h": [rnd(r[2]) for r in keep],
         "l": [rnd(r[3]) for r in keep], "c": [rnd(r[4]) for r in keep], "v": [rnd(r[5]) for r in keep]}
    save_series(path, s)
    return sym, keep[-1][0], f"{len(keep)}일" + (" (새로 채움)" if not old else "")


def run_market(market, only=None, full=False, force=False):
    now = datetime.now(KST)
    cut = cutoff(market, now)
    raw = store_get(f"{market}/prices/index.json")
    idx = json.loads(raw) if raw else {"files": {}, "last": {}, "checked": None}
    if not (only or full or force) and idx.get("cutoff") == cut.isoformat() and idx.get("checked") and (
            all(v >= cut.isoformat() for v in idx["last"].values())
            or now - datetime.fromisoformat(idx["checked"]) < timedelta(hours=RECHECK_HOURS)):
        # 오늘 기준일로 이미 돌았음 → 큰 차트 CSV 를 받지 않고 바로 끝냄 (새 종목은 다음 기준일에 채움)
        print(f"  [{market}/prices] 기준일 {cut} · 이미 확인함 → 건너뜀")
        return
    syms = only or symbols(market)
    if SRC[market] == "yahoo":
        miss = [s for s in syms if s not in TICKERS[market]]
        if miss:
            print(f"  [{market}/prices] 티커 없음 → 건너뜀: {', '.join(miss)} (ingest/price_tickers.json 에 추가하세요)")
        syms = [s for s in syms if s in TICKERS[market]]
    todo = [s for s in syms if full or force or s not in idx["last"] or idx["last"][s] < cut.isoformat()]
    checked = idx.get("checked")
    recent = checked and idx.get("cutoff") == cut.isoformat() and \
        now - datetime.fromisoformat(checked) < timedelta(hours=RECHECK_HOURS)
    # 이미 받은 종목만 남았고 최근에 확인했으면(휴장일·새 봉 아직 없음) 건너뜀. 새 종목은 바로 채움
    if not full and not force and recent and all(s in idx["last"] for s in todo):
        print(f"  [{market}/prices] 기준일 {cut} · {RECHECK_HOURS}시간 안에 확인함 → 건너뜀 (남은 {len(todo)}종목)")
        return
    if not todo:
        print(f"  [{market}/prices] 기준일 {cut} · {len(syms)}종목 모두 최신")
        return
    t0 = time.time()
    done, errs = 0, []
    workers = 6 if SRC[market] != "yahoo" else 3
    with ThreadPoolExecutor(workers) as ex:
        futs = {ex.submit(update_symbol, market, s, file_name(market, s), idx["last"].get(s), cut, full): s for s in todo}
        for f in futs:
            s = futs[f]
            try:
                sym, last, note = f.result()
                idx["files"][sym] = file_name(market, sym)
                if last:
                    idx["last"][sym] = last
                done += 1
            except Exception as e:  # 한 종목 실패가 전체를 막지 않게
                errs.append(f"{s}: {str(e)[:120]}")
    idx["checked"] = now.isoformat(timespec="seconds")
    idx["cutoff"] = cut.isoformat()
    idx["updated"] = now.isoformat(timespec="seconds")
    store_put(f"{market}/prices/index.json", json.dumps(idx, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
              "application/json")
    print(f"  [{market}/prices] 기준일 {cut} · {done}/{len(todo)}종목 갱신 · {time.time() - t0:.0f}초"
          + (f" · 실패 {len(errs)}: {'; '.join(errs[:5])}" if errs else ""))


def main():
    global LOCAL
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", action="append", choices=list(SRC))
    ap.add_argument("--only", help="쉼표로 구분한 종목 (시험용)")
    ap.add_argument("--full", action="store_true", help="기존 파일 무시하고 5년치 다시 받기")
    ap.add_argument("--force", action="store_true", help="최신이어도 최근 2주 다시 받기")
    ap.add_argument("--local", help="Storage 대신 이 폴더에 저장 (시험용)")
    a = ap.parse_args()
    if a.local:
        LOCAL = Path(a.local)
    elif not (SUPA and KEY):
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY 가 없어요 (시험은 --local 폴더)")
    only = [s.strip() for s in a.only.split(",")] if a.only else None
    failed = False
    for m in a.market or list(SRC):
        try:
            run_market(m, only, a.full, a.force)
        except Exception as e:  # 한 시장 실패가 다른 시장을 막지 않게
            failed = True
            print(f"  [{m}/prices] 오류: {e}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
