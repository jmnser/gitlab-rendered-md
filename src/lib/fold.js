/**
 * Decides which top-level blocks of a rendered diff stay visible when only
 * the context around changes is shown.
 *
 * items: [{ changed, span, heading, keep }]
 *   changed  the block is added, removed or contains changes
 *   span     number of source lines of the block
 *   heading  the block is a heading
 *   keep     the block must stay visible (e.g. it carries a comment thread)
 * context: number of unchanged source lines to show on each side of a change;
 *   0 or less shows everything.
 *
 * An unchanged block is shown when it and the unchanged blocks between it and
 * the nearest change span at most `context` lines. The first neighbour of a
 * change is always shown whole, however long. The nearest heading above each
 * change is also kept.
 *
 * Returns one boolean per item: true when visible.
 */
export function foldPlan(items, context) {
  if (context <= 0 || !items.some((i) => i.changed)) return items.map(() => true);
  const visible = items.map((i) => i.changed || i.keep);

  const sweep = (indexes) => {
    let distance = Infinity;
    for (const i of indexes) {
      if (items[i].changed) {
        distance = 0;
        continue;
      }
      if (distance === 0 || distance + items[i].span <= context) visible[i] = true;
      distance += Math.max(1, items[i].span);
    }
  };
  const order = items.map((_, i) => i);
  sweep(order);
  sweep(order.reverse());

  items.forEach((item, i) => {
    if (!item.changed) return;
    for (let j = i - 1; j >= 0; j--) {
      if (items[j].heading) {
        visible[j] = true;
        break;
      }
    }
  });
  return visible;
}
