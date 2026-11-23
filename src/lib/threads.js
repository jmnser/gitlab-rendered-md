/**
 * Selects the diff discussions of one file at the given MR version and
 * returns them as `{ side, line, discussion }`.
 */
export function fileThreads(discussions, file, headSha) {
  const out = [];
  for (const discussion of discussions) {
    const first = discussion.notes?.[0];
    const p = first?.position;
    if (!p || first.system || p.position_type !== 'text') continue;
    if (p.head_sha !== headSha) continue;
    if (p.new_path !== file.new_path && p.old_path !== file.old_path) continue;
    if (p.new_line != null) out.push({ side: 'new', line: p.new_line, discussion });
    else if (p.old_line != null) out.push({ side: 'old', line: p.old_line, discussion });
  }
  return out;
}
