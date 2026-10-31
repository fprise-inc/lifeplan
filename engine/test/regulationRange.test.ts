// 0099: 制度データが持っている時期より前の日に引く値（さかのぼりの仮定）。計算を止めずに最初の行の値を使い、見出しの notices に
// N_PARAM_BACKFILLED を出す。きっかけ: 計算基準月を1〜5月にすると前の前の年（2024年）の所得の値が無く、100歳を超える受給者は
// 受け取り始めた月（1986〜1991年）の年金額の端数の値が無く、E_PARAM_NO_VALUE で計算が止まった
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { RegulationStore, type PackJson } from "../src/regulation/reader.ts";
import { parseDate } from "../src/time/civil.ts";
import { modelHousehold, realPacks } from "./helpers.ts";

type Notice = { code: string; ids: string[] };
type Member = { id: string; kind: string; birth: { birthYearMonth: string } };
type Flow = { row: string; ym: string; amount: number };
const run = (req: EngineRequest) => runEngine(req, realPacks(), {}) as EngineResult;
const noticesOf = (r: EngineResult) => (r.header as unknown as { notices: Notice[] }).notices;
const backfilled = (r: EngineResult) => noticesOf(r).filter((n) => n.code === "N_PARAM_BACKFILLED");
const membersOf = (req: EngineRequest) => (req.input.household as unknown as { members: Member[] }).members;
const withBase = (name: string, baseMonth: string): EngineRequest => {
  const req = modelHousehold(name);
  return { ...req, input: { ...req.input, baseMonth } };
};
const d = (s: string) => parseDate(s);
const MODELS = ["salariedCoupleTwoKids", "pairLoan", "pensionCouple", "selfEmployed", "sampleSelfEmployedFamily", "sampleSeniorCouple", "deferral", "jobLeaver"];

describe("計算基準月が1〜5月（前の前の年の所得の値）", () => {
  it("計算基準月を2026年1〜5月にしても止まらない（前は2024年分の所得税・2025年度の住民税・令和5年度の協会けんぽの料率の値が無く止まった）", () => {
    for (const name of MODELS) {
      for (const m of ["01", "02", "03", "04", "05"]) expect(() => run(withBase(name, `2026-${m}`)), `${name} 2026-${m}`).not.toThrow();
    }
  });

  it("制度データより前の値は最初の行の値で計算し、値の行と年の範囲を見出しの notices に出す", () => {
    const r = run(withBase("salariedCoupleTwoKids", "2026-01"));
    expect(backfilled(r)).toContainEqual({ code: "N_PARAM_BACKFILLED", ids: ["incomeTax.employmentIncomeDeduction@1", "2024", "2024"] });
    expect(backfilled(r)).toContainEqual({ code: "N_PARAM_BACKFILLED", ids: ["residentTax.dependentIncomeLimit@2", "2025", "2025"] });
  });

  it("子ども・子育て支援金の区分は、始まった令和8年度より前の年度（令和7年度の1〜3月の納期）にかけない", () => {
    for (const name of ["selfEmployed", "sampleSelfEmployedFamily"]) {
      const r = run(withBase(name, "2026-01"));
      const child = (r.flows as unknown as Flow[]).filter((f) => f.row === "cf.taxSi.childSupport");
      expect(child.filter((f) => f.ym < "2026-04"), name).toEqual([]);
      // 令和8年度の分（料率の入力の支援金の欄）は今までどおりかける
      expect(child.filter((f) => f.ym >= "2026-04").reduce((s, f) => s + f.amount, 0), name).toBeGreaterThan(0);
      expect(backfilled(r).map((n) => n.ids[0]), name).not.toContain("socialInsurance.nationalHealth.childSupport.perCapitaFromAge@1");
    }
  });
});

describe("100歳を超える受給者（受け取り始めた月が制度データより前）", () => {
  it("1916〜1926年生まれの受給者でも止まらない（前は年金額の端数の値が2015年4月からで止まった）", () => {
    for (const y of [1916, 1921, 1926]) {
      for (const kind of ["self", "spouse"]) {
        const req = modelHousehold("pensionCouple");
        const m = membersOf(req).find((x) => x.kind === kind)!;
        m.birth.birthYearMonth = `${y}${m.birth.birthYearMonth.slice(4)}`;
        let r: EngineResult | undefined;
        expect(() => (r = run(req)), `${kind} ${y}`).not.toThrow();
        expect(backfilled(r!).map((n) => n.ids[0]), `${kind} ${y}`).toContain("pension.amount.rounding@1");
      }
    }
  });
});

describe("区間の使い回しの確かめ（checkInternal）", () => {
  it("さかのぼりの仮定で選んだ行も、区間のどの月でも同じ行・同じ印になる", () => {
    const old = modelHousehold("pensionCouple");
    membersOf(old).find((x) => x.kind === "self")!.birth.birthYearMonth = "1921-01";
    for (const req of [withBase("salariedCoupleTwoKids", "2026-01"), withBase("selfEmployed", "2026-02"), old]) {
      expect(() => runEngine(req, realPacks(), { checkInternal: true })).not.toThrow();
    }
  });
});

describe("今まで計算できていた世帯は変わらない", () => {
  it("見本の世帯（計算基準月 2026年10月）は、さかのぼりの仮定を使わない", () => {
    for (const name of MODELS) expect(backfilled(run(modelHousehold(name))), name).toEqual([]);
  });
});

describe("制度データの読み取り（さかのぼりの仮定）", () => {
  const tax = () => new RegulationStore(realPacks().filter((p) => p.pack.packId === "regulation.tax") as unknown as PackJson[]);
  const si = () => new RegulationStore(realPacks().filter((p) => p.pack.packId === "regulation.socialInsurance") as unknown as PackJson[]);

  it("最初の行より前の日は、最初の行を backfilledYear つきで選ぶ（延長の仮定の印は付けない）", () => {
    const store = tax();
    const s = store.select("incomeTax.reconstructionSurtax.rate", d("2022-12-31"));
    const first = store.select("incomeTax.reconstructionSurtax.rate", d("2023-01-01"));
    expect([s.entry, s.entry.appliesFrom, s.backfilledYear, s.extendedYear]).toEqual([first.entry, "2023-01-01", 2022, undefined]);
    expect(first.backfilledYear).toBeUndefined();
    // 引く年ごとに印の年が変わる（見出しの notices の年の範囲）
    expect(store.select("incomeTax.reconstructionSurtax.rate", d("2020-06-01")).backfilledYear).toBe(2020);
  });

  it("値の有無を見るとき（延長の仮定を使わない）は、最初の行より前は値が無い（制度が始まる前の判定に使う）", () => {
    expect(tax().trySelect("incomeTax.reconstructionSurtax.rate", d("2022-12-31"), { noExtension: true })).toBeNull();
  });

  it("管轄の行が1つも無いときは、今までどおり止める", () => {
    expect(() => si().select("socialInsurance.health.kyokaikenpo.rate", d("2026-03-01"))).toThrow("E_PARAM_NO_VALUE");
    expect(() => si().select("socialInsurance.health.kyokaikenpo.rate", d("2026-03-01"), { jurisdiction: { level: "insurer", code: "kyokaikenpo.48" } })).toThrow("E_PARAM_NO_VALUE");
  });
});
