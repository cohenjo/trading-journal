"use client";

import { useEffect, useState } from "react";
import { getDayDetails } from "@/app/day/actions";

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
    getDayDetails("2025-07-02")
      .then((data) => setTrades(data?.matched_trades.map((trade) => ({
        id: trade.id,
        timestamp: trade.open_date,
        symbol: trade.symbol,
        side: trade.pnl >= 0 ? "buy" : "sell",
        size: 0,
        entry_price: trade.open_price,
        exit_price: trade.close_price,
        pnl: trade.pnl,
      })) ?? []));
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
