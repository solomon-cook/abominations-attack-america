/** Exact square cell framing references for image generation (not game art). */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const sharp=createRequire(import.meta.url)('sharp');
const base=path.resolve(import.meta.dirname,'../output/board-art');
const manifest=JSON.parse(await fs.readFile(path.join(base,'manifest.json'),'utf8'));
await fs.mkdir(path.join(base,'cell-guides'),{recursive:true});
for(const cell of Object.values(manifest.cells).filter(cell=>cell.uniqueArt)){
 const x=cell.center[0]-128,y=cell.center[1]-128;
 const points=polygon=>polygon.map(point=>point.join(',')).join(' ');
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x} ${y} 256 256" width="1024" height="1024"><rect x="${x}" y="${y}" width="256" height="256" fill="#24677c"/>${cell.landPolygons.map(polygon=>`<polygon points="${points(polygon)}" fill="#92966a"/>`).join('')}${cell.waterPolygons.map(polygon=>`<polygon points="${points(polygon)}" fill="#24677c"/>`).join('')}<polygon points="${points(cell.polygon)}" fill="none" stroke="#ffd700" stroke-width="1"/></svg>`;
 const stem=path.join(base,'cell-guides',`r${cell.row}-c${cell.column}`);
 await fs.writeFile(stem+'.svg',svg);await sharp(Buffer.from(svg)).png().toFile(stem+'.png');
}
console.log('Created 75 exact square cell reference guides.');
