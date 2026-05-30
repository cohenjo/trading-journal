"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExpenseCategory, ExpenseSubcategory } from "@/types/expenses";
import { EXPENSE_CATEGORIES } from "@/types/expenses";
import { getCategories } from "@/lib/expenses/api";

export interface CategorySelection {
  category: ExpenseCategory;
  subcategory: ExpenseSubcategory | null;
}

interface CategoryPickerProps {
  value: CategorySelection | null;
  onChange: (selection: CategorySelection) => void;
  placeholder?: string;
  disabled?: boolean;
  /** aria-label for the control */
  ariaLabel?: string;
}

function matches(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.toLowerCase());
}

function filterCategories(categories: ExpenseCategory[], query: string): ExpenseCategory[] {
  if (!query.trim()) return categories;
  return categories.filter(
    (cat) =>
      matches(cat.name, query) ||
      matches(cat.name_he, query) ||
      cat.subcategories.some((sub) => matches(sub.name, query) || matches(sub.name_he, query)),
  );
}

export function CategoryPicker({
  value,
  onChange,
  placeholder = "בחר קטגוריה...",
  disabled = false,
  ariaLabel = "בחר קטגוריה",
}: CategoryPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [expandedSlugs, setExpandedSlugs] = useState<Set<string>>(new Set());
  const [categories, setCategories] = useState<ExpenseCategory[]>(EXPENSE_CATEGORIES);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Fetch real categories from API on mount
  useEffect(() => {
    let mounted = true;
    getCategories()
      .then((fetchedCategories) => {
        if (mounted) setCategories(fetchedCategories);
      })
      .catch((err) => {
        console.error("[CategoryPicker] failed to fetch categories:", err);
        // Keep using EXPENSE_CATEGORIES fallback
      });
    return () => {
      mounted = false;
    };
  }, []);

  const filteredCategories = useMemo(() => filterCategories(categories, query), [categories, query]);

  function handleOpen() {
    if (disabled) return;
    setOpen(true);
    // Expand categories that have matching subcategories when searching
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleClose() {
    setOpen(false);
    setQuery("");
    setExpandedSlugs(new Set());
  }

  function handleSelect(cat: ExpenseCategory, sub: ExpenseSubcategory | null) {
    onChange({ category: cat, subcategory: sub });
    handleClose();
  }

  function toggleExpand(slug: string, e: React.MouseEvent) {
    e.stopPropagation();
    setExpandedSlugs((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  // Auto-expand when search is active
  const autoExpanded = useMemo(() => {
    if (!query.trim()) return expandedSlugs;
    const set = new Set(expandedSlugs);
    for (const cat of filteredCategories) {
      if (cat.subcategories.some((sub) => matches(sub.name, query) || matches(sub.name_he, query))) {
        set.add(cat.slug);
      }
    }
    return set;
  }, [query, filteredCategories, expandedSlugs]);

  const displayLabel = value
    ? value.subcategory
      ? `${value.category.name_he} › ${value.subcategory.name_he}`
      : value.category.name_he
    : null;

  // Keyboard nav: close on Escape
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    },
    [],
  );

  return (
    <div className="relative" onKeyDown={handleKeyDown}>
      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={open ? handleClose : handleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={`w-full flex items-center justify-between gap-2 px-3 py-1.5 text-sm rounded border transition-colors text-left ${
          disabled
            ? "bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed"
            : "bg-slate-800 border-slate-600 text-slate-200 hover:border-blue-500 cursor-pointer focus:outline-none focus:ring-1 focus:ring-blue-500"
        }`}
      >
        <span dir="auto" className={displayLabel ? "text-slate-200" : "text-slate-500"}>
          {displayLabel ?? placeholder}
        </span>
        <span className="text-slate-500 text-xs" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-50 top-full mt-1 w-64 max-h-80 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg shadow-2xl"
        >
          {/* Search input */}
          <div className="sticky top-0 bg-slate-900 p-2 border-b border-slate-700">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="חפש קטגוריה..."
              className="w-full px-2 py-1.5 text-sm bg-slate-800 border border-slate-600 rounded text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              aria-label="חיפוש קטגוריה"
              dir="auto"
            />
          </div>

          {/* Category list */}
          <div className="py-1">
            {filteredCategories.length === 0 && (
              <div className="px-3 py-4 text-sm text-slate-500 text-center">
                לא נמצאו קטגוריות
              </div>
            )}
            {filteredCategories.map((cat) => {
              const isExpanded = autoExpanded.has(cat.slug);
              const isSelected = value?.category.slug === cat.slug && !value?.subcategory;

              return (
                <div key={cat.slug}>
                  {/* Category row */}
                  <div className="flex items-center">
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(cat, null)}
                      className={`flex-1 flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                        isSelected
                          ? "bg-blue-900/50 text-blue-300"
                          : "text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      <span
                        className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
                        style={{ backgroundColor: cat.color }}
                        aria-hidden="true"
                      />
                      <span dir="auto">{cat.name_he}</span>
                    </button>
                    {cat.subcategories.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => toggleExpand(cat.slug, e)}
                        className="px-2 py-2 text-slate-500 hover:text-slate-300 text-xs"
                        aria-label={`${isExpanded ? "כווץ" : "הרחב"} תת-קטגוריות של ${cat.name_he}`}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? "▲" : "▼"}
                      </button>
                    )}
                  </div>

                  {/* Subcategories */}
                  {isExpanded &&
                    cat.subcategories.map((sub) => {
                      const isSubSelected =
                        value?.category.slug === cat.slug &&
                        value?.subcategory?.slug === sub.slug;
                      const subMatchesQuery =
                        !query.trim() ||
                        matches(sub.name, query) ||
                        matches(sub.name_he, query);

                      if (!subMatchesQuery) return null;

                      return (
                        <button
                          key={sub.slug}
                          type="button"
                          role="option"
                          aria-selected={isSubSelected}
                          onClick={() => handleSelect(cat, sub)}
                          className={`w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-xs text-left transition-colors ${
                            isSubSelected
                              ? "bg-blue-900/50 text-blue-300"
                              : "text-slate-400 hover:bg-slate-800 hover:text-slate-300"
                          }`}
                        >
                          <span
                            className="inline-block w-2 h-2 rounded-sm flex-shrink-0 opacity-70"
                            style={{ backgroundColor: cat.color }}
                            aria-hidden="true"
                          />
                          <span dir="auto">{sub.name_he}</span>
                        </button>
                      );
                    })}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
