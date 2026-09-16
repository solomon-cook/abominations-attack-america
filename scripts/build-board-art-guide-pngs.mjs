/** Rasterize deterministic geometry guides for imagegen references, not artwork. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
const sharp=createRequire(import.meta.url)('sharp');
const base=path.resolve(import.meta.dirname,'../output/board-art');
const manifest=JSON.parse(await fs.readFile(path.join(base,'manifest.json'),'utf8'));
const files=['full-board-guide.svg','full-board-mask.svg',...manifest.regions.map(r=>r.guide)];
if(process.argv.includes('--all'))files.push(...Object.values(manifest.cells).map(c=>c.guide));
for(const file of files)await sharp(path.join(base,file)).resize({width:file.startsWith('full-board')?2336:1536,withoutEnlargement:true}).png().toFile(path.join(base,file.replace('.svg','.png')));
console.log(`Rasterized ${files.length} geometry guides.`);
