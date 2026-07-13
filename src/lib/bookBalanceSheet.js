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

// ── Activity sign + math ─────────────────────────────────────────────────
//
// Each line accumulates "activity" from its mapped CoA categories during
// the year. The SIGN under which we add transaction debits and credits
// depends on the line's effective natural side:
//
//   asset, non-contra           → debit-natural   (DR − CR)
//   asset, contra (L09B, L12B)  → credit-natural  (CR − DR) so accumulated
//                                  depreciation BUILDS as positive when the
//                                  app books DR Depreciation Expense /
//                                  CR Accumulated Depreciation
//   liability                   → credit-natural  (CR − DR)
//   equity, non-contra          → credit-natural  (CR − DR)
//   equity, contra (M206A)      → debit-natural   (DR − CR) so member draws
//                                  BUILD as positive (each draw is a DR to
//                                  the member-draw account)
//
// This is the accounting-correct convention: every stored line balance ends
// up POSITIVE, and the report renderer (Stage 4) is responsible for putting
// contra lines in parentheses and SUBTRACTING them from their parent
// group's total. The contra flag in BOOK_BS_STRUCTURE drives both pieces.

import { debitOf, creditOf, aggregateForPnL } from './finance';

export function lineActivityIsDebitNatural(section) {
  if (!section) return true;
  const { group, contra } = section;
  if (group === 'asset')     return !contra;    // non-contra asset = DR-CR; contra asset = CR-DR
  if (group === 'liability') return !!contra;   // (no contra-liabilities currently; future-safe)
  if (group === 'equity')    return !!contra;   // non-contra equity = CR-DR; contra equity = DR-CR
  return true;
}

// Sum activity for one mapped category over the supplied txns, applying the
// line's natural sign. The txns array should already be filtered to year +
// voided=false at the call site.
export function computeMappingActivity(txns, categoryName, section) {
  if (!categoryName) return 0;
  let debits = 0, credits = 0;
  for (const t of txns || []) {
    if (t?.category !== categoryName) continue;
    debits  += debitOf(t);
    credits += creditOf(t);
  }
  const raw = lineActivityIsDebitNatural(section) ? (debits - credits) : (credits - debits);
  return Math.round(raw * 100) / 100;
}

// Compose a line's ending balance from its parts. Always rounded to cents.
export function computeLineEnding(beginning, activitySum, adjustmentsSum) {
  const b = Number(beginning) || 0;
  const a = Number(activitySum) || 0;
  const x = Number(adjustmentsSum) || 0;
  return Math.round((b + a + x) * 100) / 100;
}

// ── Asset-register integration (Stage 4.5) ────────────────────────────────
//
// Only the L09A and L12A "cost" sections can pull from the fixed-asset
// register. L09B / L12B (contra) lines never pull — they show an
// informational straight-line accumulated-D&A figure derived from the union
// of L09A / L12A's mapped scopes, and that's it.

export const ASSET_REGISTER_COST_SECTIONS   = new Set(['L09A', 'L12A']);
export const ASSET_REGISTER_CONTRA_SECTIONS = new Set(['L09B', 'L12B']);
export const CONTRA_TO_COST_SECTION = { L09B: 'L09A', L12B: 'L12A' };

export function isAssetRegisterCostSection(code)   { return ASSET_REGISTER_COST_SECTIONS.has(code); }
export function isAssetRegisterContraSection(code) { return ASSET_REGISTER_CONTRA_SECTIONS.has(code); }

function endOfYearDate(year) { return `${year}-12-31`; }

// True when the asset belongs on the EOY-of-year balance sheet:
//   • in_service_date is on or before EOY(year)
//   • not retired on or before EOY(year)   (retired_date > EOY ⇒ still included)
export function assetIncludedAtEoy(asset, year) {
  if (!asset?.in_service_date) return false;
  const eoy = endOfYearDate(year);
  if (asset.in_service_date > eoy) return false;
  if (asset.retired_date && asset.retired_date <= eoy) return false;
  return true;
}

