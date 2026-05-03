-- Migration: add_bond_holdings
-- Purpose: Add household-scoped bond holdings persistence for #190 / #180.

CREATE TABLE IF NOT EXISTS public.bond_holdings (
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  id text NOT NULL,
  ticker text,
  issuer text NOT NULL,
  currency text NOT NULL,
  face_value numeric(18, 6) NOT NULL,
  coupon_rate numeric(18, 6) NOT NULL,
  coupon_frequency text NOT NULL,
  issue_date date NOT NULL,
  maturity_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT bond_holdings_pkey PRIMARY KEY (household_id, id),
  CONSTRAINT bond_holdings_face_value_nonnegative CHECK (face_value >= 0),
  CONSTRAINT bond_holdings_coupon_rate_nonnegative CHECK (coupon_rate >= 0),
  CONSTRAINT bond_holdings_maturity_after_issue CHECK (maturity_date > issue_date)
);

CREATE INDEX IF NOT EXISTS bond_holdings_household_id_idx
  ON public.bond_holdings (household_id);

CREATE INDEX IF NOT EXISTS bond_holdings_household_maturity_date_idx
  ON public.bond_holdings (household_id, maturity_date)
  WHERE deleted_at IS NULL;

DROP TRIGGER IF EXISTS trg_bond_holdings_updated_at ON public.bond_holdings;
CREATE TRIGGER trg_bond_holdings_updated_at
  BEFORE UPDATE ON public.bond_holdings
  FOR EACH ROW EXECUTE FUNCTION public.tg_update_timestamp();

ALTER TABLE public.bond_holdings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bond_holdings_select ON public.bond_holdings;
DROP POLICY IF EXISTS bond_holdings_insert ON public.bond_holdings;
DROP POLICY IF EXISTS bond_holdings_update ON public.bond_holdings;
DROP POLICY IF EXISTS bond_holdings_delete ON public.bond_holdings;

CREATE POLICY bond_holdings_select ON public.bond_holdings FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY bond_holdings_insert ON public.bond_holdings FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY bond_holdings_update ON public.bond_holdings FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY bond_holdings_delete ON public.bond_holdings FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));
