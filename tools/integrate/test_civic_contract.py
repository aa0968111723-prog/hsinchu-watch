import copy
import json
import subprocess
import unittest
from pathlib import Path

from baseline import ROOT, collect
from civic_contract import validate_geography, validate_project, validate_record, validate_source

NODE_TEST = Path(__file__).with_name("test-civic-adapter.mjs")


class CivicContractTests(unittest.TestCase):
    def test_adapter_and_refresh_policy(self):
        subprocess.run(["node", str(NODE_TEST)], cwd=ROOT, check=True)

    def test_source_record_project_and_geography_rules(self):
        source = {
            "id": "ly-data", "name": "立法院開放資料", "kind": "national_catalog",
            "url": "https://data.ly.gov.tw/", "region_ids": [], "access_method": "public_page",
            "coverage_note": "目錄，不是逐筆法案", "last_attempt_at": None,
            "last_success_at": None, "next_due_at": None, "health": "unknown",
        }
        validate_source(source)
        claimed = copy.deepcopy(source)
        claimed["health"] = "ok"
        with self.assertRaisesRegex(ValueError, "last_success_at"):
            validate_source(claimed)

        record = {
            "id": "story-1", "kind": "news", "source_id": None,
            "source_url": "https://example.com/story", "published_at": "2026-11-01",
            "collected_at": None, "checked_at": None, "actor_refs": ["wu"],
            "region_refs": [], "claim_origin": "report", "verification_status": "reported",
            "verification_basis": "archive_record", "stats_eligible": True,
            "response_in_record": None,
        }
        validate_record(record)
        weak = copy.deepcopy(record)
        weak["verification_status"] = "corroborated"
        weak["verification_basis"] = "http_status"
        with self.assertRaisesRegex(ValueError, "corroborate"):
            validate_record(weak)
        replied = copy.deepcopy(record)
        replied["responded"] = False
        with self.assertRaisesRegex(ValueError, "never responded"):
            validate_record(replied)

        project = {
            "id": "sample-road", "title": "樣本道路", "region_id": "hsinchu-county",
            "budget": {"approved_twd": 10, "contract_twd": None, "spent_twd": None},
            "progress": {"value": 100, "means": "reported_progress"},
            "acceptance": None, "operation": None, "outcome": None,
            "missing_evidence": ["驗收"],
        }
        validate_project(project)
        inferred = copy.deepcopy(project)
        inferred["outcome"] = {"label": "完成"}
        with self.assertRaisesRegex(ValueError, "outcome"):
            validate_project(inferred)

        unknown = {"id": "sample-road", "geometry": None, "location_precision": "unknown", "coordinate_source": None}
        validate_geography(unknown)
        invented = {
            "id": "sample-road",
            "geometry": {"type": "Point", "coordinates": [121.0, 24.8]},
            "location_precision": "site",
            "coordinate_source": {"url": "https://example.com/map", "checked_at": "2026-11-12", "basis": "city_center"},
        }
        with self.assertRaisesRegex(ValueError, "City center"):
            validate_geography(invented)

    def test_navigation_matches_sections_and_baseline_keeps_published_rows(self):
        report = collect()
        self.assertEqual(report["problems"], [], json.dumps(report["problems"], ensure_ascii=False))
        self.assertGreaterEqual(report["measured"]["payload_files"], 20)
        self.assertEqual(report["measured"]["archive_by_kind"]["news"], report["measured"]["items_rows"])
        self.assertEqual(report["measured"]["archive_by_kind"]["policy"], report["measured"]["policies"])
        self.assertEqual(report["measured"]["archive_by_kind"]["source"], report["measured"]["source_index_entries"])
        self.assertIn("civic.html", report["pages"]["root"])
