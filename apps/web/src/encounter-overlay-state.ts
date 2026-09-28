import { useEffect, useRef, useState } from "react";

type EncounterOverlayStateOptions = {
  online: boolean;
  participantRole?: string;
  participantPlayerIndex?: number;
  decisionPlayer: number;
};

export function isEncounterOverlayVisible({
  requestedOpen,
  online,
  ownerPlayerIndex,
  participantRole,
  participantPlayerIndex,
  decisionPlayer,
}: EncounterOverlayStateOptions & { requestedOpen: boolean; ownerPlayerIndex?: number }): boolean {
  if (!requestedOpen) return false;
  if (!online) return true;
  return ownerPlayerIndex !== undefined
    && participantRole === "player"
    && participantPlayerIndex === ownerPlayerIndex
    && decisionPlayer === ownerPlayerIndex;
}

export function useEncounterOverlayState(options: EncounterOverlayStateOptions) {
  const [requestedOpen, setRequestedOpen] = useState(false);
  const ownerPlayerIndexRef = useRef<number | undefined>(undefined);
  const visible = isEncounterOverlayVisible({
    ...options,
    requestedOpen,
    ownerPlayerIndex: ownerPlayerIndexRef.current,
  });

  useEffect(() => {
    if (!options.online || !requestedOpen || visible) return;
    ownerPlayerIndexRef.current = undefined;
    setRequestedOpen(false);
  }, [options.online, options.participantRole, options.participantPlayerIndex, options.decisionPlayer, requestedOpen, visible]);

  return {
    open: visible,
    requestedOpen,
    ownerPlayerIndex: ownerPlayerIndexRef.current,
    openForPlayer(playerIndex: number) {
      ownerPlayerIndexRef.current = playerIndex;
      setRequestedOpen(true);
    },
    close() {
      ownerPlayerIndexRef.current = undefined;
      setRequestedOpen(false);
    },
  };
}
