import copy
import json
from pathlib import Path
import subprocess
import unittest
from candidate_review_schema import validate

ROOT = Path(__file__).resolve().parents[2]


class CandidateReviewTests(unittest.TestCase):
    def setUp(self):
        self.registry = json.loads((ROOT/'public/data/candidate-review.json').read_bytes())

    def test_official_roster_includes_all_six_and_not_commentators(self):
        validate(self.registry)
        by_race = {race['id']: [p['name'] for p in sorted(self.registry['candidates'], key=lambda p: p['ballot_number']) if p['race_id'] == race['id']] for race in self.registry['races']}
        self.assertEqual(by_race['county_magistrate'], ['鄭朝方', '徐欣瑩', '朱定瑀'])
        self.assertEqual(by_race['zhubei_mayor'], ['吳旭智', '曾聖凱', '邱臣遠'])
        self.assertEqual(len(self.registry['candidates']), 6)

    def test_duplicate_number_and_nonofficial_roster_rejected(self):
        wrong = copy.deepcopy(self.registry)
        wrong['candidates'][1]['ballot_number'] = 1
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            validate(wrong)
        wrong = copy.deepcopy(self.registry)
        wrong['sources'][0]['url'] = 'https://example.com/candidates'
        with self.assertRaisesRegex(ValueError, 'official'):
            validate(wrong)

    def test_importer_does_not_infer_response_from_notes(self):
        import runpy
        module = runpy.run_path(str(ROOT/"scripts/build_policies.py"))
        normalize = module["derive_responded"]
        self.assertEqual(set(module["ORDER"]), {p["id"] for p in self.registry["candidates"]})
        self.assertIsNone(normalize({"controversy": True, "note": "報導未載回應"}))
        self.assertIsNone(normalize({"controversy": True, "note": "尚未核對市長回應"}))
        self.assertFalse(normalize({"responded": False}))
        self.assertTrue(normalize({"responded": True}))

    def test_review_selection_preserves_claim_and_response_distinctions(self):
        subprocess.run(['node', str(ROOT/'tools/release/test-review-model.mjs')], cwd=ROOT, check=True)
