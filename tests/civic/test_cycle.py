"""Dedupe, contact stripping, and failure retention for the civic cycle."""
import json
import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from collectors.civic.catalog import GAPS, SOURCES
from collectors.civic.cycle import content_hash, run_cycle
from collectors.civic.parsers import parse_pcc_tenders, parse_rss
from collectors.civic.textutil import public_excerpt

NOW = datetime(2026, 11, 13, 1, 0, tzinfo=timezone(timedelta(hours=8)))
RSS = """<?xml version="1.0"?>
<rss><channel>
<item>
  <title>道路開工</title>
  <link>https://example.com/a</link>
  <pubDate>Thu, 12 Nov 2026 01:00:00 GMT</pubDate>
  <description>縣府說明工程已開工。電話 03-5216121。信箱 hc@example.com</description>
</item>
<item>
  <title>道路開工</title>
  <link>https://example.com/a</link>
  <pubDate>Thu, 12 Nov 2026 01:00:00 GMT</pubDate>
  <description>縣府說明工程已開工。電話 03-5216121。信箱 hc@example.com</description>
</item>
</channel></rss>""".encode()
ATOM = """<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>新竹路況</title>
    <author><name>secretuser</name></author>
    <link href="https://www.ptt.cc/bbs/Hsinchu/M.1.html"/>
    <published>2026-11-12T10:00:00Z</published>
    <summary>作者 secretuser 的內文不應被保存</summary>
  </entry>
</feed>""".encode()
NTPC = json.dumps([{
    "id": "202611120001",
    "title": "開工",
    "dataClass": "焦點新聞",
    "description": "市府宣布開工。資料詳洽：楊先生 02-29603456 user@ntpc.gov.tw",
    "startDate": "11/12/2026",
    "mgrTel": "02-29603456",
    "PublishMail": "user@ntpc.gov.tw",
}]).encode()


class Response:
    def __init__(self, status, body=b"", etag=None):
        self.status = status
        self.body = body
        self.etag = etag
        self.last_modified = None
        self.url = "https://example.com"


