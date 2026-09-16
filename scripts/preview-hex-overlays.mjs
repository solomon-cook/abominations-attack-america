import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
const dir='apps/web/public/assets/board/overlays';
const examples=[['city-health','1 HP city',[]],['city-1d','1D city',['army']],['city-2d','2D city',['navy']],['city-3d','3D city',[]],['infamy-site','Infamy + base',['air-force']],['mutation-site','Mutation',[]],['challenge-site','Challenge',[]],['lair-gargantis','Gargantis lair',[]],['city-1d','San Diego',['navy','marines']],['','All branch stars',['army','navy','air-force','marines']],...['konk','megaclaw','tomanagi','toxicor','zorb'].map(id=>[`lair-${id}`,`${id} lair`,[]])];
let body='<rect width="1200" height="887" fill="#182923"/><text x="32" y="40" fill="#f4e5bc" font-family="Arial" font-size="24">HEX OVERLAYS · full-hex lairs and challenge / half-hex markers</text>';
const embed=(name,x,y,w,h)=>`<image x="${x}" y="${y}" width="${w}" height="${h}" href="data:image/svg+xml;base64,${Buffer.from(readFileSync(`${dir}/${name}.svg`)).toString('base64')}"/>`;
for(let i=0;i<examples.length;i++){
 const [asset,label,bases]=examples[i],x=20+i%5*238,y=70+Math.floor(i/5)*267;
 body+=`<g transform="translate(${x} ${y})"><path d="M55 0H165L220 95 165 190H55L0 95Z" fill="#828847" stroke="#ccc794" stroke-width="2"/><path d="M0 95H220" stroke="#eee5bc" stroke-dasharray="4 5" opacity=".35"/>`;
 if(asset==='challenge-site'||asset.startsWith('lair-'))body+=embed(asset,0,0,220,190);
 else if(asset)body+=embed(asset,35.2,9.5,149.6,79.8);
 const n=bases.length,star=29,gap=4;
 bases.forEach((base,j)=>body+=embed(`base-${base}`,110-(n*star+(n-1)*gap)/2+j*(star+gap),119.7,star,45.6));
 body+=`<text x="110" y="225" fill="#f4e5bc" text-anchor="middle" font-family="Arial" font-size="17">${label}</text></g>`;
}
const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="887">${body}</svg>`;
writeFileSync('output/hex-overlays/preview.svg',svg);
await sharp(Buffer.from(svg)).png().toFile('output/hex-overlays/preview.png');
console.log('Rendered overlay preview');
