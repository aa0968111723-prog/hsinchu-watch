# 北北竹與中央資料層

這一層放在 `public/data/civic/`，不覆寫既有 `public/data` 與 `public/observations`。完整可查詢副本是 `public/data/civic/watch.sqlite`。

## 既有資料

盤點腳本看到 23 個既有 JSON，不是任務書所說的 20 個；以檔案為準。資料庫分開保存：

| 表 | 筆數 | 意義 |
| --- | --- | --- |
| articles，origin=items | 9,164 | `items.json` 人物新聞 |
| articles，origin=official | 21 | 官網摘錄，識別碼與新聞列不重複 |
| source_index | 7,205 | 來源索引，不是另一批文章 |
| policies | 1,879 | 政策 |
| polls | 83 | 民調，沿用原文數字與隱藏旗標 |
| comments / threads | 23 / 17 | 匿名短摘錄與討論串網址 |
| pending_news | 20 | 待審新聞 |
| projects | 4 | 既有治理案卷 |
| candidates | 6 | 新竹縣長與竹北市長正式名單 |

人物分檔 9,164 筆都已在 `items.json`，沒有再插一次。任務書的完整資料頁 18,422 筆是頁面列數，不是這次把各表加總後的新基準。

`spent_twd` 四案都是 null。褒忠路保留核定 975,210,000 與契約 752,800,000。培英住宅的進度 100 帶有基準日，只表示案卷裡的工程進度，不是驗收或入住。四案的 geometry 都是 null。

留言的 commentId 沒有寫進資料庫。正式候選人只有鄭朝方、徐欣瑩、朱定瑀、吳旭智、曾聖凱、邱臣遠。陳見賢在 `mentioned_people`，不在候選人表。

## 新的公開紀錄

2026-11-13T00:42:18+08:00 這一輪成功，86 筆，內容雜湊 `40d759b68f81bf61d50d20b6fb2c0b5b397e525a292ed456f0a6d536ca85a886`。臺北、新北、新竹縣、新竹市、行政院、主計總處、立法院都有帶回原文連結與日期的紀錄。中央社 2 筆是報導，PTT 新竹板 12 筆只存標題與討論串連結。全部 `verification_status=unreviewed`、`stats_eligible=false`。

同一問題的對照在 `comparisons.json`：褒忠路開工公告對上既有案卷，支用與驗收仍缺；主計總處澄清稿沒有一併收錄預算中心原文。

## 增量介面

`public/data/civic/feed.json` 有 `etag`、`content_hash`、`changes`、`last_success_at`、`status`。`partial` 表示該輪有來源失敗，那些來源沿用上次成功的紀錄。

## 指令

```text
python -m unittest discover -s tests/civic -p test_*.py -v
python scripts/civic/collect_civic.py
python scripts/civic/inventory_payloads.py
python scripts/civic/build_database.py
powershell -NoProfile -File scripts/civic/register_schedule.ps1
```

失敗保留演練是 `python scripts/civic/drill_retention.py`。演練後要再跑一輪真實搜集，否則健康狀態會停在 error。
