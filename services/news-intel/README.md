# news-intel

本機可測的 Worker、D1 migration 與 MCP 權限層。正式站尚未改由這個 Worker 提供新聞。

測試：

```text
node --test services/news-intel/test/pipeline.test.js
```

部署前要先 `wrangler d1 create hsinchu-news-intel`，把 `wrangler.jsonc` 的 `database_id` 換成實際 id，並在 Worker 設定五種 Bearer token 與可選的 `GEMINI_API_KEY`。沒有金鑰時排程不呼叫 Gemini，也不會湊滿 20 篇。

Cron 是每小時整點 UTC。這不是 GitHub Actions。
