# 接到正式站

本線沒有改發布工具、其他線的 CSS、地圖、人物資料或既有照片。

## 給第一線、第三線

用素材 ID 取用。完整清單在 `docs/art-library/inventory.md`，或開 `/asset-lab.html` 篩選後按「複製 ID」「複製嵌入碼」。

照片的嵌入碼是 `<picture>`，含 AVIF、WebP 與 JPEG，並附一行署名。CC BY-SA 的照片一定要帶署名與授權。

人物卡請用各肖像 `files` 裡 `role=card` 的 3:4（360×480）組；正方形 256 檔是既有頭像相容用，臉部比例不一致。

立體元件這樣放：

```html
<link rel="stylesheet" href="/art-library/figures/figures.css">
<div data-figure="evidence-desk" data-alt="…"></div>
<!-- 或 budget-drawers、stage-yard、council-desk、empty-bay；預算／階段可加 data-project="案卷 id" -->
<script type="module" src="/art-library/figures/boot.js"></script>
```

不要用 iframe，也不要把元件的程式貼成行內 `<script>`，正式站的 CSP 兩個都擋。片段或模組載入失敗時，`boot.js` 會留下靜態圖。

`stage-yard` 只點亮有來源事件的階段。完工不是驗收，驗收不是啟用；「準備驗收」與「目標完工」不會點亮該階段，百分比進度也不會。

`council-desk` 的提案、審查、決議是三本分開的夾。敲槌是示意，不會寫出票數，也不會把提案推成決議。

`empty-bay` 的空格表示沒有紀錄。空格不是 0，也不要放假銘牌。

地區識別碼和治理案卷、資料線一致：`taipei`、`new-taipei`、`hsinchu-county`、`hsinchu-city`、`central`。建築照片另有 `office_refs`（例如 `office:ly`），對應資料線 `graph.json` 的機關。

實景照片是拍攝當天的外觀。不要放在工程進度旁邊當成現況。

## 給第四線

後續 commit 請用 cherry-pick。merge 美術庫分支會出現 add/add 衝突。

1. `public/asset-lab.html` 有 `.top nav.nav` 與 `main`，可以讓 `assemble-production.py` 當一般頁面處理。`tests/art-library/test_catalog.py` 會檢查外殼還在。
2. `799bf8b` 已拿掉兩個特例：`edit_page` 不再對 `asset-lab.html` 提早返回，`prepare_release.py` 也不再跳過它的樣式檢查。正式頁有全站頁首與公共事務導覽，「美術庫」會標成目前所在頁。
3. 當成一般頁面時，建置會在頂端插入「候選人閱讀標準」那一行。美術庫用不到；要不要像 `governance`、`archive` 一樣略過，還沒改。
4. `tools/integrate/verify-art-lab.mjs` 改看 `#alDetail` 裡的 `portrait-wu-moi`，計數改看 `#alCount`。
5. `public/data/art-library.json` 會被 `finalize_manifest` 收進 manifest 的 `files`。
6. `public/art-library/figures/*/index.html` 在子資料夾，建置不會改它們，也不受根頁面的檢查影響。
7. 正式站對不存在的路徑回 200 與首頁內容。檢查檔案有沒有上線要看內容與 `Content-Type`，不能只看狀態碼。`tests/art-library/check_live.py` 印出這些事實，不自行判定發布成敗。

美術庫線在 main `ea7ffc0` 的匯出副本上比過兩種做法，2026-11-13：

| 做法 | `npm run build` | `check_lab.py`（五種寬度） |
| --- | --- | --- |
| 保留兩個特例 | exit 0，15 頁，9,164 筆 | 通過 |
| 拿掉兩個特例 | exit 0，15 頁，9,164 筆 | 通過（`--built`） |

第四線採用第二種。2026-11-13 預算抽屜發布後，`check_live.py` 對 https://hsinchu-watch.pages.dev 回報：release `hsinchu-06e22ef430c3f85d`，索引 schema 2、23 筆，含 `component-budget-drawers`，與當時 checkout 位元組相同，`generated_at` 為 `2026-11-13T09:17:51+08:00`。金額來自治理案卷；沒有紀錄的抽屜維持門閂，不顯示 0 元。`/art-library/figures/evidence-bench/index.html` 與首頁同為 7,824 bytes，是未知路徑回首頁。`evidence-desk/fragment.html` 與 `boot.js` 是實際檔案。

整合後請跑：

```text
python -m unittest discover -s tests/art-library -p "test_*.py"
node --test tests/art-library/figures.test.mjs
npm run build
python tests/art-library/check_lab.py --root dist --built
python tests/art-library/check_live.py
```

## 本線發現、不屬於本線的事

- `public/data/candidate_photos.json` 的 `treatment.crop` 寫 `center-square`。實際比對後，三張檔案是 Commons 原檔靠上方的正方形裁切。照片本身沒問題，是說明文字不精確。
- `public/img/persons/chiu.jpg` 不在 `candidate_photos.json` 裡，但它和 Commons 的 `File:邱臣遠副市長肖像.jpg` 位元組相同（SHA-1 `b31f588e72a709e03399ab919e7b6ab23e6aba97`），作者新竹市政府，GWOIA。人物頁若要顯示出處，可以引用美術庫的 `portrait-chiu-hccg`。
