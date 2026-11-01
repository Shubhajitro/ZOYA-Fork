// Deterministic execution tests for the PvP Expert Controller's physical
// executors against a scripted fake Mineflayer bot (no server, no network).
// They verify what the controller SENDS and how it classifies outcomes; they
// do not and cannot prove live PvP effectiveness.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Vec3 } from "vec3";
import { createPvpExpertController } from "./pvpExpertController.mjs";
import { getCombatAuthority } from "./combatAuthority.mjs";

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const goals={GoalFollow:class{constructor(t,r){this.t=t;this.r=r}}};

function makeWorld({items=["diamond_sword","diamond_axe","mace","shield"],targetPos=new Vec3(0,64,2.5)}={}){
  const bot=new EventEmitter();
  const inventory=items.map((name,i)=>({name,count:1,slot:36+i,type:i+1}));
  bot.inventory={items:()=>inventory,slots:[]};
  bot.heldItem=inventory[0];
  bot.entity={id:1,position:new Vec3(0,64,0),velocity:new Vec3(0,0,0),onGround:true,height:1.8,eyeHeight:1.62,
    yaw:Math.PI,pitch:0,equipment:[],metadata:[]};
  bot.health=20;bot.food=20;bot.game={dimension:"overworld"};bot.time={age:0};
  bot.controls={};bot.attacks=[];bot.uses=[];
  bot.setControlState=(k,v)=>{bot.controls[k]=Boolean(v);bot.emit("control",k,Boolean(v))};
  bot.getControlState=k=>Boolean(bot.controls[k]);
  bot.clearControlStates=()=>{for(const k of Object.keys(bot.controls))bot.controls[k]=false};
  bot.lookAt=async()=>{};
  bot.equip=async(item)=>{if(bot.heldItem!==item){bot.heldItem=item;bot.emit("heldItemChanged",item)}};
  bot.setQuickBarSlot=slot=>{const i=inventory.find(x=>x.slot===36+slot);if(i&&bot.heldItem!==i){bot.heldItem=i;bot.emit("heldItemChanged",i)}};
  bot.activateItem=()=>bot.uses.push({type:"activate",at:Date.now(),item:bot.heldItem?.name});
  bot.deactivateItem=()=>bot.uses.push({type:"deactivate",at:Date.now(),item:bot.heldItem?.name});
  bot.pathfinder={setGoal(){}};
  bot.blockAt=()=>null;
  bot.entities={};
  const target={id:2,username:"enemy",type:"player",position:targetPos,velocity:new Vec3(0,0,0),height:1.8,width:0.6,
    health:20,onGround:true,equipment:[],metadata:[]};
  bot.players={enemy:{username:"enemy",entity:target}};
  bot.entities[2]=target;
  // Fake server: every attack packet in reach deals damage shortly after.
  bot.attack=e=>{
    bot.attacks.push({at:Date.now(),sprint:bot.getControlState("sprint"),onGround:bot.entity.onGround,
      vy:bot.entity.velocity.y,held:bot.heldItem?.name});
    if(bot.onAttack)bot.onAttack(e);
    setTimeout(()=>{e.health=Math.max(0,e.health-2)},20);
  };
  return {bot,target};
}

function makeController(bot,{active=()=>true,difficulty}={}){
  const lines=[];
  const c=createPvpExpertController({bot,goals,taskIsActive:active,log:l=>lines.push(l),difficulty});
  return {c,lines};
}

// 1) Attack charge: a second swing inside the sword cooldown is not sent.
{
  const {bot,target}=makeWorld();
  const {c}=makeController(bot);
  c.__testing.begin("enemy");
  assert.equal(await c.__testing.attack(target,"sword"),true,"first sword swing is confirmed by fake server damage");
  assert.equal(bot.attacks.length,1);
  assert.equal(await c.__testing.attack(target,"sword",3,{deferOnCharge:false}),false,"callers needing a real hit get false");
  assert.equal(bot.attacks.length,1,"no weak swing is sent while the sword is still charging");
  const deferred=await c.__testing.attack(target,"sword");
  assert.equal(deferred,true,"a charging melee action defers (moves) instead of failing");
  assert.equal(bot.attacks.length,1,"deferral moves instead of sending a weak swing");
  const counts=c.telemetry.counts().sword_melee;
  assert.equal(counts.executed,1);assert.equal(counts.confirmed,1);assert.ok(counts.rejected>=2);
  await sleep(Math.max(0,c.state.nextAttackAt-Date.now())+20);
  assert.equal(await c.__testing.attack(target,"sword"),true);
  assert.equal(bot.attacks.length,2,"swing is sent once the tick-model charge is strong");
  const gap=bot.attacks[1].at-bot.attacks[0].at;
  assert.ok(gap>=550,"sword swings are at least 11 server ticks apart, got "+gap+"ms");
  c.__testing.end();
}
console.log("Tick-aware attack charge execution tests passed.");

