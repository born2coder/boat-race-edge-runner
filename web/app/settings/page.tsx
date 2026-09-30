import {activeResearchStrategy,researchStrategies} from "@/db/research-strategies";
import {saveStrategy} from "./actions";
export const dynamic="force-dynamic";
export default async function Settings({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}) {
 const [active,strategies,q]=await Promise.all([activeResearchStrategy(),researchStrategies(),searchParams]);
 const tomorrow=new Date(Date.now()+86400000).toLocaleDateString("sv-SE",{timeZone:"Asia/Tokyo"});
 const fields=[
  ["minimumRawEv","Minimum raw EV",1,10,.05],
  ["minimumConservativeEv","Minimum conservative EV",1,10,.05],
  ["watchEv","WATCH raw EV",.01,10,.01],
  ["maxCombinationsPerRace","Maximum combinations per race",1,120,1],
  ["maxOddsAgeMinutes","Odds freshness limit (minutes)",1,10,1],
  ["conservativeFactor","Provisional conservative factor",.01,1,.01],
 ] as const;
 return <div className="research-terminal"><p className="section-kicker">VERSIONED FUTURE STRATEGY</p><h1>SETTINGS</h1>
  <p>現在のstrategy_version: <b>{active.strategy_version}</b></p>
  {q.saved&&<p role="status">新しい戦略を予約しました。適用時刻以降の観測から使います：{q.saved}</p>}
  {q.error&&<p role="alert">{q.error}</p>}
  <p>変更値は新しいバージョンとして保存し、適用前のシグナルと実績は変更しません。初回BUYで仮想100円を固定し、CANCEL後も購入済みとして精算します。</p>
  <form action={saveStrategy} className="research-filters">
   {fields.map(([key,label,min,max,step])=><label key={key}>{label}<input required type="number" name={key}
    min={min} max={max} step={step} defaultValue={active.settings[key]}/></label>)}
   <label>適用日時（JST・未来のみ）<input required type="datetime-local" name="effectiveAt" defaultValue={tomorrow+"T00:00"}/></label>
   <input type="hidden" name="stakeYen" value="100"/>
   <button type="submit">新strategy_versionを予約</button>
  </form>
  <p>分析ジョブ・画面更新は約60秒間隔。校正済み確率は未導入のため未校正として保存し、保守確率には上記の暫定係数を使います。</p>
  <h2>STRATEGY HISTORY</h2><div className="edge-v2-table"><table><thead><tr><th>Version</th><th>適用日時（JST）</th><th>状態</th><th>Raw / conservative EV</th><th>最大点数</th><th>固定仮想投資</th></tr></thead>
   <tbody>{strategies.map(s=><tr key={s.strategy_version}><td>{s.strategy_version}</td><td>{new Date(s.effective_at).toLocaleString("ja-JP",{timeZone:"Asia/Tokyo"})}</td>
    <td>{s.strategy_version===active.strategy_version?"ACTIVE":Date.parse(s.effective_at)>Date.now()?"SCHEDULED":"ARCHIVED"}</td>
    <td>{s.settings.minimumRawEv} / {s.settings.minimumConservativeEv}</td><td>{s.settings.maxCombinationsPerRace}</td><td>¥100</td></tr>)}</tbody></table></div>
 </div>;
}
