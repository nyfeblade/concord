// Fetch and cache layer. Everything is a static file, so "the database" is
// just the CDN plus an in-memory map. Nothing here talks to a server.

// this file lives in site/js/, the data lives in site/data/
const BASE = new URL('../data/', import.meta.url).href;

const memo = new Map();
const inflight = new Map();

function get(path, parse) {
  if (memo.has(path)) return Promise.resolve(memo.get(path));
  if (inflight.has(path)) return inflight.get(path);
  const p = fetch(BASE + path)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${path}`);
      return parse(r);
    })
    .then((v) => {
      memo.set(path, v);
      inflight.delete(path);
      return v;
    })
    .catch((e) => {
      inflight.delete(path);
      // A missing shard means no term in that bucket, not a broken app.
      memo.set(path, null);
      if (!/^404/.test(e.message)) console.warn('concord:', e.message);
      return null;
    });
  inflight.set(path, p);
  return p;
}

export const json = (path) => get(path, (r) => r.json());
export const buffer = (path) => get(path, (r) => r.arrayBuffer());

export function shardKey(term) {
  const head = (term.slice(0, 2) + '_').slice(0, 2);
  return head.replace(/[^a-z_]/g, '_');
}

// ---- typed accessors -------------------------------------------------------

export const meta = () => json('meta.json');
export const searchMeta = () => json('search-meta.json');
export const docLengths = () => json('doclen.json');
export const thesaurus = () => json('thesaurus.json');
export const morphology = () => json('morphology.json');
export const topics = () => json('topics.json');
export const topicNames = () => json('topic-names.json');
export const topicSubs = () => json('topic-subs.json');
export const verseTopics = () => json('verse-topics.json');
export const crossRefs = (bookId) => json(`xref/${bookId}.json`);
export const bookText = (translation, bookId) =>
  json(`text/${translation}/${bookId}.json`);

export async function vocabLookup(words) {
  const keys = [...new Set(words.map(shardKey))];
  const shards = await Promise.all(keys.map((k) => json(`vocab/${k}.json`)));
  const table = new Map();
  keys.forEach((k, i) => {
    const s = shards[i];
    if (s) for (const w of Object.keys(s)) table.set(w, s[w]);
  });
  return words.map((w) => (table.has(w) ? table.get(w) : null));
}

export async function surfacesFor(stems) {
  const keys = [...new Set(stems.map(shardKey))];
  const shards = await Promise.all(keys.map((k) => json(`surfaces/${k}.json`)));
  const byKey = new Map(keys.map((k, i) => [k, shards[i]]));
  const out = new Map();
  for (const stem of stems) {
    const shard = byKey.get(shardKey(stem));
    if (shard && shard[stem]) out.set(stem, shard[stem]);
  }
  return out;
}

export async function postingsFor(stems) {
  const keys = [...new Set(stems.map(shardKey))];
  const shards = await Promise.all(keys.map((k) => json(`index/${k}.json`)));
  const byKey = new Map(keys.map((k, i) => [k, shards[i]]));
  const out = new Map();
  for (const stem of stems) {
    const shard = byKey.get(shardKey(stem));
    const entry = shard && shard[stem];
    if (!entry) continue;
    const [deltas, tfs] = entry;
    const verses = new Int32Array(deltas.length);
    let running = 0;
    for (let i = 0; i < deltas.length; i++) {
      running += deltas[i];
      verses[i] = running;
    }
    out.set(stem, { verses, tfs });
  }
  return out;
}

// ---- concept graph ---------------------------------------------------------
// One binary blob holding, for every verse, its strongest neighbours under a
// random walk over the cross-reference graph. Loaded once, then every concept
// lookup is an array slice.

let graphPromise = null;

export function loadConceptGraph() {
  if (!graphPromise) {
    graphPromise = buffer('concept-graph.bin').then((buf) => {
      if (!buf) return null;
      const view = new DataView(buf);
      const magic = String.fromCharCode(
        view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
      if (magic !== 'CNG1') {
        console.warn('concord: unexpected concept graph format');
        return null;
      }
      const n = view.getUint32(8, true);
      let p = 12;
      const offsets = new Uint32Array(buf, p, n + 1); p += 4 * (n + 1);
      const total = offsets[n];
      const targets = new Uint32Array(buf, p, total); p += 4 * total;
      const weights = new Uint8Array(buf, p, total);
      return { n, offsets, targets, weights };
    });
  }
  return graphPromise;
}

// Start fetching in the background so it is usually ready before the first
// search finishes its lexical pass.
export function warmConceptGraph() {
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => loadConceptGraph(), { timeout: 4000 });
  } else {
    setTimeout(() => loadConceptGraph(), 1200);
  }
}
