// Minecraft Java 1.21.11 combat mechanics (protocol 774), transcribed from the
// decompiled vanilla server code with Mojang mappings. Pure functions only:
// no bot access, no timers, no randomness. Every constant names its source.

export const COMBAT_MECHANICS_VERSION="mc-1.21.11-combat-mechanics-v1";
export const TICK_MS=50;
export const SERVER_TPS=20;

// Player.DEFAULT_ENTITY_INTERACTION_RANGE; server adds a +3.0 latency buffer
// (ServerGamePacketListenerImpl.handleInteract) which anti-cheat may not allow.
export const VANILLA_ENTITY_REACH=3.0;
export const SERVER_REACH_BUFFER=3.0;
// Player.attack: strong = scale > 0.9, scale sampled with partialTicks 0.5.
export const STRONG_ATTACK_THRESHOLD=0.9;
export const ATTACK_PARTIAL_TICK=0.5;
export const CRIT_MULTIPLIER=1.5;
export const BASE_ATTACK_SPEED=4.0;
// LivingEntity.hurtServer: invulnerableTime 20, reduced-damage window while > 10.
export const DAMAGE_IMMUNITY_TICKS=10;
// MaceItem constants.
export const MACE_SMASH_FALL_THRESHOLD=1.5;
export const MACE_HEAVY_FALL_THRESHOLD=5.0;
export const MACE_KNOCKBACK_RADIUS=3.5;
// Items.SHIELD BlocksAttacks(blockDelaySeconds 0.25, ..., DamageReduction(90deg, base 0, factor 1)).
export const SHIELD_BLOCK_DELAY_TICKS=5;
export const SHIELD_BLOCK_ANGLE_DEG=90;
// Weapon.AXE_DISABLES_BLOCKING_FOR_SECONDS * shield disableCooldownScale 1.0.
export const AXE_SHIELD_DISABLE_TICKS=100;
// Items: ENDER_PEARL useCooldown 1.0s, WIND_CHARGE useCooldown 0.5s.
export const PEARL_COOLDOWN_TICKS=20;
export const WIND_CHARGE_COOLDOWN_TICKS=10;
// ThrownEnderpearl: teleport resets fall distance and deals 5.0 to the owner.
export const PEARL_TELEPORT_DAMAGE=5.0;
// Consumables: golden apples and potions take 1.6s.
export const CONSUME_TICKS=32;
// LivingEntity gravity/drag and jump strength.
export const PLAYER_GRAVITY=0.08;
export const PLAYER_VERTICAL_DRAG=0.98;
export const PLAYER_JUMP_VELOCITY=0.42;

export const PROJECTILES=Object.freeze({
  // ThrowableProjectile: gravity 0.03, inertia 0.99 (0.8 in water); EnderpearlItem power 1.5.
  ender_pearl:Object.freeze({speed:1.5,gravity:0.03,drag:0.99,waterDrag:0.8,spawnEyeOffset:-0.1}),
  snowball:Object.freeze({speed:1.5,gravity:0.03,drag:0.99,waterDrag:0.8,spawnEyeOffset:-0.1}),
  // AbstractArrow: gravity 0.05, inertia 0.99; BowItem speed = power * 3.0.
  arrow:Object.freeze({speed:3.0,gravity:0.05,drag:0.99,waterDrag:0.6,spawnEyeOffset:-0.1}),
  // CrossbowItem ARROW_POWER 3.15.
  crossbow_arrow:Object.freeze({speed:3.15,gravity:0.05,drag:0.99,waterDrag:0.6,spawnEyeOffset:-0.1})
});

const finite=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const itemName=item=>String(item?.name??item??"").toLowerCase().replace(/^minecraft:/,"");

