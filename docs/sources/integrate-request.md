# 給第四線的整合需求

本線沒有改 workflow、Worker 或 D1，也沒有部署 https://hsinchu-watch.pages.dev/ 。

請在整合時：

1. 保留既有 `public/data` 與 `public/observations`，不要用舊快照覆蓋。
2. 讀 `public/data/civic/feed.json`。`etag` 與 `content_hash` 對應 `records.json` 的內容；`last_success_at` 是搜集成功時間，不是 UI 更新時間。
3. `status` 為 `failed` 或 `partial` 時，顯示失敗與過期，不要把舊紀錄標成最新查核。
4. `watch.sqlite` 是查詢副本。網站若仍讀 JSON，以 civic JSON 與既有 JSON 為準，再決定是否改讀資料庫。
5. 正式站發布、GitHub 與網域更新由第四線做。本機工作排程啟用不等於已經發布。

分支：`cursor/20261113-data`。工作區：`D:/Dev/workspaces/hsinchu-cursor-20261113/02-data`。
