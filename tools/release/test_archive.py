from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]


class ArchiveTests(unittest.TestCase):
    def test_full_archive_preserves_rows_and_restrictions(self):
        subprocess.run(['node', str(ROOT/'tools/release/test-archive-model.mjs')], cwd=ROOT, check=True)
