"""Step 7 - link stems that share a derivational root.

Porter is an inflectional stemmer. It connects love/loves/loving/loved, but it
cannot connect anxiety to anxious, because those differ by a derivational
suffix rather than a grammatical ending. That gap is not academic: nobody
searching "anxiety" wants to miss Philippians 4:6, and no translation of that
verse contains the noun - the KJV has "careful", the Berean has "anxious".

Rather than guess one root per word, generate every root a word could have and
link words that share any of them. A wrong root is harmless as long as no
other word shares it; only agreement produces a link.
"""

import os
from collections import defaultdict

from common import OUT, human, load_vocab, log, write_json

# Derivational endings, longest first so "ousness" is tried before "ness".
SUFFIXES = [
    "ousness", "ability", "ibility", "fulness", "ization", "iveness",
    "ation", "ition", "ariti", "aliti", "iviti", "abil", "ibil",
    "ment", "ness", "tion", "sion", "ance", "ence", "ancy", "ency",
    "eous", "ious", "hood", "ship", "ward", "wise",
    "ous", "ful", "less", "able", "ible", "ish", "ism", "ist",
    "iti", "ity", "eti", "ive", "ary", "ory", "age", "ant", "ent",
    "al", "ic", "ize", "ise", "ify", "er", "or", "ee", "i", "e", "y",
]

MIN_ROOT = 4
MIN_STEM = 5          # short stems have too many accidental collisions
MAX_FAMILY = 8


def roots_of(stem):
    """Every root this stem could plausibly reduce to."""
    out = {stem}
    for suffix in SUFFIXES:
        if stem.endswith(suffix):
            base = stem[:-len(suffix)]
            if len(base) >= MIN_ROOT:
                out.add(base)
                # one more round, so "graciousness" can reach "grac"
                for second in SUFFIXES:
                    if base.endswith(second) and len(base) - len(second) >= MIN_ROOT:
                        out.add(base[:-len(second)])
    return {r for r in out if len(r) >= MIN_ROOT}


def build():
    vocab = load_vocab()
    stems = sorted({s for s in vocab.values() if s and len(s) >= MIN_STEM})
    log(f"  {len(stems)} stems eligible")

    by_root = defaultdict(set)
    for stem in stems:
        for root in roots_of(stem):
            by_root[root].add(stem)

    # A root shared by half the dictionary is not a root, it is a coincidence.
    families = defaultdict(set)
    for root, group in by_root.items():
        if not (2 <= len(group) <= MAX_FAMILY):
            continue
        for stem in group:
            families[stem] |= group - {stem}

    morph = {}
    for stem, siblings in families.items():
        # prefer siblings that look most like the word: shared prefix length
        ranked = sorted(siblings, key=lambda s: (-common_prefix(stem, s), len(s)))
        morph[stem] = ranked[:6]

    size = write_json(os.path.join(OUT, "morphology.json"), morph)
    log(f"  {len(morph)} stems with derivational siblings, {human(size)}")

    for probe in ["anxieti", "gracious", "righteous", "merci", "forgiv", "wisdom"]:
        log(f"    {probe:10s} -> {morph.get(probe, [])}")


def common_prefix(a, b):
    n = 0
    for x, y in zip(a, b):
        if x != y:
            break
        n += 1
    return n


if __name__ == "__main__":
    build()
