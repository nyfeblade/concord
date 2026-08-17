"""Step 3 - the lexical index.

One document per canonical verse, whose text is the union of that verse across
every shipped translation. That union is what makes cross-translation search
work: searching "lovingkindness" finds the verse even when you are reading a
translation that renders it "loving devotion".

Two artefacts ship:
  vocab/<xx>.json  surface form -> stem, so the browser never stems
  index/<xx>.json  stem -> postings
"""

import json
import os
import re
from collections import Counter, defaultdict

from common import OUT, TRANSLATIONS, human, load_spine, log, src_file, write_json
from stemmer import (ARCHAIC, IRREGULAR, archaic_candidates, modernise,
                     normalise_spelling, porter)

TOKEN = re.compile(r"[a-z]+")

# Excluded from the index entirely. They match nearly every verse, contribute
# no ranking signal, and would each carry a 25,000-entry posting list. Phrase
# queries still work because those are checked against the verse text itself.
STOPWORDS = {
    "the", "and", "of", "to", "that", "in", "he", "shall", "unto", "for",
    "i", "his", "a", "they", "be", "is", "him", "them", "it", "with", "all",
    "thou", "was", "thy", "which", "my", "me", "you", "but", "their", "have",
    "will", "thee", "from", "as", "are", "when", "we", "there", "your", "this",
    "out", "were", "so", "if", "on", "an", "at", "by", "or",
    "into", "up", "then", "hath", "had", "her", "she", "our", "us",
    "who", "one", "also", "may", "do", "did", "these", "those", "what",
}

# Negation is not noise in scripture. "fear not", "thou shalt not kill" and
# "nothing shall be impossible" all turn on a word a normal stoplist throws
# away, so these stay indexed despite being common.
KEEP_ANYWAY = {"not", "no", "nor", "never", "none", "nothing", "without"}
STOPWORDS -= KEEP_ANYWAY


# Translations whose spelling is modern. A word these use is a real word,
# which is what keeps the orthography pass from rewriting it.
MODERN_TRANSLATIONS = {"BSB", "NHEB", "WEB_ACV", "WEBSTER", "ASV"}


def normal_form(word, freq=None, modern=None):
    """The form a stopword decision is made on.

    Stopping has to happen here rather than on the stem. porter("use") is "us",
    so stopping by stem would silently drop every occurrence of use/used/using
    along with the pronoun. Stopping on the normalised surface keeps "us" out
    while leaving "use" indexed under the stem it shares.
    """
    if freq is not None:
        word = modernise(word, freq, modern)
    base = normalise_spelling(word)
    return IRREGULAR.get(base, base)


def resolve_stems(vocab, modern):
    """surface form -> stem.

    Four stages, each undoing a different way the translations disagree:
      1. orthography   seruant -> servant   (Early Modern u/v and i/j)
      2. spelling      honour  -> honor     (British and archaic variants)
      3. irregulars    spake   -> speak     (stem changes Porter cannot see)
      4. -eth/-est     loveth  -> love      (resolved against the real corpus)
    """
    # Stems we are confident in: from words that are not archaic inflections
    # and that appear often enough to be real.
    confident = set()
    for word, count in vocab.items():
        if count < 2 or word.endswith(ARCHAIC):
            continue
        confident.add(porter(normalise_spelling(modernise(word, vocab, modern))))

    mapping = {}
    archaic_hits = 0
    modern_hits = 0
    for word in vocab:
        fixed = modernise(word, vocab, modern)
        if fixed != word:
            modern_hits += 1
        base = normalise_spelling(fixed)
        if base in IRREGULAR:
            mapping[word] = porter(IRREGULAR[base])
            continue
        if base.endswith(ARCHAIC):
            chosen = None
            for cand in archaic_candidates(base):
                stem = porter(cand)
                if stem in confident:
                    chosen = stem
                    break
            if chosen:
                mapping[word] = chosen
                archaic_hits += 1
                continue
        mapping[word] = porter(base)
    log(f"  modernised {modern_hits} Early Modern spellings, "
        f"resolved {archaic_hits} -eth/-est forms")
    return mapping


