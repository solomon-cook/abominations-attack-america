export function monsterAssetSlug(idOrName: string): string {
  const slug = idOrName.toLowerCase().replaceAll(" ", "-");
  return slug === "tomanagi" ? "tomanagi-dark" : slug === "gargantis" ? "gargantis-light" : slug;
}
