import assert from "node:assert/strict";
import * as M from "./combatMechanics.mjs";
import { createCombatTelemetry } from "./combatTelemetry.mjs";
import { createCombatAuthority, getCombatAuthority } from "./combatAuthority.mjs";

const near=(a,b,eps=1e-6,msg)=>assert.ok(Math.abs(a-b)<=eps,(msg||"")+" expected "+b+" got "+a);

// Attack speed per weapon (Items/ToolMaterial/MaceItem/TridentItem, 1.21.11).
near(M.itemAttackSpeed("diamond_sword"),1.6);
near(M.itemAttackSpeed({name:"netherite_sword"}),1.6);
near(M.itemAttackSpeed("wooden_axe"),0.8);
near(M.itemAttackSpeed("stone_axe"),0.8);
near(M.itemAttackSpeed("copper_axe"),0.8);
near(M.itemAttackSpeed("iron_axe"),0.9);
near(M.itemAttackSpeed("diamond_axe"),1.0);
near(M.itemAttackSpeed("netherite_axe"),1.0);
near(M.itemAttackSpeed("diamond_pickaxe"),1.2,1e-6,"pickaxe must not match the axe rule");
near(M.itemAttackSpeed("mace"),0.6);
near(M.itemAttackSpeed("trident"),1.1);
near(M.itemAttackSpeed("wooden_spear"),1/0.65);
near(M.itemAttackSpeed("netherite_spear"),1/1.15);
near(M.itemAttackSpeed(null),4.0);
near(M.itemAttackSpeed("golden_apple"),4.0);
console.log("Attack-speed table tests passed.");

// Cooldown ticks: 20/speed; strong when (ticks+0.5)/delay > 0.9.
near(M.attackDelayTicks(1.6),12.5);
near(M.attackDelayTicks(0.6),100/3);
assert.equal(M.ticksUntilCharge(1.6),11,"sword strong at 11 ticks");
assert.equal(M.ticksUntilCharge(1.6,1),12,"sword full at 12 ticks (+0.5 partial)");
assert.equal(M.ticksUntilCharge(0.8),23);
assert.equal(M.ticksUntilCharge(0.9),20);
assert.equal(M.ticksUntilCharge(1.0),18);
assert.equal(M.ticksUntilCharge(0.6),30);
assert.equal(M.isStrongAttack(M.attackCharge(10,1.6)),false,"10 ticks is not strong for a sword");
assert.equal(M.isStrongAttack(M.attackCharge(11,1.6)),true);
// The old fixed 1000ms axe cooldown hit wooden/stone axes at 82% charge.
near(M.attackCharge(20,0.8),0.82,1e-9);
assert.equal(M.isStrongAttack(M.attackCharge(20,0.8)),false);
near(M.damageScale(M.attackCharge(20,0.8)),0.2+0.82*0.82*0.8,1e-9);
near(M.damageScale(1),1);near(M.damageScale(0),0.2);
// Haste-style multiplied modifiers apply on top of the item value; item base modifier is ignored.
near(M.effectiveAttackSpeed("diamond_sword",{value:1.6,modifiers:[{id:"minecraft:base_attack_speed",amount:-2.4,operation:0}]}),1.6);
near(M.effectiveAttackSpeed("diamond_sword",{modifiers:[{id:"minecraft:effect.haste",amount:0.2,operation:2}]}),1.92);
near(M.effectiveAttackSpeed("diamond_sword",{modifiers:[{id:"minecraft:effect.mining_fatigue",amount:-0.1,operation:"add_multiplied_total"}]}),1.44);
console.log("Attack charge/tick timing tests passed.");

