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
python3 build/verify.py       # 42 integrity checks
cd docs && python3 -m http.server 8787
```

`build/test_search.mjs` runs the real browser search engine headlessly, which
is how ranking changes get checked:

```bash
node build/test_search.mjs "anxiety" "fear not"
```

## What ships

| | |
| --- | --- |
| Twelve translations | 50 MB, sharded per book |
| Cross-reference graph | 9 MB, both directions |
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
