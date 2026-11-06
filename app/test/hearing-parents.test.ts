// 詳細版（full 版3）のご両親・仕送りと援助・介護・受け取る予定の相続を、入力のホームの現状に取り込む（workspace/hearing/sheet.ts）。
// 取り込んだ親には亡くなる見込みを平均余命の推定で入れ（画面で親を足したときと同じ）、介護の費用はその月で止まる
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyImport, approvalTime, importSheet } from "../src/workspace/hearing/sheet.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { resolveTimepoint } from "../src/workspace/input/form.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { preview } from "./helpers.ts";

const FULL3 = new Uint8Array(readFileSync(join(REPO_DIR, "hearing", "samples", "full-3-sample.xlsx")));
const AT = approvalTime(new Date(2026, 10, 7, 10, 0, 0));
let n = 0;
const seq = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const blank = (): WorkingHousehold => withRefreshedEstimates(blankHousehold("2026-10", seq));

describe("詳細版（full 版3）のご両親の取り込み", () => {
  it("候補に母の介護・母への仕送り・義父からの援助・受け取る予定の相続・贈与が並び、承認すると現状に入る（親には亡くなる見込みの推定）", async () => {
    const wh = blank();
    const r = await importSheet(FULL3, wh, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const titles = r.view.candidates.map((c) => `${c.group}:${c.title}`);
    expect(titles).toEqual(expect.arrayContaining(["介護:母の介護", "出るお金:母への仕送り", "入るお金:義父からの援助", "入るお金:受け取る予定の相続・贈与"]));
    const out = applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), AT);
    const h = out.wh.request.input.household;
    const parents = h.members.filter((m) => m.kind === "parent");
    expect(parents).toHaveLength(3);
    for (const p of parents) expect(out.wh.assumed[`family/${p.id}/leaves`]).toBeDefined();
    const mother = parents.find((p) => p.sex === "female" && p.outside?.of === h.members.find((m) => m.kind === "self")?.id)!;
    const care = h.careExpenses!.find((c) => c.member === mother.id)!;
    expect(care).toMatchObject({ place: "facility", otherMonthly: { value: 120000 } });
    expect((h.periodicExpenses ?? []).find((p) => p.kind === "allowance")?.counterparty).toBe(mother.id);
    // 介護の費用は、母の亡くなる見込みの年の後は出ない
    const r2 = preview(withRefreshedEstimates(out.wh).request);
    const gone = Number(resolveTimepoint(h, mother.leaves ?? null)!.slice(0, 4));
    expect(r2.table.filter((c) => c.object === care.id && c.year > gone).reduce((s, c) => s + c.amount, 0)).toBe(0);
    expect(r2.table.filter((c) => c.object === care.id && c.year === 2027).reduce((s, c) => s + c.amount, 0)).toBeGreaterThan(0);
  });

  it("親を承認しなかったときは、その親への仕送り・その親の介護も入れない", async () => {
    const wh = blank();
    const r = await importSheet(FULL3, wh, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const skip = new Set(r.view.candidates.filter((c) => c.title === "母").map((c) => c.id));
    const out = applyImport(wh, r.view, new Set(r.view.candidates.filter((c) => !skip.has(c.id)).map((c) => c.id)), AT);
    const h = out.wh.request.input.household;
    expect(h.careExpenses ?? []).toEqual([]);
    expect((h.periodicExpenses ?? []).filter((p) => p.kind === "allowance")).toEqual([]);
    expect(out.skipped).toEqual(expect.arrayContaining(["母の介護", "母への仕送り"]));
  });
});
