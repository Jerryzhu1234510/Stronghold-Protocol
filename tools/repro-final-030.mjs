import { makeMatch } from '../test/match/harness.js';
import { PHASE } from '../shared/constants.js';
const seats = Array.from({length:4}, (_,i)=>({seat:i,playerId:`ai_${i}`,name:`AI${i}`,isBot:true,connected:true}));
const h=makeMatch({mode:'coop',difficulty:'ABYSS',seats,seed:2,captureFrames:false,instant:false});
const m=h.m; m.bossId='boss_1'; m.start(); let last='';
h.run(()=>{const k=`${m.phase}:${m.round}`; if(k!==last){last=k;if(m.phase===PHASE.PREP && m.round===1)for(const ps of m.players.values())ps.lp=400;}return h.ended!=null||m.phase===PHASE.FINAL_ASSAULT;},{maxSteps:8e6});
console.log(JSON.stringify({phase:m.phase,errors:m.errors,logs:h.logs,fields:m.fields.map(f=>({id:f.fieldId,battle:f.battle?.constructor?.name}))},null,2));
m.dispose();
