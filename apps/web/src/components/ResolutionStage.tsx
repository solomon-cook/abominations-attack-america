import { useEffect, useRef, useState, type ReactNode } from "react";
import { sourcedCardRule } from "@abominations/game-engine";
import { DigitalCard } from "./DigitalCard";

export function monsterPortrait(name: string) {
  const slug = name.toLowerCase().replaceAll(" ", "-");
  return `/assets/monsters/portraits/${slug === "gargantis" ? "gargantis-light" : slug === "tomanagi" ? "tomanagi-dark" : slug}.webp`;
}

export function ResolutionStage({ title, eyebrow, onClose, children, variant = "encounter", returnFocusTo, returnFocusFallbackTo }: { title: string; eyebrow: string; onClose: () => void; children: ReactNode; variant?: string; returnFocusTo?: HTMLElement | null; returnFocusFallbackTo?: HTMLElement | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = returnFocusTo ?? document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLButtonElement>(".resolution-close")?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      if (previous?.isConnected && previous !== document.body && previous !== document.documentElement && !previous.matches(":disabled") && previous.getAttribute("aria-disabled") !== "true") {
        previous.focus({ preventScroll: true });
        return;
      }
      const fallback = returnFocusFallbackTo;
      if (fallback?.isConnected) window.requestAnimationFrame(() => {
        if (fallback.isConnected) fallback.focus({ preventScroll: true });
      });
    };
  }, []);
  return <dialog ref={dialog} className={`resolution-stage resolution-${variant}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="resolution-header"><div><p className="resolution-eyebrow">{eyebrow}</p><h2>{title}</h2></div><button className="resolution-close" onClick={onClose} aria-label="Return to board">✕ <span>Board</span></button></header>
    <div className="resolution-content">{children}</div>
    <footer className="resolution-footer"><span>ABOMINATIONS ATTACK AMERICA</span></footer>
  </dialog>;
}

export function CardReveal({ cardId, kind = "mutation", onRevealed, autoReveal = false }: { cardId: string; kind?: "mutation" | "research"; onRevealed?: () => void; autoReveal?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const rule = sourcedCardRule(cardId);
  useEffect(() => {
    if (!autoReveal || revealed) return;
    const timer = window.setTimeout(() => { setRevealed(true); onRevealed?.(); }, 650);
    return () => window.clearTimeout(timer);
  }, [autoReveal, revealed, onRevealed]);
  return <div className={`cinema-card-reveal ${revealed ? "is-revealed" : ""}`}>
    {revealed ? <DigitalCard cardId={cardId} kind={kind} className="cinema-digital-card" status={rule?.classification === "persistent" ? "Keep this card face up while its effect applies." : undefined} /> : <button className="cinema-card-back" onClick={() => { setRevealed(true); onRevealed?.(); }}><small>{kind === "mutation" ? "MONSTER MUTATION" : "MILITARY RESEARCH"}</small><span aria-hidden="true">✦</span><strong>Reveal card</strong></button>}
  </div>;
}
