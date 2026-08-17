// Headless harness for the browser search engine.
//
// Runs the real js/search.js against the real data directory by shimming the
// handful of browser globals it touches. This is how ranking gets checked
// without a browser in the loop.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'site');

globalThis.window = { requestIdleCallback: null };
globalThis.requestIdleCallback = (fn) => setTimeout(fn, 0);

globalThis.fetch = async (url) => {
  const file = url.startsWith('file://') ? fileURLToPath(url) : path.join(SITE, url);
  try {
    const buf = await readFile(file);
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(buf.toString('utf8')),
      arrayBuffer: async () =>
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    };
  } catch (e) {
    return { ok: false, status: 404, json: async () => null, arrayBuffer: async () => null };
  }
};

const data = await import('../site/js/data.js');
const refs = await import('../site/js/refs.js');
const search = await import('../site/js/search.js');

const meta = await data.meta();
refs.init(meta);

const textCache = new Map();
async function verseText(index, translation = 'KJV') {
  const at = refs.locate(index);
  const key = `${translation}:${at.book.id}`;
  if (!textCache.has(key)) textCache.set(key, await data.bookText(translation, at.book.id));
  const book = textCache.get(key);
  return (book && book.c[at.chapter - 1] && book.c[at.chapter - 1][at.verse - 1]) || '';
}

function why(r) {
  const bits = [];
  if (r.lexical > 0) bits.push(`text ${r.lexical.toFixed(2)}`);
  if (r.graph > 0) bits.push(`xref ${r.graph.toFixed(2)}`);
  if (r.topic > 0) bits.push(`topic ${r.topic.toFixed(2)}`);
  return bits.join(' | ');
}

const queries = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['anxiety', 'fear not', 'lovingkindness', 'forgiving someone who wronged you',
     'the tongue is a fire', 'money and greed', 'resurrection'];

for (const q of queries) {
  const t0 = performance.now();
  const res = await search.search(q, { limit: 8 });
  const ms = performance.now() - t0;
  console.log(`\n=== "${q}"  (${res.total} hits, ${ms.toFixed(0)}ms)`);
  const syn = res.terms.filter((t) => t.origin === 'synonym').map((t) => t.stem);
  if (syn.length) console.log(`    expanded with: ${syn.slice(0, 8).join(', ')}`);
  if (res.topics.length) {
    console.log(`    topics: ${res.topics.slice(0, 4).map((t) => t.topic.n).join(' / ')}`);
  }
  for (const r of res.results) {
    const text = (await verseText(r.verse)).slice(0, 88);
    const flag = r.lexical === 0 ? ' *' : '  ';
    console.log(`  ${flag}${refs.format(r.verse).padEnd(20)} ${text}`);
    console.log(`      ${why(r)}`);
  }
}
console.log('\n  (* = found with no matching words, purely by concept)');
