# 接到正式站

本線沒有改發布工具、其他線的 CSS、地圖、人物資料或既有照片。

## 給第一線、第三線

用素材 ID 取用。完整清單在 `docs/art-library/inventory.md`，或開 `/asset-lab.html` 篩選後按「複製 ID」「複製嵌入碼」。

照片的嵌入碼是 `<picture>`，含 AVIF、WebP 與 JPEG，並附一行署名。CC BY-SA 的照片一定要帶署名與授權。

立體元件這樣放：

```html
<link rel="stylesheet" href="/art-library/figures/figures.css">
<div data-figure="evidence-desk" data-alt="…"></div>
<!-- 或 budget-drawers、stage-yard、council-desk；預算／階段可加 data-project="案卷 id" -->
<script type="module" src="/art-library/figures/boot.js"></script>
```

不要用 iframe，也不要把元件的程式貼成行內 `<script>`，正式站的 CSP 兩個都擋。片段或模組載入失敗時，`boot.js` 會留下靜態圖。

`stage-yard` 只點亮有來源事件的階段。完工不是驗收，驗收不是啟用；「準備驗收」與「目標完工」不會點亮該階段，百分比進度也不會。

`council-desk` 的提案、審查、決議是三本分開的夾。敲槌是示意，不會寫出票數，也不會把提案推成決議。

地區識別碼和治理案卷、資料線一致：`taipei`、`new-taipei`、`hsinchu-county`、`hsinchu-city`、`central`。建築照片另有 `office_refs`（例如 `office:ly`），對應資料線 `graph.json` 的機關。

實景照片是拍攝當天的外觀。不要放在工程進度旁邊當成現況。

## 給第四線

main 上已經有本線第一個切片（`fc5b4f1`，從 `c472a13` cherry-pick）。後續的 commit 也請用 cherry-pick；merge 分支會出現 add/add 衝突。

1. `public/asset-lab.html` 有 `.top nav.nav` 與 `main`，可以讓 `assemble-production.py` 當一般頁面處理。`tests/art-library/test_catalog.py` 會檢查外殼還在。
2. main 現在對 `asset-lab.html` 有兩個特例：`assemble-production.py` 的 `edit_page` 一開始就 `return`，`prepare_release.py` 跳過它的樣式檢查。兩個都可以拿掉。拿掉後頁面會有全站頁首與公共事務導覽，「美術庫」會標成目前所在頁。留著也能用，頁面維持自己的簡單頁首。兩種都試過，見下表。
3. 當成一般頁面時，建置會在頂端插入「候選人閱讀標準」那一行。美術庫用不到；要不要像 `governance`、`archive` 一樣略過，由第四線決定。
4. `tools/integrate/verify-art-lab.mjs` 是照第一版頁面寫的，對新版會失敗。第 12 行改成 `page.locator('#alDetail').getByText('portrait-wu-moi')`，第 14 行的 `#count` 改成 `#alCount`。
5. `public/data/art-library.json` 會被 `finalize_manifest` 收進 manifest 的 `files`。
6. `public/art-library/figures/*/index.html` 在子資料夾，建置不會改它們，也不受根頁面的檢查影響。
7. 正式站對不存在的路徑回 200 與首頁內容。檢查檔案有沒有上線要看 `Content-Type`，不能只看狀態碼。`tests/art-library/check_live.py` 是這樣做的。

在 main `ea7ffc0` 的匯出副本上套用本線檔案，2026-11-13 的結果：

| 做法 | `npm run build` | `check_lab.py`（五種寬度） |
| --- | --- | --- |
| 保留兩個特例 | exit 0，15 頁，9,164 筆 | 通過 |
| 拿掉兩個特例 | exit 0，15 頁，9,164 筆 | 通過（`--built`） |

整合後請跑：

```text
python -m unittest discover -s tests/art-library -p "test_*.py"
node --test tests/art-library/figures.test.mjs
npm run build
python tests/art-library/check_lab.py --root dist            # 保留特例時
python tests/art-library/check_lab.py --root dist --built    # 拿掉特例時
python tests/art-library/check_live.py                       # 發布後，看正式站實際送出什麼
```

## 本線發現、不屬於本線的事

- `public/data/candidate_photos.json` 的 `treatment.crop` 寫 `center-square`。實際比對後，三張檔案是 Commons 原檔靠上方的正方形裁切。照片本身沒問題，是說明文字不精確。
- `public/img/persons/chiu.jpg` 不在 `candidate_photos.json` 裡，但它和 Commons 的 `File:邱臣遠副市長肖像.jpg` 位元組相同（SHA-1 `b31f588e72a709e03399ab919e7b6ab23e6aba97`），作者新竹市政府，GWOIA。人物頁若要顯示出處，可以引用美術庫的 `portrait-chiu-hccg`。
