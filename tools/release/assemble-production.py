"""Build a checked release from the current production mirror and editorial UI."""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import runpy
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "integrate"))
from civic_contract import civic_sections

from bs4 import BeautifulSoup


CORE = ("index", "compare", "topics", "polls", "commentary", "manual", "person")
PRIMARY = (("總覽", "index"), ("比較", "compare"), ("議題", "topics"),
           ("民調", "polls"), ("評論", "commentary"), ("手動收錄", "manual"))
MORE = (("公共事務", "/civic.html"), ("美術庫", "/asset-lab.html"), ("完整收錄資料", "/archive.html"), ("候選人多面向", "/compare.html#candidateReview"), ("地方治理追蹤", "/governance.html"), ("政績與政見", "/records.html"), ("議題地圖", "/maps.html"),
        ("指標對照", "/compare-panels.html"), ("逐筆比較", "/reference/compare.html"),
        ("議題立場", "/reference/topics.html"), ("即時與社群", "/reference/index.html"),
        ("陳見賢", "/person.html?id=chen"))
PAGE_EXTRAS = {
    "index": (("即時與社群", "/reference/index.html#socialSection"),),
    "compare": (("逐筆比較", "/reference/compare.html#compareBoard"),),
    "topics": (("議題立場原表", "/reference/topics.html#stances"),),
    "manual": (("既有社群匯入方式", "/reference/manual.html"),),
    "person": (("政見與社群原表", "/reference/person.html"),),
}
COMPAT = """
const ref = {
  index: ['liveRefresh', 'extraPeople', 'socialSection'],
  compare: ['compareBoard', 'sourceDist'],
  topics: ['stances', 'stanceChips', 'stanceBoard'],
  person: ['socialSection', 'personPlatform', 'personPlatformBody'],
};
const route = location.pathname.split('/').at(-1).replace(/\\.html$/, '') || 'index';
const person = new URLSearchParams(location.search).get('id');
if (!location.pathname.startsWith('/reference/') &&
    (ref[route]?.includes(location.hash.slice(1)) ||
      (route === 'person' && ['chen', 'wu_zijia'].includes(person)))) {
  location.replace('/reference/' + route + '.html' + location.search + location.hash);
}
for (const link of document.querySelectorAll('a[data-profile-reference]')) link.search = location.search;
const nav = document.querySelector('.top nav.nav');
if (nav) {
  nav.setAttribute('aria-label', '主選單');
  nav.querySelector('a.active')?.setAttribute('aria-current', 'page');
}
const main = document.querySelector('main');
if (main && !document.querySelector('.skip-link')) {
  main.id ||= 'main-content';
  main.tabIndex = -1;
  const skip = document.createElement('a');
  skip.href = '#' + main.id;
  skip.className = 'skip-link';
  skip.textContent = '跳到主要內容';
  skip.addEventListener('click', () => main.focus());
  document.body.prepend(skip);
}
"""
STYLE = """
.release-directory { margin: 0 0 .65rem; border-block-end: 1px solid var(--line); }
.release-directory summary { min-height: 44px; padding-block: .62rem; color: var(--link); cursor: pointer; font-weight: 650; }
.release-directory nav { display: flex; flex-wrap: wrap; gap: .18rem .85rem; padding-block-end: .3rem; }
.release-directory a, .release-extra a { display: inline-flex; align-items: center; min-height: 44px; font-size: .84rem; }
.release-extra { margin: .15rem 0 .55rem; }
"""


def add_tag(doc, parent, name, **attrs):
    node = doc.new_tag(name, attrs=attrs)
    parent.append(node)
    return node


def copy_assets(source, dest):
    for path in source.rglob("*"):
        if not path.is_file():
            continue
        target = dest / path.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and target.read_bytes() != path.read_bytes():
            # Earlier Windows releases wrote generated navigation with CRLF even
            # though the filename was hashed from LF. Accept only that known
            # byte-equivalent legacy case; retain all other collision checks.
            normalized = path.read_bytes().replace(b"\r\n", b"\n")
            legacy_nav = path.name.startswith("release-nav-") and path.suffix in (".css", ".js")
            if (legacy_nav and target.read_bytes().replace(b"\r\n", b"\n") == normalized
                    and path.stem.rsplit("-", 1)[-1] == sha256(normalized).hexdigest()[:10]):
                continue
            raise ValueError(f"Conflicting asset {target}")
        if not target.exists():
            shutil.copyfile(path, target)


