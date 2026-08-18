# Concord

Search the whole Bible by concept, across twelve translations, entirely in your
browser. No account, no server, no API key, no AI.

**[Open it →](https://nyfeblade.github.io/concord/)**

Search *anxiety* and it returns Philippians 4:6 and Matthew 6:25 — neither of
which contains the word. Search *forgiving someone who wronged you* and it
returns Colossians 3:13, Matthew 18:35 and Ephesians 4:32. It does this without
a language model, and it can tell you exactly why each verse is on the list.

---

## How it finds things

Three independent signals are computed over the 31,102-verse canonical spine
and fused. Every one is a lookup, not a learned weight, which is why results
can explain themselves.

**Wording.** BM25 over all twelve translations at once, treating each verse as
a single document containing every rendering of it. Search `lovingkindness`
and you reach the verse even while reading a translation that says "loving
devotion".

**Cross-references.** 877,377 links between verses, compiled from Torrey's
Treasury of Scripture Knowledge and vote-weighted by openbible.info. Concord
treats them as a graph and precomputes a random walk with restart from every
verse, keeping its 32 strongest neighbours. At query time the best wording
matches seed a diffusion across that graph — which is how a verse with no
words in common with your query rises to the top.

**Topics.** 3,280 subject headings from Nave's and Torrey's topical indexes,
covering 88% of the Bible. Broad headings are weighted down: "Wicked" with 724
verses says less about any one of them than "Adoption" with twelve.

## Typos

An exact index matches nothing for a misspelling, so "forgivness" used to
return no results at all. Both the search box and the reference parser are now
tolerant.

Words are matched with a skeleton key: collapse doubled letters, keep the
first character, drop the vowels and the letters people slur. Most
misspellings land on the same key as the word itself — `philippians`,
`phillipians` and `philippains` all key to `plpns` — and edit distance picks
the best candidate, with corpus frequency breaking ties. Each word is also
filed under every single-character deletion of its key, which is what catches
a dropped consonant (`loniness` → `loneliness`). No spellcheck dictionary
ships: the vocabulary of the twelve translations is the dictionary.

Book names get the same treatment, cautiously. `Phillipians 4:6`,
`Genisis 1:1`, `Ecclesiates 3:1`, `Mathew 5:3` and `Psalsm 23` all go straight
to the text. `Corinthans 13` deliberately does not — it is equally close to
1 and 2 Corinthians, and guessing would be worse than asking. Ordinary
searches like `hope` or `wisdom 5` are never dragged into the reader.

Corrections are always shown, never silent: "Showing results for
righteousness — rightousness was not in any translation."

## The one thing the corpus cannot do

Every expansion above is derived from the text itself, which means none of
them can reach a word the translations never use. Search *loneliness* and
there is nothing to match — no English Bible here contains it. The verses
exist, they just say *alone*, *solitary*, *forsake*. Before this was fixed
that query returned zero results.

So there is one hand-written table, `build/build_concepts.py`: 138 modern
search terms mapped to the biblical wording that carries them, best fit first.
It is editorial work, which is how Nave's was made too, and it is a plain list
anyone can read, argue with and send a correction for rather than a model
nobody can inspect. Every target is checked against the real vocabulary at
build time, so a word that only sounds biblical fails the build instead of
silently doing nothing.

It fires **only** for words absent from all twelve translations. Bridging
words the corpus already has was measured and made results worse — the
corpus-derived expansions are better calibrated, and the hand-written targets
just diluted them.

## The original languages

Every phrase in the King James text carries the Strong's number of the Hebrew
or Greek behind it — 374,069 tags across all 31,102 verses, with the full
14,089-entry lexicon. Click any word while reading and you get its definition
and every other verse using that same original word, however the English
varies.

That is the thing a concordance exists for. Hebrew *chesed* is rendered
*mercy* 121 times, *kindness* 32, *lovingkindness* 17 and *goodness* 9 — one
idea wearing four English coats, which searching the English can never reveal.
Greek *agape* is *love* 39 times and *charity* 11.

The tagging came out of OSIS markup that also encodes the words the 1611
translators supplied (still shown in italics, as they printed them) and their
own marginal readings — 5,844 of those are kept as translators' notes. The
build asserts that the tagged chunks reassemble into the printed King James
text character for character, and fails if they ever stop matching.

## The hard part was the English, not the search

The translations span 1530 to 2022. Before anything can be indexed they have to
be made to agree, and each of these was measured against the corpus rather than
guessed at:

| Problem | Example | Approach |
| --- | --- | --- |
| Early Modern orthography | `seruant` → `servant` | u/v and i/j rules, applied only when the corpus confirms the modern form is the common one |
| Archaic verb endings | `loveth` → `love` | candidate bases resolved against stems the corpus actually uses |
| British spelling | `honour` → `honor` | one suffix rule; the others were measured and discarded |
| Irregular verbs | `spake` → `speak` | explicit table — no suffix rule can do this |
| Derivational pairs | `anxiety` → `anxious` | shared-root linking, so the noun reaches the adjective |
| `-ous` adjectives | `righteous` ↛ `righteou` | Porter bug fix; it also mangled gracious, glorious, jealous |

Several plausible-looking rules were cut after measurement. `-ce`→`-se` and
`-ise`→`-ize` turned `called` into `caled`, `inheritance` into `inheritanse`
and `noise` into `noize` — mangling far more real words than they merged.

## A thesaurus with no dictionary

Twelve translations of one verse form a parallel corpus. Where the KJV says
"careful" and the Berean says "anxious" in the same place, two committees of
scholars have declared those words equivalent.

The trick is complementary distribution. Inside a single verse, "burnt" and
"offering" appear together in every translation — a collocation. But "careful"
appears in exactly the translations where "anxious" does not: the two words are
filling the same slot, so they are translation equivalents. Counting only the
disjoint cases, and penalising pairs ever seen side by side, yields a
domain-exact thesaurus from the text itself.

It also learned Early Modern spelling unsupervised: `euill`/`evil`,
`reioyce`/`rejoice`, `seruant`/`servant`. Nobody wrote those rules.

## What else it does

- **Compare** any chapter across as many translations as you like, side by side
- **Quoted phrases** — `"fear not"` requires the words together and in order
- **Save verses** to a list held in your browser, with nothing sent anywhere
- **Copy** a verse with its reference and translation already attached
- **Contents** for all 66 books, and a chapter grid inside every book
- **References** (`John 3:16`, `1 cor 13:4-7`, `Ps 23`) and **Strong's numbers**
  (`H2617`, `G26`) typed into the search box go straight where they should
- `/` focuses search; the arrow keys page through chapters while reading

## Translations

All public domain, all shipped with the app.

KJV · Berean Standard · American Standard · New Heart English · A Conservative
Version · Young's Literal · Darby · Rotherham's Emphasised · Bible in Basic
English · Webster's · Geneva 1599 · Tyndale (partial — Pentateuch, Jonah and NT)

There is no ESV, NIV or NASB, and that is deliberate. The
[ESV API](https://api.esv.org/) permits caching at most 500 verses, which
forbids building a search index over the text; the NIV is not licensed for
redistribution outside a commercial agreement with Biblica. Datasets containing
them circulate and plenty of apps quietly use one. Concord does not, because
the point is text you can vouch for. See [LICENSES.md](LICENSES.md).

The Douay-Rheims and 1917 JPS Tanakh are public domain and were prepared, then
held back: neither uses KJV versification. The Douay-Rheims follows Vulgate
psalm numbering, so its Psalm 23 is the KJV's Psalm 24 — aligning it by chapter
number would silently show the wrong psalm.

## Build it yourself

```bash
./build/fetch_sources.sh      # ~150MB from upstream datasets
python3 build/build_all.py    # ~25s, needs numpy + scipy
python3 build/verify.py       # 51 integrity checks
cd docs && python3 -m http.server 8787
```

Both harnesses run the real browser engine headlessly, so ranking changes get
measured rather than eyeballed:

```bash
node build/test_search.mjs "anxiety" "fear not"   # inspect results
node build/eval.mjs                               # score the query suite
```

`eval.mjs` scores twelve queries against the verses a reasonable person
expects back. It currently reports **recall@10 of 71% and MRR 0.733**, with
eight of the twelve returning their best expected verse at rank 1. That suite
picked the cross-reference weight: every configuration at 0.85 or above beat
every configuration at 0.62, which is the measurement behind the claim that
the curated graph carries more of the answer than the wording does.

The known weak spot is open doctrinal questions. *What happens after death*
still returns narrative deaths rather than Hebrews 9:27, because nothing
lexical separates a story from a doctrine and the topical headings that do
know the difference are not decisive enough on their own. Concrete phrasings,
topics and references all do well; wide theological questions are where a
curated system shows its limits, and it is honest to say so rather than tune
the suite until it looks solved.

## What ships

| | |
| --- | --- |
| Twelve translations | 50 MB, sharded per book |
| Cross-reference graph | 9 MB, both directions |
| Strong's tagging, lexicon and occurrences | 17 MB |
| Lexical index | 4.4 MB across 301 shards |
| Concept graph | 4.9 MB binary, one random-walk table |
| Topics, thesaurus, morphology | 3 MB |

Opening the page costs about 4 KB. The first search pulls roughly 480 KB
gzipped. The concept graph streams in the background and is cached by a service
worker, after which the whole thing works offline.

## What it will not do

Concord will not paraphrase, summarise or interpret, and contains no generated
text. Ask a language model for a verse and it will produce something fluent and
frequently wrong in a way you cannot detect from the output — perfect on John
3:16, subtly altered on anything obscure. A reference tool has to be right about
the words, so every one of them here was copied from a published translation.

## Licence

Code is MIT. The scripture texts are public domain. Cross-references are
CC BY openbible.info. Full attribution in [LICENSES.md](LICENSES.md).
