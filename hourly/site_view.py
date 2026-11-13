# -*- coding: utf-8 -*-
"""由蒐集端 data/ 產生「已上架形狀」的公開視圖（給網站／Gemini MCP 讀）。

做法：把 data/ 複製到暫存（不含 excluded_urls.local.json、inbox），在暫存內跑既有的 scripts/finalize_data.py，
輸出到指定目錄（預設 hourly_store/site_view，已 gitignore）。因此站上規則（全名門檻、排除、待審、民調核對、
去重）與正式 finalize 完全一致，且 excluded／pending 不會出現在視圖。不寫 data/、public/、dist/、不連網、不部署。
"""
from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

FORBIDDEN_NAMES = {
    "excluded.json", "excluded_publish.json", "pending_review_publish.json", "review_decisions.json",
    "excluded_urls.local.json", "polls_verified.json", "policies_extra.json", "policy_annotations.json",
    "laptop_carry.json", "sitemap_fetch_state.json", "inbox",
}


class ViewError(Exception):
    pass


def check_view_dir(view_dir: Path) -> Path:
    """網站／Gemini MCP 只准讀「已上架視圖」：拒絕蒐集端 data/、work/、store 內部目錄。"""
    p = Path(view_dir).resolve()
    if not p.is_dir():
        raise ViewError("view dir not found")
    parts = set(p.parts)
    if "work" in parts or "hourly_store" in parts and p.name in ("objects", "batches", "checkpoints"):
        raise ViewError("view dir must not be under work/ or a store internal dir")
    if p.name == "data" and ((p.parent / "collectors").exists() or (p.parent / "scripts").exists()):
        raise ViewError("refusing collector data/ — serve a published view (public/data, dist/data or hourly site_view)")
    bad = sorted(n for n in FORBIDDEN_NAMES if (p / n).exists())
    if bad:
        raise ViewError(f"view dir contains collector-only files: {bad}")
    if not (p / "manifest.json").exists():
        raise ViewError("view dir has no manifest.json (not a published view)")
    return p


def build_view(data_dir: Path, out_dir: Path, repo: Path | None = None, timeout: int = 300) -> dict:
    data_dir, out_dir = Path(data_dir).resolve(), Path(out_dir).resolve()
    repo = Path(repo).resolve() if repo else data_dir.parent
    script = repo / "scripts" / "finalize_data.py"
    if not script.exists():
        raise ViewError("scripts/finalize_data.py not found in repo")
    if out_dir == data_dir or data_dir in out_dir.parents:
        raise ViewError("out dir must not be inside data/")
    with tempfile.TemporaryDirectory(prefix="hwview-") as tmp:
        src = Path(tmp) / "src"
        shutil.copytree(data_dir, src, ignore=shutil.ignore_patterns("excluded_urls.local.json", "inbox"))
        out_dir.mkdir(parents=True, exist_ok=True)
        env = dict(os.environ, HW_SRC=str(src), HW_OUT=str(out_dir), HW_EXCLUDED=str(Path(tmp) / "ex.json"),
                   HW_PENDING=str(Path(tmp) / "pend.json"))
        r = subprocess.run([sys.executable, str(script), "--data-dir", str(src), "--public-data-dir", str(out_dir)],
                           cwd=str(repo), env=env, capture_output=True, text=True, timeout=timeout)
        if r.returncode != 0:
            raise ViewError("finalize failed: " + r.stderr[-300:])
    for n in FORBIDDEN_NAMES:  # 保險：視圖內不得有蒐集端檔
        if (out_dir / n).exists():
            raise ViewError(f"unexpected collector-only file in view: {n}")
    return {"view_dir": str(out_dir), "files": sorted(p.name for p in out_dir.glob("*.json"))}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data")
    ap.add_argument("--out", default="hourly_store/site_view")
    ap.add_argument("--repo")
    ns = ap.parse_args(argv)
    print(build_view(Path(ns.data_dir), Path(ns.out), Path(ns.repo) if ns.repo else None))
    return 0


if __name__ == "__main__":
    sys.exit(main())
