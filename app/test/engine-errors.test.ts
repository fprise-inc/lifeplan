// 計算が止まったときの画面の文（engineErrors.ts）と、エラーの ID が二本立ての枠に残ること（dual.ts）
import { describe, expect, it } from "vitest";
import { DualEngine } from "../src/engine/dual.ts";
import type { HostApi } from "../src/engine/host.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { engineErrorText } from "../src/workspace/engineErrors.ts";
import { modelHousehold, realEngine } from "./helpers.ts";

type Err = { error: { code: string; ids: string[] } };

describe("制度データに値が無いとき（E_PARAM_NO_VALUE）の文", () => {
  it("本物のエンジン: 今年度の住民税の決定額を消した会社員は、前の年の保険料の値が無く止まる。どの値のどの時期かと避け方を出す", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    (req.input.household as { residentTaxAssessments?: unknown[] }).residentTaxAssessments = [];
    const { engine, packs } = realEngine();
    const out = JSON.parse(engine.runBatch(JSON.stringify([req]), packs, '{"preview":true}')) as Err[];
    const e = out[0]!.error;
    expect(e.code).toBe("E_PARAM_NO_VALUE");
    expect(e.ids).toHaveLength(2);
    // 引く日は計算基準月の前の年より前（制度データは2025年から）
    expect(e.ids[1]! < "2025-01-01").toBe(true);
    const [y, m] = e.ids[1]!.split("-").map(Number);
    const text = engineErrorText(e.code, e.ids, req.input.baseMonth);
    expect(text).toContain(`${y}年${m}月の時点の値がありません`);
    expect(text).not.toContain(`「${e.ids[0]}」`); // 値 ID ではなく登録簿の名前
    expect(text).toContain("「働き方と収入」のカードで、住民税（今年度の年税額）が空の人に入れると計算できます");
  });

  it("計算基準月より後の時期は、住民税の避け方を出さない", () => {
    const text = engineErrorText("E_PARAM_NO_VALUE", ["employmentInsurance.employeeRate.general", "2090-04-01"], "2026-10");
    expect(text).toContain("「雇用保険料率の被保険者負担分（一般の事業）」の2090年4月の時点の値がありません");
    expect(text).not.toContain("住民税");
  });

  it("ほかの符号と、引く日の無い古い形は今までどおり（符号）だけ・名前だけ", () => {
    expect(engineErrorText("E_INPUT_SCHEMA", ["/input"], "2026-10")).toBe("（E_INPUT_SCHEMA）");
    expect(engineErrorText("E_PARAM_NO_VALUE", ["employmentInsurance.employeeRate.general"], "2026-10")).toContain("「雇用保険料率の被保険者負担分（一般の事業）」の値がありません");
  });
});

describe("二本立ての枠にエラーの ID が残る", () => {
  it("本体の正の計算がエラーなら符号と ID を持ち、次に計算できたら消える", async () => {
    const req = (n: number): EngineRequest => ({ trace: "none", input: { baseMonth: "2026-10", endYear: 2027, household: { members: [] }, n } });
    let fail = true;
    const host = {
      kind: "browser-dev",
      compute: async (slots: { id: string; rev: number }[]) => ({
        ms: 1,
        slots: Object.fromEntries(
          slots.map((s) => [
            s.id,
            { rev: s.rev, ms: 1, result: fail ? { error: { code: "E_PARAM_NO_VALUE", ids: ["x.y", "2024-12-01"] } } : { header: { engine: { version: "t", sourceDigest: "x" } }, table: [], summary: {} } },
          ]),
        ),
      }),
    } as unknown as HostApi;
    const d = new DualEngine({ session: null, host, onChange: () => undefined, setTimer: () => 0, clearTimer: () => undefined });
    await d.set({ current: req(1) });
    expect(d.view("current").error).toBe("E_PARAM_NO_VALUE");
    expect(d.view("current").errorIds).toEqual(["x.y", "2024-12-01"]);
    fail = false;
    await d.set({ current: req(2) });
    expect(d.view("current").error).toBeNull();
    expect(d.view("current").errorIds).toEqual([]);
  });
});
