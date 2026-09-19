import "../dice.css";

type Props = { value: number; label: string };
const pips: Record<number, readonly [number, number][]> = {
  1: [[50, 50]],
  2: [[26, 26], [74, 74]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[26, 26], [74, 26], [26, 74], [74, 74]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[26, 24], [74, 24], [26, 50], [74, 50], [26, 76], [74, 76]],
};

/** A single crisp face settles onto the table; no intersecting 3D image planes. */
export function DieCube({ value, label }: Props) {
  return <span className="combat-die" data-die="settled" role="img" aria-label={label}>
    <svg className="die-face" viewBox="0 0 100 100" aria-hidden="true">
      <rect x="3" y="3" width="94" height="94" rx="17" fill="currentColor" />
      <rect x="8" y="8" width="84" height="84" rx="13" fill="none" stroke="#ffffff80" strokeWidth="2" />
      {(pips[value] ?? []).map(([cx, cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="8" fill="#263b32" />)}
    </svg>
  </span>;
}
