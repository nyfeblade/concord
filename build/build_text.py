"""Step 1 - normalise every translation onto the canonical verse spine.

Emits one JSON file per translation per book, plus docs/data/meta.json.
"""

import json
import os
import re

from common import (OUT, TRANSLATIONS, human, load_books, load_spine, log,
                    norm_book, src_file, write_json)

# Deuterocanonical books that only appear in the Douay-Rheims. They live
# outside the canonical spine and are reachable only when reading that
# translation.
DEUTERO_ORDER = [
    "Tobit", "Judith", "Wisdom", "Sirach", "Baruch",
    "I Maccabees", "II Maccabees", "Prayer of Manasses",
    "I Esdras", "II Esdras", "Additional Psalm", "Laodiceans",
]

WS = re.compile(r"\s+")


def clean(text):
    return WS.sub(" ", text or "").strip()


def build():
    books = load_books()
    spine, osis_by_book = load_spine()
    by_key = {b["key"]: b for b in books}

    # canonical chapter -> verse count
    canon = {}
    for bid, ch, vs in spine:
        canon[(bid, ch)] = max(canon.get((bid, ch), 0), vs)

    meta_translations = []
    total_bytes = 0

    for t in TRANSLATIONS:
        with open(src_file(t), encoding="utf-8") as f:
            doc = json.load(f)

        # book name -> {chapter: [verse texts indexed from 1]}
        chapters_by_book = {}
        extras = {}
        for b in doc["books"]:
            key = norm_book(b["name"])
            table = {}
            for c in b["chapters"]:
                slots = {}
                for v in c["verses"]:
                    slots[int(v["verse"])] = clean(v["text"])
                table[int(c["chapter"])] = slots
            if key in by_key:
                chapters_by_book[by_key[key]["id"]] = table
            else:
                extras[b["name"]] = table

        present = 0
        merged = 0
        tdir = os.path.join(OUT, "text", t["id"])

        for b in books:
            table = chapters_by_book.get(b["id"])
            if table is None:
                continue  # e.g. JPS has no New Testament
            out_chapters = []
            for ch in range(1, b["chapters"] + 1):
                slots = table.get(ch, {})
                n = canon.get((b["id"], ch), 0)
                row = []
                for v in range(1, n + 1):
                    row.append(slots.get(v, ""))
                # A couple of translations split a verse in two where the KJV
                # does not. Fold the overflow onto the last canonical verse so
                # no text is silently dropped.
                overflow = [slots[v] for v in sorted(slots) if v > n and slots[v]]
                if overflow and row:
                    row[-1] = (row[-1] + " " + " ".join(overflow)).strip()
                    merged += len(overflow)
                present += sum(1 for x in row if x)
                out_chapters.append(row)
            total_bytes += write_json(
                os.path.join(tdir, f"{b['id']}.json"), {"c": out_chapters})

        extra_meta = []
        if extras:
            payload = {}
            for name in DEUTERO_ORDER:
                if name not in extras:
                    continue
                table = extras[name]
                chs = [
                    [table[ch][v] for v in sorted(table[ch])]
                    for ch in sorted(table)
                ]
                slug = norm_book(name)
                payload[slug] = chs
                extra_meta.append(dict(slug=slug, name=name, chapters=len(chs)))
            unknown = set(extras) - set(DEUTERO_ORDER)
            if unknown:
                log(f"  ! {t['id']} unmapped books: {sorted(unknown)}")
            total_bytes += write_json(os.path.join(tdir, "extra.json"), payload)

        # Folding is only ever legitimate for a translation that splits one
        # canonical verse in two (Geneva and the NHEB each do this twice).
        # Anything more means the source uses a different versification and
        # would be silently corrupted by aligning it here.
        if merged > 5:
            raise SystemExit(
                f"{t['id']}: {merged} verses would be folded onto their "
                f"neighbours. This translation does not use KJV versification "
                f"and must not be aligned to the canonical spine.")

        coverage = present / len(spine)
        meta_translations.append(dict(
            id=t["id"], name=t["name"], year=t["year"], blurb=t["blurb"],
            coverage=round(coverage, 4),
            partial=bool(t.get("partial")) or coverage < 0.99,
            books=sorted(chapters_by_book),
            extra=extra_meta,
        ))
        log(f"  {t['id']:8s} {present:6d} verses  coverage {coverage:6.1%}"
            f"{f'  (+{merged} folded)' if merged else ''}")

    meta = dict(
        verses=len(spine),
        books=[dict(id=b["id"], name=b["name"], short=b["short"], div=b["div"],
                    osis=osis_by_book[b["id"]],
                    chapters=[canon[(b["id"], c)] for c in range(1, b["chapters"] + 1)])
               for b in books],
        translations=meta_translations,
    )
    write_json(os.path.join(OUT, "meta.json"), meta)
    log(f"  text total {human(total_bytes)}")


if __name__ == "__main__":
    build()
