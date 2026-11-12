from hashlib import sha256
from pathlib import Path
import runpy
import tempfile
import unittest

copy_assets = runpy.run_path(str(Path(__file__).with_name('assemble-production.py')))['copy_assets']


class AssemblyAssetsTests(unittest.TestCase):
    def test_legacy_generated_navigation_line_endings_keep_existing_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            src, dest = Path(directory)/'src', Path(directory)/'dest'
            src.mkdir(); dest.mkdir()
            raw = b'nav {\n  display: flex;\n}\n'
            name = 'release-nav-' + sha256(raw).hexdigest()[:10] + '.css'
            (src/name).write_bytes(raw.replace(b'\n', b'\r\n'))
            (dest/name).write_bytes(raw)
            copy_assets(src, dest)
            self.assertEqual((dest/name).read_bytes(), raw)

    def test_changed_content_or_other_asset_still_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            src, dest = Path(directory)/'src', Path(directory)/'dest'
            src.mkdir(); dest.mkdir()
            name = 'release-nav-' + sha256(b'a\n').hexdigest()[:10] + '.js'
            (src/name).write_bytes(b'changed\n')
            (dest/name).write_bytes(b'a\n')
            with self.assertRaisesRegex(ValueError, 'Conflicting asset'):
                copy_assets(src, dest)
            (src/name).unlink(); (dest/name).unlink()
            (src/'app-hash.js').write_bytes(b'a\r\n')
            (dest/'app-hash.js').write_bytes(b'a\n')
            with self.assertRaisesRegex(ValueError, 'Conflicting asset'):
                copy_assets(src, dest)
