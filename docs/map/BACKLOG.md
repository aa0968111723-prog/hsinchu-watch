# 03-map BACKLOG｜真實政策政績視覺地圖

分支 `cursor/20261113-map`，基準 `e8366f2`。勾選代表「已實作且有實際執行的驗證」，
不是「已規劃」。每項後面的證據寫在 `docs/map/VERIFICATION.md` 與共用檢查點。

## M0 基線

- [x] 讀 AGENTS.md、CURSOR_TASK.md、CURSOR_SESSION.json、TEAM.md、CONTRACTS.md、anatomy 技能（SKILL、kit、craft）
- [x] 確認分支、base commit、檔案責任；devbridge 登錄本工作區並完成 `npm ci`
- [x] BACKLOG、共用檢查點、交接檔第一版

## M1 可追溯資料

- [x] 行政界線：內政部國土測繪中心縣市／鄉鎮市區界線 → GeoJSON（台北、新北、新竹縣、新竹市＋全台縣市底圖），manifest 含來源、授權、下載時間、sha256、處理步驟
- [x] 四個治理案卷的位置證據逐案查核（原文、座標來源、查閱日、依據、精度）
- [x] `public/data/geo/project-locations.json`（契約 Geography；無證據者 geometry=null 進待定位）
- [x] `public/data/geo/project-stages.json`（規劃／核定／施工／完工／驗收／啟用／成效 七階段逐項證據）
- [x] 現地脈絡圖資（道路、水系、公園、建物、軌道；OpenStreetMap ODbL，逐檔標示）
- [x] 資料驗證：schema、座標落在所屬行政區、精度與來源必填、未知為 null

## M2 第一個完整切片（Figure 級、單一地區）

- [x] `atlas.html` + `src/atlas/` 架構（資料模型、投影、場景、互動）
- [x] 單一地區等距沙盤（anatomy kit）＋平面真實層；縮放／平移／重設
- [x] 圖釘、來源卡、列表與地圖同步、鍵盤選取
- [x] 手機底部詳情面板／桌面側欄
- [x] 載入失敗與無 JavaScript 的可用替代

## M3 擴展

- [x] 四地區總覽；地區、議題、政策階段篩選
- [x] 時間軸（日期精度分開呈現）
- [x] 收藏（與治理頁共用關注清單）與分享位置（網址狀態）
- [ ] 每案現地沙盤（真實現地圖資＋示意模型，明確標示）— 圖資已建，頁面尚未疊層
- [x] 待定位清單與資料缺口顯示（部分載入不標為完整）
- [x] 沙盤配件：真實比例尺、指北、階段釘板、待定位托盤（總覽／地區立體示意）
- [x] 經費共同刻度圖（核定／決標／實支分開，未知不畫成 0）
- [x] 美術庫素材依 ID 選用的接口（05-art 索引存在時；本線無索引檔，選取規則有單元測試）

## M4 驗收與交接

- [x] `tests/map/` 單元（投影、模型、網址狀態）、資料（schema／地理）測試
- [x] 瀏覽器驗收：320／390／768／1024／1440 五種寬度、觸控、鍵盤、reduced-motion、無 WebGL、資料載入失敗（實測寬度為 320／390／430／768／1280）
- [x] 截圖存 `docs/map/screenshots/`
- [x] `docs/map/`：使用方式、資料來源與授權、整合介面、WebGL 評估
- [x] 既有檢查未被破壞：`python tools/audit_publication.py`、`npm run test:release`、`npm run build`、`npm run test:browser`（2026-11-13 重跑皆 exit 0）
- [ ] 提交分支、更新檢查點與交接、通知第四線

## 之後（不在首批驗收內，列出避免假裝完成）

- 其他新北在建工程、台北水利處官方地圖其餘標記：需先由資料線建立案卷並逐筆核對，才會進地圖
- 定期刷新：位置層只在案卷或來源變動時重算；排程屬資料線與整合線
- 每案現地沙盤圖層疊加（sites GeoJSON 已就緒）
