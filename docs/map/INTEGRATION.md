# 給第四線的整合介面

本線只動 `atlas.html`、`src/atlas/`、`public/data/geo/`、`public/img/atlas/`、`docs/map/`、`tests/map/`。
沒有改 `maps.html`、`tools/enhancements/maps-page/`、`vite.config.js`、`package.json` 或發布工具。
下面是把地圖接進完整建置需要做的事，都在第四線的檔案裡。

## 1. 建置

1. `vite.config.js` 的 `rollupOptions.input` 加一行：

   ```js
   atlas: resolve(__dirname, 'atlas.html'),
   ```

2. `tools/release/assemble-production.py`：
   - 從 editorial 複製頁面的地方加 `atlas.html`（寫法同 `civic.html`）：

     ```python
     if (editorial / "atlas.html").exists():
         shutil.copyfile(editorial / "atlas.html", output / "atlas.html")
     ```

   - `edit_page` 裡 `if route in ("governance", "archive"):` 加上 `"atlas"`。不加的話，組裝器會把
     這頁的主選單換成選舉六項，並在 `<main>` 開頭插入候選人閱讀標準，兩者都不適用於地圖。
   - `MORE` 清單加 `("政策與工程地圖", "/atlas.html")`；`/maps.html` 保留原名「議題地圖」。
3. `tools/release/prepare_release.py` 的頁面標記檢查可加 `"atlas.html": 'id="atlasApp"'`。
4. `public/data/geo/**` 與 `public/img/atlas/**` 不需要另外處理：組裝器的
   `shutil.copytree(production, output)` 會整個帶進 `dist`。實測 `npm run build` 後
   `dist/data/geo/` 有 12 個檔案，`dist/data/manifest.json` 的 `files` 多了
   `geo/manifest.json`、`geo/project-locations.json`、`geo/project-stages.json`（20 → 23）。
   `.geojson` 不在主 manifest 的雜湊清單內，它們的 sha256 記在 `geo/manifest.json`。

## 2. 導航

- `src/lib/civic-sections.json` 的 `map` 一項目前指向 `/maps.html`。建議把「政策與工程地圖」改指
  `/atlas.html`，另留一項「議題地圖」給 `/maps.html`。
- `atlas.html` 的頁首結構與 `governance.html` 相同（`header.top` → `nav.wrap.nav`、`main.wrap`），
  `ensure_civic_nav` 可以直接插入公共事務導航。主選單有六項，手機用六欄格線。
- 地圖可以用網址直接開到某個案卷或地區，其他頁面要連過來時用這個格式：

  | 參數 | 值 | 例子 |
  | --- | --- | --- |
  | `s` | `overview`、`region:<地區代碼>` 或 `site:<案卷ID>`（現地沙盤） | `#s=region:taipei`；`#s=site:taipei-peiying-housing` |
  | `v` | `plan`（預設）或 `iso` | `#v=iso` |
  | `p` | 案卷 ID | `#p=taipei-peiying-housing` |
  | `t` | 議題代碼 | `#t=housing` |
  | `g` | 七階段之一，或 `none` | `#g=completion` |
  | `w` | `1` 只看收藏 | |
  | `q` | 關鍵字 | |
  | `c`、`z` | 地圖中心 `經度,緯度` 與放大倍數 | `#c=121.5484,25.08&z=3` |

  治理頁的案卷卡可以加一個「在地圖上看」連結：`/atlas.html#p=<案卷ID>`。

## 3. 資料介面

頁面讀這些檔案，各自成敗；任何一個失敗都會在頁面上列成資料缺口，不會被當成完整載入。

| 檔案 | 必要 | 失敗時 |
| --- | --- | --- |
| `/data/governance.json`、`/data/governance-registry.json` | 是 | 不顯示任何案卷，顯示靜態總覽圖、官方來源連結與重試 |
| `/data/geo/project-locations.json` | 否 | 案卷照列，位置標「位置資料未載入」，沒有圖釘，待定位清單說明無法列出 |
| `/data/geo/project-stages.json` | 否 | 圖釘不顯示階段字，不能依階段篩選，來源卡只顯示案卷本身的階段紀錄 |
| `/data/geo/boundaries/*.geojson` | 否 | 少哪一層就說哪一層；全部都沒有時明講底圖缺漏，圖釘與列表照常 |
| `/data/art-library.json` | 否（選用） | 不存在不算缺口 |

### project-locations.json（契約的 Geography）

每個治理案卷一筆，用 `project_id` 對到 `governance.json` 的 `id`：

