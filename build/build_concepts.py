"""Step 9 - a curated bridge from modern vocabulary to biblical wording.

Every other expansion in this project is derived from the corpus, which means
none of them can reach a word the translations never use. Search "loneliness"
and there is nothing to match: no English Bible here contains it. The verses
exist - they say alone, solitary, forsaken, desolate - but no amount of
corpus statistics builds a bridge from a word that is not there.

So this one is hand-written, which is how Nave's was made too. It is a plain
table anyone can read, argue with and send a correction for, rather than a
model nobody can inspect. Every target is checked against the real vocabulary
at build time, so a typo or a word that only sounds biblical fails the build
instead of silently doing nothing.

Entries are deliberately conservative. The aim is to reach the passage a
person is actually looking for, not to editorialise about what scripture says
on a subject - the ranking and the topical index still decide what surfaces.

Order matters: the first target for a concept carries full weight and later
ones decay. That is the knob for a word that is right but noisy. "Desolate"
genuinely means lonely, and it is also what the prophets call a sacked city,
so listing it late keeps it available without letting Isaiah's ruins outrank
"it is not good that the man should be alone".
"""

import os
from collections import defaultdict

from common import OUT, human, load_vocab, log, write_json

DECAY = 0.82   # how quickly later targets for a concept lose weight