def copy_observations(source, dest):
    dest.mkdir(exist_ok=True)
    for path in source.glob("*.json"):
        target = dest / path.name
        if not target.exists():
            shutil.copyfile(path, target)
            continue
        current = json.loads(target.read_bytes())
        incoming = json.loads(path.read_bytes())
        key = ((lambda row: row["url"]) if path.name == "sources.json"
               else (lambda row: (row["commentId"], row["personId"])))
        index = {key(row): row for row in current["entries"]}
        for row in incoming["entries"]:
            index.setdefault(key(row), row)
        current["entries"] = sorted(index.values(), key=lambda row: row.get("at") or row["date"], reverse=True)
        for field in ("people", "threads"):
            if field in incoming:
                current[field] = {**incoming[field], **current.get(field, {})}
        target.write_text(json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")


def ensure_civic_nav(doc):
    for node in doc.select("nav.civic-nav"):
        node.decompose()
    primary = doc.select_one("header.top nav.nav") or doc.select_one(".top nav.nav")
    if not primary:
        return
    nav = doc.new_tag("nav", attrs={"class": "wrap civic-nav", "aria-label": civic_sections()["label"]})
    for section in civic_sections()["sections"]:
        add_tag(doc, nav, "a", href=section["href"]).string = section["title"]
    primary.insert_after(nav)
    if not doc.select_one('link[href="/civic-nav.css"]'):
        add_tag(doc, doc.head, "link", rel="stylesheet", href="/civic-nav.css")
    if not doc.select_one('script[src="/civic-nav.js"]'):
        add_tag(doc, doc.body, "script", defer="", src="/civic-nav.js")


def edit_page(path, common_css, script_url, style_url, depth_url, tools_url, *, reference=False):
    route = path.stem
    doc = BeautifulSoup(path.read_text(encoding="utf-8"), "html.parser")
    nav = doc.select_one(".top nav.nav")
    main = doc.main
    if path.name == "asset-lab.html":
        return
    if not nav or not main or not doc.head or not doc.body:
        raise ValueError(f"Page shell missing on {path}")
    for node in doc.select('.candidate-review-note,.release-directory,.release-extra,script[src^="/assets/release-nav-"],link[href^="/assets/release-nav-"],link[href="/editorial-depth.css"],link[href^="/assets/editorial-depth-"]'):
        node.decompose()
    if not doc.select_one(f'link[href="{common_css}"]'):
        add_tag(doc, doc.head, "link", rel="stylesheet", href=common_css)
    add_tag(doc, doc.head, "link", rel="stylesheet", href=style_url)
    add_tag(doc, doc.head, "link", rel="stylesheet", href=depth_url)
    for node in doc.select('script[src="/page-tools.js"],script[src^="/assets/page-tools-"]'):
        node.decompose()
    add_tag(doc, doc.body, "script", defer="", src=tools_url)
    doc.html["data-ui-depth"] = "v3"
    add_tag(doc, doc.body, "script", type="module", src=script_url)
    if route in ("governance", "archive"):
        ensure_civic_nav(doc)
        path.write_text(str(doc), encoding="utf-8", newline="\n")
        return
    note = doc.new_tag("p", attrs={"class": "candidate-review-note"})
    add_tag(doc, note, "a", href="/compare.html#reviewMethod").string = "候選人閱讀標準"
    note.append("：主張、質疑與回應分開閱讀；各圖只呈現已收錄範圍，完整正式名單見多面向閱讀。")
    main.insert(0, note)
    nav.clear()
    nav["aria-label"] = "主選單"
    for title, destination in PRIMARY:
        attrs = {"href": f"/{destination}.html"}
        if destination == route:
            attrs.update({"class": "active", "aria-current": "page"})
        add_tag(doc, nav, "a", **attrs).string = title
    directory = doc.new_tag("details", attrs={"class": "release-directory"})
    add_tag(doc, directory, "summary").string = "更多資料"
    more = add_tag(doc, directory, "nav", **{"aria-label": "其他資料頁"})
    for title, href in MORE:
        add_tag(doc, more, "a", href=href).string = title
    delay = main.select_one("#delayWarn")
    if delay:
        delay.insert_after(directory)
    else:
        main.insert(0, directory)
    if not reference and route in PAGE_EXTRAS:
        extras = doc.new_tag("p", attrs={"class": "release-extra"})
        for title, href in PAGE_EXTRAS[route]:
            attrs = {"href": href}
            if route == "person":
                attrs["data-profile-reference"] = ""
            add_tag(doc, extras, "a", **attrs).string = title
        directory.insert_after(extras)
    ensure_civic_nav(doc)
    path.write_text(str(doc), encoding="utf-8", newline="\n")


def finalize_manifest(root):
    directory = root / "data"
    manifest_path = directory / "manifest.json"
    data = json.loads(manifest_path.read_bytes())
    files = {}
    for path in sorted(directory.rglob("*.json")):
        if path == manifest_path:
            continue
        raw = path.read_bytes()
        json.loads(raw)
        files[path.relative_to(directory).as_posix()] = {"bytes": len(raw), "sha256": sha256(raw).hexdigest()[:16]}
    if not {"items.json", "stats.json", "polls.json"}.issubset(files):
        raise ValueError("Incomplete production data")
    items = json.loads((directory / "items.json").read_bytes())
    if len(items) != data["counts"]["items_rows"]:
        raise ValueError("Production files changed during assembly")
    data["files"] = files
    data["content_sha"] = sha256(json.dumps(files, sort_keys=True).encode()).hexdigest()
    data["finalized_at"] = datetime.now(timezone(timedelta(hours=8))).isoformat()
    manifest_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("production", type=Path)
    parser.add_argument("editorial", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    production, editorial, output = (p.resolve() for p in (args.production, args.editorial, args.output))
    if output.exists() or output.is_relative_to(production) or output.is_relative_to(editorial):
        raise ValueError("Output must be a new directory outside both input trees")
    # The Pages routing files are inherited exclusively from the production mirror.
    shutil.copytree(production, output)
    reference = output / "reference"
    reference.mkdir(exist_ok=True)
    for page in CORE:
        if not (reference / f"{page}.html").exists():
            shutil.copyfile(output / f"{page}.html", reference / f"{page}.html")
        shutil.copyfile(editorial / f"{page}.html", output / f"{page}.html")
    shutil.copyfile(editorial / "governance.html", output / "governance.html")
    shutil.copyfile(editorial / "archive.html", output / "archive.html")
    if (editorial / "civic.html").exists():
        shutil.copyfile(editorial / "civic.html", output / "civic.html")
    # Governance records belong to the checked editorial release, not the legacy election feed.
    for name in ("governance.json", "governance-registry.json", "candidate-review.json"):
        shutil.copyfile(editorial / "data" / name, output / "data" / name)
    if (editorial / "data/news-monitor").is_dir():
        monitor = output / "data/news-monitor"
        monitor.mkdir(exist_ok=True)
        # Curated manual index follows the editorial source; retain incoming RSS history.
        for path in (editorial / "data/news-monitor").glob("*.json"):
            dest = monitor / path.name
            if path.name == "manual.json" and dest.exists() and dest.read_bytes() != path.read_bytes():
                prior, incoming = json.loads(dest.read_bytes()), json.loads(path.read_bytes())
                index = {row.get("id") or row["url"]: row for row in prior.get("articles", [])}
                index.update({row.get("id") or row["url"]: row for row in incoming.get("articles", [])})
                dest.write_text(json.dumps({**prior, **incoming, "articles": list(index.values())}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
                continue
            if path.name == "manual.json" or not (monitor / path.name).exists():
                shutil.copyfile(path, monitor / path.name)
    copy_assets(editorial / "assets", output / "assets")
    copy_observations(editorial / "observations", output / "observations")
    # Keep official images for existing paths, filling only missing image files.
    for path in (editorial / "img").rglob("*"):
        if path.is_file():
            target = output / "img" / path.relative_to(editorial / "img")
            if not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(path, target)
    entry = BeautifulSoup((editorial / "index.html").read_bytes(), "html.parser")
    styles = [node["href"] for node in entry.select('link[rel="stylesheet"][href^="/assets/mobile"]')]
    nav_styles = [href for href in styles if "/assets/mobile-nav-" in href]
    mobile_styles = [href for href in styles if href not in nav_styles]
    chosen = nav_styles if len(nav_styles) == 1 else mobile_styles
    if len(chosen) != 1:
        raise ValueError("Expected one editorial common stylesheet")
    common = [editorial / chosen[0].lstrip("/")]
    script = f"release-nav-{sha256(COMPAT.encode()).hexdigest()[:10]}.js"
    style = f"release-nav-{sha256(STYLE.encode()).hexdigest()[:10]}.css"
    (output / "assets" / script).write_text(COMPAT, encoding="utf-8", newline="\n")
    (output / "assets" / style).write_text(STYLE, encoding="utf-8", newline="\n")
    depth_raw = (editorial / "editorial-depth.css").read_bytes()
    depth_name = "editorial-depth-" + sha256(depth_raw).hexdigest()[:12] + ".css"
    (output / "assets" / depth_name).write_bytes(depth_raw)
    tools_raw = (editorial / "page-tools.js").read_bytes()
    tools_name = "page-tools-" + sha256(tools_raw).hexdigest()[:12] + ".js"
    (output / "assets" / tools_name).write_bytes(tools_raw)
    for path in output.glob("*.html"):
        edit_page(path, f"/assets/{common[0].name}", f"/assets/{script}", f"/assets/{style}", f"/assets/{depth_name}", f"/assets/{tools_name}")
    for path in reference.glob("*.html"):
        edit_page(path, f"/assets/{common[0].name}", f"/assets/{script}", f"/assets/{style}", f"/assets/{depth_name}", f"/assets/{tools_name}", reference=True)
    map_patch = runpy.run_path(str(Path(__file__).with_name("apply-maps-ui.py")))
    map_patch["apply"](output)
    manifest = finalize_manifest(output)
    print(json.dumps({"pages": len(list(output.glob("*.html"))), "reference": len(CORE),
                      "items": manifest["counts"]["items_rows"], "files": len(manifest["files"]),
                      "generated_at": manifest["generated_at"], "finalized_at": manifest["finalized_at"]}))


if __name__ == "__main__":
    main()
