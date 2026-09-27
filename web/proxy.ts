import { NextRequest, NextResponse } from "next/server";

const COOKIE = "research_owner";
const DAYS = 30;
const encode = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,"0")).join("");
async function sign(message: string, secret: string) {
 const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 return encode(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(message)));
}
function equal(a:string,b:string) {
 if(a.length!==b.length)return false;
 let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
 return diff===0;
}
export async function proxy(request:NextRequest) {
 const {pathname}=request.nextUrl;
 if(pathname==="/unlock"||pathname.startsWith("/api/internal/")||pathname==="/api/owner/session")return NextResponse.next();
 const secret=process.env.RESEARCH_OWNER_KEY;
 if(secret && secret.length>=32) {
  const value=request.cookies.get(COOKIE)?.value ?? "";
  const [issued,mac]=value.split(".");
  const date=Number(issued);
  if(Number.isSafeInteger(date) && date<=Date.now() && date>Date.now()-DAYS*86400000 &&
     /^[a-f0-9]{64}$/.test(mac??"") && equal(mac,await sign(issued,secret)))
   return NextResponse.next();
 }
 if(pathname.startsWith("/api/"))return new Response("Unauthorized",{status:401,headers:{"Cache-Control":"private, no-store"}});
 const url=request.nextUrl.clone();url.pathname="/unlock";url.search="";
 const response=NextResponse.redirect(url);
 response.headers.set("Cache-Control","private, no-store");
 return response;
}
export const config={matcher:["/((?!_next/|favicon.ico|robots.txt|sitemap.xml|brand/).*)"]};
