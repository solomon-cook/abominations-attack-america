/** Reinsert the image-generator's localized inlet edit at its original crop coordinates. */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const sharp=createRequire(import.meta.url)('sharp');
const base='output/board-art';
const assembly=`${base}/seamless-board-corrected.png`, edit=`${base}/inlet-edited.png`;
const crop={left:130,top:85,width:140,height:105};
const patch=await sharp(edit).resize(crop.width,crop.height,{fit:'fill'}).png().toBuffer();
const destination=`${base}/seamless-board-reviewed.png`;
await sharp(assembly).composite([{input:patch,left:crop.left,top:crop.top}]).png().toFile(destination);
const sha=async file=>crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
await fs.writeFile(`${base}/generation/assembled-reviewed.json`,JSON.stringify({
  operation:'Geometric reinsertion of image_gen crop; no procedural terrain drawing',
  assembly:{path:assembly,sha256:await sha(assembly)},edit:{path:edit,sha256:await sha(edit)},crop,
  output:{path:destination,sha256:await sha(destination)},
  sourcePrompts:['generation/seamless-board-corrected.json','generation/inlet-edited.json']
},null,2)+'\n');
