"use server";
import {redirect} from "next/navigation";
import {scheduleResearchStrategy} from "@/db/research-strategies";
import {SETTINGS,validateResearchSettings} from "@/lib/research-terminal";
export async function saveStrategy(form:FormData) {
 let version:string;
 try {
  const values:Record<string,unknown>={...SETTINGS};
  for(const key of Object.keys(SETTINGS))values[key]=Number(form.get(key));
  const settings=validateResearchSettings(values);
  const date=String(form.get("effectiveAt")??"");
  if(!/^20\d\d-\d\d-\d\dT\d\d:\d\d$/.test(date))throw new Error("適用日時を指定してください。");
  version=await scheduleResearchStrategy(settings,new Date(date+":00+09:00").toISOString());
 } catch(error) {
  redirect("/settings?error="+encodeURIComponent(error instanceof Error?error.message:"保存できませんでした"));
 }
 redirect("/settings?saved="+encodeURIComponent(version));
}
