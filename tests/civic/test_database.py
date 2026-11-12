"""The civic database keeps legacy rows, nulls, and anonymous comments."""
import json
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from collectors.civic.database import build_database


class DatabaseTests(unittest.TestCase):
    def test_nulls_roster_and_anonymous_comments(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = root / "public" / "data"
            observations = root / "public" / "observations"
            data.mkdir(parents=True)
            observations.mkdir()
            (data / "items.json").write_text(json.dumps([
                {"id": "a1", "title": "報導", "url": "https://example.com/a", "person_id": "wu", "counts_in_stats": False}
            ]), encoding="utf-8")
            (data / "items_wu.json").write_text(json.dumps([
                {"id": "a1", "title": "報導", "url": "https://example.com/a", "person_id": "wu"},
                {"id": "only-split", "title": "只在分檔", "url": "https://example.com/b", "person_id": "wu"},
            ]), encoding="utf-8")
            (data / "policies.json").write_text("[]", encoding="utf-8")
            (data / "governance.json").write_text(json.dumps({"projects": [{
                "id": "p1", "title": "工程", "region_id": "taipei", "budget": {"approved_twd": 10, "spent_twd": None},
                "progress": {"value": 100, "as_of": None}, "missing_evidence": ["驗收"], "events": [],
            }]}), encoding="utf-8")
            (data / "candidate-review.json").write_text(json.dumps({
                "races": [{"id": "county_magistrate", "name": "新竹縣長"}],
                "candidates": [{"id": "wu", "name": "吳旭智", "race_id": "county_magistrate", "ballot_number": 1}],
            }), encoding="utf-8")
            (data / "issue_stances.json").write_text(json.dumps({"issues": [{
                "id": "housing",
                "stances": {"chen": {"person_id": "chen", "found": False, "summary": None}},
            }]}), encoding="utf-8")
            (observations / "sources.json").write_text(json.dumps({
                "people": {"chen": {"name": "陳見賢", "status": "曾參與初選"}},
                "entries": [{"title": "索引", "url": "https://example.com/s", "date": "2026-11-12", "source": "報", "personIds": ["chen"]}],
            }), encoding="utf-8")
            (observations / "comments.json").write_text(json.dumps({
                "people": {},
                "threads": {"t1": {"url": "https://www.ptt.cc/bbs/Hsinchu/M.1.html", "platform": "PTT"}},
                "entries": [{
                    "commentId": "ptt-secret-account",
                    "thread": "t1",
                    "personId": "wu",
                    "kind": "neg",
                    "at": "2026-11-09T00:00:00+08:00",
                    "summary": "反對這項說法。",
                }],
            }), encoding="utf-8")
            counts = build_database(root)
            self.assertEqual(counts["articles_from_items"], 1)
            self.assertEqual(counts["article_split_overlap"], 1)
            self.assertEqual(counts["article_split_extras"], 1)
            database = root / "public" / "data" / "civic" / "watch.sqlite"
            blob = database.read_bytes()
            self.assertNotIn("ptt-secret-account".encode(), blob)
            conn = sqlite3.connect(database)
            spent, progress, progress_as_of = conn.execute(
                "SELECT spent_twd, progress_value, progress_as_of FROM projects WHERE id='p1'"
            ).fetchone()
            self.assertIsNone(spent)
            self.assertEqual(progress, 100)
            self.assertIsNone(progress_as_of)
            geometry = conn.execute("SELECT geometry FROM projects WHERE id='p1'").fetchone()[0]
            self.assertIsNone(geometry)
            self.assertEqual(conn.execute("SELECT has_statement FROM issue_stances").fetchone()[0], "absent")
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM candidates").fetchone()[0], 1)
            self.assertEqual(conn.execute("SELECT on_official_roster FROM mentioned_people WHERE id='chen'").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT summary FROM comments").fetchone()[0], "反對這項說法。")
            conn.close()


if __name__ == "__main__":
    unittest.main()
