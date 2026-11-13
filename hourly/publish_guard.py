# -*- coding: utf-8 -*-
"""發布守門（交第四線審核；未接入任何正式管線，本模組不含任何部署能力）。

設計原則：fail-closed。任何無法確認的狀況（讀不到 main／live、欄位缺漏、鎖被占用、例外）一律中止候選，
不重試、不放行。不提供 force／skip／no-verify／覆寫時間戳的參數；環境變數旁路也會被拒絕。

流程（publish_candidate）：
  1 取得「單一 production 發布鎖」（不自動接管，過期鎖也要人工處置）
  2 候選完整性：不可變 artifact（完整 build）hash、時間戳不得造假
  3 舊批次重播 → 中止
  4 fetch 最新 main：基底落後 → 中止
  5 重讀 live manifest：release／data／ui／manifest hash 與批次基準任一不同，
    或 live finalized_at 晚於批次基準 → 中止（絕不蓋掉較新部署）
  6 資料衝突（較新更正／排除／同筆被他線改動）→ 中止（較新資料修正受保護）
  7 部署前再讀一次 live（TOCTOU）→ 才呼叫「由呼叫端明確注入」的 deployer
  8 發布後核對正式 URL：release、資料 hash、主要功能；失敗只記錄並升級人工，不自動回滾
  9 寫 append-only 發布帳；釋放鎖
"""
from __future__ import annotations

import hashlib
import json
import os
import socket
import urllib.request
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Protocol

from .store import Store
from .util import url_ref, append_jsonl, atomic_write_bytes, canon, now_iso, read_json, read_jsonl, sha256_bytes, sha256_file

CLOCK_SKEW = timedelta(minutes=5)
REQUIRED_ARTIFACT_FILES = ("index.html", "data/manifest.json", "data/items.json", "data/stats.json")
KEY_FEATURE_PATHS = ("/", "/data/manifest.json", "/data/items.json", "/data/stats.json")
BYPASS_ENV = ("HW_FORCE", "HW_SKIP_GUARD", "HW_NO_VERIFY", "HW_SKIP_CHECKS", "FORCE_PUBLISH", "SKIP_GUARD")


class GuardAbort(Exception):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}")
        self.code, self.detail = code, detail


# ---------------------------------------------------------------- Env（可注入）
class Env(Protocol):
    def latest_main_sha(self) -> str: ...
    def live_manifest_raw(self) -> bytes: ...
    def fetch(self, path: str) -> bytes: ...
    def now(self) -> datetime: ...


class RealEnv:
    """唯讀：git ls-remote、HTTP GET。無任何寫入或部署。"""

    def __init__(self, repo: Path, live_url: str = "https://hsinchu-watch.pages.dev", remote: str = "origin"):
        self.repo, self.live_url, self.remote = Path(repo), live_url.rstrip("/"), remote

    def latest_main_sha(self) -> str:
        import subprocess
        r = subprocess.run(["git", "-C", str(self.repo), "ls-remote", self.remote, "refs/heads/main"],
                           capture_output=True, text=True, timeout=60)
        if r.returncode != 0 or not r.stdout.split():
            raise RuntimeError("ls-remote failed")
        return r.stdout.split()[0]

    def live_manifest_raw(self) -> bytes:
        return self.fetch("/data/manifest.json")

    def fetch(self, path: str) -> bytes:
        req = urllib.request.Request(self.live_url + path, headers={"Cache-Control": "no-cache"})
        return urllib.request.urlopen(req, timeout=30).read()

    def now(self) -> datetime:
        return datetime.now(timezone.utc)


