"""seed_expense_categories

Seeds the expense_categories table with the 11 top-level categories and
24 subcategories defined in category_rules.yaml (McManus, CC-3).

Mirrors supabase/migrations/20260529122501_seed_expense_categories.sql
for developers running ``uv run alembic upgrade head``.

IDEMPOTENT: All inserts use INSERT OR IGNORE (SQLite) / ON CONFLICT DO NOTHING
(PostgreSQL via text()). Safe to re-apply.

Revision ID: d1d2d3d4d5d6
Revises:     c1c2c3c4c5c6
Create Date: 2026-05-29 12:25:01.000000
"""

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision = "d1d2d3d4d5d6"
down_revision = "c1c2c3c4c5c6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ----------------------------------------------------------
    # PASS 1: Top-level categories (parent_id = NULL)
    # ----------------------------------------------------------
    op.execute(
        text("""
        insert into expense_categories
            (id, parent_id, slug, name, name_he, display_order, is_transfer, icon, color)
        values
            (gen_random_uuid(), null, 'groceries',
             'Groceries', 'מזון וסופרמרקט',
             1, false, 'shopping-cart', '#4CAF50'),

            (gen_random_uuid(), null, 'restaurants',
             'Restaurants & Food Delivery', 'מסעדות ומשלוחים',
             2, false, 'utensils', '#FF9800'),

            (gen_random_uuid(), null, 'health',
             'Health', 'בריאות',
             3, false, 'heart', '#E91E63'),

            (gen_random_uuid(), null, 'utilities',
             'Utilities & Communications', 'שירותים ותקשורת',
             4, false, 'bolt', '#607D8B'),

            (gen_random_uuid(), null, 'travel',
             'Travel', 'נסיעות ותיירות',
             5, false, 'plane', '#03A9F4'),

            (gen_random_uuid(), null, 'shopping',
             'Shopping', 'קניות',
             6, false, 'shopping-bag', '#9C27B0'),

            (gen_random_uuid(), null, 'kids-education',
             'Kids & Education', 'ילדים וחינוך',
             7, false, 'graduation-cap', '#00BCD4'),

            (gen_random_uuid(), null, 'financial',
             'Financial & Insurance', 'פיננסי וביטוח',
             8, false, 'dollar-sign', '#795548'),

            (gen_random_uuid(), null, 'fuel',
             'Fuel', 'דלק',
             9, false, 'gas-pump', '#F44336'),

            (gen_random_uuid(), null, 'transfers',
             'Transfers', 'העברות כסף',
             10, true, 'arrow-right-arrow-left', '#9E9E9E'),

            (gen_random_uuid(), null, 'other',
             'Other / Uncategorized', 'אחר / לא מסווג',
             99, false, 'question', '#BDBDBD')

        on conflict (slug) do nothing
    """)
    )

    # ----------------------------------------------------------
    # PASS 2: Subcategories (parent resolved by slug sub-select)
    # ----------------------------------------------------------

    # restaurants
    op.execute(
        text("""
        insert into expense_categories
            (id, parent_id, slug, name, name_he, display_order, is_transfer, icon, color)
        select gen_random_uuid(), p.id, v.slug, v.name, v.name_he,
               v.display_order, v.is_transfer, v.icon, v.color
        from expense_categories p
        cross join (values
            ('restaurants-delivery',  'Food Delivery',           'משלוחים',       1, false, 'moped',      null),
            ('restaurants-fast-food', 'Fast Food',               'מזון מהיר',      2, false, 'burger',     null),
            ('restaurants-dine-in',   'Dine-In Restaurants',     'מסעדות ישיבה',   3, false, 'fork-knife', null)
        ) as v(slug, name, name_he, display_order, is_transfer, icon, color)
        where p.slug = 'restaurants'
        on conflict (slug) do nothing
    """)
    )

    # health
    op.execute(
        text("""
        insert into expense_categories
            (id, parent_id, slug, name, name_he, display_order, is_transfer, icon, color)
        select gen_random_uuid(), p.id, v.slug, v.name, v.name_he,
               v.display_order, v.is_transfer, v.icon, v.color
        from expense_categories p
        cross join (values
            ('health-pharmacy', 'Pharmacy',          'בית מרקחת',     1, false, 'pill',        '#EC407A'),
            ('health-medical',  'Medical & Clinics', 'רפואה ומרפאות',  2, false, 'stethoscope', '#AD1457'),
            ('health-fitness',  'Fitness & Sports',  'כושר וספורט',    3, false, 'dumbbell',    '#F06292')
        ) as v(slug, name, name_he, display_order, is_transfer, icon, color)
        where p.slug = 'health'
        on conflict (slug) do nothing
    """)
    )

    # utilities
    op.execute(
        text("""
        insert into expense_categories
            (id, parent_id, slug, name, name_he, display_order, is_transfer, icon, color)
        select gen_random_uuid(), p.id, v.slug, v.name, v.name_he,
               v.display_order, v.is_transfer, v.icon, v.color
        from expense_categories p
        cross join (values
            ('utilities-internet-tv', 'Internet & Cable TV',  'אינטרנט וטלוויזיה',  1, false, 'wifi',        '#78909C'),
            ('utilities-phone',       'Mobile Phone',         'טלפון נייד',           2, false, 'smartphone',  '#546E7A'),
            ('utilities-streaming',   'Streaming Services',   'סטרימינג ומנויים',     3, false, 'play-circle', '#455A64')
        ) as v(slug, name, name_he, display_order, is_transfer, icon, color)
        where p.slug = 'utilities'
        on conflict (slug) do nothing
    """)
    )

    # travel
    op.execute(
        text("""
        insert into expense_categories
            (id, parent_id, slug, name, name_he, display_order, is_transfer, icon, color)
        select gen_random_uuid(), p.id, v.slug, v.name, v.name_he,
               v.display_order, v.is_transfer, v.icon, v.color
        from expense_categories p
        cross join (values
            ('travel-flights', 'Flights',                    'טיסות',                    1, false, 'plane',   '#29B6F6'),
            ('travel-hotels',  'Hotels & Accommodation',     'מלונות ולינה',              2, false, 'bed',     '#0288D1'),
            ('travel-parking', 'Parking',                    'חניון ופנגו',               3, false, 'parking', '#0277BD'),
            ('travel-transit', 'Public Transit & Licensing', 'תחבורה ציבורית ורישוי',     4, false, 'bus',     '#01579B')
        ) as v(slug, name, name_he, display_order, is_transfer, icon, color)
        where p.slug = 'travel'
        on conflict (slug) do nothing
    """)
    )

    # shopping
    op.execute(
        text("""
        insert into expense_categories
            (id, parent_id, slug, name, name_he, display_order, is_transfer, icon, color)
        select gen_random_uuid(), p.id, v.slug, v.name, v.name_he,
               v.display_order, v.is_transfer, v.icon, v.color
        from expense_categories p
        cross join (values
            ('shopping-clothing',    'Clothing & Fashion',    'ביגוד ואופנה',           1, false, 'shirt',    '#BA68C8'),
            ('shopping-electronics', 'Electronics & Tech',    'אלקטרוניקה וטכנולוגיה',  2, false, 'cpu',      '#9C27B0'),
            ('shopping-online',      'Online Shopping',       'קניות אונליין',           3, false, 'globe',    '#7B1FA2'),
            ('shopping-beauty',      'Beauty & Personal Care','יופי וטיפוח',              4, false, 'sparkles', '#6A1B9A')
        ) as v(slug, name, name_he, display_order, is_transfer, icon, color)
        where p.slug = 'shopping'
        on conflict (slug) do nothing
    """)
    )

    # kids-education
    op.execute(
        text("""
        insert into expense_categories
            (id, parent_id, slug, name, name_he, display_order, is_transfer, icon, color)
        select gen_random_uuid(), p.id, v.slug, v.name, v.name_he,
               v.display_order, v.is_transfer, v.icon, v.color
        from expense_categories p
        cross join (values
            ('kids-online-learning', 'Online Learning',       'למידה מקוונת',   1, false, 'monitor', '#00ACC1'),
            ('kids-activities',      'Activities & Programs', 'חוגים ותוכניות', 2, false, 'child',   '#00838F')
        ) as v(slug, name, name_he, display_order, is_transfer, icon, color)
        where p.slug = 'kids-education'
        on conflict (slug) do nothing
    """)
    )

    # financial
    op.execute(
        text("""
        insert into expense_categories
            (id, parent_id, slug, name, name_he, display_order, is_transfer, icon, color)
        select gen_random_uuid(), p.id, v.slug, v.name, v.name_he,
               v.display_order, v.is_transfer, v.icon, v.color
        from expense_categories p
        cross join (values
            ('financial-insurance',  'Insurance',              'ביטוח',             1, false, 'shield',      '#8D6E63'),
            ('financial-government', 'Government & Municipal', 'ממשלה ועירייה',      2, false, 'landmark',    '#6D4C41'),
            ('financial-fees',       'Bank & Card Fees',       'עמלות בנק וכרטיס',  3, false, 'credit-card', '#5D4037')
        ) as v(slug, name, name_he, display_order, is_transfer, icon, color)
        where p.slug = 'financial'
        on conflict (slug) do nothing
    """)
    )

    # transfers (is_transfer = true)
    op.execute(
        text("""
        insert into expense_categories
            (id, parent_id, slug, name, name_he, display_order, is_transfer, icon, color)
        select gen_random_uuid(), p.id, v.slug, v.name, v.name_he,
               v.display_order, v.is_transfer, v.icon, v.color
        from expense_categories p
        cross join (values
            ('transfers-paybox', 'PayBox / Bit Transfers', 'פייבוקס / ביט',    1, true, 'send',  null),
            ('transfers-family', 'Family Transfers',        'העברות משפחתיות',  2, true, 'users', null)
        ) as v(slug, name, name_he, display_order, is_transfer, icon, color)
        where p.slug = 'transfers'
        on conflict (slug) do nothing
    """)
    )


def downgrade() -> None:
    # Delete all seeded rows (children first, then parents to respect FK).
    op.execute(
        text("""
        delete from expense_categories
        where slug in (
            'restaurants-delivery', 'restaurants-fast-food', 'restaurants-dine-in',
            'health-pharmacy', 'health-medical', 'health-fitness',
            'utilities-internet-tv', 'utilities-phone', 'utilities-streaming',
            'travel-flights', 'travel-hotels', 'travel-parking', 'travel-transit',
            'shopping-clothing', 'shopping-electronics', 'shopping-online', 'shopping-beauty',
            'kids-online-learning', 'kids-activities',
            'financial-insurance', 'financial-government', 'financial-fees',
            'transfers-paybox', 'transfers-family',
            'groceries', 'restaurants', 'health', 'utilities', 'travel',
            'shopping', 'kids-education', 'financial', 'fuel', 'transfers', 'other'
        )
    """)
    )
