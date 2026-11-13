# 明亮介面 tokens

定義在 `public/bright-civic.css` 的 `:root`。頁面加上 `class="civic-bright"` 後，舊有頁殼與新組件讀同一組。夜讀是 `<html data-civic-theme="dark">`，只覆寫顏色，不換結構。

## 紙色與文字

| Token | 日間 | 用途 |
| --- | --- | --- |
| `--civic-paper` | `#faf7f0` | 頁面 |
| `--civic-sheet` | `#fffdf8` | 紙卡 |
| `--civic-sunk` | `#f3eee4` | 凹下去的篩選槽、量條底 |
| `--civic-ink` | `#2c2823` | 內文 |
| `--civic-ink-2` | `#5a5247` | 次要文字 |
| `--civic-ink-3` | `#746b5e` | 說明、日期、來源 |
| `--civic-link` | `#1f5a7c` | 連結 |
| `--civic-line` / `--civic-line-2` | `#e8dfd0` / `#d5c8b4` | 分隔與框線 |

字體是 `"Noto Sans TC", "PingFang TC", "Microsoft JhengHei"`，標題用 `"Noto Serif TC", "Songti TC", "PMingLiU"`。內文 16px、行高 1.75。不從網路上載字型。

## 六個色族

每個色族有 `-ink`、`-soft`、`-mid`。標籤一定帶文字，顏色只是輔助。對應 `src/civic-ui/model.mjs` 的 `ORIGINS`：

| 色族 | 紀錄性質 |
| --- | --- |
| sage | 回應、查核、正在量的那一疊 |
| sky | 機關發布、民調紀錄 |
| clay | 人物／機關主張 |
| wheat | 意見、待複核、資料缺口 |
| plum | 質疑、司法程序 |
| stone | 既有報導整理、來源索引、待交叉佐證 |

## 立體

層次用三層，不使用透視：

- `--civic-e1` 紙卡：內側 1px 高光、近陰影、遠陰影
- `--civic-e2` 量紙檯的卡片：同樣結構，陰影更遠
- `--civic-lip` 是按鈕底下 2px 的唇；按下時改成 `--civic-press` 並下移 2px

量紙檯的木頭、牛皮紙、紙張、金屬各有頂面與四個側面色階（`--civic-wood-top`、`--civic-wood-0` 到 `-3`，以及 kraft、leaf、steel）。正在量的紙疊用 `--civic-lit-*`。

## 對比

`src/civic-ui/checks/verify-lab.mjs` 在日間與夜讀各算一次 `src/civic-ui/specimens.js` 列出的 18 組文字／底色。2026-11-13 兩組都在 4.5:1 以上。

## 動態

`prefers-reduced-motion: reduce` 時按鈕不位移、量紙檯直接落到目標。預覽頁的「靜態圖」寫入 `html[data-civic-motion="off"]`；系統已要求減少動態時，這個開關停用。低記憶體或省流量時預設不播放intro。
