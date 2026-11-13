# OPEN_SOURCE_RESEARCH — 開源專案研究（hsinchu-watch hourly／MCP）

日期：2026-11-13（Asia/Taipei）。來源：AI工具研究員 `work/AI工具研究員/OSS_CANDIDATES.md`（新建議 29 項、既有 4 項、排除 6 項；授權與版本取自該檔對 PyPI／npm／GitHub 官方頁的查證，本表未重抓）＋ 本分支的小型驗證。與 `work/開源資源管理員/oss_licenses.md`（2026-11-09）去重。

## 狀態定義（四種互相獨立，不可混用）
| 狀態 | 意義 | 本表現況 |
|------|------|----------|
| 已研究 | 讀過官方來源、授權、版本、維護 | 見下方全部 |
| 已測試 | 在本機實際跑過、有可重現的測試 | **4 項**：dateparser、jsonschema、tenacity、mcp（Python SDK，僅當測試用戶端） |
| 已整合 | 已進入蒐集／發布管線或主線依賴 | **0 項**（本輪新增；既有 feedparser／bs4／lxml／requests 早已在 requirements.txt，本分支未動） |
| 已發布 | 已部署到正式站 | **0 項**（本分支禁止部署） |

計數：已研究 29（新）＋4（既有）＋6（排除）＋3（既有研究複核：httpx、trafilatura、opencc）；已測試 4；已整合 0；已發布 0。

## A. 已測試（本分支實測；重現指令在各 test 檔頭）
| 專案 | 版本／授權 | 驗證了什麼 | 結果 | 結論／剩餘缺口 |
|------|-----------|-----------|------|----------------|
| dateparser | 1.5.0／BSD-3 | 民國日期（`tests/test_hourly_oss_validation.py`） | **`dateparser.parse(..., languages=['zh'])` 對「民國115年3月20日」「115/03/20」一律回 None**；必須直接用 `dateparser.calendars.minguo.MinguoCalendar`，它能解「民國115年3月20日／中華民國115年…／115年3月20日／115/03/20／115.03.20／115-03-20／民國 115 年 11 月 13 日 08:30」。**陷阱**：「民國115年」（缺月日）會被補成今天；「1150320」「115年第3次臨時會(115.03.20)」「民國115年2月30日」回 None；相對時間要 `zh-Hant`（`zh` 不認「3小時前」），且不得寫成絕對發表日 | 可用，但**只能**包在「先用 regex 要求年月日齊全、檢查 None」的封裝後。未整合；是否取代 `collectors/article_date.py` 待第四線決定 |
| jsonschema | 4.26.0／MIT | 為 batch manifest 寫 `hourly/schemas/batch.schema.json`（draft 2020-12），驗證真實 batch，並要求拒絕：verification≠待審、base_main_commit 非 40 hex、原始 URL 的 exclusion ref | 通過；**驗證本身抓到我 schema 的 bug**（`(?i)` 旗標不在開頭，metaschema 拒收），已修 | 可用。未接進 `ingest`（保持零依賴）；若要強制，第四線決定是否把它加入 CI。不取代隱私／摘錄長度等業務規則 |
| tenacity | 9.2.1／Apache-2.0 | 對暫時性錯誤指數退避、有上限、非暫時性錯誤（如 robots 不通過）只呼叫一次 | 通過（注入假 sleep，未發任何網路請求） | 尚未接 `httputil.http_get`；接入必須保留禮貌間隔與 robots 硬閘，只重試冪等 GET |
| mcp（官方 Python SDK） | 1.30.0／MIT（PyPI 最新為 2.3.0，未測 2.x） | 以 SDK 的 `streamablehttp_client` 與 `stdio_client` 連我手寫的 stdlib 伺服器：initialize、tools/list（15 個，皆 readOnly）、tools/call、錯誤、bearer 通過／缺 token 被拒（`tests/test_hourly_sdk_interop.py`） | 3 項通過 | 互通成立。**沒有**採用 SDK 當伺服器（手寫 stdlib 零依賴）；2.x 未測；真正的 Gemini CLI 未實機測 |

備註：測試環境因 `/` inode 已滿，以 `pip install --target` 裝進 `/dev/shm`（noexec）並把原生 `.so` 套件複製到 `/workspace/hw_oss_native*`；套件**未**加入任何 requirements，測試在套件缺席時自動 skip（無套件：80 passed／4 skipped；有套件：86 passed）。

