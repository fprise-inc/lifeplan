// 速さの見直し（0005 の追記 2026-10-10）で足した近道が、元の形と同じ結果になること:
// エンジン全体の出力の検査の近道（checkOutput）・数の鍵の表（numTable）・月の文字列の読み取り（parseYm）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import { numTable } from "../src/engine/numTable.ts";
import { EngineError } from "../src/errors.ts";
import { ANNUAL_KEYS, CELL_KEYS, FLOW_KEYS, annualOk, cellOk, check, checkOutput, flowOk } from "../src/io/validate.ts";
import { parseYm } from "../src/time/month.ts";
import { ENGINE_DIR } from "../scripts/lib.ts";
import { clone, modelHousehold, realPacks } from "./helpers.ts";

type Schema = { properties: Record<string, { $ref?: string }>; required: string[]; additionalProperties: boolean };
const readSchema = (name: string) => JSON.parse(readFileSync(join(ENGINE_DIR, "schemas", `${name}.json`), "utf8")) as { $defs: Record<string, unknown> };

/** 元の検査器と近道の結果（通るか、誤りの符号と ID） */
function outcome(f: () => void): string {
  try {
    f();
    return "ok";
  } catch (e) {
    if (e instanceof EngineError) return `${e.code}:${e.ids.join(",")}`;
    throw e;
  }
}

