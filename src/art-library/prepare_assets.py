"""Build publication-ready art-library files from verified local portraits and Commons scenes.

Pending or unlicensed sources are never written under public/.
"""
from __future__ import annotations

import hashlib
import json
import re
import shutil
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
UA = "hsinchu-watch-art-library/0.1 (civic asset review; local public-interest archive)"
TZ = ZoneInfo("Asia/Taipei")
ALLOWED = {"CC BY-SA 4.0", "CC BY-SA 3.0", "CC BY 4.0", "CC BY 3.0", "CC0"}
LICENSE_URL = {
    "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
    "CC BY-SA 3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
    "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
    "CC BY 3.0": "https://creativecommons.org/licenses/by/3.0/",
    "CC0": "https://creativecommons.org/publicdomain/zero/1.0/",
}

PORTRAITS = [
    {
        "id": "portrait-wu-moi",
        "title": "吳旭智官方肖像",
        "region_ids": ["tw-hsinchu-county"],
        "actor_refs": ["wu"],
        "project_refs": None,
        "original_source_url": "https://commons.wikimedia.org/wiki/File:%E5%90%B3%E6%97%AD%E6%99%BA%E8%AD%B0%E5%93%A1.png",
        "creator": "內政部民政司",
        "license_name": "GWOIA（政府網站資料開放宣告）",
        "license_url": "https://cand.moi.gov.tw/of/home.jsp?mserno=201011010017&serno=201011010017&menudata=OfMenu&contlink=content/copyright.jsp",
        "attribution": "照片：內政部民政司（GWOIA）",
        "alt": "吳旭智官方肖像，正方形裁切，供候選人卡片使用",
        "focal_point": {"x": 0.5, "y": 0.5},
        "uses": ["person-card", "candidate-review"],
        "source_jpg": "public/img/persons/wu.jpg",
        "verified": "Commons 檔案頁模板 {{GWOIA}}，與既有 candidate_photos.json 一致。身份依據檔名與選舉人名冊相同，本線未改圖。",
    },
    {
        "id": "portrait-xu-ly",
        "title": "徐欣瑩官方肖像",
        "region_ids": ["tw-hsinchu-county"],
        "actor_refs": ["xu"],
        "project_refs": None,
        "original_source_url": "https://commons.wikimedia.org/wiki/File:%E5%BE%90%E6%AC%A3%E7%91%A9%E8%82%96%E5%83%8F.jpg",
        "creator": "立法院",
        "license_name": "LY-GWOIA（立法院政府網站資料開放宣告）",
        "license_url": None,
        "attribution": "照片：立法院（LY-GWOIA）",
        "alt": "徐欣瑩官方肖像，正方形裁切，供候選人卡片使用",
        "focal_point": {"x": 0.5, "y": 0.5},
        "uses": ["person-card", "candidate-review"],
        "source_jpg": "public/img/persons/xu.jpg",
        "verified": "Commons 檔案頁為 {{LY-GWOIA}}，模板未附獨立授權條款網址，license_url 保持 null。",
    },
    {
        "id": "portrait-zheng-moi",
        "title": "鄭朝方官方肖像",
        "region_ids": ["tw-hsinchu-county"],
        "actor_refs": ["zheng"],
        "project_refs": None,
        "original_source_url": "https://commons.wikimedia.org/wiki/File:%E6%96%B0%E7%AB%B9%E7%B8%A3%E7%AB%B9%E5%8C%97%E5%B8%82%E5%85%AC%E6%89%80_%E9%84%AD%E6%9C%9D%E6%96%B9.jpg",
        "creator": "中華民國內政部",
        "license_name": "GWOIA（政府網站資料開放宣告）",
        "license_url": "https://www.moi.gov.tw/cp.aspx?n=10954",
        "attribution": "照片：中華民國內政部（GWOIA）",
        "alt": "鄭朝方官方肖像，正方形裁切，供候選人卡片使用",
        "focal_point": {"x": 0.5, "y": 0.5},
        "uses": ["person-card", "candidate-review"],
        "source_jpg": "public/img/persons/zheng.jpg",
        "verified": "Commons 檔案頁模板 {{GWOIA}}，zhurl 為內政部開放宣告頁。",
    },
]

