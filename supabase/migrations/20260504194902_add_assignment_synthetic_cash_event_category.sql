-- Migration: add_assignment_synthetic_cash_event_category
-- Purpose: Allow IBKR assignment/exercise stock-leg synthetic cash-flow adjustments.

alter type public.options_cash_event_category add value if not exists 'assignment_synthetic';
