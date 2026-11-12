# 資料庫

`python scripts/civic/build_database.py` 會刪除並重建 `public/data/civic/watch.sqlite`。它只讀既有 JSON 與 civic 輸出，不寫回那些 JSON。

文章、來源索引、政策、民調、討論串、留言、待審新聞、治理案卷與新的 civic 紀錄分表。`articles.tone_label` 是既有語氣標記，不能加總。`issue_stances.has_statement` 用 `present` / `absent`；`absent` 表示這份檔案沒有找到公開表態，不是零表現。

留言表沒有來源 commentId。候選人表只來自 `candidate-review.json`。

重建後若又跑了搜集，要再執行一次 `build_database.py`，資料庫才會跟上新的 civic JSON。
