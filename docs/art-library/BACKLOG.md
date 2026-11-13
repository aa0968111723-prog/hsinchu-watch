# 美術庫待辦

## 圖庫頁

- [x] `public/asset-lab.html` 與 `src/art-library/`
- [x] 搜尋，以及地區、種類、用途、授權、審核狀態五種篩選
- [x] 詳情：來源、授權、作者、原檔尺寸、取得時間、身份核對、改動、檔案與格式、色盤
- [x] 複製素材 ID、署名、嵌入碼
- [x] 篩選與開啟的素材會寫進網址，可以分享
- [x] 頁面外殼符合建置流程（`.top nav.nav`、`main`）
- [x] 不用行內腳本、不用 iframe
- [x] 索引讀不到時顯示錯誤與重試，不顯示成 0 件
- [ ] 正式導覽入口（第四線）

## 照片

- [x] 盤點既有四張肖像，逐張對上 Commons 檔案頁與授權
- [x] 邱臣遠既有照片的來源查清楚（與 Commons 原檔位元組相同）
- [x] 17 張實景：臺北市 3、新北市 4、新竹縣 4、新竹市 4、中央 2
- [x] AVIF、WebP、JPEG，實景 480／800／1280 三種寬度
- [x] 授權證據快照 `sources.lock.json`
- [ ] 朱定瑀、曾聖凱的肖像（目前是缺口）
- [x] 統一 3:4 比例的肖像組（role=card，360×480；正方形既有檔保留）
- [ ] 四個治理案卷現場的照片（已列 gaps；鄰近街景不能冒充）
- [x] 新竹縣鄉鎮實景：竹東九牧第、新埔鎮入口
- [x] 香山地區街景：香山車站前路口（非四號道路案址）
- [x] 中央機關：總統府、司法大廈（監察院暫缺）
- [ ] 其他鄉鎮／學校／醫療／水利實景

## 原創示意

- [x] 證據分類台（來源可信度）
- [x] 預算三層抽屜（核定、決標、實支；金額讀自治理案卷，沒有紀錄的那層扣住）
- [x] 階段工地模型（規劃、施工、完工、驗收、啟用分開；準備中／目標日期／百分比不點亮）
- [x] 議事台（提案、審查、決議分開；敲槌不是表決結果）
- [x] 空格銘牌架（空狀態；空格不是 0）
- [x] 插畫：疊圖校準板（`illustration-layer-board`；界線／主張／核對分開）

## 驗證

- [x] `tests/art-library/test_catalog.py`：15 項
- [x] `tests/art-library/figures.test.mjs`：含階段工地、議事台、空格銘牌架
- [x] `tests/art-library/check_lab.py`：320／390／430／768／1280，獨立預覽與建置後各跑一次
- [x] `python tools/audit_publication.py`
- [x] `npm run build`
- [x] `npm run test:release`：16 項
- [x] `npm run test:browser`：九項檢查
- [x] 在 main `ea7ffc0` 的匯出副本上套用本線檔案，`npm run build` 與瀏覽器驗收
- [x] `tests/art-library/check_live.py`：回報正式站實際送出的美術庫內容

## 交接

- [x] `docs/art-library/integration.md`
- [x] 推送 `cursor/20261113-art`，核對遠端 SHA
- [x] 第四線已發布預算抽屜。正式站 release `hsinchu-06e22ef430c3f85d`，美術庫 23 筆，含 `component-budget-drawers`，與本索引位元組相同
