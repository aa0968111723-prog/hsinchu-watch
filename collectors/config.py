# -*- coding: utf-8 -*-
"""靜態設定。金鑰只從環境變數讀取，不讀 .env。"""
from __future__ import annotations
import os
from pathlib import Path

from collectors.keywords import apply_to_person_dict as _kw_apply

ROOT = Path(__file__).resolve().parents[1]
# 安全蒐集：可導向暫存目錄（HSINCHU_DATA_DIR／HSINCHU_PUBLIC_DATA_DIR）；未設時預設不變
DATA_DIR = Path(os.environ["HSINCHU_DATA_DIR"]) if os.environ.get("HSINCHU_DATA_DIR") else ROOT / "data"
PUBLIC_DATA_DIR = (Path(os.environ["HSINCHU_PUBLIC_DATA_DIR"]) if os.environ.get("HSINCHU_PUBLIC_DATA_DIR")
                   else ROOT / "public" / "data")

PERSONS_SRC = [
    {
        "id": "zheng",
        "name": "鄭朝方",
        "role": "竹北市長／民進黨新竹縣長候選人",
        "party": "民主進步黨",
        "aliases": ["鄭朝方"],
        "geo_filters": ["新竹縣", "竹北", "縣長"],  # FILTER_007
        "website": None,
        "youtube": "鄭朝方",
    },
    {
        "id": "xu",
        "name": "徐欣瑩",
        "role": "立法委員／國民黨新竹縣長候選人",
        "party": "中國國民黨",
        "aliases": ["徐欣瑩"],
        "geo_filters": ["新竹縣", "竹北", "縣長", "立委", "立法委員"],  # FILTER_007
        "website": "https://www.shesinging.tw/",
        "youtube": "徐欣瑩",
    },
    {
        "id": "wu",
        "name": "吳旭智",
        "role": "新竹縣議員／竹北市長候選人",
        "party": "中國國民黨",
        "aliases": ["吳旭智"],
        "geo_filters": ["新竹縣", "竹北", "市長", "議員", "縣議員"],  # FILTER_007
        "website": "https://www.drmorning.tw/",
        "youtube": "吳旭智",
        "council_url": "https://www.hcc.gov.tw/member-detail?C=360&S=22&program=190",
    },
    {
        "id": "chiu",
        "name": "邱臣遠",
        "role": "竹北市長參選人",
        "party": "台灣民眾黨",
        "aliases": ["邱臣遠"],
        "geo_filters": ["新竹縣", "竹北", "市長"],
        "website": None,
        "youtube": "邱臣遠",
    },
]

# 顯示順序：吳→徐→鄭→邱。首頁主卡仍只排前三人（見前端 HOME_CARD_ORDER）。
_ORDER = ["wu", "xu", "zheng", "chiu"]
PERSONS = sorted((_kw_apply(p) for p in PERSONS_SRC), key=lambda p: _ORDER.index(p["id"]))
ID_TO_PERSON = {p["id"]: p for p in PERSONS}
USER_AGENT = "HsinchuWatchBot/0.1 (+public open-data aggregator; no secrets)"
# (connect, read) 秒；補丁 009。舊碼傳 int 仍可用，normalize 後變 tuple。
REQUEST_TIMEOUT = (5, 20)
# 單一來源牆鐘上限（秒）；超時則跳過該源，不擋整輪（PERF r7：各源一致 ≤120）
SOURCE_DEADLINE_SEC = 120
# 個別來源上限；r7 清空 — sitemap 不再 dual 150，與各源同為 SOURCE_DEADLINE_SEC
SOURCE_DEADLINE_OVERRIDES = {}
# 整輪上限（秒）：超過就跳過剩餘來源，但仍會走過濾／寫檔
ROUND_CAP_SEC = 420
# safe_collect 硬殺整個 run_all 子行程（秒）；須 > ROUND_CAP，留給 finalize／寫檔
HARD_KILL_SEC = 480
# 外層 SLA／GHA job timeout-minutes:10（秒）；須 > HARD_KILL，留給 ci_checks／commit
OUTER_TIMEOUT_SEC = 600
# collect.lock 等待上限（秒）；避免無限卡在 flock（01:25 空 log 主因候選）
COLLECT_LOCK_WAIT_SEC = 60
# PERF r7：每站每輪最多抓正文篇數（建議 20）
# 理由：禮貌間隔 ~1.05s ×20 ≈21s／站；兩站＋robots/sitemap 仍遠低於 120s 單源上限，
# 且超過 N 的候選不標已看過，下一輪續抓，不漏文。可用 HSINCHU_SITEMAP_MAX_FETCH 覆寫。
SITEMAP_MAX_FETCH_PER_SITE = 20
# 009 r2：預設鎖路徑；測試／診斷用 HSINCHU_COLLECT_LOCK 覆寫（呼叫端／外層 wrapper 不可再持同一把：01:25 巢狀死鎖）
COLLECT_LOCK_PATH = "/tmp/hsinchu-watch.collect.lock"