# ---------------------------------------------------------------- 單一 production 發布鎖
class PublishLock:
    """O_EXCL 原子建立；單一持有者。過期鎖不自動接管（fail-closed）；僅持有 token 者可釋放。"""

    def __init__(self, path: Path, owner: str = "", ttl_seconds: int = 1800):
        self.path, self.owner = Path(path), owner or f"{socket.gethostname()}:{os.getpid()}"
        self.ttl, self.token = ttl_seconds, uuid.uuid4().hex
        self.held = False

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        meta = {"owner": self.owner, "token": self.token, "pid": os.getpid(),
                "acquired_at": now_iso(), "ttl_seconds": self.ttl}
        # 先把完整內容寫進暫存檔，再以 os.link 原子「建立並可見」：已存在則 FileExistsError（單一持有者），
        # 且別人讀到鎖檔時內容一定完整（避免 O_EXCL 建立後、寫入前的空檔競態）。
        import tempfile
        fd, tmp = tempfile.mkstemp(dir=str(self.path.parent), prefix=".lock-", suffix=".tmp")
        with os.fdopen(fd, "w") as f:
            f.write(json.dumps(meta))
            f.flush()
            os.fsync(f.fileno())
        try:
            os.link(tmp, self.path)
        except FileExistsError:
            try:
                cur = json.loads(self.path.read_text(encoding="utf-8"))
            except Exception:
                cur = {}
            raise GuardAbort("lock_held", f"owner={cur.get('owner')} since={cur.get('acquired_at')} "
                                          f"(不自動接管；過期鎖請第四線人工確認後處置)")
        finally:
            os.unlink(tmp)
        self.held = True

    def release(self) -> None:
        if not self.held:
            return
        cur = read_json(self.path, {}) or {}
        if cur.get("token") == self.token:
            os.unlink(self.path)
        self.held = False

    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *a):
        self.release()


# ---------------------------------------------------------------- artifact（完整 build 的不可變 manifest）
UNSAFE_NAME_RE = __import__("re").compile(r"(^\.env|\.pem$|\.key$|\.p12$|\.pfx$|id_rsa|id_ed25519|secret|credential|\.local\.json$|^\.git$|\.netrc$)", __import__("re").I)
REPO_MARKERS = (".git", "hourly", "collectors", "scripts", "node_modules", "work", "hourly_store")


def check_artifact_dir_safe(artifact_dir: Path) -> None:
    """封存目錄必須是已建置 dist：不得是 repo 根／含 repo 標記、不得含密鑰類檔名。"""
    root = Path(artifact_dir).resolve()
    if not root.is_dir():
        raise GuardAbort("artifact_dir_missing", str(root.name))
    marks = [m for m in REPO_MARKERS if (root / m).exists()]
    if marks:
        raise GuardAbort("artifact_dir_unsafe", f"looks like a repo/source root (contains {marks})")
    bad = [p.name for p in root.rglob("*") if UNSAFE_NAME_RE.search(p.name)]
    if bad:
        raise GuardAbort("artifact_dir_unsafe", f"secret-like file names in artifact: {sorted(set(bad))[:5]}")


def artifact_manifest(artifact_dir: Path, *, batch_id: str, sealed_at: Optional[str] = None) -> dict:
    """計算整個 build 輸出的逐檔 sha256；artifact_id＝逐檔 hash 的雜湊。唯讀。"""
    check_artifact_dir_safe(Path(artifact_dir))
    root = Path(artifact_dir)
    files = {}
    for p in sorted(root.rglob("*")):
        if p.is_file():
            files[p.relative_to(root).as_posix()] = sha256_file(p)
    missing = [f for f in REQUIRED_ARTIFACT_FILES if f not in files]
    if missing:
        raise GuardAbort("artifact_incomplete", f"missing {missing}")
    aid = sha256_bytes(canon(files))
    return {"schema": "hourly-artifact/1", "artifact_id": aid, "batch_id": batch_id,
            "sealed_at": sealed_at or now_iso(), "files": files}


def seal_artifact_manifest(manifest: dict, out_path: Path) -> None:
    """寫入不可變 manifest（已存在且內容不同 → 拒絕）。請寫在 dist 之外。"""
    atomic_write_bytes(Path(out_path), canon(manifest), immutable=True)


@dataclass
class Candidate:
    batch: dict                      # 批次 manifest（hourly-batch/1）
    artifact_dir: Path
    artifact: dict                   # 已封存的 artifact manifest
    expected_release_id: Optional[str] = None   # 4 線給新 build 的 release id（可空，空則取 artifact manifest）
    store: Optional[Store] = None    # 候選端 ledger；None → 衝突檢查 fail-closed（候選無法證明與共享帳的關係，不放行）


