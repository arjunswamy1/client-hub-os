import { format, subDays, startOfDay } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDateRange } from "@/contexts/DateRangeContext";
import type { DateRange as DayPickerRange } from "react-day-picker";

const presets = [
  { label: "7D", value: "7d", days: 7 },
  { label: "14D", value: "14d", days: 14 },
  { label: "30D", value: "30d", days: 30 },
];

const DateRangePicker = () => {
  const { dateRange, setDateRange, preset, setPreset } = useDateRange();

  const handlePreset = (p: typeof presets[0]) => {
    setPreset(p.value);
    setDateRange({
      from: startOfDay(subDays(new Date(), p.days - 1)),
      to: startOfDay(new Date()),
    });
  };

  const handleCalendarSelect = (range: DayPickerRange | undefined) => {
    if (range?.from && range?.to) {
      setPreset("custom");
      setDateRange({ from: range.from, to: range.to });
    } else if (range?.from) {
      setPreset("custom");
      setDateRange({ from: range.from, to: range.from });
    }
  };

  return (
    <div className="flex items-center gap-1.5">
      {presets.map((p) => (
        <Button
          key={p.value}
          variant={preset === p.value ? "default" : "outline"}
          size="sm"
          className="h-8 px-3 text-xs"
          onClick={() => handlePreset(p)}
        >
          {p.label}
        </Button>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <CalendarIcon className="h-3.5 w-3.5" />
            {format(dateRange.from, "MMM d")} – {format(dateRange.to, "MMM d")}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            mode="range"
            selected={{ from: dateRange.from, to: dateRange.to }}
            onSelect={handleCalendarSelect}
            numberOfMonths={2}
            disabled={(date) => date > new Date()}
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};

export default DateRangePicker;
