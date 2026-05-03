-- Migration: add_options_income
-- Purpose: Add household-scoped options income persistence for #191 / #183.

CREATE TABLE IF NOT EXISTS public.options_income (
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  year integer NOT NULL,
  amount numeric(18, 6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT options_income_pkey PRIMARY KEY (household_id, year)
);

CREATE INDEX IF NOT EXISTS options_income_household_id_idx
  ON public.options_income (household_id);

DROP TRIGGER IF EXISTS trg_options_income_updated_at ON public.options_income;
CREATE TRIGGER trg_options_income_updated_at
  BEFORE UPDATE ON public.options_income
  FOR EACH ROW EXECUTE FUNCTION public.tg_update_timestamp();

ALTER TABLE public.options_income ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS options_income_select ON public.options_income;
DROP POLICY IF EXISTS options_income_insert ON public.options_income;
DROP POLICY IF EXISTS options_income_update ON public.options_income;
DROP POLICY IF EXISTS options_income_delete ON public.options_income;

CREATE POLICY options_income_select ON public.options_income FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY options_income_insert ON public.options_income FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY options_income_update ON public.options_income FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY options_income_delete ON public.options_income FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));
