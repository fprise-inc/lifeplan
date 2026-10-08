// エンジン全体: 見本の計算・根拠の記録・入出力の検査
import { describe, expect, it } from "vitest";
import { OFFICIAL_COMPONENTS } from "../src/components/index.ts";
import { runEngine, runJson, type EngineResult } from "../src/engine/run.ts";
import { defineComponent, type ComponentDefinition } from "../src/registry/define.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { check } from "../src/io/validate.ts";
import { CONVENTIONS } from "../src/money/conventions.ts";
import { divRound, mulInt, type RoundingMode } from "../src/money/integer.ts";
import { clone, fixture, nonIntegerPaths, samplePack } from "./helpers.ts";

const run = (r: EngineRequest, trace: EngineRequest["trace"] = "none") => runEngine({ ...r, trace }, [samplePack()], { checkInternal: true });
const cell = (r: EngineResult, row: string, year: number) =>
  (r.table as { row: string; year: number; amount: number }[]).filter((c) => c.row === row && c.year === year).reduce((s, c) => s + c.amount, 0);
const annual = (r: EngineResult, row: string, year: number) => r.annual.find((a) => a.row === row && a.year === year)?.amount;

describe("見本の計算（手計算との突き合わせ）", () => {
  const r = run(fixture("basic"));

  it("初年度は計算基準月（2027-04）以降だけを計上する", () => {
    expect(r.flows.every((f) => f.ym >= "2027-04" && f.ym <= "2036-12")).toBe(true);
    // 本人の収入 35万円×9か月＋配偶者 8万円×9か月
    expect(cell(r, "cf.income.other", 2027)).toBe(350000 * 9 + 80000 * 9);
  });

  it("年1回の一時金は、帰属の年の率で差し引き、100円未満を切り捨てる", () => {
    expect(cell(r, "cf.income.lumpSum", 2027)).toBe(540000); // 60万円×(1−0.1)
    // 2028年: 本人 60万円×(1−0.05)、配偶者は2027年分を翌年3月に受け取る 123456−12300
    expect(cell(r, "cf.income.lumpSum", 2028)).toBe(570000 + 111156);
    // 2029年: 配偶者の2028年分は率 0.05 → 6172.8 → 6100 を差し引く
    expect(cell(r, "cf.income.lumpSum", 2029)).toBe(570000 + 117356);
  });

  it("退職（60歳に達する月）の前月で収入が止まり、一時金も止まる", () => {
    expect(cell(r, "cf.income.other", 2031)).toBe(350000 * 3 + 80000 * 12);
    expect(cell(r, "cf.income.lumpSum", 2031)).toBe(117356);
  });

  it("運用益＝(期首残高×2＋年間収支)×年利×月数/12÷2 を1回で丸める", () => {
    expect(annual(r, "cf.net", 2027)).toBe(1035000);
    expect(annual(r, "cf.balance.return", 2027)).toBe(127762); // 17,035,000×0.02×9/24＝127,762.5
    expect(annual(r, "cf.balance.financial", 2027)).toBe(8000000 + 1035000 + 127762);
    // 2030年だけ年利 0.005
    const open2030 = annual(r, "cf.balance.financial", 2029) as number;
    const net2030 = annual(r, "cf.net", 2030) as number;
    expect(annual(r, "cf.balance.return", 2030)).toBe(Math.trunc(((open2030 * 2 + net2030) * 5) / 2000));
  });

  it("期首残高＋収支＋運用益＝期末残高が毎年成り立つ（0003 の性質のテスト）", () => {
    let prev = 8000000;
    for (let y = 2027; y <= 2036; y++) {
      const end = annual(r, "cf.balance.financial", y) as number;
      expect(prev + (annual(r, "cf.net", y) as number) + (annual(r, "cf.balance.return", y) as number)).toBe(end);
      prev = end;
    }
  });

  it("出力は JSON Schema に合い、整数でない数や -0 がない", () => {
    expect(() => check("engine.output", r, "E_OUTPUT_SCHEMA")).not.toThrow();
    expect(nonIntegerPaths(r)).toEqual([]);
  });

  it("同じ入力なら同じ出力（文字列として一致）", () => {
    expect(JSON.stringify(run(fixture("basic")))).toBe(JSON.stringify(r));
  });
});

