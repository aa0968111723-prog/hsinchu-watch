# 驗收紀錄｜政策與工程地圖

分支 `cursor/20261113-map`。本檔只記實際跑過的命令與結果，沒有跑過的不寫成通過。

## 1. 資料

| 案卷 | 精度 | geometry | 證據摘要 |
| --- | --- | --- | --- |
| `taipei-peiying-housing` | site | Point | 機關官方地圖標記 121.548438,25.079967；落在中山區；距 OSM 施工範圍邊緣 5.2 m |
| `new-taipei-siyuan-footbridge` | street | Point | 新北大道×思源路口號誌節點平均 121.459841,25.060478；落在新莊區 |
| `hsinchu-county-baozhong-road` | street | LineString | 義民路口至文山路口，線長 1,375 m／原文 1,360 m（差 1.1%）；落在新埔鎮 |
| `hsinchu-city-xiangshan-four` | unknown | null | 僅有地號，列待定位；不填行政區中心 |

授權與雜湊見 [DATA-SOURCES.md](DATA-SOURCES.md) 與 `public/data/geo/manifest.json`。

建置核對（交叉核對不過會失敗）：

```text
node src/atlas/build/build-locations.mjs   → exit 0
```

## 2. 單元與資料測試

```text
node --test "tests/map/*.test.mjs"
# tests 36
# pass 36
# fail 0
```

涵蓋投影／視角數學、網址狀態、篩選與時間軸模型、美術庫選取規則、GeoJSON schema、座標落在行政區、manifest 雜湊與授權欄位。

## 3. 瀏覽器驗收

腳本：`tests/map/verify-atlas.mjs`（Playwright Chromium）。對開發伺服器與打包後靜態伺服器各跑一次；打包路徑用 `tests/map/run-bundle-check.mjs`（自己起伺服器，並送正式站 CSP：`script-src 'self'`）。

涵蓋：

- 寬度 320／390／430／768／1280：三個圖釘、四案列表、一筆待定位、行政區 ≥57、觸控目標 ≥44×44、無水平溢出
- 平面與立體示意切換；立體有底座／尺規與「立體示意視角」文字
- 滑鼠縮放／平移／重設；Ctrl＋滾輪；鍵盤方向鍵、`+`／`-`／`0`、Tab／Enter／Esc
- 列表與圖釘同步、來源卡七階段與經費刻度、時間軸、篩選、收藏、分享網址、CSV 匯出
- 手機寬度底部詳情面板；桌面側欄
- `prefers-reduced-motion: reduce` 時動畫停用
- WebGL 被關掉時仍可操作（本頁本來就不用 WebGL）
- 資料載入失敗：governance、locations、stages、boundaries 分項與組合；失敗後仍可拖曳與重試
- 無 JavaScript：靜態總覽圖與官方來源連結可見

截圖（存於 `docs/map/screenshots/`）：

| 檔名 | 內容 |
| --- | --- |
| `atlas-320-plan.png` | 320 平面 |
| `atlas-390-plan.png`／`atlas-390-sheet.png` | 390 平面／底部面板 |
| `atlas-430-iso.png` | 430 立體示意 |
| `atlas-768-iso.png` | 768 立體示意 |
| `atlas-1280-plan.png`／`atlas-1280-iso.png`／`atlas-1280-detail.png` | 1280 平面／立體／來源卡 |
| `atlas-no-webgl.png` | 關掉 WebGL 仍可用 |
| `atlas-no-js.png` | 無 JavaScript 靜態替代 |
| `atlas-fail-governance.png`／`atlas-fail-locations.png`／`atlas-fail-boundaries.png` | 載入失敗態 |

## 4. 既有檢查（完整站台，確認本線未破壞）

2026-11-13 於本線工作區重跑，皆 exit 0：

| 命令 | 結果 |
| --- | --- |
| `python tools/audit_publication.py` | `publication_audit: passed`；articles 9164、public_file_checksums 20 |
| `npm run test:release` | 16 tests OK；archiveModel allRows 18422 |
| `npm run build` | Complete site assembled in dist/；verified_files 23 |
| `npm run test:browser` | governance／candidateReview／archive 等 passed |
| `node --test "tests/map/*.test.mjs"` | 36 pass／0 fail |
| `node tests/map/run-bundle-check.mjs artifacts/screens` | `atlas: passed`；正式站 CSP；widths 5；loadFailures 7；noWebgl／noJavaScript／reducedMotion true |

注意：`atlas.html` 尚未列入正式組裝輸入（見 [INTEGRATION.md](INTEGRATION.md)），所以 `npm run build` 的 `dist/` 目前不會產出 atlas 頁；本線用 Vite atlas 設定與 `run-bundle-check.mjs` 驗本線頁面。第四線整合後才會進完整 `dist/`。

## 5. 尚未納入首批驗收（如實列出）

- 每案現地沙盤圖層（`public/data/geo/sites/` 已建好並通過資料測試，頁面尚未疊上）
- 美術庫實景在整合後的實際顯示（本線分支沒有 `art-library.json`；選取規則有單元測試）
- 正式站部署與 GitHub Actions：屬第四線；本線只推 `cursor/20261113-map`
