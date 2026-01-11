'use client';

interface MatchedTrade {
  id: number;
  symbol: string;
  open_date: string;
  close_date: string;
  open_price: number;
  close_price: number;
  pnl: number;
  notes?: string;
}

export default function TradesTable({ trades }: { trades: MatchedTrade[] }) {
  return (
    <div className="bg-gray-800 p-4 rounded-lg mt-4">
      <h2 className="text-xl font-bold mb-2">Trades</h2>
      <table className="w-full text-left">
        <thead>
          <tr>
            <th className="p-2">Symbol</th>
            <th className="p-2">Open Time</th>
            <th className="p-2">Close Time</th>
            <th className="p-2">Open Price</th>
            <th className="p-2">Close Price</th>
            <th className="p-2">PnL</th>
            <th className="p-2">Notes</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => (
            <tr key={trade.id} className="border-t border-gray-700">
              <td className="p-2">{trade.symbol}</td>
              <td className="p-2">{new Date(trade.open_date).toLocaleTimeString()}</td>
              <td className="p-2">{new Date(trade.close_date).toLocaleTimeString()}</td>
              <td className="p-2">{trade.open_price.toFixed(2)}</td>
              <td className="p-2">{trade.close_price.toFixed(2)}</td>
              <td className={`p-2 ${trade.pnl > 0 ? 'text-green-500' : 'text-red-500'}`}>{trade.pnl.toFixed(2)}</td>
              <td className="p-2">{trade.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}