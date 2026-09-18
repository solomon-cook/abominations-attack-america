import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cardDefinition, sourcedCardRule } from "@abominations/game-engine";

export const mutationArt = (id: string) => `/assets/cards/monster-mutation-${id.toLowerCase().replaceAll(" ", "-").replaceAll("!", "").replaceAll("'", "")}.webp`;

export function MutationStrip({ cards }: { cards: readonly string[] }) {
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keepOpen = () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  const closeSoon = () => { keepOpen(); closeTimer.current = setTimeout(() => setPreview(null), 200); };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);
  const visible = cards.filter(id => cardDefinition(id));
  return <div className="mutation-strip" aria-label="Monster mutations" onKeyDown={event => { if(event.key === "Escape") setPreview(null); }}>
    <small>MUTATIONS · {visible.length}</small>
    <div>{visible.map(id => <button key={id} aria-label={`Preview ${id}`} aria-expanded={preview?.id === id}
      onMouseEnter={event => { keepOpen(); const r=event.currentTarget.getBoundingClientRect(); setPreview({id,x:r.left,y:r.top}); }}
      onMouseLeave={closeSoon}
      onFocus={event => { const r=event.currentTarget.getBoundingClientRect(); setPreview({id,x:r.left,y:r.top}); }}
      onBlur={closeSoon}
      onClick={event => { const r=event.currentTarget.getBoundingClientRect(); setPreview({id,x:r.left,y:r.top}); }}>
      <img src={mutationArt(id)} alt="" />
    </button>)}</div>
    {!visible.length && <span>No revealed mutations</span>}
    {preview && createPortal(<aside className="mutation-card-preview" aria-label={preview.id} onMouseEnter={keepOpen} onMouseLeave={closeSoon} onFocus={keepOpen} onBlur={closeSoon} style={{left:Math.max(8,Math.min(preview.x,window.innerWidth-288)),top:Math.max(8,preview.y-410)}}>
      <button aria-label="Close mutation preview" onClick={() => setPreview(null)}>×</button><strong>{preview.id}</strong>
      <img src={mutationArt(preview.id)} alt={preview.id} />
      <p>{sourcedCardRule(preview.id)?.transcription}</p>
    </aside>,document.body)}
  </div>;
}
