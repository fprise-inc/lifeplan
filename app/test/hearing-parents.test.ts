// 詳細版（full 版3）のご両親・仕送りと援助・介護・受け取る予定の相続を、入力のホームの現状に取り込む（workspace/hearing/sheet.ts）。
// 取り込んだ親には亡くなる見込みを平均余命の推定で入れ（画面で親を足したときと同じ）、介護の費用はその月で止まる
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sampleBytes, type SampleFile } from "../../hearing/test/sample.ts";
import { applyImport, approvalTime, defaultSelection, importSheet } from "../src/workspace/hearing/sheet.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { resolveTimepoint } from "../src/workspace/input/form.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { preview } from "./helpers.ts";

const FULL3 = new Uint8Array(readFileSync(join(REPO_DIR, "hearing", "samples", "full-3-sample.xlsx")));
const SIMPLE = new Uint8Array(readFileSync(join(REPO_DIR, "hearing", "samples", "basic-2-sample.xlsx")));
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

describe("取り込んだ働き方の終わり", () => {
  it("簡易版で取り込んだ会社員・パートの今の働き方に、働く最後の年齢の推定（仮の印）が入り、100歳まで給与が続かない", async () => {
    const wh = blank();
    const r = await importSheet(SIMPLE, wh, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const out = applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), AT);
    const h = out.wh.request.input.household;
    const working = (h.employmentPeriods ?? []).filter((p) => p.type !== "unemployed" && p.type !== "leave");
    expect(working.length).toBeGreaterThan(0);
    for (const p of working) expect(p.to, p.type).not.toBeNull();
    const years = preview(withRefreshedEstimates(out.wh).request).table.filter((c) => c.row.startsWith("cf.income.salary") && c.amount > 0).map((c) => c.year);
    expect(years.length).toBeGreaterThan(0);
    expect(Math.max(...years)).toBeLessThan(2026 + 45);
  });
});

