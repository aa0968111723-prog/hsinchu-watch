# 給第四線的接線說明

本線只改自己的範圍：`public/bright-civic.css`、`src/civic-ui/`、`ui-lab.html`、`docs/design/`、`index.html`、`vite.config.js`（多一個 `ui-lab` 入口）。沒有改爬蟲、政治資料、地圖座標或 `tools/release/`。

## 已接到首頁

`index.html` 在 `#delayWarn` 之前放入 `#civicHome`。它保留 `id="pulseView"`、`#latestTop` 仍在 `.pulse` 之前。發布組裝會把這個首頁蓋上正式輸出，所以合併本分支後首頁就有閱讀檯。

樣式檔在 `public/bright-civic.css`，組裝時隨 `public/` 複製，網址是 `/bright-civic.css`。

## 其餘頁面

每頁 `<head>` 最後加：

```html
<link rel="stylesheet" href="/bright-civic.css" />
```

`<body>` 加上 `civic-bright`。這層只改紙色、按鈕唇邊與量條，不改資料與版面結構。`verify-mobile.mjs` 鎖定 `.top` 背景為 `rgb(252, 249, 242)`，這層沒有改那個背景。

不要把夜讀（`data-civic-theme="dark"`）開到舊頁。舊面板還沒有暗色 tokens，夜讀開關只放在 `ui-lab.html`。

手機上主選單改成兩列三格，定義在 `src/mobile.css`，並由 `public/editorial-depth.css` 在最後覆寫字級與間距。第二層 `.civic-nav` 在 720px 以下改成橫向滑動，讀數移到量紙檯圖的下方。已有這層選單時，首頁三張入口卡會收起來，避免同一條路出現兩次。

## 預覽頁還沒有進正式輸出

`vite.config.js` 已把 `ui-lab.html` 加進建置入口，產物在 `.build-ui/ui-lab.html`。`tools/release/assemble-production.py` 只覆蓋既有核心頁，不會把這一頁抄進 `dist/`。請在組裝時把建置後的 `ui-lab.html` 放進輸出，並讓它走與其他頁相同的 `edit_page`。這一頁已有 `header.top`、`nav.nav` 與 `main`。

預覽頁標了 `noindex`。它使用與正式頁相同的公開 JSON。

## 地圖側欄

`src/civic-ui/sidebar.js` 的 `mountSidebar(host, { items, registry })`。項目形狀沿用 CONTRACTS.md 的 Geography：`geometry`、`location_precision`、`coordinate_source`。沒有座標來源的項目進「待定位」，元件不會補縣市中心。

地圖選到圖徵時呼叫回傳的 `select(id)`。讀者點側欄時，host 冒出 `civic:place-select`，`detail` 是 `{ id, item, located }`。目前四件治理案卷都沒有座標，所以可標示清單是空的。座標由地圖線提供，本線不寫。

## 筆數

`src/civic-ui/archive-summary.mjs` 是 2026-11-13 從公開檔算出的，合計 18,422 筆。資料更新後在本線執行：

```powershell
node src/civic-ui/build-summary.mjs
node src/civic-ui/build-summary.mjs --check
```

`--check` 退出碼 1 代表首頁筆數落後於檔案。首頁會比對 `manifest.json` 的檔案雜湊，落後時顯示「筆數是前一版統計」，不把舊數字當成最新。

## 本線驗收

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$env:LOCALAPPDATA\ms-playwright"
node --test src/civic-ui/model.test.mjs
node src/civic-ui/checks/verify-lab.mjs
```

第二支會自己建置預覽並檢查 320、390、430、768、1280。Cursor 內建終端若把 `PLAYWRIGHT_BROWSERS_PATH` 指到沙箱快取，要先改回上面的路徑。截圖在 `docs/design/evidence/`。

全站守門仍用 `npm run build` 與 `npm run test:browser`。本線不執行正式站發布。
