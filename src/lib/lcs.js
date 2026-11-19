/**
 * Longest-common-subsequence diff of two sequences.
 *
 * Returns a list of operations in order:
 *   { type: 'equal', a, b } | { type: 'delete', a } | { type: 'insert', b }
 * where `a` and `b` are indexes into the two input arrays.
 *
 * Common prefix and suffix are trimmed first, so typical edits stay cheap.
 * If the remaining middle part exceeds `maxCells` DP cells, it is reported
 * as a full replacement instead of computing an exact LCS, and the returned
 * array has `approximate = true`.
 */
export function diffSequences(a, b, maxCells = 4_000_000) {
  const ops = [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  for (let i = 0; i < start; i++) ops.push({ type: 'equal', a: i, b: i });

  const n = endA - start;
  const m = endB - start;
  if (n * m > maxCells) {
    ops.approximate = true;
    for (let i = start; i < endA; i++) ops.push({ type: 'delete', a: i });
    for (let j = start; j < endB; j++) ops.push({ type: 'insert', b: j });
  } else if (n > 0 || m > 0) {
    // dp[i * w + j] = LCS length of a[start+i..endA) and b[start+j..endB)
    const w = m + 1;
    const dp = new Uint32Array((n + 1) * w);
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i * w + j] =
          a[start + i] === b[start + j]
            ? dp[(i + 1) * w + j + 1] + 1
            : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        ops.push({ type: 'equal', a: start + i, b: start + j });
        i++;
        j++;
      } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
        ops.push({ type: 'delete', a: start + i });
        i++;
      } else {
        ops.push({ type: 'insert', b: start + j });
        j++;
      }
    }
    while (i < n) ops.push({ type: 'delete', a: start + i++ });
    while (j < m) ops.push({ type: 'insert', b: start + j++ });
  }

  for (let k = 0; k < a.length - endA; k++) {
    ops.push({ type: 'equal', a: endA + k, b: endB + k });
  }
  return ops;
}
