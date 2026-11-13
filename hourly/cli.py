# -*- coding: utf-8 -*-
"""python -m hourly.cli <cmd>

  ingest   data/ → 不可變批次（唯讀讀 data/；寫入 hourly_store/；不碰 dist／releases／雲端）
  status   store 狀態
  plan     對候選做發布預檢（dry-run；不取鎖、不部署；只讀 git ls-remote 與 live manifest）
  artifact 為建置輸出計算逐檔 hash manifest（寫到指定路徑，不寫進 dist）

沒有 publish／deploy 子命令；任何 --force／--skip／--no-verify 一律拒絕。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import batch, publish_guard as pg
from .mcp_political import build as _build_mcp
from .store import Store
from .util import read_json

FORBIDDEN_FLAGS = ("--force", "--skip", "--no-verify", "--skip-checks", "--disable-checks", "--override")


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    for a in argv:
        if any(a == f or a.startswith(f + "=") for f in FORBIDDEN_FLAGS):
            print(f"refused: {a} is not allowed (fail-closed guard has no bypass)", file=sys.stderr)
            return 2
    ap = argparse.ArgumentParser(prog="hourly")
    ap.add_argument("--repo", default=".")
    ap.add_argument("--store", default="hourly_store")
    sub = ap.add_subparsers(dest="cmd", required=True)
    i = sub.add_parser("ingest")
    i.add_argument("--data-dir", default="data")
    i.add_argument("--offline", action="store_true", help="不讀 git remote／live（基準欄位留空，之後 plan 會 fail-closed）")
    sub.add_parser("status")
    p = sub.add_parser("plan")
    p.add_argument("--batch-id", required=True)
    p.add_argument("--artifact-dir", required=True)
    p.add_argument("--artifact-manifest", required=True)
    p.add_argument("--ledger", default="hourly_store/publish_ledger.jsonl")
    a = sub.add_parser("artifact")
    a.add_argument("--artifact-dir", required=True)
    a.add_argument("--batch-id", required=True)
    a.add_argument("--out", required=True)
    ns = ap.parse_args(argv)
    repo, store = Path(ns.repo), Store(ns.store)
    if ns.cmd == "ingest":
        ctx = ({"source_commit": batch._git(repo, "rev-parse", "HEAD")} if ns.offline else batch.real_context(repo))
        print(json.dumps(batch.ingest(ns.data_dir, store, ctx), ensure_ascii=False, indent=1))
        return 0
    if ns.cmd == "status":
        srv = _build_mcp(store)
        print(json.dumps(srv.tools["hw_status"].fn({}), ensure_ascii=False, indent=1))
        return 0
    if ns.cmd == "artifact":
        m = pg.artifact_manifest(Path(ns.artifact_dir), batch_id=ns.batch_id)
        pg.seal_artifact_manifest(m, Path(ns.out))
        print(m["artifact_id"])
        return 0
    if ns.cmd == "plan":
        b = store.get_batch(ns.batch_id)
        if not b:
            print("batch not found", file=sys.stderr)
            return 2
        c = pg.Candidate(batch=b, artifact_dir=Path(ns.artifact_dir), artifact=read_json(Path(ns.artifact_manifest)))
        env = pg.RealEnv(repo)
        try:
            ev = pg.preflight(c, env, Path(ns.ledger), store)
            print(json.dumps({"decision": "eligible", "evidence": ev}, ensure_ascii=False, indent=1))
            return 0
        except pg.GuardAbort as e:
            print(json.dumps({"decision": "abort", "code": e.code, "detail": e.detail}, ensure_ascii=False, indent=1))
            return 1
    return 2


if __name__ == "__main__":
    sys.exit(main())
