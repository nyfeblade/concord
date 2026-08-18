// Typo tolerance.
//
// The index is exact by construction, so a misspelled word matches nothing at
// all. This turns a near-miss back into the word that was meant.
//
// Two steps. The skeleton key narrows 35,000 words down to a handful, then
// edit distance decides which of them was intended. Neither step is a model;
// the vocabulary of the twelve translations is the dictionary.

import * as data from './data.js';

const DROP = new Set(['a', 'e', 'i', 'o', 'u', 'y', 'h', 'w']);

// Must stay identical to skeleton() in build/build_typos.py, or the keys the
// browser computes will not be the keys the index was built with.
export function skeleton(word) {
  const lower = String(word || '').toLowerCase();
  let squeezed = '';
  for (const ch of lower) {
    if (squeezed[squeezed.length - 1] !== ch) squeezed += ch;
  }
  if (!squeezed) return '';
  let out = squeezed[0];
  for (let i = 1; i < squeezed.length; i++) {
    if (!DROP.has(squeezed[i])) out += squeezed[i];
  }
  return out;
}

// Damerau-Levenshtein, bailing out once the distance exceeds what we would
// accept. Transposition matters: "teh" and "recieve" are the commonest shape
// of typo there is.
export function distance(a, b, limit = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const prev = [];
  let prev2 = [];
  let row = [];
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      row[j] = v;
      if (v < best) best = v;
    }
    if (best > limit) return limit + 1;
    prev2 = prev.slice();
    for (let j = 0; j <= b.length; j++) prev[j] = row[j];
  }
  return prev[b.length];
}

// How far off a word of this length is allowed to be. Short words get no
// slack, because at three letters almost everything is within one edit.
export function tolerance(word) {
  if (word.length <= 4) return 1;
  if (word.length <= 7) return 2;
  return 3;
}

const shardOf = (key) => ((key.slice(0, 2) + '_').slice(0, 2)).replace(/[^a-z]/g, '_');

/**
 * Best correction for a word the vocabulary does not contain, or null.
 * Candidates arrive frequency-ordered, so an equal-distance tie keeps the
 * commoner spelling.
 */
export async function correct(word) {
  const key = skeleton(word);
  if (key.length < 2 || word.length < 3) return null;
  const shard = await data.fuzzyShard(shardOf(key));
  const candidates = (shard && shard[key]) || [];
  if (!candidates.length) return null;

  const limit = tolerance(word);
  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i];
    if (cand === word) return null;             // not a typo after all
    const d = distance(word, cand, limit);
    if (d > limit) continue;
    // Distance dominates; position in the frequency-ordered list breaks ties.
    const score = d * 1000 + i;
    if (score < bestScore) { bestScore = score; best = cand; }
  }
  return best;
}