def build():
    spine, _ = load_spine()
    n_docs = len(spine)

    # ---- pass 1: gather every surface form in every translation
    per_verse_tokens = [[] for _ in range(n_docs)]
    vocab = Counter()
    modern_vocab = Counter()
    for t in TRANSLATIONS:
        is_modern = t["id"] in MODERN_TRANSLATIONS
        with open(src_file(t), encoding="utf-8") as f:
            doc = json.load(f)
        # translations are already aligned to the spine by build_text, so read
        # the normalised output rather than the raw source
        tdir = os.path.join(OUT, "text", t["id"])
        offset = 0
        book_id = 0
        prev = None
        for i, (bid, ch, v) in enumerate(spine):
            if bid != prev:
                path = os.path.join(tdir, f"{bid}.json")
                chapters = json.load(open(path))["c"] if os.path.exists(path) else []
                prev = bid
            try:
                text = chapters[ch - 1][v - 1]
            except IndexError:
                text = ""
            if not text:
                continue
            words = TOKEN.findall(text.lower())
            per_verse_tokens[i].extend(words)
            vocab.update(words)
            if is_modern:
                modern_vocab.update(words)
    log(f"  {len(vocab)} surface forms across {sum(len(x) for x in per_verse_tokens)} tokens")

    # ---- pass 2: surface -> stem
    stem_of = resolve_stems(vocab, modern_vocab)
    stopped = {w for w in vocab if normal_form(w, vocab, modern_vocab) in STOPWORDS}
    log(f"  {len(stopped)} surface forms stopped "
        f"(e.g. {sorted(stopped - STOPWORDS)[:6]})")

    # ---- pass 3: postings
    postings = defaultdict(list)
    doclen = [0] * n_docs
    for i, words in enumerate(per_verse_tokens):
        counts = Counter()
        for w in words:
            if w in stopped:
                continue
            s = stem_of[w]
            if len(s) < 2:
                continue
            counts[s] += 1
        doclen[i] = sum(counts.values())
        for s, tf in counts.items():
            postings[s].append((i, tf))

    avgdl = sum(doclen) / n_docs
    log(f"  {len(postings)} stems, {sum(len(v) for v in postings.values())} postings, "
        f"avg doc length {avgdl:.1f}")

    # ---- emit index, sharded by the first two characters of the stem
    shards = defaultdict(dict)
    for stem, plist in postings.items():
        plist.sort()
        deltas, tfs, prev = [], [], 0
        for v, tf in plist:
            deltas.append(v - prev)
            prev = v
            tfs.append(min(tf, 255))
        shards[shard_key(stem)][stem] = [deltas, tfs]

    total = 0
    for key, payload in shards.items():
        total += write_json(os.path.join(OUT, "index", f"{key}.json"), payload)
    log(f"  index {len(shards)} shards, {human(total)}")

    # ---- emit vocab, sharded by the first two characters of the surface form
    # Stopped surfaces are emitted mapping to "" so the browser can recognise
    # and drop them. Otherwise "shalt" would look like an unknown word rather
    # than a stopword and would be searched for literally.
    vshards = defaultdict(dict)
    for word, stem in stem_of.items():
        vshards[shard_key(word)][word] = "" if word in stopped else stem
    vtotal = 0
    for key, payload in vshards.items():
        vtotal += write_json(os.path.join(OUT, "vocab", f"{key}.json"), payload)
    log(f"  vocab {len(vshards)} shards, {human(vtotal)}")

    # ---- reverse map: stem -> the surface forms that produced it.
    # The interface needs this to highlight accurately. Prefix matching cannot
    # connect "forgave" to the stem "forgiv", so without an exact list a verse
    # matched through an irregular form looks unmatched.
    surfaces = defaultdict(list)
    for word, stem in stem_of.items():
        if word in stopped:
            continue
        surfaces[stem].append(word)
    sshards = defaultdict(dict)
    for stem, forms in surfaces.items():
        sshards[shard_key(stem)][stem] = sorted(forms, key=lambda w: (len(w), w))
    stotal = 0
    for key, payload in sshards.items():
        stotal += write_json(os.path.join(OUT, "surfaces", f"{key}.json"), payload)
    log(f"  surfaces {len(sshards)} shards, {human(stotal)}")

    # ---- document lengths, needed for BM25 normalisation
    write_json(os.path.join(OUT, "doclen.json"), doclen)
    write_json(os.path.join(OUT, "search-meta.json"), dict(
        docs=n_docs, avgdl=round(avgdl, 3), stems=len(postings),
        stopwords=sorted(STOPWORDS),
    ))


def shard_key(term):
    head = term[:2]
    if len(head) < 2:
        head = head + "_"
    return re.sub(r"[^a-z_]", "_", head)


if __name__ == "__main__":
    build()
