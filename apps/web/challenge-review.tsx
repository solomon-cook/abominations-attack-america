import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {createGame, applyCommand, type GameCommand} from '@abominations/game-engine';
import {ChallengeArena} from './src/components/ChallengeArena';
import './src/styles.css';
import './src/encounter-command.css';
import './src/chat-ui.css';
import './src/combat-stage.css';
function App(){
 const [game,setGame]=useState(()=>{const g=createGame(3,0);g.phase='challenge';g.units.forEach(u=>u.location='record-tile');g.monsters.forEach(m=>{m.health=12;m.infamy=3;m.attacks=1;m.defense=2;});g.players[0].mutationCardIds=['War Spikes'];g.players[1].mutationCardIds=["It's a Robot!"];g.challenge={declared:true,active:true,challengerMonsterId:g.monsters[0].id,declarationPlayerIndex:0,pendingStartPlayerIndex:0,weighInHealth:{},defeatedMonsterIds:[]};g.pendingDecision={type:'challenge-opponent',playerIndex:0,challengerMonsterId:g.monsters[0].id,opponentIds:g.monsters.slice(1).map(m=>m.id)};return g;});
 const [open,setOpen]=useState(true); const [error,setError]=useState('');
 return <><button onClick={()=>setOpen(true)}>Open challenge</button>{open&&<ChallengeArena game={game} canAct={game.phase!=='game-over'} onClose={()=>setOpen(false)} error={error} runCommand={(c:GameCommand)=>{try{setGame(applyCommand(game,c).state);setError('');}catch(e){setError(String(e));}}}/>}</>
};createRoot(document.getElementById('root')!).render(<App/>);
