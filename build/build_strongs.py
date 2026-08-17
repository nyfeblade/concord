"""Step 8 - the original languages.

The KJV shipped by scrollmapper in OSIS form tags almost every English phrase
with the Strong's number of the Hebrew or Greek word behind it. Combined with
Strong's own lexicon this gives the thing a concordance is actually for: pick
a word, see what it is underneath, and find every other place that same
original word is used - regardless of how the English varies.

Three artefacts:
  strongs/dict/<shard>.json  number -> lemma, transliteration, definition
  strongs/words/<book>.json  verse  -> the KJV text as tagged chunks
  strongs/occ/<shard>.json   number -> every verse it occurs in

The markup is not plain XML-in-a-string. It carries self-closing <w/> spans
for Greek words with no English equivalent, <transChange> for the words the
KJV translators supplied (printed in italics), <divineName> nested inside
tagged spans, and <title> for psalm superscriptions. All of that has to be
walked rather than pattern-matched away.
"""

import csv
import html
import json
import os
import re
from collections import Counter, defaultdict

from common import (OUT, RAW, human, load_books, load_spine, log, norm_book,
                    write_json)

TAG = re.compile(r"<(/?)([A-Za-z][\w:.-]*)((?:\"[^\"]*\"|[^>\"])*?)(/?)>")
STRONG = re.compile(r"strong:([HG])0*(\d+)")
INNER = re.compile(r"<[^>]+>")
ENGLISH = re.compile(r"[^A-Za-z' -]")

# A tagged span carries whatever English words attach to the original word,
# articles and prepositions included, so "mercy", "and mercy" and "of thy
# mercy" all tag the same Hebrew. Stripping the leading function words
# consolidates them into one honest count.
LEADING = re.compile(
    r"^(?:and|but|or|the|a|an|of|for|in|on|to|unto|with|by|from|is|was|are|were|"
    r"be|his|her|their|thy|thine|my|mine|our|your|its|that|which|shall|will|"
    r"not|him|them|it|he|she|they|we|you|ye|thou|as|so|then|there|" 
    r"all|when|out|up|upon)\s+")


def rendering_of(text):
    word = ENGLISH.sub("", text).strip().lower()
    while True:
        stripped = LEADING.sub("", word, count=1)
        if stripped == word:
            return stripped.strip()
        word = stripped
SHARD = 500


def strong_id(lang, number):
    return f"{lang}{int(number)}"


def parse_verse(markup):
    """Walk the OSIS fragment into ordered chunks plus marginal notes.

    Each chunk is {t: text, s: [strong ids], a: added-by-translator}. A chunk
    with no ids is untagged material - punctuation, or English the tagger
    never attached to an original word.

    <note> elements hold the KJV translators' own marginal readings ("Heb.
    between the light and between the darkness"). They are not part of the
    verse and must not be concatenated into it, but they are worth keeping:
    they are the 1611 apparatus telling you where the English is a judgement
    call.
    """
    chunks = []
    notes = []
    pos = 0
    added_depth = 0

    def push(text, ids, added):
        if not text:
            return
        text = html.unescape(INNER.sub("", text))
        if not text:
            return
        if chunks and not ids and not chunks[-1]["s"] and chunks[-1]["a"] == added:
            chunks[-1]["t"] += text
        else:
            chunks.append({"t": text, "s": ids, "a": added})

    while pos < len(markup):
        m = TAG.search(markup, pos)
        if not m:
            push(markup[pos:], [], added_depth > 0)
            break
        if m.start() > pos:
            push(markup[pos:m.start()], [], added_depth > 0)

        closing, name, attrs, selfclose = m.groups()
        pos = m.end()

        if name == "note" and not closing and not selfclose:
            end = markup.find("</note>", pos)
            if end == -1:
                end = len(markup)
            body = html.unescape(INNER.sub("", markup[pos:end])).strip()
            if body:
                notes.append(re.sub(r"\s+", " ", body))
            pos = end + 7
        elif name == "w" and not closing:
            ids = [strong_id(l, n) for l, n in STRONG.findall(attrs)]
            if selfclose:
                # A Greek word the KJV did not render into a separate English
                # word - usually the article. It still belongs to the verse's
                # vocabulary, so keep it with no text of its own.
                if ids:
                    chunks.append({"t": "", "s": ids, "a": False})
                continue
            end = markup.find("</w>", pos)
            if end == -1:
                end = len(markup)
            push(markup[pos:end], ids, added_depth > 0)
            pos = end + 4
        elif name == "transChange":
            if closing:
                added_depth = max(0, added_depth - 1)
            elif not selfclose:
                added_depth += 1
        # every other tag (q, milestone, title, div) contributes no text
    return chunks, notes


