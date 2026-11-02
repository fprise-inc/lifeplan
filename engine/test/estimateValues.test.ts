// 0111: 事務所の推定の値（計算の要求の estimateValues）。マスタデータの値だけを置き換え、制度データの値は置き換えない
import { describe, expect, it } from "vitest";
import { runEngine, runBatchJson } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { asBrackets, RegulationStore, type PackJson } from "../src/regulation/reader.ts";
import { parseDate } from "../src/time/civil.ts";
import { modelHousehold, realPacks } from "./helpers.ts";

const packs = () => realPacks() as unknown as PackJson[];
const d = (s: string) => parseDate(s);
const withValues = (req: EngineRequest, estimateValues: Record<string, unknown>): EngineRequest => ({ ...req, input: { ...req.input, estimateValues } }) as EngineRequest;
/** 介護の費用の行の合計（世帯が払う分） */
const careTotal = (r: ReturnType<typeof runEngine>) =>
  (r.table as unknown as { row: string; amount: number }[]).filter((c) => c.row.startsWith("cf.expense.care")).reduce((s, c) => s + c.amount, 0);

describe("事務所の推定の値の読み取り（RegulationStore）", () => {
  it("定数を置き換える（出どころは事務所）", () => {
    const official = new RegulationStore(packs()).select("care.statistics.months", d("2030-01-01"));
    expect(official.entry.value).toBe(55);
    const s = new RegulationStore(packs(), {}, { "care.statistics.months": 72 }).select("care.statistics.months", d("2030-01-01"));
    expect(s.entry.value).toBe(72);
    expect(s.entry.sources).toEqual([{ type: "office", locator: "事務所の推定の値（事務所の既定値）" }]);
  });

  it("条件ごとの行のある値は「<値ID>.<条件の値>」で、その条件の行だけを置き換える", () => {
    const off = new RegulationStore(packs()).select("lifeTable.lifeExpectancy", d("2030-01-01"), { sex: "male" }).entry.value as { upTo: number | null; rate: string }[];
    const mine = off.map((x) => ({ ...x, rate: x.upTo === 60 ? "30.00" : x.rate }));
    const s = new RegulationStore(packs(), {}, { "lifeTable.lifeExpectancy.male": mine });
    expect((s.select("lifeTable.lifeExpectancy", d("2030-01-01"), { sex: "male" }).entry.value as { upTo: number | null; rate: string }[]).find((x) => x.upTo === 60)?.rate).toBe("30.00");
    expect(asBrackets(s.select("lifeTable.lifeExpectancy", d("2030-01-01"), { sex: "male" }))?.length).toBe(off.length);
    // 女の行は公式のまま
    const female = new RegulationStore(packs()).select("lifeTable.lifeExpectancy", d("2030-01-01"), { sex: "female" }).entry.value;
    expect(s.select("lifeTable.lifeExpectancy", d("2030-01-01"), { sex: "female" }).entry.value).toEqual(female);
  });

  it("表の一部の段だけを変えた値も読める（段の数と upTo は公式と同じ）", () => {
    const off = new RegulationStore(packs()).select("living.statistics.basicMonthly", d("2030-01-01")).entry.value as { upTo: number | null; amount?: number }[];
    const mine = off.map((x) => (x.upTo === 1 ? { upTo: 1, amount: 150000 } : x));
    const s = new RegulationStore(packs(), {}, { "living.statistics.basicMonthly": mine });
    expect((s.select("living.statistics.basicMonthly", d("2030-01-01")).entry.value as { upTo: number | null; amount?: number }[])[0]).toEqual({ upTo: 1, amount: 150000 });
  });

  it("制度データ（法令の値）は置き換えられない", () => {
    expect(() => new RegulationStore(packs(), {}, { "incomeTax.basicDeduction": 1 })).toThrow("E_ARGUMENT");
    expect(() => new RegulationStore(packs(), {}, { "socialInsurance.care.secondaryInsuredUntilAge": 70 })).toThrow("E_ARGUMENT");
  });

  it("知らない値ID・公式と形の違う値は誤り", () => {
    expect(() => new RegulationStore(packs(), {}, { "care.statistics.nothing": 1 })).toThrow("E_ARGUMENT");
    expect(() => new RegulationStore(packs(), {}, { "care.statistics.months": "55" })).toThrow("E_ARGUMENT");
    expect(() => new RegulationStore(packs(), {}, { "care.statistics.months": -1 })).toThrow("E_ARGUMENT");
    expect(() => new RegulationStore(packs(), {}, { "care.statistics.months": 55.5 })).toThrow("E_ARGUMENT");
    expect(() => new RegulationStore(packs(), {}, { "living.statistics.basicMonthly": [{ upTo: 2, amount: 1 }] })).toThrow("E_ARGUMENT");
    expect(() => new RegulationStore(packs(), {}, { "lifeTable.lifeExpectancy": 1 })).toThrow("E_ARGUMENT");
  });
});

describe("事務所の推定の値で計算する", () => {
  // 親の介護（施設・額を入れた介護）と、本人の介護（在宅・期間と月々の費用が空欄 = 統計の目安）
  const req = modelHousehold("parentCare");

  it("空欄の介護の期間・費用の目安が事務所の値になる（入れた値の介護は変わらない）", () => {
    const base = runEngine(req, packs());
    const office = runEngine(withValues(req, { "care.statistics.months": 120, "care.statistics.monthlyHome": 100000 }), packs());
    expect(careTotal(office)).toBeGreaterThan(careTotal(base));
    // 空の estimateValues は無いのと同じ
    expect(runEngine(withValues(req, {}), packs()).table).toEqual(base.table);
  });

  it("制度データの値を置き換えようとした要求は計算しない", () => {
    expect(() => runEngine(withValues(req, { "incomeTax.basicDeduction": 0 }), packs())).toThrow("E_ARGUMENT");
  });

  it("まとめて計算（runBatch）でも、事務所の値が違う要求どうしで結果を取り違えない", () => {
    const a = withValues(req, { "care.statistics.months": 120 });
    const out = JSON.parse(runBatchJson(JSON.stringify([req, a, req, a]), JSON.stringify(packs()), '{"preview":true}')) as { table: unknown }[];
    const one = (r: EngineRequest) => (JSON.parse(runBatchJson(JSON.stringify([r]), JSON.stringify(packs()), '{"preview":true}')) as { table: unknown }[])[0]?.table;
    expect(out[0]?.table).toEqual(one(req));
    expect(out[1]?.table).toEqual(one(a));
    expect(out[2]?.table).toEqual(out[0]?.table);
    expect(out[3]?.table).toEqual(out[1]?.table);
    expect(out[1]?.table).not.toEqual(out[0]?.table);
  });
});
