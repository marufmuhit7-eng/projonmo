#!/usr/bin/env python3
"""
carve.py — ONE-TIME migration: split the single-app tree into src/.

Reads the current index.html + js/app.js and produces:

  src/shared/styles.css      unchanged
  src/shared/config.js       unchanged
  src/shared/common.js       QUESTIONS, CATEGORY_LABELS, getCategoryKey, lang toggle
  src/shared/images/         unchanged
  src/shared/head.html       <head> contents shared by both apps
  src/public/body.html       nav (admin tab removed) + home/register/exam/leaderboard/team/info + footer
  src/public/app.js          registration, exam, leaderboard
  src/admin/body.html        the admin section, restyled as a standalone page
  src/admin/admin.js         admin login + question editor + registration table

Every line of js/app.js is asserted to land in exactly one output file.
After this runs, src/ is the source of truth and tools/build.py generates the
two deployable folders. This script is kept only for provenance.
"""
from __future__ import annotations

import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

# --- js/app.js line ranges (1-based, inclusive) ---------------------------
COMMON_RANGES = [
    (11, 14),    # langToggle listener
    (60, 247),   # const QUESTIONS
    (303, 307),  # const CATEGORY_LABELS
    (309, 315),  # function getCategoryKey
]
ADMIN_RANGES = [
    (249, 249),  # const ADMIN_PASSWORD
    (501, 606),  # the whole admin block
]
# everything else -> public


def in_ranges(n: int, ranges: list[tuple[int, int]]) -> bool:
    return any(a <= n <= b for a, b in ranges)


def main() -> None:
    app = (ROOT / "js" / "app.js").read_text(encoding="utf-8").split("\n")
    total = len(app)

    common, admin, public = [], [], []
    for i, line in enumerate(app, start=1):
        if in_ranges(i, COMMON_RANGES):
            common.append(line)
        elif in_ranges(i, ADMIN_RANGES):
            admin.append(line)
        else:
            public.append(line)

    assert len(common) + len(admin) + len(public) == total, "line accounting failed"
    print(f"js/app.js {total} lines -> common {len(common)}, public {len(public)}, admin {len(admin)}")

    for d in ["shared/images", "public", "admin"]:
        (SRC / d).mkdir(parents=True, exist_ok=True)

    # --- shared, copied verbatim ------------------------------------------
    shutil.copy2(ROOT / "css" / "styles.css", SRC / "shared" / "styles.css")
    for name in ("config.js", "supabase-config.js", "supabase-db.js", "settings.js"):
        shutil.copy2(ROOT / "js" / name, SRC / "shared" / name)
    for img in (ROOT / "images").iterdir():
        shutil.copy2(img, SRC / "shared" / "images" / img.name)

    header = (
        "/* common.js — shared by the public site and the admin panel.\n"
        " * Generated from the original single-file app. Loads before app.js/admin.js.\n"
        " * Edit here, then run: python3 tools/build.py\n"
        " */\n"
    )
    (SRC / "shared" / "common.js").write_text(header + "\n".join(common).strip() + "\n", encoding="utf-8")
    (SRC / "public" / "app.js").write_text("\n".join(public).strip() + "\n", encoding="utf-8")
    (SRC / "admin" / "admin.js").write_text("\n".join(admin).strip() + "\n", encoding="utf-8")

    # --- html ---------------------------------------------------------------
    html = (ROOT / "index.html").read_text(encoding="utf-8").split("\n")

    def lines(a: int, b: int) -> str:
        return "\n".join(html[a - 1:b])

    # nav with the admin tab (line 34) removed
    nav = lines(21, 33) + "\n" + lines(35, 38)
    public_body = nav + "\n" + lines(39, 356) + "\n" + lines(427, 433)
    (SRC / "public" / "body.html").write_text(public_body.strip() + "\n", encoding="utf-8")

    (SRC / "admin" / "section.html").write_text(lines(357, 426).strip() + "\n", encoding="utf-8")
    (SRC / "shared" / "footer.html").write_text(lines(428, 433).strip() + "\n", encoding="utf-8")

    print("wrote src/")
    for p in sorted(SRC.rglob("*")):
        if p.is_file():
            print(f"  {p.relative_to(ROOT)}  ({p.stat().st_size:,} bytes)")


if __name__ == "__main__":
    sys.exit(main())