class CycleTests(unittest.TestCase):
    def test_excerpt_drops_contacts(self):
        text = public_excerpt("說明。資料詳洽 王先生 02-2960-3456 a@b.tw 之後不留")
        self.assertNotIn("02-2960-3456", text)
        self.assertNotIn("a@b.tw", text)
        self.assertNotIn("之後不留", text)

    def test_dedupe_and_strip(self):
        spec = dict(SOURCES[0])
        spec["parser"] = "rss"
        calls = {"n": 0}

        def fetch(source, state):
            calls["n"] += 1
            return Response(200, RSS, etag="v1")

        root = Path(self.id().replace(".", "_"))
        # isolate under temp via TemporaryDirectory in each test
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            summary = run_cycle(root=root, now=NOW, fetch=fetch, sources=[spec], gaps=[], write_matrix=False)
            records = json.loads((root / "public/data/civic/records.json").read_text(encoding="utf-8"))["records"]
            self.assertEqual(len(records), 1)
            self.assertEqual(summary["feed"]["status"], "ok")
            blob = json.dumps(records, ensure_ascii=False)
            self.assertNotIn("03-5216121", blob)
            self.assertNotIn("hc@example.com", blob)
            self.assertFalse(records[0]["stats_eligible"])
            self.assertEqual(records[0]["verification_status"], "unreviewed")
            self.assertEqual(records[0]["published_at"][:10], "2026-11-12")

    def test_failure_keeps_previous_records(self):
        spec = dict(SOURCES[2])
        spec["id"] = "county"
        spec["parser"] = "rss"
        import tempfile

        def ok_fetch(source, state):
            return Response(200, RSS)

        def bad_fetch(source, state):
            raise RuntimeError("network down")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_cycle(root=root, now=NOW, fetch=ok_fetch, sources=[spec], gaps=[], write_matrix=False)
            before = (root / "public/data/civic/records.json").read_text(encoding="utf-8")
            before_hash = content_hash(json.loads(before)["records"])
            later = NOW + timedelta(hours=2)
            summary = run_cycle(root=root, now=later, fetch=bad_fetch, sources=[spec], gaps=[], force=True, write_matrix=False)
            after = json.loads((root / "public/data/civic/records.json").read_text(encoding="utf-8"))
            source = json.loads((root / "public/data/civic/sources.json").read_text(encoding="utf-8"))["sources"][0]
            self.assertEqual(content_hash(after["records"]), before_hash)
            self.assertEqual(summary["status"], "failed")
            self.assertEqual(source["health"], "error")
            self.assertEqual(source["last_success_at"], "2026-11-13T01:00:00+08:00")
            self.assertEqual(len(after["records"]), 1)

    def test_not_modified_and_backoff_skip(self):
        spec = dict(SOURCES[0])
        spec["parser"] = "rss"
        spec["interval_minutes"] = 20
        import tempfile
        calls = {"n": 0}

        def fetch(source, state):
            calls["n"] += 1
            if calls["n"] == 1:
                return Response(200, RSS, etag="v1")
            return Response(304, b"", etag="v1")

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_cycle(root=root, now=NOW, fetch=fetch, sources=[spec], gaps=[], write_matrix=False)
            run_cycle(root=root, now=NOW + timedelta(minutes=30), fetch=fetch, sources=[spec], gaps=[], force=True, write_matrix=False)
            third = run_cycle(root=root, now=NOW + timedelta(minutes=35), fetch=fetch, sources=[spec], gaps=[], write_matrix=False)
            self.assertEqual(calls["n"], 2)
            self.assertEqual(third["reports"][0]["result"], "skipped")

    def test_atom_drops_author_and_ntpc_ignores_contact_fields(self):
        ptt = next(row for row in SOURCES if row["id"] == "ptt-hsinchu-atom")
        ntpc = next(row for row in SOURCES if row["id"] == "ntpc-news-json")
        import tempfile

        def fetch(source, state):
            if source["id"] == "ptt-hsinchu-atom":
                return Response(200, ATOM)
            return Response(200, NTPC)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_cycle(root=root, now=NOW, fetch=fetch, sources=[ptt, ntpc], gaps=GAPS[:1], write_matrix=False)
            blob = (root / "public/data/civic/records.json").read_text(encoding="utf-8")
            self.assertNotIn("secretuser", blob)
            self.assertNotIn("user@ntpc.gov.tw", blob)
            self.assertNotIn("02-29603456", blob)
            records = json.loads(blob)["records"]
            ntpc_row = next(row for row in records if row["source_id"] == "ntpc-news-json")
            self.assertEqual(ntpc_row["published_at"], "2026-11-12")
            self.assertEqual(ntpc_row["date_precision"], "day")
            self.assertIn("開工", ntpc_row["text_excerpt"])
            self.assertNotIn("mgrTel", blob)

    def test_correction_on_title_change(self):
        spec = dict(SOURCES[0])
        spec["parser"] = "rss"
        second = RSS.replace("道路開工".encode(), "道路開工更正".encode())
        import tempfile
        calls = {"n": 0}

        def fetch(source, state):
            calls["n"] += 1
            return Response(200, RSS if calls["n"] == 1 else second)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_cycle(root=root, now=NOW, fetch=fetch, sources=[spec], gaps=[], write_matrix=False)
            run_cycle(root=root, now=NOW + timedelta(hours=1), fetch=fetch, sources=[spec], gaps=[], force=True, write_matrix=False)
            records = json.loads((root / "public/data/civic/records.json").read_text(encoding="utf-8"))["records"]
            corrections = json.loads((root / "public/data/civic/corrections.json").read_text(encoding="utf-8"))["corrections"]
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["title"], "道路開工更正")
            self.assertEqual(corrections[0]["fields"]["title"]["previous"], "道路開工")
            self.assertEqual(records[0]["verification_status"], "unreviewed")

    def test_missing_date_stays_null(self):
        spec = dict(SOURCES[0])
        body = """<?xml version="1.0"?><rss><channel><item>
            <title>沒有日期</title><link>https://example.com/nodate</link>
            </item></channel></rss>""".encode()
        import tempfile

        def fetch(source, state):
            return Response(200, body)

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_cycle(root=root, now=NOW, fetch=fetch, sources=[spec], gaps=[], write_matrix=False)
            row = json.loads((root / "public/data/civic/records.json").read_text(encoding="utf-8"))["records"][0]
            self.assertIsNone(row["published_at"])
            self.assertIsNone(row["date_precision"])

    def test_namespaced_empty_title_does_not_wipe_item(self):
        spec = dict(SOURCES[2])
        body = """<?xml version="1.0"?>
        <rss xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><item>
          <title>縣府新聞</title>
          <link>https://www.hsinchu.gov.tw/News_Content.aspx?n=153&amp;s=1</link>
          <description>供氣維護</description>
          <pubDate>Thu, 12 Nov 2026 09:17:00 GMT</pubDate>
          <dc:title />
        </item></channel></rss>""".encode()
        rows = parse_rss(spec, body)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "縣府新聞")

    def test_pcc_tender_filters_governments_and_leaves_amount_absent(self):
        spec = next(row for row in SOURCES if row["id"] == "pcc-award-xml")
        body = """<?xml version="1.0"?><TENDER_LIST>
          <TENDER>
            <AWARD_DATE>2026/11/03</AWARD_DATE>
            <TENDER_ORG_NAME>臺北市政府工務局</TENDER_ORG_NAME>
            <TENDER_CASE_NO>A1</TENDER_CASE_NO>
            <TENDER_NAME>道路工程</TENDER_NAME>
            <TENDER_AWARD_PRICE>27500000</TENDER_AWARD_PRICE>
            <CONTACT_PERSON>王先生</CONTACT_PERSON>
            <TENDER_TEL>02-27208888</TENDER_TEL>
          </TENDER>
          <TENDER>
            <AWARD_DATE>2026/11/02</AWARD_DATE>
            <TENDER_ORG_NAME>臺北榮民總醫院</TENDER_ORG_NAME>
            <TENDER_CASE_NO>B1</TENDER_CASE_NO>
            <TENDER_NAME>敷料</TENDER_NAME>
          </TENDER>
          <TENDER>
            <AWARD_DATE>2026/11/01</AWARD_DATE>
            <TENDER_ORG_NAME>新竹縣政府</TENDER_ORG_NAME>
            <TENDER_CASE_NO>C1</TENDER_CASE_NO>
            <TENDER_NAME>道路拓寬</TENDER_NAME>
          </TENDER>
        </TENDER_LIST>""".encode()
        rows = parse_pcc_tenders(spec, body)
        self.assertEqual([row["region_refs"] for row in rows], [["taipei"], ["hsinchu-county"]])
        self.assertEqual(rows[0]["published_at"], "2026-11-03")
        blob = json.dumps(rows, ensure_ascii=False)
        self.assertIn("27500000", blob)
        self.assertNotIn("王先生", blob)
        self.assertNotIn("02-27208888", blob)
        self.assertNotIn("敷料", blob)
        self.assertIn("不是支用或驗收", rows[0]["text_excerpt"])


if __name__ == "__main__":
    unittest.main()
