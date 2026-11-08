// 表の長さ（endYear）で、ある年の数字が変わらない（0003 の追記）。表の最後の年の年度の保険料・扶養と第3号の判定・寡婦年金と死亡一時金の選択
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, realPacks } from "./helpers.ts";

const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

type Cell = { row: string; year: number; amount: number; member?: string; object?: string };
type FlowCell = { row: string; ym: string; amount: number; member?: string; object?: string; formula: string };

const withEnd = (r: EngineRequest, endYear: number): EngineRequest => ({ ...r, input: { ...r.input, endYear } });
const run = (r: EngineRequest) => runEngine({ ...r, trace: "none" }, realPacks());

/** 表の行（年ごと）とお金の動き（月ごと）のうち、upTo の年までの分 */
function upTo(r: EngineResult, year: number): { table: Map<string, number>; flows: Map<string, number> } {
  const table = new Map<string, number>();
  for (const c of r.table as unknown as Cell[]) {
    if (c.year > year) continue;
    const k = `${c.row}|${c.year}|${c.member ?? ""}|${c.object ?? ""}`;
    table.set(k, (table.get(k) ?? 0) + c.amount);
  }
  const flows = new Map<string, number>();
  for (const f of r.flows as unknown as FlowCell[]) {
    if (Number(f.ym.slice(0, 4)) > year) continue;
    const k = `${f.row}|${f.ym}|${f.member ?? ""}|${f.object ?? ""}|${f.formula}`;
    flows.set(k, (flows.get(k) ?? 0) + f.amount);
  }
  return { table, flows };
}

/** 表を endYear で終えた結果と、longer まで延ばした結果の、endYear までの行がすべて同じ */
function expectSameUpTo(req: EngineRequest, endYear: number, longer: number): void {
  const short = upTo(run(withEnd(req, endYear)), endYear);
  const long = upTo(run(withEnd(req, longer)), endYear);
  expect(Object.fromEntries(short.table)).toEqual(Object.fromEntries(long.table));
  expect(Object.fromEntries(short.flows)).toEqual(Object.fromEntries(long.flows));
}

describe("表の長さで、それより前の年の数字が変わらない", () => {
  it.each(MODELS)("表の最後の年を1年延ばしても、それまでの年の行が全部同じ: %s", (m) => {
    const req = modelHousehold(m);
    expectSameUpTo(req, req.input.endYear, req.input.endYear + 1);
  });

  it("単身・20代の見本: 表の最後の年（2094年）の健康保険料は、表が続くときと同じ（年度の月数に表の外の翌年1〜3月を数える）", () => {
    const req = modelHousehold("sampleSingle20s");
    const health = (r: EngineResult) => (r.table as unknown as Cell[]).filter((c) => c.row === "cf.taxSi.health" && c.year === 2094).reduce((s, c) => s + c.amount, 0);
    const a = health(run(withEnd(req, 2094)));
    const b = health(run(withEnd(req, 2095)));
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(180_000);
  });

  // 表を途中の年で終えたときに出ていた違い（どれも表の最後の年の近くの月の判定）
  it.each([
    // 第3号の判定の収入の見込み（その月からの1年）: 表の外の月を0にすると、表の最後の年の3月から第3号になっていた
    ["educationTwoKids", 2035],
    // 被扶養者の判定の収入の見込み: 表の最後の年の前の年度から国民健康保険の人数・軽減が変わっていた
    ["incapacityDisability", 2031],
    ["incapacityDisability", 2043],
    ["sampleSeniorCouple", 2027],
    // 寡婦年金と死亡一時金の選択: 表の中の寡婦年金の総額だけで比べ、表が短いと死亡一時金を選んでいた
    ["survivorSelfEmployed", 2043],
  ] as const)("表を途中で終えても、表の最後の年までの行は表が続くときと同じ: %s（%i年まで）", (m, endYear) => {
    const req = modelHousehold(m);
    expectSameUpTo(req, endYear, req.input.endYear);
  });
});

describe("基準の月の年の範囲（表の年と同じ 1900〜2200）", () => {
  it.each(["1000-01", "1899-12"])("基準の月 %s は、入力の誤りとして基準の月を指して返す（出力の検査の誤りにしない）", (baseMonth) => {
    const req = modelHousehold("salariedCoupleTwoKids");
    let err: unknown;
    try {
      run({ ...req, input: { ...req.input, baseMonth } });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: "E_ARGUMENT", ids: ["baseMonth"] });
  });

  it("1900年の1月は計算できる範囲の内（この試験は年の境目だけを見る）", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    let err: unknown;
    try {
      run({ ...req, input: { ...req.input, baseMonth: "1900-01" } });
    } catch (e) {
      err = e;
    }
    expect((err as { ids?: string[] } | undefined)?.ids ?? []).not.toEqual(["baseMonth"]);
  });
});
