# -*- coding: utf-8 -*-
"""hourly 測試共用夾具：假環境（Env）、可重現的批次／artifact／live manifest。不連網、不部署。"""
from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

from hourly import batch as hb
from hourly import publish_guard as pg
from hourly.store import Store
from hourly.util import now_iso

MAIN_SHA = "a" * 40
NEW_MAIN_SHA = "b" * 40


def item(i, person="wu", url=None, title=None):
    return {"id": f"item{i:04d}", "person_id": person, "person": "吳旭智", "platform": "news", "source_name": "測試報",
            "url": url or f"https://news.example.test/a/{i}", "title": title or f"標題{i}", "summary": "", "topics": [],
            "sentiment": "neu", "is_own_speech": False, "engagement": None,
            "collected_at": "2026-11-13T08:00:00+08:00", "published_at": "2026-11-13T07:00:00+08:00"}


def write_data(d: Path, items, excluded=None, decisions=None):
    d.mkdir(parents=True, exist_ok=True)
    (d / "items.json").write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    (d / "excluded.json").write_text(json.dumps({"excluded": excluded or [], "pending_review": []}), encoding="utf-8")
    (d / "review_decisions.json").write_text(json.dumps({"decisions": decisions or {}}), encoding="utf-8")
    (d / "stats.json").write_text(json.dumps({"source_stats": {"cna": {"ok": 3}, "ptt": {"ok": 0, "disabled": "robots.txt"}}}), encoding="utf-8")


def live_manifest(release="rel-1", data_sha="d" * 64, finalized_at=None):
    return json.dumps({"release": {"id": release, "data_sha256": data_sha}, "content_sha": data_sha,
                       "finalized_at": finalized_at or (datetime.now(timezone(timedelta(hours=8))) - timedelta(minutes=10)).isoformat(timespec="seconds")},
                      sort_keys=True).encode()


class FakeEnv:
    def __init__(self, main=MAIN_SHA, manifest=None):
        self.main = main
        self.manifest = manifest if manifest is not None else live_manifest()
        self.files = {}
        self.fail_main = False
        self.fail_live = False
        self.calls = []

    def latest_main_sha(self):
        if self.fail_main:
            raise RuntimeError("network")
        return self.main

    def live_manifest_raw(self):
        if self.fail_live:
            raise RuntimeError("network")
        return self.manifest

    def fetch(self, path):
        self.calls.append(path)
        if path == "/data/manifest.json":
            return self.manifest
        return self.files.get(path, b"")

    def now(self):
        return datetime.now(timezone.utc)


def make_world(tmp: Path, n=5, ctx_over=None):
    """回傳 dict(store, latest_store, env, cand, ledger, lock_path, data_dir, art_dir)."""
    data = tmp / "data"
    write_data(data, [item(i) for i in range(n)])
    store = Store(tmp / "cand_store")
    env = FakeEnv()
    base = json.loads(env.manifest)
    ctx = {"source_commit": "c" * 40, "base_main_commit": MAIN_SHA, "base_live_release": "rel-1",
           "live_manifest_hash": hashlib.sha256(env.manifest).hexdigest(), "live_data_sha256": "d" * 64,
           "base_live_finalized_at": base["finalized_at"]}
    ctx.update(ctx_over or {})
    r = hb.ingest(data, store, ctx)
    assert r["status"] == "created", r
    b = store.get_batch(r["batch_id"])
    art = tmp / "dist_new"
    (art / "data").mkdir(parents=True)
    (art / "index.html").write_text("<html>new</html>")
    (art / "data/items.json").write_text(json.dumps([item(i) for i in range(n)]))
    (art / "data/stats.json").write_text("{}")
    new_rel = {"id": "rel-2", "data_sha256": "e" * 64}
    (art / "data/manifest.json").write_text(json.dumps({"release": new_rel, "content_sha": "e" * 64, "finalized_at": now_iso()}))
    am = pg.artifact_manifest(art, batch_id=b["batch_id"])
    # 最新共享帳＝候選帳的獨立副本（模擬第四線 fetch 最新 main 後的 ledger）
    latest = tmp / "latest_store"
    shutil.copytree(store.root, latest)
    return {"store": store, "latest": Store(latest), "env": env, "batch": b, "art": art, "am": am,
            "cand": pg.Candidate(batch=b, artifact_dir=art, artifact=am, store=store),
            "ledger": tmp / "ledger" / "publish_ledger.jsonl", "lock_path": tmp / "lock" / ".publish.lock",
            "data": data, "new_manifest": json.dumps({"release": new_rel, "content_sha": "e" * 64,
                                                      "finalized_at": now_iso()}, sort_keys=True).encode()}


def deploy_ok(w):
    """假 deployer：把 FakeEnv 的 live 換成新 release（不碰任何真實系統）。"""
    def _d(art):
        w["env"].manifest = (Path(art) / "data/manifest.json").read_bytes()
        w["env"].files = {"/": (Path(art) / "index.html").read_bytes(),
                          "/data/items.json": (Path(art) / "data/items.json").read_bytes(),
                          "/data/stats.json": (Path(art) / "data/stats.json").read_bytes()}
        return {"deployed": True}
    return _d
