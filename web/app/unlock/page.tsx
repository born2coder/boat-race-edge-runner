export const dynamic="force-dynamic";
export default function Unlock({searchParams}:{searchParams:Promise<{error?:string}>}) {
 return <main style={{maxWidth:440,margin:"12vh auto",padding:24,fontFamily:"system-ui"}}>
  <h1>BOAT RACE EDGE</h1><p>Research Terminal · Owner Access</p>
  <form action="/api/owner/session" method="post">
   <label htmlFor="key">Access key</label>
   <input id="key" name="key" type="password" autoComplete="current-password" required
    style={{display:"block",width:"100%",padding:12,margin:"12px 0"}}/>
   <button type="submit" style={{padding:"12px 24px"}}>OPEN TERMINAL</button>
  </form>
  <p role="status">{searchParams.then ? null : null}</p>
 </main>;
}
