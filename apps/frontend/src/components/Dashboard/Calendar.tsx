"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Calendar, { type CalendarProps } from "react-calendar";
import "react-calendar/dist/Calendar.css";
import "./Calendar.css";

type DailySummary = {
  date: string;
  total_pnl: number;
};

type CalendarViewProps = {
  date: Date;
  onDateChange: (date: Date) => void;
};

export default function CalendarView({ date, onDateChange }: CalendarViewProps) {
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const router = useRouter();

  useEffect(() => {
    const fetchSummaries = async () => {
      const year = date.getFullYear();
      const month = date.getMonth() + 1;
      const response = await fetch(`/api/summary/${year}/${month}`);
      const data = await response.json();
      setSummaries(data);
    };
    fetchSummaries();
  }, [date]);

  const tileContent = ({ date, view }: { date: Date; view: string }) => {
    if (view === "month") {
      const summary = summaries.find(
        (s) => new Date(s.date).toDateString() === date.toDateString()
      );
      if (summary) {
        return (
          <p
            className={
              summary.total_pnl > 0 ? "text-green-500" : "text-red-500"
            }
          >
            {summary.total_pnl.toFixed(2)}
          </p>
        );
      }
    }
    return null;
  };

  const handleDateChange: CalendarProps["onChange"] = (value) => {
    if (value instanceof Date) {
      onDateChange(value);
    }
  };

  const handleDayClick = (value: Date) => {
    const year = value.getFullYear();
    const month = (value.getMonth() + 1).toString().padStart(2, "0");
    const day = value.getDate().toString().padStart(2, "0");
    const formattedDate = `${year}-${month}-${day}`;
    router.push(`/day/${formattedDate}`);
  };

  return (
    <div className="calendar-container">
      <h3 className="text-xl font-bold mb-2">Calendar</h3>
      <Calendar
        onChange={handleDateChange}
        value={date}
        tileContent={tileContent}
        onClickDay={handleDayClick}
        onActiveStartDateChange={({ activeStartDate }) =>
          onDateChange(activeStartDate || new Date())
        }
        className="full-width-calendar"
      />
    </div>
  );
}