def _parse_ts(s: Optional[str]) -> datetime:
    if not s:
        raise GuardAbort("timestamp_missing")
    try:
        t = datetime.fromisoformat(s)
    except ValueError:
        raise GuardAbort("timestamp_invalid", s)
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


# ---------------------------------------------------------------- 各項檢查（皆 fail-closed）
def check_no_bypass(environ=None) -> None:
    environ = os.environ if environ is None else environ
    hit = [k for k in BYPASS_ENV if str(environ.get(k, "")).strip() not in ("", "0")]
    if hit:
        raise GuardAbort("bypass_attempt", f"forbidden env: {hit}")


def check_artifact(c: Candidate, env: Env) -> None:
    a, b = c.artifact, c.batch
    check_artifact_dir_safe(c.artifact_dir)
    if a.get("batch_id") != b.get("batch_id"):
        raise GuardAbort("artifact_batch_mismatch")
    files = a.get("files") or {}
    if sha256_bytes(canon(files)) != a.get("artifact_id"):
        raise GuardAbort("artifact_manifest_tampered", "artifact_id != hash(files)")
    for f in REQUIRED_ARTIFACT_FILES:
        if f not in files:
            raise GuardAbort("artifact_incomplete", f)
    root = Path(c.artifact_dir)
    actual = {}
    for p in sorted(root.rglob("*")):
        if p.is_file():
            actual[p.relative_to(root).as_posix()] = sha256_file(p)
    if actual != files:
        diff = sorted(set(actual) ^ set(files)) or [k for k in files if actual.get(k) != files[k]]
        raise GuardAbort("artifact_not_immutable", f"build output differs from sealed manifest: {diff[:5]}")
    now = env.now()
    sealed = _parse_ts(a.get("sealed_at"))
    created = _parse_ts(b.get("created_at"))
    if sealed > now + CLOCK_SKEW or created > now + CLOCK_SKEW:
        raise GuardAbort("timestamp_tamper", "sealed_at/created_at in the future")
    if sealed + CLOCK_SKEW < created:
        raise GuardAbort("timestamp_tamper", "artifact sealed before its batch was created (backdated)")
    try:
        m = json.loads((root / "data/manifest.json").read_text(encoding="utf-8"))
    except Exception:
        raise GuardAbort("artifact_manifest_unreadable")
    fin = _parse_ts(m.get("finalized_at"))
    if fin > now + CLOCK_SKEW:
        raise GuardAbort("timestamp_tamper", "data manifest finalized_at in the future")
    if c.batch.get("base_live_finalized_at") and fin + CLOCK_SKEW < _parse_ts(c.batch["base_live_finalized_at"]):
        raise GuardAbort("timestamp_tamper", "candidate finalized_at older than base live (stale build posing as new)")


def check_replay(c: Candidate, ledger_path: Path) -> None:
    rows = list(read_jsonl(ledger_path))
    pub = [r for r in rows if r.get("status") == "published"]
    for r in pub:
        if r.get("batch_id") == c.batch["batch_id"]:
            raise GuardAbort("old_batch_replay", "batch already published")
    top = max((r.get("revision", 0) for r in pub), default=0)
    if c.batch["revision"] <= top:
        raise GuardAbort("old_batch_replay", f"revision {c.batch['revision']} <= published {top}")


def check_base_main(c: Candidate, env: Env) -> str:
    base = c.batch.get("base_main_commit")
    if not base:
        raise GuardAbort("base_unknown", "batch has no base_main_commit")
    try:
        latest = env.latest_main_sha()
    except Exception as e:
        raise GuardAbort("main_unreadable", str(e)[:200])
    if not latest:
        raise GuardAbort("main_unreadable")
    if latest != base:
        raise GuardAbort("base_behind", f"batch base={base[:10]} latest main={latest[:10]}；請合入最新 main 後重新整合驗收")
    return latest


