# 網站 MCP 對外託管選項（僅供決策；本分支**沒有**託管、沒有部署程式）

現況：`hourly.mcp_http` 只綁 loopback，是給本機／同機代理用的。要讓遠端 Gemini 代理長期連線，需要使用者決定託管方式。以下為選項，皆**未實作、未測試**，也都不應由程式自行啟用。

| 選項 | 概要 | 優點 | 風險／待決 |
|------|------|------|-----------|
| A. 維持本機（stdio／127.0.0.1） | 代理與資料在同一台機器 | 零外露、零成本 | 無法給遠端代理用 |
| B. Cloudflare Pages Function／Worker（唯讀） | 用 JS 重寫 15 個工具，只讀已發布的 `/data/*.json`（同源靜態檔） | 與站台同處，資料已是公開的；不含 excluded／pending（因為本來就沒發布） | 要把工具契約移植成 JS 並另做一套測試；token 存為 Worker secret（不可進 repo）；速率限制需用平台機制；這是**部署**，須使用者與第四線明確授權；「不得覆蓋較新部署」的守衛要涵蓋它 |
| C. 自架小機器＋反向代理 | 跑 `hourly.mcp_http`＋TLS 代理 | 重用現有 Python 程式與測試 | 要有主機、TLS、監控；本程式拒絕非 loopback 綁定，需由代理轉入；要重新審視 Host／Origin 設定 |
| D. 不託管，改發布 `data/*.json` 並讓代理自己讀 | 代理用 HTTP GET 讀公開 JSON | 最簡單 | 沒有工具契約、分頁、BLACKOUT 封裝（需代理自行遵守） |

共同原則：只服務**已發布**資料；待審與 excluded 絕不經過站台／Gemini MCP（待審只走內部的 agent-import MCP，標示 待審）；BLACKOUT 期間民調一律回 `BLACKOUT`；token 只用環境變數／平台 secret；預設關 CORS。
