"""Apply versioned mobile map assets to a built site."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from os import replace
from pathlib import Path
from tempfile import NamedTemporaryFile

from bs4 import BeautifulSoup


def atomic_write(path, raw):
    with NamedTemporaryFile(dir=path.parent, prefix=".map-ui-", delete=False) as temporary:
        temporary.write(raw)
        name = temporary.name
    replace(name, path)


def apply(root):
    root = Path(root).resolve(strict=True)
    source = Path(__file__).resolve().parents[1] / "enhancements/maps-page"
    assets = {}
    for kind in ("css", "js"):
        raw = (source / f"maps.{kind}").read_bytes()
        filename = f"maps-mobile-{sha256(raw).hexdigest()[:12]}.{kind}"
        destination = root / "assets" / filename
        if destination.exists():
            assert destination.read_bytes() == raw
        else:
            atomic_write(destination, raw)
        assets[kind] = "/assets/" + filename
    path = root / "maps.html"
    document = BeautifulSoup(path.read_bytes(), "html.parser")
    for node in document.select('link[href="/assets/maps.css"],link[href^="/assets/maps-mobile-"],script[src="/assets/maps.js"],script[src^="/assets/maps-mobile-"]'):
        node.decompose()
    link = document.new_tag("link", attrs={"rel": "stylesheet", "href": assets["css"]})
    document.head.append(link)
    script = document.new_tag("script", attrs={"defer": "", "src": assets["js"]})
    document.head.append(script)
    document.title.string = "政績與政見地圖｜新竹選情觀察"
    document.select_one(".top h1").string = "政績與政見地圖"
    document.select_one(".top .sub").string = "依議題、鄉鎮查閱公開來源"
    for name in ("recordVisual", "policyVisual"):
        visual = document.select_one("#" + name)
        if not visual.parent.has_attr("class") or "map-visual" not in visual.parent["class"]:
            details = document.new_tag("details", attrs={"class": "map-visual"})
            summary = document.new_tag("summary")
            summary.string = "查看鄉鎮示意圖"
            visual.wrap(details)
            details.insert(0, summary)
    atomic_write(path, str(document).encode("utf-8"))
    manifest_path = root / "data/manifest.json"
    manifest = json.loads(manifest_path.read_bytes())
    revision = sha256(json.dumps(assets, sort_keys=True).encode()).hexdigest()[:16]
    revisions = manifest.setdefault("ui_revisions", {})
    if revisions.get("maps") != revision:
        revisions["maps"] = revision
        manifest["ui_updated_at"] = datetime.now(timezone(timedelta(hours=8))).isoformat()
        atomic_write(manifest_path, (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    return assets


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("site", type=Path)
    print(apply(parser.parse_args().site))
