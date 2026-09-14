-- Set default uuid generation for insurance_policies.id
ALTER TABLE public.insurance_policies
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