def check_live(c: Candidate, env: Env) -> dict:
    b = c.batch
    for k in ("base_live_release", "live_manifest_hash", "live_data_sha256", "base_live_finalized_at"):
        if not b.get(k):
            raise GuardAbort("base_unknown", f"batch missing {k}（無法證明基於哪個 live；fail-closed）")
    try:
        raw = env.live_manifest_raw()
        m = json.loads(raw)
    except Exception as e:
        raise GuardAbort("live_unreadable", str(e)[:200])
    rel = m.get("release") or {}
    if not rel.get("id"):
        raise GuardAbort("live_unreadable", "live manifest has no release.id")
    fin_live, fin_base = _parse_ts(m.get("finalized_at")), _parse_ts(b["base_live_finalized_at"])
    if fin_live > fin_base:
        raise GuardAbort("live_newer_than_base", f"live finalized_at {m.get('finalized_at')} > base {b['base_live_finalized_at']}")
    if rel.get("id") != b["base_live_release"]:
        raise GuardAbort("live_changed", f"live release {rel.get('id')} != base {b['base_live_release']}")
    if (rel.get("data_sha256") or m.get("content_sha")) != b["live_data_sha256"]:
        raise GuardAbort("live_changed", "live data hash differs from batch base")
    if sha256_bytes(raw) != b["live_manifest_hash"]:
        raise GuardAbort("live_manifest_changed", "live manifest hash differs from batch base；重新讀 live 並重新整合")
    return m


def check_data_conflicts(c: Candidate, latest: Store) -> None:
    """候選批次的事件對「最新 ledger」的衝突檢查。任一衝突 → 整個候選中止（不部分套用）。"""
    b = c.batch
    if c.store is None:
        raise GuardAbort("candidate_store_missing", "Candidate.store 為 None：無法核對候選帳與共享最新帳，fail-closed 中止（不略過衝突檢查）")
    if Path(c.store.root).resolve() == Path(latest.root).resolve():
        raise GuardAbort("latest_ledger_is_candidate_copy", "latest_store 必須是共享最新帳（fetch 最新 main 後的 ledger），不得是候選自己的副本")
    st = latest.state_at()
    cur, item_rev = st["items"], st["item_rev"]
    base_seq = b.get("base_event_seq", 0)
    corrs = latest.corrections()
    excls = latest.exclusions()
    conflicts: List[str] = []
    # 候選批次不是最新 ledger 的直接後繼：先確認 ledger 知道它的前批（或就是同一批）
    if b.get("prev_batch_id") and latest.get_batch(b["prev_batch_id"]) is None:
        conflicts.append(f"ledger_missing_prev_batch:{b['prev_batch_id']}")
    for e in b.get("events", []):
        iid = e["item_id"]
        have = cur.get(iid)
        if e["type"] in ("item_added", "item_changed"):
            if have is not None and have not in (e.get("prev_hash"), e["hash"]):
                conflicts.append(f"item_diverged:{iid}")
            if have is None and e["type"] == "item_changed" and iid in item_rev and item_rev[iid] > base_seq:
                conflicts.append(f"item_withdrawn_after_base:{iid}")
        elif e["type"] == "item_withdrawn":
            if have is not None and have != e.get("hash"):
                conflicts.append(f"item_diverged:{iid}")
        # 較新更正受保護：更正序號大於批次建立時的 corr_seq_after
        for corr in corrs:
            if corr["item_id"] == iid and corr["corr_seq"] > b.get("corr_seq_after", 0):
                conflicts.append(f"protected_newer_correction:{iid}#{corr['corr_seq']}")
                break
        if e["type"] != "item_withdrawn":
            for x in excls:
                if x["ref"] in (iid, e.get("url_ref")) and x["excl_seq"] > b.get("excl_seq_after", 0):
                    conflicts.append(f"excluded_after_base:{iid}#{x['excl_seq']}")
                    break
    if conflicts:
        raise GuardAbort("data_conflict", "; ".join(sorted(set(conflicts))[:20]))


# ---------------------------------------------------------------- 預檢 / 發布 / 發布後核對
def preflight(c: Candidate, env: Env, ledger_path: Path, latest_store: Store, *, environ=None) -> dict:
    """在「已持鎖」前提下的所有檢查。回傳證據；任何失敗 raise GuardAbort。"""
    check_no_bypass(environ)
    check_artifact(c, env)
    check_replay(c, ledger_path)
    main = check_base_main(c, env)
    live = check_live(c, env)
    check_data_conflicts(c, latest_store)
    return {"latest_main": main, "live_release": (live.get("release") or {}).get("id"),
            "artifact_id": c.artifact["artifact_id"], "checked_at": now_iso()}


