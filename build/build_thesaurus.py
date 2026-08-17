"""Step 6 - derive a thesaurus from the translations themselves.

Twelve translations of the same verse form a parallel corpus. Where the KJV
says "careful" and the Berean says "anxious" in the same verse, two committees
of scholars have declared those words equivalent. Harvesting that gives a
domain-exact thesaurus with no model and no word list.

The discriminating trick is complementary distribution. Inside one verse:

  "burnt" and "offering" appear together in every translation
      -> a collocation, not a synonym

  "careful" appears in the translations where "anxious" does not, and
  vice versa
      -> the two words are filling the same slot: a translation equivalent

So we only count a pair when the sets of translations containing each word are
disjoint, and we penalise pairs that are ever seen side by side in a single
rendering.
"""

import json
import os
import re
from collections import Counter, defaultdict
from itertools import combinations

from common import (OUT, TRANSLATIONS, human, load_spine, load_vocab, log,
                    write_json)

TOKEN = re.compile(r"[a-z]+")
MIN_PAIR = 4          # a pair must be attested in at least this many verses
MIN_RARE = 6          # and the rarer word must be attested this often overall
MAX_DF = 2500         # words this common substitute for everything: no signal
SHRINK = 6.0          # damps pairs that are only supported by a few verses
MAX_SYNONYMS = 10     # kept per word
MIN_SCORE = 0.10      # below this the pairs are noise


def _fold(word):
    """Collapse Early Modern orthography so seruant and servant look alike."""
    w = word.replace("v", "u").replace("j", "i").replace("y", "i")
    w = re.sub(r"(.)\1+", r"\1", w)          # doubled letters
    w = re.sub(r"e$", "", w)
    return w


def _edit_within_one(a, b):
    if abs(len(a) - len(b)) > 1:
        return False
    if len(a) > len(b):
        a, b = b, a
    i = j = 0
    slack = 1
    while i < len(a) and j < len(b):
        if a[i] == b[j]:
            i += 1
            j += 1
            continue
        if not slack:
            return False
        slack = 0
        if len(a) == len(b):
            i += 1
        j += 1
    return True


def is_spelling_variant(a, b):
    """True when two words are the same word spelled differently.

    These are worth keeping for recall - searching "servant" should still hit
    Tyndale's "seruant" - but they are not synonyms and should not be shown to
    a reader as related concepts.
    """
    fa, fb = _fold(a), _fold(b)
    return fa == fb or _edit_within_one(fa, fb)


def build():
    spine, _ = load_spine()
    n = len(spine)

    # Use the index's own surface -> stem map rather than stemming again, so
    # the thesaurus is keyed on exactly the stems the index stores.
    vocab = load_vocab()

    def stems_in(text):
        out = set()
        for word in TOKEN.findall(text.lower()):
            s = vocab.get(word)
            if s:                      # "" marks a stopword
                out.add(s)
        return out

    # ---- load every translation's rendering of every verse
    log("  loading renderings")
    renderings = [[] for _ in range(n)]   # verse -> list of stem sets
    for t in TRANSLATIONS:
        tdir = os.path.join(OUT, "text", t["id"])
        prev, chapters = None, []
        for i, (bid, ch, v) in enumerate(spine):
            if bid != prev:
                path = os.path.join(tdir, f"{bid}.json")
                chapters = json.load(open(path))["c"] if os.path.exists(path) else []
                prev = bid
            try:
                text = chapters[ch - 1][v - 1]
            except IndexError:
                text = ""
            if text:
                renderings[i].append(stems_in(text))

    # ---- count complementary and co-occurring pairs
    log("  aligning renderings")
    complementary = Counter()
    together = Counter()
    df = Counter()

    for sets in renderings:
        k = len(sets)
        if k < 4:
            continue                      # too few witnesses to judge
        holders = defaultdict(set)
        for ti, s in enumerate(sets):
            for stm in s:
                holders[stm].add(ti)
        for stm, who in holders.items():
            df[stm] += 1
        # Words present in nearly every rendering are the shared backbone of
        # the verse; they carry no information about which word substitutes
        # for which. Only the words the translations disagree about matter.
        variants = [s for s, who in holders.items() if 1 <= len(who) <= k * 0.7]
        if len(variants) > 40:
            variants = sorted(variants, key=lambda s: len(holders[s]))[:40]
        for a, b in combinations(sorted(variants), 2):
            wa, wb = holders[a], holders[b]
            if wa & wb:
                together[(a, b)] += 1     # seen side by side: collocation
            else:
                complementary[(a, b)] += 1

    log(f"  {len(complementary)} complementary pairs, {len(together)} collocate pairs")

    # ---- score
    scores = defaultdict(list)
    for (a, b), c in complementary.items():
        if c < MIN_PAIR:
            continue
        rare = min(df[a], df[b])
        if rare < MIN_RARE or max(df[a], df[b]) > MAX_DF:
            continue
        co = together[(a, b)]
        # Coverage of the *rarer* word, not Dice. Dice divides by the sum of
        # both frequencies, so a lopsided but real pair like anxious/careful
        # (15 uses against 200) scores near zero and gets thrown away. Asking
        # "what share of the rarer word does this pairing explain" keeps it.
        coverage = c / rare
        purity = c / (c + co)
        # Shrinkage. Without it a word used 4 times that happens to sit
        # opposite another 4 times scores a perfect 1.0, which is how
        # love -> mandragora and wicked -> snuffdish get in.
        confidence = c / (c + SHRINK)
        score = coverage * purity * confidence
        if score < MIN_SCORE:
            continue
        scores[a].append((score, b))
        scores[b].append((score, a))

    thesaurus = {}
    variants = 0
    for word, cands in scores.items():
        cands.sort(reverse=True)
        entries = []
        for s, w in cands[:MAX_SYNONYMS]:
            kind = 1 if is_spelling_variant(word, w) else 0
            variants += kind
            entries.append([w, round(s, 3), kind])
        thesaurus[word] = entries
    log(f"  {variants} entries tagged as spelling variants rather than synonyms")

    size = write_json(os.path.join(OUT, "thesaurus.json"), thesaurus)
    log(f"  {len(thesaurus)} words with synonyms, {human(size)}")

    for probe in ["anxious", "care", "love", "wicked", "joy", "servant"]:
        s = vocab.get(probe, probe)
        got = [e for e in thesaurus.get(s, []) if e[2] == 0][:6]
        log(f"    {probe:9s} -> " + (", ".join(f"{w}({v})" for w, v, _k in got) or "(none)"))


if __name__ == "__main__":
    build()