// Total ATTACK_SPEED with the item's main-hand modifier (base 4.0 + modifier).
// Sword: ToolMaterial.applySwordProperties -2.4. Axes: Items.*_AXE. Mace -3.4.
// Trident -2.9. Spear: Item.Properties.spear attack speed 1/swingSeconds.
const SPEAR_SWING_SECONDS=Object.freeze({wooden:0.65,stone:0.75,copper:0.85,iron:0.95,golden:0.95,diamond:1.05,netherite:1.15});
const AXE_SPEED=Object.freeze({wooden:0.8,stone:0.8,copper:0.8,iron:0.9,golden:1.0,diamond:1.0,netherite:1.0});
const PICKAXE_SPEED=1.2,SHOVEL_SPEED=1.0;
const HOE_SPEED=Object.freeze({wooden:1.0,stone:2.0,copper:2.0,iron:3.0,golden:1.0,diamond:4.0,netherite:4.0});

export function itemAttackSpeed(item){
  const n=itemName(item);
  if(!n||n==="air") return BASE_ATTACK_SPEED;
  const material=n.split("_")[0];
  if(n.endsWith("_sword")) return 1.6;
  if(n.endsWith("_axe")&&!n.endsWith("_pickaxe")) return AXE_SPEED[material]??1.0;
  if(n.endsWith("_spear")) return 1/(SPEAR_SWING_SECONDS[material]??0.95);
  if(n==="mace") return 0.6;
  if(n==="trident") return 1.1;
  if(n.endsWith("_pickaxe")) return PICKAXE_SPEED;
  if(n.endsWith("_shovel")) return SHOVEL_SPEED;
  if(n.endsWith("_hoe")) return HOE_SPEED[material]??1.0;
  return BASE_ATTACK_SPEED;
}

// AttributeInstance.calculateValue: base + ADD_VALUE, then *(1+sum ADD_MULTIPLIED_BASE),
// then *(1+each ADD_MULTIPLIED_TOTAL). Item base modifiers are excluded here because
// the table above already includes them and the server's attribute packet lags a swap.
const ITEM_MODIFIER_IDS=new Set(["minecraft:base_attack_speed","base_attack_speed"]);
const ITEM_MODIFIER_UUIDS=new Set(["fa233e1c-4180-4865-b01b-bcce9785aca3"]);
function opOf(m){
  const o=m?.operation;
  if(o===0||o==="add_value"||o==="addition"||o==="add") return 0;
  if(o===1||o==="add_multiplied_base"||o==="multiply_base") return 1;
  if(o===2||o==="add_multiplied_total"||o==="multiply_total"||o==="multiply") return 2;
  return 0;
}
export function effectiveAttackSpeed(item,attribute=null){
  const base=itemAttackSpeed(item);
  const mods=Array.isArray(attribute?.modifiers)?attribute.modifiers:[];
  let add=0,mulBase=0,mulTotal=1;
  for(const m of mods){
    const id=String(m?.id??m?.name??"").toLowerCase();
    const uuid=String(m?.uuid??"").toLowerCase();
    if(ITEM_MODIFIER_IDS.has(id)||ITEM_MODIFIER_UUIDS.has(uuid)) continue;
    const amount=finite(m?.amount);
    const op=opOf(m);
    if(op===0) add+=amount; else if(op===1) mulBase+=amount; else mulTotal*=1+amount;
  }
  const value=(base+add)*(1+mulBase)*mulTotal;
  return clamp(value,0.1,1024);
}

// Player.getCurrentItemAttackStrengthDelay = 1 / ATTACK_SPEED * 20.
export function attackDelayTicks(attackSpeed){return 20/clamp(finite(attackSpeed,BASE_ATTACK_SPEED),0.1,1024)}
// Player.getAttackStrengthScale(0.5).
export function attackCharge(ticksSinceReset,attackSpeed,partial=ATTACK_PARTIAL_TICK){
  return clamp((Math.max(0,finite(ticksSinceReset))+partial)/attackDelayTicks(attackSpeed),0,1);
}
export function isStrongAttack(charge){return finite(charge)>STRONG_ATTACK_THRESHOLD}
// Smallest whole number of server ticks after which the attack is strong (or full).
export function ticksUntilCharge(attackSpeed,threshold=STRONG_ATTACK_THRESHOLD,partial=ATTACK_PARTIAL_TICK){
  const delay=attackDelayTicks(attackSpeed);
  if(threshold>=1) return Math.max(0,Math.ceil(delay-partial));
  return Math.max(0,Math.floor(threshold*delay-partial)+1);
}
// Player.baseDamageScaleFactor.
export function damageScale(charge){const c=clamp(finite(charge),0,1);return 0.2+c*c*0.8}

