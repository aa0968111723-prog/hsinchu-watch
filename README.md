# 地方治理與新竹選情觀察

[正式站](https://hsinchu-watch.pages.dev/) · [建置與驗證](https://github.com/aa0968111723-prog/hsinchu-watch/actions)

公開報導、政績政見、民調與匿名留言的資料網站。介面採用紙色、宋體標題與有共同刻度的 3D 數據圖，支援手機、鍵盤操作及數字表。

目前同步 9,164 筆人物資料和 7,205 個公開來源索引。資料庫包含保留供查閱的待核對資料，聲量統計會排除 `counts_in_stats=false` 或待審項目。各人物可能收錄同一篇原文；件數與報導語氣皆不代表支持度。民調數字只顯示逐筆核對原文的資料。

## 地方治理追蹤（首批試行）

[地方治理觀察](https://hsinchu-watch.pages.dev/governance.html) 以台北、新北、新竹縣市四案作為起點，提供篩選、搜尋、本機關注、證據時間軸與 CSV 匯出。工程數字、驗收、經費與成果分別記錄，未知值不當成零。來源查閱日為 2026-11-12，目前人工整理，尚未自動更新，也未涵蓋各地所有政策。

詳見 [資料結構與擴充方向](docs/governance-roadmap.md)。原有選舉資料與功能持續保留。

## 候選人多面向閱讀

[比較頁](https://hsinchu-watch.pages.dev/compare.html#candidateReview) 按選委會正式號次完整列入目前兩個選區的六名候選人。共用政策與取捨、施政與成效、預算與可行性、質疑與監督、回應與佐證五個面向，提供共同篩選及原文連結。結構化資料不足會保留缺口，不以聲量或爭議條數評定優劣，也不強求正負面各半。

自動語氣圖預設收合。「報導未載回應」與「當事人未回應」清楚區分。既有摘要尚未全部在本輪重新查證；名單核對及選材限制詳見 [候選人閱讀標準](docs/candidate-review-standard.md)。目前還不是全台候選人資料庫。

## 本機執行

需要 Node.js 22、Python 3.12。

```sh
npm ci
pip install -r requirements.txt
npm run build
npm run preview
```

`npm run build` 會建置八個主要頁面，再合併政績、議題地圖、指標對照及原有參照頁，輸出全部 18 個 HTML 入口至 `dist/`。發布前會核對資料雜湊、人物分片、資料量基準和新版 UI。請使用這個完整建置指令產生發布檔。

## 驗證

```sh
python tools/audit_publication.py
npm run test:release
npx playwright install chromium
npm run test:browser
```

瀏覽器驗收會檢查 16 條路徑、320–1280 像素版面、實際照片、圖表與數字表一致性、回到頁首、鍵盤焦點、減少動態效果與民調封關。

## 程式與資料

| 位置 | 內容 |
| --- | --- |
| `src/`、根目錄 HTML | 八個主要頁面的可編輯原始碼 |
| `public/editorial-depth.css` | 全站共用的版面與立體層次 |
| `public/page-tools.js` | 長頁面的回到頁首操作 |
| `public/data/`、`public/observations/` | 正式站完整公開快照與匿名選錄 |
| `public/reference/`、其餘 HTML 與 assets | 保留原有功能的參照頁與資產 |
| `tools/release/` | 組裝、資料恢復、發布檢查與驗收 |
| `tools/enhancements/maps-page/` | 手機議題地圖原始碼 |
| `collectors/`、`scripts/` | 蒐集與整理程式；連線來源依設定與平台可用性執行 |

GitHub Actions 工作流程設定為在推送及 PR 時建置、驗證並保存完整發布檔與截圖。正式站目前沿用已驗證的發布流程；本工作流程只做建置驗證，不會以未核對的資料自動覆寫正式站。資料快照時間與介面更新時間分開記錄。

公開資料與帶雜湊的既有資產會保留原始位元組，避免 Windows 與 Linux 換行轉換破壞校驗。更新資料時，請先透過 `tools/release/recover_public_data.py` 合併公開快照並保留較新的修正，再執行完整建置。

## 來源與照片

每筆內容保留公開來源連結。人物照片的來源與授權列於 `public/data/candidate_photos.json`，並在人物頁標示；其餘圖片保留原有來源資料。匿名留言省略帳號，只保留短摘錄、時間與原文連結。

目前 GitHub 帳號 billing lock 導致雲端工作尚未開始；本機驗證與正式站發布可正常執行。解除帳號限制後才可驗證雲端工作流程實際通過。

## 每 30 分鐘新竹新聞蒐集（自動化）

已加入 [新聞監測器與使用限制](docs/news-watch/README.md) 及 [排程工作流程](.github/workflows/hsinchu-news-30min.yml)。排程在 UTC 11、41 分（台灣同為每小時 11、41 分）搜尋新竹縣市相關近七日新聞，每次選取最多 20 篇，儲存來源、刊登時間與尚待查核資訊至 public/data/news-monitor/。只有新聞索引發生變動時才產生資料提交；待審新聞不會覆寫正式治理或民調欄位。**須確認 GitHub Actions 已解除帳務限制且排程可執行；新資料尚未接入正式站 UI。**
