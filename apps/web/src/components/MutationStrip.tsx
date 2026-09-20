import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cardDefinition, sourcedCardRule } from "@abominations/game-engine";
import { CardArtwork, cardArtworkSrc } from "./DigitalCard";

export const mutationArt = (id: string) => cardArtworkSrc(id, "mutation");

export function MutationStrip({ cards }: { cards: readonly string[] }) {
  const strip = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepOpen = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  const closeSoon = () => { keepOpen(); closeTimer.current = setTimeout(() => setPreview(null), 200); };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const visible = cards.filter(id => cardDefinition(id));
  return <div ref={strip} className="mutation-strip" aria-label="Monster mutations" onKeyDown={event => { if(event.key === "Escape") setPreview(null); }}>
    <small>MUTATIONS · {visible.length}</small>
    <div>{visible.map(id => <button key={id} aria-label={`Preview ${id}`} aria-expanded={preview?.id === id}
      onMouseEnter={event => { keepOpen(); const r=event.currentTarget.getBoundingClientRect(); setPreview({id,x:r.left,y:r.top}); }}
      onMouseLeave={closeSoon}
      onFocus={event => { const r=event.currentTarget.getBoundingClientRect(); setPreview({id,x:r.left,y:r.top}); }}
      onBlur={closeSoon}
      onClick={event => { const r=event.currentTarget.getBoundingClientRect(); setPreview({id,x:r.left,y:r.top}); }}>
      <CardArtwork cardId={id} kind="mutation" />
    </button>)}</div>
    {!visible.length && <span>No revealed mutations</span>}
    {preview && createPortal(<aside className="mutation-card-preview" aria-label={preview.id} onMouseEnter={keepOpen} onMouseLeave={closeSoon} onFocus={keepOpen} onBlur={closeSoon} style={{left:Math.max(8,Math.min(preview.x,window.innerWidth-288)),top:Math.max(8,preview.y-410)}}>
      <button aria-label="Close mutation preview" onClick={() => setPreview(null)}>×</button><strong>{preview.id}</strong>
      <CardArtwork cardId={preview.id} kind="mutation" alt="" />
      <p>{sourcedCardRule(preview.id)?.transcription}</p>
    </aside>,strip.current?.closest("dialog") ?? document.body)}
  </div>;
}
