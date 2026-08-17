// Verse references: parsing what people type, and formatting what we show.
//
// The canonical spine is 31,102 verses in KJV order. A verse is identified
// everywhere else in the app by its index into that spine.

let BOOKS = null;
let ALIASES = null;
let STARTS = null;   // book id -> canonical index of its first verse

const EXTRA_ALIASES = {
  'psalm': 19, 'psa': 19, 'pss': 19, 'ps': 19,
  'song': 22, 'songs': 22, 'canticles': 22, 'sos': 22, 'sng': 22,
  'ecc': 21, 'qoheleth': 21,
  'gen': 1, 'ge': 1, 'gn': 1,
  'ex': 2, 'exo': 2, 'exod': 2,
  'lev': 3, 'lv': 3, 'num': 4, 'nm': 4, 'nb': 4,
  'deut': 5, 'dt': 5, 'deu': 5,
  'josh': 6, 'jos': 6, 'jsh': 6,
  'judg': 7, 'jdg': 7, 'jg': 7,
  'rth': 8, 'ru': 8,
  'sam': 9, 'kgs': 11, 'kg': 11, 'chr': 13, 'chron': 13,
  'neh': 16, 'ezr': 15, 'est': 17, 'esth': 17,
  'prov': 20, 'prv': 20, 'pro': 20,
  'isa': 23, 'is': 23, 'jer': 24, 'lam': 25,
  'ezek': 26, 'eze': 26, 'ezk': 26, 'dan': 27, 'dn': 27,
  'hos': 28, 'joel': 29, 'joe': 29, 'amos': 30, 'am': 30,
  'obad': 31, 'oba': 31, 'ob': 31, 'jonah': 32, 'jon': 32, 'jnh': 32,
  'mic': 33, 'mc': 33, 'nah': 34, 'na': 34, 'hab': 35, 'hb': 35,
  'zeph': 36, 'zep': 36, 'zph': 36, 'hag': 37, 'hg': 37,
  'zech': 38, 'zec': 38, 'zch': 38, 'mal': 39, 'ml': 39,
  'matt': 40, 'mt': 40, 'mat': 40,
  'mark': 41, 'mk': 41, 'mrk': 41, 'mr': 41,
  'luke': 42, 'lk': 42, 'luk': 42,
  'john': 43, 'jn': 43, 'joh': 43, 'jhn': 43,
  'acts': 44, 'ac': 44, 'act': 44,
  'rom': 45, 'ro': 45, 'rm': 45,
  'cor': 46, 'gal': 48, 'ga': 48, 'eph': 49, 'ep': 49,
  'phil': 50, 'php': 50, 'philip': 50,
  'col': 51, 'thess': 52, 'thes': 52, 'th': 52,
  'tim': 54, 'ti': 54, 'titus': 56, 'tit': 56, 'tt': 56,
  'philem': 57, 'phm': 57, 'phlm': 57,
  'heb': 58, 'jas': 59, 'jm': 59, 'james': 59,
  'pet': 60, 'pe': 60, 'pt': 60,
  'jude': 65, 'jud': 65, 'jd': 65,
  'rev': 66, 'rv': 66, 'apocalypse': 66, 'revelations': 66,
};

function normalise(s) {
  return s.toLowerCase()
    .replace(/^(1st|first)\b/, '1')
    .replace(/^(2nd|second)\b/, '2')
    .replace(/^(3rd|third)\b/, '3')
    .replace(/^i{3}\s/, '3 ')
    .replace(/^i{2}\s/, '2 ')
    .replace(/^i\s/, '1 ')
    .replace(/[^a-z0-9]/g, '');
}

