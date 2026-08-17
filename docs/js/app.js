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
  interlinear: localStorage.getItem('concord.interlinear') === '1',
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
        'Twelve translations, 877,377 scholarly cross-references, Nave\'s ' +
        'topical index and the Hebrew and Greek behind every word. It finds ' +
        'the verse you meant even when it shares none of your words.'),
      el('div', { class: 'suggestions' }, chips,
        el('a', { class: 'chip chip-alt', href: '#/word/H2617' }, 'Word study: chesed →'),
        el('a', { class: 'chip chip-alt', href: '#/books' }, 'Browse all 66 books →')),
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
          'passage is about.')),
      el('div', { class: 'pillar' },
        el('h3', {}, el('b', {}, '04'), 'Original languages'),
        el('p', {}, 'Every King James word is tagged with the Hebrew or Greek ' +
          'behind it. Click one to see its definition and every other verse ' +
          'using that same word, however the English varies.')))));
}

async function renderSearch(query) {
  document.title = `${query} — Concord`;
  input.value = query;
  clearBtn.hidden = !query;

  view.replaceChildren(el('div', { class: 'wrap' },
    el('div', { class: 'results-head' },
      el('h2', {}, 'Searching'),
      el('span', { class: 'results-count' }, el('span', { class: 'loading' })))));

  // A bare Strong's number is a word study, not a search.
  const strongs = parseStrongs(query);
  if (strongs) { go(`#/word/${strongs}`); return; }

  // A bare reference goes straight to the text rather than through search.
  const ref = refs.parseReference(query);
  if (ref) {
    go(`#/read/${ref.book.id}/${ref.chapter}${ref.kind === 'verse' ? '/' + ref.verse : ''}`);
    return;
  }

  const res = await engine.search(query);
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

  // Highlight exactly what the index matched. Stopwords never reach res.terms,
  // so "you" and "who" are not marked.
  const pattern = await highlightPattern(res.terms.map((t) => t.stem));

  // Results arrive fully ranked but are rendered a page at a time. Verse text
  // lives in per-book files, so drawing 2,000 results at once would pull down
  // most of the Bible to fill a list nobody scrolls to the end of.
  const list = el('div', { class: 'verse-list' });
  const countEl = el('span', { class: 'results-count' });
  let cursor = 0;   // position in the ranked list
  let kept = 0;     // cards actually rendered

  // Quoting a phrase means the words have to appear together, in order. The
  // index stores no positions, so ranking finds the candidates and the verse
  // text decides. Checked against the translation being read and the KJV,
  // since the index matched across all twelve and the phrase may live in
  // either.
  const phrases = res.phrases.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const contains = (haystack) => {
    if (!haystack) return false;
    const flat = haystack.toLowerCase().replace(/[\u2018\u2019']/g, "'").replace(/\s+/g, ' ');
    return phrases.every((p) => flat.includes(p));
  };

  const renderPage = async () => {
    const cards = [];
    while (cards.length < PAGE_SIZE && cursor < res.results.length) {
      const slice = res.results.slice(cursor, cursor + PAGE_SIZE);
      cursor += slice.length;
      const indices = slice.map((r) => r.verse);
      const texts = await verseTexts(indices);
      const kjv = phrases.length && state.translation !== 'KJV'
        ? await verseTexts(indices, 'KJV') : null;
      for (const r of slice) {
        const text = texts.get(r.verse);
        if (phrases.length &&
            !contains(text) && !(kjv && contains(kjv.get(r.verse)))) continue;
        cards.push(verseCard(r.verse, text, {
          pattern, result: r, onOpen: (i) => openVerse(i),
        }));
      }
    }
    if (!cards.length) return false;
    list.append(...cards);
    kept += cards.length;
    const done = cursor >= res.results.length;
    countEl.replaceChildren(phrases.length
      ? `${kept.toLocaleString()} exact ${kept === 1 ? 'match' : 'matches'}${done ? '' : ' so far'}`
      : (done ? plural(res.total, 'verse', 'verses')
              : `${kept.toLocaleString()} of ${plural(res.total, 'verse', 'verses')}`));
    return cursor < res.results.length;
  };

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

  const more = el('button', {
    class: 'btn load-more', type: 'button',
    onclick: () => loadMore(),
  }, 'Show more verses');
  const sentinel = el('div', { class: 'sentinel' }, more);

  let loading = false;
  async function loadMore() {
    if (loading) return;
    loading = true;
    more.disabled = true;
    more.textContent = 'Loading…';
    const hasMore = await renderPage();
    if (hasMore) {
      more.disabled = false;
      more.textContent = 'Show more verses';
    } else {
      sentinel.replaceChildren(el('p', { class: 'list-end' },
        phrases.length
          ? (kept ? 'That is every exact match among the ranked results.'
                  : 'No verse contains that exact phrase. Drop the quotes to ' +
                    'search the words separately.')
          : (res.total > res.results.length
              ? `End of the first ${res.results.length.toLocaleString()} results. ` +
                'Add another word to narrow the search.'
              : 'That is every match.')));
      stopAutoLoad();
    }
    loading = false;
  }

  view.replaceChildren(el('div', { class: 'wrap' },
    el('div', { class: 'results-head' },
      el('h2', {}, /^["'\u201c].*["'\u201d]$/.test(query.trim())
        ? query.trim() : `\u201c${query}\u201d`), countEl),
    expansionNote,
    el('div', { class: 'split' },
      el('div', {}, list, sentinel),
      panel)));

  await renderPage();

  // Load the next page as the end of the list comes into view, with the
  // button as the fallback for anyone who cannot trigger an intersection.
  startAutoLoad(sentinel, loadMore);
}

const PAGE_SIZE = 40;
let autoLoader = null;

function startAutoLoad(sentinel, loadMore) {
  stopAutoLoad();
  if (!('IntersectionObserver' in window)) return;
  autoLoader = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) loadMore();
  }, { rootMargin: '600px' });
  autoLoader.observe(sentinel);
}

