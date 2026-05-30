-- =============================================================================
-- Add Housing expense taxonomy
-- =============================================================================
-- Covers utility bills related to housing: water, electricity, gas, home insurance,
-- property tax (arnona), building HOA (va'ad bayit), and home maintenance.
-- Distinct from the existing "Utilities & Communications" category which covers
-- telecom/internet/streaming services.

begin;

-- New top-level Housing parent.
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
    'housing',
    'Housing',
    'דיור',
    'home',
    '#795548',
    12
)
on conflict (slug) do nothing;

update public.expense_categories
set
    parent_id = null,
    name = 'Housing',
    name_he = 'דיור',
    icon = 'home',
    color = '#795548',
    display_order = 12
where slug = 'housing';

-- Housing subcategories.
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
    '#795548',
    new_category.display_order
from public.expense_categories parent
cross join (
    values
        ('housing-water',            'Water',              'מים',               'droplet',       1),
        ('housing-electricity',      'Electricity',        'חשמל',              'zap',           2),
        ('housing-gas',              'Gas',                'גז',                'flame',         3),
        ('housing-home-insurance',   'Home Insurance',     'ביטוח דירה',        'shield-check',  4),
        ('housing-property-tax',     'Property Tax',       'ארנונה',            'landmark',      5),
        ('housing-hoa',              'Building HOA',       'ועד בית',           'building',      6),
        ('housing-home-maintenance', 'Home Maintenance',   'תחזוקת הבית',       'hammer',        7)
) as new_category(slug, name, name_he, icon, display_order)
where parent.slug = 'housing'
on conflict (slug) do nothing;

update public.expense_categories category
set
    parent_id = parent.id,
    name = new_category.name,
    name_he = new_category.name_he,
    icon = new_category.icon,
    color = '#795548',
    display_order = new_category.display_order
from public.expense_categories parent
join (
    values
        ('housing-water',            'Water',              'מים',               'droplet',       1),
        ('housing-electricity',      'Electricity',        'חשמל',              'zap',           2),
        ('housing-gas',              'Gas',                'גז',                'flame',         3),
        ('housing-home-insurance',   'Home Insurance',     'ביטוח דירה',        'shield-check',  4),
        ('housing-property-tax',     'Property Tax',       'ארנונה',            'landmark',      5),
        ('housing-hoa',              'Building HOA',       'ועד בית',           'building',      6),
        ('housing-home-maintenance', 'Home Maintenance',   'תחזוקת הבית',       'hammer',        7)
) as new_category(slug, name, name_he, icon, display_order) on true
where parent.slug = 'housing'
  and category.slug = new_category.slug;

commit;
