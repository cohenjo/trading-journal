"use client";

import { useState } from "react";

export default function AddTradeForm() {
  const [symbol, setSymbol] = useState("SPY");
  const [side, setSide] = useState("buy");
  const [size, setSize] = useState(100);
  const [entryPrice, setEntryPrice] = useState(500);
  const [exitPrice, setExitPrice] = useState(501);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const pnl = side === "buy" ? (exitPrice - entryPrice) * size : (entryPrice - exitPrice) * size;

    const trade = {
      timestamp: new Date().toISOString(),
      symbol,
      side,
      size,
      entry_price: entryPrice,
      exit_price: exitPrice,
      pnl,
    };

    await fetch("/api/trades", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(trade),
    });

    // In a real app, you'd probably want to trigger a refetch of the trades list
    window.location.reload();
  };

  return (
    <form onSubmit={handleSubmit} className="mt-8 p-4 border rounded-lg">
      <h3 className="text-xl font-bold mb-4">Add New Trade</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value)}
          placeholder="Symbol"
          className="p-2 border rounded"
        />
        <select
          value={side}
          onChange={(e) => setSide(e.target.value)}
          className="p-2 border rounded"
        >
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
        <input
          type="number"
          value={size}
          onChange={(e) => setSize(parseFloat(e.target.value))}
          placeholder="Size"
          className="p-2 border rounded"
        />
        <input
          type="number"
          value={entryPrice}
          onChange={(e) => setEntryPrice(parseFloat(e.target.value))}
          placeholder="Entry Price"
          className="p-2 border rounded"
        />
        <input
          type="number"
          value={exitPrice}
          onChange={(e) => setExitPrice(parseFloat(e.target.value))}
          placeholder="Exit Price"
          className="p-2 border rounded"
        />
      </div>
      <button type="submit" className="mt-4 px-4 py-2 bg-blue-500 text-white rounded">
        Add Trade
      </button>
    </form>
  );
}