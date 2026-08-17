"""Porter stemmer plus a pass for Early Modern English verb endings.

The stemmer only ever runs at build time. The browser never stems: it looks a
word up in a shipped surface-form -> stem table. That means the index and the
query can never disagree because of a stemming implementation drifting between
two languages.
"""

import re

VOWELS = "aeiou"


def _is_consonant(word, i):
    ch = word[i]
    if ch in VOWELS:
        return False
    if ch == "y":
        return i == 0 or not _is_consonant(word, i - 1)
    return True


def _measure(stem):
    """Porter's m: the number of vowel-consonant sequences."""
    n = 0
    i = 0
    length = len(stem)
    while True:
        while i < length and _is_consonant(stem, i):
            i += 1
        if i >= length:
            return n
        i += 1
        while i < length and not _is_consonant(stem, i):
            i += 1
        if i >= length:
            return n
        n += 1
        i += 1
        while True:
            while i < length and _is_consonant(stem, i):
                i += 1
            if i >= length:
                return n
            i += 1
            while i < length and not _is_consonant(stem, i):
                i += 1
            if i >= length:
                return n
            n += 1
            i += 1


def _has_vowel(stem):
    return any(not _is_consonant(stem, i) for i in range(len(stem)))


def _double_consonant(word):
    return (len(word) >= 2 and word[-1] == word[-2]
            and _is_consonant(word, len(word) - 1))


def _cvc(word):
    if len(word) < 3:
        return False
    if not (_is_consonant(word, len(word) - 1)
            and not _is_consonant(word, len(word) - 2)
            and _is_consonant(word, len(word) - 3)):
        return False
    return word[-1] not in "wxy"


_STEP2 = [
    ("ational", "ate"), ("tional", "tion"), ("enci", "ence"), ("anci", "ance"),
    ("izer", "ize"), ("abli", "able"), ("alli", "al"), ("entli", "ent"),
    ("eli", "e"), ("ousli", "ous"), ("ization", "ize"), ("ation", "ate"),
    ("ator", "ate"), ("alism", "al"), ("iveness", "ive"), ("fulness", "ful"),
    ("ousness", "ous"), ("aliti", "al"), ("iviti", "ive"), ("biliti", "ble"),
]

_STEP3 = [
    ("icate", "ic"), ("ative", ""), ("alize", "al"), ("iciti", "ic"),
    ("ical", "ic"), ("ful", ""), ("ness", ""),
]

_STEP4 = [
    "al", "ance", "ence", "er", "ic", "able", "ible", "ant", "ement",
    "ment", "ent", "ou", "ism", "ate", "iti", "ous", "ive", "ize",
]


def porter(word):
    if len(word) <= 2:
        return word

    # step 1a - plurals. The trailing -s of an -ous adjective is not a plural;
    # stripping it splits righteous from righteousness and mangles gracious,
    # glorious, jealous and precious the same way.
    if word.endswith("sses"):
        word = word[:-2]
    elif word.endswith("ies"):
        word = word[:-2]
    elif word.endswith(("ss", "us", "is")):
        pass
    elif word.endswith("s"):
        word = word[:-1]

    # step 1b - past tense and gerunds
    if word.endswith("eed"):
        if _measure(word[:-3]) > 0:
            word = word[:-1]
    else:
        changed = False
        if word.endswith("ed") and _has_vowel(word[:-2]):
            word = word[:-2]
            changed = True
        elif word.endswith("ing") and _has_vowel(word[:-3]):
            word = word[:-3]
            changed = True
        if changed:
            if word.endswith(("at", "bl", "iz")):
                word += "e"
            elif _double_consonant(word) and not word.endswith(("l", "s", "z")):
                word = word[:-1]
            elif _measure(word) == 1 and _cvc(word):
                word += "e"

    # step 1c
    if word.endswith("y") and _has_vowel(word[:-1]):
        word = word[:-1] + "i"

    for suffix, repl in _STEP2:
        if word.endswith(suffix):
            if _measure(word[:-len(suffix)]) > 0:
                word = word[:-len(suffix)] + repl
            break

    for suffix, repl in _STEP3:
        if word.endswith(suffix):
            if _measure(word[:-len(suffix)]) > 0:
                word = word[:-len(suffix)] + repl
            break

    for suffix in _STEP4:
        if word.endswith(suffix):
            stem = word[:-len(suffix)]
            if _measure(stem) > 1:
                if suffix != "ion" or (stem and stem[-1] in "st"):
                    word = stem
            break
    if word.endswith("ion") and _measure(word[:-3]) > 1 and word[-4:-3] in ("s", "t"):
        word = word[:-3]

    # step 5
    if word.endswith("e"):
        m = _measure(word[:-1])
        if m > 1 or (m == 1 and not _cvc(word[:-1])):
            word = word[:-1]
    if _measure(word) > 1 and _double_consonant(word) and word.endswith("l"):
        word = word[:-1]

    return word


