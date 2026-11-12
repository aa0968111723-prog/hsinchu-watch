import json
from pathlib import Path
import tempfile
import unittest
from datetime import datetime
from recover_public_data import merge, rebuild_statistics, read, write, TPE


class RecoveryTests(unittest.TestCase):
    def test_publication_rejects_legacy_ui(self):
        from prepare_release import prepare
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "index.html").write_text("<main>old UI</main>")
            with self.assertRaisesRegex(ValueError, "superseded UI"):
                prepare(root)

    def test_publication_rejects_data_loss_even_with_newer_ui(self):
        from prepare_release import prepare
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name, marker in {"index.html": 'id="pulseView"', "compare.html": 'id="metricCards" id="candidateReview"',
                                 "archive.html": 'id="archiveBoard"', "governance.html": 'id="governanceBoard"', "maps.html": 'maps-mobile-', "commentary.html": 'watch-comments'}.items():
                (root / name).write_text(marker + '<link href="/assets/editorial-depth-fixture.css"><script src="/assets/page-tools-fixture.js"></script>')
            self.snapshot(root, "2026-11-12T12:00:00+08:00", [])
            stats = read(root / "data/stats.json")
            stats["total_rows"] = 0
            write(root / "data/stats.json", stats)
            with self.assertRaisesRegex(ValueError, "recovery baseline"):
                prepare(root)

    def snapshot(self, root, stamp, rows):
        (root / "data").mkdir(parents=True)
        for name, value in {
            "items.json": rows, "policies.json": [], "polls.json": [],
            "stats.json": {"generated_at": stamp, "by_person": {"wu": {"name": "吳旭智"}}},
            "manifest.json": {"counts": {"items_rows": len(rows)}}
        }.items():
            write(root / "data" / name, value)

    def test_old_snapshot_keeps_new_correction_and_archive_exclusion(self):
        with tempfile.TemporaryDirectory() as directory:
            old, current = Path(directory) / "old", Path(directory) / "current"
            base = {"url": "https://example.com/a", "person_id": "wu", "sentiment": "pos"}
            corrected = {**base, "sentiment": "neu", "counts_in_stats": False}
            extra = {**base, "url": "https://example.com/b", "counts_in_stats": False,
                     "sentiment_reason": "不留中立所以標偏正"}
            self.snapshot(old, "2026-11-10T12:00:00+08:00", [base])
            self.snapshot(current, "2026-11-12T04:00:00Z", [corrected, extra])
            merge(old, current)
            rows = read(old / "data/items.json")
            self.assertEqual(len(rows), 2)
            self.assertTrue(all(row["sentiment"] == "neu" for row in rows))
            self.assertTrue(all(row["counts_in_stats"] is False for row in rows))
            self.assertEqual(read(old / "data/stats.json")["total_items"], 0)

    def test_new_snapshot_correction_wins_and_new_record_survives(self):
        with tempfile.TemporaryDirectory() as directory:
            incoming, current = Path(directory) / "incoming", Path(directory) / "current"
            row = {"url": "https://example.com/a", "person_id": "wu", "sentiment": "pos"}
            correction = {**row, "sentiment": "neu"}
            other = {**row, "url": "https://example.com/b"}
            self.snapshot(current, "2026-11-10T12:00:00+08:00", [row])
            self.snapshot(incoming, "2026-11-12T12:00:00+08:00", [correction, other])
            merge(incoming, current)
            rows = {row["url"]: row for row in read(incoming / "data/items.json")}
            self.assertEqual(rows[row["url"]]["sentiment"], "neu")
            self.assertEqual(len(rows), 2)

    def test_periods_exclude_future_and_review_only_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            row = {"url": "https://example.com/a", "person_id": "wu", "published_at": "2026-11-12T05:00:00+08:00"}
            rows = [row, {**row, "url": "https://example.com/b", "published_at": "2026-11-12T08:00:00+08:00"},
                    {**row, "url": "https://example.com/c", "counts_in_stats": False},
                    {**row, "url": "https://example.com/d", "review_status": "pending"}]
            self.snapshot(root, "2026-11-12T06:00:00+08:00", rows)
            rebuild_statistics(root, rows, datetime(2026, 11, 12, 6, tzinfo=TPE))
            stats = read(root / "data/stats.json")
            self.assertEqual(stats["by_person"]["wu"]["last_24h"], 1)
            self.assertEqual(stats["by_person"]["wu"]["last_7d"], 1)
            self.assertEqual(stats["total_items"], 2)
            self.assertEqual(stats["total_rows"], 4)


if __name__ == "__main__":
    unittest.main()
