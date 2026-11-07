// Every event belongs to an animal of this workspace. The database ties each
// event to a card and deletes it with the card, so an event left over is the
// remains of a half-finished delete or points at a card the workspace cannot
// see — either way it is counted on no animal's timeline.
import { result, row, skip } from '../util.js';

export const key = 'herd_orphan_events';
export const severity = 'red';

export function run(data) {
  const events = data.events || [];
  if (!events.length) return skip('no_events');
  const ids = new Set((data.animals || []).map((a) => a.id));
  const rows = [];
  for (const e of events) {
    if (ids.has(e.animal_id)) continue;
    rows.push(row(e.id, e.date, `${e.type} event without an animal`, 0, { kind: 'orphan', type: e.type }));
  }
  return result(severity, { rows: rows.sort((x, y) => String(y.date).localeCompare(String(x.date))) });
}
