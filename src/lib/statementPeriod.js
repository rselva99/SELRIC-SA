// Statement anchor-period detection. Bank statements always carry their
// own period somewhere in the header text — but Claude's date extraction
// sometimes drifts to the wrong year for entries that show only month/day,
// because the model has no other anchor to ground them. Solving the drift
// upstream means feeding the anchor explicitly into the extraction prompt
// AND validating extracted dates against it after the fact.
//
// Detection order used by the uploader:
//   1. Scan the first ~3 KB of extracted PDF text for a date-range header.
//   2. Fall back to parsing the filename (Dec-24.pdf, Oct 2024.pdf, etc.).
//   3. Last resort: ask the user via a small modal.

const MONTH_NAMES = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTH_ABBR  = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

function pad(n)                   { return String(n).padStart(2, '0'); }
function isoDate(y, m, d)         { return `${y}-${pad(m + 1)}-${pad(d)}`; }
function lastDayOfMonth(year, m)  { return new Date(year, m + 1, 0).getDate(); }

function monthIndexFromName(name) {
  const lc = String(name || '').toLowerCase();
  const long = MONTH_NAMES.indexOf(lc);
  if (long >= 0) return long;
  const short = MONTH_ABBR.indexOf(lc.slice(0, 3));
  return short >= 0 ? short : -1;
}

function expandYear(y) {
  const n = Number(y);
  if (Number.isNaN(n)) return null;
  if (n >= 100) return n;
  // Two-digit years: assume 20xx for 00-79, 19xx for 80-99 (bank PDFs
  // never reference dates that far back in practice).
  return n + (n < 80 ? 2000 : 1900);
}

// First-page text scanner. We try a few well-known statement-header
// patterns. Order matters — longer/more specific patterns first.
export function parseStatementPeriodFromText(text) {
  if (!text) return null;
  const head = text.slice(0, 3000);

  // "December 1, 2024 - December 31, 2024" / "December 1 2024 to December 31 2024"
  const wordRange = new RegExp(
    `(${MONTH_NAMES.concat(MONTH_ABBR).join('|')})\\.?\\s+(\\d{1,2}),?\\s+(\\d{2,4})\\s*(?:-|–|to|through)\\s*(${MONTH_NAMES.concat(MONTH_ABBR).join('|')})\\.?\\s+(\\d{1,2}),?\\s+(\\d{2,4})`,
    'i',
  );
  const w = head.match(wordRange);
  if (w) {
    const sm = monthIndexFromName(w[1]); const sd = +w[2]; const sy = expandYear(w[3]);
    const em = monthIndexFromName(w[4]); const ed = +w[5]; const ey = expandYear(w[6]);
    if (sm >= 0 && em >= 0 && sy && ey) {
      return { start: isoDate(sy, sm, sd), end: isoDate(ey, em, ed), source: 'pdf-header' };
    }
  }

  // "12/01/2024 - 12/31/2024" / "12/01/24-12/31/24"
  const numRange = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(?:-|–|to|through)\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/;
  const n = head.match(numRange);
  if (n) {
    const sm = +n[1] - 1; const sd = +n[2]; const sy = expandYear(n[3]);
    const em = +n[4] - 1; const ed = +n[5]; const ey = expandYear(n[6]);
    if (sm >= 0 && em >= 0 && sy && ey) {
      return { start: isoDate(sy, sm, sd), end: isoDate(ey, em, ed), source: 'pdf-header' };
    }
  }

  // Single "Statement Date: December 31, 2024" → take the month, span full month.
  const singleEnd = head.match(new RegExp(
    `(?:statement\\s+date|as\\s+of|closing\\s+date)[^\\d]{0,30}(${MONTH_NAMES.concat(MONTH_ABBR).join('|')})\\.?\\s+(\\d{1,2}),?\\s+(\\d{2,4})`,
    'i',
  ));
  if (singleEnd) {
    const m = monthIndexFromName(singleEnd[1]);
    const y = expandYear(singleEnd[3]);
    if (m >= 0 && y) {
      return { start: isoDate(y, m, 1), end: isoDate(y, m, lastDayOfMonth(y, m)), source: 'pdf-header' };
    }
  }

  return null;
}

// "Dec-24.pdf", "December 2024.pdf", "Reprint Oct-24.pdf", "10-2024.pdf"
export function parseStatementPeriodFromFilename(filename) {
  if (!filename) return null;
  const stem = filename.replace(/\.[^.]+$/, '');

  // Month-name + year: "Dec 24", "December-2024", "Reprint Oct_24"
  const nameY = stem.match(new RegExp(`\\b(${MONTH_NAMES.concat(MONTH_ABBR).join('|')})\\b[\\s\\-_]*['(]?(\\d{2,4})\\)?`, 'i'));
  if (nameY) {
    const m = monthIndexFromName(nameY[1]);
    const y = expandYear(nameY[2]);
    if (m >= 0 && y) {
      return { start: isoDate(y, m, 1), end: isoDate(y, m, lastDayOfMonth(y, m)), source: 'filename' };
    }
  }

  // Numeric month + year: "10-2024", "10_24", "2024-10"
  const numY = stem.match(/(\d{1,2})[\s\-_./](\d{2,4})|(\d{4})[\s\-_./](\d{1,2})/);
  if (numY) {
    let m, y;
    if (numY[1]) { m = +numY[1] - 1; y = expandYear(numY[2]); }
    else         { y = +numY[3];     m = +numY[4] - 1; }
    if (m >= 0 && m <= 11 && y) {
      return { start: isoDate(y, m, 1), end: isoDate(y, m, lastDayOfMonth(y, m)), source: 'filename' };
    }
  }

  return null;
}

// Returns the rows of `transactions` whose `date` falls more than
// `toleranceDays` outside [anchor.start, anchor.end].
export function findOutOfAnchorDates(transactions, anchor, toleranceDays = 15) {
  if (!anchor) return [];
  const ms = (s) => new Date(s + 'T00:00:00').getTime();
  const start = ms(anchor.start) - toleranceDays * 86400_000;
  const end   = ms(anchor.end)   + toleranceDays * 86400_000;
  return (transactions || []).filter(t => {
    if (!t?.date || !/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return false;
    const v = ms(t.date);
    return v < start || v > end;
  });
}

// Shift only the year of each out-of-range date toward the anchor, by
// the smallest number of whole years that drops it inside the anchor's
// full calendar year. Month/day are preserved. Used as the one-click
// "shift year to match period" remediation in the upload sanity gate.
export function shiftDateYearTowardAnchor(dateStr, anchor) {
  if (!anchor || !dateStr) return dateStr;
  const target = new Date(anchor.start + 'T00:00:00').getFullYear();
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  return `${target}-${pad(m)}-${pad(d)}`;
}

export function shiftOutOfAnchorTransactionDates(transactions, anchor, toleranceDays = 15) {
  const bad = new Set(findOutOfAnchorDates(transactions, anchor, toleranceDays).map(t => t.date));
  if (bad.size === 0) return { transactions, shifted: 0 };
  let shifted = 0;
  const next = transactions.map(t => {
    if (!bad.has(t.date)) return t;
    const newDate = shiftDateYearTowardAnchor(t.date, anchor);
    if (newDate !== t.date) shifted++;
    return { ...t, date: newDate };
  });
  return { transactions: next, shifted };
}
