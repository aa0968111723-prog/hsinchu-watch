"""Report what a deployed site serves for the art library. Read-only.

    python tests/art-library/check_live.py                       # https://hsinchu-watch.pages.dev
    python tests/art-library/check_live.py http://127.0.0.1:4173

It prints facts and compares the deployed index with the one in this checkout.
It does not decide whether a release is good; the browser checks do that.
"""
from __future__ import annotations

import hashlib
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
UA = "hsinchu-watch-art-library/0.2 (deployment check)"


def get(url: str) -> tuple[int | None, dict, bytes]:
    request = urllib.request.Request(url, headers={"User-Agent": UA, "Cache-Control": "no-cache"})
    lowered = lambda headers: {name.lower(): value for name, value in headers.items()}
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, lowered(response.headers), response.read()
    except urllib.error.HTTPError as error:
        return error.code, lowered(error.headers), b""
    except OSError as error:
        return None, {}, str(error).encode()


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    base = (sys.argv[1] if len(sys.argv) > 1 else "https://hsinchu-watch.pages.dev").rstrip("/")
    local = json.loads((ROOT / "public/data/art-library.json").read_text(encoding="utf-8"))
    report: dict = {"base": base}

    status, headers, body = get(base + "/asset-lab.html")
    text = body.decode("utf-8", "replace")
    report["page"] = {
        "status": status,
        "bytes": len(body),
        "has_iframe": "<iframe" in text,
        "has_inline_script": any("src=" not in tag.split(">", 1)[0] for tag in text.split("<script")[1:]),
        "has_review_filter": 'name="review"' in text,
        "csp": headers.get("content-security-policy"),
        "x_frame_options": headers.get("x-frame-options"),
    }

    status, _, body = get(base + "/data/art-library.json")
    report["index"] = {"status": status}
    if status == 200:
        live = json.loads(body)
        live_ids = [asset["id"] for asset in live["assets"]]
        local_ids = [asset["id"] for asset in local["assets"]]
        report["index"].update({
            "schema_version": live.get("schema_version"),
            "generated_at": live.get("generated_at"),
            "assets": len(live_ids),
            "same_bytes_as_this_checkout": hashlib.sha256(body).hexdigest() == hashlib.sha256((ROOT / "public/data/art-library.json").read_bytes()).hexdigest(),
            "only_live": sorted(set(live_ids) - set(local_ids)),
            "only_in_this_checkout": sorted(set(local_ids) - set(live_ids)),
            "licences_of_original_components": sorted({asset["license_name"] for asset in live["assets"] if asset["kind"] == "component"}),
        })

    for path in ("/art-library/figures/evidence-desk/fragment.html", "/art-library/figures/evidence-bench/index.html", "/art-library/figures/boot.js"):
        status, headers, body = get(base + path)
        # Cloudflare Pages answers an unknown path with the home page and status 200, so look at the type.
        report[path] = {"status": status, "type": headers.get("content-type"), "bytes": len(body)}

    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
