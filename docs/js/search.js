// The retrieval engine.
//
// Three independent signals are computed over the 31,102-verse spine and
// fused. None of them is a language model.
//
//   lexical  BM25 over the union of all twelve translations, so a verse is
//            found through whichever translation happens to word it that way.
//   graph    a precomputed random walk over 877k scholarly cross-references.
//            This is what finds a verse that shares no words with the query.
//   topical  Nave's and Torrey's subject headings.
//
// Every result carries its provenance, so the interface can say why a verse
// is on the list rather than asking the reader to trust it.

import * as data from './data.js';

const K1 = 1.2;
const B = 0.75;

const SEEDS_FOR_DIFFUSION = 140;

// Exposed so build/test_search.mjs and the tuning sweep can vary them without
// editing the module. Defaults are what shipped, chosen against the query set
// in build/eval.mjs rather than by feel.
export const tuning = {
  lexical: 1.0,
  // 0.85 rather than the 0.62 this started at. Swept against build/eval.mjs:
  // every configuration at 0.85+ beat every configuration at 0.62, moving
  // recall@10 from 63% to 71%. The curated cross-references carry more of the
  // answer than the wording does, which is the whole premise.
  graph: 0.85,
  topic: 0.5,
  synonymDiscount: 0.28,
  synonymsPerTerm: 3,
  synonymFloor: 0.22,
  morphDiscount: 0.42,
  // The curated bridge is the only route for a word no translation contains,
  // so it carries real weight rather than being a faint hint.
  conceptDiscount: 0.6,
  expansionDfShare: 0.04,
  coordFloor: 0.28,
};

// Synonyms exist to add recall, never to redirect the query. Held low and
// few, because the thesaurus is built from translation equivalence and some
// of those equivalences are wide: the KJV's "terrible" is the Berean's
// "awesome", which is correct and still not what someone typing "fear" wants
// at the top of their results.

let ready = null;

async function warm() {
  if (!ready) {
    ready = Promise.all([
      data.searchMeta(), data.docLengths(), data.thesaurus(),
      data.topicNames(), data.topics(), data.morphology(), data.concepts(),
    ]).then(([sm, dl, th, tn, tp, mo, co]) => ({
      docs: sm.docs, avgdl: sm.avgdl,
      doclen: dl, thesaurus: th || {}, topicNames: tn || {}, topics: tp || [],
      morphology: mo || {}, concepts: co || {},
    }));
  }
  return ready;
}

export function tokenize(query) {
  const phrases = [];
  const stripped = query.replace(/"([^"]+)"/g, (_, p) => {
    phrases.push(p.toLowerCase().trim());
    return ' ' + p + ' ';
  });
  const words = (stripped.toLowerCase().match(/[a-z]+/g) || []);
  return { words, phrases };
}

// ---- signal 1: lexical -----------------------------------------------------

