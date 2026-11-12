# 20 分鐘搜集

工作排程名稱：`HsinchuWatch-02-data-civic`。每 20 分鐘執行 `python scripts/civic/collect_civic.py`。各來源仍看自己的 `next_due_at`：新北與主計總處 60 分鐘，立法院 180 分鐘，其餘已接通來源 20 分鐘。失敗後下次時間會拉長，最長 6 小時。

登記：

```text
powershell -NoProfile -File scripts/civic/register_schedule.ps1
```

查詢結果在 `public/data/civic/schedule.json`。2026-11-13T00:45:59+08:00 的查詢是 Status Ready、Next Run Time 2026/11/13 上午 01:05:00。登入模式是 Interactive only，使用者沒有登入時這次工作不會執行。

```text
schtasks /Query /TN HsinchuWatch-02-data-civic /FO LIST
```

停用：

```text
schtasks /Delete /TN HsinchuWatch-02-data-civic /F
```

四件事分開看：

| 狀態 | 證據 |
| --- | --- |
| 排程程式已寫好 | `scripts/civic/collect_civic.py` 與 `register_schedule.ps1` |
| 作業系統排程已啟用 | `public/data/civic/schedule.json` 的 `os_task_enabled` |
| 實際抓取成功 | `feed.json` 的 `last_success_at` 與 `collector-log.jsonl` |
| 正式站已發布 | 尚未。本線不部署 |

`python scripts/civic/drill_retention.py` 會故意讓抓取失敗，用來證明舊紀錄還在。跑完要再執行一輪真實搜集。
