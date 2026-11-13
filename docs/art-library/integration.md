# 接到正式站

本線沒有改發布工具、其他線的 CSS、地圖、人物資料或既有照片。

## 給第一線、第三線

用素材 ID 取用。完整清單在 `docs/art-library/inventory.md`，或開 `/asset-lab.html` 篩選後按「複製 ID」「複製嵌入碼」。

照片的嵌入碼是 `<picture>`，含 AVIF、WebP 與 JPEG，並附一行署名。CC BY-SA 的照片一定要帶署名與授權。

立體元件這樣放：

```html
<link rel="stylesheet" href="/art-library/figures/figures.css">
<div data-figure="evidence-desk" data-alt="…"></div>
<script type="module" src="/art-library/figures/boot.js"></script>
```

不要用 iframe，也不要把元件的程式貼成行內 `<script>`，正式站的 CSP 兩個都擋。片段或模組載入失敗時，`boot.js` 會留下靜態圖。

地區識別碼和治理案卷、資料線一致：`taipei`、`new-taipei`、`hsinchu-county`、`hsinchu-city`、`central`。建築照片另有 `office_refs`（例如 `office:ly`），對應資料線 `graph.json` 的機關。

實景照片是拍攝當天的外觀。不要放在工程進度旁邊當成現況。

## 給第四線

1. `public/asset-lab.html` 會被 `assemble-production.py` 當成一般頁面處理，所以它有 `.top nav.nav` 與 `main`。少了這兩個，`edit_page` 會丟 `Page shell missing`，整個建置中斷。`tests/art-library/test_catalog.py` 會檢查這件事。
2. 本工作區跑過 `npm run build`，exit 0，輸出 `pages: 13, reference: 7`。也就是加上美術庫後是 20 個 HTML，不是 AGENTS.md 寫的 19 個。
3. 建置會在本頁頂端插入「候選人閱讀標準」那一行。美術庫用不到；要不要讓 `asset-lab` 和 `governance`、`archive` 一樣跳過，由第四線決定。
4. 導覽還沒有入口。要加的話是 `MORE` 裡一筆「美術庫」→ `/asset-lab.html`。
5. `public/data/art-library.json` 會被 `finalize_manifest` 收進 manifest 的 `files`。
6. `public/art-library/figures/*/index.html` 在子資料夾，建置不會改它們，也不受根頁面的檢查影響。
7. 整合後請跑：

```text
python -m unittest discover -s tests/art-library -p "test_*.py"
node --test tests/art-library/figures.test.mjs
npm run build
python tests/art-library/check_lab.py --root dist --built
```

## 本線發現、不屬於本線的事

- `public/data/candidate_photos.json` 的 `treatment.crop` 寫 `center-square`。實際比對後，三張檔案是 Commons 原檔靠上方的正方形裁切。照片本身沒問題，是說明文字不精確。
- `public/img/persons/chiu.jpg` 不在 `candidate_photos.json` 裡，但它和 Commons 的 `File:邱臣遠副市長肖像.jpg` 位元組相同（SHA-1 `b31f588e72a709e03399ab919e7b6ab23e6aba97`），作者新竹市政府，GWOIA。人物頁若要顯示出處，可以引用美術庫的 `portrait-chiu-hccg`。
