# -*- coding: utf-8 -*-
"""情緒詞典與計分（主線草稿補丁）。

【柏能代理暫裁（暫定）】本檔變更依協調代理暫裁，非柏能本人直接裁定；合入前需柏能確認。

暫裁要點：
1. 「支持度／支持率／領先／民調」視為中性：詞典匹配前先遮蔽，避免子字串「支持」「領先」誤觸。
2. 多人文本：情緒只歸給該句主語／最近人名（見 score_sentiment_for_person）。
3. 民調黑窗設定不變（見 src/polls.js；本檔不改）。
4. 子句級民調中性：移植 AI代理開發員 hw_analysis（POLL_CLAUSE_MARKERS）。

"""
from __future__ import annotations

import re
from collections import defaultdict

POS = ["支持","肯定","讚","優秀","進步","改善","成功","當選","凍蒜","表揚","貢獻","用心","務實","清廉","專業","建設","爭取","佳績","高票","通過"]
NEG = ["批評","爭議","醜聞","貪污","弊案","失格","抹黑","造謠","違紀","違規","敗選","落敗","質疑","抨擊","譴責","下台","檢舉","告發","起訴","不適任","逃漏稅","侵吞","對立"]

# 民調／中性用語：最長優先遮蔽（「支持度」須先於「支持」匹配）
# 【柏能代理暫裁（暫定）】支持度／支持率／領先／民調；另保留既有「支持者」以免子字串誤觸
NEUTRAL_TERMS = sorted(
    ["支持度", "支持率", "支持者", "領先", "民調"],
    key=len,
    reverse=True,
)

# 追蹤三人全名（歸屬用）。詞典本身不含人名。
DEFAULT_PERSON_NAMES = ["鄭朝方", "徐欣瑩", "吳旭智"]

_SENT_SPLIT = re.compile(r"(?<=[。！？；!\?])\s*|\n+")


def mask_neutral_terms(text: str) -> str:
    """遮蔽中性片語後再做詞典匹配。【柏能代理暫裁（暫定）】"""
    if not text:
        return ""
    for t in NEUTRAL_TERMS:
        text = text.replace(t, " " * len(t))
    return text


# 子句級民調中性（移植自 work/AI代理開發員/hw_analysis/stance.py 概念；不依賴該套件）
POLL_CLAUSE_MARKERS = ("民調", "支持度", "支持率", "民意調查", "調查顯示", "受訪者")
_CLAUSE_SPLIT = re.compile(r"[，,。！!？?；;：:\n…、]+")


def mask_poll_clauses(text: str) -> str:
    """含民調標記的子句整段遮蔽（等長空白），避免「民調支持Ｘ」觸發支持情緒。
    來源：AI代理開發員 hw_analysis 子句級中性；合入 collectors 供主線使用。
    """
    if not text:
        return ""
    out, last = [], 0
    for mt in _CLAUSE_SPLIT.finditer(text):
        seg = text[last:mt.start()]
        if any(w in seg for w in POLL_CLAUSE_MARKERS):
            out.append(" " * len(seg))
        else:
            out.append(seg)
        out.append(mt.group(0))
        last = mt.end()
    seg = text[last:]
    out.append(" " * len(seg) if any(w in seg for w in POLL_CLAUSE_MARKERS) else seg)
    return "".join(out)


def prepare_text_for_lexicon(text: str) -> str:
    """先子句級民調遮蔽，再片語級 NEUTRAL_TERMS 遮蔽。"""
    return mask_neutral_terms(mask_poll_clauses(text or ""))


def split_sentences(text: str) -> list[str]:
    """依 。！？； 與換行切句。【柏能代理暫裁（暫定）】"""
    if not text:
        return []
    parts = _SENT_SPLIT.split(text)
    return [p.strip() for p in parts if p and p.strip()]


def _find_all(haystack: str, needle: str) -> list[int]:
    out: list[int] = []
    start = 0
    while True:
        i = haystack.find(needle, start)
        if i < 0:
            break
        out.append(i)
        start = i + len(needle)
    return out


def _lexicon_hits(masked: str) -> list[tuple[int, int, str, str]]:
    """回傳 (start, end, term, polarity) 列表；同位置最長詞優先、不重疊。"""
    n = len(masked)
    terms = [(w, "pos") for w in POS] + [(w, "neg") for w in NEG]
    terms.sort(key=lambda x: len(x[0]), reverse=True)
    taken = [False] * n
    hits: list[tuple[int, int, str, str]] = []
    for term, pol in terms:
        for i in _find_all(masked, term):
            j = i + len(term)
            if any(taken[k] for k in range(i, j)):
                continue
            for k in range(i, j):
                taken[k] = True
            hits.append((i, j, term, pol))
    hits.sort(key=lambda x: x[0])
    return hits


