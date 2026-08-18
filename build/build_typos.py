"""Step 10 - typo tolerance.

A misspelled word matches nothing. The index is exact by construction, so
"forgivness" or "Phillipians" simply falls out of the query and the reader is
told there are no results, which is both wrong and unhelpful.

The fix is a skeleton key. Collapse doubled letters, keep the first character,
throw away the vowels and the letters people most often slur, and most
misspellings of a word land on the same key as the word itself:

    philippians -> plpns        forgiveness  -> frgvns
    phillipians -> plpns        forgivness   -> frgvns
    philippains -> plpns        forgivenes   -> frgvns

That gives a small candidate set for any typed word; edit distance then picks
the best of them, and corpus frequency breaks ties. No model, no spellcheck
dictionary to ship - the vocabulary of the twelve translations is the
dictionary.

The skeleton handles doubled letters and wrong vowels outright, but not a
dropped consonant: "loniness" keys to lnns while "loneliness" keys to lnlns.
So each word is also filed under every single-character deletion of its own
skeleton, which is what makes that case resolve. It multiplies the number of
keys, not the size of the answer, and a query still reads exactly one shard.
"""

import json
import os
import re
from collections import Counter, defaultdict

from common import OUT, TRANSLATIONS, human, load_spine, load_vocab, log, write_json

TOKEN = re.compile(r"[a-z]+")
DROP = set("aeiouyhw")
MIN_LEN = 4          # shorter words are mostly stopwords, and too collision-prone
MAX_PER_KEY = 12


def skeleton(word):
    """The typo-resistant key. Must stay identical to the copy in js/typo.js."""
    word = word.lower()
    squeezed = []
    for ch in word:
        if not squeezed or squeezed[-1] != ch:
            squeezed.append(ch)
    if not squeezed:
        return ""
    head = squeezed[0]
    tail = "".join(c for c in squeezed[1:] if c not in DROP)
    return head + tail


def build():
    vocab = load_vocab()
    spine, _ = load_spine()

    # Surface frequency, so the most common spelling wins a tie. Read from the
    # built text rather than the raw sources so it matches what is indexed.
    freq = Counter()
    for t in TRANSLATIONS:
        tdir = os.path.join(OUT, "text", t["id"])
        for bid in range(1, 67):
            path = os.path.join(tdir, f"{bid}.json")
            if not os.path.exists(path):
                continue
            with open(path, encoding="utf-8") as f:
                payload = json.load(f)
            for chapter in payload["c"]:
                for verse in chapter:
                    if verse:
                        freq.update(TOKEN.findall(verse.lower()))

    # Concept-bridge keys are searchable words too, even though no translation
    # contains them, so a typo in "loneliness" has to be able to find them.
    concept_path = os.path.join(OUT, "concepts.json")
    concept_keys = []
    if os.path.exists(concept_path):
        with open(concept_path, encoding="utf-8") as f:
            concept_keys = [k for k in json.load(f) if " " not in k]

    candidates = {}
    for word in vocab:
        if len(word) >= MIN_LEN and vocab[word]:
            candidates[word] = freq.get(word, 1)
    for key in concept_keys:
        if len(key) >= MIN_LEN:
            candidates.setdefault(key, 1)

    buckets = defaultdict(list)
    exact = 0
    for word, n in candidates.items():
        key = skeleton(word)
        if len(key) < 2:
            continue
        buckets[key].append((n, word))
        exact += 1
        # File under each single-deletion of the skeleton as well, so a word
        # typed with a consonant missing still lands on it.
        if len(key) >= 4:
            for i in range(1, len(key)):        # never drop the first letter
                buckets[key[:i] + key[i + 1:]].append((n - 0.5, word))

    shards = defaultdict(dict)
    kept = 0
    for key, words in buckets.items():
        words.sort(reverse=True)
        picked = [w for _n, w in words[:MAX_PER_KEY]]
        kept += len(picked)
        shard = re.sub(r"[^a-z]", "_", (key[:2] + "_")[:2])
        shards[shard][key] = picked

    size = 0
    for shard, payload in shards.items():
        size += write_json(os.path.join(OUT, "fuzzy", f"{shard}.json"), payload)

    log(f"  {len(candidates)} words, {exact} exact keys expanded to "
        f"{len(buckets)} with deletions, {kept} entries kept, "
        f"{len(shards)} shards, {human(size)}")

    for probe in ["forgivness", "rightousness", "phillipians", "loniness",
                  "beleive", "recieve", "sheperd"]:
        key = skeleton(probe)
        hits = shards.get(re.sub(r"[^a-z]", "_", (key[:2] + "_")[:2]), {}).get(key, [])
        log(f"    {probe:14s} key={key:9s} -> {hits[:4]}")


if __name__ == "__main__":
    build()