# modern search term -> the biblical wording that carries the idea,
# best fit first
CONCEPTS = {
    # inner life
    "loneliness":    ["alone", "solitary", "forsake", "friend"],
    "lonely":        ["alone", "solitary", "forsake"],
    "depression":    ["downcast", "heaviness", "cast down", "despair", "sorrowful"],
    "depressed":     ["downcast", "heaviness", "despair", "cast down"],
    "anxiety":       ["careful", "anxious", "thought", "cumbered"],
    "anxious":       ["careful", "thought", "troubled"],
    "worry":         ["careful", "thought", "anxious", "troubled"],
    "stress":        ["burden", "weary", "heavy laden", "trouble", "pressed"],
    "burnout":       ["weary", "faint", "labour", "rest", "refresh"],
    "exhausted":     ["weary", "faint", "fainted"],
    "panic":         ["afraid", "terror", "dismayed", "trembling"],
    "grief":         ["mourn", "sorrow", "lament", "weep", "heaviness"],
    "grieving":      ["mourn", "sorrow", "lament", "weep"],
    "mourning":      ["mourn", "lament", "weep", "sackcloth"],
    "despair":       ["despair", "hope", "cast down", "faint"],
    "shame":         ["ashamed", "confounded", "reproach", "naked"],
    "guilt":         ["guilty", "conscience", "iniquity", "trespass"],
    "regret":        ["repent", "sorrow", "grieved"],
    "bitterness":    ["bitter", "gall", "wormwood", "root of bitterness"],
    "insecurity":    ["afraid", "confidence", "trust", "fear"],
    "selfesteem":    ["confidence", "boldness", "image", "fearfully"],
    "identity":      ["image", "sons", "adoption", "chosen", "called"],
    "purpose":       ["purpose", "counsel", "work", "called", "vanity"],
    "meaning":       ["vanity", "purpose", "portion", "profit"],
    "contentment":   ["content", "sufficient", "godliness with contentment"],
    "gratitude":     ["thanksgiving", "thanks", "praise", "bless"],
    "thankfulness":  ["thanksgiving", "thanks", "praise"],
    "joy":           ["joy", "rejoice", "glad", "delight"],
    "peace":         ["peace", "quiet", "rest", "still"],

    # struggle and sin
    "addiction":     ["bondage", "servant of sin", "drunkard", "appetite", "captive"],
    "addicted":      ["bondage", "captive", "servant"],
    "alcoholism":    ["drunkard", "wine", "strong drink", "drunken"],
    "temptation":    ["tempt", "snare", "lust", "entice"],
    "lust":          ["lust", "concupiscence", "fornication", "adultery"],
    "pornography":   ["lust", "adultery", "eyes", "fornication"],
    "greed":         ["covetousness", "covet", "mammon", "lucre", "riches"],
    "gossip":        ["talebearer", "whisperer", "backbiting", "slander", "busybody"],
    "slander":       ["slander", "backbiting", "false witness", "reproach"],
    "laziness":      ["slothful", "sluggard", "idle", "diligent"],
    "procrastination": ["sluggard", "slothful", "morrow", "diligent"],
    "envy":          ["envy", "covet", "jealousy"],
    "jealousy":      ["jealous", "envy", "zeal"],
    "revenge":       ["avenge", "vengeance", "recompense", "requite"],
    "betrayal":      ["betray", "treachery", "deceit", "guile"],
    "hypocrisy":     ["hypocrite", "feigned", "outward appearance"],
    "doubt":         ["unbelief", "wavering", "doubt", "faithless"],
    "pride":         ["proud", "haughty", "lifted up", "exalt", "arrogant"],
    "selfishness":   ["selfwilled", "vainglory", "covetous", "seeketh her own"],
    "anger":         ["angry", "wrath", "fury", "provoked", "indignation"],
    "violence":      ["violence", "bloodshed", "cruel", "smite"],
    "abuse":         ["oppression", "oppress", "violence", "afflict", "cruel"],

    # relationships
    "friendship":    ["friend", "companion", "brethren", "neighbour"],
    "marriage":      ["marriage", "wife", "husband", "wedding", "cleave"],
    "divorce":       ["divorce", "put away", "writing of divorcement"],
    "dating":        ["marriage", "espoused", "betrothed", "wife"],
    "parenting":     ["children", "nurture", "admonition", "chasten", "train up"],
    "family":        ["household", "children", "father", "kindred", "house"],
    "singleness":    ["unmarried", "eunuch", "virgin", "alone"],
    "infertility":   ["barren", "conceive", "childless", "womb"],
    "adoption":      ["adoption", "sons", "heirs", "fatherless"],
    "conflict":      ["strife", "contention", "quarrel", "variance"],
    "reconciliation": ["reconcile", "peace", "agree", "atonement"],
    "loyalty":       ["faithful", "cleave", "steadfast", "covenant"],
    "hospitality":   ["stranger", "entertain", "lodge", "hospitality"],
    "community":     ["fellowship", "brethren", "assembly", "one another"],

    # work and money
    "work":          ["labour", "work", "diligent", "hands", "toil"],
    "career":        ["labour", "calling", "work", "trade"],
    "job":           ["labour", "work", "servant", "hire"],
    "unemployment":  ["idle", "hire", "labourer", "need"],
    "money":         ["money", "riches", "mammon", "silver", "treasure"],
    "wealth":        ["riches", "treasure", "substance", "abundance"],
    "poverty":       ["poor", "needy", "want", "beggar"],
    "debt":          ["debt", "debtor", "surety", "usury", "lend"],
    "generosity":    ["liberal", "bountiful", "alms", "give", "cheerful giver"],
    "tithing":       ["tithe", "offering", "firstfruits"],
    "business":      ["merchant", "just weight", "trade", "diligent"],
    "success":       ["prosper", "prosperity", "increase", "blessed"],
    "failure":       ["fall", "stumble", "vain", "confounded"],

    # body and mortality
    "health":        ["health", "heal", "whole", "sound"],
    "sickness":      ["sick", "infirmity", "disease", "plague", "heal"],
    "illness":       ["sick", "infirmity", "disease", "heal"],
    "healing":       ["heal", "whole", "restore", "balm"],
    "disability":    ["lame", "blind", "deaf", "infirmity", "impotent"],
    "aging":         ["old age", "gray", "aged", "elders", "stricken in years"],
    "death":         ["death", "die", "grave", "dust", "sleep"],
    "dying":         ["die", "death", "give up the ghost"],
    "afterlife":     ["resurrection", "everlasting life", "heaven", "judgment"],
    "heaven":        ["heaven", "kingdom", "paradise", "mansions"],
    "hell":          ["hell", "lake of fire", "everlasting fire", "damnation"],
    "suffering":     ["affliction", "tribulation", "suffer", "trial", "chasten"],
    "pain":          ["pain", "sorrow", "affliction", "travail"],
    "trauma":        ["affliction", "wounded", "broken", "terror"],

    # faith and practice
    "prayer":        ["pray", "prayer", "supplication", "intercession"],
    "worship":       ["worship", "praise", "bow", "adore", "serve"],
    "faith":         ["faith", "believe", "trust", "assurance"],
    "salvation":     ["saved", "salvation", "redeem", "born again"],
    "repentance":    ["repent", "turn", "contrite", "confess"],
    "baptism":       ["baptize", "baptism", "washing"],
    "communion":     ["supper", "bread", "cup", "remembrance"],
    "discipleship":  ["disciple", "follow", "learn", "teach"],
    "evangelism":    ["preach", "gospel", "witness", "testify"],
    "mission":       ["sent", "preach", "nations", "gospel"],
    "leadership":    ["shepherd", "elder", "overseer", "rule", "bishop"],
    "calling":       ["called", "calling", "chosen", "sent"],
    "guidance":      ["counsel", "direct", "lead", "path", "wisdom"],
    "decisions":     ["counsel", "wisdom", "choose", "direct thy paths"],
    "wisdom":        ["wisdom", "understanding", "prudent", "knowledge"],
    "obedience":     ["obey", "keep", "commandment", "hearken"],
    "holiness":      ["holy", "sanctify", "pure", "consecrate"],
    "grace":         ["grace", "favour", "mercy", "gift"],
    "mercy":         ["mercy", "compassion", "pity", "lovingkindness"],
    "forgiveness":   ["forgive", "pardon", "remit", "blot out"],
    "humility":      ["humble", "lowly", "meek", "abase"],
    "patience":      ["patience", "longsuffering", "endure", "wait"],
    "perseverance":  ["endure", "patience", "steadfast", "continue", "run"],
    "courage":       ["courage", "strong", "valiant", "bold", "fear not"],
    "selfcontrol":   ["temperance", "sober", "rule his own spirit", "bridle"],
    "integrity":     ["integrity", "upright", "just weight", "truth"],
    "honesty":       ["truth", "lie", "false witness", "just"],
    "justice":       ["justice", "judgment", "righteous", "equity"],
    "racism":        ["respect of persons", "partiality", "nations", "Gentile"],
    "immigration":   ["stranger", "sojourner", "alien", "foreigner"],
    "refugee":       ["stranger", "sojourner", "flee", "refuge"],
    "poverty relief": ["poor", "needy", "alms", "gleaning"],
    "environment":   ["earth", "creation", "dominion", "land", "ground"],
    "government":    ["king", "powers", "authority", "tribute", "ruler"],
    "war":           ["war", "battle", "sword", "army"],
    "rest":          ["rest", "sabbath", "quiet", "refresh"],
    "sleep":         ["sleep", "slumber", "rest", "night"],
    "fasting":       ["fast", "fasting", "afflict the soul"],
    "hope":          ["hope", "expectation", "wait", "trust"],
    "comfort":       ["comfort", "consolation", "console"],
    "encouragement": ["comfort", "exhort", "strengthen", "edify"],
    "loneliness of god": ["forsaken", "hide thy face", "far from me"],
    "doubtinggod":   ["unbelief", "why hast thou forsaken", "wherefore"],
    "spiritual warfare": ["armour", "wiles", "principalities", "wrestle", "devil"],
    "angels":        ["angel", "cherubim", "seraphim", "host"],
    "prophecy":      ["prophet", "prophesy", "vision", "latter days"],
    "creation":      ["created", "beginning", "made", "formed"],
    "miracles":      ["miracle", "sign", "wonder", "mighty work"],
}


