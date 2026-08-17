// Concord — application shell, routing and rendering.

import * as data from './data.js';
import * as refs from './refs.js';
import * as engine from './search.js';

const view = document.getElementById('view');
const input = document.getElementById('q');
const clearBtn = document.getElementById('clear');
const selectEl = document.getElementById('translation');
const toastEl = document.getElementById('toast');

const state = {
  meta: null,
  translation: localStorage.getItem('concord.translation') || 'KJV',
  lastQuery: '',
  lastResults: null,
};

const SUGGESTIONS = [
  'anxiety', 'forgiving someone who wronged you', 'the tongue',
  'fear not', 'lovingkindness', 'money and greed', 'Psalm 23',
  'what happens after death', 'hospitality to strangers',
];

// ---------- helpers ----------

const el = (tag, attrs = {}, ...kids) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
};

const escapeHTML = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let toastTimer;
function toast(message) {
  toastEl.textContent = message;
  toastEl.setAttribute('data-show', '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.removeAttribute('data-show'), 2600);
}

function plural(n, one, many) {
  return `${n.toLocaleString()} ${n === 1 ? one : many}`;
}

// Build the highlight pattern from the exact surface forms each matched stem
// was built from. Prefixes would miss "forgave" for the stem "forgiv" and
// would also catch unrelated words that merely start the same way.
async function highlightPattern(stems) {
  const table = await data.surfacesFor(stems);
  const forms = new Set();
  for (const list of table.values()) for (const w of list) forms.add(w);
  if (!forms.size) return null;
  const alts = [...forms]
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`\\b(${alts.join('|')})\\b`, 'gi');
}

function highlight(text, pattern) {
  const safe = escapeHTML(text);
  if (!pattern) return { html: safe, matched: false };
  let matched = false;
  const html = safe.replace(pattern, (m) => { matched = true; return `<mark>${m}</mark>`; });
  return { html, matched };
}

// ---------- text access ----------

async function verseText(index, translation = state.translation) {
  const at = refs.locate(index);
  if (!at) return '';
  const book = await data.bookText(translation, at.book.id);
  if (!book) return '';
  const chapter = book.c[at.chapter - 1];
  return (chapter && chapter[at.verse - 1]) || '';
}

async function verseTexts(indices, translation = state.translation) {
  const byBook = new Map();
  for (const i of indices) {
    const at = refs.locate(i);
    if (!at) continue;
    if (!byBook.has(at.book.id)) byBook.set(at.book.id, []);
    byBook.get(at.book.id).push(i);
  }
  await Promise.all([...byBook.keys()].map((b) => data.bookText(translation, b)));
  const out = new Map();
  for (const i of indices) out.set(i, await verseText(i, translation));
  return out;
}

// ---------- components ----------

function whyTags(r, { elsewhere = false } = {}) {
  const tags = [];
  if (r.lexical > 0) {
    // Either the reader's translation shows the match or it does not. Saying
    // both is just noise.
    tags.push(elsewhere
      ? el('span', { class: 'tag' }, 'wording in another translation')
      : el('span', { class: 'tag tag-text' }, 'wording'));
  }
  if (r.graph > 0.08 && r.via && r.via.length) {
    const label = r.via.length === 1
      ? `cross-referenced from ${refs.format(r.via[0], { short: true })}`
      : `cross-referenced from ${refs.format(r.via[0], { short: true })} +${r.via.length - 1}`;
    tags.push(el('span', { class: 'tag tag-xref' }, label));
  }
  if (r.topic > 0.05 && r.topics && r.topics.length && state.lastResults) {
    const topics = state.lastResults.topicIndex;
    const name = topics && topics[r.topics[0]];
    if (name) tags.push(el('span', { class: 'tag tag-topic' }, `topic: ${name}`));
  }
  return tags;
}

