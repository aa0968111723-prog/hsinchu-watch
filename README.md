# 新竹選情觀察

[正式站](https://hsinchu-watch.pages.dev/) · [建置與驗證](https://github.com/aa0968111723-prog/hsinchu-watch/actions)

公開報導、政績政見、民調與匿名留言的資料網站。介面採用紙色、宋體標題與有共同刻度的 3D 數據圖，支援手機、鍵盤操作及數字表。

目前同步 9,164 筆人物資料和 7,205 個公開來源索引。資料庫包含保留供查閱的待核對資料，聲量統計會排除 `counts_in_stats=false` 或待審項目。各人物可能收錄同一篇原文；件數與報導語氣皆不代表支持度。民調數字只顯示逐筆核對原文的資料。

## 本機執行

需要 Node.js 22、Python 3.12。

```sh
npm ci
pip install -r requirements.txt
npm run build
npm run preview
```

`npm run build` 會建置七個主要頁面，再合併政績、議題地圖、指標對照及原有參照頁，輸出全部 17 個 HTML 入口至 `dist/`。發布前會核對資料雜湊、人物分片、資料量基準和新版 UI。請使用這個完整建置指令產生發布檔。

## 驗證

```sh
python tools/audit_publication.py
npm run test:release
npx playwright install chromium
npm run test:browser
```

瀏覽器驗收會檢查 15 條路徑、320–1280 像素版面、實際照片、圖表與數字表一致性、回到頁首、鍵盤焦點、減少動態效果與民調封關。

## 程式與資料

| 位置 | 內容 |
| --- | --- |
| `src/`、根目錄 HTML | 七個主要頁面的可編輯原始碼 |
| `public/editorial-depth.css` | 全站共用的版面與立體層次 |
| `public/page-tools.js` | 長頁面的回到頁首操作 |
| `public/data/`、`public/observations/` | 正式站完整公開快照與匿名選錄 |
| `public/reference/`、其餘 HTML 與 assets | 保留原有功能的參照頁與資產 |
| `tools/release/` | 組裝、資料恢復、發布檢查與驗收 |
| `tools/enhancements/maps-page/` | 手機議題地圖原始碼 |
| `collectors/`、`scripts/` | 蒐集與整理程式；連線來源依設定與平台可用性執行 |

GitHub Actions 會在推送及 PR 時建置、驗證並保存完整發布檔與截圖。正式站目前沿用已驗證的發布流程；本工作流程只做建置驗證，不會以未核對的資料自動覆寫正式站。資料快照時間與介面更新時間分開記錄。

公開資料與帶雜湊的既有資產會保留原始位元組，避免 Windows 與 Linux 換行轉換破壞校驗。更新資料時，請先透過 `tools/release/recover_public_data.py` 合併公開快照並保留較新的修正，再執行完整建置。

## 來源與照片

每筆內容保留公開來源連結。人物照片的來源與授權列於 `public/data/candidate_photos.json`，並在人物頁標示；其餘圖片保留原有來源資料。匿名留言省略帳號，只保留短摘錄、時間與原文連結。
