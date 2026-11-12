import json
import re
import unittest
from datetime import date
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]


class GovernanceTests(unittest.TestCase):
    def setUp(self):
        self.data = json.loads((ROOT / 'public/data/governance.json').read_bytes())
        self.registry = json.loads((ROOT / 'public/data/governance-registry.json').read_bytes())

    def test_release_validator_rejects_invented_or_invalid_measurements(self):
        from governance_schema import validate
        import copy
        validate(self.data, self.registry)
        wrong = copy.deepcopy(self.data)
        wrong["projects"][2]["progress"]["value"] = 101
        with self.assertRaisesRegex(ValueError, "progress"):
            validate(wrong, self.registry)
        wrong = copy.deepcopy(self.data)
        wrong["projects"][0]["target"]["precision"] = "day"
        with self.assertRaisesRegex(ValueError, "precision"):
            validate(wrong, self.registry)

    def test_references_dates_and_numeric_provenance(self):
        sources = {s['id']: s for s in self.registry['sources']}
        self.assertEqual(len(sources), len(self.registry['sources']))
        regions = {r['id'] for r in self.registry['regions']}
        topics = {t['id'] for t in self.registry['topics']}
        for source in sources.values():
            parsed = urlsplit(source['url'])
            self.assertEqual(parsed.scheme, 'https')
            self.assertTrue(parsed.hostname.endswith(('.gov.tw', '.taipei')))
            self.assertFalse(parsed.username or parsed.password)
            date.fromisoformat(source['checked_at'])
            if source['source_updated_at']:
                self.assertLessEqual(date.fromisoformat(source['source_updated_at']), date.fromisoformat(source['checked_at']))
        ids = set()
        for project in self.data['projects']:
            self.assertNotIn(project['id'], ids)
            self.assertRegex(project['id'], r'^[a-z0-9-]+$')
            ids.add(project['id'])
            self.assertIn(project['region_id'], regions)
            self.assertIn(project['topic_id'], topics)
            self.assertTrue(project['events'])
            for event in project['events']:
                self.assertIn(event['source_id'], sources)
                self.assertRegex(event['date'], r'^\d{4}-\d{2}$' if event['precision'] == 'month' else r'^\d{4}-\d{2}-\d{2}$')
                date.fromisoformat(event['date'] + '-01' if event['precision'] == 'month' else event['date'])
            if project['progress'] is not None:
                self.assertIn(project['progress']['source_id'], sources)
                self.assertLessEqual(0, project['progress']['value'])
                self.assertLessEqual(project['progress']['value'], 100)
            if project['budget'] is not None:
                self.assertIn(project['budget']['source_id'], sources)
                for key in ('approved_twd', 'contract_twd', 'spent_twd'):
                    value = project['budget'][key]
                    self.assertTrue(value is None or isinstance(value, int) and value >= 0)
        self.assertEqual({p['region_id'] for p in self.data['projects']}, regions)

    def test_source_limits_are_not_replaced_with_inferred_facts(self):
        projects = {p['id']: p for p in self.data['projects']}
        bridge = projects['new-taipei-siyuan-footbridge']
        self.assertEqual(bridge['progress']['value'], 77.25)
        self.assertIsNone(bridge['progress']['as_of'])
        housing = projects['taipei-peiying-housing']
        self.assertEqual(housing['progress']['value'], 100)
        self.assertEqual(housing['phase'], 'handover_preparation')
        self.assertEqual(housing['events'][-1]['date'], '2026-09')
        road = projects['hsinchu-county-baozhong-road']
        self.assertIsNone(road['progress'])
        self.assertIsNone(road['budget']['spent_twd'])
        self.assertEqual(road['target']['value'], '2028-10')
        self.assertEqual(road['target']['precision'], 'month')
        self.assertIsNone(projects['hsinchu-city-xiangshan-four']['progress'])


if __name__ == '__main__':
    unittest.main()
