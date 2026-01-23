'use client';
import React, { useMemo } from 'react';
import { ResponsiveSankey } from '@nivo/sankey';

interface Props {
    data: any; // Projection item for a specific year
}

const theme = {
    background: 'transparent',
    text: {
        fontSize: 12,
        fill: '#94a3b8', // slate-400
        fontFamily: 'monospace'
    },
    tooltip: {
        container: {
            background: '#0f172a', // slate-900
            color: '#f8fafc', // slate-50
            fontSize: 13,
            borderRadius: '6px',
            boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
            padding: '8px 12px'
        }
    }
};

export const CashFlowSankey: React.FC<Props> = ({ data }) => {


    const { nodes, links } = (() => {
        if (!data) return { nodes: [], links: [] };

        const { income, withdrawals, tax_paid, expenses: totalExpenses, income_details, expense_details, savings_details } = data;

        let nodesList: any[] = [];
        let linksList: any[] = [];
        const addedNodes = new Set<string>();

        const addNode = (id: string, color: string, label?: string) => {
            if (!addedNodes.has(id)) {
                nodesList.push({ id, nodeColor: color, label: label || id });
                addedNodes.add(id);
            }
        };

        const addLink = (source: string, target: string, value: number) => {
            if (value > 0.01) { // Filter tiny values to avoid clutter
                // Check if link already exists to sum it
                const exists = linksList.find(l => l.source === source && l.target === target);
                if (exists) {
                    exists.value += value;
                } else {
                    linksList.push({ source, target, value });
                }
            }
        };

        // --- 2. Stage: Specific Incomes -> Income Types ---
        const incomeTypes = new Set<string>();

        // Default Incomes if details missing but total exists
        const safeIncomeDetails = (income_details && income_details.length > 0)
            ? income_details
            : (income > 0 ? [{ name: 'Other Income', type: 'Other Inflows', value: income }] : []);

        safeIncomeDetails.forEach((item: any) => {
            const rawName = item.name || 'Unknown';
            const rawType = item.type || 'Other Inflows';

            // Unique IDs
            const sourceId = `income_src_${rawName}`;
            const typeId = `income_type_${rawType}`;

            addNode(sourceId, '#34d399', rawName); // Source Color (Emerald)
            addNode(typeId, '#2dd4bf', rawType);   // Type Color (Teal)
            addLink(sourceId, typeId, item.value);

            incomeTypes.add(typeId);
        });

        // Withdrawals
        if (withdrawals > 0) {
            const wId = 'income_src_Withdrawals';
            const wType = 'income_type_Investment_Income';
            addNode(wId, '#60a5fa', 'Withdrawals'); // Blue
            addNode(wType, '#2dd4bf', 'Investment Income'); // Teal
            addLink(wId, wType, withdrawals);
            incomeTypes.add(wType);
        }

        // --- 3. Stage: Income Types -> Total Inflows ---
        const totalInflowsId = 'node_Inflows';

        // Ensure Inflows node exists if we have any income OR any expenses/outflows to attach to it
        const hasInflows = incomeTypes.size > 0;
        const hasOutflows = (tax_paid > 0) || (totalExpenses > 0) || (savings_details && savings_details.length > 0);

        if (hasInflows || hasOutflows) {
            addNode(totalInflowsId, '#3b82f6', 'Inflows'); // bright blue
        }

        if (hasInflows) {
            incomeTypes.forEach(typeId => {
                let typeSum = 0;
                // Sum from inputs that feed into this type
                linksList.forEach(link => {
                    if (link.target === typeId) typeSum += link.value;
                });

                if (typeSum > 0) {
                    addLink(typeId, totalInflowsId, typeSum);
                }
            });
        }

        // --- 4. Stage: Inflows -> Allocations (Tax, Exp, Savings) ---

        // Tax
        if (tax_paid > 0) {
            const taxId = 'node_Tax';
            addNode(taxId, '#94a3b8', 'Tax Withholding'); // slate
            addLink(totalInflowsId, taxId, tax_paid);
        }

        // Expenses
        const expensesId = 'node_Expenses';
        const expenseDetails = (expense_details && expense_details.length > 0)
            ? expense_details
            : (totalExpenses > 0 ? [{ name: 'Uncategorized Expenses', category: 'Living', value: totalExpenses }] : []);

        const totalCalculatedExpenses = expenseDetails.reduce((sum: number, item: any) => sum + item.value, 0);

        if (totalCalculatedExpenses > 0) {
            addNode(expensesId, '#fb7185', 'Living Expenses'); // Rose
            addLink(totalInflowsId, expensesId, totalCalculatedExpenses);

            // --- 5. Stage: Expenses -> Specific Items ---
            expenseDetails.forEach((item: any) => {
                const rawName = item.name || 'Misc';
                const itemId = `exp_item_${rawName}`;
                addNode(itemId, '#f43f5e', rawName); // Red/Pink
                addLink(expensesId, itemId, item.value);
            });
        }

        // Savings / Investments
        const savingsDetails = savings_details || [];
        const totalSavings = savingsDetails.reduce((sum: number, item: any) => sum + item.value, 0);

        if (totalSavings > 0) {
            const investmentsId = 'node_Investments';
            addNode(investmentsId, '#818cf8', 'Net Savings'); // Indigo
            addLink(totalInflowsId, investmentsId, totalSavings);

            // Flow to accounts
            savingsDetails.forEach((item: any) => {
                const accId = item.name;
                const uniqueAccId = `save_dest_${accId}`;
                const color = item.type === 'Cash' ? '#22d3ee' : '#6366f1';

                addNode(uniqueAccId, color, accId);
                addLink(investmentsId, uniqueAccId, item.value);
            });
        }

        // Filter out orphaned nodes (not in any link)
        const activeNodeIds = new Set<string>();
        linksList.forEach(link => {
            activeNodeIds.add(link.source);
            activeNodeIds.add(link.target);
        });

        const filteredNodes = nodesList.filter(node => activeNodeIds.has(node.id));

        return { nodes: filteredNodes, links: linksList };

    })();

    if (!data) return <div className="text-slate-500 text-center p-10">No data available for this year</div>;
    if (nodes.length === 0) return <div className="text-slate-500 text-center p-10">Use the Plan Editor to add Income and Expenses</div>;

    return (
        <div className="h-[600px] w-full bg-slate-900/50 rounded-xl border border-slate-800 p-4 transition-all duration-500">
            <ResponsiveSankey
                key={`sankey-${nodes.length}-${links.length}`}
                data={{ nodes, links }}
                margin={{ top: 20, right: 140, bottom: 20, left: 140 }}
                align="justify"
                colors={(node: any) => node.nodeColor}
                nodeOpacity={1}
                nodeHoverOthersOpacity={0.35}
                nodeThickness={16}
                nodeSpacing={20}
                nodeBorderWidth={0}
                nodeBorderRadius={3}
                linkOpacity={0.45}
                linkHoverOpacity={0.7}
                linkBlendMode="normal"
                enableLinkGradient={false}
                linkColor={(link: any) => link.source.nodeColor || '#ffffff'}
                label={(node: any) => node.label}
                labelPosition="outside"
                labelOrientation="horizontal"
                labelPadding={16}
                labelTextColor={{ from: 'color', modifiers: [['brighter', 1]] }}
                theme={theme}
                valueFormat={value =>
                    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value)
                }
            />
        </div>
    );
};
