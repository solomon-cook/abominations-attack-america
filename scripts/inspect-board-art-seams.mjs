/** Inspect generated source pixels at both sides of every shared hex edge. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
const sharp=createRequire(import.meta.url)('sharp');
const base=path.resolve(import.meta.dirname,'../output/board-art');
const geometry=JSON.parse(await fs.readFile(path.join(base,'manifest.json'),'utf8'));
const assignment=JSON.parse(await fs.readFile(path.resolve(import.meta.dirname,'../apps/web/src/board-art-manifest.json'),'utf8'));
const pixels=new Map();
for(const asset of new Set(Object.values(assignment.cells).map(c=>c.asset))){
  try{pixels.set(asset,await sharp(path.join(base,'masters',`${asset}.png`)).resize(256,256).removeAlpha().raw().toBuffer());}catch{}
}
function sample(cell,x,y){const data=pixels.get(assignment.cells[cell.hexKey].asset);if(!data)return null;const ix=Math.max(0,Math.min(255,Math.round(x-cell.center[0]+128))),iy=Math.max(0,Math.min(255,Math.round(y-cell.center[1]+128)));const i=(iy*256+ix)*3;return [data[i],data[i+1],data[i+2]];}
const water=p=>p[2]>p[0]*1.03&&p[1]>p[0]*1.1;
const records=[];
for(const cell of Object.values(geometry.cells))for(const id of Object.values(cell.neighbors)){
  if(cell.id>=id)continue;const neighbour=geometry.cells[id];
  const common=cell.polygon.filter(p=>neighbour.polygon.some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<.001));
  if(common.length!==2)throw Error(`No shared edge ${cell.id} ${id}`);
  let mismatch=0,delta=0,n=0;
  for(let i=2;i<=38;i++){const t=i/40;const x=common[0][0]*(1-t)+common[1][0]*t,y=common[0][1]*(1-t)+common[1][1]*t;const inset=(c)=>sample(c,x*.985+c.center[0]*.015,y*.985+c.center[1]*.015);const a=inset(cell),b=inset(neighbour);if(!a||!b)continue;n++;if(water(a)!==water(b))mismatch++;delta+=Math.hypot(...a.map((v,j)=>v-b[j]));}
  if(n)records.push({cells:[cell.id,id],mismatchFraction:Number((mismatch/n).toFixed(3)),meanRgbDistance:Number((delta/n).toFixed(1))});
}
records.sort((a,b)=>b.mismatchFraction-a.mismatchFraction||b.meanRgbDistance-a.meanRgbDistance);
await fs.mkdir(path.join(base,'review'),{recursive:true});
const report={note:'Diagnostic, not automatic visual approval. Coast geometry and colour differences require neighbourhood inspection.',edgesInspected:records.length,largeGeographyMismatches:records.filter(r=>r.mismatchFraction>.15).length,records};
await fs.writeFile(path.join(base,'review','seam-diagnostics.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({...report,records:records.slice(0,25)},null,2));
