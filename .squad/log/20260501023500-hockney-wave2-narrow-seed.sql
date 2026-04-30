-- Wave 2 Narrow Scope Test Data Seed
-- User: redfoot-test@example.com (093d1078-7826-4b8f-b825-2ebb80bbf889)
-- Author: Hockney (Backend Dev)
-- Date: 2026-05-01

-- =============================================================================
-- Part 1: Insurance Policies Seed Data
-- =============================================================================

-- Insert 2 test insurance policies for redfoot-test@example.com
INSERT INTO public.insurance_policies (
    id,
    user_id,
    owner,
    type,
    provider,
    policy_number,
    sum_insured,
    monthly_premium,
    beneficiaries,
    expiry_date,
    website,
    notes,
    created_at,
    updated_at
) VALUES
(
    'test-policy-life-001',
    '093d1078-7826-4b8f-b825-2ebb80bbf889',
    'You',
    'life',
    'Test Life Insurance Co.',
    'LIFE-12345',
    '₪2,000,000',
    350.50,
    'Spouse and Children',
    '2045-12-31',
    'https://testlife.example.com',
    'Primary life insurance policy',
    NOW(),
    NOW()
),
(
    'test-policy-health-001',
    '093d1078-7826-4b8f-b825-2ebb80bbf889',
    'Partner',
    'health',
    'Test Health Insurance Ltd.',
    'HEALTH-67890',
    'Full Coverage',
    280.00,
    'Family',
    '2026-12-31',
    'https://testhealth.example.com',
    'Supplementary health insurance',
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;

-- =============================================================================
-- Part 2: Finance Snapshots Seed Data (Pension)
-- =============================================================================

-- Insert a finance snapshot with pension data for redfoot-test@example.com
INSERT INTO public.finance_snapshots (
    user_id,
    date,
    data,
    net_worth,
    total_assets,
    total_liabilities
) VALUES
(
    '093d1078-7826-4b8f-b825-2ebb80bbf889',
    '2026-05-01',
    '{
        "items": [
            {
                "id": "pension::you::pensia-makif::123456",
                "category": "Investments",
                "name": "פנסיה מקיפה — Test Pension Fund",
                "value": 450000.00,
                "type": "Pension",
                "owner": "You",
                "inflow_priority": 100,
                "withdrawal_priority": 100,
                "currency": "ILS",
                "details": {
                    "pension_identity": "pension::you::pensia-makif::123456",
                    "pension_product": "פנסיה מקיפה",
                    "pension_fund_name": "Test Pension Fund",
                    "pension_display_name": "פנסיה מקיפה — Test Pension Fund",
                    "account_number": "123456",
                    "report_date": "2026-05-01",
                    "deposits": 1500.00,
                    "monthly_contribution": 1500.00,
                    "fees": 25.00,
                    "earnings": 3500.00,
                    "insurance_fees": 15.00
                }
            },
            {
                "id": "pension::partner::gemel::789012",
                "category": "Investments",
                "name": "קופת גמל — Partner Pension Fund",
                "value": 320000.00,
                "type": "Pension",
                "owner": "Partner",
                "inflow_priority": 100,
                "withdrawal_priority": 100,
                "currency": "ILS",
                "details": {
                    "pension_identity": "pension::partner::gemel::789012",
                    "pension_product": "קופת גמל",
                    "pension_fund_name": "Partner Pension Fund",
                    "pension_display_name": "קופת גמל — Partner Pension Fund",
                    "account_number": "789012",
                    "report_date": "2026-05-01",
                    "deposits": 1200.00,
                    "monthly_contribution": 1200.00,
                    "fees": 18.00,
                    "earnings": 2800.00,
                    "insurance_fees": 12.00
                }
            }
        ],
        "total_savings": 0.0,
        "total_investments": 770000.00,
        "total_assets": 770000.00,
        "total_liabilities": 0.0,
        "net_worth": 770000.00
    }',
    770000.00,
    770000.00,
    0.0
)
-- Note: No ON CONFLICT clause because we're using a partial unique index (user_id, date)
-- where user_id IS NOT NULL. This means conflicts won't happen for properly user-scoped rows.

-- =============================================================================
-- Verification Queries
-- =============================================================================

-- Verify insurance policies
-- SELECT * FROM public.insurance_policies WHERE user_id = '093d1078-7826-4b8f-b825-2ebb80bbf889';

-- Verify finance snapshots
-- SELECT user_id, date, net_worth, total_assets 
-- FROM public.finance_snapshots 
-- WHERE user_id = '093d1078-7826-4b8f-b825-2ebb80bbf889';

-- Verify pension data within snapshot
-- SELECT user_id, date, 
--        jsonb_array_length(data->'items') as item_count,
--        jsonb_path_query_array(data, '$.items[*] ? (@.type == "Pension")') as pension_items
-- FROM public.finance_snapshots 
-- WHERE user_id = '093d1078-7826-4b8f-b825-2ebb80bbf889';
