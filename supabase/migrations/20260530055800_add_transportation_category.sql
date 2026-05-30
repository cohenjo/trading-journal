-- =============================================================================
-- Add Transportation expense taxonomy
-- =============================================================================
-- Split daily commute / vehicle costs from Travel (vacations, flights, hotels).
-- UUID-preserving restructure:
--   - fuel -> transportation-fuel
--   - travel-transit -> transportation-public-transit
-- Also backfills existing transaction / merchant mappings so historical rows now
-- resolve to Transportation > Fuel or Transportation > Public Transport.

begin;

-- New top-level Transportation parent (occupies the display slot formerly held by Fuel).
insert into public.expense_categories (
    id,
    parent_id,
    slug,
    name,
    name_he,
    icon,
    color,
    display_order
)
values (
    gen_random_uuid(),
    null,
    'transportation',
    'Transportation',
    'תחבורה',
    'car',
    '#FF5722',
    9
)
on conflict (slug) do nothing;

update public.expense_categories
set
    parent_id = null,
    name = 'Transportation',
    name_he = 'תחבורה',
    icon = 'car',
    color = '#FF5722',
    display_order = 9
where slug = 'transportation';

-- MIGRATED: fuel → transportation-fuel (2026-05-30)
-- Preserve the existing Fuel UUID so prior categorizations remain attached.
update public.expense_categories
set
    parent_id = (select id from public.expense_categories where slug = 'transportation'),
    slug = 'transportation-fuel',
    name = 'Fuel',
    name_he = 'דלק',
    icon = 'gas-pump',
    color = '#FF5722',
    display_order = 1
where slug = 'fuel'
  and not exists (
      select 1
      from public.expense_categories
      where slug = 'transportation-fuel'
  );

update public.expense_categories
set
    parent_id = (select id from public.expense_categories where slug = 'transportation'),
    name = 'Fuel',
    name_he = 'דלק',
    icon = 'gas-pump',
    color = '#FF5722',
    display_order = 1
where slug = 'transportation-fuel';

-- MIGRATED: travel-transit → transportation-public-transit (2026-05-30)
-- Preserve the existing Public Transit UUID while moving licensing to Registration.
update public.expense_categories
set
    parent_id = (select id from public.expense_categories where slug = 'transportation'),
    slug = 'transportation-public-transit',
    name = 'Public Transport',
    name_he = 'תחבורה ציבורית',
    icon = 'bus',
    color = '#FF5722',
    display_order = 2
where slug = 'travel-transit'
  and not exists (
      select 1
      from public.expense_categories
      where slug = 'transportation-public-transit'
  );

update public.expense_categories
set
    parent_id = (select id from public.expense_categories where slug = 'transportation'),
    name = 'Public Transport',
    name_he = 'תחבורה ציבורית',
    icon = 'bus',
    color = '#FF5722',
    display_order = 2
where slug = 'transportation-public-transit';

-- New Transportation subcategories.
insert into public.expense_categories (
    id,
    parent_id,
    slug,
    name,
    name_he,
    icon,
    color,
    display_order
)
select
    gen_random_uuid(),
    parent.id,
    new_category.slug,
    new_category.name,
    new_category.name_he,
    new_category.icon,
    '#FF5722',
    new_category.display_order
from public.expense_categories parent
cross join (
    values
        ('transportation-insurance', 'Car Insurance', 'ביטוח רכב', 'shield', 3),
        ('transportation-maintenance', 'Car Maintenance', 'תחזוקת רכב', 'wrench', 4),
        ('transportation-registration', 'Vehicle Registration', 'רישוי רכב', 'clipboard-check', 5)
) as new_category(slug, name, name_he, icon, display_order)
where parent.slug = 'transportation'
on conflict (slug) do nothing;

update public.expense_categories category
set
    parent_id = parent.id,
    name = new_category.name,
    name_he = new_category.name_he,
    icon = new_category.icon,
    color = '#FF5722',
    display_order = new_category.display_order
from public.expense_categories parent
join (
    values
        ('transportation-insurance', 'Car Insurance', 'ביטוח רכב', 'shield', 3),
        ('transportation-maintenance', 'Car Maintenance', 'תחזוקת רכב', 'wrench', 4),
        ('transportation-registration', 'Vehicle Registration', 'רישוי רכב', 'clipboard-check', 5)
) as new_category(slug, name, name_he, icon, display_order) on true
where parent.slug = 'transportation'
  and category.slug = new_category.slug;

-- Backfill existing rows that previously used Fuel as a top-level category.
with transportation_ids as (
    select
        (select id from public.expense_categories where slug = 'transportation')
            as transportation_id,
        (select id from public.expense_categories where slug = 'transportation-fuel')
            as fuel_id
)
update public.credit_card_transactions txn
set
    category_id = transportation_ids.transportation_id,
    subcategory_id = transportation_ids.fuel_id
from transportation_ids
where txn.category_id = transportation_ids.fuel_id
  and transportation_ids.transportation_id is not null
  and transportation_ids.fuel_id is not null;

with transportation_ids as (
    select
        (select id from public.expense_categories where slug = 'transportation')
            as transportation_id,
        (select id from public.expense_categories where slug = 'transportation-fuel')
            as fuel_id
)
update public.merchant_category_mappings mapping
set
    category_id = transportation_ids.transportation_id,
    subcategory_id = transportation_ids.fuel_id
from transportation_ids
where mapping.category_id = transportation_ids.fuel_id
  and transportation_ids.transportation_id is not null
  and transportation_ids.fuel_id is not null;

-- Backfill existing rows that previously used Travel > Public Transit & Licensing.
with transportation_ids as (
    select
        (select id from public.expense_categories where slug = 'transportation')
            as transportation_id,
        (select id from public.expense_categories where slug = 'transportation-public-transit')
            as public_transit_id
)
update public.credit_card_transactions txn
set
    category_id = transportation_ids.transportation_id,
    subcategory_id = transportation_ids.public_transit_id
from transportation_ids
where (
        txn.category_id = transportation_ids.public_transit_id
        or txn.subcategory_id = transportation_ids.public_transit_id
    )
  and transportation_ids.transportation_id is not null
  and transportation_ids.public_transit_id is not null;

with transportation_ids as (
    select
        (select id from public.expense_categories where slug = 'transportation')
            as transportation_id,
        (select id from public.expense_categories where slug = 'transportation-public-transit')
            as public_transit_id
)
update public.merchant_category_mappings mapping
set
    category_id = transportation_ids.transportation_id,
    subcategory_id = transportation_ids.public_transit_id
from transportation_ids
where (
        mapping.category_id = transportation_ids.public_transit_id
        or mapping.subcategory_id = transportation_ids.public_transit_id
    )
  and transportation_ids.transportation_id is not null
  and transportation_ids.public_transit_id is not null;

commit;
