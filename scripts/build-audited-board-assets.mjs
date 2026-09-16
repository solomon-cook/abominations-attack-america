/** Resize/crop generated masters for delivery and assemble the actual cell map. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const sharp = createRequire(import.meta.url)('sharp');
const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(root, 'output/board-art');
const destination = path.join(root, 'apps/web/public/assets/board/audited');
const geometry = JSON.parse(await fs.readFile(path.join(sourceRoot, 'manifest.json'), 'utf8'));
const runtime = JSON.parse(await fs.readFile(path.join(root, 'apps/web/src/board-art-manifest.json'), 'utf8'));
const partial = process.argv.includes('--partial');
let previous; try { previous=JSON.parse(await fs.readFile(path.join(destination,'manifest.json'),'utf8')); } catch {}
const assets = [...new Set(Object.values(runtime.cells).map(c => c.asset))];
const records = {};
const missing = [];
for (const size of [256,512,1024]) await fs.mkdir(path.join(destination,String(size)), { recursive: true });
for (const asset of assets) {
  const source = path.join(sourceRoot, 'masters', `${asset}.png`);
  let buffer;
  try { buffer = await fs.readFile(source); } catch { missing.push(asset); continue; }
  const digest=crypto.createHash('sha256').update(buffer).digest('hex');
  if (previous?.encoding === 'webp-q72-e0-v1' && previous.assets?.[asset]?.sha256 === digest) { records[asset]=previous.assets[asset]; continue; }
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width;
  const height = Math.round(width * Math.sqrt(3)/2);
  const top = Math.round((metadata.height-height)/2);
  if (top < 0) throw new Error(`Invalid square master ${asset}`);
  const derivatives = {};
  for (const size of [256,512,1024]) {
    const output = path.join(destination,String(size),`${asset}.webp`);
    await sharp(buffer).extract({left:0,top,width,height}).resize(size,Math.round(size*Math.sqrt(3)/2),{fit:'fill'}).webp({quality:72,effort:0}).toFile(output);
    derivatives[size] = { src:`/assets/board/audited/${size}/${asset}.webp`, bytes:(await fs.stat(output)).size, width:size, height:Math.round(size*Math.sqrt(3)/2) };
  }
  let generation;
  try { generation = JSON.parse(await fs.readFile(path.join(sourceRoot,'generation',`${asset}.json`),'utf8')); } catch { generation = { tool:'image_gen',sourcePath:path.relative(root,source),status:'generated-needs-neighbour-review' }; }
  records[asset] = { source:path.relative(root,source),sourceBytes:buffer.length,sha256:crypto.createHash('sha256').update(buffer).digest('hex'),crop:{left:0,top,width,height},generation,derivatives };
}
if (missing.length && !partial) throw new Error(`Missing generated masters: ${missing.join(', ')}`);
const pts = polygon => polygon.map(point=>point.join(',')).join(' ');
const images = new Map();
for (const asset of Object.keys(records)) images.set(asset,`data:image/png;base64,${(await sharp(path.join(destination,'256',`${asset}.webp`)).png().toBuffer()).toString('base64')}`);
const cells = Object.values(geometry.cells);
const extensions = cells.filter(c=>c.row===0||c.row===13||c.column===0||c.column===23).map(c=>{
  const source=images.get(runtime.cells[c.hexKey].asset);if(!source)return '';
  const x=c.center[0]-geometry.width/2,y=c.center[1]-geometry.height/2;
  return `<image xlink:href="${source}" x="${x-64}" y="${y-64}" width="${geometry.width+128}" height="${geometry.height+128}" preserveAspectRatio="none"/>`;
}).join('');
const content=cells.map((c,i)=>{
  const source=images.get(runtime.cells[c.hexKey].asset);if(!source)return '';
  return `<clipPath id="cell${i}"><polygon points="${pts(c.polygon)}"/></clipPath><image xlink:href="${source}" x="${c.center[0]-geometry.width/2}" y="${c.center[1]-geometry.height/2}" width="${geometry.width}" height="${geometry.height}" preserveAspectRatio="none" clip-path="url(#cell${i})"/>`;
}).join('');
const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${geometry.bounds.width}" height="${Math.round(geometry.bounds.height)}" viewBox="0 0 ${geometry.bounds.width} ${geometry.bounds.height}"><rect width="100%" height="100%" fill="#437985"/>${extensions}${content}</svg>`;
await sharp(Buffer.from(svg)).resize(2336).webp({quality:78,effort:0}).toFile(path.join(destination,'overview.webp'));
await sharp(Buffer.from(svg)).resize(2336).png().toFile(path.join(sourceRoot,'assembled-board.png'));
const manifest={...runtime,encoding:'webp-q72-e0-v1',status:missing.length?'incomplete':'generated-awaiting-visual-review',missing,assets:records,overview:'/assets/board/audited/overview.webp',sizes:[256,512,1024],totals:{sourceBytes:Object.values(records).reduce((n,r)=>n+r.sourceBytes,0),...Object.fromEntries([256,512,1024].map(size=>[`${size}Bytes`,Object.values(records).reduce((n,r)=>n+r.derivatives[size].bytes,0)]))}};
await fs.writeFile(path.join(destination,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({generated:assets.length-missing.length,required:assets.length,missing,totals:manifest.totals},null,2));
