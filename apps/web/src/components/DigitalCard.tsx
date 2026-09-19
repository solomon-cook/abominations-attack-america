import { sourcedCardRule } from "@abominations/game-engine";
import type { ReactNode } from "react";

export type DigitalCardKind = "mutation" | "research";

const slugFor = (cardId: string) => cardId.toLowerCase().replaceAll(" ", "-").replaceAll("!", "").replaceAll("'", "");

/** The source scans remain archival assets. This component exposes only their illustration window. */
export function cardArtworkSrc(cardId: string, kind: DigitalCardKind) {
  return `/assets/cards/${kind === "mutation" ? "monster-mutation" : "military-research"}-${slugFor(cardId)}.webp`;
}

export function CardArtwork({ cardId, kind, alt = "" }: { cardId: string; kind: DigitalCardKind; alt?: string }) {
  return <div className={`digital-card-art digital-card-art-${kind}`}>
    <img src={cardArtworkSrc(cardId, kind)} alt={alt} loading="lazy" />
  </div>;
}

export function DigitalCard({ cardId, kind, children, className = "", status, tabIndex }: {
  cardId: string;
  kind: DigitalCardKind;
  children?: ReactNode;
  className?: string;
  status?: ReactNode;
  tabIndex?: number;
}) {
  const rule = sourcedCardRule(cardId);
  const deckName = kind === "mutation" ? "Monster Mutation" : "Military Research";
  return <article className={`digital-card digital-card-${kind} ${className}`.trim()} aria-label={`${cardId} ${deckName} card`} tabIndex={tabIndex}>
    <header className="digital-card-heading">
      <span>{deckName}</span>
      <h4>{cardId}</h4>
    </header>
    <CardArtwork cardId={cardId} kind={kind} alt="" />
    <section className="digital-card-rules">
      {rule?.timing && <p className="digital-card-timing">{rule.timing}</p>}
      <p>{rule?.transcription ?? "Rules text unavailable."}</p>
    </section>
    {status && <p className="digital-card-status">{status}</p>}
    {children && <footer className="digital-card-actions">{children}</footer>}
  </article>;
}
