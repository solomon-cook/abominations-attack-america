/** Build auditable geometry guides, never final raster artwork. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'output/board-art');
const audit = await fs.readFile(path.join(root, 'docs/authoritative-board-human-audit.md'), 'utf8');
const W=256, H=W*Math.sqrt(3)/2;
const edgeNames=['northeast','southeast','south','southwest','northwest','north'];
const directions={ north:[0,-1], northeast:[Math.sqrt(3)/2,-.5], southeast:[Math.sqrt(3)/2,.5],south:[0,1],southwest:[-Math.sqrt(3)/2,.5],northwest:[-Math.sqrt(3)/2,-.5],east:[1,0],west:[-1,0]};
const corners=[[W/4,0],[W/2,H/2],[W/4,H],[-W/4,H],[-W/2,H/2],[-W/4,0]];
const pointKey=p=>p.map(v=>v.toFixed(5)).join(',');
const cells=[];
let headers=[];
for(const line of audit.split('\n')) {
 if(line.startsWith('| Coordinate'))headers=line.split('|').slice(1,-1).map(x=>x.trim());
 if(!/^\| `\d+\/\d+`/.test(line))continue;
 const cols=line.split('|').slice(1,-1).map(x=>x.trim());const record=Object.fromEntries(headers.map((h,i)=>[h,cols[i]]));
 const id=cols[0].replaceAll('`','');const [row,column]=id.split('/').map(Number);
 const shoreDescription=record['Coastline / land form']??record.Coastline??'None';
 const features=record['Other features'];
 const special=/archipelago|coastal dip/.test(shoreDescription)||/Bahamas/.test(features);
 const terrain=record.Tile;
 const center=[W/2+column*W*.75,H/2+row*H+(column%2)*H/2];
 const polygon=corners.map(([x,y])=>[center[0]+x,center[1]+y-H/2]);
 cells.push({id,row,column,hexKey:`${column},${row-Math.floor(column/2)}`,terrain,shoreDescription,orientation:record['Land/sea orientation']??'None',barriers:record['Sea-border edge(s)']??'None',crop:record['Crop note'],features,uniqueArt:terrain==='Coast'||terrain==='Lake edge'||special,special,center,polygon,guide:`guides/r${row}-c${column}.svg`,reviewStatus:'geometry-candidate',neighbors:{}});
}
if(cells.length!==336)throw new Error(`Expected 336 cells, found ${cells.length}`);
const byId=new Map(cells.map(c=>[c.id,c]));
const edgeOwners=new Map();
for(const c of cells)for(let i=0;i<6;i++) {
 const ends=[c.polygon[i],c.polygon[(i+1)%6]];const key=ends.map(pointKey).sort().join('|');
 const owners=edgeOwners.get(key)??[];owners.push({cell:c,edge:edgeNames[i]});edgeOwners.set(key,owners);
}
for(const owners of edgeOwners.values())if(owners.length===2) {
 owners[0].cell.neighbors[owners[0].edge]=owners[1].cell.id;owners[1].cell.neighbors[owners[1].edge]=owners[0].cell.id;
}
function edgeIndex(name){return edgeNames.indexOf(name)}
function midpoint(c,i){const a=c.polygon[i],b=c.polygon[(i+1)%6];return [(a[0]+b[0])/2,(a[1]+b[1])/2]}
function shoreEdges(c){return [...c.shoreDescription.toLowerCase().matchAll(/\b(northeast|southeast|southwest|northwest|north|south)\b/g)].map(x=>x[1]).filter((x,i,a)=>a.indexOf(x)===i)}
function inferredLandVector(c){
 const explicit=c.orientation.toLowerCase().match(/land ([^;]+)/)?.[1];
 if(explicit){const names=[...explicit.matchAll(/\b(northeast|southeast|southwest|northwest|north|south|east|west)\b/g)].map(x=>x[1]);if(names.length)return names.reduce((v,n)=>[v[0]+directions[n][0],v[1]+directions[n][1]],[0,0]);}
 const vector=[0,0];for(const id of Object.values(c.neighbors)){const n=byId.get(id);if(n.terrain==='Land'||n.terrain==='Sea'){const sign=n.terrain==='Land'?1:-1;vector[0]+=(n.center[0]-c.center[0])*sign;vector[1]+=(n.center[1]-c.center[1])*sign;}}
 if(Math.hypot(...vector)<.1)return c.column<10?[1,0]:c.row>8?[0,-1]:[-1,0];return vector;
}
// One scalar at each shared corner guarantees identical land/water occupancy on
// the shared edge. Prose endpoints propose constraints, never alter the audit.
const vertexSamples=new Map();
for(const c of cells){
 c.requestedCrossingEdges=shoreEdges(c);const landVector=inferredLandVector(c);c.landDirection=landVector;c.orientationInferred=c.orientation==='Not stated';
 let local;
 if(c.terrain==='Sea')local=c.polygon.map(()=>-1);
 else if(c.terrain==='Land'&&!c.special)local=c.polygon.map(()=>1);
 else {
  const edges=c.requestedCrossingEdges;
  if(edges.length>=2){const a=midpoint(c,edgeIndex(edges[0])),b=midpoint(c,edgeIndex(edges[1]));let normal=[-(b[1]-a[1]),b[0]-a[0]];if(normal[0]*landVector[0]+normal[1]*landVector[1]<0)normal=normal.map(x=>-x);const length=Math.hypot(...normal);local=c.polygon.map(p=>((p[0]-a[0])*normal[0]+(p[1]-a[1])*normal[1])/length/(W/2));}
  else if(edges.length===1){const m=midpoint(c,edgeIndex(edges[0]));const center=c.center;let normal=[center[0]-m[0],center[1]-m[1]];const length=Math.hypot(...normal);local=c.polygon.map(p=>((p[0]-m[0])*normal[0]+(p[1]-m[1])*normal[1])/length/(W/2)-.12);}
  else {const length=Math.hypot(...landVector);local=c.polygon.map(p=>((p[0]-c.center[0])*landVector[0]+(p[1]-c.center[1])*landVector[1])/length/(W/2));}
 }
 c.localCornerValues=local;
 for(let i=0;i<6;i++){const key=pointKey(c.polygon[i]);const list=vertexSamples.get(key)??[];list.push({value:local[i],weight:c.uniqueArt?2:1});vertexSamples.set(key,list);}
}
const values=new Map([...vertexSamples].map(([key,list])=>[key,list.reduce((n,s)=>n+s.value*s.weight,0)/list.reduce((n,s)=>n+s.weight,0)]));
function clipTriangle(points,scalars){const result=[];for(let i=0;i<points.length;i++){const j=(i+1)%points.length,a=points[i],b=points[j],va=scalars[i],vb=scalars[j];if(va>=0)result.push(a);if((va>=0)!==(vb>=0)){const t=va/(va-vb);result.push([a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])]);}}return result;}
for(const c of cells){
 c.cornerValues=c.polygon.map(p=>values.get(pointKey(p)));
 let center=c.terrain==='Land'?1:c.terrain==='Sea'?-1:c.localCornerValues.reduce((a,b)=>a+b,0)/6;
 if(c.terrain==='Lake edge'&&c.cornerValues.every(v=>v>0))center=-.45;
 if(c.terrain==='Coast'&&c.cornerValues.every(v=>v<0))center=.45;
 c.landPolygons=[];for(let i=0;i<6;i++){const j=(i+1)%6;const poly=clipTriangle([c.center,c.polygon[i],c.polygon[j]],[center,c.cornerValues[i],c.cornerValues[j]]);if(poly.length>=3)c.landPolygons.push(poly);}
 if(/Bahamas/.test(c.features)){const [x,y]=c.center;c.landPolygons.push([[x-18,y-18],[x+5,y-8],[x+14,y+15],[x+2,y+23],[x-6,y+4]],[[x+26,y+31],[x+37,y+34],[x+40,y+43],[x+31,y+40]]);}
 c.actualCrossingEdges=edgeNames.filter((_,i)=>(c.cornerValues[i]>=0)!==(c.cornerValues[(i+1)%6]>=0));
 c.geometryReviewNotes=[];
 if(c.requestedCrossingEdges.some(e=>!c.actualCrossingEdges.includes(e)))c.geometryReviewNotes.push('Prose shoreline endpoint requires visual review against shared-edge geometry.');
 if(c.requestedCrossingEdges.length>2)c.geometryReviewNotes.push('Multiple shore segments: confirm connected land forms against prose.');
 if(c.special)c.geometryReviewNotes.push('Special islands/dip geometry needs targeted image-generation interpretation.');
 delete c.localCornerValues;
}
// Narrow audited peninsulas and lake channels need shared-edge midpoint detail
// that six corner samples alone cannot represent. Clip continuous regional
// ribbons into each face, preserving exact shared-edge intersections.
function clipConvex(poly,clip){let result=poly;for(let i=0;i<clip.length;i++){const a=clip[i],b=clip[(i+1)%clip.length];const cross=p=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);const next=[];for(let j=0;j<result.length;j++){const p=result[j],q=result[(j+1)%result.length],vp=cross(p),vq=cross(q);if(vp>=-1e-7)next.push(p);if((vp>=0)!==(vq>=0)){const t=vp/(vp-vq);next.push([p[0]+t*(q[0]-p[0]),p[1]+t*(q[1]-p[1])]);}}result=next;if(!result.length)break;}return result;}
function ribbon(a,b,width){const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),ox=-dy/len*width/2,oy=dx/len*width/2;return [[a[0]+ox,a[1]+oy],[a[0]-ox,a[1]-oy],[b[0]-ox,b[1]-oy],[b[0]+ox,b[1]+oy]];}
const regionalDetails=[
 {kind:'land',name:'Baja peninsula continuity',cells:['8/3','9/3','10/3','11/4','12/4','13/5'],width:37},
 {kind:'land',name:'Southern Florida continuity',cells:['10/19','11/19','12/19','12/20'],width:42},
 {kind:'water',name:'Lake Huron to Detroit channel',cells:['3/17','4/17','4/18'],width:30},
 {kind:'water',name:'Lake Erie to Ontario channel',cells:['4/18','4/19','3/19'],width:28},
];
for(const c of cells)c.waterPolygons=[];
for(const detail of regionalDetails){for(let i=0;i<detail.cells.length-1;i++){const shape=ribbon(byId.get(detail.cells[i]).center,byId.get(detail.cells[i+1]).center,detail.width);for(const c of cells){const p=clipConvex(shape,c.polygon);if(p.length<3)continue;(detail.kind==='land'?c.landPolygons:c.waterPolygons).push(p);c.geometryReviewNotes.push(detail.name+' is a continuous visual interpolation; compare with audit.');}}}
const bounds={x:0,y:0,width:W+23*W*.75,height:14.5*H};
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const pts=p=>p.map(x=>x.map(n=>n.toFixed(3)).join(',')).join(' ');
function svg(selected,box,labels=true,highlight){return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.x} ${box.y} ${box.width} ${box.height}" width="${Math.round(box.width)}" height="${Math.round(box.height)}"><rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="#24677c"/>${selected.map(c=>`${c.landPolygons.map(p=>`<polygon points="${pts(p)}" fill="#92966a" stroke="#92966a" stroke-width="0.5"/>`).join('')}`).join('')}${selected.flatMap(c=>c.waterPolygons).map(p=>`<polygon points="${pts(p)}" fill="#24677c" stroke="#24677c" stroke-width="0.5"/>`).join('')}${labels?selected.map(c=>`<polygon points="${pts(c.polygon)}" fill="none" stroke="${c.id===highlight?'#ffdb6b':'#ffffff'}" stroke-opacity="${c.id===highlight?1:.3}" stroke-width="${c.id===highlight?5:1}"/><text x="${c.center[0]}" y="${c.center[1]}" text-anchor="middle" fill="#fff" font-family="sans-serif" font-size="20">${esc(c.id)}</text>`).join(''):''}</svg>`;}
await fs.mkdir(path.join(out,'guides'),{recursive:true});await fs.mkdir(path.join(out,'regions'),{recursive:true});
await fs.writeFile(path.join(out,'full-board-guide.svg'),svg(cells,bounds));
await fs.writeFile(path.join(out,'full-board-mask.svg'),svg(cells,bounds,false));
for(const c of cells){const selected=[c,...Object.values(c.neighbors).map(id=>byId.get(id))];const box={x:c.center[0]-W*1.4,y:c.center[1]-H*1.6,width:W*2.8,height:H*3.2};await fs.writeFile(path.join(out,c.guide),svg(selected,box,true,c.id));}
const regions=[['pacific',0,7,0,13],['great-lakes',13,20,0,6],['gulf-florida',10,21,8,13],['atlantic',18,23,0,9],['islands',20,23,10,13]];
const regionManifest=[];for(const [id,minCol,maxCol,minRow,maxRow]of regions){const selected=cells.filter(c=>c.column>=minCol&&c.column<=maxCol&&c.row>=minRow&&c.row<=maxRow);const all=selected.flatMap(c=>c.polygon);const x=Math.min(...all.map(p=>p[0])),y=Math.min(...all.map(p=>p[1]));const box={x,y,width:Math.max(...all.map(p=>p[0]))-x,height:Math.max(...all.map(p=>p[1]))-y};const file=`regions/${id}.svg`;await fs.writeFile(path.join(out,file),svg(selected,box));regionManifest.push({id,guide:file,bounds:box,cells:selected.map(c=>c.id)});}
const manifest={version:1,status:'geometry-candidate',source:'docs/authoritative-board-human-audit.md',sourceSha256:crypto.createHash('sha256').update(audit).digest('hex'),coordinateSystem:'flat-top odd-column-down',width:W,height:H,bounds,counts:{cells:cells.length,uniqueArt:cells.filter(c=>c.uniqueArt).length,reviewCandidates:cells.filter(c=>c.geometryReviewNotes.length).length},palette:{land:'#92966a',water:'#24677c'},regions:regionManifest,cells:Object.fromEntries(cells.map(c=>[c.id,c]))};
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
await fs.writeFile(path.join(out,'README.md'),'# Board art geometry guides\n\nGenerated by `node scripts/build-board-art-guides.mjs` from the completed human audit. These vector files are generation guides, not finished game artwork. Final cell images must be generated with imagegen and reviewed in their assembled neighborhoods.\n\n`manifest.json` keys all 336 cells by row/column. Coordinates use flat-top hexes with odd columns shifted down. Tile width is 256 units; the same shared corner scalar creates identical land/water occupancy on both sides of every shared edge. Prose shoreline interpretation is a candidate: `geometryReviewNotes` flags cases needing contextual visual review. Audit facts and rule barriers are retained verbatim and never inferred from the illustration.\n\n`full-board-guide.svg` contains coordinate labels; `full-board-mask.svg` is unlabelled; `regions/` provides generation neighborhoods; `guides/` provides each cell with its neighbor ring.\n');
console.log(JSON.stringify(manifest.counts));