function verseCard(index, text, { pattern = null, result = null, onOpen } = {}) {
  let body;
  let elsewhere = false;
  if (text) {
    const { html, matched } = highlight(text, pattern);
    body = el('div', { class: 'verse-text', html });
    // The index searches every translation at once, so a verse can match on
    // wording the reader's translation does not use. Saying so is better than
    // showing an unhighlighted verse under a "wording" tag.
    elsewhere = Boolean(result && result.lexical > 0 && pattern && !matched);
  } else {
    body = el('div', { class: 'verse-text verse-missing' },
      `Not translated in ${translationName(state.translation)}`);
  }
  const tags = result ? whyTags(result, { elsewhere }) : [];
  return el('button', {
    class: 'verse-card', type: 'button',
    onclick: () => onOpen ? onOpen(index) : go(readerHash(index)),
  },
    el('div', { class: 'verse-ref' }, el('strong', {}, refs.format(index))),
    body,
    tags.length ? el('div', { class: 'why' }, tags) : null);
}

function translationName(id) {
  const t = state.meta.translations.find((x) => x.id === id);
  return t ? t.name : id;
}

function readerHash(index) {
  const at = refs.locate(index);
  return `#/read/${at.book.id}/${at.chapter}/${at.verse}`;
}

// ---------- views ----------

function renderHome() {
  document.title = 'Concord — search the Bible by concept';
  const chips = SUGGESTIONS.map((s) =>
    el('a', { class: 'chip', href: `#/q/${encodeURIComponent(s)}` }, s));

  view.replaceChildren(el('div', { class: 'wrap' },
    el('section', { class: 'hero' },
      el('h1', {}, 'Search the Bible by what it means'),
      el('p', {},
        'Twelve translations, 877,377 scholarly cross-references and Nave\'s ' +
        'topical index, fused into one search. It finds the verse you meant ' +
        'even when it shares no words with what you typed.'),
      el('div', { class: 'suggestions' }, chips),
      el('p', { class: 'hero-note' },
        'Runs entirely in your browser. No account, no server, no AI — the ' +
        'text is the text.')),

    el('section', { class: 'pillars' },
      el('div', { class: 'pillar' },
        el('h3', {}, el('b', {}, '01'), 'Wording'),
        el('p', {}, 'Ranked across every translation at once, so a verse is ' +
          'found through whichever one words it your way — “lovingkindness” ' +
          'and “loving devotion” reach the same place.')),
      el('div', { class: 'pillar' },
        el('h3', {}, el('b', {}, '02'), 'Cross-references'),
        el('p', {}, 'A random walk over the links scholars drew between ' +
          'verses. This is what surfaces Matthew 6:25 when you search ' +
          '“anxiety”, despite no shared vocabulary.')),
      el('div', { class: 'pillar' },
        el('h3', {}, el('b', {}, '03'), 'Topics'),
        el('p', {}, 'Nave\'s and Torrey\'s subject headings, 3,280 of them, ' +
          'covering 88% of the Bible. Human editors saying plainly what a ' +
          'passage is about.')))));
}

