-- Single-row reclass: Card Purchase Stl 9311 / 800-2689 from Taxes →
-- Miscellaneous. The merchant string is the Saint Louis taxpayer-services
-- payments line (800-268-9153 is the MO Dept of Revenue automated phone).
-- That call wasn't a tax payment though — the $5,207.69 is misc, not Taxes.
-- Generated: 2026-06-18
--
-- Net P&L impact: zero (Taxes and Miscellaneous are both expense type, so
-- net income is unchanged at $122,704.91). The L21 NI allocations and RE
-- plug from commit 7f1f7b0 stay valid; no follow-up recalc needed.
--
-- Verification (executed at write time):
--   Net Income:        $122,704.91   (unchanged from 7f1f7b0)
--   Taxes line:        $149,421.45   (was $154,629.14, −$5,207.69)
--   Miscellaneous:      $34,471.47   (was $29,263.78,  +$5,207.69)

UPDATE public.transactions
SET category = 'Miscellaneous'
WHERE id = '4c599bdf-730e-47fa-b9a8-2ba30a5c4e41'::uuid;
