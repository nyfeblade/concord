"""Step 5 - Nave's and Torrey's topical indexes.

The third signal. A topic is a human saying "these verses are about X", which
catches cases the graph misses: verses nobody bothered to cross-reference but
that a topical editor filed under the same heading.

Topic names are also the most direct route from a plain-English query to a
concept, so they get their own little search index.
"""

import csv
import os
import re
from collections import defaultdict

from common import OUT, RAW, human, load_spine, log, write_json
from stemmer import IRREGULAR, normalise_spelling, porter

TOKEN = re.compile(r"[a-z]+")
NOISE = {"of", "the", "a", "an", "and", "or", "to", "in", "for", "with",
         "by", "on", "at", "from", "as", "is", "are", "be", "his", "her",
         "their", "its", "see", "also", "general", "references", "instances",
         "index", "unclassified", "figurative", "sundry"}


def stem(word):
    base = normalise_spelling(word)
    return porter(IRREGULAR.get(base, base))


def build():
    spine, _ = load_spine()
    n = len(spine)

    names = {}
    with open(os.path.join(RAW, "Topics.csv"), newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            names[int(row["TopicID"])] = (row["Topic"].strip(),
                                          row["Subtopic"].strip())

    members = defaultdict(list)
    with open(os.path.join(RAW, "TopicIndex.csv"), newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            tid = int(row["TopicID"])
            vid = int(row["VerseID"]) - 1     # VerseID is 1-based
            if 0 <= vid < n:
                members[tid].append(vid)

    # Group subtopics under their parent heading. A reader searching "prayer"
    # wants the whole subject, not 40 separate rows for its subheadings.
    by_heading = defaultdict(lambda: dict(subs=[], verses=set()))
    for tid, verses in members.items():
        if tid not in names:
            continue
        heading, sub = names[tid]
        entry = by_heading[heading]
        entry["verses"].update(verses)
        if sub:
            entry["subs"].append(dict(name=sub, v=sorted(set(verses))))

    topics = []
    for heading in sorted(by_heading):
        entry = by_heading[heading]
        verses = sorted(entry["verses"])
        if not verses:
            continue
        subs = sorted(entry["subs"], key=lambda s: -len(s["v"]))[:60]
        topics.append(dict(n=heading, v=verses, s=subs))

    # verse -> topics, so a result can explain which subjects it belongs to
    verse_topics = defaultdict(list)
    for i, t in enumerate(topics):
        for v in t["v"]:
            verse_topics[v].append(i)

    # topic-name search index: stem -> topic ids
    name_index = defaultdict(list)
    for i, t in enumerate(topics):
        seen = set()
        for word in TOKEN.findall(t["n"].lower()):
            if word in NOISE or len(word) < 2:
                continue
            s = stem(word)
            if s not in seen:
                seen.add(s)
                name_index[s].append(i)

    size = 0
    size += write_json(os.path.join(OUT, "topics.json"),
                       [dict(n=t["n"], v=t["v"]) for t in topics])
    size += write_json(os.path.join(OUT, "topic-subs.json"),
                       {str(i): t["s"] for i, t in enumerate(topics) if t["s"]})
    size += write_json(os.path.join(OUT, "topic-names.json"),
                       {k: v for k, v in name_index.items()})
    size += write_json(os.path.join(OUT, "verse-topics.json"),
                       {str(k): v for k, v in sorted(verse_topics.items())})

    covered = len(verse_topics)
    log(f"  {len(topics)} headings, {sum(len(t['v']) for t in topics)} assignments, "
        f"{covered}/{n} verses covered ({covered/n:.0%})")
    log(f"  topics total {human(size)}")


if __name__ == "__main__":
    build()
