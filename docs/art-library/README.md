# 美術庫

第五線維護的網站素材：真實照片、原創示意元件，以及挑選它們的頁面。

| 東西 | 位置 |
| --- | --- |
| 圖庫頁 | `public/asset-lab.html`（建置後是 `/asset-lab.html`） |
| 公開索引 | `public/data/art-library.json` |
| 圖檔與元件 | `public/art-library/` |
| 素材清單（人工維護） | `src/art-library/sources.json` |
| 授權證據快照 | `src/art-library/sources.lock.json` |
| 產生器 | `src/art-library/prepare_assets.py`、`src/art-library/figures/build-all.mjs` |
| 驗證 | `tests/art-library/` |
| 可讀清單 | `docs/art-library/inventory.md`（產生器寫的） |
| 待審與缺口 | `docs/art-library/pending.md` |

## 什麼能進公開索引

產生器決定，條件寫在程式裡：

1. Wikimedia Commons 檔案頁的授權在允許清單內：CC BY、CC BY-SA、CC0，或 GWOIA／LY-GWOIA 模板。其他一律不收。
2. 檔案頁有作者。
3. 清單裡標了 `reviewed: true`，而且 `alt` 是看過畫面後寫的。
4. 肖像符合同一個 256 正方形標準，而且站上檔案確實是那張 Commons 照片。

沒過的項目，產生器會印出 `LEFT OUT` 與原因，不寫進 `public/`。授權合格但還沒看過的圖，只存一份在 `work/art-review/`（不進版控）。

## 新增一張照片

1. 在 `sources.json` 的 `scenes` 加一筆：`id`、`commons`（`File:` 開頭的檔名）、`region_ids`、`uses`，`reviewed` 先填 `false`。
2. 跑 `python src/art-library/prepare_assets.py`。授權不合格會直接被拒。合格的話，到 `work/art-review/` 看圖。
3. 看過以後填 `title`、`alt`、`focal_point`，把 `reviewed` 改成 `true`，再跑一次。
4. 跑驗證。

`alt` 要寫畫面裡真的有的東西。第一批曾把一張只有軌道的照片寫成「月台與列車」，是看圖之後才改掉的。

## 指令

```text
node src/art-library/figures/build-all.mjs                 # 重建立體元件
python src/art-library/prepare_assets.py                   # 重建圖檔與索引
python src/art-library/prepare_assets.py --refresh         # 向 Commons 重新讀每一筆授權

python -m unittest discover -s tests/art-library -p "test_*.py"
node --test tests/art-library/figures.test.mjs
python tests/art-library/check_lab.py                      # 瀏覽器驗收，public/
python tests/art-library/check_lab.py --root dist --built  # 先跑 npm run build
python tests/art-library/check_live.py                     # 正式站實際送出的美術庫內容，唯讀
python tests/art-library/serve.py                          # 手動預覽，http://127.0.0.1:4173/asset-lab.html
```

重建元件需要 anatomy kit（`.cursor/skills/anatomy/kit`，或用 `ANATOMY_KIT` 指定）。kit 不在版控裡；建好的元件已經提交，沒有要改元件就不必重建。

瀏覽器驗收用 Playwright。在 Cursor 的沙箱終端機裡，要先把 `PLAYWRIGHT_BROWSERS_PATH` 指到已安裝瀏覽器的資料夾（這台是 `%LOCALAPPDATA%\ms-playwright`）。

## 為什麼預覽要用 serve.py

正式站的 `public/_headers` 對每個路徑送出：

- `script-src 'self'`：行內 `<script>` 不會執行。
- `frame-ancestors 'none'` 與 `X-Frame-Options: DENY`：站內頁面不能放進 iframe。

`python -m http.server` 不送這些標頭，在它上面看起來正常的東西，上線可能不會動。`serve.py` 讀同一份 `_headers`。

## 立體元件

每個元件是一個資料夾：`fragment.html`（可嵌入的片段）、`live.js` 與 `model.js`（外部模組）、`data.js`、`preview.svg`（靜態圖）、`index.html`（獨立頁）。`model.js` 沒有 DOM，頁面和 Node 測試跑同一份規則。

元件不是任何特定工程的樣子，本身也沒有內建數字。讀數裡的詞來自資料欄位。預算三層抽屜會顯示金額，那是綁定案卷後從 `public/data/governance.json` 讀來的，沒有紀錄的那一層維持扣住。

## 肖像

四位候選人有已核對的官方肖像，兩位沒有，列為缺口。站上既有三張是各自 Commons 原檔靠上方的正方形裁切，臉部大小並不一致。統一比例的版本在待辦裡。

「站上檔就是那張 Commons 照片」是量出來的：把站上檔和 Commons 原檔逐格比對，取 64 像素灰階平均差。2026-11-13 的對照結果：

| 站上檔 ＼ Commons 原檔 | 吳旭智 | 徐欣瑩 | 鄭朝方 |
| --- | --- | --- | --- |
| 吳旭智 | 6.15 | 55.49 | 49.15 |
| 徐欣瑩 | 42.06 | 7.87 | 58.93 |
| 鄭朝方 | 48.24 | 63.86 | 5.51 |

同一張照片是 5.5 到 7.9，換成別人是 42 以上，門檻訂在 12。同一個人的另一張照片沒有測過。邱臣遠那張不用比對，站上檔與 Commons 原檔的 SHA-1 相同。
