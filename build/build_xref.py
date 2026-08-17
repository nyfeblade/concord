"""Step 2 - the cross-reference graph.

Source is the openbible.info dataset (CC-BY), itself compiled largely from
Torrey's Treasury of Scripture Knowledge. Each row is a directed link with a
community vote score. We keep both directions so that asking for the
cross-references of any verse returns everything connected to it.
"""

import os
from collections import defaultdict

from common import OUT, RAW, human, load_books, load_spine, log, write_json


def parse_ref(ref, osis_index):
    """'Prov.8.22' -> canonical index, or None if unresolvable."""
    parts = ref.split(".")
    if len(parts) != 3:
        return None
    book, ch, v = parts
    try:
        return osis_index[(book, int(ch), int(v))]
    except (KeyError, ValueError):
        return None


def build():
    books = load_books()
    spine, osis_by_book = load_spine()
    osis_index = {}
    for i, (bid, ch, v) in enumerate(spine):
        osis_index[(osis_by_book[bid], ch, v)] = i
    book_of = [bid for bid, _, _ in spine]

    links = defaultdict(dict)  # src -> {(start,end): votes}
    unresolved = defaultdict(int)
    rows = 0

    path = os.path.join(RAW, "cross_references.txt")
    with open(path, encoding="utf-8") as f:
        next(f)  # header
        for line in f:
            cols = line.rstrip("\n").split("\t")
            if len(cols) < 3:
                continue
            src_ref, dst_ref, votes = cols[0], cols[1], cols[2]
            try:
                votes = int(votes)
            except ValueError:
                votes = 0
            src = parse_ref(src_ref, osis_index)
            if src is None:
                unresolved[src_ref.split(".")[0]] += 1
                continue
            if "-" in dst_ref:
                a, b = dst_ref.split("-", 1)
                start, end = parse_ref(a, osis_index), parse_ref(b, osis_index)
            else:
                start = end = parse_ref(dst_ref, osis_index)
            if start is None or end is None or end < start:
                unresolved[dst_ref.split(".")[0]] += 1
                continue
            rows += 1
            key = (start, end)
            # keep the strongest vote if the pair appears more than once
            if votes > links[src].get(key, -10**9):
                links[src][key] = votes
            # reverse edge, so the relationship is visible from both ends
            for tgt in range(start, end + 1):
                rkey = (src, src)
                if votes > links[tgt].get(rkey, -10**9):
                    links[tgt][rkey] = votes

    if unresolved:
        log(f"  ! unresolved book tokens: {dict(sorted(unresolved.items(), key=lambda x: -x[1])[:8])}")

    total_bytes = 0
    per_book = defaultdict(dict)
    for src, targets in links.items():
        ranked = sorted(targets.items(), key=lambda kv: (-kv[1], kv[0][0]))
        per_book[book_of[src]][str(src)] = [
            [s, e, v] if e != s else [s, v] for (s, e), v in ranked
        ]

    for b in books:
        total_bytes += write_json(
            os.path.join(OUT, "xref", f"{b['id']}.json"), per_book.get(b["id"], {}))

    verses_with = len(links)
    edges = sum(len(v) for v in links.values())
    log(f"  {rows} source rows -> {edges} edges across {verses_with} verses "
        f"({verses_with/len(spine):.0%} of the Bible)")
    log(f"  xref total {human(total_bytes)}")


if __name__ == "__main__":
    build()
