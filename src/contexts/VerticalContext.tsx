import { createContext, useContext, useState, ReactNode } from "react";
import { BILLY_VERTICALS, VerticalConfig } from "@/config/billyVerticals";

interface VerticalContextType {
  activeVertical: VerticalConfig;
  setActiveVertical: (vertical: VerticalConfig) => void;
  verticals: VerticalConfig[];
}

const VerticalContext = createContext<VerticalContextType | undefined>(undefined);

export function VerticalProvider({ children }: { children: ReactNode }) {
  const [activeVertical, setActiveVertical] = useState<VerticalConfig>(BILLY_VERTICALS[0]);

  return (
    <VerticalContext.Provider
      value={{ activeVertical, setActiveVertical, verticals: BILLY_VERTICALS }}
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
