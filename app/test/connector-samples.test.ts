// AI接続口の見本の世帯の一覧の名前と目印（list_sample_households。0199）: 接続口に埋め込む JSON（crates/lifeplan/dist/samples.json）が、
// アプリの見本の棚（catalog.ts）と同じ名前・見本番号・絞り込みの項目から作られていること。場面の目印は棚の項目から決まる物だけ
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { connectorSamples } from "../src/connector/samples.ts";
import { DEMO_HOUSEHOLDS } from "../src/workspace/catalog.ts";
import { FAMILY_SHAPES, SAMPLE_TRAITS, ageBandName, sampleNoText } from "../src/workspace/store/numbering.ts";

const REPO = join(import.meta.dirname, "..", "..");
const SCENES = ["子育て", "シニア", "合算BS"];

describe("AI接続口の見本の一覧の目印", () => {
  const list = connectorSamples();

  it("見本の棚の見本を、棚と同じ名前・番号・項目で、番号の順に返す", () => {
    expect(list.map((s) => s.id).sort()).toEqual(DEMO_HOUSEHOLDS.map((d) => d.id).sort());
    expect(list.map((s) => s.no)).toEqual([...list.map((s) => s.no)].sort());
    for (const d of DEMO_HOUSEHOLDS) {
      const s = list.find((x) => x.id === d.id);
      expect(s?.title).toBe(d.title);
      expect(s?.no).toBe(d.sampleNo);
      for (const t of d.traits) expect(s?.tags).toContain(t);
      // 家族の形と年代は、画面の見本番号の説明と同じ言葉
      expect(s?.tags.slice(0, 2).join("・")).toBe(sampleNoText(d.sampleNo));
      expect(existsSync(join(REPO, "data", "modelHouseholds", `${d.id}.json`))).toBe(true);
    }
  });

  it("目印は画面の言葉と、棚の項目から決まる場面の目印だけ", () => {
    const known = new Set([...FAMILY_SHAPES.map((f) => f.name), ...[2, 3, 4, 5, 6, 7].map(ageBandName), ...SAMPLE_TRAITS, ...SCENES]);
    for (const s of list) for (const t of s.tags) expect(known.has(t), `${s.id}: ${t}`).toBe(true);
    const tagged = (t: string) => list.filter((s) => s.tags.includes(t)).map((s) => s.id);
    expect(tagged("合算BS")).toEqual(["sampleOwnerCompany"]);
    expect(new Set(tagged("子育て"))).toEqual(new Set(DEMO_HOUSEHOLDS.filter((d) => d.traits.includes("教育費")).map((d) => d.id)));
    expect(tagged("シニア")).toContain("sampleSeniorCouple");
    expect(tagged("シニア")).toContain("sampleSeniorRental");
    for (const s of list) expect(new Set(s.tags).size, s.id).toBe(s.tags.length);
  });

  it("接続口に埋め込む JSON は、この一覧と同じ（まとめる道具が作った物）", () => {
    const file = join(REPO, "crates", "lifeplan", "dist", "samples.json");
    if (!existsSync(file)) return;
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(list);
  });
});
