// One-click "Capitalize" flow: turns a posted expense transaction into a
// fixed asset + reclass JE so the asset register and books stay in sync.
//
// House rule: never mutates the original transaction's amount/category/
// description — the reclass JE adds offsetting entries that net the expense
// to zero. transactions.capitalized_asset_id back-references the new asset
// so the action can be undone cleanly.

import { supabase } from './supabase';
import { postJournalEntry } from './postJournalEntry';

// One reminder, three places (Assets page top, Capitalize modal, New Asset form).
// Keep edits in one spot.
export const CAPITALIZE_REMINDER =
  'When to capitalize: purchases of $2,500+ that will last more than a year (equipment, build-outs, furniture) belong here as assets and depreciate monthly. Under $2,500 — or repairs to existing equipment — stay as regular expenses. Unsure? Expense it and leave a note for the CPA.';

export const CAPITALIZE_REMINDER_SHORT =
  '$2,500+ purchases lasting more than a year → capitalize. Under $2,500 or repairs → expense. Unsure? Expense it and note for the CPA.';

export const CAPITALIZE_THRESHOLD = 2500;

// Asset class → useful life in years. Used to seed the form; user can edit.
export const CLASS_LIVES = {
  'Kitchen & Bar Equipment': 7,
  'Technology & POS':        5,
  'Patio & Furniture':       7,
  'Leasehold Improvements':  15,
  'Building Components':     39,
  'Intangibles':             15,
};

export const ASSET_CLASS_OPTIONS = Object.keys(CLASS_LIVES);
export const DEFAULT_ASSET_CLASS = 'Kitchen & Bar Equipment';
export const PP_AND_E_CATEGORY   = 'Property & Equipment';

// Memo tag used to find the reclass JE during Undo. Embedding the asset_id
// keeps the lookup unambiguous even if the asset name later changes.
function capitalizationMemo(assetId, originatingTxnId) {
  return `capitalized-asset:${assetId} | from-txn:${originatingTxnId}`;
}

async function nextCapitalizationReference() {
  const { data } = await supabase
    .from('journal_entries')
    .select('reference')
    .ilike('reference', 'JE-CAP-%')
    .order('created_at', { ascending: false })
    .limit(1);
  const last = data?.[0]?.reference || '';
  const m = last.match(/JE-CAP-(\d+)/);
  const n = m ? parseInt(m[1], 10) + 1 : 1;
  return `JE-CAP-${String(n).padStart(3, '0')}`;
}