// 2) Weapon switching resets charge (Player.tick) and uses the new weapon's speed.
{
  const {bot,target}=makeWorld();
  const {c}=makeController(bot);
  c.__testing.begin("enemy");
  assert.equal(await c.__testing.attack(target,"sword"),true);
  await sleep(700);
  assert.equal(await c.__testing.attack(target,"axe",3,{deferOnCharge:false}),false,"axe swing right after a swap is withheld");
  assert.equal(bot.attacks.length,1);
  assert.equal(c.mechanics.chargeTracker.lastResetReason(),"weapon_change");
  assert.equal(bot.heldItem.name,"diamond_axe");
  const wait=c.state.nextAttackAt-Date.now();
  assert.ok(wait>800&&wait<=1000,"diamond axe needs 18 ticks (+1 jitter) after the swap, got "+wait+"ms");
  c.__testing.end();
}
console.log("Weapon-switch charge reset execution tests passed.");

// 3) Reach: vanilla 3.0 eye-to-hitbox cap unless extended reach is explicitly enabled.
{
  const {bot,target}=makeWorld({targetPos:new Vec3(0,64,3.34)}); // eye-hitbox distance 3.04
  const {c}=makeController(bot);
  c.__testing.begin("enemy");
  assert.equal(c.mechanics.reachCap,3.0);
  assert.equal(await c.__testing.attack(target,"sword",3.05),false);
  assert.equal(bot.attacks.length,0,"3.04 is beyond vanilla client reach");
  assert.equal(c.telemetry.counts().sword_melee.rejected,1);
  c.__testing.end();
  const w2=makeWorld({targetPos:new Vec3(0,64,3.34)});
  const {c:c2}=makeController(w2.bot,{difficulty:{allowExtendedReach:true,attackRange:3.05}});
  c2.__testing.begin("enemy");
  assert.equal(await c2.__testing.attack(w2.target,"sword",3.05),true,"opt-in extended reach keeps the old 3.05 cap");
  c2.__testing.end();
}
console.log("Reach cap execution tests passed.");

// 4) Falling crit against scripted vanilla jump physics (g 0.08, drag 0.98, jump 0.42).
async function withPhysics(bot,fn){
  let vy=0;
  const tick=setInterval(()=>{
    const e=bot.entity;
    if(e.onGround&&bot.getControlState("jump")){vy=0.42;e.onGround=false}
    if(!e.onGround){
      e.position=e.position.offset(0,vy,0);vy=(vy-0.08)*0.98;
      if(e.position.y<=64){e.position=new Vec3(e.position.x,64,e.position.z);vy=0;e.onGround=true}
    }
    e.velocity=new Vec3(0,e.onGround?0:vy,0);
  },50);
  try{return await fn()}finally{clearInterval(tick)}
}
{
  const {bot,target}=makeWorld();
  const {c}=makeController(bot);
  c.__testing.begin("enemy");
  // Fake server crit rule (Player.canCriticalAttack): falling, airborne, not sprinting.
  bot.onAttack=e=>{
    const a=bot.attacks.at(-1);
    if(!a.sprint&&!a.onGround&&a.vy<0)setTimeout(()=>bot.emit("entityCriticalEffect",e),10);
  };
  const ok=await withPhysics(bot,()=>c.__testing.fallingCrit(target));
  assert.equal(ok,true);
  assert.equal(bot.attacks.length,1);
  const a=bot.attacks[0];
  assert.equal(a.sprint,false,"crit swing must be sent with sprint released");
  assert.equal(a.onGround,false,"crit swing must be airborne");
  assert.ok(a.vy<0,"crit swing must be during the descent, vy="+a.vy);
  assert.equal(c.telemetry.counts().falling_crit.confirmed,1,"crit confirmed only by the server crit animation");
  // Immediately again: charge is not strong, so no jump and no swing.
  bot.onAttack=null;
  assert.equal(await c.__testing.fallingCrit(target),false);
  assert.equal(bot.attacks.length,1);
  assert.ok(c.telemetry.events().some(e=>e.technique==="falling_crit"&&e.phase==="rejected"&&e.reason==="charge_not_ready"));
  // A hit without the crit animation is NOT reported as a crit.
  await sleep(650);
  assert.equal(await withPhysics(bot,()=>c.__testing.fallingCrit(target)),true);
  assert.equal(c.telemetry.counts().falling_crit.confirmed,1);
  assert.ok(c.telemetry.events().some(e=>e.technique==="falling_crit"&&e.phase==="unconfirmed"&&e.reason==="hit_without_crit_animation"));
  c.__testing.end();
}
console.log("Falling-crit execution tests passed.");