def load_lexicon():
    entries = {}
    path = os.path.join(RAW, "Strongs.csv")
    with open(path, newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            raw = row["StrongsID"].strip()
            m = re.match(r"([HG])0*(\d+)", raw)
            if not m:
                continue
            definition = " ".join(row["description"].split())
            entries[strong_id(m.group(1), m.group(2))] = {
                "l": row["lemma"].strip(),
                "x": row["xlit"].strip(),
                "p": row["pronounce"].strip(),
                "d": definition,
                "o": row["PartOfSpeech"].strip(),
                "g": row["Language"].strip().lower(),
            }
    return entries


def shard_of(sid):
    return f"{sid[0]}{int(sid[1:]) // SHARD:02d}"


def build():
    books = load_books()
    spine, _ = load_spine()
    by_key = {b["key"]: b["id"] for b in books}

    index = {}
    for i, (bid, ch, v) in enumerate(spine):
        index[(bid, ch, v)] = i

    with open(os.path.join(RAW, "KJV-osis.json"), encoding="utf-8") as f:
        doc = json.load(f)

    per_book = defaultdict(dict)
    occurrences = defaultdict(list)
    tagged_verses = 0
    total_tags = 0
    verse_notes = {}
    renderings = defaultdict(Counter)
    unknown_books = set()

    for b in doc["books"]:
        bid = by_key.get(norm_book(b["name"]))
        if bid is None:
            unknown_books.add(b["name"])
            continue
        for c in b["chapters"]:
            for v in c["verses"]:
                key = (bid, int(c["chapter"]), int(v["verse"]))
                vi = index.get(key)
                if vi is None:
                    continue
                chunks, notes = parse_verse(v["text"])
                if not any(ch["s"] for ch in chunks):
                    continue
                tagged_verses += 1
                seen = []
                out = []
                for ch in chunks:
                    entry = [ch["t"]]
                    if ch["s"]:
                        entry.append(ch["s"])
                        # How the KJV actually renders this original word. A
                        # span tagged with several numbers cannot be split
                        # between them, so only single-tag spans count.
                        if len(ch["s"]) == 1:
                            english = rendering_of(ch["t"])
                            if english:
                                renderings[ch["s"][0]][english] += 1
                        for sid in ch["s"]:
                            if sid not in seen:
                                seen.append(sid)
                        total_tags += len(ch["s"])
                    elif ch["a"]:
                        entry.append(0)          # supplied word, no numbers
                    if ch["a"] and ch["s"]:
                        entry.append(1)
                    out.append(entry)
                per_book[bid][str(vi)] = out
                if notes:
                    verse_notes[str(vi)] = notes
                for sid in seen:
                    occurrences[sid].append(vi)

    if unknown_books:
        log(f"  ! unmapped OSIS books: {sorted(unknown_books)}")

    size = 0
    for b in books:
        size += write_json(os.path.join(OUT, "strongs", "words", f"{b['id']}.json"),
                           per_book.get(b["id"], {}))
    log(f"  {tagged_verses} verses tagged, {total_tags} word tags, "
        f"words {human(size)}")

    nsize = write_json(os.path.join(OUT, "strongs", "notes.json"), verse_notes)
    log(f"  {len(verse_notes)} verses carry a translators' marginal note, "
        f"{human(nsize)}")

    # ---- lexicon
    lexicon = load_lexicon()
    used = set(occurrences)
    missing = used - set(lexicon)
    dict_shards = defaultdict(dict)
    for sid in used:
        entry = lexicon.get(sid)
        if entry:
            top = renderings[sid].most_common(12)
            entry = dict(entry, r=[[w, n] for w, n in top], n=len(occurrences[sid]))
            dict_shards[shard_of(sid)][sid] = entry
    dsize = 0
    for key, payload in dict_shards.items():
        dsize += write_json(os.path.join(OUT, "strongs", "dict", f"{key}.json"), payload)
    log(f"  {len(used)} distinct numbers in use, {len(used) - len(missing)} "
        f"with lexicon entries, dict {human(dsize)}")
    if missing:
        log(f"    {len(missing)} without a lexicon entry, e.g. {sorted(missing)[:5]}")

    # ---- occurrences
    occ_shards = defaultdict(dict)
    for sid, verses in occurrences.items():
        occ_shards[shard_of(sid)][sid] = verses
    osize = 0
    for key, payload in occ_shards.items():
        osize += write_json(os.path.join(OUT, "strongs", "occ", f"{key}.json"), payload)
    log(f"  occurrences {human(osize)}")

    write_json(os.path.join(OUT, "strongs", "meta.json"), dict(
        shard=SHARD,
        numbers=len(used),
        taggedVerses=tagged_verses,
        hebrew=sum(1 for s in used if s.startswith("H")),
        greek=sum(1 for s in used if s.startswith("G")),
    ))

    for probe in ["H2617", "G26", "H7965"]:
        sid = strong_id(probe[0], probe[1:])
        e = lexicon.get(sid)
        if e:
            top = ", ".join(f"{w} x{n}" for w, n in renderings[sid].most_common(6))
            log(f"    {sid:6s} {e['x']:14s} {len(occurrences[sid]):5d} verses")
            log(f"           KJV renders it: {top}")


if __name__ == "__main__":
    build()
