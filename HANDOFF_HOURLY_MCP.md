# HANDOFF — hourly 不可變批次／發布守衛／兩個 MCP（交第四線）

狀態：**已交第四線，尚待整合發布**。本分支沒有任何部署程式；guard 未啟用於任何管線。
（主樹的 HANDOFF.md 有他人未提交修改，故本檔獨立，避免混入。規格檔 `GROK-HOURLY-MCP-DESKTOP.md` **未讀取**〔無法讀取〕，依任務文字與 SITE_MCP_SPEC.md 實作。）

分支：`hourly-mcp-20261113`（origin/aa0968111723-prog/hsinchu-watch）。基準 main：`ea7ffc0`，已 merge `799bf8b`（origin/main 撰寫時）。收集器分支 `collect-latest-20261113-0851` = 9fd437d。

## 里程碑
| # | 內容 | commit | 真實測試輸出 |
|---|------|--------|--------------|
| 1 | hourly 草稿：store／batch／classify／MCP（政治資料）／guard | 8ff20ba | — |
| 2 | P0/P1 修補（url_ref、純讀 pull＋ack_token、committed-seq HEAD、artifact_dir 守衛、共享 ledger 衝突檢查）＋57 測試 | b2d08da | 57 passed |
| 3 | 網站 MCP v2（15 工具）、Streamable HTTP、site_view、23 測試 | 49103be | 80 passed |
| 4 | OSS 研究、缺陷清單、Gemini／託管文件、batch JSON schema、dateparser／jsonschema／tenacity／SDK 驗證 | 25c11cd | 80 passed, 4 skipped（無選用套件）；86 passed（有選用套件） |
| 5 | merge origin/main 799bf8b ＋ 本檔 | 見 `git log` 最新 | 同上（merge 後重跑：80 passed／4 skipped；86 passed） |

## 重跑
```bash
cd /workspace/hw-push
/workspace/hsinchu-watch/.venv/bin/python -m pytest tests/test_hourly_guard.py tests/test_hourly_store.py tests/test_hourly_site_mcp.py tests/test_hourly_oss_validation.py tests/test_hourly_sdk_interop.py -q --basetemp=/dev/shm/hw_pt -p no:cacheprovider
```
（箱子 `/` inode 已滿，basetemp 請用 /dev/shm。選用套件測試需要 dateparser／jsonschema／tenacity／mcp，缺席時自動 skip。）

## 怎麼跑
- 政治資料 MCP（5 條線，stdio）：`python -m hourly.mcp_political --store hourly_store`；工具：hw_status、hw_source_health、hw_pull_events（純讀）、hw_ack（需 ack_token）、hw_report_failure、hw_checkpoint、hw_get_item、hw_list_versions、hw_get_snapshot、hw_list_corrections、hw_list_exclusions。
- 網站 MCP（唯讀，stdio 或 Streamable HTTP loopback）：見 `docs/hourly/GEMINI_MCP.md`；託管選項見 `docs/hourly/SITE_MCP_HOSTING.md`（未託管）。
- 每小時 ingest／dry-run：`python -m hourly ingest|status|plan|artifact`（沒有 publish／deploy 子命令）。

## 下一步（第四線）
1. 在**授權**下審視 `hourly/publish_guard.py`，決定如何注入真實 deployer；啟用前需把 base 對齊最新 origin/main 重新 ingest（guard 要求嚴格相等）。
2. 決定是否採用 jsonschema（CI）、tenacity、dateparser 封裝（見 OPEN_SOURCE_RESEARCH.md；目前皆未整合）。
3. 補完 DEFECT_BACKLOG.md 的產生端缺口（D-03、D-06、D-07、D-08）。
4. 決定網站 MCP 是否對外託管（使用者決策）。
5. 20 分鐘蒐集 routine 目前暫停；資料已約 26 小時前（`stale=true`）。是否恢復由使用者決定——hourly 批次需要新資料才有增量。

## 已知缺口
未用真實 Gemini CLI 實機測試；MCP Python SDK 2.x 未測；guard 的真實 deployer／verify_live 只以假環境測；/tmp 暫存刪除（D-10）屬偏離規則，已揭露。
