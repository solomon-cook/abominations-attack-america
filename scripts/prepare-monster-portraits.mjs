import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
const output = 'apps/web/public/assets/monsters/portraits';
await mkdir(output, { recursive: true });
for (const id of ['zorb','tomanagi','konk','megaclaw','toxicor','gargantis']) {
  await sharp(`output/imagegen/monsters-front/${id}-front-transparent.png`)
    .resize({ width: 768, height: 768, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90, alphaQuality: 100 }).toFile(`${output}/${id}.webp`);
}
