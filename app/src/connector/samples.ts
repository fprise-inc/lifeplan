// AI接続口（crates/lifeplan）の見本の世帯の一覧（list_sample_households）に使う、アプリの見本の棚と同じ名前と目印（0199）。
// - 名前・見本番号・絞り込みの項目は、画面の見本の棚と同じ物（workspace/catalog.ts の DEMO_HOUSEHOLDS・store/numbering.ts の家族の形と年代）をそのまま使う。
//   別の一覧を作らない（見本を足す・名前を変えると、接続口の一覧も一緒に変わる）
// - 画面の項目に無い場面の目印は、画面の項目から決めるものだけを足す: 子育て（教育費の項目がある）・シニア（家族の形がシニアか、本人が60代以上）・
//   合算BS（会社の数字の入った見本。会社の数字そのものは渡さない）
// - まとめる道具（scripts/build-explain.ts）が JSON（crates/lifeplan/dist/samples.json）にして、接続口がビルドの時に埋め込む
import { DEMO_HOUSEHOLDS } from "../workspace/catalog.ts";
import { ageBandName, familyName, parseSampleNo } from "../workspace/store/numbering.ts";

/** 合算BS の拡張の束の ID（0197。見本の extValues の鍵） */
const COMBINED_BS = "ext.official.combinedBs";

export interface ConnectorSample {
  /** data/modelHouseholds/<id>.json */
  id: string;
  /** 見本番号（家族の形-本人の年代-順番） */
  no: string;
  /** 画面の見本の棚の名前 */
  title: string;
  /** 目印（家族の形・年代・画面の絞り込みの項目・場面の目印の順） */
  tags: string[];
}

export function connectorSamples(): ConnectorSample[] {
  return DEMO_HOUSEHOLDS.map((d) => {
    const p = parseSampleNo(d.sampleNo);
    const tags: string[] = [];
    if (p !== null) tags.push(familyName(p.family), ageBandName(p.age));
    tags.push(...d.traits);
    if (d.traits.includes("教育費")) tags.push("子育て");
    if (p !== null && (p.family === 5 || p.age >= 6) && !tags.includes("シニア")) tags.push("シニア");
    if (d.extValues?.[COMBINED_BS] !== undefined) tags.push("合算BS");
    return { id: d.id, no: d.sampleNo, title: d.title, tags };
  }).sort((a, b) => (a.no < b.no ? -1 : a.no > b.no ? 1 : 0));
}
