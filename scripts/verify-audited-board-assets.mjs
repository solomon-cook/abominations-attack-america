import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const sharp = createRequire(import.meta.url)('sharp');
const root = path.resolve(import.meta.dirname,'..');
const read = async file => JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
const geometry = await read('output/board-art/manifest.json');
const runtime = await read('apps/web/src/board-art-manifest.json');
const delivery = await read('apps/web/public/assets/board/audited/manifest.json');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(runtime.sourceSha256,digest(await fs.readFile(path.join(root,'docs/authoritative-board-human-audit.md'))));
assert.equal(runtime.boardId,'human-audited-north-america');
assert.deepEqual(delivery.cells,runtime.cells);
assert.equal(Object.keys(runtime.cells).length,336);
assert.equal(Object.values(runtime.cells).filter(c=>c.unique).length,75);
assert.deepEqual(delivery.missing,[]);
const unique = new Set();
for(const cell of Object.values(geometry.cells)) {
  const key = `${cell.column},${cell.row-Math.floor(cell.column/2)}`;
  assert.equal(key,cell.hexKey);
  const art = runtime.cells[key];
  assert.equal(art.cellId,cell.id);
  assert.equal(art.unique,cell.uniqueArt);
  assert.ok(delivery.assets[art.asset],`missing ${art.asset}`);
  if(delivery.assembly) {
    assert.deepEqual(delivery.assets[art.asset].crop,{x:cell.center[0]-geometry.width/2,y:cell.center[1]-geometry.height/2,width:geometry.width,height:geometry.height},`misaligned crop ${cell.id}`);
    assert.equal(delivery.assets[art.asset].sha256,delivery.assembly.sha256,`different source transform ${cell.id}`);
  }
  if(art.unique) {const source=art.sourceAsset??art.asset;assert.ok(!unique.has(source),'unique geography reused');unique.add(source);}
}
const masters = delivery.sourceMasters??delivery.assets;
assert.equal(Object.keys(masters).length,81);
const masterHashes = new Set();
for(const [name,asset] of Object.entries(masters)) {
  const bytes = await fs.readFile(path.join(root,asset.source));
  assert.equal(digest(bytes),asset.sha256,`changed master ${name}`);
  assert.ok(!masterHashes.has(asset.sha256),`duplicate master ${name}`);masterHashes.add(asset.sha256);
}
let derivatives = 0;
for(const [name,asset] of Object.entries(delivery.assets)) for(const size of [256,512,1024]) {
  const record = asset.derivatives[size];
  const file = path.join(root,'apps/web/public',record.src);
  const bytes = await fs.readFile(file);
  const meta = await sharp(bytes).metadata();
  assert.equal(meta.format,'webp');assert.equal(meta.width,size);assert.equal(meta.height,Math.round(size*Math.sqrt(3)/2));
  assert.equal(record.bytes,bytes.length,`size mismatch ${name}`);derivatives++;
}
const overview = await sharp(path.join(root,'apps/web/public',delivery.overview)).stats();
assert.ok(overview.channels.some(c=>c.stdev>15),'overview appears blank');
if(delivery.assembly) {
  const source = await fs.readFile(path.join(root,delivery.assembly.source));
  assert.equal(digest(source),delivery.assembly.sha256);
  const {data,info} = await sharp(source).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const inside = (x,y,polygon) => {let result=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {const [xi,yi]=polygon[i],[xj,yj]=polygon[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)result=!result;}return result;};
  const presence = {};
  for(const cell of Object.values(geometry.cells).filter(c=>c.uniqueArt)) {
    const polygon=cell.polygon.map(([x,y])=>[x/geometry.bounds.width*info.width,y/geometry.bounds.height*info.height]);
    const minX=Math.max(0,Math.floor(Math.min(...polygon.map(p=>p[0])))), maxX=Math.min(info.width,Math.ceil(Math.max(...polygon.map(p=>p[0]))));
    const minY=Math.max(0,Math.floor(Math.min(...polygon.map(p=>p[1])))), maxY=Math.min(info.height,Math.ceil(Math.max(...polygon.map(p=>p[1]))));
    let samples=0,water=0;
    for(let y=minY;y<maxY;y++)for(let x=minX;x<maxX;x++)if(inside(x+.5,y+.5,polygon)){const offset=(y*info.width+x)*info.channels;samples++;if(data[offset+2]>data[offset]+15)water++;}
    presence[cell.id]={waterFraction:water/samples,samples};
    assert.ok(water/samples>.005&&water/samples<.995,`unique geography lost land or water: ${cell.id} (${water/samples})`);
  }
  await fs.writeFile(path.join(root,'output/board-art/geography-presence.json'),JSON.stringify(presence,null,2)+'\n');
}
const report={cells:336,uniqueGeography:75,sourceMasters:81,derivatives,totals:delivery.totals,visualStatus:delivery.status,verifiedAt:new Date().toISOString()};
await fs.writeFile(path.join(root,'output/board-art/asset-verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