describe("計算方式の設定", () => {
  it("aggregation を切り替えると載る年だけが変わり、合計は変わらない", () => {
    const cash = run(fixture("basic"));
    const req = clone(fixture("basic"));
    (req.input.calcConventions as { aggregation: string }).aggregation = "accrual";
    const accrual = run(req);
    // 配偶者の2027年分（2028年3月に受け取る）は accrual では2027年に載る
    expect(cell(accrual, "cf.income.lumpSum", 2027)).toBe(540000 + 111156);
    const total = (x: EngineResult) => (x.table as { row: string; amount: number }[]).filter((c) => c.row === "cf.income.lumpSum").reduce((s, c) => s + c.amount, 0);
    expect(total(accrual)).toBe(total(cash));
  });

  it("investmentTiming で運用益の式が変わる", () => {
    const mk = (t: string) => {
      const req = clone(fixture("basic"));
      (req.input.calcConventions as { investmentTiming: string }).investmentTiming = t;
      return annual(run(req), "cf.balance.return", 2027);
    };
    expect(mk("beginning")).toBe(Math.trunc((9035000 * 2 * 9) / 1200)); // (800万＋103.5万)×0.02×9/12
    expect(mk("end")).toBe(120000); // 800万×0.02×9/12
  });

  it("dataSet で古いパックの版（知った時点）を使える", () => {
    const req = clone(fixture("basic"));
    (req.input as { dataSet?: Record<string, string> }).dataSet = { "regulation.sample": "2026.1.0" };
    const r = run(req);
    // 版 2026.1.0 では2028年以降の率は 0.08（後で 0.05 に訂正された）
    expect(cell(r, "cf.income.lumpSum", 2028)).toBe(552000 + 111156);
    expect((r.header as { data: { asOf: string }[] }).data[0]?.asOf).toBe("2026.1.0");
  });
});

describe("根拠の記録", () => {
  const base = fixture("basic");
  const none = run(base, "none");
  const summary = run(base, "summary");
  const full = run(base, "full");

  it("none・summary・full で数字が同じ", () => {
    for (const r of [summary, full]) {
      expect(JSON.stringify(r.flows)).toBe(JSON.stringify(none.flows));
      expect(JSON.stringify(r.annual)).toBe(JSON.stringify(none.annual));
      expect(JSON.stringify(r.table)).toBe(JSON.stringify(none.table));
    }
    expect(none.trace).toBeNull();
  });

  it("どの細かさでも見出し（版・部品表・データの版・基準月・計算方式）を付ける", () => {
    const h = none.header as Record<string, unknown>;
    expect(Object.keys(h)).toEqual(["engine", "trace", "baseMonth", "endYear", "calcConventions", "components", "data"]);
    expect((h.data as { fictional: boolean }[])[0]?.fictional).toBe(true);
  });

  it("summary は部品ごとに計算式・制度の値（値ID@r改訂）・端数処理の規則を持つ", () => {
    const t = summary.trace as { components: { id: string; formulas: string[]; params: { ref: string }[]; roundings: string[] }[]; timepoints: unknown[] };
    const lump = t.components.find((c) => c.id === "test.sample.lumpSum");
    expect(lump?.formulas).toEqual(["test.sample.lumpSum.net"]);
    expect(lump?.params.map((p) => p.ref).sort()).toEqual([
      "test.sample.lumpSum.rounding@r1",
      "test.sample.lumpSum.withholdingRate@r1",
      "test.sample.lumpSum.withholdingRate@r3",
    ]);
    expect(lump?.roundings).toEqual(["test.sample.lumpSum.rounding"]);
    expect(t.components.find((c) => c.id === "test.sample.balance")?.roundings).toEqual(["conv.investment.return"]);
    // 名前つきイベントの解決の結果
    expect(t.timepoints).toContainEqual(expect.objectContaining({ event: "f14de8b8-75fc-45d6-844d-63dcfb20618e", ym: "2031-04" }));
  });

  it("full は重複を除いた記録を番号で指し、すべてのお金の動きが記録を指す", () => {
    const t = full.trace as { nodes: { type: string; uses?: number[] }[]; flows: number[]; annual: number[] };
    expect(t.flows).toHaveLength(full.flows.length);
    expect(t.annual).toHaveLength(full.annual.length);
    for (const i of [...t.flows, ...t.annual]) expect(t.nodes[i]?.type).toBe("call");
    for (const n of t.nodes) for (const u of n.uses ?? []) expect(u).toBeLessThan(t.nodes.length);
    const keys = t.nodes.map((n) => JSON.stringify(n));
    expect(new Set(keys).size).toBe(keys.length);
    // 一時金のお金の動きは一時金の部品の記録を指す
    const i = full.flows.findIndex((f) => f.formula === "test.sample.lumpSum.net");
    expect((t.nodes[t.flows[i] as number] as unknown as { component: string }).component).toBe("test.sample.lumpSum");
  });

  it("full の端数処理の記録だけから計算し直して同じ値になる", () => {
    const t = full.trace as { nodes: Record<string, unknown>[] };
    const params = t.nodes.filter((n) => n.type === "param");
    const ruleOf = (id: string): { mode: RoundingMode; unit: number } =>
      (CONVENTIONS[id] ?? (params.find((p) => p.id === id)?.value as { mode: RoundingMode; unit: number })) as never;
    const roundings = t.nodes.filter((n) => n.type === "rounding");
    expect(roundings.length).toBeGreaterThan(10);
    for (const n of roundings) {
      const [num, den] = String(n.input).split("/").map((s) => BigInt(s)) as [bigint, bigint];
      const rule = ruleOf(String(n.rule));
      const q = divRound(num, mulInt(den, rule.unit), rule.mode);
      expect(Number(mulInt(q, rule.unit))).toBe(n.result);
    }
  });

  it("full の出力も JSON Schema に合い、整数でない数がない", () => {
    expect(() => check("engine.output", full, "E_OUTPUT_SCHEMA")).not.toThrow();
    expect(() => check("engine.output", summary, "E_OUTPUT_SCHEMA")).not.toThrow();
    expect(nonIntegerPaths(full)).toEqual([]);
  });
});

