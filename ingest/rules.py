"""룰 성적표: 차트 지표 룰이 과거 5년 동안 얼마나 맞았는지 시장별로 채점 → 운영자 화면(rules.html)
- 가격: 가격 원장(<시장>/prices/, ingest/prices.py). 일봉 · 20·60일선 · 볼린저(20일 ±2σ) · RSI 14일 (회원 화면 '차트 지표 해석'과 같은 기준)
- 채점: 룰이 켜진 날 종가 → 다음 거래일(D+1) · 6거래일 뒤(D+6) 종가가 룰 방향(상승/하락)으로 갔는지
  · 같은 날 같은 시장 전체 종목 평균보다 룰 방향으로 더 움직였는지(초과 등락, %p)도 같이 봄 — 시장 전체가 오른 날엔 상승 룰이 저절로 맞아 보이므로
- 모델 결합 룰: predictions 표의 D+1 판정(기준 종가 날)과 지표를 같이 봄 (예: 모델 상승 + 과매도)
- 결과: admin_reports 표(supabase/stage38.sql)에 'rules:<시장>' 으로 덮어씀. 운영자만 읽음 — 회원 화면에 적중률을 보여주지 않음
- 새 룰은 RULES 에 한 줄 추가 (rules.html 은 결과에 든 이름을 그대로 보여줌)

사용:
  python ingest/rules.py                 # GitHub Actions (SUPABASE_SERVICE_KEY)
  python ingest/rules.py --local DIR     # DIR/<시장>/prices/ 의 복사본으로 계산만 하고 DIR/rules_<시장>.json 에 저장 (시험용)
"""
import argparse
import gzip
import json
import math
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

