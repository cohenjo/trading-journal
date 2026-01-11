"use client";

import { useEffect, useState } from "react";
import TradesList from "./TradesList";
import AddTradeForm from "./AddTradeForm";
import PnLCurve from "./PnLCurve";
import CalendarView from "./Calendar";

interface DailySummary {
  date: string;
  total_pnl: number;
}

export default function Dashboard() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [pnlData, setPnlData] = useState<{ time: string; value: number }[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      const year = currentDate.getFullYear();
      const month = currentDate.getMonth() + 1;
      try {
        const response = await fetch(`/api/summary/${year}/${month}`);
        if (!response.ok) {
          throw new Error("Network response was not ok");
        }
        const summaries: DailySummary[] = await response.json();

        summaries.sort(
          (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
        );

        let cumulativePnl = 0;
        const chartData = summaries.map((summary) => {
          cumulativePnl += summary.total_pnl;
          return { time: summary.date, value: cumulativePnl };
        });

        const monthStartDate = new Date(year, month - 1, 1);
        const dayBeforeMonth = new Date(monthStartDate);
        dayBeforeMonth.setDate(dayBeforeMonth.getDate() - 1);

        const finalData = [
          { time: dayBeforeMonth.toISOString().split("T")[0], value: 0 },
          ...chartData,
        ];

        setPnlData(finalData);
      } catch (error) {
        console.error("Failed to fetch PnL data:", error);
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const firstDayOfMonth = new Date(year, month, 1)
          .toISOString()
          .split("T")[0];
        setPnlData([{ time: firstDayOfMonth, value: 0 }]);
      }
    };

    fetchData();
  }, [currentDate]);

  return (
    <div>
      <h2 className="text-2xl font-bold">Dashboard</h2>
      <PnLCurve data={pnlData} />
      <CalendarView date={currentDate} onDateChange={setCurrentDate} />
      <AddTradeForm />
      <TradesList />
    </div>
  );
}