import { PlanData, PlanItem } from './types';

export interface ProjectionPoint {
    time: string;
    value: number;
    liquid: number;
    realAssets: number;
    debt: number;
    year: number;
}

export const calculateProjection = (
    plan: PlanData, 
    finances: any = null, // Finance Snapshot
    startingLiquidOverride: number | null = null // Optional fallback if finances not provided
): ProjectionPoint[] => {
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
            if (fItem.category === 'Savings' || fItem.category === 'Investments') {
                const planItem = getPlanConfig(fItem.name, 'Account');
                const settings = planItem?.account_settings;
                
                let growth = planItem?.growth_rate; 
                if (growth === undefined) growth = 5;

                const yieldRate = settings?.dividend_yield || 0;
                const fees = settings?.fees || 0;
                const priority = settings?.withdrawal_priority || 50;
                
                accounts.push({
                    id: planItem?.id || fItem.id || fItem.name,
                    name: fItem.name,
                    value: fItem.value,
                    priority: priority,
                    settings: {
                        growth_rate: growth,
                        dividend_yield: yieldRate,
                        fees: fees
                    }
                });
            } else if (fItem.category === 'Real Estate' || fItem.category === 'Vehicle') {
                const planItem = getPlanConfig(fItem.name, 'Asset');
                if (planItem) {
                    activeRealAssets.push({
                        item_id: planItem.id,
                        name: fItem.name,
                        current_value: fItem.value,
                        loan_balance: 0, 
                        loan_term_remaining_months: 0,
                        purchase_year: startYear - 1,
                        spec: planItem
                    });
                } else {
                    simplifiedRealAssetsValue += fItem.value;
                }
            } else {
                if (fItem.category === 'Debt' || fItem.category === 'Liability') {
                    unallocatedCash -= fItem.value; 
                } else {
                   unallocatedCash += fItem.value;
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
                    value: pItem.value || 0,
                    priority: settings?.withdrawal_priority || 50,
                    settings: {
                        growth_rate: pItem.growth_rate || 5,
                        dividend_yield: settings?.dividend_yield || 0,
                        fees: settings?.fees || 0
                    }
                });
            }
        });

    } else {
        unallocatedCash = startingLiquidOverride || 0;
         plan.items.filter(i => i.category === 'Account').forEach(pItem => {
             const settings = pItem.account_settings;
             accounts.push({
                 id: pItem.id,
                 name: pItem.name,
                 value: pItem.value || 0,
                 priority: settings?.withdrawal_priority || 50,
                 settings: {
                     growth_rate: pItem.growth_rate || 5,
                     dividend_yield: settings?.dividend_yield || 0,
                     fees: settings?.fees || 0
                 }
             });
         });
    }

    const resolveYear = (condition: string | undefined, ref: string | undefined, date: string | undefined, defaultDate: number): number => {
        if (condition === 'Milestone' && ref) {
            const m = plan.milestones.find(mile => mile.id === ref);
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
                const totalReturn = acc.settings.growth_rate + acc.settings.dividend_yield - acc.settings.fees;
                acc.value = acc.value * (1 + totalReturn / 100);
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
                    const purchasePrice = item.value * Math.pow(1 + costInflation, yearsFromStart);
                    
                    let upfront = purchasePrice;
                    let debt = 0;
                    let term = 0;
                    
                    if (item.financing) {
                         const dpRatio = item.financing.down_payment / item.value;
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
                    const adjustedValue = item.value * Math.pow(1 + (item.growth_rate / 100), activeYear);
                    
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
                    const yearlyPmt = (asset.spec.financing?.monthly_payment || 0) * 12;
                    yearExpense += yearlyPmt;
                    
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
                
                const sortedAccounts = [...accounts].sort((a,b) => a.priority - b.priority);
                
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
        
        data.push({
            time: dateStr,
            year: year,
            value: totalLiquid + totalRealAssets - totalDebt,
            liquid: totalLiquid,
            realAssets: totalRealAssets,
            debt: totalDebt
        });
    }

    return data;
};