// Player.canCriticalAttack + strong requirement in Player.attack.
export function critBlockers({charge=1,fallDistance=0,onGround=false,onClimbable=false,inWater=false,
  sprinting=false,passenger=false,mobilityRestricted=false,targetLiving=true}={}){
  const r=[];
  if(!isStrongAttack(charge)) r.push("charge_not_strong");
  if(!(finite(fallDistance)>0)) r.push("no_fall_distance");
  if(onGround) r.push("on_ground");
  if(onClimbable) r.push("on_climbable");
  if(inWater) r.push("in_water");
  if(sprinting) r.push("sprinting");
  if(passenger) r.push("passenger");
  if(mobilityRestricted) r.push("mobility_restricted");
  if(!targetLiving) r.push("target_not_living");
  return r;
}
export function canCriticalHit(s={}){return critBlockers(s).length===0}
export function canSprintKnockback({charge=1,sprinting=false}={}){return Boolean(sprinting)&&isStrongAttack(charge)}

// MaceItem.canSmashAttack and getAttackDamageBonus (Density adds level*fall).
export function canMaceSmash({fallDistance=0,fallFlying=false}={}){
  return finite(fallDistance)>MACE_SMASH_FALL_THRESHOLD&&!fallFlying;
}
export function maceSmashBonus(fallDistance,densityLevel=0){
  const fd=finite(fallDistance);
  if(!(fd>MACE_SMASH_FALL_THRESHOLD)) return 0;
  const base=fd<=3?4*fd:fd<=8?12+2*(fd-3):22+fd-8;
  return base+Math.max(0,finite(densityLevel))*0.5*fd;
}

// Player.attack: (baseDamage*damageScale + maceBonus) * (crit ? 1.5 : 1) + enchant*charge.
export function meleeDamage({attackDamage=1,charge=1,crit=false,fallDistance=0,mace=false,
  densityLevel=0,enchantBonus=0}={}){
  let d=finite(attackDamage)*damageScale(charge);
  if(mace) d+=maceSmashBonus(fallDistance,densityLevel);
  if(crit&&isStrongAttack(charge)) d*=CRIT_MULTIPLIER;
  return d+finite(enchantBonus)*clamp(finite(charge),0,1);
}

// LivingEntity.getItemBlockingWith: blocking only after blockDelayTicks of use.
export function isShieldEffective(useTicks,delayTicks=SHIELD_BLOCK_DELAY_TICKS){return finite(useTicks)>=delayTicks}
// LivingEntity.applyItemBlocking: acos(dot(horizontal dir to source, view vector)) <= angle.
// Yaw is Minecraft degrees (0 = +Z, 90 = -X).
export function shieldCoversSource({selfPosition,sourcePosition,headYawDeg,angleDeg=SHIELD_BLOCK_ANGLE_DEG}={}){
  if(!selfPosition||!sourcePosition) return false;
  const dx=finite(sourcePosition.x)-finite(selfPosition.x),dz=finite(sourcePosition.z)-finite(selfPosition.z);
  const len=Math.hypot(dx,dz);
  if(len<1e-9) return true;
  const yaw=finite(headYawDeg)*Math.PI/180;
  const vx=-Math.sin(yaw),vz=Math.cos(yaw);
  const angle=Math.acos(clamp((dx*vx+dz*vz)/len,-1,1));
  return angle<=angleDeg*Math.PI/180;
}
// Mineflayer yaw (radians, 0 = -Z, counter-clockwise) to Minecraft degrees.
export function mineflayerYawToMinecraftDeg(yaw){return 180-finite(yaw)*180/Math.PI}

