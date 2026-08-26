type Props = {
  label?: string;
  animationKey?: number;
};

export function ActionResolutionFeedback({ label, animationKey }: Props) {
  if (!label || !animationKey) return null;
  return (
    <div className="action-resolution-feedback" key={animationKey} role="status" aria-live="polite" aria-atomic="true">
      <span aria-hidden="true">✓</span>
      <strong>{label}</strong>
      <small>Authoritative result accepted.</small>
    </div>
  );
}
