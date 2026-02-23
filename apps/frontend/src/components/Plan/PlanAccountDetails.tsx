import React from 'react';
import { PlanItem, PlanMilestone } from './types';
import { CurrencySelector } from '../Common/CurrencySelector';

interface Props {
    item: PlanItem;
    onChange: (updates: Partial<PlanItem>) => void;
    mode?: 'planning' | 'snapshot';
    milestones?: PlanMilestone[];
}

export const PlanAccountDetails: React.FC<Props> = ({ item, onChange, mode = 'planning', milestones = [] }) => {

    const defaults = {
        type: 'Taxable' as const,
        bond_allocation: 0,
        dividend_yield: 0,
        fees: 0,
        withdrawal_priority: 1
    };

    // Merge defaults to avoid uncontrolled inputs if keys are missing
    const settings = { ...defaults, ...(item.account_settings || {}) } as NonNullable<PlanItem['account_settings']>;

    const updateSettings = (updates: Partial<typeof settings>) => {
        onChange({ account_settings: { ...settings, ...updates } });
    };

    const handleNumChange = (field: keyof typeof settings, valStr: string) => {
        const val = parseFloat(valStr);
        updateSettings({ [field]: isNaN(val) ? 0 : val });
    };

    // Auto-calculate Value for RSU if Price and Vested Data exists
    React.useEffect(() => {
        if (settings.type === 'RSU' && settings.current_price && settings.rsu_grants) {
            const totalVested = settings.rsu_grants.reduce((sum, g) => sum + (g.vested || 0), 0);
            const computedValue = totalVested * settings.current_price;
            if (computedValue !== item.value) {
                onChange({ value: computedValue });
            }
        }
    }, [settings.current_price, settings.rsu_grants, settings.type]);

    const totalVestedSinceParams = React.useMemo(() => {
        if (settings.type !== 'RSU') return 0;
        return (settings.rsu_grants || []).reduce((sum, g) => sum + (g.vested || 0), 0);
    }, [settings.rsu_grants, settings.type]);

    // Helper to fetch data
    const fetchMarketData = async (symbol: string, type: 'price' | 'yield') => {
        try {
            const res = await fetch(`/api/finances/price/${symbol}`);
            if (!res.ok) throw new Error('Failed to fetch');
            const data = await res.json();

            if (type === 'price' && data.price) {
                updateSettings({ current_price: data.price });
            }
            if (type === 'yield' && data.dividend_yield !== undefined) {
                updateSettings({ dividend_yield: data.dividend_yield });
            }
        } catch (e) {
            console.error(e);
        }
    };

    // Auto-fetch Price in Snapshot Mode when symbol changes
    React.useEffect(() => {
        if (mode === 'snapshot' && settings.type === 'RSU' && settings.stock_symbol && settings.stock_symbol.length > 1) {
            const timer = setTimeout(() => {
                fetchMarketData(settings.stock_symbol!, 'price');
            }, 800);
            return () => clearTimeout(timer);
        }
    }, [settings.stock_symbol, mode, settings.type]);

    // Auto-fetch Yield in Planning Mode on mount
    React.useEffect(() => {
        if (mode === 'planning' && settings.type === 'RSU' && settings.stock_symbol) {
            fetchMarketData(settings.stock_symbol, 'yield');
        }
    }, [mode, settings.type, settings.stock_symbol]);

    return (
        <div className="space-y-4">
            {/* Value & Type */}
            <div className="bg-slate-800 p-4 rounded-lg space-y-3 border border-slate-700">
                <h4 className="flex justify-between items-center text-sm font-semibold text-slate-300">
                    <span className="flex items-center gap-2">💰 Account Details</span>
                    {item.isLinked && (
                        <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded-full border border-emerald-500/20 flex items-center gap-1">
                            <span className="animate-pulse w-1 h-1 rounded-full bg-emerald-400" />
                            Synced from Dashboard
                        </span>
                    )}
                </h4>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <div className="flex justify-between items-end mb-1">
                            <label className="text-xs text-slate-400">Current Balance</label>
                            {item.isLinked && <span className="text-[10px] text-emerald-500/70 font-mono">Live Sync</span>}
                        </div>
                        {settings.type === 'RSU' ? (
                            <div className="bg-slate-900 border border-slate-700 rounded p-2 text-slate-400 cursor-not-allowed">
                                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(item.value ?? 0)}
                                <span className="ml-2 text-xs text-slate-500">(Calculated)</span>
                            </div>
                        ) : (
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    className={`w-full bg-slate-900 border-slate-700 rounded p-2 text-white ${item.isLinked ? 'border-emerald-500/30 focus:ring-emerald-500/50' : ''}`}
                                    value={item.value ?? 0}
                                    onChange={e => {
                                        const val = parseFloat(e.target.value);
                                        onChange({ value: isNaN(val) ? 0 : val });
                                    }}
                                />
                                <CurrencySelector
                                    value={item.currency || 'ILS'}
                                    onChange={c => onChange({ currency: c })}
                                    className="w-24 shrink-0"
                                />
                            </div>
                        )}
                    </div>
                    <div>
                        <label className="text-xs text-slate-400">Account Type</label>
                        <select
                            className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                            value={settings.type}
                            onChange={e => updateSettings({ type: e.target.value as any })}
                        >
                            <option value="Taxable">Taxable (Generic)</option>
                            <option value="Broker">Brokerage</option>
                            <option value="ESPP">ESPP</option>
                            <option value="RSU">RSU</option>
                            <option value="401k">401k / 403b</option>
                            <option value="Roth">Roth IRA</option>
                            <option value="IRA">Traditional IRA</option>
                            <option value="Hishtalmut">Hishtalmut Fund</option>
                            <option value="HSA">HSA</option>
                            <option value="Savings">Savings / Cash</option>
                            <option value="Pension">Pension Fund</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* SAVINGS SPECIFIC FIELDS */}
            {settings.type === 'Savings' && (
                <div className="bg-slate-800 p-4 rounded-lg space-y-3 border border-slate-700 animate-in fade-in slide-in-from-top-2 duration-300">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                        🐷 Savings Profile
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-slate-400">Savings Goal</label>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                    placeholder="e.g. 50000"
                                    value={settings.savings_goal ?? ''}
                                    onChange={e => handleNumChange('savings_goal', e.target.value)}
                                />
                            </div>
                            <p className="text-xs text-slate-500 mt-1">Target savings amount</p>
                        </div>
                        <div>
                            <label className="text-xs text-slate-400">Max Drawdown (%)</label>
                            <input
                                type="number"
                                step="1"
                                className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                placeholder="e.g. 25"
                                value={settings.max_drawdown ?? ''}
                                onChange={e => handleNumChange('max_drawdown', e.target.value)}
                            />
                            <p className="text-xs text-slate-500 mt-1">Allowable drawdown limit</p>
                        </div>
                    </div>
                </div>
            )}

            {/* PENSION SPECIFIC FIELDS */}
            {settings.type === 'Pension' && (
                <div className="bg-slate-800 p-4 rounded-lg space-y-3 border border-slate-700 animate-in fade-in slide-in-from-top-2 duration-300">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                        👴 Pension Settings
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                            <label className="text-xs text-slate-400">Managing Body</label>
                            <input
                                type="text"
                                className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white placeholder-slate-600"
                                placeholder="e.g. Migdal, Menora..."
                                value={settings.managing_body || ''}
                                onChange={e => updateSettings({ managing_body: e.target.value })}
                            />
                        </div>
                        <div className="col-span-2 flex items-center gap-3 bg-slate-900/50 p-3 rounded border border-slate-700/50">
                            <input
                                type="checkbox"
                                id="draw_income"
                                className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-violet-600 focus:ring-violet-500"
                                checked={settings.draw_income || false}
                                onChange={e => updateSettings({ draw_income: e.target.checked })}
                            />
                            <div>
                                <label htmlFor="draw_income" className="text-sm font-medium text-slate-200 block">Draw Pension Income</label>
                                <p className="text-xs text-slate-500">Convert this fund into monthly income at retirement age.</p>
                            </div>
                        </div>

                        {settings.draw_income && (
                            <>
                                <div>
                                    <label className="text-xs text-slate-400">Divide Rate (Coefficient)</label>
                                    <input
                                        type="number"
                                        className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                        placeholder="e.g. 200"
                                        value={settings.divide_rate ?? ''}
                                        onChange={e => handleNumChange('divide_rate', e.target.value)}
                                    />
                                    <p className="text-xs text-slate-500 mt-1">Fund / Rate = Monthly Income</p>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400">Starting Age</label>
                                    <input
                                        type="number"
                                        className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                        placeholder="e.g. 67"
                                        value={settings.starting_age ?? ''}
                                        onChange={e => handleNumChange('starting_age', e.target.value)}
                                    />
                                </div>
                                <div>
                                    <label className="text-xs text-slate-400">Tax Rate (%)</label>
                                    <input
                                        type="number"
                                        className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                        placeholder="e.g. 15"
                                        value={settings.tax_rate ?? ''}
                                        onChange={e => handleNumChange('tax_rate', e.target.value)}
                                    />
                                </div>
                            </>
                        )}
                        <div className="col-span-2 pt-2 border-t border-slate-700/50">
                            <label className="text-xs text-slate-400">Monthly Contribution</label>
                            <div className="flex gap-2">
                                <input
                                    type="number"
                                    className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                    placeholder="e.g. 1500"
                                    value={settings.monthly_contribution ?? ''}
                                    onChange={e => handleNumChange('monthly_contribution', e.target.value)}
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* RSU SPECIFIC FIELDS - Hide in Planning Mode */}
            {(settings.type === 'RSU' && mode !== 'planning') && (
                <div className="bg-slate-800 p-4 rounded-lg space-y-3 border border-slate-700 animate-in fade-in slide-in-from-top-2 duration-300">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                        🎫 RSU Strategy
                    </h4>

                    {/* Stock Symbol */}
                    <div>
                        <label className="text-xs text-slate-400">Stock Symbol</label>
                        <input
                            type="text"
                            className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white uppercase"
                            placeholder="e.g. GOOGL"
                            value={settings.stock_symbol || ''}
                            onChange={e => updateSettings({ stock_symbol: e.target.value.toUpperCase() })}
                        />
                    </div>

                    {/* Current Price */}
                    <div className="flex gap-4">
                        <div className="flex-1 relative">
                            <label className="text-xs text-slate-400">Current Stock Price ($)</label>
                            <input
                                type="number"
                                className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                placeholder="0.00"
                                value={settings.current_price ?? ''}
                                onChange={e => handleNumChange('current_price', e.target.value)}
                            />
                        </div>
                        <div className="flex-1">
                            <label className="text-xs text-slate-400">Total Vested Shares</label>
                            <div className="w-full bg-slate-900/50 border border-slate-700/50 rounded p-2 text-slate-300">
                                {totalVestedSinceParams}
                            </div>
                        </div>
                    </div>

                    {/* Grants List */}
                    <div className="space-y-2">
                        <label className="text-xs text-slate-400">Grants Layers</label>

                        {/* Headers */}
                        {(settings.rsu_grants && settings.rsu_grants.length > 0) && (
                            <div className="flex gap-2 px-1 mb-1">
                                <span className="text-[10px] text-slate-500 font-semibold uppercase w-20">Year</span>
                                <span className="text-[10px] text-slate-500 font-semibold uppercase w-20">Shares</span>
                                <span className="text-[10px] text-slate-500 font-semibold uppercase w-20">Vested</span>
                                <span className="text-[10px] text-slate-500 font-semibold uppercase w-20">Grant Price</span>
                            </div>
                        )}

                        <div className="space-y-2">
                            {(settings.rsu_grants || []).map((grant, index) => (
                                <div key={grant.id || index} className="flex gap-2 items-center bg-slate-900/50 p-2 rounded border border-slate-700/50">
                                    <input
                                        type="number"
                                        placeholder="Year"
                                        className="bg-slate-900 border-slate-700 rounded p-1 text-white text-xs w-20"
                                        value={grant.year}
                                        onChange={e => {
                                            const newGrants = [...(settings.rsu_grants || [])];
                                            newGrants[index] = { ...grant, year: parseInt(e.target.value) || 0 };
                                            updateSettings({ rsu_grants: newGrants });
                                        }}
                                    />
                                    <input
                                        type="number"
                                        placeholder="Shares"
                                        className="bg-slate-900 border-slate-700 rounded p-1 text-white text-xs w-20"
                                        value={grant.shares}
                                        onChange={e => {
                                            const newGrants = [...(settings.rsu_grants || [])];
                                            newGrants[index] = { ...grant, shares: parseFloat(e.target.value) };
                                            updateSettings({ rsu_grants: newGrants });
                                        }}
                                    />
                                    <input
                                        type="number"
                                        placeholder="Vested"
                                        className="bg-slate-900 border-slate-700 rounded p-1 text-white text-xs w-20"
                                        value={grant.vested}
                                        onChange={e => {
                                            const newGrants = [...(settings.rsu_grants || [])];
                                            newGrants[index] = { ...grant, vested: parseFloat(e.target.value) };
                                            updateSettings({ rsu_grants: newGrants });
                                        }}
                                    />
                                    <input
                                        type="number"
                                        placeholder="Price $"
                                        className="bg-slate-900 border-slate-700 rounded p-1 text-white text-xs w-20"
                                        value={grant.price}
                                        onChange={e => {
                                            const newGrants = [...(settings.rsu_grants || [])];
                                            newGrants[index] = { ...grant, price: parseFloat(e.target.value) };
                                            updateSettings({ rsu_grants: newGrants });
                                        }}
                                    />
                                    <button
                                        onClick={() => {
                                            const newGrants = (settings.rsu_grants || []).filter((_, i) => i !== index);
                                            updateSettings({ rsu_grants: newGrants });
                                        }}
                                        className="text-slate-500 hover:text-red-400 w-6 h-6 flex items-center justify-center"
                                        title="Remove Grant"
                                    >
                                        ✕
                                    </button>
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={() => {
                                const newGrants = [...(settings.rsu_grants || []), { id: crypto.randomUUID(), year: new Date().getFullYear(), shares: 0, vested: 0, price: 0 }];
                                updateSettings({ rsu_grants: newGrants });
                            }}
                            className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1 mt-2"
                        >
                            + Add Grant Layer
                        </button>
                    </div>
                </div>
            )}

            {/* Growth & Allocation - Hide in Snapshot Mode, and simplify for Pension and Savings */}
            {mode === 'planning' && settings.type !== 'Savings' && (
                <div className="bg-slate-800 p-4 rounded-lg space-y-3 border border-slate-700">
                    <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                        📈 Investment Profile
                    </h4>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs text-slate-400">Planned Growth Rate (%)</label>
                            <input
                                type="number"
                                step="0.1"
                                className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                value={item.growth_rate ?? 0}
                                onChange={e => {
                                    const val = parseFloat(e.target.value);
                                    onChange({ growth_rate: isNaN(val) ? 0 : val });
                                }}
                            />
                            <p className="text-xs text-slate-500 mt-1">Expected annual return</p>
                        </div>
                        {settings.type !== 'Pension' && (
                            <>
                                {settings.type !== 'RSU' && (
                                    <div>
                                        <label className="text-xs text-slate-400">Bond Allocation (%)</label>
                                        <input
                                            type="number"
                                            step="1"
                                            className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                            value={settings.bond_allocation ?? 0}
                                            onChange={e => handleNumChange('bond_allocation', e.target.value)}
                                        />
                                    </div>
                                )}
                                <div className="relative">
                                    <label className="text-xs text-slate-400">Dividend Yield (%)</label>
                                    <input
                                        type="number"
                                        step="0.1"
                                        className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                        value={settings.dividend_yield ?? 0}
                                        onChange={e => handleNumChange('dividend_yield', e.target.value)}
                                    />
                                    {settings.type === 'RSU' && settings.stock_symbol && (
                                        <span className="absolute right-2 top-8 text-[10px] text-slate-500 pointer-events-none">
                                            {settings.stock_symbol}
                                        </span>
                                    )}
                                </div>
                                {settings.type === 'RSU' && !settings.stock_symbol && (
                                    <div className="text-xs text-red-400 italic">
                                        Ticker missing. Set in Current Finances (RSU Strategy).
                                    </div>
                                )}
                            </>
                        )}
                        <div>
                            <label className="text-xs text-slate-400">Annual Fees (%)</label>
                            <input
                                type="number"
                                step="0.01"
                                className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                value={settings.fees ?? 0}
                                onChange={e => handleNumChange('fees', e.target.value)}
                            />
                        </div>
                    </div>
                </div>
            )
            }

            {/* DIVIDEND POLICY */}
            {
                mode === 'planning' && settings.type !== 'Pension' && settings.type !== 'Savings' && (
                    <div className="bg-slate-800 p-4 rounded-lg space-y-3 border border-slate-700 animate-in fade-in slide-in-from-top-2 duration-300">
                        <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
                            💵 Dividend Policy
                        </h4>

                        {/* Policy Selector */}
                        <div className="flex gap-4 p-2 bg-slate-900/50 rounded border border-slate-700/50">
                            <label className={`flex items-center gap-2 ${settings.type === 'RSU' ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}>
                                <input
                                    type="radio"
                                    name={`div_policy_${item.id}`} // Unique name per item to prevent conflicts if multiple open (though usually one editor)
                                    className="text-violet-500 bg-slate-800 border-slate-600 focus:ring-violet-500"
                                    checked={settings.dividend_policy !== 'Payout' && settings.type !== 'RSU'} // Default to Accumulate, unless RSU
                                    disabled={settings.type === 'RSU'}
                                    onChange={() => updateSettings({ dividend_policy: 'Accumulate' })}
                                />
                                <span className="text-sm text-slate-300">Reinvest (Accumulate)</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name={`div_policy_${item.id}`}
                                    className="text-violet-500 bg-slate-800 border-slate-600 focus:ring-violet-500"
                                    checked={settings.dividend_policy === 'Payout' || settings.type === 'RSU'}
                                    onChange={() => updateSettings({ dividend_policy: 'Payout' })}
                                />
                                <span className="text-sm text-slate-300">Pay Out (Income)</span>
                            </label>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            {/* Mode Selector */}
                            <div className="col-span-2">
                                <label className="text-xs text-slate-400">Calculation Mode</label>
                                <div className="flex gap-4 mt-1">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name={`div_mode_${item.id}`}
                                            className="text-violet-500 bg-slate-800 border-slate-600 focus:ring-violet-500"
                                            checked={settings.dividend_mode !== 'Fixed'}
                                            onChange={() => updateSettings({ dividend_mode: 'Percent' })}
                                        />
                                        <span className="text-xs text-slate-300">Yield %</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name={`div_mode_${item.id}`}
                                            className="text-violet-500 bg-slate-800 border-slate-600 focus:ring-violet-500"
                                            checked={settings.dividend_mode === 'Fixed'}
                                            onChange={() => updateSettings({ dividend_mode: 'Fixed' })}
                                        />
                                        <span className="text-xs text-slate-300">Fixed Amount</span>
                                    </label>
                                </div>
                            </div>

                            {settings.dividend_mode === 'Fixed' ? (
                                <div>
                                    <div className="flex justify-between items-end mb-1">
                                        <label className="text-xs text-slate-400">Annual Amount</label>
                                        {item.isLinked && <span className="text-[10px] text-emerald-500/70 font-mono">Synced</span>}
                                    </div>
                                    <input
                                        type="number"
                                        className={`w-full bg-slate-900 border-slate-700 rounded p-2 text-white ${item.isLinked ? 'border-emerald-500/30 focus:ring-emerald-500/50' : ''}`}
                                        placeholder="e.g. 10000"
                                        value={settings.dividend_fixed_amount ?? ''}
                                        onChange={e => handleNumChange('dividend_fixed_amount', e.target.value)}
                                    />
                                </div>
                            ) : (
                                <div className="bg-slate-900/30 p-2 rounded border border-slate-700/30 flex flex-col justify-center">
                                    <p className="text-xs text-slate-400">Using Yield: <span className="text-white font-mono font-bold">{settings.dividend_yield || 0}%</span></p>
                                    <p className="text-[10px] text-slate-500">Edit in Investment Profile above</p>
                                </div>
                            )}

                            <div>
                                <label className="text-xs text-slate-400">Dividend Growth Rate (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                    placeholder="e.g. 5.0"
                                    value={settings.dividend_growth_rate ?? ''}
                                    onChange={e => handleNumChange('dividend_growth_rate', e.target.value)}
                                />
                                <p className="text-xs text-slate-500 mt-1">Growth of the payout amount</p>
                            </div>

                            <div>
                                <label className="text-xs text-slate-400">Tax Rate on Dividends (%)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                    placeholder="e.g. 25"
                                    value={settings.dividend_tax_rate ?? ''}
                                    onChange={e => handleNumChange('dividend_tax_rate', e.target.value)}
                                />
                            </div>

                            {settings.dividend_policy === 'Payout' && (
                                <div className="col-span-2 border-t border-slate-700/50 pt-3 mt-1">
                                    <label className="text-xs text-slate-400 block mb-2">Payout Timing</label>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-[10px] text-slate-500">Start Condition</label>
                                            <select
                                                className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white text-sm"
                                                value={settings.dividend_payout_start_condition || 'Immediate'}
                                                onChange={e => updateSettings({ dividend_payout_start_condition: e.target.value as any })}
                                            >
                                                <option value="Immediate">Immediate</option>
                                                <option value="Age">At Age...</option>
                                                <option value="Date">At Year...</option>
                                                <option value="Milestone">At Milestone...</option>
                                            </select>
                                        </div>
                                        {settings.dividend_payout_start_condition === 'Age' && (
                                            <div className="animate-in fade-in slide-in-from-left-1">
                                                <label className="text-[10px] text-slate-500">Age</label>
                                                <input
                                                    type="number"
                                                    className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                                    placeholder="e.g. 67"
                                                    value={settings.dividend_payout_start_reference ?? ''}
                                                    onChange={e => handleNumChange('dividend_payout_start_reference', e.target.value)}
                                                />
                                            </div>
                                        )}
                                        {settings.dividend_payout_start_condition === 'Date' && (
                                            <div className="animate-in fade-in slide-in-from-left-1">
                                                <label className="text-[10px] text-slate-500">Year</label>
                                                <input
                                                    type="number"
                                                    className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white"
                                                    placeholder="e.g. 2035"
                                                    value={settings.dividend_payout_start_reference ?? ''}
                                                    onChange={e => handleNumChange('dividend_payout_start_reference', e.target.value)}
                                                />
                                            </div>
                                        )}
                                        {settings.dividend_payout_start_condition === 'Milestone' && (
                                            <div className="animate-in fade-in slide-in-from-left-1">
                                                <label className="text-[10px] text-slate-500">Milestone</label>
                                                <select
                                                    className="w-full bg-slate-900 border-slate-700 rounded p-2 text-white text-sm"
                                                    value={settings.dividend_payout_start_reference || ''}
                                                    onChange={e => updateSettings({ dividend_payout_start_reference: e.target.value })}
                                                >
                                                    <option value="" disabled>Select Milestone</option>
                                                    {milestones.map(m => (
                                                        <option key={m.id} value={m.id}>{m.name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                    <p className="text-[10px] text-slate-500 mt-1">
                                        {(!settings.dividend_payout_start_condition || settings.dividend_payout_start_condition === 'Immediate')
                                            ? "Dividends are paid out as income immediately."
                                            : "Dividends are reinvested until this condition is met, then paid out."}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )
            }


        </div >
    );
};