// Server tick clock + charge tracker: weapon type change resets charge, swing resets charge.
{
  let t=0;const now=()=>t;
  const clock=M.createServerTickClock({now});
  assert.equal(clock.tps(),20);
  near(clock.msForTicks(11),550);
  clock.observeWorldAge(1000,0);clock.observeWorldAge(1010,1000); // 10 TPS sample
  assert.ok(clock.tps()<20&&clock.tps()>=10,"lagging server must lower the TPS estimate");
  assert.ok(clock.msForTicks(11)>550,"under lag the same tick count needs more wall time");
  clock.observeWorldAge(1010,1000);clock.observeWorldAge(1010,1000.4); // invalid samples ignored
  const c2=M.createServerTickClock({now});
  const tr=M.createAttackChargeTracker({clock:c2,now});
  assert.equal(tr.charge(1.6),1,"no swing yet means fully charged");
  tr.noteHeldItem("diamond_sword",0);
  tr.noteSwing(0);
  t=500;assert.equal(M.isStrongAttack(tr.charge(1.6)),false,"10 ticks after swing is not strong");
  t=550;assert.equal(M.isStrongAttack(tr.charge(1.6)),true,"11 ticks after swing is strong");
  assert.equal(tr.readyAt(1.6),550);
  assert.equal(tr.readyAt(1.6,1),600);
  assert.equal(tr.readyAt(1.6,0.9,1),600,"jitter margin adds whole ticks");
  tr.noteHeldItem("diamond_sword",700);
  assert.equal(tr.lastResetReason(),"swing","same item type must not reset charge");
  t=800;tr.noteHeldItem("diamond_axe",800);
  assert.equal(tr.lastResetReason(),"weapon_change");
  t=900;assert.equal(tr.ticksSinceReset(),2);
  assert.equal(tr.readyAt(1.0),800+18*50,"axe after swap needs 18 ticks from the swap");
}
console.log("Server-tick clock and weapon-switch charge tests passed.");

// Critical hits (Player.canCriticalAttack + strong).
{
  const ok={charge:1,fallDistance:0.2,onGround:false,sprinting:false};
  assert.equal(M.canCriticalHit(ok),true);
  assert.deepEqual(M.critBlockers({...ok,sprinting:true}),["sprinting"]);
  assert.deepEqual(M.critBlockers({...ok,fallDistance:0}),["no_fall_distance"],"rising part of a jump has zero fall distance");
  assert.deepEqual(M.critBlockers({...ok,onGround:true}),["on_ground"]);
  assert.deepEqual(M.critBlockers({...ok,charge:0.85}),["charge_not_strong"]);
  assert.ok(M.critBlockers({...ok,inWater:true,onClimbable:true}).includes("in_water"));
  assert.equal(M.canSprintKnockback({charge:1,sprinting:true}),true);
  assert.equal(M.canSprintKnockback({charge:0.8,sprinting:true}),false);
}
console.log("Critical-hit prerequisite tests passed.");

// Mace smash (MaceItem).
{
  assert.equal(M.canMaceSmash({fallDistance:1.5}),false,"threshold is strictly greater than 1.5");
  assert.equal(M.canMaceSmash({fallDistance:1.51}),true);
  assert.equal(M.canMaceSmash({fallDistance:10,fallFlying:true}),false,"no smash while gliding");
  near(M.maceSmashBonus(1.6),6.4);near(M.maceSmashBonus(3),12);near(M.maceSmashBonus(5),16);
  near(M.maceSmashBonus(8),22);near(M.maceSmashBonus(12),26);assert.equal(M.maceSmashBonus(1.5),0);
  // Smash bonus is added after charge scaling; crit multiplies base+bonus.
  near(M.meleeDamage({attackDamage:6,charge:1,mace:true,fallDistance:5,crit:true}),(6+16)*1.5);
  near(M.meleeDamage({attackDamage:6,charge:0.5,mace:true,fallDistance:5,crit:true}),6*(0.2+0.25*0.8)+16,1e-9,
    "a weak mace hit keeps the full smash bonus but cannot crit");
}
console.log("Mace smash mechanics tests passed.");

