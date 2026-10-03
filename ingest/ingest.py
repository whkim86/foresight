#!/usr/bin/env python3
"""R 이 매일 GitHub 에 올리는 예측 CSV 를 Supabase 로 옮긴다 (GitHub Actions 에서 실행).

1. 저장소 6개의 CSV 를 받아 내용이 바뀌었으면 Supabase Storage(forecasts 버킷)에 날짜별로 보관, 14일 지난 건 삭제
2. 가격 차트 CSV 로 종목별 D+1 판정(대시보드와 같은 공식)과 6일 합의도를 계산해 predictions 에 저장
3. 새 CSV 의 실제 종가(SEQ=0)로 지난 예측을 채점
4. 업로드 예정 시각 + 50분이 지나도 새 CSV 가 없으면 ingest_log 에 '미수신' 기록 (GitHub 이 실패 메일을 보냄)
   단, 주말·휴장일(KRX_HOLIDAYS, US_HOLIDAYS)은 원래 새 결과가 없으니 제외
5. 시장 게시판에 운영자 이름('AI 신호등')으로 '오늘의 신호 요약' 글을 예측일마다 하나씩 씀
   (게시판은 이용권 없는 회원도 보므로 종목 순위 같은 유료 내용은 넣지 않음)

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
KEEP_DAYS = 14         # Storage 에 남길 날짜 수 — 나스닥·코스피는 주말·휴장일 때문에 D+6 이 달력으로 8~10일 뒤라, 모델 채점에 14일 필요
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
    # latest.csv 는 매일 덮어쓰므로 브라우저가 오래 캐시하지 않게 1분으로
    h = {"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "text/csv; charset=utf-8",
         "x-upsert": "true", "cache-control": "max-age=60"}
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


# ---------------------------------------------------------------- 게시판 '오늘의 신호 요약'
# 게시판은 이용권 없는 회원도 보므로, 유료 내용(종목 순위)은 넣지 않고 분포와 기준 종목 판정만
LEAD = {"coin": "BTC", "nasdaq": "SP500", "kospi": "SK하이닉스"}
MARKET_NAME = {"coin": "코인", "nasdaq": "나스닥", "kospi": "코스피200"}
NOUN = {"coin": "코인", "nasdaq": "종목", "kospi": "종목"}
VERDICT_KO = {"up": "상승", "dn": "하락", "mx": "혼돈", "hold": "보류", "stale": "지연"}
_admin_id = None


def admin_id():
    global _admin_id
    if _admin_id is None:
        rows = supa("GET", "/rest/v1/profiles?select=id&role=eq.admin&order=joined_at&limit=1")
        if not rows:
            raise RuntimeError("운영자 계정이 없어 요약 글을 쓸 수 없어요")
        _admin_id = rows[0]["id"]
    return _admin_id


def verdict_counts(rows):
    c = {v: 0 for v in VERDICT_KO}
    for r in rows:
        c[r["verdict"]] = c.get(r["verdict"], 0) + 1
    return c


def summary_post(market, pred_date, preds, prev=None):
    """그날 판정으로 게시판 요약 글(title, body)을 만든다. prev: 전 예측일 판정 개수"""
    c = verdict_counts(preds)
    judged = c["up"] + c["mx"] + c["dn"]
    share = lambda n: round(n / judged * 100) if judged else 0
    if judged and c["up"] / judged >= 0.5:
        mood, mood_line = "상승 우세", "상승 쪽으로 기운 날이에요."
    elif judged and c["dn"] / judged >= 0.5:
        mood, mood_line = "하락 우세", "하락 쪽으로 기운 날이에요."
    elif c["mx"] >= max(c["up"], c["dn"]):
        mood, mood_line = "혼돈 우세", "방향을 단정하기 어려운 종목이 가장 많은 날이에요."
    else:
        mood, mood_line = "방향 엇갈림", "상승과 하락 의견이 엇갈린 날이에요."

    name, noun = MARKET_NAME[market], NOUN[market]
    wd = "월화수목금토일"[pred_date.weekday()]
    lines = [
        f"{pred_date:%m-%d}({wd}) {name} 예측이 업데이트됐어요.",
        "",
        f"■ 전체 신호 ({len(preds)}개 {noun})",
        f"· 상승 {c['up']}개 ({share(c['up'])}%)",
        f"· 혼돈 {c['mx']}개 ({share(c['mx'])}%)",
        f"· 하락 {c['dn']}개 ({share(c['dn'])}%)",
    ]
    if c["hold"] + c["stale"]:
        lines.append(f"· 판정 보류·지연 {c['hold'] + c['stale']}개")
    lines.append(f"→ {mood_line}")

    lead = next((p for p in preds if p["symbol"] == LEAD[market]), None)
    if lead:
        lines += ["", f"■ 기준 종목 {LEAD[market]}"]
        d1 = lead.get("d1_date") or ""
        lines.append(f"· D+1({d1[5:]}) 판정: {VERDICT_KO[lead['verdict']]}")
        if lead.get("up_n") is not None:
            lines.append(f"· {lead['n_models']}개 모델 중 {lead['up_n']}개는 오른다고, {lead['dn_n']}개는 내린다고 봤어요")
        if lead.get("med1") is not None:
            lines.append(f"· 모델 중앙값: 직전 종가 대비 {lead['med1'] * 100:+.1f}%")
        if lead.get("cons_up") is not None:
            lines.append(f"· 6일 합의도: 상승 {lead['cons_up'] * 100:.0f}% · 하락 {lead['cons_dn'] * 100:.0f}%")

    if prev:
        lines += ["", "■ 전 예측일과 비교",
                  f"· 상승 {prev['up']} → {c['up']} · 혼돈 {prev['mx']} → {c['mx']} · 하락 {prev['dn']} → {c['dn']}"]

    lines += ["", "종목별 우선순위와 6일 차트, 해석은 대시보드에서 확인하세요.",
              "※ 예측 모델의 출력을 정리한 참고 자료이며, 투자 권유나 종목 추천이 아닙니다."]
    title = f"[{pred_date:%m.%d}] {name} 오늘의 신호 요약 — {mood}"
    return title, "\n".join(lines)


def post_summary(market, pred_date, preds):
    prev_rows = supa("GET", f"/rest/v1/predictions?select=pred_date&market=eq.{market}"
                            f"&pred_date=lt.{pred_date.isoformat()}&order=pred_date.desc&limit=1")
    prev = None
    if prev_rows:
        rows = supa("GET", f"/rest/v1/predictions?select=verdict&market=eq.{market}&pred_date=eq.{prev_rows[0]['pred_date']}")
        prev = verdict_counts(rows)
    title, body = summary_post(market, pred_date, preds, prev)
    # 같은 예측일 요약은 한 글 — 수정본 CSV 가 다시 올라오면 내용만 갱신
    supa("POST", "/rest/v1/posts?on_conflict=auto_key",
         {"board": market, "user_id": admin_id(), "author": "AI 신호등", "title": title, "body": body,
          "auto_key": f"daily-{market}-{pred_date.isoformat()}"},
         Prefer="resolution=merge-duplicates,return=minimal")
    print(f"  [{market}] 게시판 요약 글: {title}")


# ---------------------------------------------------------------- 모델별 성적
def parse_chart(text, today):
    """가격 차트 CSV → (pred_date, {종목: {"hist": {date: 종가}, "mod": {모델: {seq: (date, 종가)}}}})"""
    by_pred = {}
    for r in csv.DictReader(io.StringIO(text)):
        try:
            pd_, sym, var = r["pred_day"].strip(), r["coin"].strip(), r["variable"].strip()
            seq, c = int(r["SEQ"]), float(r["value_close"])
        except (KeyError, ValueError, AttributeError, TypeError):
            continue
        if not pd_ or not sym or not math.isfinite(c) or c <= 0:
            continue
        co = by_pred.setdefault(pd_, {}).setdefault(sym, {"hist": {}, "mod": {}})
        d = to_date(r["date"], today)
        if seq == 0:
            co["hist"][d] = c
        elif var:
            co["mod"].setdefault(var, {})[seq] = (d, c)
    if not by_pred:
        return None, {}
    label = max(by_pred, key=lambda p: to_date(p, today))
    return to_date(label, today), by_pred[label]


SCORE_FIELDS = ("n", "dir_n", "dir_hit", "abs_err_sum", "up_n", "up_hit", "dn_n", "dn_hit", "mx_n")


def grade_snapshot(data, actual):
    """한 예측일 CSV 의 모델별 예측을 실제 종가와 비교 → {(모델, D+n, 대상일): SCORE_FIELDS 순서의 합계 리스트}
    모델 예측은 대시보드 신호등과 같은 기준값(종목별 평소 일간 변동폭의 25%, 최소 0.2%)으로
    상승·하락·혼돈(약한 예측)으로 나눔"""
    agg = {}
    for sym, co in data.items():
        if not co["hist"]:
            continue
        days = sorted(co["hist"])
        closes = [co["hist"][d] for d in days]
        base = closes[-1]  # 이 예측의 기준(직전) 종가
        moves = [abs(closes[i] / closes[i - 1] - 1) for i in range(1, len(closes)) if closes[i - 1] > 0]
        thr = max(0.002, 0.25 * (statistics.median(moves) if len(moves) >= 4 else 0.02))
        for model, seqs in co["mod"].items():
            for seq, (d, pred) in seqs.items():
                real = actual.get((sym, d))
                if real is None or not 1 <= seq <= 6:
                    continue
                a = agg.setdefault((model, seq, d), [0, 0, 0, 0.0, 0, 0, 0, 0, 0])
                a[0] += 1
                a[3] += abs(pred - real) / real
                if pred != base and real != base:  # 기준가와 같으면 방향을 말할 수 없어 제외
                    a[1] += 1
                    a[2] += (pred > base) == (real > base)
                r = pred / base - 1
                if -thr <= r <= thr:
                    a[8] += 1
                elif real != base:  # 실제 가격이 그대로면 방향을 말할 수 없어 상승·하락 채점에서 제외
                    if r > thr:
                        a[4] += 1
                        a[5] += real > base
                    else:
                        a[6] += 1
                        a[7] += real < base
    return agg


def score_rows(market, pred_date, agg):
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for (model, seq, d), vals in agg.items():
        row = {"market": market, "model": model, "horizon": seq, "pred_date": pred_date.isoformat(),
               "target_date": d.isoformat(), "updated_at": now}
        row.update(zip(SCORE_FIELDS, vals))
        row["abs_err_sum"] = round(row["abs_err_sum"], 6)
        rows.append(row)
    return rows


def score_models(market, text, today):
    """최신 CSV 의 실제 종가로, 14일 백업 CSV 들의 모델별 D+1~D+6 예측을 채점해 model_scores 에 요약 저장.
    같은 입력이면 같은 결과라 여러 번 돌려도 안전 (덮어씀)"""
    _, latest = parse_chart(text, today)
    actual = {(sym, d): c for sym, co in latest.items() for d, c in co["hist"].items()}

    items = supa("POST", f"/storage/v1/object/list/{BUCKET}", {"prefix": f"{market}/chart/", "limit": 1000}) or []
    snaps = sorted(it["name"] for it in items if re.fullmatch(r"\d{4}-\d{2}-\d{2}\.csv", it["name"]))
    rows = []
    for name in snaps:
        snap = decode(http("GET", f"{SUPA}/storage/v1/object/{BUCKET}/{market}/chart/{name}",
                           headers={"apikey": KEY, "Authorization": f"Bearer {KEY}"}))
        pred_date, data = parse_chart(snap, today)
        if not pred_date:
            continue
        rows += score_rows(market, pred_date, grade_snapshot(data, actual))
    for i in range(0, len(rows), 500):
        supa("POST", "/rest/v1/model_scores?on_conflict=market,model,horizon,pred_date,target_date", rows[i:i + 500],
             Prefer="resolution=merge-duplicates,return=minimal")
    print(f"  [{market}] 모델 성적 {len(rows)}줄 갱신 (백업 {len(snaps)}개)")


def gh_get(path, raw=False):
    h = {"User-Agent": "foresight-ingest", "Accept": "application/vnd.github.raw" if raw else "application/vnd.github+json"}
    if GH_TOKEN:
        h["Authorization"] = f"Bearer {GH_TOKEN}"
    body = http("GET", f"https://api.github.com{path}", headers=h)
    return body if raw else json.loads(body)


def backfill_model_scores(market, cfg, days, today):
    """GitHub 원본 저장소의 커밋 기록에서 최근 days 일 동안의 가격 차트 CSV 를 꺼내 모델 성적을 소급 채점.
    예측일마다 마지막으로 올라온 파일을 쓰고, 백업 보관 기간 안의 파일은 Storage 백업에도 채워 넣음"""
    repo, fname = cfg["repos"]["chart"], FILES["chart"]
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    commits, page = [], 1
    while True:
        batch = gh_get(f"/repos/{OWNER}/{repo}/commits?path={fname}&since={since}&per_page=100&page={page}")
        commits += batch
        if len(batch) < 100:
            break
        page += 1
    if not commits:
        print(f"  [{market}] 소급할 커밋 없음")
        return

    _, latest = parse_chart(decode(gh_get(f"/repos/{OWNER}/{repo}/contents/{fname}", raw=True)), today)
    actual = {(sym, d): c for sym, co in latest.items() for d, c in co["hist"].items()}
    have = {it["name"] for it in (supa("POST", f"/storage/v1/object/list/{BUCKET}", {"prefix": f"{market}/chart/", "limit": 1000}) or [])}
    keep_from = today - timedelta(days=KEEP_DAYS - 1)

    seen, rows, restored = set(), [], 0
    for c in commits:  # 최신 커밋부터 → 같은 예측일은 가장 나중에 올라온 파일만 사용
        text = decode(gh_get(f"/repos/{OWNER}/{repo}/contents/{fname}?ref={c['sha']}", raw=True))
        pred_date, data = parse_chart(text, today)
        if not pred_date or pred_date in seen:
            continue
        seen.add(pred_date)
        if pred_date >= keep_from and f"{pred_date.isoformat()}.csv" not in have:
            upload(f"{market}/chart/{pred_date.isoformat()}.csv", text)
            restored += 1
        rows += score_rows(market, pred_date, grade_snapshot(data, actual))
    for i in range(0, len(rows), 500):
        supa("POST", "/rest/v1/model_scores?on_conflict=market,model,horizon,pred_date,target_date", rows[i:i + 500],
             Prefer="resolution=merge-duplicates,return=minimal")
    print(f"  [{market}] 소급 채점: 예측일 {len(seen)}개({min(seen)}~{max(seen)}), 성적 {len(rows)}줄, 백업 복원 {restored}개")


def ensure_model_scores(market, text, digest, today):
    """이 가격 차트 내용으로 아직 모델 채점을 안 했으면 함 (새 CSV · 기능 도입 첫날 소급)"""
    try:
        if supa("GET", f"/rest/v1/ingest_log?select=id&market=eq.{market}&kind=eq.model_score&content_hash=eq.{digest}&limit=1"):
            return
        score_models(market, text, today)
        log(market, "model_score", "ok", content_hash=digest)
    except Exception as e:  # 성적 계산이 실패해도 수집은 계속
        print(f"  [{market}] 모델 성적 실패: {e}")


def ensure_summary(market, text, today):
    """이미 수집한 CSV 라도 그날 요약 글이 없으면 씀 (요약 기능 도입 첫날, 이전 실패 복구)"""
    try:
        first = next(csv.DictReader(io.StringIO(text)), None)
        pred_date = to_date(first["pred_day"], today) if first else None
        if not pred_date or supa("GET", f"/rest/v1/posts?select=id&auto_key=eq.daily-{market}-{pred_date.isoformat()}"):
            return
        pred_date, preds, _ = analyze(text, today)
        for p in preds:
            p["market"] = market
        post_summary(market, pred_date, preds)
    except Exception as e:
        print(f"  [{market}] 요약 글 확인 실패: {e}")


def ingest_market(market, cfg, today):
    for kind, repo in cfg["repos"].items():
        text = decode(fetch_source(repo, FILES[kind]))
        digest = hashlib.sha256(text.encode()).hexdigest()
        if not DRY and already_ingested(market, kind, digest):
            print(f"  [{market}/{kind}] 변경 없음")
            if kind == "chart":
                ensure_summary(market, text, today)
                ensure_model_scores(market, text, digest, today)
            continue

        if kind == "chart":
            pred_date, preds, actuals = analyze(text, today)
            for p in preds:
                p["market"] = market
            counts = {v: sum(p["verdict"] == v for p in preds) for v in ("up", "dn", "mx", "hold", "stale")}
            print(f"  [{market}/chart] {pred_date} 종목 {len(preds)}개 판정 {counts}")
            if DRY:
                title, body = summary_post(market, pred_date, preds)
                print(f"\n----- 요약 글 미리보기 -----\n{title}\n\n{body}\n---------------------------\n")
                continue
            # 같은 CSV 가 수정돼 다시 올라와도 채점 전 판정은 최신으로 덮어씀
            for i in range(0, len(preds), 500):
                supa("POST", "/rest/v1/predictions?on_conflict=market,symbol,pred_date", preds[i:i + 500],
                     Prefer="resolution=merge-duplicates,return=minimal")
            graded = supa("POST", "/rest/v1/rpc/grade_predictions", {"p_market": market, "p_actuals": actuals})
            print(f"  [{market}/chart] 지난 예측 {graded}건 채점")
            try:
                post_summary(market, pred_date, preds)
            except Exception as e:  # 요약 글이 실패해도 수집은 계속
                print(f"  [{market}] 요약 글 실패: {e}")
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
        if kind == "chart":  # 백업에 오늘 파일까지 올린 뒤 채점
            ensure_model_scores(market, text, digest, today)


def check_missing(market, cfg, now):
    """R 시작 시각 + 50분이 지났는데 그 이후 새 CSV(우선순위·가격 차트 중 하나라도)가 없으면 한 번만 '미수신' 기록"""
    for back in (0, 1):  # 코스피(23시)는 자정을 넘길 수 있어 어제 시작분도 확인
        d = (now - timedelta(days=back)).date()
        start = datetime(d.year, d.month, d.day, *cfg["start"], tzinfo=KST)
        if not (start + timedelta(minutes=LATE_MINUTES) <= now <= start + timedelta(hours=3)):
            continue
        if not trading_expected(market, d):
            return False
        since = start.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        base = f"/rest/v1/ingest_log?select=id&market=eq.{market}&created_at=gte.{since}&limit=1"
        if supa("GET", base + "&status=eq.ok") or supa("GET", base + "&status=eq.missing"):
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

    # Actions 탭에서 '소급 채점 일수'를 넣고 수동 실행했을 때만
    backfill_days = int(os.environ.get("BACKFILL_DAYS") or 0)
    if backfill_days > 0 and not DRY:
        print(f"== 모델 성적 소급 채점 (최근 {backfill_days}일)")
        for market, cfg in MARKETS.items():
            try:
                backfill_model_scores(market, cfg, backfill_days, today)
            except Exception as e:
                problems.append(f"{market} 소급 채점 실패: {e}")
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
