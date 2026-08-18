"""Run the whole pipeline, in order.

    python3 build/build_all.py

Steps depend on each other: the text has to be aligned before it can be
indexed, and the index's vocabulary is what the thesaurus and morphology are
keyed on. Running a step out of order will fail loudly rather than quietly
produce a mismatched artefact.
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import build_graph          # noqa: E402
import build_index          # noqa: E402
import build_morphology     # noqa: E402
import build_concepts       # noqa: E402
import build_strongs        # noqa: E402
import build_text           # noqa: E402
import build_typos          # noqa: E402
import build_thesaurus      # noqa: E402
import build_topics         # noqa: E402
import build_xref           # noqa: E402
from common import OUT, human, log  # noqa: E402

STEPS = [
    ("align translations onto the canonical spine", build_text.build),
    ("cross-reference graph", build_xref.build),
    ("lexical index", build_index.build),
    ("concept graph (random walk)", build_graph.build),
    ("topical indexes", build_topics.build),
    ("parallel-corpus thesaurus", build_thesaurus.build),
    ("derivational morphology", build_morphology.build),
    ("original languages", build_strongs.build),
    ("curated concept bridge", build_concepts.build),
    ("typo tolerance", build_typos.build),
]


def directory_size(path):
    total = 0
    for root, _dirs, files in os.walk(path):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    return total


def main():
    start = time.time()
    for i, (name, fn) in enumerate(STEPS, 1):
        log(f"[{i}/{len(STEPS)}] {name}")
        t0 = time.time()
        fn()
        log(f"      done in {time.time() - t0:.1f}s\n")
    log(f"built {human(directory_size(OUT))} in {time.time() - start:.0f}s")


if __name__ == "__main__":
    main()
