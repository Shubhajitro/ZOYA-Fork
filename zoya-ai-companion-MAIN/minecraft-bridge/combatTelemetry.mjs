// Combat outcome telemetry. Each technique is tracked through distinct phases:
//   attempted  - the controller selected it and began checking preconditions
//   rejected   - a precondition failed before any game input was sent
//   executed   - game input was sent (attack/use packet, movement sequence)
//   confirmed  - a server-originated signal proved the effect (damage event,
//                crit animation, entity status, teleport, block removal)
//   unconfirmed- executed but no server signal arrived inside the timeout
export const TELEMETRY_PHASES=Object.freeze(["attempted","rejected","executed","confirmed","unconfirmed"]);

export function createCombatTelemetry({log=()=>{},now=()=>Date.now(),maxEvents=400}={}){
  const counts=Object.create(null);
  const events=[];
  const bump=(technique,phase)=>{
    const c=counts[technique]||(counts[technique]={attempted:0,rejected:0,executed:0,confirmed:0,unconfirmed:0});
    c[phase]++;
    return c;
  };
  const fmt=details=>Object.entries(details||{})
    .filter(([,v])=>v!==undefined)
    .map(([k,v])=>k+"="+(typeof v==="number"?(Number.isInteger(v)?v:v.toFixed(3)):String(v))).join(" ");
  const record=(technique,phase,details={})=>{
    if(!TELEMETRY_PHASES.includes(phase)) throw new Error("Unknown telemetry phase: "+phase);
    const t=String(technique||"unknown");
    bump(t,phase);
    const e={at:now(),technique:t,phase,...details};
    events.push(e);
    if(events.length>maxEvents) events.splice(0,events.length-maxEvents);
    log("[PVP-TELEMETRY] technique="+t+" phase="+phase+(Object.keys(details).length?" "+fmt(details):""));
    return e;
  };
  return {
    attempted:(t,d)=>record(t,"attempted",d),
    rejected:(t,reason,d={})=>record(t,"rejected",{reason,...d}),
    executed:(t,d)=>record(t,"executed",d),
    confirmed:(t,d)=>record(t,"confirmed",d),
    unconfirmed:(t,d)=>record(t,"unconfirmed",d),
    outcome:(t,confirmed,d)=>record(t,confirmed?"confirmed":"unconfirmed",d),
    counts:()=>JSON.parse(JSON.stringify(counts)),
    events:()=>events.slice(),
    reset(){for(const k of Object.keys(counts))delete counts[k];events.length=0},
    summary(){
      const parts=Object.entries(counts).sort(([a],[b])=>a.localeCompare(b)).map(([t,c])=>
        t+":"+c.attempted+"/"+c.executed+"/"+c.confirmed+(c.rejected?" rej="+c.rejected:"")+(c.unconfirmed?" unc="+c.unconfirmed:""));
      const line="[PVP-TELEMETRY] summary attempted/executed/confirmed "+(parts.join(" | ")||"none");
      log(line);
      return line;
    }
  };
}