// Shield activation (BlocksAttacks: 5-tick delay, 90 degree frontal cover).
{
  assert.equal(M.isShieldEffective(4),false);assert.equal(M.isShieldEffective(5),true);
  const self={x:0,y:64,z:0};
  assert.equal(M.shieldCoversSource({selfPosition:self,sourcePosition:{x:0,y:64,z:3},headYawDeg:0}),true,"yaw 0 faces +Z");
  assert.equal(M.shieldCoversSource({selfPosition:self,sourcePosition:{x:0,y:64,z:-3},headYawDeg:0}),false,"attacker behind");
  assert.equal(M.shieldCoversSource({selfPosition:self,sourcePosition:{x:3,y:64,z:0.01},headYawDeg:0}),true,"just inside 90 degrees");
  assert.equal(M.shieldCoversSource({selfPosition:self,sourcePosition:{x:3,y:64,z:-0.1},headYawDeg:0}),false,"just outside 90 degrees");
  assert.equal(M.shieldCoversSource({selfPosition:self,sourcePosition:{x:-3,y:64,z:0},headYawDeg:90}),true,"yaw 90 faces -X");
  near(M.mineflayerYawToMinecraftDeg(Math.PI),0);near(M.mineflayerYawToMinecraftDeg(0),180);
}
console.log("Shield activation and coverage tests passed.");

// Explosions (ExplosionDamageCalculator).
near(M.explosionDamage({power:6,distance:0}),85);
near(M.explosionDamage({power:6,distance:2}),((5/6)**2+5/6)/2*84+1,1e-9);
assert.equal(M.explosionDamage({power:6,distance:12.01}),0);
near(M.explosionDamage({power:5,distance:0,exposure:0}),1,1e-9,"zero exposure still deals the +1 base");
near(M.explosionKnockback({power:1.2,distance:0,multiplier:1.22}),1.22);
console.log("Explosion damage tests passed.");

// Projectile physics (Projectile.shootFromRotation, ThrowableProjectile.tick).
{
  const spec=M.PROJECTILES.ender_pearl;
  const v=M.launchVelocity({pitchDeg:0,yawDeg:0,power:1.5});
  near(v.x,0,1e-12);near(v.y,0,1e-12);near(v.z,1.5);
  const v2=M.launchVelocity({pitchDeg:-90,yawDeg:0,power:1.5});
  near(v2.y,1.5,1e-12,"pitch -90 looks straight up");
  const moving=M.launchVelocity({pitchDeg:0,yawDeg:0,power:1.5,shooterVelocity:{x:0.2,y:0.3,z:0.1},shooterOnGround:true});
  near(moving.x,0.2);near(moving.y,0,1e-12,"grounded shooter's vertical motion is not inherited");near(moving.z,1.6);
  const air=M.launchVelocity({pitchDeg:0,yawDeg:0,power:1.5,shooterVelocity:{x:0,y:0.3,z:0},shooterOnGround:false});
  near(air.y,0.3,1e-12,"airborne shooter's vertical motion is inherited");
  const s1=M.stepProjectile({pos:{x:0,y:0,z:0},vel:{x:0,y:0,z:1.5}},spec);
  near(s1.vel.y,-0.03*0.99,1e-12,"gravity is applied before drag");near(s1.pos.z,1.485);
  const path=M.simulateProjectile({origin:{x:0,y:0,z:0},velocity:{x:0,y:0,z:1.5},spec,maxTicks:20});
  assert.equal(path.length,20);assert.ok(path[19].pos.z<30,"drag must shorten flight");
  // Solver: the returned direction must actually land on the target when re-simulated.
  const origin={x:0,y:65.52,z:0};
  for(const target of [{x:20,y:64,z:0},{x:-12,y:70,z:9},{x:0,y:58,z:-30}]){
    const aim=M.solveProjectileAim({origin,target,spec});
    assert.ok(aim,"target in range must be solvable");
    assert.ok(Math.abs(aim.verticalError)<0.05,"solver vertical error "+aim.verticalError);
    const vel=M.launchVelocity({pitchDeg:aim.pitchDeg,yawDeg:aim.yawDeg,power:spec.speed});
    const sim=M.simulateProjectile({origin,velocity:vel,spec,maxTicks:Math.ceil(aim.flightTicks)+1});
    const end=sim[Math.ceil(aim.flightTicks)-1].pos;
    assert.ok(Math.hypot(end.x-target.x,end.z-target.z)<2.5,"simulated landing near target");
  }
  // Moving shooter: the solver compensates for inherited velocity.
  const moved=M.solveProjectileAim({origin,target:{x:20,y:64,z:0},spec,shooterVelocity:{x:0.25,y:0,z:0},shooterOnGround:true});
  const still=M.solveProjectileAim({origin,target:{x:20,y:64,z:0},spec});
  assert.ok(moved.pitchDeg>still.pitchDeg,"forward shooter motion needs a flatter/lower throw");
  assert.equal(M.solveProjectileAim({origin,target:{x:400,y:64,z:0},spec}),null,"out-of-range target is rejected, not faked");
  assert.equal(M.solveProjectileAim({origin,target:{...origin},spec}),null);
  // Arrow spec.
  const bowAim=M.solveProjectileAim({origin,target:{x:40,y:65,z:0},spec:{...M.PROJECTILES.arrow}});
  assert.ok(bowAim&&bowAim.flightTicks<20);
}
console.log("Projectile trajectory tests passed.");

