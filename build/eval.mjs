// Ranking evaluation.
//
//   node build/eval.mjs
//
// Twelve queries with the verses a reasonable person expects back, scored by
// recall@10 and mean reciprocal rank. This exists so ranking changes can be
// measured instead of eyeballed; the graph weight in docs/js/search.js was
// chosen with it. The suite is small, so treat a difference under a couple of
// points as noise.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
globalThis.window = {}; globalThis.requestIdleCallback = (f) => setTimeout(f, 0);
globalThis.fetch = async (url) => {
  const f = url.startsWith('file://') ? fileURLToPath(url) : path.join(SITE, url);
  try { const b = await readFile(f);
    return { ok:true, status:200, json: async()=>JSON.parse(b.toString()),
             arrayBuffer: async()=>b.buffer.slice(b.byteOffset, b.byteOffset+b.byteLength) }; }
  catch { return { ok:false, status:404, json: async()=>null, arrayBuffer: async()=>null }; }
};
const data = await import(path.join(SITE, 'js/data.js'));
const refs = await import(path.join(SITE, 'js/refs.js'));
const search = await import(path.join(SITE, 'js/search.js'));
refs.init(await data.meta());

// query -> verses a reasonable person expects in the top 10
const SUITE = [
  ['anxiety',                      ['Philippians 4:6','1 Peter 5:7','Matthew 6:25']],
  ['fear not',                     ['Isaiah 41:10','Deuteronomy 31:6','Matthew 10:28']],
  ['forgiving someone who wronged you', ['Colossians 3:13','Ephesians 4:32','Matthew 6:14','Matthew 18:35']],
  ['the tongue is a fire',         ['James 3:6','James 3:5']],
  ['hospitality to strangers',     ['Hebrews 13:2','Romans 12:13','1 Peter 4:9']],
  ['lovingkindness',               ['Psalms 63:3','Psalms 36:7','Psalms 103:4','Psalms 69:16']],
  ['what happens after death',     ['Hebrews 9:27','2 Corinthians 5:8','Revelation 20:12','Luke 16:22','John 5:28']],
  ['money and greed',              ['1 Timothy 6:10','Luke 12:15','Hebrews 13:5','Matthew 6:24']],
  ['love your enemies',            ['Matthew 5:44','Luke 6:27','Romans 12:20']],
  ['resurrection of the dead',     ['1 Corinthians 15:20','John 11:25','1 Thessalonians 4:16']],
  ['be strong and courageous',     ['Joshua 1:9','Deuteronomy 31:6','1 Corinthians 16:13']],
  ['a gentle answer turns away wrath', ['Proverbs 15:1']],
];

let hit = 0, total = 0, mrrSum = 0;
for (const [q, expected] of SUITE) {
  const res = await search.search(q, { limit: 10 });
  const got = res.results.map((r) => refs.format(r.verse));
  const found = expected.filter((e) => got.includes(e));
  const firstRank = Math.min(...expected.map((e) => { const i = got.indexOf(e); return i < 0 ? 99 : i + 1; }));
  mrrSum += firstRank <= 10 ? 1 / firstRank : 0;
  hit += found.length; total += expected.length;
  const mark = found.length ? (found.length === expected.length ? 'ok  ' : 'part') : 'MISS';
  console.log(`  ${mark} ${q.padEnd(36)} ${found.length}/${expected.length}  best@${firstRank<=10?firstRank:'-'}`);
  if (!found.length) console.log(`        got: ${got.slice(0,4).join(' | ')}`);
}
console.log(`\n  recall@10 ${hit}/${total} (${(100*hit/total).toFixed(0)}%)   MRR ${(mrrSum/SUITE.length).toFixed(3)}`);
