// 0111 の2回目: エンジンが引く目安（sdk/estimates.ts の一覧）を値ID で引き、計算の要求の estimateValues で事務所の値に置き換える。
// 推定で埋めない、エンジンが引く統計の目安（estimateNoFill）
import { describe, expect, it } from "vitest";
import { runEngine, runBatchJson } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { RegulationStore, type PackJson } from "../src/regulation/reader.ts";
import { ENGINE_PRESETS, enginePresetValue } from "../src/sdk/estimates.ts";
import { STRESS_TEMPLATES } from "../src/engine/overlay.ts";
import { modelHousehold } from "./helpers.ts";
import { realPacks } from "./helpers.ts";

const packs = () => realPacks() as unknown as PackJson[];
const withInput = (req: EngineRequest, extra: Record<string, unknown>): EngineRequest => ({ ...req, input: { ...req.input, ...extra } }) as EngineRequest;
const total = (r: ReturnType<typeof runEngine>, prefix: string) => (r.table as unknown as { row: string; amount: number }[]).filter((c) => c.row.startsWith(prefix)).reduce((s, c) => s + c.amount, 0);
const notices = (r: ReturnType<typeof runEngine>) => JSON.stringify((r.header as unknown as { notices?: unknown }).notices ?? []);

describe("エンジンが引く目安の一覧", () => {
  it("値ID は preset. で始まり、重ならない。版は1以上", () => {
    const ids = ENGINE_PRESETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of ENGINE_PRESETS) {
      expect(d.id.startsWith("preset.")).toBe(true);
      expect(d.rev).toBeGreaterThanOrEqual(1);
      expect(d.use).toBe("engine");
    }
  });

  it("集め直す前の部品の定数と同じ値（結果を変えない）", () => {
    expect(enginePresetValue("preset.survivor.livingRatio.beforeIndependence")).toBe("0.7");
    expect(enginePresetValue("preset.survivor.livingRatio.afterIndependence")).toBe("0.5");
    expect(enginePresetValue("preset.survivor.livingRatio.noChildren")).toBe("0.7");
    expect(enginePresetValue("preset.insurance.hospitalMaxDays")).toBe(60);
    expect(enginePresetValue("preset.realEstate.landShare")).toBe("0.3");
    expect(enginePresetValue("preset.realEstate.residualFloor")).toBe("0.2");
    expect(enginePresetValue("preset.realEstate.saleCostRate")).toBe("0.04");
    expect(enginePresetValue("preset.education.nurseryFeeRatio")).toBe("0.8");
    const p = Object.fromEntries(STRESS_TEMPLATES.map((t) => [t.template, t.params]));
    expect(p.marketDropAtRetirement?.drop).toBe("0.3");
    expect(p.inflationSpike).toMatchObject({ years: 5, rate: "0.04" });
    expect(p.rateRise?.add).toBe("0.01");
    expect(p.incomeDrop).toMatchObject({ years: 3, ratio: "0.2" });
    expect(p.lowReturnPeriod).toMatchObject({ years: 10, cap: "0.005" });
    expect(p.returnShortfall?.add).toBe("-0.01");
  });
});

describe("事務所の推定の値でエンジンが引く目安を置き換える（RegulationStore）", () => {
  it("一覧の値ID は置き換えられる。公式の値は一覧の値", () => {
    expect(new RegulationStore(packs()).estimate("preset.realEstate.landShare")).toBe("0.3");
    expect(new RegulationStore(packs(), {}, { "preset.realEstate.landShare": "0.45" }).estimate("preset.realEstate.landShare")).toBe("0.45");
    expect(new RegulationStore(packs(), {}, { "preset.insurance.hospitalMaxDays": 120 }).estimate("preset.insurance.hospitalMaxDays")).toBe(120);
  });

  it("一覧に無い値ID（画面だけの目安を含む）・形の違う値は誤り", () => {
    expect(() => new RegulationStore(packs(), {}, { "preset.housing.rent": 90000 })).toThrow("E_ARGUMENT");
    expect(() => new RegulationStore(packs(), {}, { "preset.nothing": 1 })).toThrow("E_ARGUMENT");
    expect(() => new RegulationStore(packs(), {}, { "preset.realEstate.landShare": 0.45 })).toThrow("E_ARGUMENT");
    expect(() => new RegulationStore(packs(), {}, { "preset.insurance.hospitalMaxDays": "120" })).toThrow("E_ARGUMENT");
    expect(() => new RegulationStore(packs(), {}, { "preset.insurance.hospitalMaxDays": 1.5 })).toThrow("E_ARGUMENT");
  });

  it("推定で埋めない目安は決まった3つだけ", () => {
    expect(new RegulationStore(packs(), {}, {}, ["care"]).fillsByEstimate("care")).toBe(false);
    expect(new RegulationStore(packs(), {}, {}, ["care"]).fillsByEstimate("education")).toBe(true);
    expect(() => new RegulationStore(packs(), {}, {}, ["rent"])).toThrow("E_ARGUMENT");
  });
});

