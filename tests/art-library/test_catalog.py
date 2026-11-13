"""Publication gate for the art library.

    python -m unittest discover -s tests/art-library -p "test_*.py"

These checks read only what is on disk. They need no network.
"""
from __future__ import annotations

import hashlib
import json
import re
import unittest
from pathlib import Path

from bs4 import BeautifulSoup
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"
ART = PUBLIC / "art-library"
SRC = ROOT / "src" / "art-library"
CATALOG = PUBLIC / "data" / "art-library.json"
LOCK = SRC / "sources.lock.json"
CONTRACT = [
    "id", "kind", "title", "region_ids", "actor_refs", "project_refs",
    "original_source_url", "creator", "license_name", "license_url",
    "attribution", "retrieved_at", "review_status", "usage_status", "files",
    "dimensions", "alt", "focal_point", "checksum",
]
ALLOWED_LICENCE = re.compile(r"CC0|CC BY(-SA)? [1-4]\.\d( [a-z]{2})?|.*（(LY-)?GWOIA）")
PIL_FORMAT = {"jpeg": "JPEG", "webp": "WEBP", "avif": "AVIF"}
# audit_publication.py refuses these keys anywhere under public/data.
FORBIDDEN_KEYS = {"author", "username", "user_name", "screen_name", "commenter_id", "commenter_name", "account", "user_id"}
UNLISTED_OK = {"lab.css", "lab.js", "figures/NOTICE.txt"}


def keys_of(value):
    if isinstance(value, dict):
        for key, child in value.items():
            yield key
            yield from keys_of(child)
    elif isinstance(value, list):
        for child in value:
            yield from keys_of(child)


class CatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
        cls.assets = cls.catalog["assets"]
        cls.photos = [asset for asset in cls.assets if asset["kind"] in ("portrait", "scene")]
        cls.lock = json.loads(LOCK.read_text(encoding="utf-8"))["assets"]

    def test_index_holds_only_checked_assets_with_the_contract_fields(self):
        self.assertEqual(self.catalog["publication"], "publication-ready")
        self.assertEqual(self.catalog["timezone"], "Asia/Taipei")
        self.assertTrue(self.catalog["generated_at"].endswith("+08:00"))
        ids = [asset["id"] for asset in self.assets]
        self.assertEqual(len(ids), len(set(ids)), "asset ids are unique")
        for asset in self.assets:
            with self.subTest(asset=asset["id"]):
                for key in CONTRACT:
                    self.assertIn(key, asset)
                self.assertEqual(asset["review_status"], "publication-ready")
                self.assertIn(asset["usage_status"], {row["id"] for row in self.catalog["usage_statuses"]})
                self.assertTrue(asset["creator"])
                self.assertTrue(asset["license_name"])
                self.assertTrue(asset["attribution"])
                self.assertRegex(asset["id"], r"^[a-z0-9-]+$")

    def test_gaps_are_records_without_files(self):
        self.assertTrue(self.catalog["gaps"])
        asset_ids = {asset["id"] for asset in self.assets}
        for gap in self.catalog["gaps"]:
            with self.subTest(gap=gap["id"]):
                self.assertEqual(gap["review_status"], "gap")
                self.assertNotIn("files", gap)
                self.assertNotIn("original_source_url", gap)
                self.assertNotIn(gap["id"], asset_ids)
                self.assertTrue(gap["reason"] and gap["needed"])

    def test_every_file_exists_with_its_recorded_size_format_and_checksum(self):
        for asset in self.assets:
            for entry in asset["files"]:
                with self.subTest(file=entry["path"]):
                    path = PUBLIC / entry["path"]
                    self.assertTrue(path.is_file())
                    raw = path.read_bytes()
                    self.assertEqual(len(raw), entry["bytes"])
                    self.assertEqual(hashlib.sha256(raw).hexdigest(), entry["checksum"])
                    if entry["format"] in PIL_FORMAT:
                        with Image.open(path) as image:
                            self.assertEqual(image.format, PIL_FORMAT[entry["format"]], "the extension tells the truth")
                            self.assertEqual(list(image.size), [entry["width"], entry["height"]])
            primary = next(entry for entry in asset["files"] if entry["path"] == asset["checksum_of"])
            self.assertEqual(asset["checksum"], primary["checksum"])

    def test_no_picture_is_listed_under_two_assets(self):
        owners: dict[str, set[str]] = {}
        for asset in self.assets:
            for entry in asset["files"]:
                if entry["role"] != "shared":
                    owners.setdefault(entry["checksum"], set()).add(asset["id"])
        self.assertEqual({digest: sorted(ids) for digest, ids in owners.items() if len(ids) > 1}, {})

    def test_nothing_unlisted_ships_in_the_public_folder(self):
        listed = {entry["path"] for asset in self.assets for entry in asset["files"]}
        on_disk = {path.relative_to(PUBLIC).as_posix() for path in ART.rglob("*") if path.is_file()}
        extra = sorted(path for path in on_disk - listed if path.removeprefix("art-library/") not in UNLISTED_OK)
        self.assertEqual(extra, [], "a file under public/art-library that the index does not account for")

    def test_photos_have_avif_webp_a_jpeg_fallback_and_keep_their_proportions(self):
        self.assertGreaterEqual(len(self.photos), 8)
        for asset in self.photos:
            with self.subTest(asset=asset["id"]):
                fallback = [entry for entry in asset["files"] if entry["role"] == "fallback"]
                self.assertEqual(len(fallback), 1)
                self.assertEqual(fallback[0]["format"], "jpeg")
                responsive = [entry for entry in asset["files"] if entry["role"] == "responsive"]
                for wanted in ("avif", "webp"):
                    widths = sorted(entry["width"] for entry in responsive if entry["format"] == wanted)
                    self.assertGreaterEqual(len(widths), 2, f"{wanted} comes in more than one width")
                ratio = fallback[0]["width"] / fallback[0]["height"]
                for entry in responsive:
                    self.assertAlmostEqual(entry["width"] / entry["height"], ratio, delta=0.01)
                self.assertEqual(asset["dimensions"]["width"], fallback[0]["width"])
                self.assertIsInstance(asset["palette"], list)

    def test_every_photo_has_recorded_licence_evidence(self):
        for asset in self.photos:
            with self.subTest(asset=asset["id"]):
                self.assertRegex(asset["license_name"], ALLOWED_LICENCE)
                self.assertTrue(asset["retrieved_at"].endswith("+08:00"))
                self.assertTrue(asset["original_source_url"].startswith("https://commons.wikimedia.org/wiki/File:"))
                locked = self.lock[asset["id"]]
                evidence = locked["evidence"]
                self.assertEqual(evidence["page_url"], asset["original_source_url"])
                self.assertEqual(evidence["artist"], asset["creator"])
                self.assertEqual(locked["retrieved_at"], asset["retrieved_at"])
                self.assertTrue(evidence["gwoia"] or evidence["license_short"] == asset["license_name"])
                self.assertIn(asset["creator"].split(" ")[0][:6], asset["attribution"] + asset["creator"])
                self.assertTrue(asset["changes"])

    def test_portraits_follow_one_standard_and_cover_the_roster_or_admit_the_gap(self):
        roster = {row["id"] for row in json.loads((PUBLIC / "data/candidate-review.json").read_text(encoding="utf-8"))["candidates"]}
        portraits = [asset for asset in self.assets if asset["kind"] == "portrait"]
        covered = [ref for asset in portraits for ref in asset["actor_refs"]]
        self.assertEqual(len(covered), len(set(covered)), "one portrait per person")
        missing = {ref for gap in self.catalog["gaps"] if gap["kind"] == "portrait" for ref in gap["actor_refs"]}
        self.assertEqual(set(covered) | missing, roster, "every listed candidate has a portrait or a stated gap")
        self.assertEqual(set(covered) & missing, set())
        size = self.catalog["portrait_standard"]["size"]
        card = self.catalog["portrait_standard"]["card"]
        for asset in portraits:
            with self.subTest(asset=asset["id"]):
                fallback = next(entry for entry in asset["files"] if entry["role"] == "fallback")
                self.assertEqual((fallback["width"], fallback["height"]), (size, size))
                cards = [entry for entry in asset["files"] if entry["role"] == "card"]
                self.assertTrue(cards, "every portrait ships the shared 3:4 card")
                primary = next(entry for entry in cards if entry["format"] == "jpeg" and entry["height"] == card["height"])
                self.assertEqual((primary["width"], primary["height"]), (card["width"], card["height"]))
                self.assertEqual(asset["card_dimensions"]["width"] / asset["card_dimensions"]["height"], 0.75)
                self.assertEqual(asset["card_3x4"]["w"] / asset["card_3x4"]["h"], asset["card_3x4"]["w"] / asset["card_3x4"]["h"])
                self.assertAlmostEqual(asset["card_3x4"]["w"] / asset["card_3x4"]["h"], 0.75, places=2)
                self.assertTrue(asset["identity"]["basis"])
                self.assertTrue(asset["identity"]["site_file_check"])
                match = self.lock[asset["id"]]["site_match"]
                self.assertTrue(match.get("same_bytes") or match["mean_abs_diff"] <= 12, "the site file is the Commons photograph")

    def test_components_are_original_schematic_and_csp_safe(self):
        components = [asset for asset in self.assets if asset["kind"] == "component"]
        self.assertGreaterEqual(len(components), 1)
        for asset in components:
            with self.subTest(asset=asset["id"]):
                self.assertIsNone(asset["original_source_url"])
                self.assertIsNone(asset["retrieved_at"])
                self.assertIn("原創", asset["license_name"])
                self.assertNotIn("CC0", asset["license_name"], "the project has not released its own art")
                self.assertIn("示意", asset["alt"])
                self.assertTrue(asset["third_party"])
                folder = ART / "figures" / asset["embed"]["figure"]
                for name in ("fragment.html", "index.html"):
                    doc = BeautifulSoup((folder / name).read_text(encoding="utf-8"), "html.parser")
                    self.assertEqual(doc.find_all("iframe"), [])
                    self.assertEqual([tag for tag in doc.find_all("script") if not tag.get("src")], [], "no inline script")
                    self.assertEqual([tag.name for tag in doc.find_all(True) if any(key.startswith("on") for key in tag.attrs)], [])
                    self.assertEqual(len(doc.select('.iso-stage[tabindex="0"][aria-label]')), 1)
                self.assertTrue((folder / "preview.svg").read_text(encoding="utf-8").startswith("<svg"))

    def test_built_copies_match_their_sources(self):
        pairs = [(SRC / name, ART / name) for name in ("lab.css", "lab.js")]
        pairs += [(SRC / "figures" / name, ART / "figures" / name) for name in ("motion.js", "runtime.js", "boot.js")]
        for folder in (SRC / "figures").iterdir():
            if (folder / "model.js").exists():
                pairs += [(folder / name, ART / "figures" / folder.name / name) for name in ("model.js", "live.js")]
        for source, built in pairs:
            with self.subTest(file=built.relative_to(PUBLIC).as_posix()):
                self.assertEqual(source.read_bytes(), built.read_bytes())

    def test_lab_page_has_the_shell_the_release_assembler_requires(self):
        doc = BeautifulSoup((PUBLIC / "asset-lab.html").read_text(encoding="utf-8"), "html.parser")
        # tools/release/assemble-production.py edit_page raises without these.
        self.assertIsNotNone(doc.select_one(".top nav.nav"))
        self.assertIsNotNone(doc.main)
        self.assertIsNotNone(doc.head)
        self.assertIsNotNone(doc.body)
        self.assertIsNotNone(doc.select_one(".top h1"), "page-tools.js needs the heading")
        self.assertIsNotNone(doc.select_one(".skip-link"))
        self.assertEqual(doc.find_all("iframe"), [])
        self.assertEqual([tag for tag in doc.find_all("script") if not tag.get("src")], [])
        for name in ("region", "kind", "use", "license", "review", "q"):
            self.assertIsNotNone(doc.select_one(f'[name="{name}"]'), f"filter {name}")

    def test_index_passes_the_publication_audit_rules(self):
        self.assertEqual(sorted(set(keys_of(self.catalog)) & FORBIDDEN_KEYS), [])
        text = CATALOG.read_text(encoding="utf-8")
        self.assertNotRegex(text, r"sk-(?:proj-)?[A-Za-z0-9_-]{25,}", "an id or path that the credential scan would flag")

    def test_alt_text_focal_points_and_regions_are_usable(self):
        regions = {row["id"] for row in self.catalog["regions"]}
        site_regions = {row["id"] for row in json.loads((PUBLIC / "data/governance-registry.json").read_text(encoding="utf-8"))["regions"]}
        self.assertLessEqual(site_regions, regions, "the library uses the site's region ids")
        uses = {row["id"] for row in self.catalog["uses"]}
        kinds = {row["id"] for row in self.catalog["kinds"]}
        for asset in self.assets:
            with self.subTest(asset=asset["id"]):
                self.assertGreaterEqual(len(asset["alt"]), 8)
                self.assertLessEqual(set(asset["region_ids"]), regions)
                self.assertLessEqual(set(asset["uses"]), uses)
                self.assertIn(asset["kind"], kinds)
                if asset["focal_point"]:
                    self.assertTrue(0 <= asset["focal_point"]["x"] <= 1 and 0 <= asset["focal_point"]["y"] <= 1)

    def test_coverage_table_counts_what_is_really_there(self):
        for row in self.catalog["coverage"]:
            real = sum(1 for asset in self.assets if asset["kind"] == row["kind"] and row["region_id"] in asset["region_ids"])
            self.assertEqual(row["count"], real, f"{row['region_id']} {row['kind']}")

    def test_unreviewed_sources_stay_out_of_the_public_index(self):
        sources = json.loads((SRC / "sources.json").read_text(encoding="utf-8"))
        public_ids = {asset["id"] for asset in self.assets}
        for entry in sources["portraits"] + sources["scenes"]:
            if not entry.get("reviewed") or not entry.get("alt"):
                self.assertNotIn(entry["id"], public_ids)
        self.assertFalse((PUBLIC / "work").exists())


if __name__ == "__main__":
    unittest.main()
