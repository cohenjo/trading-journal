"use client";

import { useEffect, useState } from "react";

// A simple Trade type. In a real app, this would be in a shared types package.
type Trade = {
  id: number;
  timestamp: string;
  symbol: string;
  side: string;
  size: number;
  entry_price: number;
  exit_price: number;
  pnl: number;
};

export default function TradesList() {
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    // Fetch trades from the backend.
    // For now, we'll use a dummy date.
    fetch("/api/day/2025-07-02")
      .then((res) => res.json())
      .then((data) => setTrades(data));
  }, []);

  return (
    <div className="mt-8">
      <h3 className="text-xl font-bold">Trades</h3>
      <div className="overflow-x-auto">
        <table className="min-w-full bg-white">
          <thead>
            <tr>
              <th className="py-2 px-4 border-b">Symbol</th>
              <th className="py-2 px-4 border-b">Side</th>
              <th className="py-2 px-4 border-b">Size</th>
              <th className="py-2 px-4 border-b">Entry</th>
              <th className="py-2 px-4 border-b">Exit</th>
              <th className="py-2 px-4 border-b">P&L</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => (
              <tr key={trade.id}>
                <td className="py-2 px-4 border-b">{trade.symbol}</td>
                <td className="py-2 px-4 border-b">{trade.side}</td>
                <td className="py-2 px-4 border-b">{trade.size}</td>
                <td className="py-2 px-4 border-b">{trade.entry_price}</td>
                <td className="py-2 px-4 border-b">{trade.exit_price}</td>
                <td className="py-2 px-4 border-b">{trade.pnl.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}