## B. 已研究（尚未測試、尚未整合）— 29 項新建議
| 類別 | 專案 | 授權 | 最新版（研究時） | 本站用途／缺口 | 主要風險 |
|------|------|------|-----------------|----------------|----------|
| MCP | @modelcontextprotocol/sdk（TS） | MIT（npm；GitHub SPDX 未斷言） | 1.32.2 | 若日後要 TS 版 Worker 型 MCP | 授權以 npm 為準；連線須使用者允許 |
| MCP | FastMCP | Apache-2.0 | 4.1.8 | Python 高階 MCP 框架 | 與官方 SDK 重疊，擇一 |
| MCP | mcp（Python SDK） | MIT | 2.3.0（測的是 1.30.0） | 見上 | 2.x API 未驗 |
| 攝取 | reader | BSD-3 | 3.27 | feed 管理＋儲存 | 自帶儲存，與 data/ JSON 流程雙寫風險 |
| 正文 | readability-lxml | Apache-2.0 | 0.9 | 正文抽取候補 | 台灣媒體版型品質未評；不得鏡像全文 |
| 正文 | inscriptis | Apache-2.0 | 2.7.6 | HTML→文字 | 導航殘留；不當全文庫 |
| 日期 | python-dateutil | BSD-3 | 4.0.0 | 已被程式可選使用 | **4.0 重大版本**（Py≥3.11、isoparse 變嚴）；我的測試環境實際裝到 4.0.0，dateparser 在其上跑通，但 `parser.parse(fuzzy)` 路徑未測 |
| 日期 | dateparser | BSD-3 | 1.5.0 | 見 A | 見 A |
| 日期 | twdate（twcal） | MIT | 1.1.0 | 民國短字串 | 年輕；README 只示範 `1150320`；未測 |
| 去重 | datasketch | MIT | 2.0.0 | 近重複分組（只影響展示） | 2.0 重大版本；閾值需本站語料調 |
| Schema | jsonschema | MIT | 4.26.0 | 見 A | — |
| Schema | pydantic | MIT | 2.14.3 | typed model | 遷移成本高，偏重 |
| Schema | Ajv | MIT | 8.20.0 | 前端／Node 驗證 | 無 Node CI |
| 重試 | tenacity | Apache-2.0 | 9.2.1 | 見 A | — |
| 重試 | stamina | MIT | 26.1.0 | 同 tenacity，二選一 | 生態較小 |
| 地圖 | Leaflet | BSD-2 | 1.9.4（2023-05） | 行政區地圖 | 穩定版已逾三年；底圖條款另核 |
| 地圖 | MapLibre GL JS | BSD-3（npm；GitHub SPDX 未斷言） | 6.18.0 | 向量地圖 | 較重；圖磚來源另核 |
| 圖表 | Chart.js | MIT | 4.6.1 | 互動圖表 | 需重做色盲標記與 aria |
| 圖表 | uPlot | MIT | 1.6.32 | 輕量時間序列 | a11y 未核 |
| 圖表 | Apache ECharts | Apache-2.0 | 6.1.0 | 複雜圖表 | 體積大 |
| 3D | three.js | MIT | 0.187.0 | 無需求 | 優先級低 |
| 圖片 | Pillow | MIT-CMU（PyPI） | 13.0.0 | 本站「只存網址」，效益有限 | 不得為用而下載圖檔 |
| 圖片 | imagesize | MIT | 2.0.1 | 預留長寬比 | 遠端探測須守 robots／禮貌間隔 |
| a11y | axe-core | **MPL-2.0** | 4.14.0 | 自動化無障礙檢查 | 須標註；非法律意見 |
| 效能 | web-vitals | Apache-2.0 | 6.2.3 | 前端指標 | 不送第三方分析 |
| 效能 | Lighthouse | Apache-2.0 | 13.6.0 | 實驗室分數 | Node≥22.19 |
| 效能 | rollup-plugin-visualizer | MIT | 7.1.3 | 打包分析 | Node≥22；HTML 勿進公開目錄 |
| 測試 | Playwright | Apache-2.0 | 1.65.x | 瀏覽器驗收 | 下載瀏覽器、磁碟需求；不可用來爬 robots 受限站 |
| 測試 | Vitest | MIT | 5.1.0 | 單元測試 | Node 版本挑 |

## C. 已研究 — 排除／避免（紅旗）
| 專案 | 理由 |
|------|------|
| zhconv | **授權衝突**：PyPI 寫 GPLv2+，GitHub／LICENSE 原檔為 MIT；2021 後無發行。釐清前不用，簡繁改 OpenCC |
| mapbox-gl（v2+） | v2.0 起為 Mapbox TOS，非 OSI 授權；改評 MapLibre |
| backoff | GitHub `archived: true`；改 tenacity／stamina |
| simhash（PyPI） | 2022-03 後停滯；改 datasketch |
| CKIP 系列 | GPL 強 copyleft，預設避開 |
| yt-dlp | 專案禁止下載影片，受平台條款約束 |

## D. 已在專案內（本分支未動）
feedparser 6.0.14（BSD-2）、beautifulsoup4 4.15.0（MIT）、lxml 6.1.3（BSD-3）、requests 2.34.2（Apache-2.0）。

## E. 既有研究複核（不當新推薦）
httpx 0.28.1（BSD-3）、trafilatura 2.3.1（Apache-2.0，仍建議）、OpenCC 1.4.2（Apache-2.0）；newspaper4k／jieba／scrapy／protego／w3lib／hanlp／nltk 等以 oss_licenses.md 為準。

## F. 仍未知／待驗證
1. 各專案「最後 commit 日期」未取（只有 GitHub pushed_at）。2. python-dateutil 4.0 對 `parser.parse(fuzzy=True)` 的相容性未測。3. twdate 長格式、Leaflet 2.x、httpx 後續版本未查。4. axe-core MPL-2.0 與本庫未定的 LICENSE 是否相容，待授權決策。5. CI 目前無 Node，Lighthouse／Vitest 的版本需另定。6. 真正 Gemini CLI 對本 MCP 的實機互通未測。7. MCP Python SDK 2.x 未測。