SCENES = [
    {
        "id": "scene-hsinchu-city-hall-2015",
        "title": "新竹市政府（市役所）",
        "commons": "Hsinchu City Hall 20150403.jpg",
        "region_ids": ["tw-hsinchu-city"],
        "alt": "新竹市政府正門，門額為新竹市政府，2015年4月3日",
        "uses": ["place-context", "city-scene"],
    },
    {
        "id": "scene-hsinchu-tra-station-2024",
        "title": "新竹車站周邊鐵道",
        "commons": "Hsinchu TRA Station Railway, Nov 2024.jpg",
        "region_ids": ["tw-hsinchu-city"],
        "alt": "新竹火車站周邊的軌道、電車線與市區天際線，2024年11月。畫面沒有月台或列車",
        "uses": ["place-context", "city-scene"],
    },
    {
        "id": "scene-taipei-city-hall",
        "title": "臺北市市政大樓",
        "commons": "Taipei Taiwan Taipei-City-Hall-01.jpg",
        "region_ids": ["tw-taipei"],
        "alt": "臺北市市政大樓與左側的臺北101",
        "uses": ["place-context", "city-scene"],
    },
    {
        "id": "scene-new-taipei-fire-hq-2016",
        "title": "新北市政府消防局總隊部",
        "commons": "Headquarters of Fire Department, New Taipei City Government face to Golf Road 2016.jpg",
        "region_ids": ["tw-new-taipei"],
        "alt": "新北市政府消防局總隊部臨高爾富路側，2016年",
        "uses": ["place-context", "public-building"],
    },
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    digest.update(path.read_bytes())
    return digest.hexdigest()


def now() -> str:
    return datetime.now(TZ).isoformat(timespec="seconds")


def strip_html(value: str) -> str:
    text = re.sub(r"<[^>]+>", "", value or "")
    return re.sub(r"\s+", " ", text).strip() or None


def fetch_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def commons_meta(filename: str) -> dict:
    title = "File:" + filename
    url = "https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode({
        "action": "query",
        "format": "json",
        "prop": "imageinfo",
        "iiprop": "url|size|mime|extmetadata",
        "titles": title,
    })
    payload = fetch_json(url)
    page = next(iter(payload["query"]["pages"].values()))
    if "missing" in page:
        raise RuntimeError(f"missing commons file {filename}")
    info = page["imageinfo"][0]
    meta = info.get("extmetadata") or {}

    def field(name: str) -> str:
        return strip_html((meta.get(name) or {}).get("value", ""))

    return {
        "page": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_")),
        "license_name": field("LicenseShortName"),
        "creator": field("Artist"),
        "attribution": field("Credit") or field("Artist"),
        "description": field("ImageDescription"),
    }


def download_thumb(filename: str, dest: Path, width: int = 1280) -> None:
    url = "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(filename) + f"?width={width}"
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    dest.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(request, timeout=90) as response:
        data = response.read()
    if data[:5] == b"<!DOC" or data[:1] == b"<" or len(data) < 1000:
        raise RuntimeError(f"not an image: {filename}")
    dest.write_bytes(data)


def write_rasters(image: Image.Image, directory: Path, stem: str, thumb: int) -> list[dict]:
    directory.mkdir(parents=True, exist_ok=True)
    image = image.convert("RGB")
    files = []
    specs = [
        (directory / f"{stem}.jpg", "JPEG", "image/jpeg", "fallback", None),
        (directory / f"{stem}.webp", "WEBP", "image/webp", "web", None),
        (directory / f"{stem}.avif", "AVIF", "image/avif", "web", None),
    ]
    for path, fmt, mime, role, _ in specs:
        save(image, path, fmt)
        with Image.open(path) as check:
            width, height = check.size
        files.append(file_record(path, mime, role, width, height))
    thumb_image = image.copy()
    thumb_image.thumbnail((thumb, thumb))
    thumb_path = directory / f"{stem}-thumb.webp"
    save(thumb_image, thumb_path, "WEBP")
    with Image.open(thumb_path) as check:
        width, height = check.size
    files.append(file_record(thumb_path, "image/webp", "thumb", width, height))
    return files


