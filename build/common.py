"""Shared helpers for the Concord build pipeline."""

import csv
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data", "raw")
OUT = os.path.join(ROOT, "docs", "data")

# Translations shipped with the app. `spine` describes how the source file's
# books line up with the canonical KJV versification:
#   full    - 66 books, KJV verse numbering
#   extra   - 66 books but a couple of chapters split a verse differently
#   ot      - Old Testament only
#   deutero - includes deuterocanonical books we keep as an appendix
TRANSLATIONS = [
    dict(id="KJV",   name="King James Version",        year=1769, spine="full",
         blurb="The 1611 translation in its 1769 standardised form."),
    dict(id="BSB",   name="Berean Standard Bible",     year=2022, spine="full",
         blurb="Modern, readable, and dedicated to the public domain."),
    dict(id="ASV",   name="American Standard Version", year=1901, spine="full",
         blurb="The 1901 American revision of the Revised Version."),
    dict(id="NHEB",  name="New Heart English Bible",   year=2010, spine="extra",
         blurb="A modern update in the Tyndale-KJV tradition."),
    dict(id="ACV",   name="A Conservative Version",  year=2005, spine="full",
         blurb="A literal modern translation by Walter L. Porter."),
    dict(id="YLT",   name="Young's Literal Translation", year=1898, spine="full",
         blurb="Rigidly literal, preserving Hebrew and Greek tense."),
    dict(id="DARBY", name="Darby Bible",               year=1890, spine="full",
         src="Darby", blurb="J. N. Darby's close translation from the critical texts."),
    dict(id="ROTH",  name="Rotherham's Emphasised Bible", year=1902, spine="full",
         src="Rotherham", blurb="Marks emphasis and word order from the originals."),
    dict(id="BBE",   name="Bible in Basic English",    year=1965, spine="full",
         blurb="Restricted to a 1,000-word core vocabulary."),
    dict(id="WEBSTER", name="Webster's Revision",      year=1833, spine="full",
         src="Webster", blurb="Noah Webster's light modernisation of the KJV."),
    dict(id="GEN",   name="Geneva Bible",              year=1599, spine="extra",
         src="Geneva1599", blurb="The study Bible of the Reformation, pre-dating the KJV."),
    dict(id="TYN",   name="Tyndale Bible",             year=1530, spine="full",
         src="Tyndale", partial=True,
         blurb="The first printed English New Testament. Pentateuch, Jonah and NT only."),
]

# Not shipped, though fetch_sources.sh downloads both and both are public
# domain. Neither uses KJV versification:
#   DRC - Vulgate psalm numbering, one behind the Hebrew for most of the
#         Psalter, so DRC Psalm 23 is KJV Psalm 24. Aligning it by chapter
#         number would show the wrong psalm with no visible sign of error.
#   JPS - counts Hebrew superscriptions as verses, shifting ~170 verses
#         inside the Psalms.
# Adding either back means teaching the reader a per-translation
# versification map first. build_text.py refuses to align them until then.
WITHHELD = ("DRC", "JPS")


def src_file(t):
    return os.path.join(RAW, (t.get("src") or t["id"]) + ".json")


def norm_book(name):
    """Normalise a book name so the different sources agree."""
    n = name.lower().strip()
    n = n.replace("revelation of john", "revelation")
    n = n.replace("song of songs", "song of solomon")
    n = n.replace("psalm", "psalms").replace("psalmss", "psalms")
    # roman numeral prefixes -> arabic
    for roman, arabic in (("iii ", "3 "), ("ii ", "2 "), ("i ", "1 ")):
        if n.startswith(roman):
            n = arabic + n[len(roman):]
            break
    return re.sub(r"[^a-z0-9]", "", n)


def load_books():
    """Canonical 66-book table, keyed by BookID 1..66."""
    books = []
    with open(os.path.join(RAW, "Books.csv"), newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            books.append(dict(
                id=int(row["BookID"]),
                name=row["BookName"],
                chapters=int(row["NumOfChapters"]),
                div=row["BookDiv"],
                short=row["ShortName"],
                key=norm_book(row["BookName"]),
            ))
    return books


def load_spine():
    """The 31,102 canonical verses in KJV order.

    Returns (verses, osis_by_book) where verses[i] = (book_id, chapter, verse)
    for canonical index i, and osis_by_book maps book_id -> OSIS abbreviation
    as used by the cross-reference dataset.
    """
    verses = []
    osis_by_book = {}
    with open(os.path.join(RAW, "Verses.csv"), newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            bid = int(row["BookID"])
            verses.append((bid, int(row["Chapter"]), int(row["VerseNum"])))
            if bid not in osis_by_book:
                osis_by_book[bid] = row["OsisRef"].rsplit(".", 2)[0]
    assert len(verses) == 31102, len(verses)
    return verses, osis_by_book


def load_vocab():
    """The surface-form -> stem map that build_index emitted.

    Every later step reads this rather than re-deriving stems. If the
    thesaurus stemmed independently it would key on "seru" while the index
    keyed on "servant", and every expansion would silently miss.
    """
    import glob
    vocab = {}
    for path in glob.glob(os.path.join(OUT, "vocab", "*.json")):
        with open(path, encoding="utf-8") as f:
            vocab.update(json.load(f))
    if not vocab:
        raise SystemExit("vocab/ is empty - run build_index.py first")
    return vocab


def write_json(path, obj, compact=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        if compact:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(obj, f, ensure_ascii=False, indent=1)
    return os.path.getsize(path)


def human(n):
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024


def log(*a):
    print(*a, file=sys.stderr, flush=True)
