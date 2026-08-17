#!/usr/bin/env bash
# Download the upstream datasets Concord is built from.
#
# Nothing here is redistributed in raw form; the build turns these into the
# files under site/data/. Total download is roughly 150MB.

set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/raw
cd data/raw

SCROLL="https://raw.githubusercontent.com/scrollmapper/bible_databases/master"
METAV="https://raw.githubusercontent.com/theonize/KJV-bible-database-with-metadata-MetaV-/master/CSV"

# --- translations (public domain), MIT-licensed collection ------------------
# DRC and JPS are fetched but not shipped: neither uses KJV versification.
# See build/common.py for why.
TRANSLATIONS=(KJV BSB ASV NHEB ACV YLT Darby Rotherham BBE Webster Geneva1599 Tyndale DRC JPS)

for t in "${TRANSLATIONS[@]}"; do
  if [ ! -s "$t.json" ]; then
    echo "  translation $t"
    curl -fsSL "$SCROLL/formats/json/$t.json" -o "$t.json"
  fi
done

# --- Strong's-tagged KJV in OSIS form ---------------------------------------
if [ ! -s KJV-osis.json ]; then
  echo "  KJV with Strong's numbers"
  curl -fsSL "$SCROLL/sources/en/KJV/KJV-osis.json" -o KJV-osis.json
fi

# --- cross-references (openbible.info, CC BY) -------------------------------
if [ ! -s cross_references.txt ]; then
  echo "  cross-references"
  curl -fsSL "$SCROLL/sources/extras/cross_references.txt" -o cross_references.txt
fi

# --- canonical tables, topical index, Strong's dictionary (MetaV, MIT) ------
for f in Books.csv BookAliases.csv Verses.csv Topics.csv TopicIndex.csv \
         Strongs.csv People.csv PeopleAliases.csv Places.csv PlaceAliases.csv; do
  if [ ! -s "$f" ]; then
    echo "  $f"
    curl -fsSL "$METAV/$f" -o "$f"
  fi
done

echo "sources ready in data/raw ($(du -sh . | cut -f1))"