export function init(meta) {
  BOOKS = meta.books;
  ALIASES = new Map();
  STARTS = new Map();
  let running = 0;
  for (const b of BOOKS) {
    STARTS.set(b.id, running);
    running += b.chapters.reduce((a, c) => a + c, 0);
    for (const form of [b.name, b.short, b.osis]) {
      ALIASES.set(normalise(form), b.id);
    }
    // "1 Samuel" should also answer to "1samuel", "1sam", "1sa"
    const m = /^([123])\s*(.+)$/.exec(b.name);
    if (m) {
      const [, num, rest] = m;
      ALIASES.set(normalise(num + rest.slice(0, 3)), b.id);
      ALIASES.set(normalise(num + rest.slice(0, 4)), b.id);
    } else {
      ALIASES.set(normalise(b.name.slice(0, 3)), b.id);
    }
  }
  for (const [alias, id] of Object.entries(EXTRA_ALIASES)) {
    if (!ALIASES.has(alias)) ALIASES.set(alias, id);
    // numbered books: "1cor", "2tim" and so on
    for (const n of [1, 2, 3]) {
      const target = id + n - 1;
      const book = BOOKS.find((b) => b.id === target);
      if (book && new RegExp(`^${n}\\s`).test(book.name)) {
        ALIASES.set(`${n}${alias}`, target);
      }
    }
  }
}

export const books = () => BOOKS;
export const bookById = (id) => BOOKS.find((b) => b.id === id);

export function indexOf(bookId, chapter, verse) {
  const book = bookById(bookId);
  if (!book) return -1;
  const ch = Math.min(Math.max(chapter, 1), book.chapters.length);
  let i = STARTS.get(bookId);
  for (let c = 1; c < ch; c++) i += book.chapters[c - 1];
  const cap = book.chapters[ch - 1];
  return i + Math.min(Math.max(verse, 1), cap) - 1;
}

export function locate(index) {
  for (const b of BOOKS) {
    const start = STARTS.get(b.id);
    const size = b.chapters.reduce((a, c) => a + c, 0);
    if (index < start + size) {
      let rest = index - start;
      for (let c = 0; c < b.chapters.length; c++) {
        if (rest < b.chapters[c]) {
          return { book: b, chapter: c + 1, verse: rest + 1 };
        }
        rest -= b.chapters[c];
      }
    }
  }
  return null;
}

export function format(index, { short = false } = {}) {
  const at = locate(index);
  if (!at) return '?';
  const name = short ? at.book.short : at.book.name;
  return at.book.chapters.length === 1
    ? `${name} ${at.verse}`
    : `${name} ${at.chapter}:${at.verse}`;
}

export function formatRange(a, b) {
  if (a === b) return format(a);
  const x = locate(a);
  const y = locate(b);
  if (!x || !y) return format(a);
  if (x.book.id !== y.book.id) return `${format(a)} - ${format(b)}`;
  if (x.chapter !== y.chapter) return `${format(a)} - ${y.chapter}:${y.verse}`;
  return `${format(a)}-${y.verse}`;
}

// Matches "John 3:16", "1 cor 13:4-7", "Ps 23", "Genesis 1.1", "jn3:16"
const REF = /^\s*((?:[123]\s*)?[a-z][a-z.]*(?:\s+[a-z]+)?)\s*\.?\s*(\d+)?\s*(?:[:.]\s*(\d+))?\s*(?:\s*[-–]\s*(\d+))?\s*$/i;

export function parseReference(input) {
  const m = REF.exec(input);
  if (!m) return null;
  let [, rawBook, chapter, verse, endVerse] = m;
  let id = ALIASES.get(normalise(rawBook));
  if (id === undefined) {
    // Try dropping a trailing word that was actually part of the numbers
    const parts = rawBook.trim().split(/\s+/);
    if (parts.length > 1) id = ALIASES.get(normalise(parts.join('')));
    if (id === undefined) return null;
  }
  const book = bookById(id);
  if (!book) return null;

  // A one-chapter book written as "Jude 4" means verse 4, not chapter 4.
  if (book.chapters.length === 1 && chapter && !verse) {
    verse = chapter;
    chapter = '1';
  }
  const ch = chapter ? parseInt(chapter, 10) : 1;
  if (ch < 1 || ch > book.chapters.length) return null;

  if (!verse) {
    return { kind: 'chapter', book, chapter: ch, index: indexOf(id, ch, 1) };
  }
  const v = parseInt(verse, 10);
  if (v < 1 || v > book.chapters[ch - 1]) return null;
  const start = indexOf(id, ch, v);
  const end = endVerse
    ? indexOf(id, ch, Math.min(parseInt(endVerse, 10), book.chapters[ch - 1]))
    : start;
  return { kind: 'verse', book, chapter: ch, verse: v, index: start, end };
}
