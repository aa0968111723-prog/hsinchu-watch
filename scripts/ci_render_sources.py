#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""CI：實際渲染 dist（headless Chrome）後檢查每張條目卡都有來源名稱＋http(s) 連結。

範圍：首頁「最新」卡片、三位人物頁時間軸與「本人發言（官網）」、民調頁列表。
任何 [data-item-card] 缺 a.source（文字非空、href 為 http/https）→ exit 1。"""
from __future__ import annotations

import functools
import http.server
import shutil
import subprocess
import sys
import threading
from pathlib import Path

from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DIST = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist"
PAGES = ["/index.html", "/person.html?id=wu", "/person.html?id=xu", "/person.html?id=zheng", "/polls.html"]
PROFILE = "/tmp/chrome-hsinchu-shared"  # 固定一個 profile，不每次新建（磁碟）
MIN_CARDS = {"/index.html": 3, "/polls.html": 1}


def chrome():
    for c in ("google-chrome", "chromium", "chromium-browser"):
        if shutil.which(c):
            return c
    return None


def dump_dom(exe, url):
    """共用 profile 一次只給一個 Chrome（其他代理也用同一目錄）；逾時重試一次。"""
    import fcntl
    import time
    with open(PROFILE + ".lock", "w") as lk:
        t0 = time.monotonic()
        while True:
            try:
                fcntl.flock(lk, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() - t0 > 180:
                    raise SystemExit("ci_render_sources: shared chrome profile busy >180s; FAIL")
                time.sleep(1)
        for attempt in (1, 2):
            try:
                return subprocess.run([exe, "--headless=new", "--no-sandbox", "--disable-gpu", f"--user-data-dir={PROFILE}",
                                       "--virtual-time-budget=8000", "--dump-dom", url],
                                      capture_output=True, text=True, timeout=60).stdout
            except subprocess.TimeoutExpired:
                if attempt == 2:
                    raise SystemExit(f"ci_render_sources: chrome timed out on {url}; FAIL")


def main() -> int:
    exe = chrome()
    if not exe:
        print("ci_render_sources: no chrome found; FAIL (cannot verify)")
        return 1
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a, **k):
            pass
    handler = functools.partial(Quiet, directory=str(DIST))
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = srv.server_address[1]
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    bad, total = [], 0
    try:
        for page in PAGES:
            url = f"http://127.0.0.1:{port}{page}"
            html = dump_dom(exe, url)
            soup = BeautifulSoup(html, "html.parser")
            cards = soup.select("[data-item-card]")
            total += len(cards)
            if len(cards) < MIN_CARDS.get(page.split("?")[0], 1):
                bad.append(f"{page}: only {len(cards)} item cards rendered")
            for c in cards:
                a = c.select_one("a.source")
                if not a or a.get_text(strip=True) in ("", "來源不明") or not str(a.get("href", "")).lower().startswith(("http://", "https://")):
                    bad.append(f"{page}: card without source name+link: {c.get_text(' ', strip=True)[:60]}")
            print(f"{page}: {len(cards)} cards")
    finally:
        srv.shutdown()
    for b in bad[:20]:
        print("FAIL", b)
    print(f"ci_render_sources: {len(bad)} problem(s) across {total} cards")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
