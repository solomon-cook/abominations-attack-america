/** Assemble existing raster masters for visual adjacency review. No art edits. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const sharp=createRequire(import.meta.url)('sharp');
const base=path.resolve(import.meta.dirname,'../output/board-art');
const manifest=JSON.parse(await fs.readFile(path.join(base,'manifest.json'),'utf8'));
const cells=Object.values(manifest.cells);const src=new Map();const missing=[];
for(const cell of cells){const preferred=`r${cell.row}-c${cell.column}.png`;let file=path.join(base,'masters',preferred);try{await fs.access(file)}catch{if(cell.uniqueArt)missing.push(cell.id);file=path.join(base,'masters',cell.terrain==='Sea'?'water-1.png':'land-1.png');}if(!src.has(file))src.set(file,`data:image/png;base64,${(await sharp(file).resize(256,256).png().toBuffer()).toString('base64')}`);cell.reviewSrc=src.get(file);}
const pts=poly=>poly.map(p=>p.join(',')).join(' ');
function svg(selected,bounds,labels){const groups=selected.map((cell,i)=>`<clipPath id="c${i}"><polygon points="${pts(cell.polygon)}"/></clipPath><image x="${cell.center[0]-128}" y="${cell.center[1]-128}" width="256" height="256" xlink:href="${cell.reviewSrc}" clip-path="url(#c${i})"/>${labels?`<polygon points="${pts(cell.polygon)}" fill="none" stroke="#111" stroke-opacity=".35" stroke-width="1"/><text x="${cell.center[0]}" y="${cell.center[1]}" text-anchor="middle" fill="${missing.includes(cell.id)?'#ff5757':'#fff'}" stroke="#111" stroke-width=".7" paint-order="stroke" font-family="sans-serif" font-size="18">${cell.id}</text>`:''}`);return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" width="${Math.round(bounds.width)}" height="${Math.round(bounds.height)}"><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#24677c"/>${groups.join('')}</svg>`;}
await fs.mkdir(path.join(base,'review'),{recursive:true});
const regions=process.argv.includes('--pacific')?manifest.regions.filter(r=>r.id==='pacific'):manifest.regions;
for(const region of regions){const selected=cells.filter(c=>region.cells.includes(c.id));const image=Buffer.from(svg(selected,region.bounds,true));await sharp(image).resize({width:1536,height:1800,fit:'inside',withoutEnlargement:true}).png().toFile(path.join(base,'review',region.id+'.png'));}
if(process.argv.includes('--neighborhoods'))for(const cell of cells.filter(c=>c.uniqueArt&&(!process.argv.includes('--pacific')||c.column<=7))){const ids=[cell.id,...Object.values(cell.neighbors)];const selected=cells.filter(c=>ids.includes(c.id));const bounds={x:cell.center[0]-384,y:cell.center[1]-350,width:768,height:700};await sharp(Buffer.from(svg(selected,bounds,true))).png().toFile(path.join(base,'review',`r${cell.row}-c${cell.column}.png`));}
await fs.writeFile(path.join(base,'review','coverage.json'),JSON.stringify({generatedUnique:cells.filter(c=>c.uniqueArt).length-missing.length,missingUnique:missing},null,2)+'\n');console.log({generatedUnique:75-missing.length,missingUnique:missing.length});