export async function findReclassJEForAsset(assetId) {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('id, reference, description, memo, date, total_amount, status')
    .ilike('memo', `%capitalized-asset:${assetId}%`)
    .neq('status', 'void')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

// Sequential inserts with rollback. Supabase has no client-side multi-table
// transaction, so any failure after step 1 rolls back the prior steps.
//   txn      — the originating (posted, debit) transaction row
//   form     — { name, assetClass, lifeYears, inServiceDate, notes }
//   userId   — current user id for created_by / posted_at
export async function capitalizeFromTransaction({ txn, form, userId }) {
  if (!txn?.id)              throw new Error('Missing source transaction.');
  if (txn.type !== 'debit')  throw new Error('Only debit transactions can be capitalized.');
  if (!txn.posted)           throw new Error('Transaction must be posted first.');
  if (txn.capitalized_asset_id) throw new Error('This transaction has already been capitalized.');

  const cost = Math.abs(Number(txn.amount) || 0);
  if (cost <= 0) throw new Error('Transaction amount must be positive.');
  if (!form?.name?.trim())      throw new Error('Asset name is required.');
  if (!form?.assetClass?.trim()) throw new Error('Asset class is required.');
  if (!form?.lifeYears)         throw new Error('Life (years) is required.');
  if (!form?.inServiceDate)     throw new Error('In-service date is required.');
  if (!txn.category)            throw new Error('Source transaction has no category to reclass from.');

  // 1. Insert asset.
  const { data: asset, error: e1 } = await supabase.from('assets').insert({
    name:               form.name.trim(),
    asset_class:        form.assetClass,
    asset_type:         'depreciable',
    in_service_date:    form.inServiceDate,
    life_years:         Number(form.lifeYears),
    cost,
    status:             'active',
    notes:              form.notes?.trim() || `Capitalized from transaction: ${txn.description || ''} ${txn.date}`,
  }).select().single();
  if (e1) throw e1;

  // From here on, any failure must clean up the asset row.
  const cleanup = async () => { await supabase.from('assets').delete().eq('id', asset.id); };

  try {
    // 2-4. Insert reclass JE + lines + mirrored txns atomically via RPC. The
    //      DB enforces DR=CR; on any failure, nothing is written.
    const reference = await nextCapitalizationReference();
    const lineRows = [
      { account_id: null, description: `Capitalize — ${asset.name}`,   debit_amount: cost, credit_amount: 0,    category: PP_AND_E_CATEGORY },
      { account_id: null, description: `Reclass from ${txn.category}`, debit_amount: 0,    credit_amount: cost, category: txn.category   },
    ];
    const txnRows = [
      { date: txn.date, description: `Capitalize — ${asset.name}`,   supplier: 'Capitalization', amount: cost, type: 'debit',  category: PP_AND_E_CATEGORY, account_id: null, reference, bank_statement_id: null, posted: true },
      { date: txn.date, description: `Reclass from ${txn.category}`, supplier: 'Capitalization', amount: cost, type: 'credit', category: txn.category,     account_id: null, reference, bank_statement_id: null, posted: true },
    ];
    const { entry_id } = await postJournalEntry({
      entry: {
        reference,
        date:         txn.date,
        description:  `Capitalize — ${asset.name}`,
        memo:         capitalizationMemo(asset.id, txn.id),
        total_amount: cost,
        status:       'posted',
        entry_type:   'simple',
        created_by:   userId || null,
        posted_at:    new Date().toISOString(),
      },
      lines: lineRows,
      txns:  txnRows,
    });

    // 5. Back-reference on the originating txn. If this fails, wipe the JE
    //    (cascades lines) and its mirrored txns.
    const { error: e5 } = await supabase.from('transactions').update({ capitalized_asset_id: asset.id }).eq('id', txn.id);
    if (e5) {
      await supabase.from('transactions').delete().eq('journal_entry_id', entry_id);
      await supabase.from('journal_entries').delete().eq('id', entry_id);
      throw e5;
    }

    return { asset, je: { id: entry_id, reference }, reference, cost };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

// Reasons we refuse to undo. Returned as a structured object so the modal
// can show the user exactly why.
export function undoBlockers(originatingTxn, asset) {
  const reasons = [];
  if (!asset) reasons.push('asset no longer exists');
  if (asset?.status === 'retired' || asset?.retired_date) reasons.push('asset has been retired');
  if (asset && Math.abs(Number(asset.cost) - Math.abs(Number(originatingTxn?.amount || 0))) > 0.005)
    reasons.push('asset cost has been edited since capitalization');
  if (asset && asset.in_service_date !== originatingTxn?.date)
    reasons.push('asset in-service date has been edited since capitalization');
  return reasons;
}

// Reverses a capitalize. Refuses if asset is retired or has been edited.
//   originatingTxn — the txn row whose capitalized_asset_id points at the asset
//   asset          — the asset row
export async function undoCapitalization({ originatingTxn, asset }) {
  const blockers = undoBlockers(originatingTxn, asset);
  if (blockers.length) throw new Error(`Cannot undo capitalization: ${blockers.join('; ')}.`);

  const je = await findReclassJEForAsset(asset.id);
  if (!je) throw new Error('Reclass journal entry not found — refusing to undo to avoid silent half-rollback.');

  // 1. Delete reclass txns (FK is SET NULL, so they'd outlive the JE).
  const { error: e1 } = await supabase.from('transactions').delete().eq('journal_entry_id', je.id);
  if (e1) throw e1;
  // 2. Delete JE (cascades JE lines).
  const { error: e2 } = await supabase.from('journal_entries').delete().eq('id', je.id);
  if (e2) throw e2;
  // 3. Clear back-reference on originating txn.
  const { error: e3 } = await supabase.from('transactions').update({ capitalized_asset_id: null }).eq('id', originatingTxn.id);
  if (e3) throw e3;
  // 4. Delete the asset row.
  const { error: e4 } = await supabase.from('assets').delete().eq('id', asset.id);
  if (e4) throw e4;

  return { undoneJE: je.reference };
}

// Latest depreciation period (YYYY-MM) already posted at or after the given
// in-service month. Returns null if no D&A JE on or after that month.
export async function latestDepreciationPeriodAtOrAfter(period) {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('reference, date')
    .ilike('reference', 'JE-DA-%')
    .neq('status', 'void')
    .gte('reference', `JE-DA-${period}`)
    .order('reference', { ascending: false })
    .limit(1);
  if (error) throw error;
  if (!data?.length) return null;
  return data[0].reference.slice('JE-DA-'.length);
}
