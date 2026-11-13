# 讓 Gemini 代理連唯讀網站 MCP（本機；未託管、未部署）

網站 MCP 只讀「已發布形狀」的資料視圖：不含 excluded、待審（pending）、蒐集端內部檔。15 個工具（唯讀，皆帶 `readOnlyHint`）：
`list_people get_person search_items get_item list_polls get_poll_trend list_policies get_policy list_sources get_source get_manifest get_release list_stances get_issue get_stats`。
每個回應都帶 `data_version{content_sha, generated_at, stale, age_minutes, stale_after=90}`；民調在 11/18–11/28（設定檔／環境變數）回 `BLACKOUT`，沒有任何 override 參數。

## 1. 建視圖（唯讀、寫到暫存，不動 data/）
```bash
python -m hourly.site_view --data-dir data --out /path/to/view --repo .
```
`--data-dir` 若不是蒐集端 `data/`（例如已發布的 `public/data`），可直接當 `--view-dir`。伺服器會拒絕指向蒐集端 `data/`、`work/`、store 內部、含 excluded／pending／review_decisions 等檔的目錄。

## 2a. stdio（最簡單，無 token、無網路）
`~/.gemini/settings.json`：
```json
{
  "mcpServers": {
    "hsinchu-watch": {
      "command": "python",
      "args": ["-m", "hourly.mcp_site", "--view-dir", "/path/to/view"],
      "cwd": "/path/to/hsinchu-watch",
      "env": { "PYTHONPATH": "/path/to/hsinchu-watch" },
      "trust": false,
      "timeout": 15000
    }
  }
}
```
（伺服器名稱不要含底線；Gemini 的工具名會是 `mcp_hsinchu-watch_<tool>`。）

## 2b. Streamable HTTP（僅 loopback 127.0.0.1；拒絕綁其他位址）
```bash
export HSINCHU_MCP_TOKEN="$(python -c 'import secrets;print(secrets.token_urlsafe(32))')"   # 只放環境變數，不要寫進任何檔案或 repo
python -m hourly.mcp_http --view-dir /path/to/view --port 8787 --require-token
```
Gemini CLI 設定（`httpUrl` = Streamable HTTP）。**不要把 token 寫進 settings.json 後 commit**；用指令加入（寫到你自己的 ~/.gemini，不在 repo 內）：
```bash
gemini mcp add --transport http --header "Authorization: Bearer $HSINCHU_MCP_TOKEN" hsinchu-watch http://127.0.0.1:8787/mcp
```
等價的 settings.json 片段（token 以你自己的方式填入，勿提交）：
```json
{ "mcpServers": { "hsinchu-watch": {
    "httpUrl": "http://127.0.0.1:8787/mcp",
    "headers": { "Authorization": "Bearer <TOKEN>" },
    "includeTools": ["search_items","list_people","list_polls","list_policies","get_stats","get_manifest"],
    "trust": false, "timeout": 15000 } } }
```
注意：Gemini 文件只明載 `env` 區塊支援 `$VAR` 展開，`headers` 是否展開未明載，因此上面用 `gemini mcp add` 或手填。

## 安全行為（已有測試）
- Bearer 常數時間比對；token 不寫 log。未帶或錯誤 → 401。`--require-token` 在未設定時拒絕啟動。
- 速率限制：預設 60 次/分、突發 20（`--rate-per-minute`、`--burst`），超過 429＋`Retry-After`。
- CORS 預設關閉：不送 `Access-Control-*`，帶 `Origin` 的請求 403，除非 `HSINCHU_MCP_ALLOWED_ORIGINS` 明列。
- Host 只收 localhost／127.0.0.1／[::1]（防 DNS rebinding）；body ≤ 64 KB；回應 ≤ 256 KiB（截斷標示）。
- `GET/DELETE /mcp` → 405（不提供 SSE）。`/healthz` 無需 token。

## 驗證
- Gemini 風格用戶端（stdlib）：`tests/test_hourly_site_mcp.py`。
- 官方 Python MCP SDK 1.30.0 當用戶端對本伺服器做 HTTP（含 bearer、無 token 被拒）與 stdio 互通：`tests/test_hourly_sdk_interop.py`（SDK 未安裝則 skip）。
- **尚未**用真正的 Gemini CLI 實機連線驗證（本箱沒有 Gemini CLI／金鑰）。