describe("入力の検査とエラー", () => {
  it("知らない欄（参照値を含む）を拒む（0004 の7）", () => {
    const req = clone(fixture("basic")) as unknown as { input: Record<string, unknown> };
    req.input.referenceValues = [{ row: "cf.income.pension", year: 2035, amount: 1834000 }];
    expect(() => runEngine(req, [samplePack()])).toThrow("E_INPUT_SCHEMA");
    const req2 = clone(fixture("basic")) as unknown as { input: { flows: Record<string, unknown>[] } };
    (req2.input.flows[0] as Record<string, unknown>).computed = 1;
    expect(() => runEngine(req2, [samplePack()])).toThrow("E_INPUT_SCHEMA");
  });

  it("金額の小数・率の数値・範囲外の金額を拒む", () => {
    const a = clone(fixture("basic"));
    (a.input as { openingBalance: number }).openingBalance = 0.5;
    expect(() => runEngine(a, [samplePack()])).toThrow("E_INPUT_SCHEMA");
    const b = clone(fixture("basic")) as unknown as { input: { assumptions: { investmentReturn: { default: unknown } } } };
    b.input.assumptions.investmentReturn.default = 0.02;
    expect(() => runEngine(b, [samplePack()])).toThrow("E_INPUT_SCHEMA");
    const c = clone(fixture("basic"));
    (c.input as { openingBalance: number }).openingBalance = 2 ** 53;
    expect(() => runEngine(c, [samplePack()])).toThrow("E_INPUT_SCHEMA");
  });

  it("登録簿にない行・時点の循環はエラー", () => {
    const a = clone(fixture("basic")) as unknown as { input: { flows: { row: string }[] } };
    (a.input.flows[0] as { row: string }).row = "cf.income.unknown";
    expect(() => runEngine(a, [samplePack()])).toThrow("E_ROW_UNKNOWN");
    const b = clone(fixture("basic")) as unknown as { input: { events: { at: unknown; id: string }[] } };
    const ev = b.input.events[0] as { at: unknown; id: string };
    ev.at = { event: ev.id };
    expect(() => runEngine(b, [samplePack()])).toThrow("E_TIMEPOINT_CYCLE");
  });

  it("文字列の入口は、エラーを ID だけの JSON で返す（値を含めない。0005 の8）", () => {
    const a = clone(fixture("basic"));
    (a.input as { openingBalance: number }).openingBalance = 1234.5;
    const out = runJson(JSON.stringify(a), JSON.stringify([samplePack()]));
    expect(JSON.parse(out)).toEqual({ error: { code: "E_INPUT_SCHEMA", ids: ["/input/openingBalance:type"] } });
    expect(out).not.toContain("1234");
    expect(JSON.parse(runJson("{", "[]"))).toEqual({ error: { code: "E_INPUT_SCHEMA", ids: ["json"] } });
    expect(JSON.parse(runJson(JSON.stringify(fixture("basic")), "[]"))).toEqual({ error: { code: "E_PARAM_UNKNOWN", ids: ["test.sample.lumpSum.withholdingRate"] } });
  });
});

describe("部品は純粋な関数", () => {
  it("入力は凍結され、部品から書き換えられない", () => {
    const req = clone(fixture("basic"));
    runEngine(req, [samplePack()]);
    expect(Object.isFrozen(req.input.flows[0])).toBe(true);
    const official = OFFICIAL_COMPONENTS.find((o) => o.def.id === "test.sample.monthlyFlow")!.def;
    const mutating = defineComponent({
      ...official,
      compute: (input: { object: string }, ctx) => {
        (ctx.readObject("test.sample.flows", input.object) as unknown as { amount: number }).amount = 0;
        return { flows: [] };
      },
    }) as ComponentDefinition;
    const replacement = { type: "replace" as const, target: official.id, contract: "1", component: mutating, hash: `sha256:${"0".repeat(64)}` };
    expect(() => runEngine(fixture("basic"), [samplePack()], { replacements: [replacement] })).toThrow(TypeError);
  });

  it("dataSet に知らないパックを書くとエラー", () => {
    const req = clone(fixture("basic"));
    (req.input as { dataSet?: Record<string, string> }).dataSet = { "regulation.nothing": "2026.1.0" };
    expect(() => run(req)).toThrow("E_PACK_UNKNOWN");
  });

  it("full でもイベントの解決を記録する", () => {
    const t = run(fixture("basic"), "full").trace as { nodes: { type: string; event?: string }[] };
    expect(t.nodes.some((n) => n.type === "timepoint" && n.event === "f14de8b8-75fc-45d6-844d-63dcfb20618e")).toBe(true);
  });
});
