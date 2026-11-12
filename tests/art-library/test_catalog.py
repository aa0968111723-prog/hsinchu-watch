"""Publication gate for the art library index."""
from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"
CATALOG = PUBLIC / "data" / "art-library.json"
REQUIRED = [
    "id", "kind", "title", "region_ids", "actor_refs", "project_refs",
    "original_source_url", "creator", "license_name", "license_url",
    "attribution", "retrieved_at", "review_status", "usage_status", "files",
    "dimensions", "alt", "focal_point", "checksum",
]
PENDING_MARKERS = ["chiu.jpg", "朱定瑀", "曾聖凱", "邱臣遠"]


class ArtLibraryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.catalog = json.loads(CATALOG.read_text(encoding="utf-8"))

    def test_public_index_is_publication_ready_only(self):
        self.assertEqual(self.catalog["publication"], "publication-ready")
        self.assertEqual(self.catalog["timezone"], "Asia/Taipei")
        self.assertGreaterEqual(len(self.catalog["assets"]), 1)
        for asset in self.catalog["assets"]:
            self.assertEqual(asset["review_status"], "publication-ready")
            for key in REQUIRED:
                self.assertIn(key, asset)
            self.assertIsNotNone(asset["creator"])
            self.assertIsNotNone(asset["license_name"])
            self.assertTrue(asset["retrieved_at"].endswith("+08:00"))

    def test_files_exist_and_match_checksums(self):
        seen = {}
        for asset in self.catalog["assets"]:
            primary = asset["checksum"]
            self.assertRegex(primary, r"^[0-9a-f]{64}$")
            for record in asset["files"]:
                path = PUBLIC / record["path"]
                self.assertTrue(path.exists(), record["path"])
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                self.assertEqual(digest, record["checksum"])
                if record["mime"].startswith("image/") and record["mime"] != "image/svg+xml":
                    with Image.open(path) as image:
                        self.assertEqual(list(image.size), [record["width"], record["height"]])
                seen.setdefault(digest, []).append(asset["id"] + ":" + record["role"])
        collisions = {digest: rows for digest, rows in seen.items() if len({row.split(':')[0] for row in rows}) > 1}
        self.assertEqual(collisions, {})

    def test_portraits_share_square_treatment(self):
        portraits = [asset for asset in self.catalog["assets"] if asset["kind"] == "portrait"]
        self.assertGreaterEqual(len(portraits), 3)
        for asset in portraits:
            self.assertEqual(asset["dimensions"]["width"], asset["dimensions"]["height"])
            self.assertGreaterEqual(asset["dimensions"]["width"], 256)
            roles = {record["role"] for record in asset["files"]}
            self.assertTrue({"original", "web", "thumb"} <= roles or {"fallback", "web", "thumb"} <= roles)
            self.assertIn("image/avif", {record["mime"] for record in asset["files"]})
            self.assertIn("image/webp", {record["mime"] for record in asset["files"]})

    def test_component_is_present_and_schematic(self):
        components = [asset for asset in self.catalog["assets"] if asset["kind"] == "component"]
        self.assertEqual([asset["id"] for asset in components], ["component-evidence-bench"])
        text = json.dumps(components[0], ensure_ascii=False)
        self.assertIn("不是政策", text)

    def test_pending_sources_are_not_in_public_index(self):
        blob = CATALOG.read_text(encoding="utf-8")
        for marker in ("chiu.jpg", "public/img/persons/chiu"):
            self.assertNotIn(marker, blob)
        kinds = {asset["kind"] for asset in self.catalog["assets"]}
        self.assertIn("illustration", {item["id"] for item in self.catalog["kinds"]})
        self.assertNotIn("illustration", kinds)

    def test_lab_sources_match_public_copy(self):
        for name in ("lab.css", "lab.js"):
            source = (ROOT / "src" / "art-library" / name).read_bytes()
            public = (PUBLIC / "art-library" / name).read_bytes()
            self.assertEqual(source, public)

    def test_pending_document_keeps_unreviewed_names(self):
        pending = (ROOT / "docs" / "art-library" / "pending.md").read_text(encoding="utf-8")
        for marker in PENDING_MARKERS:
            self.assertIn(marker, pending)


if __name__ == "__main__":
    unittest.main()
