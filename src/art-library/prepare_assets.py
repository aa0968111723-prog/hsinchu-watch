"""Build the public art library from the curated list in sources.json.

    python src/art-library/prepare_assets.py            # use recorded evidence, fetch only what is new
    python src/art-library/prepare_assets.py --refresh  # ask Wikimedia Commons again for every licence

What reaches public/ is decided here and nowhere else:
  * the licence on the Commons file page must be on the allowlist below;
  * the entry must be marked `reviewed` with an `alt` written after looking at the picture;
  * portraits must meet the shared square standard.
Anything else is reported and left out. Evidence of each licence, as read on the
day it was retrieved, is kept in sources.lock.json.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import shutil
import sys
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "public"
ART = PUBLIC / "art-library"
DATA = PUBLIC / "data" / "art-library.json"
SRC = ROOT / "src" / "art-library"
DOCS = ROOT / "docs" / "art-library"
LOCK = SRC / "sources.lock.json"
CACHE = ROOT / "work" / "art-cache"
REVIEW = ROOT / "work" / "art-review"
TZ = ZoneInfo("Asia/Taipei")
UA = "hsinchu-watch-art-library/0.2 (https://github.com/aa0968111723-prog/hsinchu-watch; civic asset licence review)"

SCENE_WIDTHS = (480, 800, 1280)
PORTRAIT_WIDTHS = (128, 256)
PORTRAIT_SIZE = 256
CC_LICENCE = re.compile(r"CC BY(-SA)? [1-4]\.\d( [a-z]{2})?")
CC_URLS = {
    "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
    "CC BY-SA 3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
    "CC BY-SA 2.5": "https://creativecommons.org/licenses/by-sa/2.5/",
    "CC BY-SA 2.0": "https://creativecommons.org/licenses/by-sa/2.0/",
    "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
    "CC BY 3.0": "https://creativecommons.org/licenses/by/3.0/",
    "CC BY 2.0": "https://creativecommons.org/licenses/by/2.0/",
    "CC0": "https://creativecommons.org/publicdomain/zero/1.0/",
}
GWOIA_NAMES = {
    "GWOIA": "政府網站資料開放宣告（GWOIA）",
    "LY-GWOIA": "立法院政府網站資料開放宣告（LY-GWOIA）",
}
CIVIC_PALETTE = [
    {"name": "paper", "hex": "#f4efe6"},
    {"name": "sheet", "hex": "#fffaf4"},
    {"name": "ink", "hex": "#2b261f"},
    {"name": "sage", "hex": "#2f6a56"},
    {"name": "clay", "hex": "#9a5340"},
    {"name": "sand", "hex": "#ead7b4"},
]


class Rejected(Exception):
    """An entry that may not enter the public index, with the reason."""


def now() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def plain(value: str | None) -> str | None:
    text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", value or "")).replace("\u200b", "").strip()
    return text or None


def api(params: dict) -> dict:
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({"format": "json", **params})
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()
    if data[:1] == b"<" or len(data) < 1000:
        raise Rejected("the download is not an image")
    return data


def evidence_of(title: str) -> dict:
    """What the Commons file page says about this file today."""
    data = api({
        "action": "query", "titles": title, "prop": "imageinfo|revisions",
        "iiprop": "url|size|mime|sha1|timestamp|extmetadata", "rvprop": "content", "rvslots": "main",
    })
    page = next(iter(data["query"]["pages"].values()))
    if "missing" in page or not page.get("imageinfo"):
        raise Rejected(f"{title} is not on Wikimedia Commons")
    info = page["imageinfo"][0]
    meta = info.get("extmetadata") or {}

    def field(name: str) -> str | None:
        return plain((meta.get(name) or {}).get("value"))

    wikitext = page["revisions"][0]["slots"]["main"]["*"]
    gwoia = None
    gwoia_url = None
    match = re.search(r"\{\{\s*(LY-GWOIA|LYWOIA|GWOIA)\b([^{}]*)\}\}", wikitext)
    if match:
        gwoia = "LY-GWOIA" if match.group(1) in ("LY-GWOIA", "LYWOIA") else "GWOIA"
        params = dict(part.split("=", 1) for part in match.group(2).split("|") if "=" in part)
        params = {key.strip(): value.strip() for key, value in params.items()}
        gwoia_url = params.get("zhurl") or params.get("url") or None
    return {
        "title": page["title"],
        "page_url": info["descriptionurl"],
        "original_url": info["url"],
        "original_width": info["width"],
        "original_height": info["height"],
        "original_mime": info["mime"],
        "original_sha1": info["sha1"],
        "uploaded_at": info["timestamp"],
        "license_short": field("LicenseShortName"),
        "license_url": field("LicenseUrl"),
        "artist": field("Artist"),
        "attribution": field("Attribution"),
        "credit": field("Credit"),
        "date_original": field("DateTimeOriginal"),
        "description": field("ImageDescription"),
        "gwoia": gwoia,
        "gwoia_url": gwoia_url,
    }


def licence_of(evidence: dict) -> tuple[str, str | None]:
    """The licence name and URL, or Rejected when reuse is not clearly allowed."""
    if evidence["gwoia"]:
        return GWOIA_NAMES[evidence["gwoia"]], evidence["gwoia_url"]
    short = evidence["license_short"] or ""
    if short == "CC0" or CC_LICENCE.fullmatch(short):
        return short, evidence["license_url"] or CC_URLS.get(short)
    raise Rejected(f"licence {short!r} is not on the allowlist")


def creator_of(evidence: dict) -> str:
    creator = evidence["artist"]
    if not creator:
        raise Rejected("the file page names no author")
    return creator


def credit_line(evidence: dict, licence: str) -> str:
    """Author as the file page asks to be credited, then licence and where it came from."""
    if evidence["gwoia"]:
        # The template's attribution is the agency name in the reader's language; the author field has it in Chinese.
        name = evidence["artist"]
    else:
        # Some authors list alternatives ("Photo by X or alternatively © X"). The first form is enough.
        name = (evidence["attribution"] or evidence["artist"]).split(" or alternatively ")[0].strip()
    return f"{name}／{licence}／Wikimedia Commons"


def save(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image = image.convert("RGB")
    suffix = path.suffix.lower()
    if suffix == ".jpg":
        image.save(path, format="JPEG", quality=85, optimize=True, progressive=True)
    elif suffix == ".webp":
        image.save(path, format="WEBP", quality=80, method=6)
    elif suffix == ".avif":
        image.save(path, format="AVIF", quality=55)
    else:
        raise ValueError(path)


MIMES = {".jpg": "image/jpeg", ".webp": "image/webp", ".avif": "image/avif", ".svg": "image/svg+xml",
         ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".txt": "text/plain"}


def record(path: Path, role: str, note: str | None = None) -> dict:
    suffix = path.suffix.lower()
    width = height = None
    if suffix in (".jpg", ".webp", ".avif"):
        with Image.open(path) as image:
            width, height = image.size
    entry = {
        "path": path.relative_to(PUBLIC).as_posix(),
        "format": {".jpg": "jpeg"}.get(suffix, suffix.lstrip(".")),
        "mime": MIMES[suffix],
        "role": role,
        "width": width,
        "height": height,
        "bytes": path.stat().st_size,
        "checksum": sha256(path),
    }
    if note:
        entry["note"] = note
    return entry


def palette_of(image: Image.Image, colours: int = 5) -> list[dict]:
    """Dominant colours of the picture, largest share first."""
    small = image.convert("RGB").resize((96, max(1, round(96 * image.height / image.width))), Image.LANCZOS)
    quantised = small.quantize(colors=colours, method=Image.Quantize.MEDIANCUT)
    table = quantised.getpalette()[: colours * 3]
    total = small.width * small.height
    rows = []
    for count, index in sorted(quantised.getcolors(), reverse=True):
        red, green, blue = table[index * 3: index * 3 + 3]
        rows.append({"name": None, "hex": f"#{red:02x}{green:02x}{blue:02x}", "share": round(count / total, 3)})
    return rows


def resized(image: Image.Image, width: int) -> Image.Image:
    if width >= image.width:
        return image.copy()
    return image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)


def difference(a: Image.Image, b: Image.Image, size: int = 64) -> float:
    """Mean absolute grey difference of two pictures at `size` px, 0 to 255."""
    left = a.convert("L").resize((size, size), Image.LANCZOS).tobytes()
    right = b.convert("L").resize((size, size), Image.LANCZOS).tobytes()
    return sum(abs(x - y) for x, y in zip(left, right)) / len(left)


def best_square(remote: Image.Image, site: Image.Image) -> dict:
    """Slides a square over `remote` at several sizes and reports the one closest to `site`.

    Measured on the three site portraits against all three Commons originals (2026-11-13):
    the same photograph, recompressed and resampled, scored 5.5 to 7.9; another person's
    official portrait scored 42 to 64. The gate is 12. A different photograph of the same
    person was not part of that control.
    """
    best: tuple[float, tuple[int, int, int] | None] = (999.0, None)
    width, height = remote.size
    for scale in (1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6):
        side = int(min(width, height) * scale)
        step = max(2, side // 40)
        for top in range(0, height - side + 1, step):
            for left in range(0, width - side + 1, step):
                score = difference(remote.crop((left, top, left + side, top + side)), site, 32)
                if score < best[0]:
                    best = (score, (left, top, side))
    left, top, side = best[1]
    fine = difference(remote.crop((left, top, left + side, top + side)), site, 64)
    return {
        "method": "best-matching square of the Commons original (500 px wide), grey difference at 64 px",
        "mean_abs_diff": round(fine, 2),
        "square_in_500px": {"left": left, "top": top, "side": side},
    }


def clean_folder(folder: Path, keep: set[Path]) -> None:
    if not folder.exists():
        return
    for path in folder.iterdir():
        if path.is_file() and path not in keep:
            path.unlink()


class Library:
    def __init__(self, refresh: bool):
        self.refresh = refresh
        self.sources = json.loads((SRC / "sources.json").read_text(encoding="utf-8"))
        self.lock = json.loads(LOCK.read_text(encoding="utf-8")) if LOCK.exists() else {"note": "Licence evidence as read from Wikimedia Commons on retrieved_at.", "assets": {}}
        self.rejected: list[tuple[str, str]] = []
        self.kept_ids: set[str] = set()

    def locked(self, entry: dict) -> dict:
        """Evidence for one entry: recorded, or read from Commons now."""
        known = self.lock["assets"].get(entry["id"])
        if known and known["commons"] == entry["commons"] and not self.refresh:
            return known
        evidence = evidence_of(entry["commons"])
        fresh = {"commons": entry["commons"], "retrieved_at": now(), "evidence": evidence}
        if known and known["commons"] == entry["commons"]:
            fresh["first_retrieved_at"] = known.get("first_retrieved_at", known["retrieved_at"])
            if known["evidence"].get("license_short") != evidence["license_short"] or known["evidence"].get("gwoia") != evidence["gwoia"]:
                print(f"LICENCE CHANGED on Commons for {entry['id']}: {known['evidence'].get('license_short')} -> {evidence['license_short']}")
            for key in ("download", "site_match"):
                if key in known:
                    fresh[key] = known[key]
        self.lock["assets"][entry["id"]] = fresh
        return fresh

    def base(self, entry: dict, kind: str, locked: dict) -> dict:
        evidence = locked["evidence"]
        licence, licence_url = licence_of(evidence)
        if not entry.get("reviewed") or not (entry.get("alt") or "").strip():
            raise Rejected("not reviewed: look at the picture, then write alt and set reviewed")
        return {
            "id": entry["id"],
            "kind": kind,
            "title": entry["title"],
            "region_ids": entry["region_ids"],
            "actor_refs": entry.get("actor_refs"),
            "project_refs": entry.get("project_refs"),
            "office_refs": entry.get("office_refs"),
            "original_source_url": evidence["page_url"],
            "creator": creator_of(evidence),
            "license_name": licence,
            "license_url": licence_url,
            "attribution": credit_line(evidence, licence),
            "retrieved_at": locked["retrieved_at"],
            "review_status": "publication-ready",
            "usage_status": entry.get("usage_status", "available"),
            "uses": entry["uses"],
            "alt": entry["alt"],
            "focal_point": entry.get("focal_point"),
            "source": {
                "host": "Wikimedia Commons",
                "file_title": evidence["title"],
                "original_file_url": evidence["original_url"],
                "original_width": evidence["original_width"],
                "original_height": evidence["original_height"],
                "original_sha1": evidence["original_sha1"],
                "uploaded_at": evidence["uploaded_at"],
                "date_taken": evidence["date_original"],
                "described_as": (evidence["description"] or "")[:200] or None,
                "credit_source": evidence["credit"],
            },
        }

    def scene(self, entry: dict) -> dict:
        locked = self.locked(entry)
        licence_of(locked["evidence"])
        creator_of(locked["evidence"])
        cached = CACHE / f"{entry['id']}.jpg"
        if not cached.exists():
            name = entry["commons"].split(":", 1)[1]
            url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(name) + f"?width={max(SCENE_WIDTHS)}"
            CACHE.mkdir(parents=True, exist_ok=True)
            cached.write_bytes(fetch(url))
        if not entry.get("reviewed"):
            # Licence is acceptable but nobody has looked yet. Keep a copy outside public/ for the review.
            REVIEW.mkdir(parents=True, exist_ok=True)
            with Image.open(cached) as opened:
                resized(opened.convert("RGB"), 1000).save(REVIEW / f"{entry['id']}.jpg", quality=80)
        asset = self.base(entry, "scene", locked)
        digest = sha256(cached)
        if locked.get("download", {}).get("sha256") not in (None, digest):
            print(f"note: {entry['id']} download differs from the recorded one; the lock now records the new bytes")
        locked["download"] = {"width": max(SCENE_WIDTHS), "sha256": digest}
        with Image.open(cached) as opened:
            opened.load()
            source = opened.convert("RGB")
        if source.width < 640:
            raise Rejected(f"download is only {source.width} px wide")
        folder = ART / "scenes" / entry["id"]
        files, written = [], set()
        largest = min(max(SCENE_WIDTHS), source.width)
        fallback = folder / f"{entry['id']}-{largest}.jpg"
        save(resized(source, largest), fallback)
        files.append(record(fallback, "fallback"))
        written.add(fallback)
        for width in SCENE_WIDTHS:
            if width > source.width:
                continue
            scaled = resized(source, width)
            for suffix in (".avif", ".webp"):
                path = folder / f"{entry['id']}-{width}{suffix}"
                save(scaled, path)
                files.append(record(path, "responsive"))
                written.add(path)
        clean_folder(folder, written)
        asset.update({
            "files": files,
            "dimensions": {"width": files[0]["width"], "height": files[0]["height"], "unit": "px"},
            "checksum": files[0]["checksum"],
            "checksum_of": files[0]["path"],
            "palette": palette_of(source),
            "changes": f"自 Commons 取寬 {largest} 像素的縮圖，再縮為 {'、'.join(str(w) for w in SCENE_WIDTHS if w <= source.width)} 像素並轉成 AVIF、WebP 與 JPEG。未裁切、未調色。衍生檔沿用同一授權。",
            "suggested_use": "城市或機關的實景情境。這是拍攝當天的外觀，不是工程進度或現況的證明。",
            "identity": None,
        })
        return asset

    def portrait(self, entry: dict) -> dict:
        locked = self.locked(entry)
        asset = self.base(entry, "portrait", locked)
        evidence = locked["evidence"]
        site = PUBLIC / entry["site_file"]
        folder = ART / "portraits" / entry["id"]
        files, written = [], set()
        with Image.open(site) as opened:
            opened.load()
            original = opened.convert("RGB")
        same_bytes = hashlib.sha1(site.read_bytes()).hexdigest() == evidence["original_sha1"]
        crop = entry.get("crop")
        if crop:
            box = (crop["x"], crop["y"], crop["x"] + crop["size"], crop["y"] + crop["size"])
            if box[2] > original.width or box[3] > original.height or crop["size"] < PORTRAIT_SIZE:
                raise Rejected("crop box does not fit the source or is smaller than the standard")
            square = original.crop(box).resize((PORTRAIT_SIZE, PORTRAIT_SIZE), Image.LANCZOS)
            fallback = folder / f"{entry['id']}-{PORTRAIT_SIZE}.jpg"
            save(square, fallback)
            files.append(record(site, "original", "站上既有檔，本線未改。"))
            files.append(record(fallback, "fallback"))
            written.add(fallback)
            match = {"method": "byte-identical", "same_bytes": same_bytes}
            if not same_bytes:
                raise Rejected("the site file is not the Commons original, so the crop box cannot be trusted")
        else:
            square = original
            if square.size != (PORTRAIT_SIZE, PORTRAIT_SIZE):
                raise Rejected(f"site portrait is {square.size}, the standard is {PORTRAIT_SIZE} square")
            files.append(record(site, "fallback", "站上既有檔，本線未改像素。"))
            match = locked.get("site_match")
            if not match or "mean_abs_diff" not in match or self.refresh:
                # The site file is a square cut from the Commons original. Find that square and measure how close it is.
                name = entry["commons"].split(":", 1)[1]
                thumb = fetch("https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(name) + "?width=500")
                with Image.open(io.BytesIO(thumb)) as remote:
                    match = best_square(remote.convert("RGB"), square)
            if match["mean_abs_diff"] > 12:
                raise Rejected(f"site portrait does not match the Commons original (difference {match['mean_abs_diff']})")
        locked["site_match"] = match
        for width in PORTRAIT_WIDTHS:
            scaled = square if width == PORTRAIT_SIZE else square.resize((width, width), Image.LANCZOS)
            for suffix in (".avif", ".webp"):
                path = folder / f"{entry['id']}-{width}{suffix}"
                save(scaled, path)
                files.append(record(path, "responsive"))
                written.add(path)
        clean_folder(folder, written)
        primary = next(item for item in files if item["role"] == "fallback")
        if (primary["width"], primary["height"]) != (PORTRAIT_SIZE, PORTRAIT_SIZE):
            raise Rejected("fallback portrait is not the standard square")
        described = evidence["description"] or evidence["title"]
        asset.update({
            "files": files,
            "dimensions": {"width": PORTRAIT_SIZE, "height": PORTRAIT_SIZE, "unit": "px"},
            "checksum": primary["checksum"],
            "checksum_of": primary["path"],
            "palette": palette_of(square),
            "crop": crop,
            "changes": (
                f"自原檔取頭肩範圍（左上 {crop['x']},{crop['y']}，邊長 {crop['size']} 像素）縮為 {PORTRAIT_SIZE} 正方形，再轉 AVIF、WebP。未調色、未修圖。"
                if crop else f"沿用站上既有 {PORTRAIT_SIZE} 正方形檔，另轉 AVIF、WebP 與 128 像素縮圖。未調色、未修圖。"
            ),
            "suggested_use": "人物卡與候選人閱讀。所有人用同一正方形頭肩比例，不要另裁成不同臉部大小。",
            "identity": {
                "basis": f"Commons 檔案頁說明「{described}」，來源 {evidence['credit'] or '未列'}。",
                "site_file_check": (
                    "站上檔與 Commons 原檔位元組相同（SHA-1 一致）。" if match.get("same_bytes")
                    else f"站上檔是 Commons 原檔靠上方的正方形裁切。逐格比對後最接近的一格，64 像素灰階平均差 {match['mean_abs_diff']}（0 為相同；對照組裡換成別人的官方照是 42 以上）。"
                ),
                "checked_at": locked["retrieved_at"],
            },
        })
        return asset

    def component(self, entry: dict) -> dict:
        folder = ART / "figures" / entry["folder"]
        preview = folder / "preview.svg"
        if not preview.exists():
            raise Rejected("figure is not built; run node src/art-library/figures/build-all.mjs")
        box = re.search(r'viewBox="0 0 (\d+) (\d+)"', preview.read_text(encoding="utf-8"))
        width, height = int(box.group(1)), int(box.group(2))
        roles = {"preview.svg": "preview", "fragment.html": "fragment", "index.html": "page", "live.js": "module", "model.js": "module", "data.js": "module"}
        files = [record(folder / name, role) for name, role in roles.items() if (folder / name).exists()]
        for extra in sorted(folder.glob("*.js")):
            if extra.name not in roles:
                files.append(record(extra, "module"))
        for name in ("figures.css", "motion.js", "runtime.js", "boot.js"):
            files.append(record(ART / "figures" / name, "shared"))
        files[0]["width"], files[0]["height"] = width, height
        return {
            "id": entry["id"],
            "kind": "component",
            "title": entry["title"],
            "region_ids": [region["id"] for region in self.sources["regions"]],
            "actor_refs": None,
            "project_refs": None,
            "office_refs": None,
            "original_source_url": None,
            "creator": "新竹觀察美術庫（第五線）",
            "license_name": "本站原創，未另行對外授權",
            "license_url": None,
            "attribution": "原創示意，新竹觀察",
            "retrieved_at": None,
            "review_status": "publication-ready",
            "usage_status": "available",
            "uses": entry["uses"],
            "alt": entry["alt"],
            "focal_point": None,
            "source": None,
            "files": files,
            "dimensions": {"width": width, "height": height, "unit": "viewBox"},
            "checksum": files[0]["checksum"],
            "checksum_of": files[0]["path"],
            "palette": CIVIC_PALETTE,
            "changes": None,
            "concept": entry["concept"],
            "suggested_use": entry["suggested_use"],
            "identity": None,
            "embed": {"figure": entry["folder"], "stylesheet": "art-library/figures/figures.css", "script": "art-library/figures/boot.js"},
            "third_party": [{"name": "anatomy kit（繪圖樣式與產生幾何的工具）", "license": "MIT", "notice": "art-library/figures/NOTICE.txt"}],
        }

    def build(self) -> dict:
        assets = []
        for kind, maker in (("portraits", self.portrait), ("scenes", self.scene)):
            for entry in self.sources[kind]:
                try:
                    assets.append(maker(entry))
                    self.kept_ids.add(entry["id"])
                except Rejected as reason:
                    self.rejected.append((entry["id"], str(reason)))
        figures = json.loads((SRC / "figures" / "figures.json").read_text(encoding="utf-8"))["figures"]
        for entry in figures:
            try:
                assets.append(self.component(entry))
                self.kept_ids.add(entry["id"])
            except Rejected as reason:
                self.rejected.append((entry["id"], str(reason)))
        self.prune()
        coverage = [
            {"region_id": region["id"], "kind": kind["id"],
             "count": sum(1 for asset in assets if asset["kind"] == kind["id"] and region["id"] in asset["region_ids"])}
            for region in self.sources["regions"] for kind in self.sources["kinds"]
        ]
        used = {use for asset in assets for use in asset["uses"]}
        return {
            "schema_version": 2,
            "timezone": "Asia/Taipei",
            "publication": "publication-ready",
            "note": "assets 只收來源與授權已核對、可公開使用的素材。gaps 是缺口紀錄，沒有圖檔。待審候選來源不在這個檔案裡。",
            "regions": self.sources["regions"],
            "kinds": self.sources["kinds"],
            "uses": [use for use in self.sources["uses"] if use["id"] in used],
            "review_statuses": [
                {"id": "publication-ready", "label": "已核對，可公開使用"},
                {"id": "gap", "label": "缺口，沒有可用素材"},
            ],
            "usage_statuses": [
                {"id": "available", "label": "可取用"},
                {"id": "in-use", "label": "站上已使用"},
            ],
            "portrait_standard": self.sources["portrait_standard"],
            "assets": assets,
            "gaps": self.sources["gaps"],
            "coverage": coverage,
        }

    def prune(self) -> None:
        """Remove folders of entries that are no longer published."""
        for group in ("portraits", "scenes"):
            parent = ART / group
            if not parent.exists():
                continue
            for folder in parent.iterdir():
                if folder.is_dir() and folder.name not in self.kept_ids:
                    shutil.rmtree(folder)


def write_catalog(catalog: dict) -> bool:
    """Writes the index. Keeps the old generated_at when nothing else changed."""
    previous = json.loads(DATA.read_text(encoding="utf-8")) if DATA.exists() else {}
    stamp = previous.get("generated_at")
    if {key: value for key, value in previous.items() if key != "generated_at"} != catalog or not stamp:
        stamp = now()
    ordered = {"schema_version": catalog["schema_version"], "timezone": catalog["timezone"], "generated_at": stamp,
               **{key: value for key, value in catalog.items() if key not in ("schema_version", "timezone")}}
    text = json.dumps(ordered, ensure_ascii=False, indent=2) + "\n"
    changed = not DATA.exists() or DATA.read_text(encoding="utf-8") != text
    DATA.parent.mkdir(parents=True, exist_ok=True)
    DATA.write_text(text, encoding="utf-8", newline="\n")
    return changed


def write_inventory(catalog: dict) -> None:
    """A table people can read to check every licence without opening JSON."""
    labels = {kind["id"]: kind["label"] for kind in catalog["kinds"]}
    lines = [
        "# 公開素材清單", "",
        "由 `src/art-library/prepare_assets.py` 產生，內容與 `public/data/art-library.json` 相同。授權證據快照在 `src/art-library/sources.lock.json`。", "",
        "| 素材 ID | 種類 | 標題 | 作者 | 授權 | 來源頁 | 取得時間 |", "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for asset in catalog["assets"]:
        source = f"[檔案頁]({asset['original_source_url']})" if asset["original_source_url"] else "原創"
        lines.append(f"| `{asset['id']}` | {labels[asset['kind']]} | {asset['title']} | {asset['creator']} | {asset['license_name']} | {source} | {asset['retrieved_at'] or '不適用'} |")
    lines += ["", "## 缺口", ""]
    for gap in catalog["gaps"]:
        lines.append(f"- `{gap['id']}`：{gap['title']}。{gap['reason']}")
    DOCS.mkdir(parents=True, exist_ok=True)
    (DOCS / "inventory.md").write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh", action="store_true", help="read every licence from Wikimedia Commons again")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    ART.mkdir(parents=True, exist_ok=True)
    for name in ("lab.css", "lab.js"):
        shutil.copyfile(SRC / name, ART / name)
    library = Library(args.refresh)
    catalog = library.build()
    LOCK.write_text(json.dumps(library.lock, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    changed = write_catalog(catalog)
    write_inventory(catalog)
    kinds = {}
    for asset in catalog["assets"]:
        kinds[asset["kind"]] = kinds.get(asset["kind"], 0) + 1
    print(f"assets={len(catalog['assets'])} {kinds} gaps={len(catalog['gaps'])} catalog_changed={changed}")
    for asset_id, reason in library.rejected:
        print(f"LEFT OUT {asset_id}: {reason}")
    return 1 if library.rejected else 0


if __name__ == "__main__":
    sys.exit(main())