# --- spelling normalisation -------------------------------------------------
# The translations disagree on spelling far more than on wording. The KJV has
# "Saviour" and "shew", the BSB has "Savior" and "show". Without this, a search
# for one silently misses every verse in the other.

_SPELLING_EXACT = {
    "shew": "show", "shewed": "showed", "shewest": "showest",
    "sheweth": "showeth", "shewing": "showing", "shewn": "shown",
    "enquire": "inquire", "enquired": "inquired", "enquiry": "inquiry",
    "shalt": "shall", "wilt": "will", "canst": "can", "mayest": "may",
    "shouldest": "should", "wouldest": "would", "couldest": "could",
    "spake": "spoke", "brake": "broke", "clave": "cleaved", "gat": "got",
    "sware": "swore", "bare": "bore", "ware": "wore", "drave": "drove",
    "strave": "strove", "thereof": "thereof", "throughly": "thoroughly",
    "alway": "always", "ofttimes": "oftentimes", "aught": "ought",
    "shineth": "shine", "holpen": "helped", "wot": "know", "wist": "knew",
    "durst": "dared", "trode": "trod", "digged": "dug", "builded": "built",
}

# Only one suffix rule survives. Everything else that looked plausible
# (-ce/-se, -ise/-ize, doubled-l) was measured against the corpus vocabulary
# and mangled far more real words than it merged: called -> caled,
# inheritance -> inheritanse, noise -> noize. Porter already handles doubled
# consonants, and the translations here are internally consistent about -ise.
_SPELLING_SUFFIX = (
    ("ours", "ors"), ("our", "or"),          # saviour -> savior, honour -> honor
)

# Words ending in -our where the "our" is not the British suffix.
_SPELLING_SKIP = {
    "four", "your", "yours", "pour", "poured", "pouring", "pourest",
    "poureth", "tour", "sour", "hour", "hours", "flour", "scour", "scoured",
    "devour", "devoured", "devouring", "devourer", "devoureth", "our", "ours",
    "detour", "contour", "velour", "amour", "dour", "outpour", "outpoured",
}


def normalise_spelling(word):
    if word in _SPELLING_EXACT:
        return _SPELLING_EXACT[word]
    if word in _SPELLING_SKIP or len(word) <= 4:
        return word
    for suffix, repl in _SPELLING_SUFFIX:
        if word.endswith(suffix):
            return word[:-len(suffix)] + repl
    return word


# --- irregular verbs and pronouns -------------------------------------------
# Porter cannot connect "forgiven" to "forgive" or "spake" to "speak"; those are
# stem changes, not suffixes. This table is small but covers the verbs that
# actually carry meaning in a Bible search.

def _expand(table):
    out = {}
    for base, forms in table.items():
        for form in forms:
            out[form] = base
    return out


