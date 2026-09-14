-- Set default uuid generation for insurance_policies.id and default timestamps
ALTER TABLE public.insurance_policies
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();
