# 接到正式站

第五線現在用獨立入口，不改發布腳本、其他線 CSS、地圖、人物資料或既有照片。

## 已可給第一線、第三線的 ID

公開索引在 `public/data/art-library.json`。

| ID | 種類 | 建議 |
| --- | --- | --- |
| `portrait-wu-moi` | 人物 | 吳旭智人物卡。沿用既有 256 正方形，不要另裁 |
| `portrait-xu-ly` | 人物 | 徐欣瑩人物卡。`license_url` 是 null |
| `portrait-zheng-moi` | 人物 | 鄭朝方人物卡 |
| `scene-hsinchu-city-hall-2015` | 場景 | 新竹市政府正門，2015-04-03，不是工程現況 |
| `scene-hsinchu-tra-station-2024` | 場景 | 新竹車站周邊軌道，不是月台或列車特寫 |
| `scene-taipei-city-hall` | 場景 | 臺北市市政大樓，畫面同時有臺北101 |
| `scene-new-taipei-fire-hq-2016` | 場景 | 新北市消防局總隊部，2016 |
| `component-evidence-bench` | 3D元件 | 來源可信度示意。夾厚不可當政策百分比 |

## 第四線

1. `public/` 已含 `asset-lab.html`、`data/art-library.json`、`art-library/`。`assemble-production.py` 會把 `public` 整樹複製進 stage，不必先改發布工具。
2. 若要讓 Vite 的 HTML 輸入也涵蓋此頁，把 `asset-lab.html` 加進 `vite.config.js` 的 `rollupOptions.input`。此頁不依賴打包，靜態複製即可開啟。
3. 正式導覽加一筆「美術庫」→ `/asset-lab.html`。本線沒有改 `MORE` 或共用 CSS。
4. 待審名單只在 `docs/art-library/pending.md`。不要把 `public/img/persons/chiu.jpg` 補進美術索引，除非另一次授權核對。

預覽：在本工作區執行 `npx vite --host 127.0.0.1 --port 4173`，開啟 `/asset-lab.html`。
