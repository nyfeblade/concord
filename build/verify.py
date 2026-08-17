"""Integrity checks over the built site data.

    python3 build/verify.py

These are the claims the app makes about itself. If one fails, something in
the pipeline is producing text or references that cannot be trusted, which for
a reference tool is the only failure that really matters.
"""

import json
import os
import random
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from common import OUT, TRANSLATIONS, load_books, load_spine  # noqa: E402

FAILURES = []
CHECKS = 0


def check(label, condition, detail=""):
    global CHECKS
    CHECKS += 1
    if condition:
        print(f"  pass  {label}")
    else:
        print(f"  FAIL  {label}  {detail}")
        FAILURES.append(label)


def load(path):
    full = os.path.join(OUT, path)
    if not os.path.exists(full):
        return None
    with open(full, encoding="utf-8") as f:
        return json.load(f)


def main():
    spine, _ = load_spine()
    books = load_books()
    meta = load("meta.json")

    print("\nspine and metadata")
    check("31,102 canonical verses", len(spine) == 31102, len(spine))
    check("66 books in meta", meta and len(meta["books"]) == 66)
    check("meta verse total agrees", meta and meta["verses"] == len(spine))
    total_from_meta = sum(sum(b["chapters"]) for b in meta["books"])
    check("chapter tables sum to the spine", total_from_meta == len(spine),
          f"{total_from_meta} vs {len(spine)}")

    print("\ntranslations")
    for t in TRANSLATIONS:
        tid = t["id"]
        missing = [b["id"] for b in books
                   if not os.path.exists(os.path.join(OUT, "text", tid, f"{b['id']}.json"))]
        check(f"{tid}: all 66 books present", not missing, missing[:4])

    # Every chapter file must have exactly the canonical number of verses,
    # otherwise a reference resolves to the wrong line of text.
    print("\nversification")
    bad = []
    for t in TRANSLATIONS:
        for b in meta["books"]:
            payload = load(f"text/{t['id']}/{b['id']}.json")
            if not payload:
                continue
            if len(payload["c"]) != len(b["chapters"]):
                bad.append(f"{t['id']} book {b['id']} chapter count")
                continue
            for ci, expected in enumerate(b["chapters"]):
                if len(payload["c"][ci]) != expected:
                    bad.append(f"{t['id']} {b['name']} {ci+1}: "
                               f"{len(payload['c'][ci])} != {expected}")
    check("every chapter matches the canonical verse count", not bad, bad[:3])

    print("\nknown verses (spot check against the printed text)")
    samples = [
        ("KJV", 43, 3, 16, "For God so loved the world"),
        ("KJV", 19, 23, 1, "The Lord is my shepherd"),
        ("KJV", 1, 1, 1, "In the beginning God created"),
        ("BSB", 50, 4, 6, "Be anxious for nothing"),
        ("BSB", 43, 11, 35, "Jesus wept"),
        ("KJV", 66, 22, 21, "The grace of our Lord Jesus Christ"),
        ("ASV", 40, 5, 3, "Blessed are the poor in spirit"),
    ]
    for tid, book_id, ch, v, needle in samples:
        payload = load(f"text/{tid}/{book_id}.json")
        text = payload["c"][ch - 1][v - 1] if payload else ""
        book = next(b for b in books if b["id"] == book_id)
        check(f"{tid} {book['name']} {ch}:{v}", needle.lower() in text.lower(),
              repr(text[:70]))

    print("\nsearch index")
    search_meta = load("search-meta.json")
    check("index metadata present", bool(search_meta))
    check("index covers 31,102 documents",
          search_meta and search_meta["docs"] == 31102)
    doclen = load("doclen.json")
    check("one document length per verse", doclen and len(doclen) == 31102)
    check("no empty documents in a full translation",
          doclen and sum(1 for d in doclen if d == 0) < 30,
          doclen and sum(1 for d in doclen if d == 0))

    # A stem drawn from the index must actually appear in the verses it points
    # at, via one of its recorded surface forms.
    rng = random.Random(7)
    shards = sorted(os.listdir(os.path.join(OUT, "index")))
    mismatches = []
    for _ in range(40):
        shard = rng.choice(shards)
        index = load(f"index/{shard}")
        surfaces = load(f"surfaces/{shard}") or {}
        stem = rng.choice(list(index))
        forms = set(surfaces.get(stem, []))
        if not forms:
            continue
        deltas = index[stem][0]
        running, picks = 0, []
        for d in deltas:
            running += d
            picks.append(running)
        target = rng.choice(picks)
        bid, ch, v = spine[target]
        found = False
        for t in TRANSLATIONS:
            payload = load(f"text/{t['id']}/{bid}.json")
            if not payload:
                continue
            words = set(''.join(c if c.isalpha() else ' '
                                for c in payload["c"][ch - 1][v - 1].lower()).split())
            if words & forms:
                found = True
                break
        if not found:
            mismatches.append(f"{stem} -> verse {target}")
    check("index postings point at verses containing the word",
          not mismatches, mismatches[:3])

    print("\nconcept graph")
    path = os.path.join(OUT, "concept-graph.bin")
    check("concept graph present", os.path.exists(path))
    if os.path.exists(path):
        with open(path, "rb") as f:
            raw = f.read()
        check("magic header", raw[:4] == b"CNG1")
        _k, n = struct.unpack("<II", raw[4:12])
        check("graph covers the whole spine", n == 31102, n)
        offsets = struct.unpack_from(f"<{n+1}I", raw, 12)
        check("offsets are monotonic",
              all(offsets[i] <= offsets[i + 1] for i in range(n)))
        total = offsets[-1]
        expected_bytes = 12 + 4 * (n + 1) + 4 * total + total
        check("declared size matches file size", expected_bytes == len(raw),
              f"{expected_bytes} vs {len(raw)}")
        covered = sum(1 for i in range(n) if offsets[i + 1] > offsets[i])
        check("at least 99% of verses have neighbours", covered / n > 0.99,
              f"{covered/n:.3%}")

    print("\ncross-references")
    xr = load("xref/43.json")
    check("John cross-references present", xr and len(xr) > 500, xr and len(xr))
    if xr:
        targets_ok = all(
            all(0 <= e[0] < 31102 and 0 <= e[-2 if len(e) == 3 else 0] < 31102
                for e in entries)
            for entries in list(xr.values())[:400])
        check("cross-reference targets are inside the spine", targets_ok)

    print("\ntopics and expansions")
    topics = load("topics.json")
    check("topics present", topics and len(topics) > 3000, topics and len(topics))
    check("topic verse ids are inside the spine",
          topics and all(0 <= v < 31102 for t in topics[:400] for v in t["v"]))
    thes = load("thesaurus.json")
    check("thesaurus present", thes and len(thes) > 4000, thes and len(thes))
    morph = load("morphology.json")
    check("morphology present", morph and len(morph) > 1000, morph and len(morph))
    check("anxiety reaches anxious",
          morph and "anxious" in morph.get("anxieti", []))

    print(f"\n{CHECKS - len(FAILURES)}/{CHECKS} checks passed")
    if FAILURES:
        print("failed: " + ", ".join(FAILURES))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
