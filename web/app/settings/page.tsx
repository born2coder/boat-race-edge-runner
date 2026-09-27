import {SETTINGS,STRATEGY_VERSION} from "@/lib/research-terminal";
export default function Settings() {
 const rows = [
  ["strategy_version",STRATEGY_VERSION],["minimum raw EV",SETTINGS.minimumRawEv],
  ["minimum conservative EV",SETTINGS.minimumConservativeEv],["WATCH raw EV",SETTINGS.watchEv],
  ["maximum combinations per race",SETTINGS.maxCombinationsPerRace],["max odds age",SETTINGS.maxOddsAgeMinutes+" min"],
  ["fixed virtual stake",SETTINGS.stakeYen+" yen"],["provisional conservative factor",SETTINGS.conservativeFactor]];
 return <div className="research-terminal"><p className="section-kicker">FROZEN STRATEGY</p><h1>SETTINGS</h1>
  <p>現在の値はバージョンに固定しています。変更するときは新しいstrategy_versionを発行し、その後の未来レースで別集計します。過去のシグナルを再ラベルしません。</p>
  <div className="edge-v2-table"><table><tbody>{rows.map(([key,val])=><tr key={String(key)}><th>{key}</th><td>{val}</td></tr>)}</tbody></table></div>
  <p>保守確率は展示後の予測値に暫定係数0.8を掛けた試験値で、統計的校正済み確率ではありません。校正データがない時点では実購入の推奨として扱わないでください。</p></div>;
}