// 5) Cancellation: a cancelled task sends no attack and leaves no movement keys held.
{
  const {bot,target}=makeWorld();
  let active=true;
  const {c}=makeController(bot,{active:()=>active});
  c.__testing.begin("enemy");
  const p=withPhysics(bot,()=>c.__testing.fallingCrit(target));
  setTimeout(()=>{active=false},60);
  assert.equal(await p,false);
  assert.equal(bot.attacks.length,0);
  assert.ok(Object.values(bot.controls).every(v=>v===false),"controls cleared after cancellation");
  assert.ok(c.telemetry.events().some(e=>e.technique==="falling_crit"&&e.reason==="cancelled"));
  c.__testing.end();
}
console.log("Cancellation execution tests passed.");

// 6) Shield: held for the 5-tick block delay PLUS the requested impact window;
//    a block is confirmed only by the server's shield-block sound.
{
  const {bot,target}=makeWorld();
  const {c,lines}=makeController(bot);
  c.__testing.begin("enemy");
  setTimeout(()=>bot.emit("soundEffectHeard","item.shield.block",bot.entity.position.offset(0,1,0)),330);
  assert.equal(await c.__testing.shield(target,260),false,"fake bot exposes no blocking metadata, so the raise pose is not observed");
  const up=bot.uses.find(u=>u.type==="activate"&&u.item==="shield");
  const down=bot.uses.find(u=>u.type==="deactivate"&&u.item==="shield");
  assert.ok(up&&down);
  assert.ok(down.at-up.at>=500,"shield held >= 250ms delay + 260ms window, got "+(down.at-up.at));
  assert.equal(c.telemetry.counts().shield_block.confirmed,1);
  assert.ok(lines.some(l=>l.includes("effective_after_ms=250")));
  assert.equal(bot.heldItem.name,"diamond_sword","melee weapon restored after blocking");
  c.state.shieldCooldownUntil=0;
  await c.__testing.shield(target,260);
  assert.equal(c.telemetry.counts().shield_block.unconfirmed,1,"no block signal means unconfirmed, not success");
  c.__testing.end();
}
console.log("Shield activation execution tests passed.");

// 7) Mace smash prerequisites: no smash while gliding; smash once fall > 1.5.
{
  const {bot,target}=makeWorld({targetPos:new Vec3(0,62,2)});
  const {c}=makeController(bot);
  c.__testing.begin("enemy");
  Object.assign(bot.entity,{onGround:false,velocity:new Vec3(0,-0.5,0),elytraFlying:true});
  assert.equal(await c.__testing.maceSmash(target,3),false);
  assert.equal(bot.attacks.length,0,"MaceItem.canSmashAttack is false while fall-flying");
  assert.ok(c.telemetry.events().some(e=>e.technique==="mace_smash"&&e.reason==="no_smash_window"));
  bot.entity.elytraFlying=false;
  assert.equal(await c.__testing.maceSmash(target,1.4),false,"fall 1.4 is below the 1.5 smash threshold");
  assert.equal(bot.attacks.length,0);
  assert.equal(await c.__testing.maceSmash(target,2),true);
  assert.equal(bot.attacks.length,1);
  assert.equal(bot.attacks[0].held,"mace");
  assert.equal(bot.attacks[0].sprint,false,"smash is sent unsprinted so a strong hit can also crit");
  const exec=c.telemetry.events().find(e=>e.technique==="mace_smash"&&e.phase==="executed");
  assert.ok(exec.predictedRawDamage>=8,"telemetry records the predicted smash damage");
  c.__testing.end();
}
console.log("Mace smash execution tests passed.");

// 8) Combat authority: the controller refuses to run while another owner holds combat domains.
{
  const {bot}=makeWorld();
  const {c,lines}=makeController(bot);
  const other=getCombatAuthority(bot).acquire("capability_critical_attack");
  const task={};
  assert.equal(await c.run("enemy",task),false);
  assert.equal(task.terminationReason,"combat_authority_busy:capability_critical_attack");
  assert.equal(bot.attacks.length,0);
  assert.ok(lines.some(l=>l.includes("combat_authority_busy")));
  other.release();
  assert.equal(getCombatAuthority(bot).holder("attack"),null);
}
console.log("Combat authority execution tests passed.");
console.log("All PvP combat execution tests passed.");