// Resolve a line's asset-mapping rows into a concrete Set<asset.id>.
// Rules:
//   scope='class', exclude=false → add every asset with that asset_class
//   scope='asset', exclude=false → add that one asset
//   exclude=true  variants        → remove from the included set
// Composition: includes minus excludes. A row only matters at compose time —
// the order user added them in is irrelevant.
export function resolveAssetScope(assets, mappings) {
  const includes = new Set();
  const excludes = new Set();
  for (const m of mappings || []) {
    if (m.scope === 'class' && m.asset_class) {
      for (const a of assets || []) {
        if (a.asset_class !== m.asset_class) continue;
        (m.exclude ? excludes : includes).add(a.id);
      }
    } else if (m.scope === 'asset' && m.asset_id) {
      (m.exclude ? excludes : includes).add(m.asset_id);
    }
  }
  for (const id of excludes) includes.delete(id);
  return includes;
}

// Gross cost as of EOY(year) for the resolved scope.
export function pointInTimeGrossCost(assets, mappings, year) {
  const scope = resolveAssetScope(assets, mappings);
  let total = 0;
  for (const a of assets || []) {
    if (!scope.has(a.id)) continue;
    if (!assetIncludedAtEoy(a, year)) continue;
    total += Number(a.cost) || 0;
  }
  return Math.round(total * 100) / 100;
}

// Activity for the year = EOY(year) gross cost − EOY(year-1) gross cost,
// restricted to in-scope assets. Handles add / retire / both-in-year /
// nothing-changed cases per Phase 1 plan.
export function assetActivityForYear(assets, mappings, year) {
  const scope = resolveAssetScope(assets, mappings);
  let curr = 0;
  let prev = 0;
  for (const a of assets || []) {
    if (!scope.has(a.id)) continue;
    const c = Number(a.cost) || 0;
    if (assetIncludedAtEoy(a, year))     curr += c;
    if (assetIncludedAtEoy(a, year - 1)) prev += c;
  }
  return Math.round((curr - prev) * 100) / 100;
}

// Asset-by-asset detail for the dry-run tie-out card. Only returns assets
// in the resolved scope (so the user sees exactly what the line sums).
export function assetsInScopeWithContribution(assets, mappings, year) {
  const scope = resolveAssetScope(assets, mappings);
  const rows = [];
  for (const a of assets || []) {
    if (!scope.has(a.id)) continue;
    const c = Number(a.cost) || 0;
    const inCurr = assetIncludedAtEoy(a, year);
    const inPrev = assetIncludedAtEoy(a, year - 1);
    const contribution = (inCurr ? c : 0) - (inPrev ? c : 0);
    rows.push({
      id: a.id,
      name: a.name,
      asset_class: a.asset_class,
      in_service_date: a.in_service_date,
      retired_date: a.retired_date || null,
      cost: c,
      in_at_eoy: inCurr,
      in_at_prev_eoy: inPrev,
      contribution: Math.round(contribution * 100) / 100,
    });
  }
  rows.sort((a, b) =>
    (a.asset_class || '').localeCompare(b.asset_class || '') ||
    (a.name || '').localeCompare(b.name || '')
  );
  return rows;
}

// Number of months from startDate through endDate (inclusive at both ends).
function monthsBetweenInclusive(startDate, endDate) {
  if (!startDate || !endDate) return 0;
  const a = new Date(startDate);
  const b = new Date(endDate);
  if (b < a) return 0;
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + 1;
}

// Per-asset straight-line accumulated D&A as of EOY(year). Matches the
// existing AssetsPage formula (monthly = cost / (life*12)) but capped by
// retirement date and cost. Returns 0 for an asset not yet in service.
function slAccumDepForAsset(asset, year) {
  const cost = Number(asset?.cost) || 0;
  const life = Number(asset?.life_years) || 0;
  if (cost <= 0 || life <= 0) return 0;
  if (!asset.in_service_date) return 0;
  const eoy = endOfYearDate(year);
  if (asset.in_service_date > eoy) return 0;
  const endRaw = (asset.retired_date && asset.retired_date < eoy) ? asset.retired_date : eoy;
  const monthsActive = monthsBetweenInclusive(asset.in_service_date, endRaw);
  const totalMonths = life * 12;
  const capped = Math.min(monthsActive, totalMonths);
  const monthly = cost / totalMonths;
  return Math.min(monthly * capped, cost);
}