async function lexical(words, ctx) {
  const stems = await data.vocabLookup(words);
  const terms = new Map();       // stem -> { weight, surfaces:Set }

  const unmatched = [];
  words.forEach((w, i) => {
    const stem = stems[i];
    if (stem === null) unmatched.push(w);   // in no translation at all
    if (!stem) return;                      // "" is a stopword
    const entry = terms.get(stem) || { weight: 0, surfaces: new Set(), origin: 'query' };
    entry.weight = Math.max(entry.weight, 1);
    entry.surfaces.add(w);
    terms.set(stem, entry);
  });

  // The curated concept bridge, and only for words no translation contains.
  //
  // Bridging words the corpus already has was measured and made things worse:
  // "forgiving someone who wronged you" lost a verse from its top ten,
  // because the corpus-derived expansions were already well calibrated for
  // that word and the hand-written targets just diluted them. The bridge
  // earns its place exactly where nothing else can reach - "loneliness"
  // appears in none of the twelve, so without it the query matches nothing
  // at all.
  const bridged = new Set();
  for (const key of unmatched) {
    for (const [target, weight] of (ctx.concepts[key] || [])) {
      if (terms.has(target)) continue;
      terms.set(target, {
        weight: tuning.conceptDiscount * weight, surfaces: new Set(),
        origin: 'concept', of: key,
      });
      bridged.add(target);
    }
  }

  // Derivational siblings first: "anxiety" has to be able to reach the verses
  // that say "anxious", since no translation of Philippians 4:6 uses the noun.
  for (const stem of [...terms.keys()]) {
    for (const sib of (ctx.morphology[stem] || [])) {
      if (terms.has(sib)) continue;
      terms.set(sib, {
        weight: tuning.morphDiscount, surfaces: new Set(),
        origin: 'morph', of: stem,
      });
    }
  }

  // Then translation-attested synonyms. These are discounted so a synonym
  // match never outranks the word the reader actually typed.
  for (const stem of [...terms.keys()]) {
    if (terms.get(stem).origin !== 'query') continue;
    let taken = 0;
    for (const [syn, score] of (ctx.thesaurus[stem] || [])) {
      if (taken >= tuning.synonymsPerTerm) break;
      if (terms.has(syn) || score < tuning.synonymFloor) continue;
      terms.set(syn, {
        weight: tuning.synonymDiscount * score,
        surfaces: new Set(), origin: 'synonym', of: stem,
      });
      taken++;
    }
  }

  const postings = await data.postingsFor([...terms.keys()]);

  // Drop expansions that turn out to be near-ubiquitous. "happens" reaches
  // "pass" through the thesaurus, which is a fair translation equivalence and
  // a disaster in practice: "came to pass" appears in over a thousand verses
  // and drowns the query. A word matching this much of the Bible is not
  // narrowing anything down.
  const EXPANSION_DF_CAP = Math.round(ctx.docs * tuning.expansionDfShare);
  for (const [stem, entry] of [...terms]) {
    if (entry.origin === 'query' || entry.origin === 'concept') continue;
    const post = postings.get(stem);
    if (post && post.verses.length > EXPANSION_DF_CAP) {
      terms.delete(stem);
      postings.delete(stem);
    }
  }

  const scores = new Float32Array(ctx.docs);
  const hits = new Map();        // verse -> Set of matched query stems

  const queryStems = [...terms.entries()]
    .filter(([s, e]) => e.origin === 'query' && postings.has(s))
    .map(([s]) => s);

  for (const [stem, entry] of terms) {
    const post = postings.get(stem);
    if (!post) continue;
    const df = post.verses.length;
    const idf = Math.log(1 + (ctx.docs - df + 0.5) / (df + 0.5));
    for (let i = 0; i < df; i++) {
      const v = post.verses[i];
      const tf = post.tfs[i];
      const norm = 1 - B + (B * ctx.doclen[v]) / ctx.avgdl;
      const gain = entry.weight * idf * (tf * (K1 + 1)) / (tf + K1 * norm);
      scores[v] += gain;
      if (entry.origin === 'query') {
        let set = hits.get(v);
        if (!set) hits.set(v, (set = new Set()));
        set.add(stem);
      }
    }
  }

  // Coordination. A verse carrying every word of the query is a far better
  // answer than one carrying a single rare word from it, and plain BM25 will
  // happily rank the latter first when that word has a high idf. This is what
  // keeps "fear not" on verses containing both words.
  //
  // Damping verses reached only through an expansion was tried here and
  // measured no better than leaving them alone, so it is not done.
  if (queryStems.length > 1) {
    for (let v = 0; v < scores.length; v++) {
      if (scores[v] === 0) continue;
      const matched = hits.get(v);
      const ratio = (matched ? matched.size : 0) / queryStems.length;
      scores[v] *= tuning.coordFloor + (1 - tuning.coordFloor) * ratio * ratio;
    }
  }
  return { scores, hits, terms, queryStems };
}

// ---- signal 2: cross-reference graph ---------------------------------------

async function diffuse(lexScores, ctx) {
  const graph = await data.loadConceptGraph();
  const scores = new Float32Array(ctx.docs);
  const sources = new Map();     // verse -> [seed indices]
  if (!graph) return { scores, sources, available: false };

  // Rank the lexical hits and diffuse from the strongest handful. Spreading
  // from everything would just blur the whole Bible together.
  const seeds = [];
  for (let v = 0; v < lexScores.length; v++) {
    if (lexScores[v] > 0) seeds.push(v);
  }
  seeds.sort((a, b) => lexScores[b] - lexScores[a]);
  const top = seeds.slice(0, SEEDS_FOR_DIFFUSION);
  if (!top.length) return { scores, sources, available: true };

  const best = lexScores[top[0]] || 1;
  for (const seed of top) {
    const strength = lexScores[seed] / best;
    const from = graph.offsets[seed];
    const to = graph.offsets[seed + 1];
    for (let i = from; i < to; i++) {
      const target = graph.targets[i];
      const w = graph.weights[i] / 255;
      scores[target] += strength * w;
      let list = sources.get(target);
      if (!list) sources.set(target, (list = []));
      if (list.length < 6) list.push(seed);
    }
  }
  return { scores, sources, available: true };
}