// ExplosionDamageCalculator.getEntityDamageAmount (before armor/enchant/difficulty).
export function explosionDamage({power,distance,exposure=1}){
  const r2=finite(power)*2;
  if(!(r2>0)) return 0;
  const d=finite(distance)/r2;
  if(d>1) return 0;
  const v=(1-d)*clamp(finite(exposure,1),0,1);
  return (v*v+v)/2*7*r2+1;
}
export function explosionKnockback({power,distance,exposure=1,multiplier=1,resistance=0}){
  const r2=finite(power)*2;
  if(!(r2>0)) return 0;
  const d=finite(distance)/r2;
  if(d>1) return 0;
  return (1-d)*clamp(finite(exposure,1),0,1)*finite(multiplier,1)*(1-clamp(finite(resistance),0,1));
}

// Projectile.shootFromRotation: direction from pitch/yaw (Minecraft degrees,
// pitch positive = down), scaled by power, plus shooter motion (x/z always,
// y only when the shooter is airborne). Inaccuracy is random and not modelled.
export function launchVelocity({pitchDeg,yawDeg,power,shooterVelocity=null,shooterOnGround=true}){
  const p=finite(pitchDeg)*Math.PI/180,y=finite(yawDeg)*Math.PI/180;
  const dir={x:-Math.sin(y)*Math.cos(p),y:-Math.sin(p),z:Math.cos(y)*Math.cos(p)};
  const v={x:dir.x*power,y:dir.y*power,z:dir.z*power};
  if(shooterVelocity){
    v.x+=finite(shooterVelocity.x);
    v.z+=finite(shooterVelocity.z);
    if(!shooterOnGround) v.y+=finite(shooterVelocity.y);
  }
  return v;
}

// ThrowableProjectile.tick / AbstractArrow: gravity, then drag, then move.
export function stepProjectile(state,spec){
  const vel={x:state.vel.x,y:state.vel.y-spec.gravity,z:state.vel.z};
  const drag=state.inWater?spec.waterDrag:spec.drag;
  vel.x*=drag;vel.y*=drag;vel.z*=drag;
  return {pos:{x:state.pos.x+vel.x,y:state.pos.y+vel.y,z:state.pos.z+vel.z},vel,inWater:state.inWater};
}
export function simulateProjectile({origin,velocity,spec,maxTicks=200,stopBelowY=-Infinity}){
  const path=[];
  let s={pos:{...origin},vel:{...velocity},inWater:false};
  for(let i=0;i<maxTicks;i++){
    s=stepProjectile(s,spec);
    path.push({tick:i+1,pos:s.pos,vel:s.vel});
    if(s.pos.y<stopBelowY) break;
  }
  return path;
}

// Find the launch pitch that brings the projectile through the target point.
// Returns the direction to look along (an aim point) instead of raw angles so
// it is independent of Mineflayer's yaw/pitch conventions.
export function solveProjectileAim({origin,target,spec,shooterVelocity=null,shooterOnGround=true,
  preferHighArc=false,maxTicks=160}){
  const dx=finite(target.x)-finite(origin.x),dz=finite(target.z)-finite(origin.z);
  const horizontal=Math.hypot(dx,dz);
  if(!(horizontal>1e-6)) return null;
  const yawDeg=Math.atan2(-dx,dz)*180/Math.PI;
  const evaluate=pitchDeg=>{
    const v=launchVelocity({pitchDeg,yawDeg,power:spec.speed,shooterVelocity,shooterOnGround});
    let s={pos:{...origin},vel:v,inWater:false},prev=s.pos;
    for(let i=0;i<maxTicks;i++){
      s=stepProjectile(s,spec);
      const along=((s.pos.x-origin.x)*dx+(s.pos.z-origin.z)*dz)/horizontal;
      if(along>=horizontal){
        const prevAlong=((prev.x-origin.x)*dx+(prev.z-origin.z)*dz)/horizontal;
        const f=along===prevAlong?1:(horizontal-prevAlong)/(along-prevAlong);
        const y=prev.y+(s.pos.y-prev.y)*f;
        const lateral=((s.pos.x-origin.x)*dz-(s.pos.z-origin.z)*dx)/horizontal;
        return {pitchDeg,ticks:i+f,verticalError:y-finite(target.y),lateralError:lateral,reached:true};
      }
      prev=s.pos;
    }
    return {pitchDeg,ticks:maxTicks,verticalError:-Infinity,lateralError:0,reached:false};
  };
  let best=null;
  const consider=r=>{
    if(!r.reached) return;
    if(!best||Math.abs(r.verticalError)<Math.abs(best.verticalError)-1e-9||
      (Math.abs(Math.abs(r.verticalError)-Math.abs(best.verticalError))<=1e-9&&(preferHighArc?r.pitchDeg<best.pitchDeg:r.pitchDeg>best.pitchDeg))) best=r;
  };
  const lo=preferHighArc?-89:-45,hi=preferHighArc?-45:89;
  let coarse=[];
  for(let p=lo;p<=hi;p+=1){const r=evaluate(p);coarse.push(r);consider(r)}
  if(!best) return null;
  let step=0.5,center=best.pitchDeg;
  while(step>=0.01){
    for(const p of [center-step,center+step]){if(p>=lo&&p<=hi) consider(evaluate(p))}
    center=best.pitchDeg;step/=2;
  }
  const p=best.pitchDeg*Math.PI/180,y=yawDeg*Math.PI/180;
  const dir={x:-Math.sin(y)*Math.cos(p),y:-Math.sin(p),z:Math.cos(y)*Math.cos(p)};
  return {
    pitchDeg:best.pitchDeg,yawDeg,flightTicks:best.ticks,
    verticalError:best.verticalError,lateralError:best.lateralError,horizontalDistance:horizontal,
    direction:dir,
    aimPoint:{x:origin.x+dir.x*10,y:origin.y+dir.y*10,z:origin.z+dir.z*10}
  };
}

