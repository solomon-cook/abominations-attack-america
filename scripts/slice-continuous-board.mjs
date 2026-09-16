/** Crop the image-generator's assembled-map edit back onto exact audited cells.
 * This performs only geometric extraction/encoding; original masters are preserved.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('sharp');
const root = path.resolve(import.meta.dirname, '..');
const base = path.join(root, 'output/board-art');
const candidateOnly = process.argv.includes('--candidate');
const published = path.join(root, 'apps/web/public/assets/board/audited');
const destination = candidateOnly ? path.join(base,'candidate-delivery') : published;
const sourceArgument = process.argv.find(argument=>argument.startsWith('--source='))?.slice(9);
const source = sourceArgument ? path.resolve(root,sourceArgument) : path.join(base, 'seamless-board-candidate.png');
const geometry = JSON.parse(await fs.readFile(path.join(base, 'manifest.json')));
const originalPath = path.join(base, 'original-delivery-manifest.json');
try { await fs.access(originalPath); } catch { await fs.copyFile(path.join(published, 'manifest.json'), originalPath); }
const original = JSON.parse(await fs.readFile(originalPath));
for(const [name,record] of Object.entries(original.assets)) {
  try { record.generation=JSON.parse(await fs.readFile(path.join(base,'generation',`${name}.json`))); } catch {}
}
const buffer = await fs.readFile(source);
const metadata = await sharp(buffer).metadata();
const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
const image = `data:image/png;base64,${buffer.toString('base64')}`;
const cells = {}, assets = {};
for (const size of [256,512,1024]) await fs.mkdir(path.join(destination,String(size)),{recursive:true});
for (const cell of Object.values(geometry.cells)) {
  const asset = `continuous-r${cell.row}-c${cell.column}`;
  const previous = original.cells[cell.hexKey];
  const crop = { x:cell.center[0]-geometry.width/2, y:cell.center[1]-geometry.height/2, width:geometry.width, height:geometry.height };
  // SVG viewBox retains fractional shared-edge coordinates; no independently rounded crops.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1024" height="887" viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}"><image xlink:href="${image}" width="${geometry.bounds.width}" height="${geometry.bounds.height}" preserveAspectRatio="none"/></svg>`;
  const raster = await sharp(Buffer.from(svg)).png().toBuffer();
  const derivatives = {};
  for (const size of [256,512,1024]) {
    const filename = path.join(destination,String(size),`${asset}.webp`);
    await sharp(raster).resize(size,Math.round(size*Math.sqrt(3)/2),{fit:'fill'}).webp({quality:82,effort:0}).toFile(filename);
    derivatives[size] = {src:`/assets/board/audited/${size}/${asset}.webp`,bytes:(await fs.stat(filename)).size,width:size,height:Math.round(size*Math.sqrt(3)/2)};
  }
  cells[cell.hexKey] = {...previous,sourceAsset:previous.asset,asset,src:derivatives[256].src};
  assets[asset] = {source:path.relative(root,source),sha256,crop,sourceAsset:previous.asset,sourceMaster:original.assets[previous.asset].source,derivatives};
}
await sharp(buffer).webp({quality:85,effort:0}).toFile(path.join(destination,'overview.webp'));
const runtime = {version:2,boardId:original.boardId,sourceSha256:original.sourceSha256,cells};
const manifest = {...runtime,encoding:'continuous-webp-q82-e0-v2',status:'assembled-edit-awaiting-final-review',missing:[],assets,sourceMasters:original.assets,
  assembly:{source:path.relative(root,source),sha256,width:metadata.width,height:metadata.height,tool:'image_gen',note:'Whole-map seam correction derived from all 81 generated masters. Delivery sizes are resampled from this assembly; they do not add native source detail.'},
  overview:'/assets/board/audited/overview.webp',sizes:[256,512,1024],totals:Object.fromEntries([256,512,1024].map(size=>[`${size}Bytes`,Object.values(assets).reduce((n,r)=>n+r.derivatives[size].bytes,0)]))};
await fs.writeFile(path.join(candidateOnly ? destination : path.join(root,'apps/web/src'),'board-art-manifest.json'),JSON.stringify(runtime,null,2)+'\n');
await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({cells:Object.keys(cells).length,sourceDimensions:[metadata.width,metadata.height],totals:manifest.totals},null,2));
