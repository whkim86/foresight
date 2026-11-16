"""무료 공개 종목 페이지를 다시 만들고 바뀐 게 있으면 GitHub(main)에 올린다: python tools/publish_picks.py
- 쇼츠 데이터가 만들어질 때 auto/run_market.py 가 백그라운드로 실행 (2026-11-17 사용자 승인: 매일 자동 반영)
- s/, sitemap.xml, robots.txt 만 커밋함 (다른 수정 중인 파일은 건드리지 않음)
- 동시에 두 번 돌지 않게 잠금 파일 사용, 결과는 auto/status/publish_picks.log 에 한 줄씩
"""
import datetime as dt
import subprocess
import sys
import time
from pathlib import Path

SITE_DIR = Path(__file__).resolve().parents[1]
LOG = SITE_DIR.parent / "auto" / "status" / "publish_picks.log"
LOCK = SITE_DIR.parent / "auto" / "status" / "publish_picks.lock"
PATHS = ["s", "sitemap.xml", "robots.txt"]
GIT_ID = ["-c", "user.name=whkim86", "-c", "user.email=woohyungk@gmail.com"]


def log(msg):
    LOG.parent.mkdir(exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(f"{dt.datetime.now():%Y-%m-%d %H:%M} {msg}\n")
    print(msg)


def git(*args, check=True):
    p = subprocess.run(["git", *GIT_ID, *args], cwd=SITE_DIR, capture_output=True, text=True, encoding="utf-8")
    if check and p.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)}: {(p.stderr or p.stdout)[-400:]}")
    return p


def main():
    if LOCK.exists() and time.time() - LOCK.stat().st_mtime < 600:
        return log("건너뜀: 다른 실행이 진행 중")
    LOCK.write_text(str(time.time()), encoding="utf-8")
    try:
        b = subprocess.run([sys.executable, str(SITE_DIR / "tools" / "build_picks.py")], cwd=SITE_DIR,
                           capture_output=True, text=True, encoding="utf-8")
        if b.returncode != 0:
            return log("페이지 생성 실패: " + (b.stderr or b.stdout)[-400:])
        git("add", "--", *PATHS)
        if not git("diff", "--cached", "--quiet", check=False).returncode:
            return log("변경 없음")
        git("commit", "-q", "-m", "무료 공개 종목 페이지 자동 갱신", "--", *PATHS)
        for attempt in range(3):
            if git("push", "-q", "origin", "HEAD:main", check=False).returncode == 0:
                return log("올림 완료 " + b.stdout.strip()[-300:])
            git("pull", "-q", "--rebase", "--autostash", "origin", "main", check=False)
            time.sleep(10)
        log("올리기 실패 (3회)")
    except Exception as e:
        log(f"오류: {e}")
    finally:
        LOCK.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
