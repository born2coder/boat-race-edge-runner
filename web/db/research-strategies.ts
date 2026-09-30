import "server-only";
import {supabaseRequest,queryString} from "@/db/supabase";
import {SETTINGS,STRATEGY_VERSION,validateResearchSettings,type ResearchSettings} from "@/lib/research-terminal";
export type Strategy={strategy_version:string;effective_at:string;settings:ResearchSettings};
export async function researchStrategies():Promise<Strategy[]> {
 const rows=await supabaseRequest<Array<{strategy_version:string;effective_at:string;settings:Record<string,unknown>}>>(
  "research_strategies?"+queryString({select:"strategy_version,effective_at,settings",order:"effective_at.desc",limit:1000}),{},"service");
 return rows.map(r=>({...r,settings:validateResearchSettings(r.settings)}));
}
export async function activeResearchStrategy(now=Date.now()):Promise<Strategy> {
 const rows=await researchStrategies();
 return rows.find(r=>Date.parse(r.effective_at)<=now)??
  {strategy_version:STRATEGY_VERSION,effective_at:new Date(now).toISOString(),settings:SETTINGS};
}
export async function scheduleResearchStrategy(settings:ResearchSettings,effectiveAt:string) {
 if(!Number.isFinite(Date.parse(effectiveAt)) || Date.parse(effectiveAt)<Date.now()+60000)
  throw new Error("適用時刻は1分以上先に指定してください。");
 const strategy_version="research-shadow-"+crypto.randomUUID();
 await supabaseRequest("research_strategies",{method:"POST",body:JSON.stringify({strategy_version,
  effective_at:effectiveAt,settings:validateResearchSettings(settings)})},"service");
 return strategy_version;
}
