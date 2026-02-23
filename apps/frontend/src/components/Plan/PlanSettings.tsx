import React from 'react';
import { CurrencySelector } from '../Common/CurrencySelector';

interface Props {
    settings: any;
    onChange: (settings: any) => void;
}

export const PlanSettings: React.FC<Props> = ({ settings, onChange }) => {

    const updateSetting = (key: string, value: any) => {
        onChange({ ...settings, [key]: value });
    };

    return (
        <div className="space-y-6">
            <div className="bg-slate-900 p-6 rounded-lg border border-slate-800">
                <h3 className="text-lg font-semibold text-slate-200 mb-4">Plan Settings</h3>

                <div className="space-y-6">
                    {/* Main Currency */}
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">
                            Main Currency
                        </label>
                        <div className="flex items-center gap-4">
                            <CurrencySelector
                                value={settings.main_currency || 'ILS'}
                                onChange={c => updateSetting('main_currency', c)}
                                className="w-40"
                            />
                            <p className="text-sm text-slate-500">
                                This currency will be used as the default for new items and for the main dashboard display.
                            </p>
                        </div>
                    </div>

                    {/* Future settings can go here */}
                </div>
            </div>
        </div>
    );
};