def save(image: Image.Image, path: Path, fmt: str) -> None:
    if fmt == "JPEG":
        image.save(path, format="JPEG", quality=86, optimize=True)
    elif fmt == "WEBP":
        image.save(path, format="WEBP", quality=82, method=6)
    elif fmt == "AVIF":
        image.save(path, format="AVIF", quality=50)
    else:
        raise ValueError(fmt)


def file_record(path: Path, mime: str, role: str, width: int, height: int) -> dict:
    relative = path.relative_to(PUBLIC).as_posix()
    return {
        "path": relative,
        "mime": mime,
        "role": role,
        "width": width,
        "height": height,
        "bytes": path.stat().st_size,
        "checksum": sha256(path),
    }


def portrait_assets(retrieved: str) -> list[dict]:
    assets = []
    for item in PORTRAITS:
        source = ROOT / item["source_jpg"]
        with Image.open(source) as image:
            width, height = image.size
            if width != height or width < 256:
                raise RuntimeError(f"{item['id']} does not meet the square 256 portrait gate")
            raster = image.convert("RGB")
        directory = ART / "portraits" / item["id"]
        files = [{
            **file_record(source, "image/jpeg", "original", width, height),
            "note": "既有網站檔，本線未改像素",
        }]
        files.extend(write_rasters(raster, directory, item["id"], 128))
        # The raster writer also emits a full-size jpeg duplicate. Keep it as fallback
        # and retain the untouched original as the master.
        assets.append(base_asset(item, "portrait", files, retrieved, width, height))
    return assets


def scene_assets(retrieved: str) -> list[dict]:
    assets = []
    for item in SCENES:
        meta = commons_meta(item["commons"])
        if meta["license_name"] not in ALLOWED:
            raise RuntimeError(f"{item['id']} license {meta['license_name']!r} is not on the allowlist")
        if not meta["creator"]:
            raise RuntimeError(f"{item['id']} has no creator")
        raw = ART / "scenes" / item["id"] / "source.jpg"
        download_thumb(item["commons"], raw, 1280)
        with Image.open(raw) as image:
            image.load()
            if image.width < 640:
                raise RuntimeError(f"{item['id']} download is too small")
            files = write_rasters(image, raw.parent, item["id"], 480)
        raw.unlink()
        record = {
            **item,
            "actor_refs": None,
            "project_refs": None,
            "original_source_url": meta["page"],
            "creator": meta["creator"],
            "license_name": meta["license_name"],
            "license_url": LICENSE_URL[meta["license_name"]],
            "attribution": f"{meta['creator']}／{meta['license_name']}",
            "focal_point": None,
            "verified": "Commons imageinfo LicenseShortName 在允許清單內；本機檔是寬度 1280 的縮圖，未再裁切。",
        }
        primary = next(entry for entry in files if entry["role"] == "fallback")
        assets.append(base_asset(record, "scene", files, retrieved, primary["width"], primary["height"]))
    return assets


def figure_asset(retrieved: str) -> dict:
    directory = ART / "figures" / "evidence-bench"
    files = []
    for name, mime, role in (
        ("preview.svg", "image/svg+xml", "preview"),
        ("index.html", "text/html", "interactive"),
    ):
        path = directory / name
        if not path.exists():
            raise RuntimeError("evidence bench is not built")
        files.append({
            "path": path.relative_to(PUBLIC).as_posix(),
            "mime": mime,
            "role": role,
            "width": 680 if name.endswith(".svg") else None,
            "height": 440 if name.endswith(".svg") else None,
            "bytes": path.stat().st_size,
            "checksum": sha256(path),
        })
    return {
        "id": "component-evidence-bench",
        "kind": "component",
        "title": "證據壓印台",
        "region_ids": ["tw-taipei", "tw-new-taipei", "tw-hsinchu-county", "tw-hsinchu-city", "tw-central"],
        "actor_refs": None,
        "project_refs": None,
        "original_source_url": None,
        "creator": "新竹觀察美術庫",
        "license_name": "CC0-1.0",
        "license_url": "https://creativecommons.org/publicdomain/zero/1.0/",
        "attribution": "原創示意儀器，新竹觀察美術庫",
        "retrieved_at": retrieved,
        "review_status": "publication-ready",
        "usage_status": "available",
        "files": files,
        "dimensions": {"width": 680, "height": 440, "unit": "px"},
        "alt": "立體證據壓印台，用來說明尚未核對、機關報告與獨立查核，不是特定工程，也不是政策百分比",
        "focal_point": None,
        "checksum": files[0]["checksum"],
        "uses": ["source-credibility", "explainer", "empty-state"],
        "palette": [
            {"name": "paper", "hex": "#f4efe6"},
            {"name": "sheet", "hex": "#fffaf4"},
            {"name": "ink", "hex": "#2b261f"},
            {"name": "sage", "hex": "#2f6a56"},
            {"name": "clay", "hex": "#9a5340"},
        ],
        "reproduction": "original-anatomy-figure",
        "suggested_use": "第一線在來源說明、空狀態或可信度圖例使用；不可把夾厚當成施政數據。",
    }