async function renderSearch(query) {
  document.title = `${query} — Concord`;
  input.value = query;
  clearBtn.hidden = !query;

  view.replaceChildren(el('div', { class: 'wrap' },
    el('div', { class: 'results-head' },
      el('h2', {}, 'Searching'),
      el('span', { class: 'results-count' }, el('span', { class: 'loading' })))));

  // A bare reference goes straight to the text rather than through search.
  const ref = refs.parseReference(query);
  if (ref) {
    go(`#/read/${ref.book.id}/${ref.chapter}${ref.kind === 'verse' ? '/' + ref.verse : ''}`);
    return;
  }

  const res = await engine.search(query, { limit: 80 });
  const topicIndex = {};
  for (const t of res.topics) topicIndex[t.tid] = t.topic.n;
  state.lastQuery = query;
  state.lastResults = { ...res, topicIndex };

  if (!res.results.length) {
    view.replaceChildren(el('div', { class: 'wrap' },
      el('div', { class: 'empty' },
        el('h3', {}, 'Nothing found'),
        el('p', {}, 'Try a plainer word, a phrase from the verse, or a ' +
          'reference like “John 3:16”.'))));
    return;
  }

  const indices = res.results.map((r) => r.verse);
  const texts = await verseTexts(indices);

  // Highlight exactly what the index matched. Stopwords never reach res.terms,
  // so "you" and "who" are not marked.
  const pattern = await highlightPattern(res.terms.map((t) => t.stem));

  const list = el('div', { class: 'verse-list' },
    res.results.map((r) =>
      verseCard(r.verse, texts.get(r.verse), {
        pattern, result: r, onOpen: (i) => openVerse(i),
      })));

  const expansions = res.terms.filter((t) => t.origin !== 'query');
  const expansionNote = expansions.length
    ? el('div', { class: 'expansion' },
        el('b', {}, 'also matched'),
        expansions.slice(0, 8).map((t) => el('code', {}, t.stem)))
    : null;

  const panel = el('aside', { class: 'panel' });
  if (res.topics.length) {
    panel.append(el('div', { class: 'card' },
      el('h3', {}, 'Related subjects'),
      el('div', { class: 'topic-list' },
        res.topics.slice(0, 10).map((t) =>
          el('a', { class: 'chip', href: `#/q/${encodeURIComponent(t.topic.n)}` },
            t.topic.n)))));
  }
  panel.append(el('div', { class: 'card' },
    el('h3', {}, 'How these ranked'),
    el('div', { class: 'card-body' },
      el('p', {}, 'Each verse is scored on three independent signals: the ' +
        'words it uses, how strongly scholars cross-reference it to your ' +
        'strongest matches, and which subject headings it falls under.'),
      el('p', {}, 'Tags under each verse show which signals fired. A verse ' +
        'with no “wording” tag was found purely by association.'))));

  view.replaceChildren(el('div', { class: 'wrap' },
    el('div', { class: 'results-head' },
      el('h2', {}, `“${query}”`),
      el('span', { class: 'results-count' },
        plural(res.total, 'verse', 'verses'))),
    expansionNote,
    el('div', { class: 'split' }, list, panel)));
}

async function renderReader(bookId, chapter, verse) {
  const book = refs.bookById(Number(bookId));
  if (!book) { go('#/'); return; }
  chapter = Math.min(Math.max(Number(chapter) || 1, 1), book.chapters.length);
  const title = book.chapters.length === 1 ? book.name : `${book.name} ${chapter}`;
  document.title = `${title} — Concord`;

  const text = await data.bookText(state.translation, book.id);
  const verses = (text && text.c[chapter - 1]) || [];
  const firstIndex = refs.indexOf(book.id, chapter, 1);

  const body = el('div', { class: 'chapter' });
  verses.forEach((t, i) => {
    const index = firstIndex + i;
    const node = el('span', {
      class: 'v', id: `v${i + 1}`, tabindex: '0', role: 'button',
      'aria-current': verse && Number(verse) === i + 1 ? 'true' : null,
      onclick: () => openVerse(index),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openVerse(index); } },
    }, el('sup', { class: 'vn' }, String(i + 1)), t || '—');
    body.append(node, ' ');
  });

  const prev = chapter > 1
    ? `#/read/${book.id}/${chapter - 1}`
    : (book.id > 1 ? `#/read/${book.id - 1}/${refs.bookById(book.id - 1).chapters.length}` : null);
  const next = chapter < book.chapters.length
    ? `#/read/${book.id}/${chapter + 1}`
    : (book.id < 66 ? `#/read/${book.id + 1}/1` : null);

  const panel = el('aside', { class: 'panel', id: 'panel' },
    el('div', { class: 'card' },
      el('h3', {}, 'Chapter'),
      el('div', { class: 'card-body' },
        el('p', {}, `${plural(verses.length, 'verse', 'verses')} · ` +
          `${translationName(state.translation)}`),
        el('p', {}, 'Select any verse for its cross-references, subjects and ' +
          'every translation side by side.'))));

  view.replaceChildren(el('div', { class: 'wrap' },
    el('div', { class: 'reader-head' },
      el('h2', {}, title),
      el('div', { class: 'reader-nav' },
        el('a', { class: 'btn', href: prev || '#', 'aria-disabled': !prev }, '← Previous'),
        el('a', { class: 'btn', href: next || '#', 'aria-disabled': !next }, 'Next →'))),
    el('div', { class: 'split' }, body, panel)));

  if (verse) {
    const target = document.getElementById(`v${verse}`);
    if (target) {
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      openVerse(refs.indexOf(book.id, chapter, Number(verse)), { scroll: false });
    }
  }
}

