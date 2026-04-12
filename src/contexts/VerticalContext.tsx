import { createContext, useContext, useState, ReactNode, useMemo } from "react";
import { BILLY_VERTICALS, VerticalConfig } from "@/config/billyVerticals";
import { useClientVerticals } from "@/hooks/useClientVerticals";

interface VerticalContextType {
  activeVertical: VerticalConfig;
  setActiveVertical: (vertical: VerticalConfig) => void;
  verticals: VerticalConfig[];
}

const VerticalContext = createContext<VerticalContextType | undefined>(undefined);

export function VerticalProvider({ children }: { children: ReactNode }) {
  const { dbVerticals } = useClientVerticals();
  const [activeVertical, setActiveVertical] = useState<VerticalConfig>(BILLY_VERTICALS[0]);

  const verticals = useMemo(() => {
    // Merge hardcoded defaults with DB-stored custom verticals
    const existingIds = new Set(BILLY_VERTICALS.map(v => v.id));
    const custom = dbVerticals.filter(v => !existingIds.has(v.id));
    return [...BILLY_VERTICALS, ...custom];
  }, [dbVerticals]);

  return (
    <VerticalContext.Provider
      value={{ activeVertical, setActiveVertical, verticals }}
    >
      {children}
    </VerticalContext.Provider>
  );
}

export function useVertical() {
  const ctx = useContext(VerticalContext);
  if (!ctx) throw new Error("useVertical must be used within VerticalProvider");
  return ctx;
}