describe("値の入った世帯に詳細版（full 版3）のご両親を取り込む（今の値を壊さない。0139）", () => {
  /** 版3 の見本を空の世帯に取り込み、FP が介護・仕送り・受け取る予定の相続を詳しく入れた世帯 */
  async function detailed(): Promise<{ wh: WorkingHousehold; fatherInLaw: string }> {
    const wh0 = blank();
    const r = await importSheet(FULL3, wh0, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const w1 = applyImport(wh0, r.view, new Set(r.view.candidates.map((c) => c.id)), AT).wh;
    const h = structuredClone(w1.request.input.household);
    const care = h.careExpenses![0]!;
    care.from = { at: "2024-04" };
    care.months = 60;
    const allowance = h.periodicExpenses!.find((p) => p.kind === "allowance")!;
    allowance.from = { at: "2021-01" };
    allowance.to = { at: "2030-12" };
    const spouse = h.members.find((m) => m.kind === "spouse")!;
    const fatherInLaw = h.members.find((m) => m.kind === "parent" && m.sex === "male" && m.outside?.of === spouse.id)!;
    const inherit = h.incomeFlows!.find((f) => f.kind === "inheritance")!;
    inherit.amount = { value: 20000000, state: "confirmed", origin: { kind: "user" } } as typeof inherit.amount;
    inherit.likelihood = "certain";
    inherit.counterparty = fatherInLaw.id;
    const assumed = Object.fromEntries(Object.entries(w1.assumed).filter(([k]) => !k.startsWith(`ev/care/${care.id}/`) && !k.startsWith(`in/${inherit.id}/`)));
    return { wh: { ...w1, assumed, request: { ...w1.request, input: { ...w1.request.input, household: h } } }, fatherInLaw: fatherInLaw.id };
  }
  /** 見本の答えを変えた版3 の .xlsx（undefined の項目は空欄） */
  async function sheetWith(change: Record<string, SampleFile["values"][string] | undefined>): Promise<Uint8Array> {
    const file = "full-3-sample.json";
    const sample = JSON.parse(readFileSync(join(REPO_DIR, "hearing", "samples", file), "utf8")) as SampleFile;
    const values: Record<string, SampleFile["values"][string]> = { ...sample.values };
    for (const [k, v] of Object.entries(change)) {
      if (v === undefined) delete values[k];
      else values[k] = v;
    }
    return sampleBytes(file, { ...sample, values });
  }

  it("同じ答えをもう一度取り込んでも、シートで聞かない欄（介護の始まり・期間、仕送りの始まり・終わり、相続の相手・見込み）は今の値のまま。相続の行は重ねて足さない", async () => {
    const { wh, fatherInLaw } = await detailed();
    const r = await importSheet(FULL3, wh, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const by = (t: string) => r.view.candidates.find((c) => c.title === t);
    expect(by("母への仕送り")?.kind).toBe("same");
    // 介護が始まった年月はシートで聞かない（仮の値）ので、今の年月のまま（お答えなし）
    const care = by("母の介護");
    expect(care?.kind).toBe("noAnswer");
    expect(care?.fields.flatMap((f) => f.diffs).find((d) => d.label === "始まり")).toMatchObject({ current: "2024年4月", kept: true });
    // 受け取る予定の相続は今の行（相手のある行）と対応づけ、記入どおりの時期・額は変更の候補（相手・見込みは今のまま）
    const inherit = r.view.candidates.filter((c) => c.title === "受け取る予定の相続・贈与");
    expect(inherit).toHaveLength(1);
    expect(inherit[0]?.kind).toBe("changed");
    const out = applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), AT).wh;
    const h = out.request.input.household;
    expect(h.careExpenses).toHaveLength(1);
    expect(h.careExpenses![0]).toMatchObject({ from: { at: "2024-04" }, months: 60, place: "facility", otherMonthly: { value: 120000 } });
    expect(h.periodicExpenses!.filter((p) => p.kind === "allowance")).toMatchObject([{ from: { at: "2021-01" }, to: { at: "2030-12" }, amount: { value: 30000 } }]);
    const flows = h.incomeFlows!.filter((f) => f.kind === "inheritance");
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({ amount: { value: 10000000 }, from: { at: "2035-01" }, likelihood: "certain", counterparty: fatherInLaw });
    // 親の亡くなる見込みの推定（仮の印）は、親の候補を承認しても今のまま
    for (const p of h.members.filter((m) => m.kind === "parent")) expect(out.assumed[`family/${p.id}/leaves`]).toBeDefined();
  });

  it("空欄の介護の費用・相続の時期と額は、今の値を0円・目安・仮の値で上書きしない（お答えなし）", async () => {
    const { wh } = await detailed();
    const bytes = await sheetWith({ "hs.family.parent.careMonthly#2": undefined, "hs.inherit.year": undefined, "hs.inherit.amount": undefined });
    const r = await importSheet(bytes, wh, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const inherit = r.view.candidates.find((c) => c.title === "受け取る予定の相続・贈与");
    expect(inherit?.kind).toBe("noAnswer");
    expect(inherit?.fields.flatMap((f) => f.diffs).find((d) => d.current === "20,000,000円")).toMatchObject({ kept: true });
    expect(r.view.candidates.find((c) => c.title === "母の介護")?.kind).toBe("noAnswer");
    const out = applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), AT).wh.request.input.household;
    expect(out.careExpenses![0]).toMatchObject({ from: { at: "2024-04" }, otherMonthly: { value: 120000 } });
    expect(out.incomeFlows!.find((f) => f.kind === "inheritance")).toMatchObject({ amount: { value: 20000000, state: "confirmed" }, from: { at: "2035-01" } });
  });

  it("年齢の答え（生年月の仮の値）は、確定で入れてある親の生年月を既定で残す（今の値の方が詳しい）", async () => {
    const { wh } = await detailed();
    const h = structuredClone(wh.request.input.household);
    const spouse = h.members.find((m) => m.kind === "spouse")!;
    const fil = h.members.find((m) => m.kind === "parent" && m.sex === "male" && m.outside?.of === spouse.id)!;
    fil.birth = { birthYearMonth: "1956-05", bornOnFirst: false };
    const assumed = Object.fromEntries(Object.entries(wh.assumed).filter(([k]) => k !== `family/${fil.id}/birth`));
    const w = { ...wh, assumed, request: { ...wh.request, input: { ...wh.request.input, household: h } } };
    const r = await importSheet(await sheetWith({ "hs.family.parent.age#3": 71 }), w, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const c = r.view.candidates.find((x) => x.title === "義父");
    expect(c?.kind).toBe("changed");
    expect(c?.keep).toContain("今の値の方が詳しいので残します");
    expect(defaultSelection(r.view).has(c?.id ?? "")).toBe(false);
    const out = applyImport(w, r.view, defaultSelection(r.view), AT).wh;
    expect(out.request.input.household.members.find((m) => m.id === fil.id)?.birth.birthYearMonth).toBe("1956-05");
  });
});