// ---------- verse detail ----------

async function openVerse(index, { scroll = true } = {}) {
  const panel = document.getElementById('panel') || document.querySelector('.panel');
  if (!panel) { go(readerHash(index)); return; }

  panel.replaceChildren(el('div', { class: 'card' },
    el('h3', {}, refs.format(index)),
    el('div', { class: 'card-body' }, el('span', { class: 'loading' }))));

  const at = refs.locate(index);
  const [xrefBook, vTopics, topicList] = await Promise.all([
    data.crossRefs(at.book.id), data.verseTopics(), data.topics(),
  ]);

  const cards = [];

  // the verse itself
  const own = await verseText(index);
  cards.push(el('div', { class: 'card' },
    el('h3', {}, refs.format(index)),
    el('div', { class: 'card-body' },
      el('div', { class: 'verse-text' }, own || '—'),
      el('p', { style: 'margin-top:.6rem' },
        el('a', { class: 'chip', href: readerHash(index) }, 'Read in context')))));

  // cross-references
  const entries = (xrefBook && xrefBook[String(index)]) || [];
  if (entries.length) {
    const shown = entries.slice(0, 14);
    const targets = shown.map((e) => e[0]);
    const texts = await verseTexts(targets);
    const strongest = shown[0][shown[0].length - 1] || 1;
    cards.push(el('div', { class: 'card' },
      el('h3', {}, `Cross-references (${entries.length})`),
      el('div', { class: 'ref-list' },
        shown.map((e) => {
          const start = e[0];
          const end = e.length === 3 ? e[1] : e[0];
          const votes = e[e.length - 1];
          const bar = el('span', { class: 'ref-strength' });
          bar.style.opacity = String(0.25 + 0.75 * Math.min(1, votes / (strongest || 1)));
          return el('button', {
            class: 'ref-item', type: 'button',
            onclick: () => openVerse(start),
          }, bar,
            el('b', {}, refs.formatRange(start, end)),
            el('span', {}, texts.get(start) || ''));
        }))));
  }

  // topics
  const tids = (vTopics && vTopics[String(index)]) || [];
  const chips = tids.slice(0, 12)
    .map((id) => topicList && topicList[id])
    .filter(Boolean)
    .map((t) => el('a', { class: 'chip', href: `#/q/${encodeURIComponent(t.n)}` }, t.n));
  if (chips.length) {
    cards.push(el('div', { class: 'card' },
      el('h3', {}, 'Subjects'),
      el('div', { class: 'topic-list' }, chips)));
  }

  // every translation
  const others = state.meta.translations;
  const renderings = await Promise.all(others.map(async (t) => {
    const text = await verseText(index, t.id);
    return text ? el('div', { class: 'parallel-row' },
      el('b', {}, t.name), el('span', {}, text)) : null;
  }));
  cards.push(el('div', { class: 'card' },
    el('h3', {}, 'Every translation'),
    el('div', { class: 'parallel' }, renderings.filter(Boolean))));

  panel.replaceChildren(...cards);
  if (scroll && window.matchMedia('(max-width: 900px)').matches) {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ---------- static pages ----------

function renderAbout() {
  document.title = 'How Concord works';
  view.replaceChildren(el('div', { class: 'wrap wrap-narrow' },
    el('article', { class: 'prose', html: `
      <h1>How it works</h1>
      <p>Concord answers a search with three independent signals and fuses
      them. None of them is a language model, and nothing is generated — every
      word of scripture you see was copied from a published translation.</p>

      <h2>1. Wording</h2>
      <p>A BM25 index built over all twelve translations at once, treating each
      verse as one document containing every rendering of it. Search
      <code>lovingkindness</code> and you reach the verse even if you are
      reading a translation that says “loving devotion”.</p>
      <p>Getting there took some care. The translations span 1530 to 2022, so
      the index folds together Early Modern orthography
      (<code>seruant</code> → <code>servant</code>), archaic verb endings
      (<code>loveth</code> → <code>love</code>), British spelling
      (<code>honour</code> → <code>honor</code>), irregular verbs
      (<code>spake</code> → <code>speak</code>) and derivational pairs
      (<code>anxiety</code> → <code>anxious</code>).</p>

      <h2>2. Cross-references</h2>
      <p>877,377 links between verses, compiled from the Treasury of Scripture
      Knowledge and weighted by community voting at openbible.info. Concord
      treats them as a graph and precomputes a random walk with restart from
      every verse, keeping its strongest 32 neighbours.</p>
      <p>At query time the strongest wording matches seed a diffusion across
      that graph. This is what puts Matthew 6:25 near the top for
      <em>anxiety</em>: it shares no words with the query, but the verses that
      do match all point at it.</p>

      <h2>3. Topics</h2>
      <p>3,280 subject headings from Nave's and Torrey's topical indexes,
      covering 88% of the Bible — human editors stating plainly what a passage
      is about. Larger headings are weighted down, since “Wicked” with 724
      verses says less about any one of them than “Adoption” with twelve.</p>

      <h2>Why it can explain itself</h2>
      <p>Because every signal is a lookup rather than a learned weight, each
      result can say why it is there: which words matched, which verse
      cross-referenced it, which subject it falls under. An embedding can only
      offer a similarity score.</p>

      <h2>A thesaurus with no dictionary</h2>
      <p>Twelve translations of one verse are a parallel corpus. Where the KJV
      says “careful” and the Berean says “anxious” in the same place, two
      committees of scholars have declared those words equivalent. Concord
      harvests that by looking for words in complementary distribution — one
      appears in exactly the translations the other does not — which
      distinguishes a synonym from a mere collocation.</p>
      <p>It also learned Early Modern spelling on its own this way:
      <code>euill</code>/<code>evil</code>, <code>reioyce</code>/<code>rejoice</code>.
      Nobody wrote those rules.</p>

      <h2>What it will not do</h2>
      <p>Concord will not paraphrase, summarise or interpret, and it contains
      no generated text. A language model asked for a verse will produce
      something fluent and frequently wrong in ways you cannot detect. A
      reference tool has to be right about the words.</p>
    ` })));
}

function renderSources() {
  document.title = 'Sources & licences — Concord';
  const rows = state.meta.translations.map((t) => `
    <tr><td><b>${escapeHTML(t.id)}</b></td><td>${escapeHTML(t.name)}</td>
    <td>${t.year}</td><td>${escapeHTML(t.blurb)}</td></tr>`).join('');

  view.replaceChildren(el('div', { class: 'wrap wrap-narrow' },
    el('article', { class: 'prose', html: `
      <h1>Sources &amp; licences</h1>
      <p>Every translation here is in the public domain, and its full text
      ships with the app. Nothing is fetched from a third party at runtime and
      nothing requires a key.</p>

      <h2>Translations</h2>
      <div class="table-scroll"><table>
        <thead><tr><th>Code</th><th>Translation</th><th>Year</th><th>Note</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>

      <h2>Why no ESV, NIV or NASB</h2>
      <p>They are copyrighted, and their licences forbid what this app does.
      The ESV API permits caching at most 500 verses — a hard bar to building
      a search index over the text. The NIV is not licensed for redistribution
      at all outside a commercial agreement with Biblica.</p>
      <p>Datasets containing them circulate, and a lot of Bible apps quietly
      use one. Concord does not, because the point of the project is text you
      can vouch for.</p>

      <h2>Not yet included</h2>
      <p>The Douay-Rheims and the 1917 JPS Tanakh are public domain and were
      prepared for this build, then held back: neither uses KJV versification.
      The Douay-Rheims follows Vulgate psalm numbering, so its Psalm 23 is the
      KJV's Psalm 24. Aligning it by chapter number would silently show the
      wrong psalm, so it waits for a per-translation versification map.</p>

      <h2>Reference data</h2>
      <ul>
        <li><b>Cross-references</b> — openbible.info, CC BY, compiled largely
        from R. A. Torrey's Treasury of Scripture Knowledge (public domain).</li>
        <li><b>Topical index</b> — Nave's Topical Bible and Torrey's New
        Topical Textbook, both public domain, via the MetaV dataset (MIT).</li>
        <li><b>Translation texts</b> — the scrollmapper/bible_databases
        collection (MIT).</li>
      </ul>

      <h2>This app</h2>
      <p>Static files only. Open the network tab: it fetches JSON from the same
      origin and nothing else.</p>
    ` })));
}

// ---------- routing ----------

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

async function route() {
  const hash = location.hash || '#/';
  const parts = hash.slice(2).split('/').filter(Boolean);
  window.scrollTo({ top: 0 });

  try {
    if (!parts.length) { input.value = ''; clearBtn.hidden = true; renderHome(); return; }
    if (parts[0] === 'q') { await renderSearch(decodeURIComponent(parts.slice(1).join('/'))); return; }
    if (parts[0] === 'read') { await renderReader(parts[1], parts[2], parts[3]); return; }
    if (parts[0] === 'about') { renderAbout(); return; }
    if (parts[0] === 'sources') { renderSources(); return; }
    renderHome();
  } catch (err) {
    console.error(err);
    view.replaceChildren(el('div', { class: 'wrap' },
      el('div', { class: 'empty' },
        el('h3', {}, 'Something went wrong'),
        el('p', {}, String(err && err.message || err)))));
  }
}

// ---------- boot ----------

function applyTheme() {
  const saved = localStorage.getItem('concord.theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
}

document.getElementById('theme').addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const dark = current
    ? current === 'dark'
    : window.matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('concord.theme', next);
});

document.getElementById('searchbar').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = input.value.trim();
  if (q) go(`#/q/${encodeURIComponent(q)}`);
});

