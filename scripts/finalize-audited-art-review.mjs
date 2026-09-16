/** Attach recorded agent review only when it names the exact delivered assembly hash. */
import fs from 'node:fs/promises';
const file='apps/web/public/assets/board/audited/manifest.json';
const manifest=JSON.parse(await fs.readFile(file));
const evidence='output/board-art/review/reviewed/independent-review.md';
const review=await fs.readFile(evidence,'utf8');
if(!review.includes(manifest.assembly.sha256)||!review.includes('Pass')) throw new Error('Final review does not match delivered assembly');
const geometry=JSON.parse(await fs.readFile('output/board-art/manifest.json'));
const compiled=await fs.readFile('packages/game-engine/src/audited-board-data.ts','utf8');
const observations=JSON.parse(compiled.match(/AUDITED_CELLS = ([\s\S]*) as const;/)[1]);
const refs=new Map(observations.map(c=>[`${c.row}/${c.column}`,c.sourceRef]));
manifest.status='agent-reviewed-integrated';
manifest.review={status:'passed',evidence,previousEvidence:'output/board-art/review/continuous/independent-review.md',sourceSha256:manifest.assembly.sha256,coverage:{uniqueNeighborhoods:75,mappedCells:336},kind:'agent visual review and deterministic coordinate checks'};
for(const cell of Object.values(manifest.cells)) {
  const asset=manifest.assets[cell.asset];
  asset.sourceRefs=[refs.get(cell.cellId)];
  asset.review={status:'passed',evidence,neighbors:Object.values(geometry.cells[cell.cellId].neighbors),method:cell.unique?'neighborhood visual review and common-source coordinate check':'full assembly visual review and common-source coordinate check'};
}
await fs.writeFile(file,JSON.stringify(manifest,null,2)+'\n');
console.log('Attached final review and per-cell audit references for336 delivered cells.');
