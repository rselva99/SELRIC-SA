// Book-Structured Balance Sheet — section skeleton + seed line titles.
//
// The L-code SECTIONS and HEADERS below are the canonical structure of the
// firm's book balance sheet, taken from docs/balance_sheet_design.pdf. Only
// the structural shape is reproduced here — no dollar values, no account
// numbers — per the user's instruction to use the headers as scaffolding
// and map our real chart-of-accounts categories underneath.
//
// SEED_LINE_TITLES are the line names the "Add Year" flow uses to populate a
// new year's book_bs_lines rows. The user can rename, delete, or add freely
// once a year is created. Titles only — no $ figures, no account numbers.

// Group → asset / liability / equity. Contra flag is true when the line
// SUBTRACTS from its group's running total (accumulated depreciation,
// member distributions / draws).
export const BOOK_BS_STRUCTURE = [
  // Assets
  { code: 'L01',   title: 'Cash',                                   group: 'asset',     contra: false },
  { code: 'L03',   title: 'Inventories',                            group: 'asset',     contra: false },
  { code: 'L09A',  title: 'Buildings & Other Depreciable Assets',   group: 'asset',     contra: false },
  { code: 'L09B',  title: 'Less: Accumulated Depreciation (L09)',   group: 'asset',     contra: true  },
  { code: 'L12A',  title: 'Intangible Assets',                      group: 'asset',     contra: false },
  { code: 'L12B',  title: 'Less: Accumulated Depreciation (L12)',   group: 'asset',     contra: true  },

  // Liabilities
  { code: 'L15',   title: 'Accounts Payable',                       group: 'liability', contra: false },
  { code: 'L17',   title: 'Other Current Liabilities',              group: 'liability', contra: false },
  { code: 'L20A',  title: 'Notes / Loan Payable',                   group: 'liability', contra: false },
  { code: 'L20B',  title: 'Due to Partners',                        group: 'liability', contra: false },

  // Equity
  { code: 'L21',   title: 'Partners Capital Accounts',              group: 'equity',    contra: false },
  { code: 'M202',  title: 'Capital Contributed',                    group: 'equity',    contra: false },
  { code: 'M206A', title: 'Distributions',                          group: 'equity',    contra: true  },
];

// Lookup helpers — used by the page stub now, and by Stages 2–4 for renders.
const STRUCTURE_BY_CODE = new Map(BOOK_BS_STRUCTURE.map(s => [s.code, s]));
export function bookSectionByCode(code) { return STRUCTURE_BY_CODE.get(code) || null; }

const GROUP_ORDER = { asset: 1, liability: 2, equity: 3 };
export function bookGroupOrder(group) { return GROUP_ORDER[group] || 99; }

export function bookGroupLabel(group) {
  if (group === 'asset')     return 'Assets';
  if (group === 'liability') return 'Liabilities';
  if (group === 'equity')    return 'Equity';
  return group || '';
}

// Seed line titles per section. Pulled from the design PDF's line-item rows
// with the leading account numbers and dollar values stripped. The user can
// rename / delete / add lines after seeding. Display order is the order of
// the array within each section.
export const SEED_LINE_TITLES = {
  L01: [
    'Petty Cash',
    'Regions Banking',
  ],
  L03: [
    'Inventory — Beer, Wine, Liquor',
    'Keg Deposits',
    'Inventory — Food',
    'Inventory — NA Beverage',
    'Merchandise Inventory',
  ],
  L09A: [
    'Construction Costs',
    'Kitchen Equipment',
    'Light and Sound',
    'Patio',
    'POS Hardware — Spoton',
    'Additional LHI from John and Sarah',
    'Additional LHI from DWC',
    'Restaurant Equipment 7 Year',
    'Restaurant Equipment 5 Year',
    'Restaurant Improvements — 15 Year',
    'Miscellaneous Repairs & Additions — 2 Years',
  ],
  L09B: [
    'Accumulated Depreciation',
    'Dispositions',
  ],
  L12A: [
    'Start-Up Costs',
  ],
  L12B: [
    'Accumulated Depreciation',
  ],
  L15: [
    'Comenity Bank Credit Card',
    'Great Southern Bank Credit Card',
    'AMEX',
    'Ikea',
  ],
  L17: [
    'Gift Card Liability',
    'Meridian Payments',
    'Sales Tax Payable',
    'Tips Payable',
    'Credit Card Tips Paid',
    'Credit Card Tips Received',
  ],
  L20A: [
    'Loan Payable — POS System',
    'Loan Payable — Great Southern Bank',
    'Loan — Spoton',
  ],
  L20B: [
    'Due to Dan Miles',
  ],
  L21: [
    'Retained Earnings',
    'Member Investment — DW Clayton',
    'Member Investment — Dan Miles',
    'Member Investment — J. Harris',
    'Member Investment — Travis Ford',
    'Member Investment — S. Harris',
  ],
  M202: [
    'Member Contributions — DW Clayton',
    'Member Contributions — Dan Miles',
    'Member Contributions — J. Harris',
    'Member Contributions — S. Harris',
  ],
  M206A: [
    'Member Draw — J. Harris',
    'Member Draw — S. Harris',
  ],
};

// Build the full list of seeded rows for a new year. The "Add Year" flow
// in BookBalanceSheetPage.jsx feeds this into a single Supabase insert.
// display_order is set per section: 10, 20, 30… so the user can insert
// new lines between seeded ones without renumbering.
export function buildSeedLinesForYear(year) {
  const rows = [];
  for (const section of BOOK_BS_STRUCTURE) {
    const titles = SEED_LINE_TITLES[section.code] || [];
    titles.forEach((title, idx) => {
      rows.push({
        year,
        section_code: section.code,
        title,
        display_order: (idx + 1) * 10,
        beginning_balance: 0,
        ending_balance_confirmed: null,
      });
    });
  }
  return rows;
}
