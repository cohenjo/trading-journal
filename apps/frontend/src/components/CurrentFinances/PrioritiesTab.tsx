import React, { useState, useEffect } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragEndEvent
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    verticalListSortingStrategy,
    useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { FinanceItem } from './FinanceTabs';

// --- Sortable Item Component ---

interface SortableItemProps {
    id: string;
    item: FinanceItem;
    rank: number;
}

const SortableItem = ({ id, item, rank }: SortableItemProps) => {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging
    } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            className="bg-slate-900 border border-slate-800 rounded-lg p-4 mb-3 flex items-center justify-between group hover:border-slate-700 cursor-grab active:cursor-grabbing"
        >
            <div className="flex items-center gap-4">
                {/* Rank Badge */}
                <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center font-bold text-slate-400 text-sm">
                    #{rank}
                </div>

                {/* Type Icon */}
                <div className="w-10 h-10 rounded-full bg-slate-800/50 flex items-center justify-center text-xl">
                    {item.category === 'Assets' && '🏠'}
                    {/* Map other icons if needed, or generic */}
                    {item.category === 'Investments' && '📈'}
                    {item.category === 'Savings' && '💰'}
                </div>

                <div>
                    <h4 className="font-semibold text-slate-200">{item.name}</h4>
                    <p className="text-xs text-slate-500">{item.type}</p>
                </div>
            </div>

            <div className="text-right">
                {/* Could add specific actions or values here */}
                <div className='text-xs text-slate-500'>⋮</div>
            </div>
        </div>
    );
};

// --- Main Tab Component ---

interface PrioritiesTabProps {
    items: FinanceItem[];
    onUpdateItems: (items: FinanceItem[]) => void;
}

export const PrioritiesTab: React.FC<PrioritiesTabProps> = ({ items, onUpdateItems }) => {

    // Filter for relevant accounts (Savings/Investments)
    // Maybe user wants to prioritize repayment of Liabilities too?
    // Use case says "excess money... to invest/save" and "withdraw from accounts".
    // So primarily Savings and Investments.
    const relevantItems = items.filter(i => ['Savings', 'Investments'].includes(i.category));

    const [inflowItems, setInflowItems] = useState<FinanceItem[]>([]);
    const [withdrawalItems, setWithdrawalItems] = useState<FinanceItem[]>([]);

    useEffect(() => {
        // Initialize lists sorted by priority
        // Default priority = 100 if undefined.
        const sortedInflow = [...relevantItems].sort((a, b) => (a.inflow_priority ?? 100) - (b.inflow_priority ?? 100));
        setInflowItems(sortedInflow);

        const sortedWithdrawal = [...relevantItems].sort((a, b) => (a.withdrawal_priority ?? 100) - (b.withdrawal_priority ?? 100));
        setWithdrawalItems(sortedWithdrawal);
    }, [items]); // This might reset on every update, handled below

    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        })
    );

    const handleDragEndInflow = (event: DragEndEvent) => {
        const { active, over } = event;
        if (active.id !== over?.id) {
            setInflowItems((items) => {
                const oldIndex = items.findIndex((i) => i.id === active.id);
                const newIndex = items.findIndex((i) => i.id === over?.id);
                const newOrder = arrayMove(items, oldIndex, newIndex);

                // Update Priorities in Parent immediately
                // We need to map current state to new priorities
                // But we must NOT lose the structure of `withdrawalItems` or others.
                // And we need to call onUpdateItems with global list.

                // Strategy: Calculate new priorities for this subset, merge into global items
                const updates = newOrder.map((item, index) => ({
                    ...item,
                    inflow_priority: index + 1
                }));

                // Create a map for quick lookup of updates
                const updateMap = new Map(updates.map(u => [u.id, u]));

                // Merge into global items
                // Important: `items` prop might be stale if we rely on it inside callback? 
                // But usually sticking to `items` from updating prop is safest.
                // However, here we are inside setState updater? No, we are inside handleDragEnd.

                // Let's optimize: just use `newOrder` to derive updates.
                // We delay calling onUpdateItems to avoid flicker or wait for persistence?
                // Better to update global state.

                // Construct the new global list
                const newGlobalItems = items.map(pItem => {
                    const update = updateMap.get(pItem.id);
                    if (update) return { ...pItem, inflow_priority: update.inflow_priority };
                    return pItem;
                });

                // We should call this relative to the `items` prop, but inside setState?
                // Actually we should trigger onUpdateItems.
                // But if we do that, the parent re-renders, causing useEffect to run, resetting state.
                // So we rely on parent update flowing back down.
                // BUT `items` prop dependency in useEffect might cause jitter if we don't handle local state strictly?
                // Local state is usually improved by dnd-kit by being optimistic.
                // If we update parent, parent passes new items, useEffect updates state.
                // The key is that `items` prop *must* change for useEffect to fire.

                // Let's trigger update
                setTimeout(() => onUpdateItems(newGlobalItems), 0);

                return newOrder;
            });
        }
    };

    const handleDragEndWithdrawal = (event: DragEndEvent) => {
        const { active, over } = event;
        if (active.id !== over?.id) {
            setWithdrawalItems((items) => {
                const oldIndex = items.findIndex((i) => i.id === active.id);
                const newIndex = items.findIndex((i) => i.id === over?.id);
                const newOrder = arrayMove(items, oldIndex, newIndex);

                const updates = newOrder.map((item, index) => ({
                    ...item,
                    withdrawal_priority: index + 1
                }));

                const updateMap = new Map(updates.map(u => [u.id, u]));

                const newGlobalItems = items.map(pItem => {
                    const update = updateMap.get(pItem.id);
                    if (update) return { ...pItem, withdrawal_priority: update.withdrawal_priority };
                    return pItem;
                });

                setTimeout(() => onUpdateItems(newGlobalItems), 0);

                return newOrder;
            });
        }
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-6">

            {/* Inflow Column */}
            <div className="bg-slate-950/50 p-6 rounded-xl border border-slate-800/50">
                <div className="mb-4">
                    <h3 className="text-xl font-bold text-emerald-400 flex items-center gap-2">
                        <span>📥</span> Inflow Priority
                    </h3>
                    <p className="text-slate-500 text-sm mt-1">
                        Order for depositing excess income (savings/investments).
                    </p>
                </div>

                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEndInflow}
                    id="inflow-dnd"
                >
                    <SortableContext
                        items={inflowItems.map(i => i.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        {inflowItems.map((item, index) => (
                            <SortableItem key={item.id} id={item.id} item={item} rank={index + 1} />
                        ))}
                    </SortableContext>
                </DndContext>
            </div>

            {/* Withdrawal Column */}
            <div className="bg-slate-950/50 p-6 rounded-xl border border-slate-800/50">
                <div className="mb-4">
                    <h3 className="text-xl font-bold text-rose-400 flex items-center gap-2">
                        <span>📤</span> Withdrawal Priority
                    </h3>
                    <p className="text-slate-500 text-sm mt-1">
                        Order for withdrawing funds when needed.
                    </p>
                </div>

                <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEndWithdrawal}
                    id="withdrawal-dnd"
                >
                    <SortableContext
                        items={withdrawalItems.map(i => i.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        {withdrawalItems.map((item, index) => (
                            <SortableItem key={item.id} id={item.id} item={item} rank={index + 1} />
                        ))}
                    </SortableContext>
                </DndContext>
            </div>

        </div>
    );
};
