# -*- coding: utf-8 -*-
"""每源牆鐘上限（補丁 009；概念對齊 work/自動修復工程師/resilience.py）。

單一來源超時則跳過並記入 health，不阻塞整輪。
"""
from __future__ import annotations

import time
import traceback
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeout
from dataclasses import dataclass, field
from typing import Any, Callable, Optional


@dataclass
class SourceHealth:
    name: str
    ok: bool
    elapsed_sec: float
    item_count: int = 0
    error: Optional[str] = None
    error_kind: str = "none"
    skipped_by_deadline: bool = False
    stats: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "ok": self.ok,
            "elapsed_sec": round(self.elapsed_sec, 3),
            "item_count": self.item_count,
            "error": self.error,
            "error_kind": self.error_kind,
            "skipped_by_deadline": self.skipped_by_deadline,
            "stats": self.stats,
        }


def call_with_deadline(
    fn: Callable[[], Any],
    *,
    name: str,
    deadline_sec: float,
) -> tuple[Any, SourceHealth]:
    """在獨立執行緒跑 fn；超過 deadline_sec 則記失敗並返回 (None, health)。

    注意：逾時後背景執行緒可能仍在跑（requests 讀死），但主執行緒會繼續下一源。
    """
    t0 = time.monotonic()
    if deadline_sec <= 0:
        h = SourceHealth(
            name=name, ok=False, elapsed_sec=0.0,
            error="source_deadline_exceeded", error_kind="deadline",
            skipped_by_deadline=True,
        )
        return None, h

    ex = ThreadPoolExecutor(max_workers=1)
    try:
        fut = ex.submit(fn)
        try:
            result = fut.result(timeout=float(deadline_sec))
        except FuturesTimeout:
            # 不 wait 執行緒；daemon-ish via shutdown(wait=False)
            h = SourceHealth(
                name=name, ok=False,
                elapsed_sec=time.monotonic() - t0,
                error=f"source_deadline_exceeded:{deadline_sec}s",
                error_kind="deadline",
                skipped_by_deadline=True,
            )
            return None, h
        except Exception as e:
            h = SourceHealth(
                name=name, ok=False,
                elapsed_sec=time.monotonic() - t0,
                error=f"{type(e).__name__}:{e}",
                error_kind="error",
            )
            return None, h
    finally:
        ex.shutdown(wait=False, cancel_futures=True)

    items, stats = result if isinstance(result, tuple) and len(result) == 2 else (result, {})
    n = len(items) if items is not None else 0
    st = dict(stats or {}) if isinstance(stats, dict) else {"raw_stats": stats}
    h = SourceHealth(
        name=name, ok=True, elapsed_sec=time.monotonic() - t0,
        item_count=n, stats=st,
    )
    return (items, st), h