// Server tick clock. Mineflayer physicsTick is a client timer; the server's
// world age (update_time packet, every 20 ticks) gives the real TPS so attack
// charge, shield delay and cooldowns are measured in server ticks under lag.
export function createServerTickClock({now=()=>Date.now()}={}){
  let tps=SERVER_TPS,lastAge=null,lastAt=null;
  return {
    observeWorldAge(age,at=now()){
      const a=finite(age,NaN);
      if(!Number.isFinite(a)) return tps;
      if(lastAge!=null&&at>lastAt){
        const dTicks=a-lastAge,dSec=(at-lastAt)/1000;
        if(dTicks>0&&dSec>=0.5&&dSec<=10){
          const sample=clamp(dTicks/dSec,1,SERVER_TPS);
          tps=tps*0.6+sample*0.4;
        }
      }
      lastAge=a;lastAt=at;
      return tps;
    },
    tps(){return tps},
    ticksBetween(fromMs,toMs=now()){return Math.max(0,(finite(toMs)-finite(fromMs))/1000*tps)},
    msForTicks(ticks){return Math.max(0,finite(ticks))/tps*1000}
  };
}

// Server-side attackStrengthTicker model: reset by every swing (Player.onAttack)
// and by a main-hand item TYPE change (Player.tick, !ItemStack.isSameItem).
export function createAttackChargeTracker({clock=createServerTickClock(),now=()=>Date.now()}={}){
  let resetAt=-Infinity,heldName=null,lastResetReason="initial";
  const reset=(reason,at)=>{resetAt=at;lastResetReason=reason};
  return {
    noteSwing(at=now()){reset("swing",at)},
    noteHeldItem(item,at=now()){
      const n=itemName(item)||"air";
      if(heldName!=null&&n!==heldName) reset("weapon_change",at);
      heldName=n;
    },
    heldItem(){return heldName},
    lastResetReason(){return lastResetReason},
    ticksSinceReset(at=now()){return resetAt===-Infinity?Infinity:clock.ticksBetween(resetAt,at)},
    charge(attackSpeed,at=now()){
      const t=this.ticksSinceReset(at);
      return t===Infinity?1:attackCharge(t,attackSpeed);
    },
    readyAt(attackSpeed,threshold=STRONG_ATTACK_THRESHOLD,marginTicks=0){
      if(resetAt===-Infinity) return now();
      return resetAt+clock.msForTicks(ticksUntilCharge(attackSpeed,threshold)+Math.max(0,finite(marginTicks)));
    }
  };
}