KST = timezone(timedelta(hours=9))
BUCKET = "forecasts"
MARKETS = ["coin", "bithumb", "nasdaq", "kospi"]
SUPA = os.environ.get("SUPABASE_URL", "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
LOCAL = None
WINDOWS = {"5y": 1830, "1y": 365, "90d": 90}


# ---------- 지표 ----------
def sma(v, n):
    out, s = [None] * len(v), 0.0
    for i, x in enumerate(v):
        s += x
        if i >= n:
            s -= v[i - n]
        if i >= n - 1:
            out[i] = s / n
    return out


def stdev(v, n, m):
    out = [None] * len(v)
    for i in range(n - 1, len(v)):
        mu = m[i]
        out[i] = math.sqrt(sum((v[j] - mu) ** 2 for j in range(i - n + 1, i + 1)) / n)
    return out


def rsi(v, n=14):
    out = [None] * len(v)
    g = l = 0.0
    for i in range(1, len(v)):
        d = v[i] - v[i - 1]
        up, dn = max(d, 0), max(-d, 0)
        if i <= n:
            g += up
            l += dn
            if i == n:
                g, l = g / n, l / n
                out[i] = 100 if l == 0 else 100 - 100 / (1 + g / l)
        else:
            g = (g * (n - 1) + up) / n
            l = (l * (n - 1) + dn) / n
            out[i] = 100 if l == 0 else 100 - 100 / (1 + g / l)
    return out


class Ind:
    """한 종목의 일봉과 지표"""
    def __init__(self, s):
        self.d, self.o, self.h, self.l, self.c, self.v = s["d"], s["o"], s["h"], s["l"], s["c"], s["v"]
        C = self.c
        self.ma5, self.ma20, self.ma60 = sma(C, 5), sma(C, 20), sma(C, 60)
        sd = stdev(C, 20, self.ma20)
        self.up = [None if m is None else m + 2 * x for m, x in zip(self.ma20, sd)]
        self.lo = [None if m is None else m - 2 * x for m, x in zip(self.ma20, sd)]
        self.bw = [None if m is None or not m else 4 * x / m for m, x in zip(self.ma20, sd)]
        self.rsi = rsi(C)
        self.vavg = sma([x or 0 for x in self.v], 20)
        self.idx = {d: i for i, d in enumerate(self.d)}

    def ok(self, i):
        return i >= 60 and self.ma60[i] is not None and self.rsi[i] is not None

    # 자주 쓰는 조건
    def trend_up(self, i): return self.ma5[i] > self.ma20[i] > self.ma60[i]
    def trend_dn(self, i): return self.ma5[i] < self.ma20[i] < self.ma60[i]
    def oversold(self, i): return self.rsi[i] < 30 or self.c[i] < self.lo[i]
    def overbought(self, i): return self.rsi[i] > 70 or self.c[i] > self.up[i]

    def body(self, i): return abs(self.c[i] - self.o[i])
    def rng(self, i): return (self.h[i] - self.l[i]) or 1e-12
    def upw(self, i): return self.h[i] - max(self.o[i], self.c[i])
    def low(self, i): return min(self.o[i], self.c[i]) - self.l[i]

    def hammer(self, i):
        b = self.body(i)
        return self.low(i) >= 2 * b and self.upw(i) <= max(b, self.rng(i) * 0.1) and self.c[i] < self.ma20[i]

    def bull_engulf(self, i):
        return (self.c[i - 1] < self.o[i - 1] and self.c[i] > self.o[i] and self.c[i] >= self.o[i - 1]
                and self.o[i] <= self.c[i - 1] and self.c[i] < self.ma20[i])

    def squeeze_break(self, i):
        if self.c[i] <= self.up[i]:
            return False
        w = [x for x in self.bw[max(19, i - 120):i] if x is not None]
        return bool(w) and sum(x <= self.bw[i - 1] for x in w) / len(w) <= 0.15


# key, 이름, 방향(+1 상승 / -1 하락), 설명, 조건
RULES = [
    ("rsi_os", "RSI 침체 반등", 1, "RSI 14일 30 아래", lambda x, i: x.rsi[i] < 30),
    ("rsi_ob", "RSI 과열 조정", -1, "RSI 14일 70 위", lambda x, i: x.rsi[i] > 70),
    ("bb_low", "볼린저 하단 이탈 반등", 1, "종가가 하단 밴드 아래", lambda x, i: x.c[i] < x.lo[i]),
    ("bb_high", "볼린저 상단 돌파 조정", -1, "종가가 상단 밴드 위", lambda x, i: x.c[i] > x.up[i]),
    ("os_combo", "과매도 겹침 반등", 1, "RSI 30 아래 + 하단 밴드 아래", lambda x, i: x.rsi[i] < 30 and x.c[i] < x.lo[i]),
    ("ma20_up", "20일선 위로 돌파", 1, "어제 20일선 아래 → 오늘 위", lambda x, i: x.c[i - 1] < x.ma20[i - 1] and x.c[i] >= x.ma20[i]),
    ("ma20_dn", "20일선 아래로 이탈", -1, "어제 20일선 위 → 오늘 아래", lambda x, i: x.c[i - 1] >= x.ma20[i - 1] and x.c[i] < x.ma20[i]),
    ("golden", "골든크로스 (20↗60)", 1, "20일선이 60일선을 위로 뚫음", lambda x, i: x.ma20[i - 1] <= x.ma60[i - 1] and x.ma20[i] > x.ma60[i]),
    ("dead", "데드크로스 (20↘60)", -1, "20일선이 60일선을 아래로 뚫음", lambda x, i: x.ma20[i - 1] >= x.ma60[i - 1] and x.ma20[i] < x.ma60[i]),
    ("trend_up", "정배열 추세 따라가기", 1, "5>20>60일선 + 종가가 20일선 위", lambda x, i: x.trend_up(i) and x.c[i] > x.ma20[i]),
    ("trend_dn", "역배열 추세 따라가기", -1, "5<20<60일선 + 종가가 20일선 아래", lambda x, i: x.trend_dn(i) and x.c[i] < x.ma20[i]),
    ("dn_os", "하락 추세 속 과매도 반등", 1, "역배열 + (RSI 30 아래 또는 하단 밴드 아래)", lambda x, i: x.trend_dn(i) and x.oversold(i)),
    ("hammer", "망치형 반등", 1, "20일선 아래에서 긴 아랫꼬리", lambda x, i: x.hammer(i)),
    ("engulf", "상승 장악형 반등", 1, "20일선 아래에서 전날 음봉을 감싸는 양봉", lambda x, i: x.bull_engulf(i)),
    ("squeeze", "밴드 수축 뒤 상단 돌파", 1, "밴드 폭 6달 하위 15% → 상단 돌파", lambda x, i: x.squeeze_break(i)),
    ("vol_up", "거래량 실린 양봉", 1, "20일 평균 2배 거래량 + 양봉", lambda x, i: x.vavg[i - 1] and (x.v[i] or 0) >= 2 * x.vavg[i - 1] and x.c[i] > x.o[i]),
]
# 모델 D+1 판정과 지표를 같이 보는 룰 — 기준 종가 날의 지표
MODEL_RULES = [
    ("m_up", "모델 상승 판정 (기준)", 1, "모델 판정만", "up", lambda x, i: True),
    ("m_up_os", "모델 상승 + 과매도", 1, "RSI 30 아래 또는 하단 밴드 아래", "up", lambda x, i: x.oversold(i)),
    ("m_up_trend", "모델 상승 + 정배열", 1, "5>20>60일선", "up", lambda x, i: x.trend_up(i)),
    ("m_up_ob", "모델 상승 + 과열", 1, "RSI 70 위 또는 상단 밴드 위 (조심 신호인지 보기)", "up", lambda x, i: x.overbought(i)),
    ("m_up_dntrend", "모델 상승 + 역배열", 1, "하락 추세에서 상승 판정", "up", lambda x, i: x.trend_dn(i)),
    ("m_dn", "모델 하락 판정 (기준)", -1, "모델 판정만", "dn", lambda x, i: True),
    ("m_dn_ob", "모델 하락 + 과열", -1, "RSI 70 위 또는 상단 밴드 위", "dn", lambda x, i: x.overbought(i)),
    ("m_dn_trend", "모델 하락 + 역배열", -1, "5<20<60일선", "dn", lambda x, i: x.trend_dn(i)),
]


# ---------- 저장소 ----------
def http(method, url, body=None, headers=None):
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}"}
    h.update(headers or {})
    for t in range(3):
        try:
            req = urllib.request.Request(url, data=body, method=method, headers=h)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code >= 500 and t < 2:
                time.sleep(2)
                continue
            raise