// Telemetry phases.
{
  const lines=[];const tel=createCombatTelemetry({log:l=>lines.push(l),now:()=>1});
  tel.attempted("falling_crit");tel.rejected("falling_crit","sprinting");
  tel.attempted("falling_crit");tel.executed("falling_crit",{fall:0.4});tel.confirmed("falling_crit",{signal:"entityCriticalEffect"});
  tel.attempted("mace_smash");tel.executed("mace_smash");tel.outcome("mace_smash",false,{reason:"timeout"});
  const c=tel.counts();
  assert.deepEqual(c.falling_crit,{attempted:2,rejected:1,executed:1,confirmed:1,unconfirmed:0});
  assert.deepEqual(c.mace_smash,{attempted:1,rejected:0,executed:1,confirmed:0,unconfirmed:1});
  assert.ok(lines.some(l=>l.includes("phase=confirmed")&&l.includes("signal=entityCriticalEffect")));
  assert.ok(tel.summary().includes("falling_crit:2/1/1"));
  assert.throws(()=>tel.outcome&&createCombatTelemetry().attempted(undefined)&&(()=>{throw new Error("phase")})(),/phase/);
}
console.log("Combat telemetry phase tests passed.");

// Authority leases: one owner per domain; release on cancel; idempotent release.
{
  const a=createCombatAuthority();
  const pvp=a.acquire("pvp_expert");
  assert.ok(pvp);
  assert.equal(a.holder("hotbar"),"pvp_expert");
  assert.equal(a.isBlocked("survival_auto_eat","hotbar"),true);
  assert.equal(a.isBlocked("pvp_expert","hotbar"),false);
  assert.equal(a.acquire("capability_critical",["attack"]),null,"second attacker must be denied");
  pvp.release();pvp.release();
  assert.equal(a.holder("attack"),null);
  const cap=a.acquire("capability_critical",["attack"]);
  assert.ok(cap);
  assert.equal(a.isBlocked("survival_auto_eat","hotbar"),false,"leases are per domain");
  cap.release();
  assert.throws(()=>a.acquire("x",["teleport"]),/Unknown combat domain/);
  const bot={};
  assert.equal(getCombatAuthority(bot),getCombatAuthority(bot),"one authority per bot");
  assert.equal(Object.keys(bot).length,0,"authority is attached non-enumerably");
}
console.log("Combat authority lease tests passed.");
console.log("All combat mechanics tests passed.");
