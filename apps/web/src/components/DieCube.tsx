type Props = {
  value: number;
  label: string;
};

const faces = [
  ["front", 1],
  ["back", 6],
  ["right", 2],
  ["left", 5],
  ["top", 3],
  ["bottom", 4],
] as const;

export function DieCube({ value, label }: Props) {
  return (
    <span className={`combat-die show-${value}`} aria-label={label}>
      <span className="die-cube" aria-hidden="true">
        {faces.map(([position, face]) => (
          <img
            className={`die-cube-face face-${position}`}
            src={`/assets/dice/d6-face-${face}.webp`}
            alt=""
            key={position}
          />
        ))}
      </span>
      <span className="die-value">{value}</span>
    </span>
  );
}
