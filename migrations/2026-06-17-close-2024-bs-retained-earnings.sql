-- 2024 Book Balance Sheet structural close
-- RE plug = -$289,863.59 to bring A + L + E to zero
-- Pending CPA final allocation
-- Generated: 2026-06-17
--
-- Source of the plug amount (computed read-only at generation time):
--   Per-section subtotals from book_bs_lines using the Book BS Builder formula
--   (no double-count of adjustments):
--     ending = ending_balance_confirmed  (when not null)
--            else  beginning_balance + Σ adjustments
--
--     L01    +    2,857.00   (asset)        L15    -    1,435.00   (liability)
--     L03   +   18,047.02   (asset)         L17    -    2,016.90   (liability)
--     L09A  +  823,420.89   (asset)         L20A   -  351,778.81   (liability)
--     L09B  -  633,941.29   (asset contra)  L20B   +        0.00   (liability)
--     L12A  +  175,564.72   (asset)         L21    +  319,258.91   (equity)
--     L12B  -   35,112.95   (asset contra)  M202   -   25,000.00   (equity)
--                                           M206A  +        0.00   (equity)
--     Total Assets       =   350,835.39
--     Total Liabilities  =  -355,230.71
--     Total Equity       =   294,258.91
--     A + L + E          =   289,863.59   ← structural gap
--     RE plug needed     =  -289,863.59
--
-- Schema reference (from migrations/2026-06-15-book-bs-builder.sql):
--   book_bs_line_adjustments columns:
--     id          UUID PRIMARY KEY DEFAULT gen_random_uuid()
--     line_id     UUID NOT NULL FK -> book_bs_lines(id) ON DELETE CASCADE
--     amount      NUMERIC(14,2) NOT NULL
--     note        TEXT NOT NULL
--     created_by  UUID FK -> auth.users(id), NULLABLE
--     created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
--   No `year` column exists on this table. Year is on book_bs_lines and is
--   dereffed via line_id.

INSERT INTO public.book_bs_line_adjustments (line_id, amount, note, created_by)
VALUES (
  'b936662f-de89-4f8c-9c1f-dd4524bbe3c9'::uuid,    -- L21 / "Retained Earnings" / year 2024
  -289863.59,
  '2024 Year-End Structural Close — pending CPA final allocation',
  NULL
);

-- ── Clear confirmed value so the adjustment row is the single source of
--    truth. Book BS Builder will recompute and render
--      RE ending = beginning (0.00) + Σ adjustments (-289,863.59) = -289,863.59.
--    Year reverts to "not fully confirmed" — re-confirm the RE line in the
--    Book BS Builder UI before re-locking the year.

UPDATE public.book_bs_lines
SET ending_balance_confirmed = NULL,
    confirmed_at = NULL,
    confirmed_by = NULL
WHERE id = 'b936662f-de89-4f8c-9c1f-dd4524bbe3c9'::uuid;