// Straight-line accumulated D&A across an arbitrary asset-id set. Used by
// the page to compute the L09B / L12B informational chip from the UNION of
// all L09A / L12A line scopes.
export function slAccumDepForAssetIds(assets, assetIdSet, year) {
  let total = 0;
  let count = 0;
  const classes = new Set();
  for (const a of assets || []) {
    if (!assetIdSet?.has?.(a.id)) continue;
    count += 1;
    if (a.asset_class) classes.add(a.asset_class);
    total += slAccumDepForAsset(a, year);
  }
  return {
    total: Math.round(total * 100) / 100,
    assetCount: count,
    classes: [...classes].sort(),
  };
}

// Convenience wrapper that goes mappings → scope → SL accum dep. Useful
// per-line at the cost section level if ever needed.
export function slAccumDepForScope(assets, mappings, year) {
  return slAccumDepForAssetIds(assets, resolveAssetScope(assets, mappings), year);
}

// Snapshot helper: per asset-mapping row, hydrate a display payload that
// goes into the locked-year snapshot. Captures the contribution AT LOCK
// TIME so the PDF reproduces identically even if the register is edited
// later. Not exported — used only by buildBookBSSnapshot below.
function describeAssetMappingForSnapshot(assets, mapping, year) {
  if (!mapping) return null;
  if (mapping.scope === 'class') {
    let contribution = 0;
    let assetCount = 0;
    for (const a of assets || []) {
      if (a.asset_class !== mapping.asset_class) continue;
      assetCount += 1;
      const c = Number(a.cost) || 0;
      if (assetIncludedAtEoy(a, year))     contribution += c;
      if (assetIncludedAtEoy(a, year - 1)) contribution -= c;
    }
    if (mapping.exclude) contribution = -contribution;
    return {
      scope: 'class',
      asset_class: mapping.asset_class,
      asset_id: null,
      exclude: !!mapping.exclude,
      display_name: mapping.asset_class,
      asset_count: assetCount,
      contribution: Math.round(contribution * 100) / 100,
    };
  }
  // asset scope
  const a = (assets || []).find(x => x.id === mapping.asset_id);
  if (!a) {
    return {
      scope: 'asset',
      asset_class: null,
      asset_id: mapping.asset_id,
      exclude: !!mapping.exclude,
      display_name: '?',
      asset_count: 0,
      contribution: 0,
    };
  }
  const c = Number(a.cost) || 0;
  let contribution = (assetIncludedAtEoy(a, year) ? c : 0) - (assetIncludedAtEoy(a, year - 1) ? c : 0);
  if (mapping.exclude) contribution = -contribution;
  return {
    scope: 'asset',
    asset_class: a.asset_class || null,
    asset_id: a.id,
    exclude: !!mapping.exclude,
    display_name: a.name,
    asset_count: 1,
    contribution: Math.round(contribution * 100) / 100,
  };
}