# robots.txt 合規（work/開源資源管理員/sources.md 2026-11-10）：
# Feedburner 分類 RSS 為「待查」→ 改用官網允許之 Atom。
# (feed_id, url, source_name, platform)；僅存標題／連結／≤30 字摘要，以全名過濾
CNA_FEEDS = [
    ("cna_atom", "https://www.cna.com.tw/atomfeed_cfp.xml", "中央社", "news"),
    # 011-udn-local：完整地方版（~1000 條）。短訊變體 rssfeed/news/2/6641?ch=news 僅 ~20 條，勿用。
    ("udn_local", "https://udn.com/news/rssfeed/6641", "聯合新聞網·地方", "news"),
    ("udn_opinion", "https://udn.com/udnrss/opinion.xml", "聯合新聞網·鳴人堂／意見", "commentary"),
    ("mirrormedia", "https://www.mirrormedia.mg/rss/rss.xml", "鏡週刊", "news"),
    # ("cna_politics", "https://feeds.feedburner.com/rsscna/politics"),  # 待查，暫停（Feedburner）
    # ("cna_local", "https://feeds.feedburner.com/rsscna/local"),        # 待查，暫停（Feedburner）
]
# 011：短 feed 警示門檻（entries ≤ 此值 → udn_short_feed，不失敗）
UDN_SHORT_FEED_MAX = 20
# 011：允許源之間禮貌間隔（秒）；與 009 逾時／90s 牆鐘並用
FEED_FETCH_INTERVAL_SEC = 1.0

# 依 robots.txt 停用（不刪程式碼）：
# - google_news / polls / commentary：皆經 news.google.com/rss（robots Disallow: /）
# - youtube Atom feeds/videos.xml（Disallow）仍不用；youtube 來源已改走 social.py（官網連結＋/oembed＋可選 Data API 金鑰），故不再停用
# 允許源含：CNA Atom、UDN 地方 news/rssfeed/6641、UDN opinion、鏡週刊（011）。
# 仍排除：Feedburner、自由 LTN、YouTube Atom、Google News。
DISABLED_COLLECTORS = {"google_news", "polls", "commentary"}
# PTT：Hsinchu 免年齡；Gossiping 需 over18=1（柏能 2026-11-10 裁示可收）
PTT_FETCH_INTERVAL_SEC = 1.05
PTT_INDEX_PAGES = 5          # 八卦板每輪近頁索引上限
PTT_SEARCH_MAX = 15          # 每板每人搜尋列表上限
PTT_BOARDS = [
    ("Hsinchu", "https://www.ptt.cc/atom/Hsinchu.xml"),
    ("Gossiping", "https://www.ptt.cc/atom/Gossiping.xml"),
]