function stopAutoLoad() {
  if (autoLoader) autoLoader.disconnect();
  autoLoader = null;
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

  // The Strong's tagging follows the King James text, so the interlinear view
  // is only meaningful there. Everywhere else the toggle is hidden rather
  // than shown broken.
  const canInterlinear = state.translation === 'KJV';
  const tagged = canInterlinear && state.interlinear
    ? await data.strongsWords(book.id) : null;

  const saved = savedSet();
  const body = el('div', { class: 'chapter' + (tagged ? ' chapter-interlinear' : '') });
  verses.forEach((t, i) => {
    const index = firstIndex + i;
    const node = el('span', {
      class: 'v' + (saved.has(index) ? ' v-saved' : ''),
      id: `v${i + 1}`, tabindex: '0', role: 'button',
      'aria-current': verse && Number(verse) === i + 1 ? 'true' : null,
      onclick: () => openVerse(index),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openVerse(index); } },
    }, el('sup', { class: 'vn' }, String(i + 1)));

    const chunks = tagged && tagged[String(index)];
    if (chunks) {
      for (const c of chunks) {
        const ids = Array.isArray(c[1]) ? c[1] : null;
        const supplied = c[1] === 0 || c[2] === 1;
        if (!c[0]) continue;
        if (ids && ids.length) {
          node.append(el('a', {
            class: 'w' + (supplied ? ' w-supplied' : ''),
            href: `#/word/${ids[0]}`,
            title: ids.join(', '),
            onclick: (e) => e.stopPropagation(),
          }, c[0]));
        } else {
          node.append(supplied
            ? el('i', { class: 'w-supplied' }, c[0])
            : document.createTextNode(c[0]));
        }
      }
    } else {
      node.append(t || '—');
    }
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
          'every translation side by side.'))),
    book.chapters.length > 1 ? chapterGrid(book, chapter) : null);

  view.replaceChildren(el('div', { class: 'wrap' },
    el('div', { class: 'reader-head' },
      el('div', {},
        el('a', { class: 'crumb', href: '#/books' }, 'Contents'),
        el('h2', {}, title)),
      el('div', { class: 'reader-nav' },
        canInterlinear ? el('button', {
          class: 'btn' + (state.interlinear ? ' btn-on' : ''), type: 'button',
          title: 'Show the Hebrew and Greek behind each word',
          onclick: () => {
            state.interlinear = !state.interlinear;
            localStorage.setItem('concord.interlinear', state.interlinear ? '1' : '0');
            route();
          },
        }, state.interlinear ? 'Original ✓' : 'Original') : null,
        el('a', { class: 'btn', href: `#/compare/${book.id}/${chapter}` }, 'Compare'),
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
  const at2 = refs.locate(index);
  const saveBtn = el('button', {
    class: 'mini', type: 'button',
    'data-on': isSaved(index) ? '' : null,
    onclick: (e) => {
      const on = toggleSaved(index);
      if (on) e.currentTarget.setAttribute('data-on', '');
      else e.currentTarget.removeAttribute('data-on');
      e.currentTarget.lastChild.textContent = on ? 'Saved' : 'Save';
      const inReader = document.getElementById(`v${at2.verse}`);
      if (inReader) inReader.classList.toggle('v-saved', on);
    },
  }, el('span', {}, '★'), el('span', {}, isSaved(index) ? 'Saved' : 'Save'));

  cards.push(el('div', { class: 'card' },
    el('h3', {}, refs.format(index)),
    el('div', { class: 'card-body' },
      el('div', { class: 'verse-text' }, own || '—'),
      el('div', { class: 'verse-actions' },
        el('a', { class: 'mini', href: readerHash(index) }, 'Read in context'),
        el('a', { class: 'mini', href: `#/compare/${at2.book.id}/${at2.chapter}` }, 'Compare'),
        el('button', { class: 'mini', type: 'button', onclick: () => copyVerse(index) }, 'Copy'),
        saveBtn))));

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

  // original language
  const wordBook = await data.strongsWords(at.book.id);
  const chunks = wordBook && wordBook[String(index)];
  if (chunks) {
    const ids = [];
    for (const c of chunks) {
      if (Array.isArray(c[1])) for (const id of c[1]) if (!ids.includes(id)) ids.push(id);
    }
    const lex = await data.strongsEntries(ids);
    const rows = [];
    for (const c of chunks) {
      if (!Array.isArray(c[1])) continue;
      const english = c[0].trim();
      for (const id of c[1]) {
        const e = lex.get(id);
        if (!e) continue;
        rows.push(el('a', { class: 'ref-item strongs-row', href: `#/word/${id}` },
          el('b', {}, english || '—'),
          el('span', {},
            el('i', { class: 'strongs-lemma',
              lang: e.g === 'greek' ? 'grc' : 'he',
              dir: e.g === 'greek' ? 'ltr' : 'rtl' }, e.l),
            ' ', e.x)));
      }
    }
    if (rows.length) {
      cards.push(el('div', { class: 'card' },
        el('h3', {}, 'Behind the English'),
        el('div', { class: 'ref-list' }, rows)));
    }
  }

  // the KJV translators' own marginal readings
  const notes = await data.translatorNotes();
  const note = notes && notes[String(index)];
  if (note && note.length) {
    cards.push(el('div', { class: 'card' },
      el('h3', {}, "Translators' note"),
      el('div', { class: 'card-body' },
        note.map((n) => el('p', {}, n)))));
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

// ---------- saved verses ----------
// Kept in localStorage. No account, so the list belongs to this browser and
// nothing about it leaves the machine.

const SAVED_KEY = 'concord.saved';

function savedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SAVED_KEY) || '[]'));
  } catch { return new Set(); }
}

