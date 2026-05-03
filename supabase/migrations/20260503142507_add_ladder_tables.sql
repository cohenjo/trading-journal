-- Migration: add_ladder_tables
-- Purpose: Add household-scoped bond ladder persistence for #192 / #184.

CREATE TABLE IF NOT EXISTS public.ladder_rungs (
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  id text NOT NULL,
  year integer NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  target_amount numeric(18, 6) NOT NULL,
  current_amount numeric(18, 6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ladder_rungs_pkey PRIMARY KEY (household_id, id),
  CONSTRAINT ladder_rungs_household_year_key UNIQUE (household_id, year),
  CONSTRAINT ladder_rungs_target_amount_nonnegative CHECK (target_amount >= 0),
  CONSTRAINT ladder_rungs_current_amount_nonnegative CHECK (current_amount >= 0),
  CONSTRAINT ladder_rungs_date_range_valid CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS ladder_rungs_household_id_idx
  ON public.ladder_rungs (household_id);

CREATE INDEX IF NOT EXISTS ladder_rungs_household_year_idx
  ON public.ladder_rungs (household_id, year);

DROP TRIGGER IF EXISTS trg_ladder_rungs_updated_at ON public.ladder_rungs;
CREATE TRIGGER trg_ladder_rungs_updated_at
  BEFORE UPDATE ON public.ladder_rungs
  FOR EACH ROW EXECUTE FUNCTION public.tg_update_timestamp();

ALTER TABLE public.ladder_rungs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ladder_rungs_select ON public.ladder_rungs;
DROP POLICY IF EXISTS ladder_rungs_insert ON public.ladder_rungs;
DROP POLICY IF EXISTS ladder_rungs_update ON public.ladder_rungs;
DROP POLICY IF EXISTS ladder_rungs_delete ON public.ladder_rungs;

CREATE POLICY ladder_rungs_select ON public.ladder_rungs FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY ladder_rungs_insert ON public.ladder_rungs FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY ladder_rungs_update ON public.ladder_rungs FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY ladder_rungs_delete ON public.ladder_rungs FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));

CREATE TABLE IF NOT EXISTS public.ladder_bonds (
  household_id uuid NOT NULL REFERENCES public.households(id) ON DELETE CASCADE,
  id text NOT NULL,
  ticker text,
  issuer text NOT NULL,
  currency text NOT NULL,
  face_value numeric(18, 6) NOT NULL,
  coupon_rate numeric(18, 6) NOT NULL,
  coupon_frequency text NOT NULL,
  maturity_date date NOT NULL,
  rung_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ladder_bonds_pkey PRIMARY KEY (household_id, id),
  CONSTRAINT ladder_bonds_rung_fkey FOREIGN KEY (household_id, rung_id)
    REFERENCES public.ladder_rungs (household_id, id) ON DELETE CASCADE,
  CONSTRAINT ladder_bonds_face_value_nonnegative CHECK (face_value >= 0),
  CONSTRAINT ladder_bonds_coupon_rate_nonnegative CHECK (coupon_rate >= 0)
);

CREATE INDEX IF NOT EXISTS ladder_bonds_household_id_idx
  ON public.ladder_bonds (household_id);

CREATE INDEX IF NOT EXISTS ladder_bonds_household_rung_id_idx
  ON public.ladder_bonds (household_id, rung_id);

CREATE INDEX IF NOT EXISTS ladder_bonds_household_maturity_date_idx
  ON public.ladder_bonds (household_id, maturity_date);

DROP TRIGGER IF EXISTS trg_ladder_bonds_updated_at ON public.ladder_bonds;
CREATE TRIGGER trg_ladder_bonds_updated_at
  BEFORE UPDATE ON public.ladder_bonds
  FOR EACH ROW EXECUTE FUNCTION public.tg_update_timestamp();

ALTER TABLE public.ladder_bonds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ladder_bonds_select ON public.ladder_bonds;
DROP POLICY IF EXISTS ladder_bonds_insert ON public.ladder_bonds;
DROP POLICY IF EXISTS ladder_bonds_update ON public.ladder_bonds;
DROP POLICY IF EXISTS ladder_bonds_delete ON public.ladder_bonds;

CREATE POLICY ladder_bonds_select ON public.ladder_bonds FOR SELECT TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_member(household_id));
CREATE POLICY ladder_bonds_insert ON public.ladder_bonds FOR INSERT TO authenticated
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY ladder_bonds_update ON public.ladder_bonds FOR UPDATE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id))
  WITH CHECK (household_id IS NOT NULL AND public.is_household_writer(household_id));
CREATE POLICY ladder_bonds_delete ON public.ladder_bonds FOR DELETE TO authenticated
  USING (household_id IS NOT NULL AND public.is_household_writer(household_id));
