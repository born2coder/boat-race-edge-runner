import { claimIngestionNonce } from "@/db/ingest-repository";
import { observeResearchDay } from "@/db/research-repository";
export const dynamic="force-dynamic";
export const preferredRegion="hnd1";
export const maxDuration=60;
function hex(buffer:ArrayBuffer){return Array.from(new Uint8Array(buffer),b=>b.toString(16).padStart(2,"0")).join("");}
export async function POST(request:Request) {
 const secret=process.env.INGEST_SECRET;
 if(!secret) return Response.json({status:"unavailable"},{status:503});
 const timestamp=request.headers.get("x-edge-timestamp")??"";
 const nonce=request.headers.get("x-edge-nonce")??"";
 const signature=request.headers.get("x-edge-signature")??"";
 const seconds=Number(timestamp);
 if(!Number.isInteger(seconds)||Math.abs(Date.now()/1000-seconds)>300||
    !/^[a-f0-9]{32}$/.test(nonce)|| !/^[a-f0-9]{64}$/.test(signature))
    return Response.json({status:"unauthorized"},{status:401});
 const body=await request.text();
 if(body.length>1024)return Response.json({status:"invalid_payload"},{status:413});
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),
  {name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const expected=hex(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(timestamp+"."+nonce+"."+body)));
 if(expected.length!==signature.length||![...expected].every((c,i)=>c===signature[i]))
  return Response.json({status:"unauthorized"},{status:401});
 if(!await claimIngestionNonce(nonce,new Date().toISOString()))
  return Response.json({status:"replay_rejected"},{status:409});
 let value:unknown;
 try{value=JSON.parse(body);}catch{return Response.json({status:"invalid_json"},{status:400});}
 const date=(value as {date?:unknown})?.date;
 if(typeof date!=="string"||!/^20\d{2}-\d{2}-\d{2}$/.test(date)||
   Math.abs(Date.now()-Date.parse(date))>3*86400000)
  return Response.json({status:"invalid_date"},{status:400});
 try{return Response.json(await observeResearchDay(date),{headers:{"Cache-Control":"no-store"}});}
 catch(error){console.error("Research observation failed",error instanceof Error?error.message:"unknown");
  return Response.json({status:"failed"},{status:500});}
}