function isSaved(index) { return savedSet().has(index); }

function toggleSaved(index) {
  const set = savedSet();
  const on = !set.has(index);
  if (on) set.add(index); else set.delete(index);
  localStorage.setItem(SAVED_KEY, JSON.stringify([...set].sort((a, b) => a - b)));
  toast(on ? `Saved ${refs.format(index)}` : `Removed ${refs.format(index)}`);
  return on;
}

async function copyVerse(index) {
  const text = await verseText(index);
  const line = `${text}\n— ${refs.format(index)} (${state.translation})`;
  try {
    await navigator.clipboard.writeText(line);
    toast('Verse copied');
  } catch {
    // Clipboard access is refused outside a secure context; fall back to a
    // selection the reader can copy themselves rather than failing silently.
    const ta = el('textarea', { style: 'position:fixed;opacity:0' });
    ta.value = line;
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); toast('Verse copied'); }
    catch { toast('Could not copy — select the text instead'); }
    ta.remove();
  }
}

async function renderSaved() {
  document.title = 'Saved verses — Concord';
  const indices = [...savedSet()].sort((a, b) => a - b);
  if (!indices.length) {
    view.replaceChildren(el('div', { class: 'wrap' },
      el('div', { class: 'empty' },
        el('h3', {}, 'Nothing saved yet'),
        el('p', {}, 'Open any verse and choose Save to keep it here. The list ' +
          'lives in this browser only.'))));
    return;
  }
  const texts = await verseTexts(indices);
  view.replaceChildren(el('div', { class: 'wrap' },
    el('div', { class: 'results-head' },
      el('h2', {}, 'Saved verses'),
      el('span', { class: 'results-count' }, plural(indices.length, 'verse', 'verses'))),
    el('div', { class: 'verse-list' },
      indices.map((i) => verseCard(i, texts.get(i), { onOpen: (x) => go(readerHash(x)) })))));
}

