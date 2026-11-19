# Military image assets

These WebP sprites are original/generated delivery artwork for the web client.
They are listed in `manifest.json`, including X-Fighter artwork and separate
Navy submarine and launched-cruise-missile states. The manifest is checked by
`npm run board-assets:verify`; the images are presentation-only and do not
define unit statistics, quantities, ownership, or rules.

Units with a `src2x` entry use a higher-resolution WebP when a high-density
screen is available. Those variants preserve the original transparent source
art and match the 256px delivery sprite's visible scale.