```jsonc
{
  "project_id": "hsinchu-county-baozhong-road",
  "region_id": "hsinchu-county",
  "district": { "id": "10004030", "name": "新埔鎮", "basis": "…" },   // 沒有座標時為 null
  "location_text": "…位置原文…",
  "location_text_source_id": "hsc-baozhong",
  "geometry": { "type": "LineString", "coordinates": [[121.03667, 24.84316], …] },  // 或 Point；沒有證據時 null
  "anchor": [121.03627, 24.836988],          // 圖釘位置；線段取中點
  "location_precision": "street",            // site／street／area／unknown
  "coordinate_source": { "source_id": "osm", "url": "…", "checked_at": "2026-11-13", "basis": "…", "elements": [ … ] },
  "corroboration": [ { "kind": "length_check", "official_length_m": 1360, "computed_length_m": 1375, "difference_pct": 1.1 } ],
  "caveats": [ "…" ],
  "pending": null,                           // 待定位時是 { reason, clues[], next_step }
  "site_context": "sites/hsinchu-county-baozhong-road.geojson",
  "site_frame": { "center": [121.0363, 24.837], "half_m": [620, 900] }
}
```

資料線的 `public/data/civic/watch.sqlite` 裡四案的 geometry 目前是 null。要回填的話，以這個檔案的
`geometry`、`location_precision`、`coordinate_source` 為準；待定位那一案維持 null。

### project-stages.json

每個案卷七格 `stages.<階段>` = `{ status, date, precision, label, source_id, quote, note }`，
另有 `other_records`、`figures`、`facts`、`relations`。狀態定義見 DATA-SOURCES.md 第 4 節。
這份對照是依 2026-11-12 的治理案卷整理的；`governance.json` 的 `reviewed_at` 比
`based_on.governance_reviewed_at` 新時，頁面會提示尚未重新核對，需要人工更新這個檔案。

### 新增案卷

治理案卷新增一筆後，地圖的列表會立刻出現那一案，位置顯示「還沒有做位置查核」，不會有圖釘。
`node src/atlas/build/build-locations.mjs` 會因為有案卷沒查核而失敗，提醒補
`src/atlas/build/location-evidence.json`。這是刻意的：沒有查核紀錄就不上地圖。

## 4. 與其他線共用的東西

- **收藏**：`localStorage` 的 `governance-watch-v1`，和 `src/governance.js` 同一個鍵、同樣是字串陣列。
- **美術庫（05-art）**：`/data/art-library.json` 存在時，地圖會選用
  `review_status = publication-ready`、`usage_status` 為 `available` 或 `in-use`、而且有檔案的素材：
  - `project_refs` 含案卷 ID 的，顯示在來源卡的「實景照片」。
  - `kind = scene` 且 `region_ids` 含地區代碼的，顯示在單一地區圖下方的「地區實景」。
  兩處都標素材 ID、署名與授權，並註明照片不是工程進度證明。縮圖取最窄的 WebP，點開用
  `role = fallback` 的檔案。這是照 05-art 分支 `e992cd9` 的索引（schema_version 2）寫的；
  該索引目前 `project_refs` 都是 null，所以來源卡還不會出現照片，地區實景則四個地區各有三到四張。
  本線沒有複製任何美術庫檔案，在本線分支上這個索引不存在，整合後才會生效，
  **整合後的實際顯示本線沒有測過**（只有單元測試驗過選取規則）。
- **樣式**：`src/atlas/atlas.css` 的選擇器都限定在 `.atlas-page` 內。按鈕的覆寫用
  `html body.atlas-page main.wrap.atlas-main …`，優先度高於 `editorial-depth.css` 的全域按鈕規則，
  所以樣式表載入順序改變（組裝器會把 depth 樣式挪到最後）也不受影響。第一線的
  `bright-civic.css` 如果對 `main.wrap button` 加了更高優先度的規則，需要再看一次圖釘與時間軸標記。

## 5. 驗收怎麼接

`tests/map/verify-atlas.mjs` 的參數和 `tools/release/verify-*.mjs` 一樣是 `[origin] [截圖資料夾]`，
可以直接加進 `tools/check_site.py` 的清單（那支腳本目前只找 `tools/release/` 底下的檔名，
要嘛改成接受路徑，要嘛在 `tools/release/` 放一個轉呼叫的檔案）。它假設治理案卷是目前這四案；
案卷增減時要更新檔案裡的案卷 ID 與數量。

建議的 npm scripts（本線沒有改 `package.json`）：

```json
"test:map": "node --test \"tests/map/*.test.mjs\"",
"test:map:browser": "node tests/map/run-bundle-check.mjs artifacts/screens"
```

## 6. 舊的議題地圖

`maps.html` 是候選人 × 議題的來源矩陣，和這張地理地圖是兩件事，本線沒有動它。兩頁可以互相連結：
議題地圖回答「誰在哪個議題有紀錄」，政策與工程地圖回答「這項工程在哪裡、紀錄到哪一步」。