// ---------- compare translations ----------

const COMPARE_KEY = 'concord.compare';

function comparePicks() {
  try {
    const saved = JSON.parse(localStorage.getItem(COMPARE_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) return saved;
  } catch { /* fall through to the default */ }
  return ['KJV', 'BSB', 'YLT'];
}

async function renderCompare(bookId, chapter) {
  const book = refs.bookById(Number(bookId));
  if (!book) { go('#/'); return; }
  chapter = Math.min(Math.max(Number(chapter) || 1, 1), book.chapters.length);
  const title = book.chapters.length === 1 ? book.name : `${book.name} ${chapter}`;
  document.title = `${title} compared — Concord`;

  const picks = comparePicks().filter((id) =>
    state.meta.translations.some((t) => t.id === id));
  const all = state.meta.translations;

  const picker = el('div', { class: 'picker' }, all.map((t) => {
    const box = el('input', {
      type: 'checkbox', checked: picks.includes(t.id),
      onchange: () => {
        const next = all.map((x) => x.id).filter((id) =>
          id === t.id ? box.checked : picks.includes(id));
        localStorage.setItem(COMPARE_KEY, JSON.stringify(next));
        route();
      },
    });
    return el('label', { title: t.name }, box, t.id);
  }));

  const body = el('div', {});
  const first = refs.indexOf(book.id, chapter, 1);
  const count = book.chapters[chapter - 1];

  const loaded = await Promise.all(picks.map(async (id) => {
    const payload = await data.bookText(id, book.id);
    return [id, (payload && payload.c[chapter - 1]) || []];
  }));

  for (let i = 0; i < count; i++) {
    const index = first + i;
    body.append(el('div', { class: 'compare-row' },
      el('a', {
        class: 'compare-ref', href: readerHash(index),
        style: 'text-decoration:none;display:block',
      }, refs.format(index)),
      el('div', {
        class: 'compare-grid',
        style: `grid-template-columns: repeat(${Math.min(picks.length, 3)}, minmax(0, 1fr))`,
      },
        loaded.map(([id, verses]) => el('div', { class: 'compare-cell' },
          el('b', {}, id),
          verses[i]
            ? el('span', {}, verses[i])
            : el('em', {}, 'not translated'))))));
  }

  view.replaceChildren(el('div', { class: 'wrap' },
    el('div', { class: 'reader-head' },
      el('div', {},
        el('a', { class: 'crumb', href: readerHash(first) }, 'Read'),
        el('h2', {}, `${title} compared`)),
      el('div', { class: 'reader-nav' },
        el('a', {
          class: 'btn', href: chapter > 1 ? `#/compare/${book.id}/${chapter - 1}` : '#',
          'aria-disabled': chapter <= 1,
        }, '← Previous'),
        el('a', {
          class: 'btn',
          href: chapter < book.chapters.length ? `#/compare/${book.id}/${chapter + 1}` : '#',
          'aria-disabled': chapter >= book.chapters.length,
        }, 'Next →'))),
    el('div', { class: 'card', style: 'margin-bottom:1.2rem' },
      el('h3', {}, 'Translations shown'), picker),
    picks.length ? body : el('div', { class: 'empty' },
      el('p', {}, 'Choose at least one translation.'))));
}

// ---------- original languages ----------

const STRONGS_RE = /^\s*([hg])\s*0*(\d{1,4})\s*$/i;

function parseStrongs(text) {
  const m = STRONGS_RE.exec(text);
  return m ? `${m[1].toUpperCase()}${parseInt(m[2], 10)}` : null;
}

async function renderWord(id) {
  const entries = await data.strongsEntries([id]);
  const entry = entries.get(id);
  if (!entry) {
    view.replaceChildren(el('div', { class: 'wrap' },
      el('div', { class: 'empty' },
        el('h3', {}, 'No such number'),
        el('p', {}, `Strong's ${escapeHTML(id)} is not used in the King James text.`))));
    return;
  }

  const lang = entry.g === 'greek' ? 'Greek' : 'Hebrew';
  document.title = `${entry.x} — Strong's ${id} — Concord`;

  const total = entry.r.reduce((a, [, n]) => a + n, 0) || 1;
  const renderBars = el('div', { class: 'renderings' },
    entry.r.map(([word, n]) => el('div', { class: 'rendering' },
      el('span', { class: 'rendering-word' }, word),
      el('span', { class: 'rendering-bar' },
        el('i', { style: `width:${Math.max(2, (100 * n) / total).toFixed(1)}%` })),
      el('span', { class: 'rendering-n' }, `${n}×`))));

  const head = el('header', { class: 'word-head' },
    el('div', { class: 'word-lemma', lang: entry.g === 'greek' ? 'grc' : 'he',
      dir: entry.g === 'greek' ? 'ltr' : 'rtl' }, entry.l),
    el('div', {},
      el('h2', {}, entry.x),
      el('p', { class: 'word-meta' },
        `${lang} · Strong's ${id}` +
        (entry.p ? ` · ${entry.p}` : '') +
        (entry.o ? ` · ${entry.o}` : ''))));

  const cards = [
    el('div', { class: 'card' },
      el('h3', {}, 'Definition'),
      el('div', { class: 'card-body' }, el('p', {}, entry.d || '—'))),
    entry.r.length ? el('div', { class: 'card' },
      el('h3', {}, 'How the King James renders it'),
      el('div', { class: 'card-body' }, renderBars)) : null,
  ].filter(Boolean);

  const list = el('div', { class: 'verse-list' });
  const countEl = el('span', { class: 'results-count' });
  const sentinel = el('div', { class: 'sentinel' });

  view.replaceChildren(el('div', { class: 'wrap' },
    el('a', { class: 'crumb', href: '#/' }, 'Word study'),
    head,
    el('div', { class: 'split' },
      el('div', {},
        el('div', { class: 'results-head' },
          el('h3', { class: 'section-title' }, 'Every occurrence'), countEl),
        list, sentinel),
      el('aside', { class: 'panel' }, cards))));

  const verses = await data.strongsOccurrences(id);
  let shown = 0;
  const more = el('button', {
    class: 'btn load-more', type: 'button', onclick: () => loadMore(),
  }, 'Show more verses');
  sentinel.replaceChildren(more);

  const renderPage = async () => {
    const batch = verses.slice(shown, shown + PAGE_SIZE);
    if (!batch.length) return false;
    const texts = await verseTexts(batch, 'KJV');
    const words = await Promise.all(batch.map((v) => taggedSpans(v, id)));
    list.append(...batch.map((v, i) => {
      const card = verseCard(v, texts.get(v), { onOpen: (x) => go(readerHash(x)) });
      const spans = words[i];
      if (spans.length) {
        card.querySelector('.verse-text').innerHTML =
          highlightSpans(texts.get(v), spans);
      }
      return card;
    }));
    shown += batch.length;
    countEl.replaceChildren(shown < verses.length
      ? `${shown} of ${plural(verses.length, 'verse', 'verses')}`
      : plural(verses.length, 'verse', 'verses'));
    return shown < verses.length;
  };

  let loading = false;
  async function loadMore() {
    if (loading) return;
    loading = true; more.disabled = true; more.textContent = 'Loading…';
    const hasMore = await renderPage();
    if (hasMore) { more.disabled = false; more.textContent = 'Show more verses'; }
    else { sentinel.replaceChildren(el('p', { class: 'list-end' }, 'That is every occurrence.')); stopAutoLoad(); }
    loading = false;
  }

  await renderPage();
  startAutoLoad(sentinel, loadMore);
}

// The English words in a verse that carry a given Strong's number.
async function taggedSpans(verseIndex, id) {
  const at = refs.locate(verseIndex);
  if (!at) return [];
  const book = await data.strongsWords(at.book.id);
  const chunks = book && book[String(verseIndex)];
  if (!chunks) return [];
  return chunks
    .filter((c) => Array.isArray(c[1]) && c[1].includes(id))
    .map((c) => c[0].trim())
    .filter(Boolean);
}

function highlightSpans(text, spans) {
  if (!text || !spans.length) return escapeHTML(text || '');
  const alts = [...new Set(spans)]
    .sort((a, b) => b.length - a.length)
    .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`(${alts.join('|')})`, 'g');
  return escapeHTML(text).replace(re, (m) => `<mark>${m}</mark>`);
}

