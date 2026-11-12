# 新竹新聞 30 分鐘蒐集器

- GitHub Actions：每日全時段每 30 分鐘檢查一次（UTC 分鐘 11、41；台灣亦為 11、41 分）。可從 Actions 手動執行。
- 主題：新竹縣市地方治理、議會、建設交通、教育、經濟科技、民生環境、選舉民調。
- 每次選取近 7 日刊登時間最新、地名相關的**至多 20 篇**。不足 20 篇時按實際筆數呈現，不補假資料；不承諾每半小時都有 20 篇新文章。
- 來源：8 組 Google 新聞 RSS 搜尋；RSS 刊登時間與來源未逐筆核對，不保證涵蓋所有媒體或官方公告。
- 產出：public/data/news-monitor/latest.json（最新 20 篇）、public/data/news-monitor/history.json（最多 1,200 篇近七日索引）、docs/news-watch/latest.md（可直接在 GitHub 閱讀）。
- 只保留標題、連結、新聞來源、日期、地區、議題與查核提示；不複製全文。
- 每次都執行搜尋，但只有清單或歷史索引變更才提交 Git commit。失敗保留舊資料，並將失敗來源寫入 Actions 日誌。
- 所有內容標示為未核實。**不自動覆寫**既有 governance.json、governance-registry.json、人物或民調正式資料，避免把新聞報導當成治理成效或原始證據。
- 完整資料頁 `/archive.html` 已整合 `manual.json` 的20筆人工待審索引。`history.json` 若納入正式發布快照，也會讀入為待複核資料；僅有 GitHub 提交不代表正式站已發布。首頁與候選人頁提供完整資料入口。查核流程仍需逐筆完成。

## 使用

安裝 Python 3.12；不需要額外套件，執行：

    python -m unittest discover -s tests -p 'test_collect_hsinchu_news.py' -v
    python scripts/collect_hsinchu_news.py

網站既有 public/data/governance-registry.json 已列出新竹縣市政府公告與議會參照。這些來源目前是人工核對的索引，不代表每半小時會自動驗證官方資料。若需要官方最新工程進度、預算或民調原文，應另行增加具授權與格式驗證的資料擷取器，經人工審核後再納入正式資料。

## 運行限制

如果 GitHub Actions 因 billing lock、工作流程停用、權限或分支保護無法運行／寫回，此排程不會真正更新資料。請進入 GitHub 儲存庫 Actions 頁檢查最近執行紀錄；排程檔存在不等於已成功執行。

GitHub 排程可能延後或略過，不保證準點。若推送受保護分支失敗，應改成建立 PR 待審，不應強制推送或取消保護。
