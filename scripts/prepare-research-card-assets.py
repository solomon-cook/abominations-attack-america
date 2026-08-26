"""Add exact sourced rules text to the finished Research card art and export WebP."""

from pathlib import Path
from textwrap import wrap

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "references/monsters-menace-america/components/decks/military-research-concepts"
MUTATION_SOURCE = ROOT / "references/monsters-menace-america/components/decks/monster-mutation-concepts"
DEST = ROOT / "apps/web/public/assets/cards"

FONT_REGULAR = "/System/Library/Fonts/Supplemental/Arial.ttf"
FONT_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

RULES = {
    "mecha-monster": "You control the Mecha-Monster giant military unit. Place its piece on one of your bases and take its record tile. When Mecha-Monster reaches 0 Health, remove it from the game. DISCARD THIS CARD AFTER USE.",
    "cutbacks": "Use on any of your turns. DISCARD THIS CARD AFTER USE. Remove a Research card from play.",
    "laser-fence": "Use at any time when a monster ends its move, but before battle. DISCARD THIS CARD AFTER USE. The monster must expend 2 Infamy tokens or retreat to an unoccupied adjacent space. (It doesn't encounter the new space.)",
    "guard-commander": "You can move and redeploy Guard units. Tanks have Move 3 (land only). Fighters have Move 5 (fly). Other players can't deploy Guard units.",
    "defense-satellites": "Use on any of your turns. DISCARD THIS CARD AFTER USE. Roll 1 die for each monster on the game board. That monster takes that much damage. (This doesn't affect Captain Colossal or Mecha-Monster.)",
    "stabilizer-ray": "Use on any of your turns at the start of a battle involving your units. DISCARD THIS CARD AFTER USE. If you damage a monster during this battle, choose and discard 1 of its Mutation cards.",
    "fusion-cells": "Add 1 to the Move value of all of your units.",
    "x-fighters": "Place the 2 black X-fighter pieces on this card. You may deploy an X-fighter instead of a unit from your branch (but not instead of a Guard unit). Remove destroyed X-fighters from the game. (Discard this card after both are destroyed.)\nMove: 6 (fly)   Defense: 5   Damage: 2",
    "molecular-cannon": "Use on any of your turns at the start of a battle involving your units. DISCARD THIS CARD AFTER USE. Roll 1 die. The monster takes that much damage and immediately appears on one of its lairs (your choice).",
    "2nd-generation": "You can deploy 1 extra unit each turn (from your branch or from the National Guard).",
    "blonde-lure": "Use on any of your turns. DISCARD THIS CARD AFTER USE. Choose a monster and a space adjacent to it. If it is able to, that monster must end its move on that space during its next turn.",
    "anti-mutagen": "At the start of any battle involving your units, the monster loses 1 Health for each Mutation card it has.",
    "antimatter": "Use on any of your turns at the start of a battle involving your units. DISCARD THIS CARD AFTER USE. Military units deal double damage in the first combat round. Each time the monster is damaged this way, roll 1 die. The monster mutates on a roll of 1.",
    "scientific-analysis": "At the start of any battle involving your units, the monster loses 1 Health.",
    "chopper-lift": "Use on any of your turns. DISCARD THIS CARD AFTER USE. Roll 1 die. Move a monster up to that many spaces. It loses 1 Infamy. It cannot end this move on a space containing another piece, on a sea space, or on an unstomped city, base, or Infamy site.",
    "captain-colossal": "You control the Captain Colossal giant military unit. Place its piece on one of your bases and take its record tile. When Captain Colossal reaches 0 Health, remove it from the game. DISCARD THIS CARD AFTER USE.",
}

MUTATION_RULES = {
    "fins-and-gills": "You can cross water barriers.\n+1 Defense in a space with a water barrier.",
    "rampage": "You can move on the same turn you emerge from a lair.",
    "radiation-field": "Any time a military unit gets an attack roll of 1 against you, it destroys itself (you still draw Mutation cards, if applicable).",
    "atomic-recovery": "At the beginning of your turn, your Health returns to its starting value if it was lower.",
    "berserk": "Discard this card for 5 extra attacks at any time during a battle you're in.",
    "war-spikes": "Each of your hits deals 4 damage instead of 3.",
    "atomic-breath": "You get 1 extra attack in the first combat round of each battle.",
    "iron-stomach": "Whenever you stomp a military base, you may gain 3 Health instead of 1 Infamy.",
    "whip-tentacles": "Whenever you get an attack roll of 6, you immediately make 1 extra attack (you also smash, if applicable).",
    "high-octane-blood": "+1 Move\nDuring the Monster Challenge, you attack first even if you're not the challenger.",
    "son-of-a-monster": "Discard this card at any time during a battle you're in to get 2 extra attacks and 1 die of Health.",
    "winged-horror": "+1 Move\nYou now fly.",
    "kinda-friendly": "You can move through spaces occupied by National Guard units. If you end your move on a space with any Guard units, return those units to the National Guard record tile without fighting them.",
    "laser-beam-eyes": "+2 to hit cruise missiles.",
    "armored-scales": "+1 Defense\n-1 Move",
    "its-a-robot": "Each time a monster misses you during the Monster Challenge, it takes 1 damage from electrocution.",
}


def font(path: str, size: int):
    return ImageFont.truetype(path, size)


def render(source_path: Path, destination: Path, text: str):
    image = Image.open(source_path).convert("RGB")
    width, height = image.size
    panel_height = 365
    panel_top = height - panel_height
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rectangle((28, panel_top, width - 28, height - 28), fill=(17, 21, 24, 238), outline=(224, 183, 105, 255), width=4)
    draw.text((55, panel_top + 24), "CARD RULE", fill=(239, 184, 109, 255), font=font(FONT_BOLD, 28))
    body_font = font(FONT_REGULAR, 25)
    max_chars = 61 if len(text) < 240 else 57
    y = panel_top + 72
    for paragraph in text.split("\n"):
        for line in wrap(paragraph, width=max_chars):
            draw.text((55, y), line, fill=(245, 241, 234, 255), font=body_font)
            y += 33
        y += 7
    image.save(destination, "WEBP", quality=84, method=6)


DEST.mkdir(parents=True, exist_ok=True)
for source_root, prefix, rules in ((SOURCE, "military-research", RULES), (MUTATION_SOURCE, "monster-mutation", MUTATION_RULES)):
    for slug, text in rules.items():
        source = source_root / f"{slug}.png"
        destination = DEST / f"{prefix}-{slug}.webp"
        if not source.exists():
            raise FileNotFoundError(source)
        render(source, destination, text)
print(f"Prepared {len(RULES) + len(MUTATION_RULES)} authoritative-text card candidates in {DEST}")
