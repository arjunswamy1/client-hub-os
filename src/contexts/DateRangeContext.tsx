import { createContext, useContext, useState, ReactNode } from "react";
import { subDays, startOfDay } from "date-fns";

export interface DateRange {
  from: Date;
  to: Date;
}

interface DateRangeContextType {
  dateRange: DateRange;
  setDateRange: (range: DateRange) => void;
  preset: string;
  setPreset: (preset: string) => void;
}

const DateRangeContext = createContext<DateRangeContextType | undefined>(undefined);

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const [preset, setPreset] = useState("7d");
  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfDay(subDays(new Date(), 6)),
    to: startOfDay(new Date()),
  });

  return (
    <DateRangeContext.Provider value={{ dateRange, setDateRange, preset, setPreset }}>
      {children}
    </DateRangeContext.Provider>
  );
}

export function useDateRange() {
  const context = useContext(DateRangeContext);
  if (!context) throw new Error("useDateRange must be used within DateRangeProvider");
  return context;
}
