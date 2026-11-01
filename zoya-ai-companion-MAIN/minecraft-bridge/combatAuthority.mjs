// Single authority per physical action domain. A combat owner leases the
// domains it drives so background helpers (e.g. survival auto-eat) cannot
// swap the hotbar, start item use, or attack in the middle of its sequence.
export const COMBAT_DOMAINS=Object.freeze(["attack","hotbar","use","movement"]);
const KEY=Symbol.for("zoya.combatAuthority");

export function createCombatAuthority({now=()=>Date.now(),log=()=>{}}={}){
  const holders=new Map();
  const authority={
    acquire(owner,domains=COMBAT_DOMAINS){
      const id=String(owner||"");
      if(!id) throw new Error("Combat authority owner is required.");
      const wanted=[...new Set(domains)];
      for(const d of wanted){
        if(!COMBAT_DOMAINS.includes(d)) throw new Error("Unknown combat domain: "+d);
        const h=holders.get(d);
        if(h&&h.owner!==id){
          log("[COMBAT-AUTHORITY] lease_denied owner="+id+" domain="+d+" holder="+h.owner);
          return null;
        }
      }
      const at=now();
      for(const d of wanted) holders.set(d,{owner:id,at});
      log("[COMBAT-AUTHORITY] lease_acquired owner="+id+" domains="+wanted.join(","));
      let released=false;
      return {
        owner:id,domains:wanted,
        release(){
          if(released) return;
          released=true;
          for(const d of wanted) if(holders.get(d)?.owner===id) holders.delete(d);
          log("[COMBAT-AUTHORITY] lease_released owner="+id+" domains="+wanted.join(","));
        }
      };
    },
    holder(domain){return holders.get(domain)?.owner||null},
    isBlocked(owner,domain){const h=holders.get(domain);return Boolean(h&&h.owner!==String(owner||""))},
    snapshot(){return Object.fromEntries([...holders].map(([d,h])=>[d,h.owner]))}
  };
  return authority;
}

export function getCombatAuthority(bot,options={}){
  if(!bot||typeof bot!=="object") return createCombatAuthority(options);
  if(!bot[KEY]) Object.defineProperty(bot,KEY,{value:createCombatAuthority(options),enumerable:false});
  return bot[KEY];
}
