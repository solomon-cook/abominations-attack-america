"""Archive current full-text card faces and export text-free web illustrations."""
from pathlib import Path
import shutil
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DECKS = ROOT / "references/monsters-menace-america/components/decks"
ASSETS = ROOT / "apps/web/public/assets/cards"
ARCHIVE = DECKS / "full-text-card-archive"

count = 0
for source_dir, prefix in (
    (DECKS / "military-research-concepts", "military-research"),
    (DECKS / "monster-mutation-concepts", "monster-mutation"),
):
    for source in sorted(source_dir.glob("*.png")):
        if source.stem.startswith("template-"):
            continue
        full_face = ASSETS / f"{prefix}-{source.stem}.webp"
        if not full_face.exists():
            raise FileNotFoundError(full_face)
        ARCHIVE.mkdir(parents=True, exist_ok=True)
        shutil.copy2(full_face, ARCHIVE / full_face.name)

        image = Image.open(source).convert("RGB")
        width, height = image.size
        # Crop away the poster title band and frame while retaining the central
        # illustration. The source concepts have no added rules panel.
        if source.stem == "cutbacks":
            # Keep the shears and avoid the legible paperwork in the scene.
            bounds = (round(width * 0.44), round(height * 0.27), round(width * 0.68), round(height * 0.56))
        elif source.stem == "molecular-cannon":
            # Keep the monster and energy blast; the cannon housing contains lettering.
            bounds = (round(width * 0.53), round(height * 0.26), round(width * 0.96), round(height * 0.82))
        else:
            bounds = (round(width * 0.035), round(height * 0.28),
                      round(width * 0.965), round(height * 0.985))
        crop = image.crop(bounds)
        crop.save(ASSETS / f"{prefix}-{source.stem}-art.webp", "WEBP", quality=88, method=6)
        count += 1

if count != 32:
    raise RuntimeError(f"Expected 32 individual cards; exported {count}")
print(f"Archived {count} full-text card faces at {ARCHIVE}")
print(f"Exported {count} title-free illustrations for web display")