def base_asset(item: dict, kind: str, files: list[dict], retrieved: str, width: int, height: int) -> dict:
    primary = next(entry for entry in files if entry["role"] in {"original", "fallback", "preview"})
    return {
        "id": item["id"],
        "kind": kind,
        "title": item["title"],
        "region_ids": item["region_ids"],
        "actor_refs": item["actor_refs"],
        "project_refs": item["project_refs"],
        "original_source_url": item["original_source_url"],
        "creator": item["creator"],
        "license_name": item["license_name"],
        "license_url": item["license_url"],
        "attribution": item["attribution"],
        "retrieved_at": retrieved,
        "review_status": "publication-ready",
        "usage_status": "available",
        "files": files,
        "dimensions": {"width": width, "height": height, "unit": "px"},
        "alt": item["alt"],
        "focal_point": item["focal_point"],
        "checksum": primary["checksum"],
        "uses": item["uses"],
        "palette": None,
        "reproduction": item.get("verified"),
        "suggested_use": suggested(kind),
    }


def suggested(kind: str) -> str:
    if kind == "portrait":
        return "人物卡與候選人閱讀。與其他官方肖像同一正方形比例，勿再裁成不同臉部比例。"
    if kind == "scene":
        return "城市或公共建築的實景上下文。這是該拍攝日期的外觀，不是工程進度證明。"
    return "示意元件。"


def copy_lab() -> None:
    target = ART
    target.mkdir(parents=True, exist_ok=True)
    for name in ("lab.css", "lab.js"):
        shutil.copyfile(SRC / name, target / name)


def main() -> None:
    retrieved = now()
    copy_lab()
    assets = [*portrait_assets(retrieved), *scene_assets(retrieved), figure_asset(retrieved)]
    catalog = {
        "schema_version": 1,
        "timezone": "Asia/Taipei",
        "generated_at": retrieved,
        "publication": "publication-ready",
        "regions": [
            {"id": "tw-taipei", "label": "臺北市"},
            {"id": "tw-new-taipei", "label": "新北市"},
            {"id": "tw-hsinchu-county", "label": "新竹縣"},
            {"id": "tw-hsinchu-city", "label": "新竹市"},
            {"id": "tw-central", "label": "中央"},
        ],
        "kinds": [
            {"id": "portrait", "label": "人物"},
            {"id": "scene", "label": "場景"},
            {"id": "illustration", "label": "插畫"},
            {"id": "component", "label": "3D元件"},
        ],
        "coverage_gaps": [
            "新竹縣尚無已核對城市實景。",
            "中央機關尚無已核對實景。",
            "插畫尚無已核對素材。",
            "朱定瑀、曾聖凱尚無已核對肖像。",
            "邱臣遠的既有影像未進入本索引：授權與身份未在本線核對。",
            "議會、預算、政策階段與空狀態仍待後續原創元件；目前只有證據壓印台。",
            "地圖底圖未入庫。",
        ],
        "assets": assets,
    }
    DATA.parent.mkdir(parents=True, exist_ok=True)
    DATA.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {DATA} assets={len(assets)}")


if __name__ == "__main__":
    main()
