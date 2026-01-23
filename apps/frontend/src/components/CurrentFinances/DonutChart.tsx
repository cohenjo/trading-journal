import React from 'react';

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  data: DonutSegment[];
  totalLabel: string;
  subLabel?: string;
  size?: number;
  thickness?: number;
}

export const DonutChart: React.FC<DonutChartProps> = ({
  data,
  totalLabel,
  subLabel,
  size = 200,
  thickness = 12,
}) => {
  const total = data.reduce((acc, curr) => acc + curr.value, 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  let accumulatedOffset = 0;

  // If no data or total is 0, show a gray ring
  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ width: size, height: size }}>
         <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
            <circle
              cx={center}
              cy={center}
              r={radius}
              fill="transparent"
              stroke="#334155" // slate-700
              strokeWidth={thickness}
            />
         </svg>
           <div className="absolute flex flex-col items-center justify-center text-center">
            <span className="text-2xl font-bold text-white">$0</span>
            <span className="text-xs text-slate-400">{totalLabel}</span>
          </div>
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90">
        {data.map((segment, index) => {
          const segmentLength = (segment.value / total) * circumference;
          // We leave a tiny gap if there are multiple segments
          const gap = data.length > 1 ? 4 : 0; 
          const dashArray = `${Math.max(0, segmentLength - gap)} ${circumference}`;
          const offset = -accumulatedOffset;
          
          accumulatedOffset += segmentLength;

          return (
            <circle
              key={index}
              cx={center}
              cy={center}
              r={radius}
              fill="transparent"
              stroke={segment.color}
              strokeWidth={thickness}
              strokeDasharray={dashArray}
              strokeDashoffset={offset}
              strokeLinecap="round" // Rounded ends for nicer look
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
        <span className="text-3xl font-bold text-slate-100">
            {/* Format large numbers compactly if needed, here simple currency */}
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(total)}
        </span>
        <span className="text-sm font-medium text-slate-400 mt-1">{totalLabel}</span>
        {subLabel && <span className="text-xs text-slate-500">{subLabel}</span>}
      </div>
    </div>
  );
};
