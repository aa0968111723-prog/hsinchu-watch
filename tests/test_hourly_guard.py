# -*- coding: utf-8 -*-
"""發布守門（fail-closed）測試：舊批次重播、較新 live、兩作業競爭、較新更正受保護、旁路、陳舊鎖、artifact 竄改…"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path

import pytest

import hourly_fixtures as fx
from hourly import cli, publish_guard as pg
from hourly.util import read_jsonl, url_ref


def run(w, deployer=None, environ=None, lock=None):
    called = []
    base = deployer or fx.deploy_ok(w)

    def dep(a):
        called.append(1)
        return base(a)
    res = pg.publish_candidate(w["cand"], w["env"], lock=lock or pg.PublishLock(w["lock_path"], owner="t"),
                               ledger_path=w["ledger"], latest_store=w["latest"], deployer=dep, environ=environ or {})
    return res, called


def ledger(w):
    return list(read_jsonl(w["ledger"]))


def test_happy_path_published_with_evidence(tmp_path):
    w = fx.make_world(tmp_path)
    res, called = run(w)
    assert res["status"] == "published", res
    assert called == [1]
    assert res["evidence"]["live_release"] == "rel-2"
    assert [r["status"] for r in ledger(w)] == ["published"]
    assert not w["lock_path"].exists()  # 鎖已釋放


def test_old_batch_replay_rejected(tmp_path):
    w = fx.make_world(tmp_path)
    assert run(w)[0]["status"] == "published"
    res, called = run(w)
    assert res["status"] == "aborted" and res["code"] == "old_batch_replay"
    assert called == []


def test_replay_of_lower_revision_rejected(tmp_path):
    w = fx.make_world(tmp_path)
    pg.append_jsonl(w["ledger"], [{"status": "published", "batch_id": "other", "revision": 99}])
    res, called = run(w)
    assert res["code"] == "old_batch_replay" and called == []


@pytest.mark.parametrize("mutate,code", [
    (lambda w: w["env"].__setattr__("manifest", fx.live_manifest(release="rel-NEWER", finalized_at=w["batch"]["base_live_finalized_at"])), "live_changed"),
    (lambda w: w["env"].__setattr__("manifest", fx.live_manifest(release="rel-1", data_sha="9" * 64, finalized_at=w["batch"]["base_live_finalized_at"])), "live_changed"),
    (lambda w: w["env"].__setattr__("manifest", fx.live_manifest(release="rel-1", finalized_at="2099-01-01T00:00:00+08:00")), "live_newer_than_base"),
    (lambda w: w["env"].__setattr__("manifest", json.dumps({**json.loads(w["env"].manifest), "extra": 1}, sort_keys=True).encode()), "live_manifest_changed"),
])
def test_newer_live_deploy_aborts_and_never_calls_deployer(tmp_path, mutate, code):
    w = fx.make_world(tmp_path)
    mutate(w)
    res, called = run(w)
    assert res["status"] == "aborted" and res["code"] == code, res
    assert called == []
    assert ledger(w)[-1]["status"] == "aborted"
    assert all(r["status"] != "published" for r in ledger(w))


def test_live_changes_between_preflight_and_deploy_is_caught(tmp_path):
    """TOCTOU：部署前最後一次重讀 live。"""
    w = fx.make_world(tmp_path)
    env = w["env"]
    orig = env.latest_main_sha
    n = {"c": 0}

    def flip():
        n["c"] += 1
        if n["c"] == 2:  # 預檢後、部署前的第二次讀 main 時，live 被別人換掉
            env.manifest = fx.live_manifest(release="rel-RACE", finalized_at=w["batch"]["base_live_finalized_at"])
        return orig()
    env.latest_main_sha = flip
    res, called = run(w)
    assert res["code"] == "live_changed" and called == []


def test_base_behind_aborts(tmp_path):
    w = fx.make_world(tmp_path)
    w["env"].main = fx.NEW_MAIN_SHA
    res, called = run(w)
    assert res["code"] == "base_behind" and called == []


def test_fail_closed_when_main_or_live_unreadable(tmp_path):
    w = fx.make_world(tmp_path)
    w["env"].fail_main = True
    assert run(w)[0]["code"] == "main_unreadable"
    w["env"].fail_main = False
    w["env"].fail_live = True
    assert run(w)[0]["code"] == "live_unreadable"


def test_unknown_base_is_fail_closed(tmp_path):
    w = fx.make_world(tmp_path, ctx_over={"base_live_release": None})
    res, called = run(w)
    assert res["code"] == "base_unknown" and called == []
    w2 = fx.make_world(tmp_path / "x", ctx_over={"base_main_commit": None})
    assert run(w2)[0]["code"] == "base_unknown"


def test_two_concurrent_jobs_only_one_gets_lock(tmp_path):
    lock_path = tmp_path / "lk" / ".publish.lock"
    results, barrier = [], threading.Barrier(8)

    def job(i):
        l = pg.PublishLock(lock_path, owner=f"job{i}")
        barrier.wait()
        try:
            l.acquire()
            results.append(("won", i))
            time.sleep(0.2)
            l.release()
        except pg.GuardAbort as e:
            results.append((e.code, i))
    ts = [threading.Thread(target=job, args=(i,)) for i in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sum(1 for r in results if r[0] == "won") == 1
    assert sum(1 for r in results if r[0] == "lock_held") == 7


def test_two_publish_jobs_second_aborts_while_first_holds_lock(tmp_path):
    w = fx.make_world(tmp_path)
    entered, release = threading.Event(), threading.Event()
    out = {}

    def slow_deploy(art):
        entered.set()
        release.wait(5)
        return fx.deploy_ok(w)(art)

    def a():
        out["a"], _ = run(w, deployer=slow_deploy, lock=pg.PublishLock(w["lock_path"], owner="A"))
    t = threading.Thread(target=a)
    t.start()
    assert entered.wait(5)
    res_b, called_b = run(w, lock=pg.PublishLock(w["lock_path"], owner="B"))
    release.set()
    t.join()
    assert res_b["status"] == "aborted" and res_b["code"] == "lock_held" and called_b == []
    assert out["a"]["status"] == "published"
    assert [r["status"] for r in ledger(w)].count("published") == 1


def test_second_job_after_first_published_aborts_on_live_change(tmp_path):
    """兩個不同候選同基底：第一個發布後，第二個必須因 live 已換而中止，不得蓋掉較新部署。"""
    w = fx.make_world(tmp_path)
    assert run(w)[0]["status"] == "published"
    w2 = fx.make_world(tmp_path / "second")
    w2["env"] = w["env"]  # 同一個 live（已被第一個換成 rel-2）
    res, called = run(w2)
    assert res["status"] == "aborted" and res["code"] in ("live_changed", "live_newer_than_base", "live_manifest_changed")
    assert called == []


def test_stale_lock_is_not_taken_over(tmp_path):
    w = fx.make_world(tmp_path)
    w["lock_path"].parent.mkdir(parents=True)
    w["lock_path"].write_text(json.dumps({"owner": "dead", "token": "x", "acquired_at": "2020-01-01T00:00:00+08:00", "ttl_seconds": 1}))
    res, called = run(w)
    assert res["code"] == "lock_held" and called == []
    assert w["lock_path"].exists()  # 不接管、不刪


def test_lock_release_only_by_owner_token(tmp_path):
    p = tmp_path / "l"
    a, b = pg.PublishLock(p, owner="a"), pg.PublishLock(p, owner="b")
    a.acquire()
    b.release()  # b 沒持有；不可刪
    assert p.exists()
    a.release()
    assert not p.exists()


@pytest.mark.parametrize("var", list(pg.BYPASS_ENV))
def test_bypass_env_var_rejected(tmp_path, var):
    w = fx.make_world(tmp_path)
    res, called = run(w, environ={var: "1"})
    assert res["code"] == "bypass_attempt" and called == []


def test_cli_refuses_force_flags(capsys):
    for f in ("--force", "--skip-checks", "--no-verify", "--override=1"):
        assert cli.main([f, "status"]) == 2


def test_publish_candidate_has_no_force_parameters():
    import inspect
    params = set(inspect.signature(pg.publish_candidate).parameters)
    assert not params & {"force", "skip", "skip_checks", "no_verify", "override", "disable_checks"}
    assert inspect.signature(pg.publish_candidate).parameters["deployer"].default is inspect._empty  # 無預設 deployer


def test_modified_artifact_is_not_immutable(tmp_path):
    w = fx.make_world(tmp_path)
    (w["art"] / "index.html").write_text("<html>tampered after seal</html>")
    res, called = run(w)
    assert res["code"] == "artifact_not_immutable" and called == []


def test_added_file_in_artifact_is_not_immutable(tmp_path):
    w = fx.make_world(tmp_path)
    (w["art"] / "extra.js").write_text("x")
    assert run(w)[0]["code"] == "artifact_not_immutable"


def test_tampered_artifact_manifest_detected(tmp_path):
    w = fx.make_world(tmp_path)
    w["am"]["files"]["index.html"] = "0" * 64
    res, _ = run(w)
    assert res["code"] == "artifact_manifest_tampered"


def test_incomplete_artifact_rejected(tmp_path):
    w = fx.make_world(tmp_path)
    (w["art"] / "data/stats.json").unlink()
    with pytest.raises(pg.GuardAbort) as e:
        pg.artifact_manifest(w["art"], batch_id="x")
    assert e.value.code == "artifact_incomplete"


def test_timestamp_tampering_rejected(tmp_path):
    w = fx.make_world(tmp_path)
    w["cand"].artifact["sealed_at"] = "2099-01-01T00:00:00+08:00"
    assert run(w)[0]["code"] == "timestamp_tamper"
    w = fx.make_world(tmp_path / "b")
    w["cand"].artifact["sealed_at"] = "2001-01-01T00:00:00+08:00"  # 回填舊時間冒充
    assert run(w)[0]["code"] == "timestamp_tamper"
    w = fx.make_world(tmp_path / "c")
    (w["art"] / "data/manifest.json").write_text(json.dumps({"release": {"id": "rel-2", "data_sha256": "e" * 64},
                                                             "finalized_at": "2000-01-01T00:00:00+08:00"}))
    w["cand"].artifact = pg.artifact_manifest(w["art"], batch_id=w["batch"]["batch_id"])
    assert run(w)[0]["code"] == "timestamp_tamper"  # 舊 build 冒充新版


def test_artifact_dir_guard_rejects_repo_root_and_secret_names(tmp_path):
    w = fx.make_world(tmp_path)
    (w["art"] / ".git").mkdir()
    with pytest.raises(pg.GuardAbort) as e:
        pg.check_artifact_dir_safe(w["art"])
    assert e.value.code == "artifact_dir_unsafe"
    w2 = fx.make_world(tmp_path / "s")
    (w2["art"] / ".env").write_text("x=1")
    with pytest.raises(pg.GuardAbort):
        pg.check_artifact_dir_safe(w2["art"])
    with pytest.raises(pg.GuardAbort):
        pg.check_artifact_dir_safe(Path(__file__).resolve().parents[1])  # repo 根


def test_verify_failure_does_not_write_published(tmp_path):
    w = fx.make_world(tmp_path)

    def bad_deploy(art):  # 部署後 live 的資料 hash 不對
        w["env"].manifest = json.dumps({"release": {"id": "rel-2", "data_sha256": "f" * 64}, "finalized_at": fx.now_iso()}).encode()
    res, called = run(w, deployer=bad_deploy)
    assert called == [1]
    assert res["status"] == "deployed_unverified" and res["code"] == "verify_failed"
    rows = ledger(w)
    assert all(r["status"] != "published" for r in rows) and rows[-1]["status"] == "deployed_unverified"


def test_verify_failure_when_release_never_appears(tmp_path):
    w = fx.make_world(tmp_path)
    res, _ = run(w, deployer=lambda a: None)  # live 沒變
    assert res["status"] == "deployed_unverified"


# ---- 資料衝突：較新資料修正受保護
def _batch_event_item(w):
    return w["batch"]["events"][0]["item_id"]


def test_newer_correction_in_latest_ledger_is_protected(tmp_path):
    w = fx.make_world(tmp_path)
    iid = _batch_event_item(w)
    w["latest"].add_correction(iid, "title", "人工更正標題", "更正", "human", key="late-fix")  # corr_seq 大於批次建立時
    res, called = run(w)
    assert res["code"] == "data_conflict" and "protected_newer_correction" in res["detail"] and called == []


def test_item_diverged_in_latest_ledger_aborts(tmp_path):
    w = fx.make_world(tmp_path)
    iid = _batch_event_item(w)
    e = next(e for e in w["batch"]["events"] if e["item_id"] == iid)
    # 最新帳中這筆被別條線改成另一個 hash
    w["latest"].append_events([{"event_key": "other-line", "type": "item_changed", "item_id": iid, "hash": "9" * 64,
                                "prev_hash": e["hash"], "batch_id": "other"}])
    w["latest"].commit_all()
    res, _ = run(w)
    assert res["code"] == "data_conflict" and "item_diverged" in res["detail"]


def test_exclusion_by_id_or_url_hash_after_base_aborts(tmp_path):
    w = fx.make_world(tmp_path)
    iid = _batch_event_item(w)
    w["latest"].add_exclusion(iid, "rejected_after_review", "human")
    assert run(w)[0]["code"] == "data_conflict"
    w2 = fx.make_world(tmp_path / "u")
    e = w2["batch"]["events"][0]
    w2["latest"].add_exclusion(e["url_ref"], "rejected_after_review", "human")  # 只有 URL 雜湊形
    res, _ = run(w2)
    assert res["code"] == "data_conflict" and "excluded_after_base" in res["detail"]


def test_latest_ledger_must_not_be_candidate_copy(tmp_path):
    w = fx.make_world(tmp_path)
    w["latest"] = w["store"]
    res, called = run(w)
    assert res["code"] == "data_conflict" and "latest_ledger_is_candidate_copy" in res["detail"] or res["code"] == "latest_ledger_is_candidate_copy"
    assert called == []


def test_no_conflict_when_latest_already_has_batch(tmp_path):
    w = fx.make_world(tmp_path)
    assert run(w)[0]["status"] == "published"


# ---- 本分支不得含部署能力
def test_hourly_package_has_no_deploy_capability():
    root = Path(__file__).resolve().parents[1] / "hourly"
    banned = re.compile(r"(wrangler|pages\s+deploy|CLOUDFLARE|CF_API|api\.cloudflare|R2_|\"push\"|'push'|git\s+push|"
                        r"\"deploy\"|rollback|--force|\"checkout\"|\"reset\")", re.I)
    allowed_context = ("BYPASS_ENV", "FORBIDDEN_FLAGS", "不", "rollback", "禁", "沒有", "拒絕")
    hits = []
    for f in sorted(root.glob("*.py")):
        for n, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if banned.search(line):
                # 只容許在註解／文件字串／禁止清單中「提到」
                s = line.strip()
                if s.startswith(("#", '"""', "'")) or any(a in line for a in allowed_context):
                    continue
                hits.append(f"{f.name}:{n}:{line.strip()[:80]}")
    assert not hits, hits
    # subprocess 只准唯讀 git 與 finalize 建置
    for f in root.glob("*.py"):
        src = f.read_text(encoding="utf-8")
        for m in re.finditer(r"subprocess\.run\(\[([^\]]*)\]", src):
            args = m.group(1)
            assert not re.search(r'"(push|commit|merge|rebase|checkout|reset|clean|rm|tag|fetch\s)"', args), (f.name, args)