IRREGULAR = _expand({
    "be": ["am", "is", "are", "was", "were", "been", "being", "art", "wast",
           "wert", "beest"],
    "have": ["has", "had", "having", "hast", "hath", "hadst"],
    "do": ["does", "did", "done", "doing", "doth", "doest", "didst", "dost"],
    "say": ["said", "saith", "saidst", "says", "saying"],
    "go": ["went", "gone", "going", "goest", "goeth", "goes"],
    "come": ["came", "coming", "comest", "cometh", "comes"],
    "give": ["gave", "given", "giving", "givest", "giveth", "gives"],
    "forgive": ["forgave", "forgiven", "forgiving", "forgiveth", "forgiveness"],
    "take": ["took", "taken", "taking", "takest", "taketh", "takes"],
    "make": ["made", "making", "makest", "maketh", "makes"],
    "know": ["knew", "known", "knowing", "knowest", "knoweth", "knows"],
    "see": ["saw", "seen", "seeing", "seest", "seeth", "sees"],
    "speak": ["spoke", "spoken", "spake", "speaking", "speaketh", "speaks"],
    "write": ["wrote", "written", "writing", "writeth", "writes", "wrought"],
    "bring": ["brought", "bringing", "bringeth", "brings"],
    "think": ["thought", "thinking", "thinketh", "thinks"],
    "seek": ["sought", "seeking", "seeketh", "seeks"],
    "teach": ["taught", "teaching", "teacheth", "teaches"],
    "send": ["sent", "sending", "sendeth", "sends"],
    "build": ["built", "building", "buildeth", "builds"],
    "find": ["found", "finding", "findeth", "finds"],
    "bind": ["bound", "binding", "bindeth", "binds"],
    "stand": ["stood", "standing", "standeth", "stands"],
    "understand": ["understood", "understanding", "understandeth"],
    "hear": ["heard", "hearing", "heareth", "hears", "hearest"],
    "hold": ["held", "holding", "holdeth", "holds"],
    "keep": ["kept", "keeping", "keepeth", "keeps"],
    "leave": ["left", "leaving", "leaveth", "leaves"],
    "lose": ["lost", "losing", "loseth", "loses"],
    "tell": ["told", "telling", "telleth", "tells"],
    "eat": ["ate", "eaten", "eating", "eateth", "eats"],
    "fall": ["fell", "fallen", "falling", "falleth", "falls"],
    "forget": ["forgot", "forgotten", "forgetting", "forgetteth"],
    "forsake": ["forsook", "forsaken", "forsaking", "forsaketh"],
    "choose": ["chose", "chosen", "choosing", "chooseth"],
    "drive": ["drove", "driven", "driving", "driveth"],
    "rise": ["rose", "risen", "rising", "riseth"],
    "arise": ["arose", "arisen", "arising", "ariseth"],
    "shake": ["shook", "shaken", "shaking", "shaketh"],
    "slay": ["slew", "slain", "slaying", "slayeth"],
    "smite": ["smote", "smitten", "smiting", "smiteth"],
    "swear": ["swore", "sworn", "swearing", "sweareth"],
    "throw": ["threw", "thrown", "throwing", "throweth"],
    "weep": ["wept", "weeping", "weepeth", "weeps"],
    "begin": ["began", "begun", "beginning", "beginneth"],
    "drink": ["drank", "drunk", "drunken", "drinking", "drinketh"],
    "sing": ["sang", "sung", "singing", "singeth"],
    "bear": ["bore", "borne", "born", "bearing", "beareth", "bare"],
    "break": ["broke", "broken", "breaking", "breaketh", "brake"],
    "grow": ["grew", "grown", "growing", "groweth"],
    "blow": ["blew", "blown", "blowing", "bloweth"],
    "draw": ["drew", "drawn", "drawing", "draweth"],
    "flee": ["fled", "fleeing", "fleeth"],
    "lay": ["laid", "laying", "layeth"],
    "lead": ["led", "leading", "leadeth"],
    "sit": ["sat", "sitting", "sitteth"],
    "shed": ["shedding", "sheddeth"],
    "get": ["got", "gotten", "getting", "getteth"],
    "sell": ["sold", "selling", "selleth"],
    "buy": ["bought", "buying", "buyeth"],
    "fight": ["fought", "fighting", "fighteth"],
    "pay": ["paid", "paying", "payeth"],
    "you": ["ye", "thee", "thou", "thy", "thine", "thyself", "yourselves"],
})