def store_get(path):
    if LOCAL:
        p = LOCAL / path
        return p.read_bytes() if p.exists() else None
    try:
        return http("GET", f"{SUPA}/storage/v1/object/{BUCKET}/{path}")
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):
            return None
        raise


def load_market(market):
    raw = store_get(f"{market}/prices/index.json")
    if not raw:
        return {}
    files = json.loads(raw)["files"]

    def one(item):
        sym, f = item
        b = store_get(f"{market}/prices/{f}")
        if not b:
            return sym, None
        s = json.loads(gzip.decompress(b))
        return sym, Ind(s) if len(s["d"]) >= 70 else None

    with ThreadPoolExecutor(8) as ex:
        return {s: x for s, x in ex.map(one, files.items()) if x}


def load_predictions(market):
    """predictions 표: (종목, 기준 종가 날짜) → 판정. 빗썸 등 표에 없는 시장은 빈 값"""
    if LOCAL or not SUPA:
        return []
    rows, start, PAGE = [], 0, 1000  # Supabase 는 한 번에 최대 1000줄
    while True:
        q = (f"{SUPA}/rest/v1/predictions?select=symbol,base_date,verdict&market=eq.{market}"
             f"&verdict=in.(up,dn)&base_date=not.is.null&order=pred_date")
        try:
            b = http("GET", q, headers={"Range": f"{start}-{start + PAGE - 1}", "Range-Unit": "items"})
        except urllib.error.HTTPError:
            return rows
        part = json.loads(b)
        rows += part
        if len(part) < PAGE:
            return rows
        start += PAGE


# ---------- 채점 ----------
def new_acc():
    return {"n": 0, "days": set(), "h1": 0, "m1": 0, "s1": 0.0, "e1": 0.0, "n6": 0, "h6": 0, "m6": 0, "s6": 0.0, "e6": 0.0}


def add(acc, dir_, date_s, r1, r6, b1, b6):
    acc["n"] += 1
    acc["days"].add(date_s)
    if r1 is not None:
        s = dir_ * r1
        acc["s1"] += s
        acc["e1"] += s - dir_ * b1
        if r1 != 0:
            acc["m1"] += 1
            acc["h1"] += s > 0
    if r6 is not None:
        s = dir_ * r6
        acc["n6"] += 1
        acc["s6"] += s
        acc["e6"] += s - dir_ * b6
        if r6 != 0:
            acc["m6"] += 1
            acc["h6"] += s > 0


def finish(acc):
    graded1 = acc["m1"]  # 등락 0 인 날은 적중률에서 빼므로 평균도 같은 건수로 나눔 (근사)
    return {
        "n": acc["n"], "days": len(acc["days"]),
        "hit1": round(acc["h1"] / acc["m1"], 4) if acc["m1"] else None,
        "avg1": round(acc["s1"] / max(1, graded1), 5) if graded1 else None,
        "ex1": round(acc["e1"] / max(1, graded1), 5) if graded1 else None,
        "n6": acc["n6"],
        "hit6": round(acc["h6"] / acc["m6"], 4) if acc["m6"] else None,
        "avg6": round(acc["s6"] / acc["n6"], 5) if acc["n6"] else None,
        "ex6": round(acc["e6"] / acc["n6"], 5) if acc["n6"] else None,
    }