// ---- signal 3: topical -----------------------------------------------------

function topical(queryStems, ctx) {
  const scores = new Float32Array(ctx.docs);
  const matched = new Map();     // topic index -> stems it matched
  if (!queryStems.length) return { scores, topics: [], byVerse: new Map() };

  for (const stem of queryStems) {
    for (const tid of (ctx.topicNames[stem] || [])) {
      let set = matched.get(tid);
      if (!set) matched.set(tid, (set = new Set()));
      set.add(stem);
    }
  }
  const ranked = [...matched.entries()]
    .map(([tid, stems]) => ({
      tid,
      coverage: stems.size / queryStems.length,
      topic: ctx.topics[tid],
    }))
    .filter((t) => t.topic)
    .sort((a, b) => b.coverage - a.coverage || a.topic.v.length - b.topic.v.length)
    .slice(0, 12);

  const byVerse = new Map();
  for (const entry of ranked) {
    // A 700-verse heading like "Wicked" is a weaker statement about any one
    // verse than a 12-verse heading like "Adoption".
    const spread = 1 / Math.sqrt(entry.topic.v.length);
    // No global scale factor here: topic scores are normalised by their own
    // peak during fusion, so a uniform multiplier would cancel out.
    const weight = entry.coverage * spread;
    for (const v of entry.topic.v) {
      scores[v] += weight;
      let list = byVerse.get(v);
      if (!list) byVerse.set(v, (list = []));
      if (list.length < 3) list.push(entry.tid);
    }
  }
  return { scores, topics: ranked, byVerse };
}

// ---- fusion ----------------------------------------------------------------

function peak(arr) {
  let m = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i];
  return m || 1;
}

// How many ranked verses are handed back for the interface to page through.
// Every match is scored either way; this only bounds what is retained, and
// nobody is reading past two thousand verses of results.
const RETAIN = 2000;

export async function search(query, { limit = RETAIN, book = null } = {}) {
  const ctx = await warm();
  const { words, phrases } = tokenize(query);
  if (!words.length) return { results: [], topics: [], terms: [], phrases };

  const lex = await lexical(words, ctx);
  const top = topical(lex.queryStems, ctx);
  const graph = await diffuse(lex.scores, ctx);

  const nL = peak(lex.scores);
  const nG = peak(graph.scores);
  const nT = peak(top.scores);

  const out = [];
  for (let v = 0; v < ctx.docs; v++) {
    const l = lex.scores[v] / nL;
    const g = graph.scores[v] / nG;
    const t = top.scores[v] / nT;
    if (l === 0 && g === 0 && t === 0) continue;

    // A verse with no words in common with the query has to be vouched for by
    // more than one weak signal, otherwise the tail of the graph floods the
    // results with loosely associated verses.
    if (l === 0) {
      const corroborated = (g > 0.12 && t > 0) || g > 0.3 || t > 0.45;
      if (!corroborated) continue;
    }
    const score = tuning.lexical * l + tuning.graph * g + tuning.topic * t;
    out.push({
      verse: v, score,
      lexical: l, graph: g, topic: t,
      stems: lex.hits.get(v),
      via: graph.sources.get(v),
      topics: top.byVerse.get(v),
    });
  }

  out.sort((a, b) => b.score - a.score);
  const filtered = book ? out.filter((r) => inBook(r.verse, book)) : out;

  return {
    results: filtered.slice(0, limit),
    total: filtered.length,
    topics: top.topics,
    terms: [...lex.terms.entries()].map(([stem, e]) => ({
      stem, origin: e.origin, of: e.of,
      surfaces: [...e.surfaces],
    })),
    graphAvailable: graph.available,
    phrases,
  };
}

let bookRanges = null;
export function setBookRanges(ranges) { bookRanges = ranges; }
function inBook(verse, bookId) {
  const r = bookRanges && bookRanges.get(bookId);
  return r ? verse >= r[0] && verse <= r[1] : true;
}

export { warm };
