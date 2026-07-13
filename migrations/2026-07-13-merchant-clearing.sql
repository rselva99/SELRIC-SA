-- 2026-07-13 · Merchant Clearing chart-of-accounts entries
--
-- Phase 2B introduces a Merchant Clearing account so that revenue and cash
-- settle through two separate steps:
--
--   1. Revenue Breakdown JE:   DR Merchant Clearing  / CR Bar/Food/Other Sales
--                              (replaces the DR Cash & Bank leg Step 2b added)
--   2. Bank deposit JE:        DR Cash & Bank        / CR Merchant Clearing
--                              (posted per SpotOn merch dep / branch deposit row)
--
-- Merchant Clearing carries a positive DR balance whenever revenue has been
-- recognized but the money hasn't yet landed in the bank (SpotOn's typical 1-3
-- day holding period); it settles toward zero as deposits post.
--
-- Two new categories:
--
--   Merchant Clearing              type=asset       (current-asset clearing)
--   Due to Partners - J. Harris    type=liability   (partner receivables from
--                                                   Finwise/Upstart etc.)
--
-- Loan - Spoton also created here because the SpotOn merchant-cash-advance
-- draw is booked separately from the ordinary daily merchant deposits — the
-- $95,100 one-off "Spoton Funding" row in the 470 unposted credits needs
-- its own liability account rather than being lumped into the generic
-- `Loans` bucket that already carries Southern Bank.
--
-- Idempotent: INSERT ... ON CONFLICT (name) DO NOTHING would be ideal, but
-- `categories` doesn't have a unique constraint on name (nullable user_id
-- keeps the historical multi-tenant shape). Guard each INSERT with a WHERE
-- NOT EXISTS instead.

INSERT INTO public.categories (name, type, description, archived)
SELECT 'Merchant Clearing', 'asset',
       'Current-asset clearing account. SpotOn / cash-till receivable that lands here on revenue recognition and settles to zero as bank deposits arrive.',
       false
 WHERE NOT EXISTS (
   SELECT 1 FROM public.categories WHERE name = 'Merchant Clearing'
 );

INSERT INTO public.categories (name, type, description, archived)
SELECT 'Due to Partners - J. Harris', 'liability',
       'Partner payable / receivable. Finwise/Upstart Loan Funds and similar owner-injected financing settle here.',
       false
 WHERE NOT EXISTS (
   SELECT 1 FROM public.categories WHERE name = 'Due to Partners - J. Harris'
 );

INSERT INTO public.categories (name, type, description, archived)
SELECT 'Loan - Spoton', 'liability',
       'SpotOn merchant-cash-advance liability. Separated from the generic Loans bucket so the SpotOn MCA draw and paydown are trackable independently of the Southern Bank note.',
       false
 WHERE NOT EXISTS (
   SELECT 1 FROM public.categories WHERE name = 'Loan - Spoton'
 );
