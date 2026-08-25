const relativeLuminance = (hex) => {
  const channels = hex.slice(1).match(/../g).map((channel) => Number.parseInt(channel, 16) / 255);
  const linear = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};
const contrast = (foreground, background) => {
  const light = relativeLuminance(foreground);
  const dark = relativeLuminance(background);
  return (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
};
const pairs = [
  ["body copy", "#f4f1ea", "#171514"],
  ["muted copy", "#a99c91", "#211b19"],
  ["setup copy", "#c5b7a8", "#2a211b"],
  ["action button", "#201611", "#d77939"],
  ["board tile copy", "#f7f1d8", "#243d35"],
  ["settings copy", "#dce8d8", "#172117"],
  ["duel heading", "#f5d28e", "#211a17"],
];
const failures = pairs.filter(([, foreground, background]) => contrast(foreground, background) < 4.5);
if (failures.length > 0) throw new Error(`Contrast pairs below WCAG AA normal-text threshold: ${failures.map(([name]) => name).join(", ")}`);
console.log(`Verified ${pairs.length} critical web contrast pairs at WCAG AA normal-text ratio.`);
