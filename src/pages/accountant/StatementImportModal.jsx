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
import Modal from '../../components/ui/Modal';
import FileDropZone from '../../components/ui/FileDropZone';
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

      // 5. Persist bank_statements + transactions.
      setStage('saving');
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

      // Sequential inserts so any per-row failure short-circuits cleanly.
      // Bank-imported rows go through addTransaction (DataContext) which
      // handles supplier-category fuzzy matching consistently.
      for (const t of extracted.transactions || []) {
        const suggestedCat = fuzzyMatchCategory(t.description || '', supplierCategories);
        await addTransaction({
          date: t.date,
          description: t.description || '',
          supplier:    t.description || '',
          amount: parseFloat(t.amount) || 0,
          type:   t.type || (parseFloat(t.amount) < 0 ? 'debit' : 'credit'),
          category: suggestedCat,
          bank_statement_id: stmt.id,
          posted: false,
        });
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

  const busy = stage === 'uploading' || stage === 'extracting' || stage === 'saving';

  return (
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
  );
}
