import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { useData } from '../../contexts/DataContext';
import { supabase } from '../../lib/supabase';
import {
  extractBankStatementFromText,
  extractBankStatementFromImages,
} from '../../lib/claude';
import {
  parseStatementPeriodFromText,
  parseStatementPeriodFromFilename,
} from '../../lib/statementPeriod';
import { fuzzyMatchCategory } from '../../lib/utils';
import { validateExtractedStatement } from '../../lib/statementValidation';
import { partitionByMultiplicity } from '../../lib/statementDedupe';
import Modal from '../../components/ui/Modal';
import FileDropZone from '../../components/ui/FileDropZone';
import StatementReuploadConfirm from '../../components/StatementReuploadConfirm';
import toast from 'react-hot-toast';
import { Loader2, FileUp, CheckCircle2 } from 'lucide-react';

const STORAGE_BUCKET = 'bank-statements';

// Format a period 'YYYY-MM' into an ISO month span [start, end].
function periodSpan(period) {
  const [y, m] = period.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return {
    start: `${period}-01`,
    end:   `${period}-${String(last).padStart(2, '0')}`,
  };
}

// Statement import flow for the Accountant's working period. Skips the
// Vercel serverless layer entirely for the original-PDF upload (client →
// Supabase storage direct) so the 4.5 MB body cap doesn't apply. The
// AI extraction still goes through /api/claude because that's where the
// server-side ANTHROPIC_API_KEY lives.
export default function StatementImportModal({ open, period, onClose, onImported }) {
  const { user } = useAuth();
  const { addTransaction, supplierCategories } = useData();
  const navigate = useNavigate();
  const [stage, setStage] = useState('idle');  // idle | uploading | extracting | saving | done
  const [progress, setProgress] = useState('');
  const [resultId, setResultId] = useState(null);
  const [reuploadCtx, setReuploadCtx] = useState(null); // { existingStmt, existingRows, file, extracted, path, resolve }

  async function onFiles(files) {
    const file = files?.[0];
    if (!file || !period) return;
    if (file.type !== 'application/pdf') {
      toast.error('Please pick a PDF bank statement.');
      return;
    }

    try {
      // 1. Upload the original full-quality PDF directly to private storage.
      setStage('uploading');
      setProgress('Uploading original PDF…');
      const safeName = file.name.replace(/[^\w.\-]/g, '_');
      const path = `${period}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, file, { contentType: 'application/pdf', cacheControl: '3600', upsert: false });
      if (upErr) throw upErr;

      // 2. Extract text + page count using PDF.js (no payload to server yet).
      setStage('extracting');
      setProgress('Reading PDF…');
      const { extractPdfText, getPdfPageCount, pdfToPageImages } = await import('../../lib/pdfPages');
      const pageCount = await getPdfPageCount(file);
      if (pageCount > 100) {
        throw new Error(`${file.name}: ${pageCount} pages exceeds the 100-page limit.`);
      }
      const pdfText = await extractPdfText(file);

      // 3. Compute the anchor — the Accountant page already knows the
      //    working period, so we don't need the user-prompt fallback here.
      const { start, end } = periodSpan(period);
      const anchor =
        parseStatementPeriodFromText(pdfText) ||
        parseStatementPeriodFromFilename(file.name) ||
        { start, end, source: 'working-period' };

      // 4. Extract via Claude — text path when the PDF has a text layer,
      //    per-page image path for scanned/image-only PDFs.
      const hasText = pdfText.replace(/[-\s|]/g, '').length > 200;
      let extracted;
      if (hasText) {
        setProgress(`Analyzing ${pageCount}-page statement…`);
        extracted = await extractBankStatementFromText(pdfText, anchor);
      } else {
        setProgress(`Scanned PDF — rendering ${pageCount} page${pageCount === 1 ? '' : 's'}…`);
        const pageImages = await pdfToPageImages(file);
        extracted = await extractBankStatementFromImages(
          pageImages,
          (pg, total) => setProgress(`Processing page ${pg} of ${total}…`),
          anchor,
        );
      }

      // Pre-insert gate: refuse implausible extractions (zero deposits or a
      // summary block that doesn't reconcile). Fails LOUDLY so the user sees
      // exactly why the file was rejected instead of silently importing a
      // debits-only view of the month.
      validateExtractedStatement(extracted);

      // 5. Reuse-or-create the bank_statements row for this period.
      //    NEVER insert a second row — the legacy path did that and it
      //    left categorized rows tied to the old id looking orphaned while
      //    the freshly-extracted rows landed under a new id, silently
      //    duplicating the entire month on the P&L.
      setStage('saving');
      setProgress('Looking up existing statement…');
      const { data: existingStmts, error: lookupErr } = await supabase
        .from('bank_statements').select('*').eq('period', period).limit(1);
      if (lookupErr) throw lookupErr;
      const existingStmt = existingStmts?.[0] || null;

      // If a statement already exists, load its rows and ask the user to
      // confirm the safe-dedupe re-upload before touching anything.
      if (existingStmt) {
        const { data: existingRows } = await supabase
          .from('transactions')
          .select('id, date, amount, description, bank_statement_id, category, voided')
          .eq('bank_statement_id', existingStmt.id);
        const nonVoided = (existingRows || []).filter(r => !r.voided);
        const categorized = nonVoided.filter(r => r.category && r.category.trim() !== '').length;

        // Pause the pipeline; the modal callbacks will resolve() this promise.
        setStage('idle');
        setProgress('');
        const proceed = await new Promise(resolve => {
          setReuploadCtx({
            existingStmt,
            existingRows: nonVoided,
            file,
            extracted,
            path,
            resolve,
            existingCount: nonVoided.length,
            categorizedCount: categorized,
          });
        });
        setReuploadCtx(null);
        if (!proceed) {
          toast('Re-upload cancelled — no changes made.', { icon: '↩️' });
          return;
        }

        setStage('saving');
        setProgress('Updating statement + inserting missing rows…');
        await runSafeReupload({ existingStmt, existingRows: nonVoided, file, extracted, path });
        setStage('done');
        setResultId(existingStmt.id);
        toast.success(`Re-upload safe: only genuinely-missing rows inserted for ${period}.`);
        onImported?.(existingStmt);
        return;
      }

      // No existing statement — create a fresh one and insert everything.
      setProgress('Saving…');
      const { data: stmt, error: stmtErr } = await supabase
        .from('bank_statements')
        .insert({
          period,
          file_name: file.name,
          file_url: path,                       // kept aligned with file_path for older readers
          file_path: path,
          upload_date: new Date().toISOString(),
          period_start: start,
          period_end:   end,
          transaction_count: extracted.transactions?.length || 0,
          statement_totals:  extracted.statement_totals || null,
          match_status: 'needs_matching',
          user_id: user?.id || null,
        })
        .select()
        .single();
      if (stmtErr) throw stmtErr;

      const candidates = (extracted.transactions || []).map((t) => ({
        date: t.date,
        description: t.description || '',
        supplier:    t.description || '',
        amount: parseFloat(t.amount) || 0,
        type:   t.type || (parseFloat(t.amount) < 0 ? 'debit' : 'credit'),
        category: fuzzyMatchCategory(t.description || '', supplierCategories),
        bank_statement_id: stmt.id,
        posted: false,
      }));
      // Empty existing-set on a fresh statement; partitionByMultiplicity still
      // handles same-day repeats within the statement itself correctly.
      const { toInsert } = partitionByMultiplicity([], candidates);
      for (const row of toInsert) {
        await addTransaction(row);
      }

      setStage('done');
      setProgress('');
      setResultId(stmt.id);
      toast.success(`Imported ${extracted.transactions?.length || 0} transactions from ${file.name}`);
      onImported?.(stmt);
    } catch (err) {
      console.error('statement import failed', err);
      setStage('idle');
      setProgress('');
      toast.error(err.message || 'Import failed');
    }
  }

  // Safe re-upload: reuse the existing statement id, update its summary
  // block + file references, then INSERT ONLY the multiplicity-difference
  // rows (uncategorized). Categorized rows and reconciled flags on the
  // existing set are never touched.
  async function runSafeReupload({ existingStmt, existingRows, file, extracted, path }) {
    // Update the metadata on the existing statement — never create a new one.
    const { error: upErr } = await supabase
      .from('bank_statements')
      .update({
        file_name: file.name,
        file_url: path,
        file_path: path,
        upload_date: new Date().toISOString(),
        statement_totals: extracted.statement_totals || existingStmt.statement_totals || null,
        // transaction_count intentionally not updated — it'd race against the
        // insert below. A trigger or downstream refresh keeps it accurate.
      })
      .eq('id', existingStmt.id);
    if (upErr) throw upErr;

    const candidates = (extracted.transactions || []).map((t) => ({
      date: t.date,
      description: t.description || '',
      supplier:    t.description || '',
      amount: parseFloat(t.amount) || 0,
      type:   t.type || (parseFloat(t.amount) < 0 ? 'debit' : 'credit'),
      // Re-upload rows land UNCATEGORIZED so we never overwrite a manual
      // categorization on the existing set. The categorized rows we're
      // shadowing already have the right category.
      category: null,
      bank_statement_id: existingStmt.id,
      posted: false,
    }));

    // Partition credits and debits independently so a same-key debit + credit
    // pair on the statement don't collide.
    const existingCredits = existingRows.filter(r => r.type === 'credit');
    const existingDebits  = existingRows.filter(r => r.type === 'debit');
    const incomingCredits = candidates.filter(r => r.type === 'credit');
    const incomingDebits  = candidates.filter(r => r.type === 'debit');
    const { toInsert: creditsToInsert } = partitionByMultiplicity(existingCredits, incomingCredits);
    const { toInsert: debitsToInsert  } = partitionByMultiplicity(existingDebits,  incomingDebits);
    const toInsert = [...creditsToInsert, ...debitsToInsert];

    for (const row of toInsert) {
      await addTransaction(row);
    }
  }

  const busy = stage === 'uploading' || stage === 'extracting' || stage === 'saving';

  return (
    <>
      <Modal open={open} onClose={busy ? () => {} : onClose} title={`Import bank statement · ${period || ''}`} size="lg">
        <div className="space-y-4 p-1">
          {stage === 'done' ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 flex items-start gap-3">
              <CheckCircle2 size={20} className="text-green-600 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-green-900">Imported. Ready to match.</div>
                <p className="text-sm text-green-800 mt-0.5">
                  Open Review &amp; Match to compare the statement's printed totals against the extracted transactions and confirm the import.
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <button type="button" onClick={onClose} className="btn-ghost text-sm">Later</button>
                  <button
                    type="button"
                    onClick={() => { onClose(); if (resultId) navigate(`/accountant/review-match/${resultId}`); }}
                    className="btn-primary text-sm"
                  >
                    Review &amp; Match
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-surface-600">
                Drop the PDF bank statement for this period. The original PDF is stored at full quality; the extractor only sees the text or per-page images.
              </p>
              {busy ? (
                <div className="rounded-lg border border-brand-200 bg-brand-50/50 p-5 flex items-center gap-3">
                  <Loader2 size={18} className="animate-spin text-brand-700" />
                  <div className="text-sm text-brand-900">{progress || 'Working…'}</div>
                </div>
              ) : (
                <FileDropZone accept=".pdf" multiple={false} onFiles={onFiles} label="Drop PDF bank statement here" />
              )}
              <div className="flex justify-between text-xs text-surface-500">
                <span className="inline-flex items-center gap-1.5"><FileUp size={12} /> PDF only · stays private</span>
                <span>Working period · {period || '—'}</span>
              </div>
            </>
          )}
        </div>
      </Modal>

      <StatementReuploadConfirm
        open={!!reuploadCtx}
        period={period}
        fileName={reuploadCtx?.file?.name}
        existingCount={reuploadCtx?.existingCount || 0}
        categorizedCount={reuploadCtx?.categorizedCount || 0}
        onConfirm={() => reuploadCtx?.resolve(true)}
        onCancel={() => reuploadCtx?.resolve(false)}
      />
    </>
  );
}
