"""Step 4 - distil the cross-reference graph into a concept-neighbour table.

The 877k cross-reference edges are a semantic space that scholars built by
hand. Two verses linked by many independent paths are conceptually related
even when they share no vocabulary, which is exactly the signal a keyword
index cannot produce.

At query time we cannot afford a live random walk, so the walk is precomputed
here. For every verse we run a truncated random walk with restart over the
graph and keep its strongest K neighbours. The browser then does one lookup
instead of a traversal.

Output is a single binary blob:
  magic "CNG1" | K | n  | offsets uint32[n+1] | targets uint32[m] | weights uint8[m]
"""

import os
import struct

import numpy as np
import scipy.sparse as sp

from common import OUT, RAW, human, load_spine, log

RESTART = 0.15      # alpha: probability the walk jumps back to the source
HOP2 = 0.45         # how much of the score comes from two-hop paths
MAX_DEGREE = 48     # cap per-verse fan-out before squaring, to bound P^2
TOP_K = 32          # neighbours kept per verse
BLOCK = 2048        # rows per blocked multiply


def load_edges(osis_index):
    """(rows, cols, weights) for the symmetric, vote-weighted graph."""
    rows, cols, vals = [], [], []
    dropped = 0
    with open(os.path.join(RAW, "cross_references.txt"), encoding="utf-8") as f:
        next(f)
        for line in f:
            p = line.rstrip("\n").split("\t")
            if len(p) < 3:
                continue
            try:
                votes = int(p[2])
            except ValueError:
                votes = 0
            # A negative score means the community judged the link wrong.
            # Keeping it would propagate exactly the associations readers
            # already rejected.
            if votes < 0:
                dropped += 1
                continue
            src = osis_index.get(p[0])
            if src is None:
                continue
            dst = p[1]
            if "-" in dst:
                a, b = dst.split("-", 1)
                start, end = osis_index.get(a), osis_index.get(b)
            else:
                start = end = osis_index.get(dst)
            if start is None or end is None or end < start:
                continue
            # Votes are heavily skewed; a log keeps a 60-vote link ahead of a
            # 5-vote one without letting it dominate the walk.
            w = 1.0 + np.log1p(votes)
            span = end - start + 1
            for tgt in range(start, end + 1):
                # A wide range is a weaker statement about any single verse
                # inside it than a pinpoint reference is.
                ww = w / (1.0 + 0.15 * (span - 1))
                rows.append(src); cols.append(tgt); vals.append(ww)
                rows.append(tgt); cols.append(src); vals.append(ww)
    log(f"  dropped {dropped} community-downvoted links")
    return rows, cols, vals


def cap_degree(mat, limit):
    """Keep only the strongest `limit` edges per row."""
    mat = mat.tocsr()
    keep_data, keep_idx, keep_ptr = [], [], [0]
    for i in range(mat.shape[0]):
        s, e = mat.indptr[i], mat.indptr[i + 1]
        d, idx = mat.data[s:e], mat.indices[s:e]
        if len(d) > limit:
            sel = np.argpartition(-d, limit)[:limit]
            d, idx = d[sel], idx[sel]
        keep_data.append(d); keep_idx.append(idx); keep_ptr.append(keep_ptr[-1] + len(d))
    return sp.csr_matrix(
        (np.concatenate(keep_data), np.concatenate(keep_idx), np.array(keep_ptr)),
        shape=mat.shape)


def row_normalise(mat):
    total = np.asarray(mat.sum(axis=1)).ravel()
    total[total == 0] = 1.0
    return sp.diags(1.0 / total) @ mat


def build():
    spine, osis_by_book = load_spine()
    n = len(spine)
    osis_index = {}
    for i, (bid, ch, v) in enumerate(spine):
        osis_index[f"{osis_by_book[bid]}.{ch}.{v}"] = i

    rows, cols, vals = load_edges(osis_index)
    A = sp.coo_matrix((vals, (rows, cols)), shape=(n, n)).tocsr()
    A.sum_duplicates()
    log(f"  raw graph: {A.nnz} directed edges, "
        f"mean degree {A.nnz / n:.1f}, max {np.diff(A.indptr).max()}")

    A = cap_degree(A, MAX_DEGREE)
    P = row_normalise(A)
    log(f"  capped to <={MAX_DEGREE}/verse: {P.nnz} edges")

    # Truncated random walk with restart. One hop says "a scholar linked
    # these"; two hops says "these sit in the same web of discussion", which is
    # where the conceptual matches that share no words come from.
    one = (1.0 - HOP2) * (1.0 - RESTART)
    two = HOP2 * (1.0 - RESTART) ** 2

    offsets = np.zeros(n + 1, dtype=np.uint32)
    all_targets, all_weights = [], []

    for start in range(0, n, BLOCK):
        end = min(start + BLOCK, n)
        blk = P[start:end]
        scores = (one * blk + two * (blk @ P)).tolil()
        for r in range(end - start):
            i = start + r
            idx = np.array(scores.rows[r], dtype=np.int64)
            dat = np.array(scores.data[r], dtype=np.float64)
            if len(idx):
                mask = idx != i          # a verse is not its own cross-reference
                idx, dat = idx[mask], dat[mask]
            if len(idx) > TOP_K:
                sel = np.argpartition(-dat, TOP_K)[:TOP_K]
                idx, dat = idx[sel], dat[sel]
            order = np.argsort(-dat)
            idx, dat = idx[order], dat[order]
            if len(dat):
                # quantise to a byte, relative to this verse's best neighbour
                q = np.maximum(1, np.round(255.0 * dat / dat[0])).astype(np.uint8)
            else:
                q = np.array([], dtype=np.uint8)
            all_targets.append(idx.astype(np.uint32))
            all_weights.append(q)
            offsets[i + 1] = offsets[i] + len(idx)
        if start % (BLOCK * 4) == 0:
            log(f"    walked {end}/{n}")

    targets = np.concatenate(all_targets) if all_targets else np.array([], np.uint32)
    weights = np.concatenate(all_weights) if all_weights else np.array([], np.uint8)

    path = os.path.join(OUT, "concept-graph.bin")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"CNG1")
        f.write(struct.pack("<II", TOP_K, n))
        f.write(offsets.astype("<u4").tobytes())
        f.write(targets.astype("<u4").tobytes())
        f.write(weights.tobytes())

    covered = int((np.diff(offsets) > 0).sum())
    log(f"  {len(targets)} neighbour links, {covered}/{n} verses covered "
        f"({covered/n:.1%}), mean {len(targets)/max(covered,1):.1f} each")
    log(f"  concept-graph.bin {human(os.path.getsize(path))}")


if __name__ == "__main__":
    build()