def score_market(market):
    t0 = time.time()
    data = load_market(market)
    if not data:
        print(f"  [{market}/rules] 가격 원장 없음 → 건너뜀")
        return None
    last = max(x.d[-1] for x in data.values())
    cut = {w: (date.fromisoformat(last) - timedelta(days=days)).isoformat() for w, days in WINDOWS.items()}

    # 날짜별 시장 평균 등락 (기준선)
    base = {}
    for x in data.values():
        C = x.c
        for i in range(len(C) - 1):
            d = x.d[i]
            r1 = C[i + 1] / C[i] - 1 if C[i] else 0
            r6 = C[i + 6] / C[i] - 1 if i + 6 < len(C) and C[i] else None
            b = base.setdefault(d, [0, 0.0, 0, 0.0])
            b[0] += 1
            b[1] += r1
            if r6 is not None:
                b[2] += 1
                b[3] += r6
    bmean = {d: (b[1] / b[0], b[3] / b[2] if b[2] else 0.0) for d, b in base.items()}

    accs = {k: {w: new_acc() for w in WINDOWS} for k, *_ in RULES + MODEL_RULES}
    allacc = {w: new_acc() for w in WINDOWS}
    today = {k: [] for k, *_ in RULES}

    def outcome(x, i):
        C = x.c
        r1 = C[i + 1] / C[i] - 1 if i + 1 < len(C) and C[i] else None
        r6 = C[i + 6] / C[i] - 1 if i + 6 < len(C) and C[i] else None
        return r1, r6

    for sym, x in data.items():
        for i in range(60, len(x.c)):
            if not x.ok(i):
                continue
            d = x.d[i]
            r1, r6 = outcome(x, i)
            b1, b6 = bmean.get(d, (0.0, 0.0))
            ws = [w for w in WINDOWS if d >= cut[w]]
            if r1 is not None:
                for w in ws:
                    add(allacc[w], 1, d, r1, r6, b1, b6)
            for key, _, dir_, _, f in RULES:
                try:
                    hit = f(x, i)
                except (TypeError, ZeroDivisionError):
                    hit = False
                if not hit:
                    continue
                if d == last:
                    today[key].append(sym)
                if r1 is None:
                    continue
                for w in ws:
                    add(accs[key][w], dir_, d, r1, r6, b1, b6)

    preds = load_predictions(market)
    model_today = {k: [] for k, *_ in MODEL_RULES}
    for p in preds:
        x = data.get(p["symbol"])
        if not x:
            continue
        i = x.idx.get(p["base_date"])
        if i is None or not x.ok(i):
            continue
        d = x.d[i]
        r1, r6 = outcome(x, i)
        b1, b6 = bmean.get(d, (0.0, 0.0))
        ws = [w for w in WINDOWS if d >= cut[w]]
        for key, _, dir_, _, v, f in MODEL_RULES:
            if p["verdict"] != v or not f(x, i):
                continue
            if r1 is None:
                if d == last:
                    model_today[key].append(p["symbol"])
                continue
            for w in ws:
                add(accs[key][w], dir_, d, r1, r6, b1, b6)

    out = {
        "market": market, "as_of": last, "generated": datetime.now(KST).isoformat(timespec="minutes"),
        "symbols": len(data), "pred_rows": len(preds),
        "base": {w: finish(a) for w, a in allacc.items()},
        "rules": [{"key": k, "name": n, "dir": dr, "desc": ds, "group": "chart",
                   "w": {w: finish(a) for w, a in accs[k].items()}, "today": sorted(today[k])[:40], "today_n": len(today[k])}
                  for k, n, dr, ds, _ in RULES]
                 + [{"key": k, "name": n, "dir": dr, "desc": ds, "group": "model",
                     "w": {w: finish(a) for w, a in accs[k].items()}, "today": sorted(model_today[k])[:40], "today_n": len(model_today[k])}
                    for k, n, dr, ds, _, _ in MODEL_RULES],
    }
    print(f"  [{market}/rules] {len(data)}종목 · 기준일 {last} · 예측 {len(preds)}건 · {time.time() - t0:.0f}초")
    return out


def save(market, out):
    if LOCAL:
        (LOCAL / f"rules_{market}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
        return
    body = json.dumps({"key": f"rules:{market}", "data": out, "updated_at": datetime.now(timezone.utc).isoformat()}, ensure_ascii=False).encode()
    try:
        http("POST", f"{SUPA}/rest/v1/admin_reports", body,
             {"Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"})
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print("  admin_reports 표가 없어요 → supabase/stage38.sql 을 실행해 주세요")
            return
        raise


def main():
    global LOCAL
    ap = argparse.ArgumentParser()
    ap.add_argument("--market", action="append", choices=MARKETS)
    ap.add_argument("--local")
    a = ap.parse_args()
    if a.local:
        LOCAL = Path(a.local)
    elif not (SUPA and KEY):
        sys.exit("SUPABASE_URL / SUPABASE_SERVICE_KEY 가 없어요 (시험은 --local 폴더)")
    failed = False
    for m in a.market or MARKETS:
        try:
            out = score_market(m)
            if out:
                save(m, out)
        except Exception as e:
            failed = True
            print(f"  [{m}/rules] 오류: {e}")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