# HTML 公開列表（SOURCES_008；須全名過濾；摘錄 ≤30；不存帳號）
# 2026-11-10 柏能：民進黨 /news 與國民黨 kmt.org.tw/2026/ 同時開
# robots 複核（Asia/Taipei）：竹北 allow；吳／徐官網 allow；KMT allow（禁 /search）；
# 縣府／議會／民進黨 robots 404 HTML → RFC 9309 4xx 視為無 Disallow
HTML_NEWS_SOURCES = [
    {
        "id": "zhubei_press",
        "url": "https://www.zhubei.gov.tw/iframcirculated_list.php?menu=29&typeid=1406",
        "source_name": "竹北市公所新聞稿",
        "platform": "gov",
        "encoding": "big5",
        "link_substr": "iframcirculatedview.php",
        "enabled": True,
        "robots": "allow",
        "persons_hint": ["zheng"],
    },
    {
        "id": "hsinchu_county_news",
        "url": "https://www.hsinchu.gov.tw/News.aspx?n=153&sms=8603",
        "source_name": "新竹縣政府·縣府新聞",
        "platform": "gov",
        "encoding": "utf-8",
        "link_substr": "News_Content.aspx",
        "enabled": True,
        "robots": "unknown_404",
        "persons_hint": ["zheng", "xu", "wu"],
    },
    {
        "id": "hcc_news",
        "url": "https://www.hcc.gov.tw/news?lang=&program=151",
        "source_name": "新竹縣議會·最新消息",
        "platform": "council",
        "encoding": "utf-8",
        "link_substr": "detail?program=151",
        "enabled": True,
        "robots": "unknown_404",
        "persons_hint": ["wu", "xu", "zheng"],
        "note": "多為議事公告；須全名才收",
    },
    {
        "id": "wu_site_news",
        "url": "https://www.drmorning.tw/category/news/",
        "source_name": "吳旭智官網·最新新聞",
        "platform": "website",
        "encoding": "utf-8",
        "link_substr": "/news/",
        "enabled": True,
        "robots": "allow",
        "persons_hint": ["wu"],
    },
    {
        "id": "xu_record",
        "url": "https://www.shesinging.tw/record/",
        "source_name": "徐欣瑩官網·政績故事",
        "platform": "website",
        "encoding": "utf-8",
        "link_substr": "/record/",
        "enabled": True,
        "robots": "allow",
        "persons_hint": ["xu"],
    },
    {
        "id": "dpp_news",
        "url": "https://www.dpp.org.tw/news",
        "source_name": "民主進步黨·公開新聞",
        "platform": "party",
        "encoding": "utf-8",
        "link_substr": "/news/contents/",
        "enabled": True,  # 與 kmt_blog_year 同時開（柏能 2026-11-10）
        "robots": "unknown_404",
        "persons_hint": ["zheng"],
    },
    {
        "id": "kmt_blog_year",
        "url": "https://www.kmt.org.tw/2026/",
        "source_name": "中國國民黨·全球資訊網年目錄",
        "platform": "party",
        "encoding": "utf-8",
        "link_substr": "blog-post",
        "enabled": True,  # 與 dpp_news 同時開（非 /search，robots Allow）
        "robots": "allow",
        "persons_hint": ["xu", "wu"],
        "note": "勿用 /search/label（Disallow）",
    },
    {
        "id": "kmt_www1_mid33",
        "url": "https://www1.kmt.org.tw/article.aspx?mid=33",
        "source_name": "中國國民黨·常會特稿",
        "platform": "party",
        "encoding": "utf-8",
        "link_substr": "article.aspx",
        "enabled": False,
        "robots": "unknown_404",
        "persons_hint": ["xu", "wu"],
        "skip_reason": "無穩定對等新聞列表；不採",
    },
    {
        "id": "kmt_hsinchu_weebly",
        "url": "https://kmthsinchu.weebly.com/",
        "source_name": "國民黨新竹縣黨部 Weebly",
        "platform": "party",
        "encoding": "utf-8",
        "link_substr": "weebly.com",
        "enabled": False,
        "robots": "allow",
        "persons_hint": ["xu", "wu"],
        "skip_reason": "縣黨部舊站停更／無三人全名；不採",
    },
    {
        "id": "knowledge_kmt",
        "url": "https://knowledge.kmt.org.tw/",
        "source_name": "國民黨知識庫",
        "platform": "party",
        "encoding": "utf-8",
        "link_substr": "/articles/",
        "enabled": False,
        "robots": "allow",
        "persons_hint": ["xu", "wu"],
        "skip_reason": "備查；非標準新聞列表",
    },
]
# ETtoday：不採（Feedburner robots lander；無法確認允許）
ETTODAY_STATUS = {
    "adopted": False,
    "reason": "feeds.feedburner.com/robots.txt 回 HTML lander，無法確認允許；待查",
}
LY_ID421 = (
    "https://data.ly.gov.tw/odw/ID421Action.action"
    "?term=11&sessionPeriod={period}&meetingDateS={start}&meetingDateE={end}"
    "&meetingTime=&legislatorName=%E5%BE%90%E6%AC%A3%E7%91%A9&fileType=json"
)
