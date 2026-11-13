# -*- coding: utf-8 -*-
"""開源方案小型驗證（只在套件已安裝時執行；未安裝則 skip，不強制依賴）。
重現：pip install --target <dir> dateparser==1.5.0 jsonschema==4.26.0 tenacity==9.2.1；PYTHONPATH 指向該目錄。
結果對應 OPEN_SOURCE_RESEARCH.md 的「已測試」欄。"""
from __future__ import annotations

import json
import time
from pathlib import Path

import pytest

import hourly_fixtures as fx
from hourly import batch as hb
from hourly.store import Store


def test_jsonschema_validates_real_batch_and_rejects_bad(tmp_path):
    jsonschema = pytest.importorskip("jsonschema")
    schema = json.loads((Path(__file__).resolve().parents[1] / "hourly/schemas/batch.schema.json").read_text(encoding="utf-8"))
    jsonschema.Draft202012Validator.check_schema(schema)
    w = fx.make_world(tmp_path)
    v = jsonschema.Draft202012Validator(schema, format_checker=jsonschema.FormatChecker())
    assert not list(v.iter_errors(w["batch"]))
    bad = json.loads(json.dumps(w["batch"]))
    bad["events"][0]["verification"] = "已查核"        # 程式不得標已查核
    bad["base_main_commit"] = "main"                   # 非 40 hex
    bad["new_exclusions"] = [{"ref": "https://facebook.com/x"}]   # 原始 URL
    errs = {e.json_path for e in v.iter_errors(bad)}
    assert any("verification" in e for e in errs) and any("base_main_commit" in e for e in errs) and any("new_exclusions" in e for e in errs)


MINGUO_OK = {"民國115年3月20日": "2026-03-20", "中華民國115年3月20日": "2026-03-20", "115年3月20日": "2026-03-20",
             "115/03/20": "2026-03-20", "115.03.20": "2026-03-20", "115-03-20": "2026-03-20", "民國 115 年 11 月 13 日 08:30": "2026-11-13",
             "民國101年5月25日 08:36": "2012-05-25"}


def test_dateparser_minguo_findings():
    dp = pytest.importorskip("dateparser")
    from dateparser.calendars.minguo import MinguoCalendar
    # 發現 1：一般 parse() 不認民國（回 None），必須直接用 MinguoCalendar
    for s in ("民國115年3月20日", "115/03/20", "1150320"):
        assert dp.parse(s, languages=["zh"]) is None
    for s, want in MINGUO_OK.items():
        assert str(MinguoCalendar(s).get_date().date_obj.date()) == want
    # 發現 2：MinguoCalendar 對不完整輸入會「補成今天」→ 必須先用 regex 要求年月日齊全
    assert MinguoCalendar("民國115年").get_date().date_obj is not None
    # 發現 3：連續數字、含雜訊字串、不存在日期 → get_date() 回 None 或 date_obj 為 None（呼叫端必須檢查，不可直接 .date()）
    for s in ("1150320", "115年第3次臨時會(115.03.20)", "民國115年2月30日", "民國0年1月1日"):
        r = MinguoCalendar(s).get_date()
        assert r is None or r.date_obj is None
    # 發現 4：相對時間需要 zh-Hant（zh 不認「3小時前」）；不得寫成絕對發表日
    assert dp.parse("3小時前", languages=["zh"]) is None and dp.parse("3小時前", languages=["zh-Hant"]) is not None
    # 西元仍正常
    assert dp.parse("2026年11月13日", languages=["zh"]).date().isoformat() == "2026-11-13"


def test_tenacity_retries_only_idempotent_failures_and_stays_polite():
    tn = pytest.importorskip("tenacity")
    calls = {"n": 0}
    sleeps = []

    class Transient(Exception):
        pass

    @tn.retry(retry=tn.retry_if_exception_type(Transient), stop=tn.stop_after_attempt(4),
              wait=tn.wait_exponential(multiplier=0.01, max=0.05), sleep=lambda s: sleeps.append(s), reraise=True)
    def flaky():
        calls["n"] += 1
        if calls["n"] < 3:
            raise Transient()
        return "ok"
    assert flaky() == "ok" and calls["n"] == 3 and len(sleeps) == 2 and all(s > 0 for s in sleeps)
    calls["n"] = 0

    @tn.retry(retry=tn.retry_if_exception_type(Transient), stop=tn.stop_after_attempt(2), sleep=lambda s: None, reraise=True)
    def always():
        calls["n"] += 1
        raise Transient()
    with pytest.raises(Transient):
        always()
    assert calls["n"] == 2          # 有上限；robots 不通過這類非暫時性錯誤不應重試（呼叫端用 retry_if_exception_type 限縮）

    class Robots(Exception):
        pass

    @tn.retry(retry=tn.retry_if_exception_type(Transient), stop=tn.stop_after_attempt(5), sleep=lambda s: None, reraise=True)
    def blocked():
        calls["n"] += 1
        raise Robots()
    calls["n"] = 0
    with pytest.raises(Robots):
        blocked()
    assert calls["n"] == 1          # 平台限制／robots 不重試、不繞過
