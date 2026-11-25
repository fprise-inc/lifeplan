// AI接続口（crates/lifeplan）の見本の世帯の一覧（list_sample_households）に使う、アプリの見本の棚と同じ名前と目印（0199・0247 の12）。
// - 名前・家族の形と年代・絞り込みの項目は、画面の見本の棚と同じ物（workspace/samples/sets.ts のセットの定義・store/numbering.ts の家族の形と年代）を
//   そのまま使う。別の一覧を作らない（見本を足す・名前を変えると、接続口の一覧も一緒に変わる）。見本は番号を持たない（0247 の1）
// - 載せるのはファイナンシアの見本（official.basic）だけ。コードで出すセット（法人経営者の見本）は載せない（接続口はアプリが起動していなくても動き、
//   コードの状態を知らないため。モデル世帯としては ID で取り出せる。0247 の7・12）。並びはセットの定義の順（棚の並びと同じ）
// - 画面の項目に無い場面の目印は、画面の項目から決めるものだけを足す: 子育て（教育費の項目がある）・シニア（家族の形がシニアか、本人が60代以上）
// - まとめる道具（scripts/build-explain.ts）が JSON（crates/lifeplan/dist/samples.json）にして、接続口がビルドの時に埋め込む
import { SAMPLE_SETS } from "../workspace/samples/sets.ts";
import { ageBandName, familyName } from "../workspace/store/numbering.ts";

/** 接続口の一覧に載せるセット（全員に入っているセット） */
const CONNECTOR_SET = "official.basic";

export interface ConnectorSample {
  /** data/modelHouseholds/<id>.json */
  id: string;
  /** 画面の見本の棚の名前 */
  title: string;
  /** 目印（家族の形・年代・画面の絞り込みの項目・場面の目印の順） */
  tags: string[];
}

export function connectorSamples(): ConnectorSample[] {
  const samples = SAMPLE_SETS.filter((set) => set.id === CONNECTOR_SET && set.feature === undefined).flatMap((set) => set.samples);
  return samples.map((d) => {
    const tags: string[] = [];
    const family = familyName(d.family);
    if (family !== "") tags.push(family);
    tags.push(ageBandName(d.age), ...d.traits);
    if (d.traits.includes("教育費")) tags.push("子育て");
    if ((d.family === 5 || d.age >= 6) && !tags.includes("シニア")) tags.push("シニア");
    return { id: d.id, title: d.title, tags };
  });
}
