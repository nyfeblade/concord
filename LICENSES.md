# Licences and attribution

Concord ships every text it displays. Nothing is fetched from a third party at
runtime, and no part of the app requires a key or an account.

## Concord itself

MIT — see [LICENSE](LICENSE).

## Scripture texts

All twelve translations are in the public domain. Anything published before
1929 is public domain in the United States by age; the remainder are noted
individually.

| Code | Translation | Year | Status |
| --- | --- | --- | --- |
| KJV | King James Version | 1611 / 1769 | Public domain in the US. (In the UK the KJV is under perpetual Crown letters patent; this project is US-hosted, where it is unrestricted.) |
| BSB | Berean Standard Bible | 2022 | Released for free use by its publisher, including commercial use, with no permission required. |
| ASV | American Standard Version | 1901 | Public domain by age. |
| NHEB | New Heart English Bible | 2010 | Dedicated to the public domain by its editor. |
| ACV | A Conservative Version | 2005 | Placed in the public domain by Walter L. Porter. |
| YLT | Young's Literal Translation | 1898 | Public domain by age. |
| Darby | Darby Bible | 1890 | Public domain by age. |
| Rotherham | The Emphasised Bible | 1902 | Public domain by age. |
| BBE | Bible in Basic English | 1949 / 1965 | Published without a US copyright renewal and distributed as public domain by Cambridge and by every major Bible archive. This is the one text here whose status rests on non-renewal rather than age. |
| Webster | Webster's Revision | 1833 | Public domain by age. |
| Geneva | Geneva Bible | 1599 | Public domain by age. |
| Tyndale | Tyndale Bible | 1526 / 1530 | Public domain by age. Partial: Tyndale translated the Pentateuch, Jonah and the New Testament before his execution, so roughly a quarter of the canonical spine is present and the rest is shown as untranslated. |

### Deliberately absent

The ESV, NIV, NASB, NKJV, CSB, NLT and The Message are copyrighted and none of
them can be lawfully redistributed or indexed here.

- **ESV** — the [ESV API](https://api.esv.org/) allows storing at most 500
  verses, or half of any book, whichever is less. Building a search index over
  the full text is squarely outside that. It is also non-commercial only and
  rate-limited.
- **NIV** — Biblica does not license the text for redistribution. Access runs
  through a commercial agreement, and it is not offered in the standard
  self-serve tiers at [API.Bible](https://api.bible/).
- **Others** — available through API.Bible's Express Licensing at a monthly fee
  per translation, for display only, which is incompatible with a static
  offline app.

Unlicensed datasets containing these translations are easy to find and are
widely used. They are not used here.

### Prepared but not shipped

The Douay-Rheims (Challoner) and the 1917 JPS Tanakh are both public domain and
are downloaded by `build/fetch_sources.sh`, but neither is shipped. Neither
uses KJV versification:

- The Douay-Rheims follows Vulgate psalm numbering, which runs one behind the
  Hebrew for most of the Psalter — its Psalm 23 is the KJV's Psalm 24. Aligning
  it by chapter number would show the wrong psalm without any visible sign of
  error.
- The JPS Tanakh counts Hebrew superscriptions as verses, shifting roughly 170
  verses inside the Psalms.

The build refuses to align either one; see the guard in
`build/build_text.py`.

## Reference data

| Dataset | Source | Licence |
| --- | --- | --- |
| Cross-references (877,377 edges) | [openbible.info](https://www.openbible.info/labs/cross-references/) | CC BY 4.0 |
| Treasury of Scripture Knowledge | R. A. Torrey, 1834 — the basis of the above | Public domain |
| Nave's Topical Bible | Orville J. Nave, 1897 | Public domain |
| Torrey's New Topical Textbook | R. A. Torrey, 1897 | Public domain |
| Topical index, canonical tables, Strong's dictionary | [MetaV](https://github.com/theonize/KJV-bible-database-with-metadata-MetaV-) | MIT |
| Translation texts, OSIS KJV | [scrollmapper/bible_databases](https://github.com/scrollmapper/bible_databases) | MIT |

## Attribution notice

Cross-reference data is used under CC BY 4.0 and is attributed to
openbible.info both here and in the application's Sources page. The data has
been transformed: ranges expanded, reverse edges added, community-downvoted
links dropped, and the result distilled into a random-walk neighbour table.
