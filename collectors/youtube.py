# -*- coding: utf-8 -*-
"""社群入口（run_all 以 "youtube" 名稱呼叫；實作在 collectors/social.py）。

YouTube 頻道 RSS／站內搜尋被 robots.txt 禁止 → 不用。改用：
  (a) 有 YOUTUBE_API_KEY 時走官方 Data API（只讀官方頻道 uploads，每頻道每輪 1 單位）；
  (b) 無金鑰時：候選人官網貼出的影片連結 → /oembed（robots 允許）驗證為官方頻道才收；
  (c) 官網自己貼出的 FB／IG／Threads 貼文連結（不向 Meta 請求）。
舊版（search.list + 留言抽樣，每輪 ~900 單位，會爆日配額）已移除；原檔備份於
/workspace/hsinchu-watch-backups/social-*/youtube.py。
"""
from __future__ import annotations

from collectors import social
from collectors.sentiment import score_sentiment
from collectors.topics import tag_topics
from collectors.util import make_item


def collect():
    items, stats = social.collect_all(make_item=make_item, sentiment_fn=score_sentiment, topics_fn=tag_topics)
    stats["comments"] = []  # 不蒐集留言者資料
    return items, stats