describe("出力の検査の近道（checkOutput）", () => {
  it("近道が前提にする形が、スキーマの形と同じ（スキーマを変えたら validate.ts の近道も直す）", () => {
    const common = readSchema("common").$defs as Record<string, Schema>;
    const flow = common.flow as Schema;
    expect(Object.keys(flow.properties)).toEqual(FLOW_KEYS);
    expect(flow.required).toEqual(["row", "ym", "amount", "accrualYear", "formula"]);
    expect(flow.additionalProperties).toBe(false);
    expect(Object.fromEntries(Object.entries(flow.properties).map(([k, v]) => [k, v.$ref]))).toEqual({
      row: "#/$defs/rowId",
      ym: "#/$defs/yearMonth",
      amount: "#/$defs/yen",
      accrualYear: "#/$defs/year",
      member: "#/$defs/uuid",
      object: "#/$defs/uuid",
      formula: "#/$defs/dottedId",
    });
    const annual = common.annualRow as Schema;
    expect(Object.keys(annual.properties)).toEqual(ANNUAL_KEYS);
    expect(annual.required).toEqual(["row", "year", "amount", "formula"]);
    expect(annual.additionalProperties).toBe(false);
    const output = readSchema("engine.output").$defs as Record<string, { properties: Record<string, unknown> }>;
    const result = output.result as { properties: Record<string, { items?: unknown }> };
    expect(result.properties.flows).toEqual({ type: "array", items: { $ref: "urn:financia:schema:common#/$defs/flow" } });
    expect(result.properties.annual).toEqual({ type: "array", items: { $ref: "urn:financia:schema:common#/$defs/annualRow" } });
    const table = (result.properties.table as { items: Schema }).items;
    expect(Object.keys(table.properties)).toEqual(CELL_KEYS);
    expect(table.required).toEqual(["row", "year", "amount"]);
    expect(table.additionalProperties).toBe(false);
    // 文字列の形（正規表現）もスキーマと同じ
    expect((common.yearMonth as unknown as { pattern: string }).pattern).toBe("^[0-9]{4}-(0[1-9]|1[0-2])$");
    expect((common.uuid as unknown as { pattern: string }).pattern).toBe("^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
    expect((common.dottedId as unknown as { pattern: string }).pattern).toBe("^[a-z][a-zA-Z0-9]*(\\.[a-z][a-zA-Z0-9]*)+$");
    expect(common.rowId).toEqual({ allOf: [{ $ref: "#/$defs/dottedId" }, { pattern: "^cf\\." }] });
    expect(common.yen).toMatchObject({ type: "integer", minimum: -9007199254740991, maximum: 9007199254740991 });
    expect(common.year).toEqual({ type: "integer", minimum: 1900, maximum: 2200 });
  });

  const base = runEngine({ ...modelHousehold("lifetime100Plan"), trace: "none" }, realPacks()) as EngineResult;

  it("正しい出力は通り、元の検査器と同じ", () => {
    expect(base.flows.length).toBeGreaterThan(1000);
    expect(outcome(() => checkOutput(base, "E_OUTPUT_SCHEMA"))).toBe("ok");
    expect(outcome(() => check("engine.output", base, "E_OUTPUT_SCHEMA"))).toBe("ok");
  });

  // 1件を書き換えた出力で、近道と元の検査器の結果（誤りの ID を含む）が同じ
  const mutations: [string, (o: Record<string, unknown>) => void][] = [
    ["欄を足す", (o) => (o.note = "x")],
    ["必須の欄を消す", (o) => delete o.row],
    ["formula を消す", (o) => delete o.formula],
    ["undefined の欄", (o) => (o.member = undefined)],
    ["行IDの形", (o) => (o.row = "income.salary")],
    ["行IDの大文字", (o) => (o.row = "cf.Income")],
    ["月の形", (o) => (o.ym = "2026-13")],
    ["年の範囲", (o) => (o.accrualYear = 2201)],
    ["年が小数", (o) => (o.accrualYear = 2030.5)],
    ["額が小数", (o) => (o.amount = 1.5)],
    ["額が安全な整数の外", (o) => (o.amount = 2 ** 53)],
    ["額が NaN", (o) => (o.amount = Number.NaN)],
    ["額が文字列", (o) => (o.amount = "100")],
    ["構成員の形", (o) => (o.member = "not-a-uuid")],
    ["物の形", (o) => (o.object = 12)],
    ["計算式IDの形", (o) => (o.formula = "Bad")],
  ];
  for (const kind of ["flows", "annual", "table"] as const) {
    for (const [name, mutate] of mutations) {
      it(`${kind}: ${name}`, () => {
        const out = clone(base) as unknown as Record<string, Record<string, unknown>[]>;
        const list = out[kind] as Record<string, unknown>[];
        mutate(list[Math.floor(list.length / 2)] as Record<string, unknown>);
        expect(outcome(() => checkOutput(out, "E_OUTPUT_SCHEMA"))).toBe(outcome(() => check("engine.output", out, "E_OUTPUT_SCHEMA")));
      });
    }
  }

  it("1件ずつの近道は、真なら元の検査器でも合う（prototype の違う物・配列は偽）", () => {
    const f = { ...(base.flows[0] as object) };
    expect(flowOk(f)).toBe(true);
    expect(flowOk(Object.assign(Object.create({ extra: 1 }) as object, f))).toBe(false);
    expect(flowOk([f])).toBe(false);
    expect(annualOk({ ...(base.annual[0] as object) })).toBe(true);
    expect(cellOk({ ...(base.table[0] as object) })).toBe(true);
  });
});

describe("数の鍵の表（numTable）", () => {
  it("Map<number> と同じ鍵の区別（0 と -0・NaN どうしは同じ、違う数は違う）", () => {
    const t = numTable<string>();
    const m = new Map<number, string>();
    const keys = [0, -0, 1, -1, 1.5, 24300, 20261231, Number.NaN, 1e21, -1e-7, 2 ** 53];
    keys.forEach((k, i) => {
      t[k] = `v${i}`;
      m.set(k, `v${i}`);
    });
    for (const k of [...keys, 2, 0.1, Number.POSITIVE_INFINITY]) expect(t[k]).toBe(m.get(k));
  });
});

describe("月の文字列の読み取り（parseYm）", () => {
  it("覚えた結果も、形の誤りも、前と同じ", () => {
    expect(parseYm("2026-01")).toBe(2026 * 12);
    expect(parseYm("2026-01")).toBe(2026 * 12);
    expect(parseYm("0000-12")).toBe(11);
    for (const bad of ["2026-13", "2026-00", "2026-1", "202a-01", "2026/01", " 2026-01", "", "２０２６-01"]) {
      expect(() => parseYm(bad)).toThrow(EngineError);
      expect(() => parseYm(bad)).toThrow(EngineError);
    }
    expect(() => parseYm(202601 as unknown as string)).toThrow(EngineError);
  });
});