def resolve(words, vocab):
    """Map a phrase to content stems.

    The vocabulary marks stopwords with an empty stem. Those are dropped from
    a multi-word target rather than failing it - "root of bitterness" is a
    fine target, the "of" simply carries nothing. A word absent from the
    vocabulary altogether is a different matter and gets reported, because it
    means the table is claiming a word the Bible does not use.
    """
    stems, unknown, dropped = [], [], []
    for w in words:
        if w not in vocab:
            unknown.append(w)
        elif vocab[w] == "":
            dropped.append(w)
        else:
            stems.append(vocab[w])
    return stems, unknown, dropped


def build():
    vocab = load_vocab()

    bridge = defaultdict(dict)
    missing = []
    entries = 0

    for phrase, targets in CONCEPTS.items():
        # The key is stemmed the same way a typed query will be, so a search
        # for "loneliness" and one for "lonely" both land here.
        key_words = [w for w in phrase.lower().split() if w]
        key_stems, key_unknown, _ = resolve(key_words, vocab)
        # A search term absent from every translation is exactly the case this
        # table exists for, so it is keyed on the raw word instead of a stem.
        key = " ".join(key_words) if key_unknown else " ".join(key_stems)
        if not key:
            continue

        resolved = {}
        for position, target in enumerate(targets):
            # Earlier targets are the better fit for the concept; later ones
            # are still right but noisier, so they arrive quieter.
            weight = round(DECAY ** position, 3)
            words = [w for w in target.lower().split() if w]
            stems, unknown, _dropped = resolve(words, vocab)
            if unknown:
                missing.append((phrase, target, unknown))
                continue
            if not stems:
                missing.append((phrase, target, ["all stopwords"]))
                continue
            for st in stems:
                resolved[st] = max(resolved.get(st, 0), weight)
        if resolved:
            bridge[key].update(resolved)
            entries += len(resolved)

    if missing:
        log(f"  ! {len(missing)} targets are not in any translation:")
        for phrase, target, unknown in missing[:10]:
            log(f"      {phrase:16s} -> {target!r} (missing {unknown})")

    payload = {k: [[s, w] for s, w in sorted(v.items(), key=lambda kv: -kv[1])]
               for k, v in bridge.items()}
    size = write_json(os.path.join(OUT, "concepts.json"), payload)
    log(f"  {len(payload)} concepts bridged to {entries} biblical terms, "
        f"{human(size)}")
    return len(missing)


if __name__ == "__main__":
    build()
