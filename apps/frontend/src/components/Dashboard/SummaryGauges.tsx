'use client';

interface DailySummary {
  date: string;
  total_pnl: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  avg_win: number;
  avg_loss: number;
}

const Gauge = ({ label, value, color }: { label: string; value: string | number; color: string }) => (
  <div className="flex flex-col items-center">
    <div className={`text-3xl font-bold ${color}`}>{value}</div>
    <div className="text-sm text-gray-400">{label}</div>
  </div>
);

export default function SummaryGauges({ summary }: { summary: DailySummary | null }) {
  if (!summary) {
    return null;
  }

  return (
    <div className="bg-gray-800 p-4 rounded-lg mt-4">
      <h2 className="text-xl font-bold mb-4">Daily Summary</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
        <Gauge label="Net P&L" value={`$${summary.total_pnl.toFixed(2)}`} color={summary.total_pnl > 0 ? 'text-green-500' : 'text-red-500'} />
        <Gauge label="Win Rate" value={`${(summary.win_rate * 100).toFixed(1)}%`} color="text-blue-500" />
        <Gauge label="Avg Win" value={`$${summary.avg_win.toFixed(2)}`} color="text-green-500" />
        <Gauge label="Avg Loss" value={`$${summary.avg_loss.toFixed(2)}`} color="text-red-500" />
      </div>
    </div>
  );
}