describe("エンジンが引く目安で計算する", () => {
  it("公式と同じ値を渡した要求は、渡さない要求と同じ結果", () => {
    const req = modelHousehold("protectionNeed");
    const same = Object.fromEntries(ENGINE_PRESETS.map((d) => [d.id, d.value]));
    expect(runEngine(withInput(req, { estimateValues: same }), packs()).table).toEqual(runEngine(req, packs()).table);
  });

  it("持ち家の土地の割合の目安を変えると、持ち家の評価が変わる（世帯に土地の割合があればその値）", () => {
    const req = modelHousehold("housingPurchase");
    const base = runEngine(req, packs());
    const office = runEngine(withInput(req, { estimateValues: { "preset.realEstate.landShare": "0.6" } }), packs());
    expect(JSON.stringify(office.table)).not.toEqual(JSON.stringify(base.table));
    // 世帯の前提に土地の割合を入れた世帯は、目安を使わない（世帯ごとの値が優先）
    const own = withInput(req, { assumptions: { ...req.input.assumptions, realEstateValuation: { ...(req.input.assumptions as { realEstateValuation?: object }).realEstateValuation, landShare: "0.3" } } });
    expect(runEngine(withInput(own, { estimateValues: { "preset.realEstate.landShare": "0.6" } }), packs()).table).toEqual(runEngine(own, packs()).table);
  });

  it("まとめて計算でも、目安の値が違う要求どうしで結果を取り違えない", () => {
    const req = modelHousehold("housingPurchase");
    const a = withInput(req, { estimateValues: { "preset.realEstate.landShare": "0.6" } });
    const out = JSON.parse(runBatchJson(JSON.stringify([req, a]), JSON.stringify(packs()), '{"preview":true}')) as { table: unknown }[];
    const one = (r: EngineRequest) => (JSON.parse(runBatchJson(JSON.stringify([r]), JSON.stringify(packs()), '{"preview":true}')) as { table: unknown }[])[0]?.table;
    expect(out[0]?.table).toEqual(one(req));
    expect(out[1]?.table).toEqual(one(a));
  });
});

describe("推定で埋めない（エンジンが引く統計の目安）", () => {
  it("介護: 空欄の所を統計の目安で埋めず0円にし、入力が足りないと知らせる", () => {
    const req = modelHousehold("parentCare");
    const base = runEngine(req, packs());
    const off = runEngine(withInput(req, { estimateNoFill: ["care"] }), packs());
    expect(total(off, "cf.expense.care")).toBeLessThan(total(base, "cf.expense.care"));
    expect(notices(off)).toContain("care.noFill");
    expect(notices(base)).not.toContain("care.noFill");
  });

  it("学校の費用: 学費を入れていない段を統計の目安で埋めず0円にする", () => {
    const req = modelHousehold("educationTwoKids");
    const base = runEngine(req, packs());
    const off = runEngine(withInput(req, { estimateNoFill: ["education"] }), packs());
    expect(total(off, "cf.expense.education")).toBeLessThan(total(base, "cf.expense.education"));
    expect(notices(off)).toContain("goal.education.noFill");
  });

  it("空の並びは無いのと同じ", () => {
    const req = modelHousehold("parentCare");
    expect(runEngine(withInput(req, { estimateNoFill: [] }), packs()).table).toEqual(runEngine(req, packs()).table);
  });
});