// ---------- contents ----------

const DIVISIONS = [
  'Pentateuch', 'Historical', 'Poetry-Wisdom', 'Major Prophets',
  'Minor Prophets', 'Gospels', 'Acts', 'Pauline Epistles',
  'General Epistles', 'Revelation',
];

function renderBooks() {
  document.title = 'Contents — Concord';
  const grouped = new Map(DIVISIONS.map((d) => [d, []]));
  for (const b of state.meta.books) {
    if (!grouped.has(b.div)) grouped.set(b.div, []);
    grouped.get(b.div).push(b);
  }

  const sections = [...grouped.entries()]
    .filter(([, list]) => list.length)
    .map(([division, list]) => el('section', { class: 'division' },
      el('h3', {}, division),
      el('div', { class: 'book-grid' },
        list.map((b) => el('a', {
          class: 'book-link', href: `#/read/${b.id}/1`,
        },
          el('span', {}, b.name),
          el('em', {}, `${b.chapters.length} ch`))))));

  view.replaceChildren(el('div', { class: 'wrap' },
    el('div', { class: 'results-head' },
      el('h2', {}, 'Contents'),
      el('span', { class: 'results-count' }, '66 books · 31,102 verses')),
    el('div', { class: 'divisions' }, sections)));
}

function chapterGrid(book, current) {
  return el('div', { class: 'card' },
    el('h3', {}, 'Chapters'),
    el('div', { class: 'chapter-grid' },
      book.chapters.map((_, i) => el('a', {
        class: 'chapter-link', href: `#/read/${book.id}/${i + 1}`,
        'aria-current': i + 1 === current ? 'true' : null,
      }, String(i + 1)))));
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

      <h2>4. The original languages</h2>
      <p>Every phrase in the King James text is tagged with the Strong's number
      of the Hebrew or Greek word behind it — 374,069 tags across all 31,102
      verses. Click any word while reading to get its lexicon entry and every
      other verse using that same original word, no matter how the English
      varies.</p>
      <p>That last part is what a concordance is for. Hebrew <em>chesed</em> is
      rendered <em>mercy</em> 121 times, <em>kindness</em> 32,
      <em>lovingkindness</em> 17 and <em>goodness</em> 9 — one idea wearing
      four English coats. Searching the English can never show you that; the
      numbers can.</p>
      <p>The build checks that the tagged chunks reassemble into the printed
      King James text character for character. If they ever stop matching, the
      build fails rather than showing you something that is not the verse.</p>

      <h2>Searching</h2>
      <ul>
        <li><code>anxiety</code> — concept search across all four signals</li>
        <li><code>"fear not"</code> — quoted, so the words must appear together
        and in order</li>
        <li><code>John 3:16</code>, <code>1 cor 13:4-7</code>, <code>Ps 23</code>
        — references go straight to the text</li>
        <li><code>H2617</code> or <code>G26</code> — a Strong's number opens the
        word study</li>
        <li><code>/</code> focuses the search box; the arrow keys page through
        chapters while reading</li>
      </ul>

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
  stopAutoLoad();          // the old results list is about to be discarded
  window.scrollTo({ top: 0 });

  try {
    if (!parts.length) { input.value = ''; clearBtn.hidden = true; renderHome(); return; }
    if (parts[0] === 'q') { await renderSearch(decodeURIComponent(parts.slice(1).join('/'))); return; }
    if (parts[0] === 'read') { await renderReader(parts[1], parts[2], parts[3]); return; }
    if (parts[0] === 'word') { await renderWord(parts[1]); return; }
    if (parts[0] === 'compare') { await renderCompare(parts[1], parts[2]); return; }
    if (parts[0] === 'saved') { await renderSaved(); return; }
    if (parts[0] === 'books') { renderBooks(); return; }
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
  const typing = document.activeElement === input
    || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (e.key === '/' && !typing) {
    e.preventDefault(); input.focus(); input.select();
    return;
  }
  if (e.key === 'Escape' && document.activeElement === input) { input.blur(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

  // Chapter paging with the arrow keys, wherever a previous/next pair exists.
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    const btns = [...document.querySelectorAll('.reader-nav a.btn')]
      .filter((a) => /Previous|Next/.test(a.textContent));
    const target = e.key === 'ArrowLeft' ? btns[0] : btns[1];
    if (target && target.getAttribute('aria-disabled') !== 'true'
        && target.getAttribute('href') !== '#') {
      e.preventDefault();
      location.hash = target.getAttribute('href');
    }
  }
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
