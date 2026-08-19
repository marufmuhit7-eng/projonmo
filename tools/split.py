#!/usr/bin/env python3
"""
One-shot restructurer: single-file HTML  ->  index.html + css/ + js/ + images/

Reads SRC, writes:
  index.html      HTML only, with relative links to the extracted assets
  css/styles.css  contents of the single <style> block
  js/app.js       contents of the single <script> block
  images/*.jpg    every base64 data-URI image, de-duplicated by content hash

Verification (run at the end, exits non-zero on failure):
  1. CSS text round-trips byte-for-byte
  2. JS  text round-trips byte-for-byte
  3. every extracted image decodes to the exact original bytes
  4. no `data:image/...;base64` payload is left in index.html
"""
from __future__ import annotations

import base64
import hashlib
import pathlib
import re
import sys

SRC = "uttorbongo-heritage-fest (4).html"
ROOT = pathlib.Path(__file__).resolve().parent.parent

# Slug for the extracted artwork. Kept human-readable so the repo stays browsable.
IMAGE_SLUG = "heritage-fest-logo"


def fail(msg: str) -> None:
    print(f"FAIL: {msg}")
    sys.exit(1)


def main() -> None:
    src_path = ROOT / SRC
    if not src_path.exists():
        fail(f"source file not found: {src_path}")

    html = src_path.read_text(encoding="utf-8")

    # ---------- 1. images -------------------------------------------------
    # Map base64 payload -> written filename, so a payload used twice is
    # written once and referenced twice.
    written: dict[str, str] = {}
    originals: dict[str, bytes] = {}

    def replace_img(match: re.Match[str]) -> str:
        fmt, payload = match.group(1), match.group(2)
        if payload in written:
            return f'src="{written[payload]}"'
        raw = base64.b64decode(payload)
        ext = "jpg" if fmt in ("jpeg", "jpg") else fmt
        digest = hashlib.sha1(raw).hexdigest()[:8]
        name = f"{IMAGE_SLUG}-{digest}.{ext}"
        out = ROOT / "images" / name
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(raw)
        rel = f"./images/{name}"
        written[payload] = rel
        originals[rel] = raw
        print(f"  image  -> {rel}  ({len(raw):,} bytes)")
        return f'src="{rel}"'

    html = re.sub(r'src="data:image/([a-z+]+);base64,([^"]*)"', replace_img, html)

    # ---------- 2. css ----------------------------------------------------
    css_match = re.search(r"<style>\n?(.*?)\n?</style>", html, re.DOTALL)
    if not css_match:
        fail("no <style> block found")
    css = css_match.group(1)
    (ROOT / "css").mkdir(exist_ok=True)
    (ROOT / "css" / "styles.css").write_text(css + "\n", encoding="utf-8")
    print(f"  css    -> ./css/styles.css  ({len(css.splitlines()):,} lines)")
    html = html[: css_match.start()] + '<link rel="stylesheet" href="./css/styles.css">' + html[css_match.end() :]

    # ---------- 3. js -----------------------------------------------------
    js_match = re.search(r"<script>\n?(.*?)\n?</script>", html, re.DOTALL)
    if not js_match:
        fail("no <script> block found")
    js = js_match.group(1)
    (ROOT / "js").mkdir(exist_ok=True)
    (ROOT / "js" / "app.js").write_text(js + "\n", encoding="utf-8")
    print(f"  js     -> ./js/app.js  ({len(js.splitlines()):,} lines)")
    html = html[: js_match.start()] + '<script src="./js/app.js" defer></script>' + html[js_match.end() :]

    (ROOT / "index.html").write_text(html, encoding="utf-8")
    print(f"  html   -> ./index.html  ({len(html):,} bytes, was {src_path.stat().st_size:,})")

    # ---------- 4. verify -------------------------------------------------
    print("\nverifying...")
    out_html = (ROOT / "index.html").read_text(encoding="utf-8")

    if (ROOT / "css" / "styles.css").read_text(encoding="utf-8").rstrip("\n") != css.rstrip("\n"):
        fail("css round-trip mismatch")
    print("  ok  css round-trips byte-for-byte")

    if (ROOT / "js" / "app.js").read_text(encoding="utf-8").rstrip("\n") != js.rstrip("\n"):
        fail("js round-trip mismatch")
    print("  ok  js round-trips byte-for-byte")

    for rel, raw in originals.items():
        disk = (ROOT / rel.lstrip("./")).read_bytes()
        if disk != raw:
            fail(f"image bytes differ for {rel}")
    print(f"  ok  {len(originals)} image file(s) match original bytes")

    if "base64," in out_html:
        fail("a base64 payload is still inlined in index.html")
    print("  ok  no base64 payload left in index.html")

    # every local href/src in index.html must resolve to a real file
    missing = []
    for ref in re.findall(r'(?:href|src)="(\./[^"]+)"', out_html):
        if not (ROOT / ref.lstrip("./")).exists():
            missing.append(ref)
    if missing:
        fail(f"dangling local reference(s): {missing}")
    print("  ok  every relative href/src resolves to a file on disk")


if __name__ == "__main__":
    main()
