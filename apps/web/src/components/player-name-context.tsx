import { createContext, useContext, type ReactNode } from "react";

const PlayerNamesContext = createContext<readonly string[]>([]);

export function PlayerNamesProvider({ names, children }: { names: readonly string[]; children: ReactNode }) {
  return <PlayerNamesContext.Provider value={names}>{children}</PlayerNamesContext.Provider>;
}

export function usePlayerName(playerIndex: number, fallback?: string): string {
  const names = useContext(PlayerNamesContext);
  return names[playerIndex] ?? fallback ?? "Unknown player";
}

export function usePlayerNames(): readonly string[] {
  return useContext(PlayerNamesContext);
}