# --- Early Modern orthography ------------------------------------------------
# In 16th and 17th century printing u/v and i/j were positional variants of one
# letter: v word-initially, u elsewhere. So Tyndale writes "seruant", "loue",
# "vnto", "ioy". Blind rewriting is unsafe - the same rule turns "value" into
# "valve" and "continue" into "continve" - so the transform is only accepted
# when the corpus itself says the rewritten form is the common one.

def orthographic_candidates(word):
    out = set()
    # u used as a consonant, i.e. followed by a vowel: loue -> love,
    # seruant -> servant, heauen -> heaven. Requiring a vowel on both sides
    # would miss every word where the u follows a consonant.
    for m in re.finditer(r"u(?=[aeiouy])", word):
        if m.start() == 0:
            continue
        out.add(word[:m.start()] + "v" + word[m.end():])
    # word-initial v used as a vowel: vnto -> unto, vp -> up
    if word.startswith("v") and len(word) > 1 and word[1] not in "aeiouy":
        out.add("u" + word[1:])
    # word-initial i used as a consonant: ioy -> joy, iudge -> judge
    if word.startswith("i") and len(word) > 1 and word[1] in "aeou":
        out.add("j" + word[1:])
    # ie/ye and y/i alternation: bee -> be, sayd -> said, hee -> he
    if "y" in word:
        out.add(word.replace("y", "i"))
    out.add(re.sub(r"([bcdfghklmnprstvwz])\1", r"\1", word))   # doubled letters
    if word.endswith("e"):
        out.add(word[:-1])
    else:
        out.add(word + "e")
    out.discard(word)
    return out


# Archaic function words that are genuinely distinct words, not misspellings.
# Without this "thee" collapses into "the" and "ye" into "he".
PROTECTED = {
    "thee", "thou", "thy", "thine", "ye", "yea", "nay", "oft", "hast",
    "hath", "doth", "art", "wilt", "shalt", "unto", "thus", "thence",
    "hence", "whence", "lest", "save", "ere", "nigh", "wot", "yon",
}


def modernise(word, freq, modern, ratio=2.5, floor=25):
    """Rewrite an archaic spelling only when the corpus vouches for it.

    Two guards keep real words intact. A word the modern translations use is a
    real word, not an archaic spelling - that is what stops off -> of,
    here -> her and ass -> as. And a short list of archaic function words is
    protected outright, because nothing in the frequency data distinguishes
    the pronoun "thee" from a misspelling of "the".
    """
    if word in PROTECTED or modern.get(word, 0) >= 3:
        return word
    current = word
    for _ in range(2):
        best, best_n = None, freq.get(current, 0) * ratio
        for cand in orthographic_candidates(current):
            n = freq.get(cand, 0)
            if n >= floor and n > best_n:
                best, best_n = cand, n
        if best is None:
            break
        current = best
    return current



# Early Modern English endings that the KJV, Geneva and Tyndale use heavily.
# "loveth" and "loves" must land on the same stem or cross-translation search
# silently fails on exactly the translations people search most.
ARCHAIC = ("eth", "est", "edst", "eest", "th")


def archaic_candidates(word):
    """Plausible modern bases for an Early Modern English inflected form."""
    out = []
    for suffix in ARCHAIC:
        if not word.endswith(suffix) or len(word) - len(suffix) < 2:
            continue
        base = word[:-len(suffix)]
        out.extend([base, base + "e", base + "y"])
        if _double_consonant(base):
            out.append(base[:-1])
    return out
