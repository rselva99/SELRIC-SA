import { defineConfig } from 'vitest/config';

// Unit tests for the pure engines in src/lib. They run under node: the
// engines hold no DOM or React code. Suites that need the confidential golden
// fixture load it from outside the repository (see tests/helpers/private.js)
// and skip where it is not present.
//
// `npm run test` measures coverage of the money paths — the report PDFs and
// the aggregation they print, the posting helpers, opening balances, the
// period lock and the integrity checks — and fails when a file drops below
// its floor. The floors sit a little under what the suites reach today, so a
// new branch without a test shows up; the summary is in coverage/ (ignored).
const MONEY = [
  'src/lib/reports.js', 'src/lib/finance.js', 'src/lib/postJournalEntry.js', 'src/lib/journalReference.js',
  'src/lib/openingBalances.js', 'src/lib/periodLock.js', 'src/lib/checks/**/*.js',
];

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    reporters: ['default'],
    coverage: {
      provider: 'v8',
      include: MONEY,
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: 'coverage',
      // reports.js stays lower: about a fifth of it is the three auditor-package
      // pages kept, unused, so the trim can be reverted (see the file).
      thresholds: {
        'src/lib/postJournalEntry.js': { lines: 95, branches: 90, functions: 100 },
        'src/lib/journalReference.js': { lines: 95, branches: 90, functions: 100 },
        'src/lib/periodLock.js': { lines: 95, branches: 80, functions: 100 },
        'src/lib/openingBalances.js': { lines: 95, branches: 80, functions: 100 },
        'src/lib/finance.js': { lines: 90, branches: 70, functions: 70 },
        'src/lib/reports.js': { lines: 70, branches: 65, functions: 85 },
        'src/lib/checks/**/*.js': { lines: 90, branches: 75, functions: 90 },
      },
    },
  },
});
