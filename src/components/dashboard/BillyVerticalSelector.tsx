import { useVertical } from "@/contexts/VerticalContext";
import { cn } from "@/lib/utils";

export function BillyVerticalSelector() {
  const { activeVertical, setActiveVertical, verticals } = useVertical();

  return (
    <div className="flex items-center gap-1 rounded-lg border bg-muted/50 p-1">
      {verticals.map((v) => (
        <button
          key={v.id}
          onClick={() => setActiveVertical(v)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            activeVertical.id === v.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <span>{v.emoji}</span>
          <span>{v.label}</span>
        </button>
      ))}
    </div>
  );
}
