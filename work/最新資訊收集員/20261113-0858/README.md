# 最新資訊收集員 20261113-0858（第二輪，求新且求全）

- 收集時間（臺北時間 Asia/Taipei）：2026-11-13 08:57
- 窗口：2026-11-11 00:00 起，對既有 1466 個網址補缺，並納入 11/12–13 新稿。
- 狀態：全部「待審」。模型整理不是已查核，本批不可標已發布。
- 基準仍是 `/workspace/hsinchu-watch/data`（本批未改 data/、dist，未推 main，未部署）。
- 上一輪資料夾 `20261113-0851` 仍保留；本輪擴大媒體矩陣、事件對照與覆蓋紀錄。

## 收錄數

- 待審筆數：64（同一稿依人物分列）
- 不重複網址：28
- 事件組：16（見 events.json；同一事件保留各媒體，用 event_id 串起來）
- 原發／轉載標記：original 57；reprint／forum-share／paywall-title-only 7
- official：0（縣府、議會、黨部、競選官網、中選會窗口內無六人新稿可入庫）
- news：56
- claim：1
- challenge：2
- response：5
- fact-check：0（TFC／MyGoPen 可讀但空；Cofacts 403。空不是 0。）

### 依人物

| 人物 | 筆數 | 分類 |
| --- | ---: | --- |
| 吳旭智 | 7 | news 7 |
| 徐欣瑩 | 22 | challenge 1, claim 1, news 19, response 1 |
| 鄭朝方 | 21 | challenge 1, news 18, response 2 |
| 邱臣遠 | 9 | news 7, response 2 |
| 陳見賢 | 4 | news 4 |
| 吳子嘉 | 1 | news 1 |

兩份 11/12 縣長民調方向相反，事件分開、並排列出：
- ev-poll-assoc-20261112：學會／關鍵調查（李承志律師事務所出資；11/5–8；市話 1071、手機 0）徐 44.4%、鄭 37.5%、朱定瑀 3.2%、未表態 14.9%。
- ev-poll-era-20261112：年代民調（年代網際事業出資；11/8–10；CATI 1069）鄭 36.9%、徐 28.6%、未決定約三成。

## 本輪相對既有庫的重要新稿

- 公辦縣長政見會 11/19：https://news.ltn.com.tw/news/politics/breakingnews/5636853 、https://news.ltn.com.tw/news/politics/breakingnews/5639115
- 中時學會民調即時稿與 13 日紙本：https://www.chinatimes.com/realtimenews/20261112004257-260407 、https://www.chinatimes.com/newspapers/20261113000687-260107
- 年代民調多媒體：TVBS https://news.tvbs.com.tw/politics/4049548 、ETtoday https://www.ettoday.net/news/20261112/3271067.htm 、新頭殼 https://newtalk.tw/news/view/2026-11-12/1070744 、上報、自由、聯合
- 風傳媒學會民調評析：https://www.storm.mg/article/11180881
- 聯合報 13 日「竹北混戰恐外溢」：https://udn.com/news/story/124652/9875592
- 鏡報 13 日游毓蘭竹東開講：https://www.mirrordaily.news/story/97009
- 傳鄭麗文請勸吳子嘉停火（待審）：https://hk.crntt.com/doc/1602/6/7/3/160267393.html
- 其餘車掃、錄影挺吳、再謝陳見賢、王金平、黨紀、VIP 標題等見 events.json

## 來源成功／失敗（細節見 coverage_matrix.json）

- 矩陣細胞共 246（6 人 × 各來源）。摘要：{"by_group": {"media": {"ok": 34, "empty": 68}, "official": {"failed": 36, "empty": 30}, "social": {"failed": 24, "ok": 6}, "forum": {"empty": 16, "failed": 12, "ok": 2}, "fact-check": {"empty": 12, "failed": 6}}, "total_cells": 246}
- 吳旭智官網 drmorning.tw：HTTPS TLS eof（含 www／apex／news）；HTTP 500。
- 民進黨／國民黨新竹縣黨部：TLS eof。
- 民眾黨官網：403。
- Facebook／Instagram／Threads：未登入只見登入牆。
- YouTube 頻道 RSS：robots Disallow，未抓。
- Dcard、Cofacts：403。
- PTT HsinchuCounty Atom：404。
- 聯合報 VIP 9872327：付費牆，只收公開標題。
- 三立站內搜尋空檔；LINE TODAY、部分民視／地方報僅見 Google News 標題，未把轉址當來源。
- 中央社 Atom、公視 RSS、新竹時報 RSS 可讀，窗口內無六人新稿或已在庫。
- 查核中心對六人為空，fact-check 0 筆，不把民調當查核。

## 去重

- 以正規化網址與稿號對既有 1466 個網址去重。
- 同一事件多家媒體全部保留，用 event_id 歸組；Yahoo 等轉載標記 reprint。
- 未收 CMoney；未把未查證社群指控寫進待審新聞。
- 11/11 已在庫的公共鋼琴、安欣連線、休息室、西門町、星際圖書館、吳子嘉莒光日舊稿不重複收。

## 第四線下一步

讀本資料夾 items.json 與 events.json 做增量待審匯入；兩份民調維持兩個事件。完成狀態應為「已交第四線，尚待整合發布」。
