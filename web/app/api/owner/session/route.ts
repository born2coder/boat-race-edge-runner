import { NextRequest, NextResponse } from "next/server";
export const dynamic="force-dynamic";
const COOKIE="research_owner";
const encode=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,"0")).join("");
async function sign(value:string, secret:string) {
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return encode(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(value)));
}
function equal(a:string,b:string) {
 if(a.length!==b.length)return false;
 let mismatch=0;for(let i=0;i<a.length;i++)mismatch|=a.charCodeAt(i)^b.charCodeAt(i);
 return mismatch===0;
}
export async function POST(request:NextRequest) {
 const origin=request.headers.get("origin");
 if(origin && origin!==request.nextUrl.origin)return new Response("Forbidden",{status:403});
 const secret=process.env.RESEARCH_OWNER_KEY;
 if(!secret||secret.length<32)return new Response("Owner access unavailable",{status:503});
 if(Number(request.headers.get("content-length")??0)>4096)return new Response("Request too large",{status:413});
 const data=await request.formData();
 const candidate=data.get("key");
 const expected=await sign("owner-access",secret);
 const supplied=await sign("owner-access",typeof candidate==="string"?candidate:"");
 if(!equal(expected,supplied))return NextResponse.redirect(new URL("/unlock",request.url),{status:303});
 const issued=String(Date.now());
 const value=issued+"."+await sign(issued,secret);
 const response=NextResponse.redirect(new URL("/today",request.url),{status:303});
 response.cookies.set(COOKIE,value,{httpOnly:true,secure:true,sameSite:"strict",path:"/",maxAge:30*86400});
 response.headers.set("Cache-Control","private, no-store");
 return response;
}