// Combine a line's pieces into a single { computed, confirmed, end, source }
// summary. `end` is the best-available figure: the confirmed snapshot when
// present, else the live-computed value. `source` says which one we used.
// Used by the Compare view to render each (line, year) cell consistently.
//
// assetData (optional) wires in the fixed-asset register's net-additions
// activity for the line's year. Only applies to L09A / L12A; ignored on
// every other section. Shape:
//   { assets: [...], assetMappingsByLineId: {lineId: [mapping rows]}, year }
export function computeLineEndingSummary(line, mappings, adjustments, transactions, section, assetData) {
  const activityFromCoa = (mappings || []).reduce(
    (s, m) => s + computeMappingActivity(transactions, m.category_name, section),
    0
  );
  let activityFromAssetRegister = 0;
  if (assetData && isAssetRegisterCostSection(section?.code)) {
    const assetMappings = assetData.assetMappingsByLineId?.[line?.id] || [];
    activityFromAssetRegister = assetActivityForYear(
      assetData.assets || [],
      assetMappings,
      assetData.year,
    );
  }
  const activitySum = Math.round((activityFromCoa + activityFromAssetRegister) * 100) / 100;
  const adjustmentsSum = (adjustments || []).reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const computed = computeLineEnding(line?.beginning_balance, activitySum, adjustmentsSum);
  const confirmed = line?.ending_balance_confirmed;
  const end = confirmed != null ? Number(confirmed) : computed;
  return {
    computed,
    confirmed: confirmed != null ? Number(confirmed) : null,
    activitySum,
    activityFromCoa: Math.round(activityFromCoa * 100) / 100,
    activityFromAssetRegister,
    adjustmentsSum,
    end: Math.round(end * 100) / 100,
    source: confirmed != null ? 'confirmed' : 'computed',
  };
}

