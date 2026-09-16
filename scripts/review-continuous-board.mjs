/** Render labeled neighbor contact sheets for visual review of the assembled edit. */
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
const sharp=createRequire(import.meta.url)('sharp');
const base='output/board-art';
const g=JSON.parse(await fs.readFile(`${base}/manifest.json`));
const source=process.argv.find(argument=>argument.startsWith('--source='))?.slice(9)??`${base}/seamless-board-candidate.png`;
const data=`data:image/png;base64,${(await fs.readFile(source)).toString('base64')}`;
const reviewDir=source.includes('reviewed')?'reviewed':source.includes('corrected')?'corrected':'continuous';
const cells=Object.values(g.cells);const unique=cells.filter(c=>c.uniqueArt);
await fs.mkdir(`${base}/review/${reviewDir}`,{recursive:true});
for(let start=0;start<unique.length;start+=15){
 const cards=[];
 for(const [index,c] of unique.slice(start,start+15).entries()){
  const bounds={x:c.center[0]-384,y:c.center[1]-350,w:768,h:700};
  const nearby=cells.filter(n=>Math.abs(n.center[0]-c.center[0])<384&&Math.abs(n.center[1]-c.center[1])<350);
  const lines=nearby.map(n=>`<polygon points="${n.polygon.map(p=>p.join(',')).join(' ')}" fill="none" stroke="${n.id===c.id?'#ffdf75':'#ffffff'}" stroke-width="${n.id===c.id?6:1}"/><text x="${n.center[0]}" y="${n.center[1]}" text-anchor="middle" font-size="27" fill="white" stroke="#102020" paint-order="stroke" stroke-width="3">${n.id}</text>`).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="384" height="350" viewBox="${bounds.x} ${bounds.y} ${bounds.w} ${bounds.h}"><rect x="${bounds.x}" y="${bounds.y}" width="768" height="700" fill="#182a2a"/><image xlink:href="${data}" width="${g.bounds.width}" height="${g.bounds.height}" preserveAspectRatio="none"/>${lines}</svg>`;
  const input=await sharp(Buffer.from(svg)).png().toBuffer();
  await fs.writeFile(`${base}/review/${reviewDir}/r${c.row}-c${c.column}.png`,input);
  cards.push({input,left:(index%5)*384,top:Math.floor(index/5)*350});
 }
 await sharp({create:{width:1920,height:1050,channels:3,background:'#182a2a'}}).composite(cards).png().toFile(`${base}/review/${reviewDir}/sheet-${start/15+1}.png`);
}
console.log('Rendered all75 unique-cell neighborhoods in five contact sheets.');
