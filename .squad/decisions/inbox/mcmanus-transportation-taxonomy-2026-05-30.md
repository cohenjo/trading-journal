# Transportation taxonomy split — 2026-05-30

## Decision

Split Transportation / תחבורה (daily commute and vehicle costs) from Travel (vacations, flights, hotels) as a top-level expense concern.

## Rationale

Israeli household budgeting treats commute, fuel, car insurance, maintenance, vehicle registration, and public transport as recurring daily-life costs. Those planning signals are distinct from vacation/travel spend such as flights and hotels.

## UUID-preserving reparenting

- `fuel` → `transportation-fuel`
- `travel-transit` → `transportation-public-transit`

The migration updates existing rows instead of deleting/reinserting them, preserving category UUIDs for historical transactions and merchant mappings.

## Added categories

- `transportation-insurance`
- `transportation-maintenance`
- `transportation-registration`

## Migration workflow

The PR commit includes `[apply-migrations]`, so Kujan's Supabase migration workflow auto-applies the data migration after merge.
