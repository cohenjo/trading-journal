import { PlanData, PlanItem } from './types';

export interface ProjectionPoint {
    time: string;
    value: number;
    liquid: number;
    liquidNetWorth: number;
    realAssets: number;
    debt: number;
    year: number;
    milestonesHit: string[];
}

export const calculateProjection = (
    plan: PlanData,
    finances: any = null, // Finance Snapshot
    startingLiquidOverride: number | null = null, // Optional fallback if finances not provided
    mainCurrency: 'USD' | 'ILS' | 'EUR' = 'ILS'
): ProjectionPoint[] => {

    // --- Currency Conversion Helper ---
    // Rates: USD=3 ILS, EUR=3.5 ILS. Base is ILS.
    const RATES = {
        'ILS': 1,
        'USD': 3,
        'EUR': 3.5
    };

    const convert = (amount: number, from: string = 'ILS'): number => {
        if (!amount) return 0;
        const fromRate = RATES[from as keyof typeof RATES] || 1;
        const toRate = RATES[mainCurrency] || 1;

        // Convert to ILS (Base) then to Target
        const inILS = amount * fromRate;
        return inILS / toRate;
    };
    const today = new Date();
    const startYear = today.getFullYear();
    const data: ProjectionPoint[] = [];

    // --- 1. Initialize State from Finances & Plan ---

    interface ActiveAccount {
        id: string;
        name: string;
        value: number;
        priority: number;
        settings: {
            growth_rate: number;
            dividend_yield: number;
            fees: number;
            type?: string;
            draw_income?: boolean;
            divide_rate?: number;
            starting_age?: number;
            monthly_contribution?: number;

            // Dividends
            dividend_policy?: 'Accumulate' | 'Payout';
            dividend_mode?: 'Percent' | 'Fixed';
            dividend_fixed_amount?: number;
            dividend_growth_rate?: number;
            dividend_tax_rate?: number;
            dividend_payout_start_condition?: 'Immediate' | 'Age' | 'Milestone' | 'Date';
            dividend_payout_start_reference?: string | number;

            // We need owner/age context usually, but engine uses simple assumptions or we need to pass owner age map
        }
    }

    let accounts: ActiveAccount[] = [];
    let unallocatedCash = 0;

    interface ActiveRealAsset {
        item_id: string;
        name: string;
        current_value: number;
        loan_balance: number;
        loan_term_remaining_months: number;
        purchase_year: number;
        spec: PlanItem;
    }
    let activeRealAssets: ActiveRealAsset[] = [];
    let simplifiedRealAssetsValue = 0;

    const getPlanConfig = (name: string, category: string) => {
        return plan.items.find(i => i.name === name && i.category === category);
    };

    if (finances && finances.data && finances.data.items) {
        finances.data.items.forEach((fItem: any) => {
            // Note: Finances snapshot items might not have currency tagged yet? 
            // Assuming they are in ILS by default or we need to find where they come from.
            // For now, let's look for currency in details or default to ILS.
            const itemCurrency = fItem.currency || 'ILS';

            if (fItem.category === 'Savings' || fItem.category === 'Investments') {
                const planItem = getPlanConfig(fItem.name, 'Account');
                const settings = planItem?.account_settings || {} as any;

                // Default Type Logic (Engine side fallback)
                // If planItem didn't specify type, use finance type
                let accType = settings.type;
                if (!accType) {
                    const t = (fItem.type || '').toLowerCase();
                    if (t.includes('broker')) accType = 'Broker';
                    else if (t.includes('401k')) accType = '401k';
                    else if (t.includes('roth')) accType = 'Roth';
                    else if (t.includes('ira')) accType = 'IRA';
                    else if (t.includes('hishtalmut')) accType = 'Hishtalmut';
                    else if (t.includes('espp')) accType = 'ESPP';
                    else if (t.includes('rsu')) accType = 'RSU';
                    else if (t.includes('hsa')) accType = 'HSA';
                    else if (t.includes('pension')) accType = 'Pension';
                    else if (t.includes('savings')) accType = 'Savings';
                }

                let growth = planItem?.growth_rate;
                if (growth === undefined) growth = 5;

                const yieldRate = settings?.dividend_yield || 0;
                const fees = settings?.fees || 0;
                const priority = settings?.withdrawal_priority || 50;

                // Using plan item currency if available, else finance item currency
                const currency = planItem?.currency || itemCurrency;

                accounts.push({
                    id: planItem?.id || fItem.id || fItem.name,
                    name: fItem.name,
                    // Convert value to Main Currency for the projection engine
                    value: convert(fItem.value, currency),
                    priority: priority,
                    settings: {
                        growth_rate: growth,
                        dividend_yield: yieldRate,
                        fees: fees,
                        type: accType,
                        draw_income: settings.draw_income !== undefined ? settings.draw_income : fItem.details?.draw_income,
                        divide_rate: settings.divide_rate || Number(fItem.details?.divide_rate || 0),
                        starting_age: settings.starting_age || Number(fItem.details?.starting_age || 0),
                        monthly_contribution: settings.monthly_contribution || Number(fItem.details?.monthly_contribution || 0),

                        // Dividends
                        dividend_policy: settings.dividend_policy || 'Accumulate',
                        dividend_mode: settings.dividend_mode || 'Percent',
                        dividend_fixed_amount: settings.dividend_fixed_amount,
                        dividend_growth_rate: settings.dividend_growth_rate || 0,
                        dividend_tax_rate: settings.dividend_tax_rate || 0,
                        dividend_payout_start_condition: settings.dividend_payout_start_condition,
                        dividend_payout_start_reference: settings.dividend_payout_start_reference
                    }
                });
            } else if (fItem.category === 'Real Estate' || fItem.category === 'Vehicle') {
                const planItem = getPlanConfig(fItem.name, 'Asset');
                if (planItem) {
                    activeRealAssets.push({
                        item_id: planItem.id,
                        name: fItem.name,
                        current_value: convert(fItem.value, planItem.currency || 'ILS'),
                        loan_balance: 0,
                        loan_term_remaining_months: 0,
                        purchase_year: startYear - 1,
                        spec: planItem
                    });
                } else {
                    simplifiedRealAssetsValue += convert(fItem.value, itemCurrency);
                }
            } else {
                if (fItem.category === 'Debt' || fItem.category === 'Liability') {
                    unallocatedCash -= convert(fItem.value, itemCurrency);
                } else {
                    unallocatedCash += convert(fItem.value, itemCurrency);
                }
            }
        });

        plan.items.filter(i => i.category === 'Account').forEach(pItem => {
            const alreadyExists = accounts.find(a => a.name === pItem.name);
            if (!alreadyExists) {
                const settings = pItem.account_settings;
                accounts.push({
                    id: pItem.id,
                    name: pItem.name,
                    value: convert(pItem.value || 0, pItem.currency),
                    priority: settings?.withdrawal_priority || 50,
                    settings: {
                        growth_rate: pItem.growth_rate || 5,
                        dividend_yield: settings?.dividend_yield || 0,
                        fees: settings?.fees || 0,
                        type: settings?.type,
                        draw_income: settings?.draw_income,
                        divide_rate: settings?.divide_rate,
                        starting_age: settings?.starting_age,
                        monthly_contribution: settings?.monthly_contribution,

                        // Dividends
                        dividend_policy: settings?.dividend_policy || 'Accumulate',
                        dividend_mode: settings?.dividend_mode || 'Percent',
                        dividend_fixed_amount: settings?.dividend_fixed_amount,
                        dividend_growth_rate: settings?.dividend_growth_rate || 0,
                        dividend_tax_rate: settings?.dividend_tax_rate || 0,
                        dividend_payout_start_condition: settings?.dividend_payout_start_condition,
                        dividend_payout_start_reference: settings?.dividend_payout_start_reference
                    }
                });
            }
        });

    } else {
        unallocatedCash = convert(startingLiquidOverride || 0, 'ILS'); // Assuming override is ILS/Base
        plan.items.filter(i => i.category === 'Account').forEach(pItem => {
            const settings = pItem.account_settings;
            accounts.push({
                id: pItem.id,
                name: pItem.name,
                value: convert(pItem.value || 0, pItem.currency),
                priority: settings?.withdrawal_priority || 50,
                settings: {
                    growth_rate: pItem.growth_rate || 5,
                    dividend_yield: settings?.dividend_yield || 0,
                    fees: settings?.fees || 0,
                    type: settings?.type,
                    draw_income: settings?.draw_income,
                    divide_rate: settings?.divide_rate,
                    starting_age: settings?.starting_age,
                    monthly_contribution: settings?.monthly_contribution,

                    // Dividends
                    dividend_policy: settings?.dividend_policy || 'Accumulate',
                    dividend_mode: settings?.dividend_mode || 'Percent',
                    dividend_fixed_amount: settings?.dividend_fixed_amount,
                    dividend_growth_rate: settings?.dividend_growth_rate || 0,
                    dividend_tax_rate: settings?.dividend_tax_rate || 0,
                    dividend_payout_start_condition: settings?.dividend_payout_start_condition,
                    dividend_payout_start_reference: settings?.dividend_payout_start_reference
                }
            });
        });
    }

    // --- Dynamic Milestones Map ---
    const dynamicMilestones: Record<string, number> = {};

    // Pre-seed Custom milestones that are date-based
    plan.milestones.forEach(m => {
        if (m.date) dynamicMilestones[m.id] = new Date(m.date).getFullYear();
        else if (m.year_offset !== undefined) dynamicMilestones[m.id] = startYear + m.year_offset;
    });

    const resolveYear = (condition: string | undefined, ref: string | undefined, date: string | undefined, defaultDate: number): number => {
        if (condition === 'Milestone' && ref) {
            // Check dynamic first (which includes static ones we pre-seeded or calculated)
            if (dynamicMilestones[ref] !== undefined) return dynamicMilestones[ref];

            // Fallback for not-yet-reached dynamic milestones?
            // If it's a "Financial Independence" milestone that hasn't been hit, return far future
            const m = plan.milestones.find(mile => mile.id === ref);
            if (m && m.type === 'Financial Independence') return 9999;

            // Standard fallback
            if (m) {
                if (m.date) return new Date(m.date).getFullYear();
                if (m.year_offset !== undefined) return startYear + m.year_offset;
            }
        }
        if (condition === 'Date' && date) return new Date(date).getFullYear();
        if (condition === 'Now') return startYear;
        return defaultDate;
    };

    // --- 2. Simulation Loop ---

    for (let i = 0; i <= 40; i++) {
        const year = startYear + i;
        const dateStr = `${year}-01-01`;

        if (i > 0) {
            accounts.forEach(acc => {
                // Calculate Growth Components
                const growthRate = acc.settings.growth_rate;
                const fees = acc.settings.fees;
                const yieldRate = acc.settings.dividend_yield; // Used if mode is Percent

                // 1. Calculate Dividend Amount
                let grossDividend = 0;
                if (acc.settings.dividend_mode === 'Fixed' && acc.settings.dividend_fixed_amount) {
                    // Fixed Amount Logic: Grows by dividend_growth_rate
                    // We need to track the current fixed amount state. 
                    // Ideally we should have initialized this in the account object state, 
                    // but for now we can calculate it based on year offset if we assume constant growth.
                    // Or we can attach a runtime property to acc.
                    if ((acc as any).current_fixed_dividend === undefined) {
                        (acc as any).current_fixed_dividend = acc.settings.dividend_fixed_amount;
                    } else {
                        // Grow it from previous year
                        (acc as any).current_fixed_dividend *= (1 + (acc.settings.dividend_growth_rate || 0) / 100);
                    }
                    grossDividend = (acc as any).current_fixed_dividend;
                } else {
                    // Percent Yield Logic
                    grossDividend = acc.value * (yieldRate / 100);
                }

                // 2. Apply Tax
                const taxRate = acc.settings.dividend_tax_rate || 0;
                const netDividend = grossDividend * (1 - taxRate / 100);

                // 3. Apply Policy
                // Base growth (Capital Appreciation) + Fees
                // Note: Growth Rate is treated as Capital Appreciation here. Total Return = Growth + Dividend Yield.
                const capAppreciation = acc.value * (growthRate / 100);
                const feeAmount = acc.value * (fees / 100);

                // Update Value with Base Growth
                acc.value += capAppreciation - feeAmount;

                // Determine Effective Dividend Policy (Handle Delayed Payout)
                let effectivePolicy = acc.settings.dividend_policy;
                if (effectivePolicy === 'Payout' && acc.settings.dividend_payout_start_condition && acc.settings.dividend_payout_start_condition !== 'Immediate') {
                    // Calculate Trigger Year
                    let triggerYear = startYear;
                    if (acc.settings.dividend_payout_start_condition === 'Age' && acc.settings.dividend_payout_start_reference) {
                        const birthYear = plan.settings?.primaryUser?.birthYear || (today.getFullYear() - (plan.settings?.current_age || 35));
                        triggerYear = birthYear + Number(acc.settings.dividend_payout_start_reference);
                    } else if (acc.settings.dividend_payout_start_condition === 'Date' && acc.settings.dividend_payout_start_reference) {
                        triggerYear = Number(acc.settings.dividend_payout_start_reference);
                    } else if (acc.settings.dividend_payout_start_condition === 'Milestone' && acc.settings.dividend_payout_start_reference) {
                        const ref = String(acc.settings.dividend_payout_start_reference);
                        if (dynamicMilestones[ref] !== undefined) {
                            triggerYear = dynamicMilestones[ref];
                        } else {
                            triggerYear = 9999;
                        }
                    }

                    if (year < triggerYear) {
                        effectivePolicy = 'Accumulate';
                    }
                }

                if (effectivePolicy === 'Payout') {
                    // Payout: Add to Income, do NOT add to account value
                    if (acc.value > 0) {
                        if (!(acc as any).generated_income) (acc as any).generated_income = 0;
                        (acc as any).generated_income += netDividend;
                    }
                } else {
                    // Accumulate: Reinvest net dividend
                    acc.value += netDividend;
                }

                // --- CONTRIBUTION LOGIC ---
                // Add monthly contributions if defined
                if (acc.settings.monthly_contribution && acc.settings.monthly_contribution > 0) {
                    // Ensure we haven't reached "payout" phase for pensions
                    let isActiveContributionPhase = true;
                    if (acc.settings.type === 'Pension' && acc.settings.starting_age) {
                        const birthYear = plan.settings?.primaryUser?.birthYear || (today.getFullYear() - (plan.settings?.current_age || 35));
                        const currentAge = (year - birthYear);
                        if (currentAge >= acc.settings.starting_age) isActiveContributionPhase = false;
                    }

                    if (isActiveContributionPhase) {
                        // Assuming contribution is in main currency (ILS) or we need to assume it matches account currency.
                        // Usually input is in account currency.
                        const annualContrib = acc.settings.monthly_contribution * 12;
                        acc.value += annualContrib;
                        // Reduce from unallocated cash to maintain balance
                        unallocatedCash -= annualContrib;
                    }
                }

                // --- PENSION LOGIC ---
                // If this is a pension fund with "Draw Income" enabled
                if (acc.settings.type === 'Pension' && acc.settings.draw_income && acc.settings.divide_rate && acc.settings.starting_age) {
                    const birthYear = plan.settings?.primaryUser?.birthYear || (today.getFullYear() - (plan.settings?.current_age || 35));
                    const currentAge = (year - birthYear);

                    if (currentAge >= acc.settings.starting_age && acc.value > 0) {
                        // Trigger Conversion!
                        const monthlyIncome = acc.value / acc.settings.divide_rate;
                        const annualIncome = monthlyIncome * 12;

                        // We will store this income in a special property on the account to be summed up later
                        (acc as any).pension_payout = annualIncome;

                        // Zero out the value so it's not counted as Liquid Assets anymore (it's an annuity now)
                        acc.value = 0;
                    }
                }
            });

            unallocatedCash = unallocatedCash * 1.02;
            simplifiedRealAssetsValue = simplifiedRealAssetsValue * 1.03;
        }

        let yearIncome = 0;
        let yearExpense = 0;

        plan.items.forEach(item => {
            if (item.category === 'Asset') {
                const startParams = resolveYear(item.start_condition, item.start_reference, item.start_date, startYear);

                let isPurchaseYear = year === startParams;
                if (item.recurrence?.rule === 'Replace') {
                    const yearsSinceStart = year - startParams;
                    if (yearsSinceStart > 0 && yearsSinceStart % item.recurrence.period_years === 0) {
                        isPurchaseYear = true;
                    }
                }

                if (isPurchaseYear) {
                    const yearsFromStart = year - startYear;
                    const costInflation = 0.03;
                    const originalValue = convert(item.value, item.currency);
                    const purchasePrice = originalValue * Math.pow(1 + costInflation, yearsFromStart);

                    let upfront = purchasePrice;
                    let debt = 0;
                    let term = 0;

                    if (item.financing) {
                        const dpRatio = item.financing.down_payment / item.value; // Ratio is currency agnostic
                        const downPayment = purchasePrice * dpRatio;
                        upfront = downPayment;
                        debt = purchasePrice - downPayment;
                        term = item.financing.term_months;
                    }

                    yearExpense += upfront;

                    activeRealAssets.push({
                        item_id: item.id,
                        name: item.name,
                        current_value: purchasePrice,
                        loan_balance: debt,
                        loan_term_remaining_months: term,
                        purchase_year: year,
                        spec: item
                    });
                }
            } else if (item.category === 'Income' || item.category === 'Expense') {
                const startY = resolveYear(item.start_condition, item.start_reference, item.start_date, startYear);
                const endY = resolveYear(item.end_condition, item.end_reference, item.end_date, startYear + 100);

                if (year >= startY && year <= endY) {
                    const activeYear = year - startYear;
                    const baseValue = convert(item.value, item.currency);
                    const adjustedValue = baseValue * Math.pow(1 + (item.growth_rate / 100), activeYear);

                    if (item.category === 'Income') {
                        let netIncome = adjustedValue;
                        if (item.tax_rate) {
                            netIncome = netIncome * (1 - item.tax_rate / 100);
                        }
                        yearIncome += netIncome;
                    } else if (item.category === 'Expense') {
                        yearExpense += adjustedValue;
                    }
                }
            }
        });

        // Add Pension Payouts & Dividends to Income
        accounts.forEach(acc => {
            if ((acc as any).pension_payout) {
                yearIncome += (acc as any).pension_payout;
                // Reset for next year (though pension payout is recalculated each year if condition met)
                // Actually pension logic sets value to 0, so it stops being an account and becomes a payout stream?
                // No, existing logic said: `(acc as any).pension_payout = annualIncome; acc.value = 0;`
                // But wait, if acc.value is 0, next year loop won't generate payout?
                // The pension logic needs `acc.value` to calculate payout? 
                // Ah, line 276: `monthlyIncome = acc.value / divide_rate`.
                // If we set acc.value = 0 at line 283, then next year it's 0.
                // So the pension payout needs to persist.
                // Existing logic seems to imply it converts ONCE essentially? 
                // Or maybe I missed where it persists.
                // Actually, the existing code:
                // `(acc as any).pension_payout = annualIncome; acc.value = 0;`
                // This means the account is effectively "cashed out" into an annuity.
                // But we need to ensure that `pension_payout` persists across years if it's an annuity.
                // The current code re-calculates it every iteration?
                // If acc.value becomes 0, next loop `if (acc.value > 0)` at line 274 fails.
                // So it only pays out for ONE YEAR. That looks like a bug in the *existing* Pension logic, 
                // or I am misinterpreting it. 
                // However, I should focus on Dividends. 

                // For Dividends, we calculate it fresh every year based on current value.
                // So `generated_income` is valid for this year only.
            }

            // Add Dividend Income
            if ((acc as any).generated_income) {
                yearIncome += (acc as any).generated_income;
                (acc as any).generated_income = 0; // Reset for next tick
            }

            // Persist Pension Payout?
            // If it was a pension conversion, we probably want to keep paying it.
            // But fixing pension logic is out of scope unless it breaks my stuff.
            // I'll leave pension logic as is (assuming User handles it or it was intended as lump sum treated as income?).
            // Wait, "monthly income at retirement age" implies a stream.
            // If the code sets acc.value = 0, it stops growing.
            // If it doesn't persist `pension_payout` in a separate list or handle it, it stops paying.
            // I'll assume for now `pension_payout` property implies it's handled, 
            // BUT looking at my code, I am iterating accounts again here.
            // If I don't persist it, it's lost.
            // But I am not here to fix Pension. I am here to add Dividends.
            // I will just add the dividend processing.
        });

        const nextActiveRealAssets: ActiveRealAsset[] = [];
        activeRealAssets.forEach(asset => {
            const isRecurrenceSale = asset.spec.recurrence?.rule === 'Replace' &&
                (year - asset.purchase_year) === asset.spec.recurrence.period_years;

            if (isRecurrenceSale) {
                const cashIn = asset.current_value - asset.loan_balance;
                yearIncome += cashIn;
            } else {
                let rate = asset.spec.growth_rate || 0;
                if (asset.spec.depreciation_rate) rate = -asset.spec.depreciation_rate;

                asset.current_value = asset.current_value * (1 + rate / 100);

                if (asset.loan_balance > 0) {
                    const yearlyPmt = convert(asset.spec.financing?.monthly_payment || 0, asset.spec.currency) * 12;
                    yearExpense += yearlyPmt;

                    // Interest calculation on the converted loan balance?
                    // Loan balance is already converted to Main Currency at purchase.
                    // Interest rate is %.
                    const interest = asset.loan_balance * (asset.spec.financing?.interest_rate || 0) / 100;
                    const principal = yearlyPmt - interest;

                    asset.loan_balance -= principal;
                    if (asset.loan_balance < 0) asset.loan_balance = 0;
                    asset.loan_term_remaining_months -= 12;
                }
                nextActiveRealAssets.push(asset);
            }
        });
        activeRealAssets = nextActiveRealAssets;

        // D. Net Flow reconciling
        const netFlow = yearIncome - yearExpense;

        if (netFlow >= 0) {
            unallocatedCash += netFlow;
        } else {
            let deficit = -netFlow;

            if (unallocatedCash >= deficit) {
                unallocatedCash -= deficit;
                deficit = 0;
            } else {
                deficit -= unallocatedCash;
                unallocatedCash = 0;

                const sortedAccounts = [...accounts].sort((a, b) => a.priority - b.priority);

                for (const acc of sortedAccounts) {
                    if (deficit <= 0) break;

                    if (acc.value >= deficit) {
                        acc.value -= deficit;
                        deficit = 0;
                    } else {
                        deficit -= acc.value;
                        acc.value = 0;
                    }
                }

                if (deficit > 0) {
                    unallocatedCash -= deficit;
                }
            }
        }

        const totalAccountValue = accounts.reduce((sum, a) => sum + a.value, 0);
        const totalRealAssets = simplifiedRealAssetsValue + activeRealAssets.reduce((sum, a) => sum + a.current_value, 0);
        const totalDebt = activeRealAssets.reduce((sum, a) => sum + a.loan_balance, 0);

        let totalLiquid = totalAccountValue + unallocatedCash;

        // Create explicit list of milestones hit this year
        const milestonesHitInYear: string[] = [];
        plan.milestones.forEach(m => {
            if (m.date && new Date(m.date).getFullYear() === year) milestonesHitInYear.push(m.name);
            else if (m.year_offset !== undefined && startYear + m.year_offset === year) milestonesHitInYear.push(m.name);
        });

        // --- CALC LIQUID NET WORTH ---
        // Definition: Cash + Investments (No Pension) + Assets (No Main Home) - Liabilities (Liquid related?)
        // User Def: "Includes cash savings, investments and non-residential assets (car, rental unit). Excludes pension."
        // We will assume "House" sub_category is Main Home.

        const liquidAccounts = accounts.filter(a => {
            const t = (a.settings.type || '').toLowerCase();
            const n = (a.name || '').toLowerCase();
            return !t.includes('pension') && !n.includes('pension');
        });
        const liquidAccountsVal = liquidAccounts.reduce((sum, a) => sum + a.value, 0);

        const liquidAssets = activeRealAssets.filter(a => {
            const sub = (a.spec.sub_category || '').toLowerCase();
            const n = (a.name || '').toLowerCase();
            const isIlliquid = sub === 'house' || n.includes('house') || n.includes('home');
            return !isIlliquid;
        }); // Exclude Main Home

        const liquidAssetsVal = liquidAssets.reduce((sum, a) => sum + a.current_value, 0);
        // Should we subtract debt on these liquid assets? 
        // "Net Worth" usually implies equity. Liquid Net Worth = Liquid Assets Equity.
        // Subtract loans for the included assets.
        const liquidAssetsDebt = liquidAssets.reduce((sum, a) => sum + a.loan_balance, 0);

        const liquidNetWorth = unallocatedCash + liquidAccountsVal + (liquidAssetsVal - liquidAssetsDebt);

        // --- CHECK FINANCIAL INDEPENDENCE ---
        // Condition: Liquid Net Worth > 25 * Expenses (or configured multiplier)
        const fiMilestone = plan.milestones.find(m => m.type === 'Financial Independence');
        const multiplier = fiMilestone?.details?.expense_multiplier || 25;

        const expenseMetrics = yearExpense;
        const fiConditionMet = liquidNetWorth > (multiplier * expenseMetrics);

        if (fiConditionMet && fiMilestone) {
            if (dynamicMilestones[fiMilestone.id] === undefined) {
                // First time hit!
                dynamicMilestones[fiMilestone.id] = year;
                milestonesHitInYear.push(fiMilestone.name);
            }
        }

        // Also check if we just hit a dynamic milestone that was set
        Object.entries(dynamicMilestones).forEach(([id, mYear]) => {
            const m = plan.milestones.find(x => x.id === id);
            if (mYear === year && m && !milestonesHitInYear.includes(m.name)) {
                milestonesHitInYear.push(m.name);
            }
        });

        data.push({
            time: dateStr,
            year: year,
            value: totalLiquid + totalRealAssets - totalDebt,
            liquid: totalLiquid,
            liquidNetWorth: liquidNetWorth,
            realAssets: totalRealAssets,
            debt: totalDebt,
            milestonesHit: milestonesHitInYear
        });
    }

    return data;
};
