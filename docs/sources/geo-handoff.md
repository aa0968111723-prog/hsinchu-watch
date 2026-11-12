# 給地圖線的地理交接

`public/data/civic/watch.sqlite` 的 `projects` 四筆 `geometry` 都是 null，`location_precision` 是 `unknown`。

| 案卷 | 地區 | 目前有的文件 | 沒有的 |
| --- | --- | --- | --- |
| hsinchu-county-baozhong-road | 新竹縣 | 開工公告與核定、契約金額 | 支用、驗收、座標 |
| hsinchu-city-xiangshan-four | 新竹市 | 地政公告 | 工程進度、座標 |
| new-taipei-siyuan-footbridge | 新北市 | 在建表列，進度 77.25，基準日 null | 座標 |
| taipei-peiying-housing | 臺北市 | 工程頁，進度 100，基準日 2026-06-01 | 座標；100 不是驗收或入住 |

請用原文地址判斷精度。沒有點位時維持 null，不要用市中心代替工地。