def verify_live(c: Candidate, env: Env) -> dict:
    """發布後核對正式 URL：release、資料 hash、主要功能。回傳證據；不符 raise GuardAbort。"""
    expected_files = c.artifact["files"]
    raw = env.live_manifest_raw()
    m = json.loads(raw)
    art_m = json.loads((Path(c.artifact_dir) / "data/manifest.json").read_text(encoding="utf-8"))
    want_rel = (art_m.get("release") or {}).get("id") or c.expected_release_id
    if not want_rel:
        raise GuardAbort("verify_failed", "no expected release id")
    got = (m.get("release") or {})
    if got.get("id") != want_rel:
        raise GuardAbort("verify_failed", f"live release {got.get('id')} != expected {want_rel}")
    want_data = (art_m.get("release") or {}).get("data_sha256") or art_m.get("content_sha")
    if (got.get("data_sha256") or m.get("content_sha")) != want_data:
        raise GuardAbort("verify_failed", "live data hash != artifact data hash")
    feats = {}
    for p in KEY_FEATURE_PATHS:
        body = env.fetch(p)
        if not body:
            raise GuardAbort("verify_failed", f"empty response {p}")
        rel = "index.html" if p == "/" else p.lstrip("/")
        if rel in expected_files and sha256_bytes(body) != expected_files[rel] and rel != "data/manifest.json":
            raise GuardAbort("verify_failed", f"{p} hash differs from artifact")
        feats[p] = sha256_bytes(body)[:16]
    return {"live_release": got.get("id"), "data_sha256": want_data, "features": feats, "verified_at": now_iso()}


def publish_candidate(c: Candidate, env: Env, *, lock: PublishLock, ledger_path: Path, latest_store: Store,
                      deployer: Callable[[Path], Any], environ=None) -> dict:
    """唯一的發布入口。deployer 必須由呼叫端（第四線）明確注入；本模組不提供任何部署實作。
    不接受 force／skip／no-verify 類參數。回傳 {status: published|aborted|deployed_unverified, ...}。"""
    entry = {"batch_id": c.batch.get("batch_id"), "revision": c.batch.get("revision"),
             "artifact_id": c.artifact.get("artifact_id"), "at": now_iso(), "owner": lock.owner}
    try:
        with lock:
            try:
                ev = preflight(c, env, ledger_path, latest_store, environ=environ)
                # 部署前最後一次（TOCTOU）：main 與 live 再讀一次
                check_base_main(c, env)
                check_live(c, env)
            except GuardAbort as e:
                append_jsonl(ledger_path, [dict(entry, status="aborted", code=e.code, detail=e.detail[:300])])
                return {"status": "aborted", "code": e.code, "detail": e.detail,
                        "next": "停止該候選；重新整合最新 main／live 後重新驗收，不得改時間戳或 force。"}
            except Exception as e:  # 非預期例外：同樣中止
                append_jsonl(ledger_path, [dict(entry, status="aborted", code="unexpected", detail=str(e)[:300])])
                return {"status": "aborted", "code": "unexpected", "detail": str(e)}
            res = deployer(Path(c.artifact_dir))
            try:
                proof = verify_live(c, env)
            except GuardAbort as e:
                append_jsonl(ledger_path, [dict(entry, status="deployed_unverified", code=e.code, detail=e.detail[:300],
                                                deploy_result=str(res)[:200])])
                return {"status": "deployed_unverified", "code": e.code, "detail": e.detail,
                        "next": "升級第四線人工處理；本守門不自動回滾。不得標為已發布。"}
            append_jsonl(ledger_path, [dict(entry, status="published", evidence=proof, preflight=ev)])
            return {"status": "published", "evidence": proof}
    except GuardAbort as e:  # 取鎖失敗
        return {"status": "aborted", "code": e.code, "detail": e.detail}