def _name_spans(sentence: str, names: list[str]) -> list[tuple[str, int, int]]:
    """句子內人名跨度；較長名優先，避免重疊。"""
    ordered = sorted(set(names), key=len, reverse=True)
    taken = [False] * len(sentence)
    spans: list[tuple[str, int, int]] = []
    for name in ordered:
        for i in _find_all(sentence, name):
            j = i + len(name)
            if any(taken[k] for k in range(i, j)):
                continue
            for k in range(i, j):
                taken[k] = True
            spans.append((name, i, j))
    spans.sort(key=lambda x: x[1])
    return spans


def _attribute_hit(
    hit_start: int,
    names: list[tuple[str, int, int]],
) -> str | None:
    """把一個情緒命中歸給最近前述人名；否則最近人名；等距則 None（歧義）。

    【柏能代理暫裁（暫定）】
    """
    if not names:
        return None
    preceding = [(n, s, e) for (n, s, e) in names if e <= hit_start]
    if preceding:
        # 距離：hit_start - end；取最小；若並列 → 歧義
        dists = [(hit_start - e, n) for (n, s, e) in preceding]
        mind = min(d for d, _ in dists)
        cands = [n for d, n in dists if d == mind]
        if len(set(cands)) != 1:
            return None
        return cands[0]
    # 無前述：用整句最近（中心距離）
    dists = []
    for n, s, e in names:
        mid = (s + e) / 2.0
        dists.append((abs(mid - hit_start), n))
    mind = min(d for d, _ in dists)
    cands = [n for d, n in dists if d == mind]
    if len(set(cands)) != 1:
        return None
    return cands[0]


def attribute_sentiment_hits(
    text: str,
    person_names: list[str] | None = None,
) -> dict[str, dict[str, int]]:
    """逐句歸屬情緒命中。回傳 {人名: {"pos": n, "neg": m}}。

    【柏能代理暫裁（暫定）】
    - 無人名的句子：不歸屬（對所有人中性）
    - 某命中等距歧義：該命中不歸屬
    - 人名出現但無歸屬命中：呼叫端視為 neu
    """
    names = list(person_names) if person_names else list(DEFAULT_PERSON_NAMES)
    masked = prepare_text_for_lexicon(text or "")
    # 切句時用原始標點位置：對 masked 切句（空白取代不影響標點）
    tallies: dict[str, dict[str, int]] = defaultdict(lambda: {"pos": 0, "neg": 0})
    # 預先登記出現過的人名（即使無命中）
    for name in names:
        if name in (text or ""):
            _ = tallies[name]  # ensure key
    for sent in split_sentences(masked):
        # 還原？人名與命中都在 masked 上找（人名不含中性詞，不受遮蔽影響）
        spans = _name_spans(sent, names)
        if not spans:
            continue
        hits = _lexicon_hits(sent)
        for start, end, term, pol in hits:
            owner = _attribute_hit(start, spans)
            if owner is None:
                continue  # 歧義或無法判定 → 此命中不計
            tallies[owner][pol] += 1
    return {k: dict(v) for k, v in tallies.items()}


def _label_from_counts(pos: int, neg: int) -> str:
    if pos == 0 and neg == 0:
        return "neu"
    if pos > neg:
        return "pos"
    if neg > pos:
        return "neg"
    return "neu"


def score_sentiment_for_person(
    text: str,
    person_name: str,
    person_names: list[str] | None = None,
) -> str:
    """針對單一追蹤對象計分。【柏能代理暫裁（暫定）】多人歸屬規則。"""
    if not text:
        return "neu"
    names = list(person_names) if person_names else list(DEFAULT_PERSON_NAMES)
    if person_name not in names:
        names = list(names) + [person_name]
    tallies = attribute_sentiment_hits(text, names)
    counts = tallies.get(person_name, {"pos": 0, "neg": 0})
    # 文本完全未提此人：仍回 neu（呼叫端通常不會為此建 item）
    return _label_from_counts(counts["pos"], counts["neg"])


def score_sentiment(text: str, person_name: str | None = None, person_names: list[str] | None = None) -> str:
    """主線相容入口。

    - 有 person_name：走多人歸屬【柏能代理暫裁（暫定）】
    - 無 person_name：整篇遮蔽中性詞後計分（舊行為＋民調中性）
    """
    if not text:
        return "neu"
    if person_name:
        return score_sentiment_for_person(text, person_name, person_names)
    masked = prepare_text_for_lexicon(text)
    p = sum(1 for w in POS if w in masked)
    n = sum(1 for w in NEG if w in masked)
    return _label_from_counts(p, n)