input.addEventListener('input', () => { clearBtn.hidden = !input.value; });
clearBtn.addEventListener('click', () => {
  input.value = ''; clearBtn.hidden = true; input.focus(); go('#/');
});

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== input) {
    e.preventDefault(); input.focus(); input.select();
  }
  if (e.key === 'Escape' && document.activeElement === input) input.blur();
});

selectEl.addEventListener('change', () => {
  state.translation = selectEl.value;
  localStorage.setItem('concord.translation', state.translation);
  toast(`Now reading ${translationName(state.translation)}`);
  route();
});

window.addEventListener('hashchange', route);

(async function boot() {
  applyTheme();
  state.meta = await data.meta();
  if (!state.meta) {
    view.innerHTML = '<div class="wrap"><div class="empty"><h3>Could not load</h3>' +
      '<p>The data files did not load. If you opened this file directly, ' +
      'serve the folder over HTTP instead.</p></div></div>';
    return;
  }
  refs.init(state.meta);

  const ranges = new Map();
  let running = 0;
  for (const b of state.meta.books) {
    const size = b.chapters.reduce((a, c) => a + c, 0);
    ranges.set(b.id, [running, running + size - 1]);
    running += size;
  }
  engine.setBookRanges(ranges);

  if (!state.meta.translations.some((t) => t.id === state.translation)) {
    state.translation = 'KJV';
  }
  selectEl.replaceChildren(...state.meta.translations.map((t) =>
    el('option', { value: t.id, selected: t.id === state.translation },
      `${t.id} · ${t.name}${t.partial ? ' (partial)' : ''}`)));

  await route();
  data.warmConceptGraph();
  engine.warm();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