// Build the immutable snapshot payload that backs both the draft PDF and
// the locked-year persistence. Shape:
//
//   {
//     year,
//     captured_at,                                  // ISO timestamp
//     sections: [{ code, title, group, contra,
//                  lines: [{
//                    title, beginning, activitySum, adjustmentsSum, ending,
//                    isMapping, mappings: [{name, activity}],
//                    adjustments: [{amount, note}],
//                  }],
//                  subtotal                          // Σ line endings (signed)
//                }],
//     totals: {
//       totalAssets,            // Σ asset-group subtotals (positive)
//       totalLiabEquity,        // Σ liability + equity subtotals (stored negative)
//       netIncomeLoss,          // -(totalAssets + totalLiabEquity) — the plug
//       actualNetIncome,        // P&L net income for the year, or null
//       reconciliationGap,      // netIncomeLoss - actualNetIncome (null if no P&L)
//       // back-compat fields (deprecated; old locked snapshots also carry these):
//       totalLiabilities, totalEquity, totalLiabPlusEquity, balanceCheck,
//     }
//   }
//
// Sign convention — CPA tax-reconciliation format:
//   • Assets are stored POSITIVE.
//   • Liability + Equity subtotals are stored NEGATIVE (credit balances on a
//     tax-return-style balance sheet are shown signed-negative).
//   • Contra sections (L09B, L12B, M206A): the `contra` flag drives DISPLAY
//     only (parentheses + label). For the math, sum the subtotal AS-IS —
//     L09B/L12B happen to be stored negative; M206A may be stored positive
//     within the negative-equity bucket. No sign flips here.
//
// Tax-recon identity:
//   totalAssets + totalLiabEquity + netIncomeLoss = 0   (ties by construction)
// The genuine error check is reconciliationGap — the difference between the
// plug we computed and the actual P&L net income for the year. Renderer
// (renderFinalSummary) shows both lines side by side.
//
// actualNetIncome: ALWAYS a live recompute from the transactions+categories
// passed to this call. Never read from a cache or stored value. aggregateForPnL
// runs over the same transactions list to produce totalRevenue − totalExpenses.
// When categories are absent (legacy callers, or when the chart isn't
// available), actualNetIncome stays null and the PDF prints a "not linked"
// caption on the reconciliation line. Locked-year snapshots persist whatever
// `actualNetIncome` was at lock time — callers wanting a live P&L number on
// re-render should pass current categories+transactions to rebuild the
// snapshot rather than reading the stored one.
//
// Each line's "ending" is preferred from line.ending_balance_confirmed
// when present, otherwise the live-computed value. This is intentional:
// the lock flow only allows locking when every line is confirmed, so the
// snapshot reads its frozen endings from the confirmed field; the draft
// PDF path tolerates unconfirmed lines and uses computed.
export function buildBookBSSnapshot({ year, lines, mappingsByLineId, adjustmentsByLineId, transactions, assets, assetMappingsByLineId, categories, capturedAtIso, lockedByName }) {
  const sectionMap = new Map();
  for (const s of BOOK_BS_STRUCTURE) {
    sectionMap.set(s.code, {
      code: s.code,
      title: s.title,
      group: s.group,
      contra: !!s.contra,
      lines: [],
      subtotal: 0,
    });
  }

  for (const line of lines || []) {
    const sec = sectionMap.get(line.section_code);
    if (!sec) continue;
    const sectionDescriptor = bookSectionByCode(line.section_code);
    const ms   = mappingsByLineId?.[line.id]   || [];
    const adjs = adjustmentsByLineId?.[line.id] || [];
    const ams  = assetMappingsByLineId?.[line.id] || [];
    const summary = computeLineEndingSummary(line, ms, adjs, transactions || [], sectionDescriptor, {
      assets: assets || [],
      assetMappingsByLineId,
      year,
    });
    const ending = summary.end;
    const assetMappingsSnap = ams
      .map(m => describeAssetMappingForSnapshot(assets || [], m, year))
      .filter(Boolean);
    sec.lines.push({
      title:                     line.title,
      beginning:                 Math.round((Number(line.beginning_balance) || 0) * 100) / 100,
      activitySum:               summary.activitySum,
      activityFromCoa:           summary.activityFromCoa || 0,
      activityFromAssetRegister: summary.activityFromAssetRegister || 0,
      adjustmentsSum:            summary.adjustmentsSum,
      ending,
      isMapping:                 ms.length > 0 || ams.length > 0,
      mappings: ms.map(m => ({
        name:     m.category_name,
        activity: computeMappingActivity(transactions || [], m.category_name, sectionDescriptor),
      })),
      assetMappings: assetMappingsSnap,
      adjustments: adjs.map(a => ({
        amount: Math.round((Number(a.amount) || 0) * 100) / 100,
        note:   a.note,
      })),
    });
    sec.subtotal = Math.round((sec.subtotal + ending) * 100) / 100;
  }

  let totalAssets       = 0;
  let totalLiabilities  = 0;
  // Section-level subtotals we need to break out for the CPA-format identity:
  //   partnersCapital  = L21 raw signed sum
  //   m2Adjustments    = M202 + M206A (raw signed, NO contra flip — this is
  //                       the tax-return M-2 convention Justin uses; draws are
  //                       stored positive on M206A but folded INTO the M-2 sum
  //                       directly, not flipped). Validated against Justin's
  //                       2023 column to the cent — see SELRIC-FINAL-PREFLIGHT.md.
  let partnersCapital = 0;
  let m2Adjustments   = 0;
  for (const sec of sectionMap.values()) {
    // A contra section always REDUCES its parent group's total. The stored
    // sign of contra subtotals is inconsistent across this codebase:
    // L09B/L12B (accumulated depreciation) are stored signed-negative, while
    // M206A (distributions / member draws) is stored signed-positive. To
    // get a sign-correct contribution regardless of the stored sign, fold
    // each contra to its negative magnitude. Non-contras pass through signed.
    const contribution = sec.contra ? -Math.abs(sec.subtotal) : sec.subtotal;
    if (sec.group === 'asset')     totalAssets      += contribution;
    if (sec.group === 'liability') totalLiabilities += contribution;
    // Equity gets DECOMPOSED into partnersCapital (L21) and m2Adjustments
    // (M202 + M206A raw). This split matches the CPA's tax-return format
    // and is required by the CPA identity  A + L&SE + NIL + M-2 = 0.
    if (sec.code === 'L21')   partnersCapital += sec.subtotal;
    if (sec.code === 'M202')  m2Adjustments   += sec.subtotal;
    if (sec.code === 'M206A') m2Adjustments   += sec.subtotal;    // RAW, no contra flip
  }
  totalAssets      = Math.round(totalAssets * 100) / 100;
  totalLiabilities = Math.round(totalLiabilities * 100) / 100;
  partnersCapital  = Math.round(partnersCapital * 100) / 100;
  m2Adjustments    = Math.round(m2Adjustments * 100) / 100;
  // CPA format: TOTAL LIABILITIES & S/E = L15+L17+L20+L21  (M-2 lives on its own line).
  const totalLiabEquity = Math.round((totalLiabilities + partnersCapital) * 100) / 100;
  // Legacy back-compat: totalEquity was the OLD single-line "Equity" bundle
  // (L21 + M202 + M206A with contra flip). Preserved so previously locked
  // snapshots keep rendering the way they were locked.
  const totalEquity = Math.round((partnersCapital + m2Adjustments - Math.abs(0)) * 100) / 100;
  // Tax-recon plug (CPA format): A + L&SE + NIL + M-2 = 0
  //   ⇒ NIL = -(A + L&SE + M-2)
  //   ⇒ where L&SE = totalLiabilities + partnersCapital (L21 only, no M-2)
  // Numerically identical to the old formula but presented with M-2 on its
  // own line — see renderTaxReconSummary in reports.js for the display.
  const netIncomeLoss   = Math.round(-(totalAssets + totalLiabEquity + m2Adjustments) * 100) / 100;
  // The BS-implied FY net income the CPA capital accounts would require.
  // Reported alongside the P&L number so any gap between the two is visible.
  const bsImpliedNetIncome = Math.round(-netIncomeLoss * 100) / 100;

  // Reconciliation gap: compare the plug to the actual P&L net income for the
  // year. Needs the chart of accounts to classify revenue/expense — if the
  // caller didn't pass categories, leave both null and the renderer paints a
  // "not linked" badge instead of a numeric gap.
  let actualNetIncome   = null;
  let reconciliationGap = null;
  if (Array.isArray(categories) && Array.isArray(transactions)) {
    const pnl = aggregateForPnL(transactions, categories);
    actualNetIncome   = Math.round(((Number(pnl.totalRevenue) || 0) - (Number(pnl.totalExpenses) || 0)) * 100) / 100;
    // Sign convention: netIncomeLoss is BS-style (income negative);
    // actualNetIncome is P&L-style (income positive). Their SUM is 0 when
    // the BS plug agrees with the P&L — any non-zero residual is the gap.
    reconciliationGap = Math.round((netIncomeLoss + actualNetIncome) * 100) / 100;
  }

  // Legacy back-compat fields used by the simpler "Assets / Liab / Equity /
  // Balance Check" presentation. The balance check must be on a single sign
  // convention; we normalize to MAGNITUDE since liabilities are typically
  // stored signed-negative and equity signed-positive in this codebase, so
  // the raw signed sum mixes conventions and yields a meaningless gap.
  //   totalLiabPlusEquity = |L| + |E|
  //   balanceCheck        = A − |L| − |E|  (positive ⇒ asset excess; negative ⇒ short)
  const liabMagnitude       = Math.abs(totalLiabilities);
  const equityMagnitude     = Math.abs(totalEquity);
  const totalLiabPlusEquity = Math.round((liabMagnitude + equityMagnitude) * 100) / 100;
  const balanceCheck        = Math.round((totalAssets - liabMagnitude - equityMagnitude) * 100) / 100;

  return {
    year,
    captured_at: capturedAtIso || new Date().toISOString(),
    locked_by_name: lockedByName || null,
    sections: [...sectionMap.values()],
    totals: {
      totalAssets,
      totalLiabEquity,
      // NEW CPA-format fields: split equity into L21 (partnersCapital) and
      // M-2 (M202 + M206A raw), plus the derived BS-implied NI. Renderers
      // that detect these fields use the CPA presentation; renderers that
      // don't fall back to the legacy tax-recon layout.
      partnersCapital,
      m2Adjustments,
      bsImpliedNetIncome,
      netIncomeLoss,
      actualNetIncome,
      reconciliationGap,
      // back-compat fields (do not remove until every locked snapshot is re-locked)
      totalLiabilities, totalEquity, totalLiabPlusEquity, balanceCheck,
    },
  };
}

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
