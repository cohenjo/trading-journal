"use client";

import React from "react";

interface SkeletonCardProps {
  className?: string;
}

export default function SkeletonCard({ className = "" }: SkeletonCardProps) {
  return (
    <div
      className={`bg-slate-900 border border-slate-800 rounded-xl p-6 animate-pulse ${className}`}
    >
      <div className="h-4 bg-slate-800 rounded w-1/3 mb-4" />
      <div className="h-8 bg-slate-800 rounded w-1/2 mb-3" />
      <div className="h-3 bg-slate-800 rounded w-2/3 mb-2" />
      <div className="h-3 bg-slate-800 rounded w-1/2" />
    </div>
  );
}
