export const dynamic = "force-dynamic";

export default function Unlock() {
 return <section className="owner-unlock" aria-labelledby="owner-unlock-title">
  <p className="owner-unlock-kicker">PRIVATE RESEARCH TERMINAL</p>
  <h1 id="owner-unlock-title">BOAT RACE EDGE</h1>
  <p className="owner-unlock-description">所有者アクセスキーを入力してください。</p>
  <form action="/api/owner/session" method="post">
   <label htmlFor="key">アクセスキー</label>
   <input id="key" name="key" type="password" autoComplete="current-password" required />
   <button type="submit">Research Terminalを開く</button>
  </form>
  <p className="owner-unlock-note">キーは共有せず、安全な場所に保管してください。</p>
 </section>;
}
