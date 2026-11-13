# 政策與工程地圖（atlas）

`atlas.html` 把治理案卷畫在真實的行政界線上。圖釘只放在有可核對座標的位置；
沒有座標的案卷列在「待定位」清單。分支 `cursor/20261113-map`。

其他文件：

- [資料來源、授權與每一案的位置證據](DATA-SOURCES.md)
- [給第四線的整合介面](INTEGRATION.md)
- [驗收紀錄與截圖](VERIFICATION.md)
- [要不要用 WebGL 的評估](WEBGL-EVALUATION.md)
- [待辦](BACKLOG.md)

## 頁面能做什麼

- 兩種視角，地面座標相同：**平面**是正北朝上的真實比例地圖，附比例尺；**立體示意**把同一塊地畫成放在底座上的模型，底座、尺規、指北盤是插畫，頁面上有文字標示。
- 縮放、平移、重設：滑鼠拖曳、Ctrl＋滾輪、點兩下、按鈕；觸控單指拖曳、雙指縮放；鍵盤方向鍵、`+`、`-`、`0`。
- 總覽 → 單一地區：點行政區或用地區選單進入，Esc 或麵包屑回總覽。
- 依地區、議題、政策階段、關鍵字與收藏篩選；地圖、列表與時間軸一起更新。
- 點圖釘或列表開來源卡：位置原文、座標依據與交叉核對、七個階段各自的紀錄、機關公布進度、核定／決標／實支的共同刻度圖、紀錄時間、機關與人物關係、還缺的證據、引用來源。
- 時間軸照來源的日期精度畫，機關目標用空心標記。
- 收藏與「地方治理」頁共用（`localStorage` 的 `governance-watch-v1`）。
- 分享：網址帶著場景、視角、選取的案卷、篩選與地圖中心和縮放。
- 匯出目前清單 CSV（含位置精度、座標、座標依據；待定位列沒有座標）。
- 手機用底部面板看來源卡，桌面用側欄。

## 檔案

| 路徑 | 內容 |
| --- | --- |
| `atlas.html` | 頁面骨架、圖例、閱讀方式、來源與授權、無 JavaScript 時的靜態圖 |
| `src/atlas/main.js` | 啟動、狀態、事件 |
| `src/atlas/model.js` | 讀檔、檢視模型、篩選、時間軸、匯出（不碰 DOM） |
| `src/atlas/state.js` | 網址狀態與收藏 |
| `src/atlas/camera.js` | 圖框、投影、縮放平移的數學 |
| `src/atlas/geo.js` | 距離、面積、點在多邊形內、裁切 |
| `src/atlas/scene.js` | 總覽與地區場景（SVG 字串；平面與立體） |
| `src/atlas/view.js` | 互動層：指標、鍵盤、圖釘按鈕、地名避讓 |
| `src/atlas/ui.js` | 列表、來源卡、時間軸等 HTML 片段 |
| `src/atlas/pins.js`、`scene.css`、`atlas.css` | 圖釘圖樣與樣式 |
| `src/atlas/kit/` | anatomy 繪圖工具組的核心（MIT，授權檔在同資料夾） |
| `src/atlas/build/` | 圖資建置腳本與查核紀錄 |
| `public/data/geo/` | 界線、案卷位置、階段對照、現地圖資、圖資清單 |
| `public/img/atlas/` | 靜態總覽圖（載入失敗與無 JavaScript 時使用） |
| `tests/map/` | 單元、資料與瀏覽器驗收 |

## 開發與測試

```powershell
npm ci

# 開發伺服器（這份設定不監看建置產物，避免擋住 npm run build）
node node_modules/vite/bin/vite.js --config tests/map/vite.atlas.config.mjs --port 5183 --strictPort --host 127.0.0.1
# 開 http://127.0.0.1:5183/atlas.html

# 單元與資料測試
node --test "tests/map/*.test.mjs"

# 瀏覽器驗收（對開發伺服器）
node tests/map/verify-atlas.mjs http://127.0.0.1:5183 artifacts/screens

# 打包後再驗一次（自己起靜態伺服器）
node tests/map/run-bundle-check.mjs artifacts/screens
```

Playwright 需要 Chromium：`npx playwright install chromium`。在 Cursor 的沙箱終端機裡，
瀏覽器快取路徑被改掉，要先設 `$env:PLAYWRIGHT_BROWSERS_PATH="$env:LOCALAPPDATA\ms-playwright"`。

Windows 上如果同時開著預設設定的 `vite` 開發伺服器，`npm run build` 最後把暫存資料夾改名成
`dist` 時會 `EPERM`。先關掉開發伺服器，或改用上面那份不監看建置產物的設定。

## 重建圖資

圖資是人工查核後建置的，不是排程。案卷或來源有變動時才重跑：

```powershell
node src/atlas/build/build-boundaries.mjs     # 行政界線（需要網路與 npx mapshaper）
node src/atlas/build/fetch-osm.mjs            # 現地原始資料，各範圍只讀一次並快取
node src/atlas/build/build-site-context.mjs   # 現地圖資
node src/atlas/build/build-locations.mjs      # 案卷位置（交叉核對不過會失敗）
node src/atlas/build/render-static.mjs        # 靜態總覽圖
```

新增一個可定位的案卷：先在 `src/atlas/build/location-evidence.json` 寫下位置原文、
座標怎麼來、查閱日與限制，再跑 `build-locations.mjs`。找不到可核對的座標就照
`hsinchu-city-xiangshan-four` 的寫法留在待定位，不要填行政區中心。階段對照在
`public/data/geo/project-stages.json`，每一格都要有原文與來源。

## 已知限制

- 只有治理首批四案，不是各地完整工程清單。
- 位置與階段對照是 2026-11-13 人工查核的，不會自動更新；治理案卷的查閱日比它新時，頁面會提示尚未重新核對。
- 行政界線簡化到約 40 公尺，不能當界址依據。
- 現地圖資（`public/data/geo/sites/`）已經建好並通過資料測試，但頁面還沒有現地沙盤這一層，見 BACKLOG。
