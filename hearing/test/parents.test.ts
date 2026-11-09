// 詳細版 full 版3: ご両親（ご健在か・年齢・同居か）と、ご両親への仕送り・ご両親からの援助・介護が始まっているか、受け取る予定の相続・贈与。
// 版2 の項目はそのまま残し（キーは変えない）、新しい項目は区画「ご両親」に置く（目立たせないよう、生活費の後・そのほかの前）。版2 は廃止
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approveAll, createHearingSheet, exportAnswers, importAnswers, importHearingSheet, type Answer, type FilledSheet } from "../src/index.ts";
import { itemByKey } from "../src/definition.ts";
import { formatValue } from "../src/values.ts";
import { engineAvailable, full2, full3, full5, HEARING_DIR, idSeq, OFFICE, preview, simple } from "./helpers.ts";
import { sampleBytes, type SampleFile } from "./sample.ts";

const def = full3();
const items = itemByKey(def);
const NEW_KEYS = ["hs.family.parent.allowance", "hs.family.parent.support", "hs.family.parent.care", "hs.family.parent.careMonthly", "hs.inherit.expected", "hs.inherit.year", "hs.inherit.amount"];
const PARENT_KEYS = ["hs.family.parent.alive", "hs.family.parent.age", "hs.family.parent.cohabiting"];
const M = { format: "fprise-lifeplan-hearing" as const, formatVersion: "0.1", sheetId: "full", sheetVersion: 3, requestId: "R-ABCDEF", customerNo: "", layoutDigest: "0".repeat(64), appVersion: "0.1.0", exportedOn: "2026-11-07" };

function a(key: string, value: string | number | "unknown" | "notApplicable", index?: number): Answer {
  const at = { key, ...(index !== undefined ? { index } : {}) };
  if (value === "unknown" || value === "notApplicable") return { ...at, status: value };
  const f = formatValue(items.get(key) as NonNullable<ReturnType<typeof items.get>>, value);
  return { ...at, status: "value", raw: f.raw, ...(f.raw2 !== undefined ? { raw2: f.raw2 } : {}) };
}
const sheet = (...answers: Answer[]): FilledSheet => ({ management: M, answers });
const run = (...answers: Answer[]) => importAnswers(def, sheet(...answers), { baseMonth: "2026-10", newId: idSeq("parents") });
const base = [a("hs.meta.filledOn", "2026-10"), a("hs.family.adult.birthYearMonth", "1966-05", 1), a("hs.family.adult.sex", "male", 1), a("hs.family.adult.birthYearMonth", "notApplicable", 2), a("hs.housing.type", "family")];
const mother = [a("hs.family.parent.alive", "alive", 2), a("hs.family.parent.age", 88, 2), a("hs.family.parent.cohabiting", "apart", 2)];

describe("詳細版 full 版3 のシート定義", () => {
  it("版2 の項目をそのまま残し、ご両親の3問（簡易版と同じキー）と新しい7問を足した。版2 は廃止（版3 も版4 を足して廃止。0155）", () => {
    const v2 = full2().items.map((i) => i.key);
    const v3 = def.items.map((i) => i.key);
    expect(v3.filter((k) => !NEW_KEYS.includes(k) && !PARENT_KEYS.includes(k))).toEqual(v2);
    for (const k of [...PARENT_KEYS, ...NEW_KEYS]) expect(items.get(k), k).toMatchObject({ addedIn: 3, retiredIn: null });
    for (const k of PARENT_KEYS) expect(items.get(k)?.label).toBe(itemByKey(simple()).get(k)?.label);
    expect(full2().status).toBe("retired");
    expect(def.status).toBe("retired");
    expect(def.axes.find((x) => x.id === "parent")?.count).toBe(4);
  });

  it("区画「ご両親」は生活費の後・そのほかの前（目立たせない）。分かる範囲で・空欄でよいと書く", () => {
    const ids = def.sections.map((s) => s.id);
    expect(ids.slice(-3)).toEqual(["living", "parents", "other"]);
    const s = def.sections.find((x) => x.id === "parents")!;
    expect(s.lead).toContain("空欄のままでもかまいません");
    expect(s.groups.map((g) => g.id)).toEqual(["parents", "inherit"]);
    expect(s.groups[0]?.axis).toBe("parent");
  });
});

describe("ご両親のお金と介護の取り込み", () => {
  it("仕送りは相手をその親にした仕送りの行（毎月）、援助は援助・仕送りを受ける行（毎月）。どちらも今の月から", () => {
    const r = run(...base, ...mother, a("hs.family.parent.allowance", 30000, 2), a("hs.family.parent.support", 20000, 2));
    const h = r.request.input.household;
    const p = h.members.find((m) => m.kind === "parent")!;
    expect(h.periodicExpenses).toEqual([{ id: expect.any(String), label: "仕送り", kind: "allowance", row: "cf.expense.other", from: { at: "2026-10" }, to: null, everyYears: 1, monthly: true, amount: { value: 30000, state: "confirmed", origin: { kind: "hearing", ref: "R-ABCDEF" } }, counterparty: p.id }]);
    expect(h.incomeFlows).toEqual([{ id: expect.any(String), label: "援助・仕送りを受ける", kind: "support", from: { at: "2026-10" }, to: null, everyYears: 1, monthly: true, amount: { value: 20000, state: "confirmed", origin: { kind: "hearing", ref: "R-ABCDEF" } }, counterparty: p.id }]);
    expect(r.candidates.filter((c) => c.collection === "periodicExpenses" || c.collection === "incomeFlows")).toHaveLength(2);
  });

  it("「該当なし」・0円の仕送りは行を作らない", () => {
    const r = run(...base, ...mother, a("hs.family.parent.allowance", "notApplicable", 2), a("hs.family.parent.support", 0, 2));
    expect(r.request.input.household.periodicExpenses ?? []).toEqual([]);
    expect(r.request.input.household.incomeFlows ?? []).toEqual([]);
  });

  it("介護が始まっていれば、その親の介護の費用を1件（始まりは前の月で仮の印・月々の費用は記入の額）", () => {
    const r = run(...base, ...mother, a("hs.family.parent.care", "facility", 2), a("hs.family.parent.careMonthly", 120000, 2));
    const h = r.request.input.household;
    const p = h.members.find((m) => m.kind === "parent")!;
    const care = h.careExpenses![0]!;
    expect(care).toMatchObject({ member: p.id, from: { at: "2026-09" }, place: "facility", otherMonthly: { value: 120000, state: "confirmed" } });
    expect(care.months).toBeUndefined();
    expect(r.assumed[`ev/care/${care.id}/from`]).toContain("始まった年月");
    // 介護が始まっていないのに費用だけの記入は、取り込まずに知らせる
    const bad = run(...base, ...mother, a("hs.family.parent.care", "none", 2), a("hs.family.parent.careMonthly", 50000, 2));
    expect(bad.request.input.household.careExpenses ?? []).toEqual([]);
    expect(bad.issues.some((i) => i.code === "H_CONTRADICTION" && i.key === "hs.family.parent.careMonthly")).toBe(true);
  });

  it("受け取る予定の相続・贈与が「ある」なら、相続・遺贈の行（時期は記入の年の1月・見込みは当てにしない）。時期の無いときは1年後で仮の印", () => {
    const r = run(...base, a("hs.inherit.expected", "yes"), a("hs.inherit.year", 2035), a("hs.inherit.amount", 10000000));
    const f = r.request.input.household.incomeFlows![0]!;
    expect(f).toMatchObject({ kind: "inheritance", label: "相続・遺贈", from: { at: "2035-01" }, to: { at: "2035-01" }, likelihood: "uncertain", amount: { value: 10000000, state: "confirmed" } });
    expect(f.counterparty).toBeUndefined();
    const noYear = run(...base, a("hs.inherit.expected", "yes"), a("hs.inherit.year", "unknown"));
    const g = noYear.request.input.household.incomeFlows![0]!;
    expect(g.from).toEqual({ at: "2027-10" });
    expect(g.amount).toMatchObject({ value: 0, state: "estimated" });
    expect(noYear.assumed[`in/${g.id}/from`]).toBeDefined();
    // 「ない」なら作らない（時期・額の記入があれば知らせる）
    const no = run(...base, a("hs.inherit.expected", "no"), a("hs.inherit.amount", 5000000));
    expect(no.request.input.household.incomeFlows ?? []).toEqual([]);
    expect(no.issues.some((i) => i.code === "H_CONTRADICTION")).toBe(true);
  });

  it("版2 のシート（ご両親の欄の無い詳細版）は今までどおり読め、親・お金の行・介護は作らない", () => {
    const r = importAnswers(full2(), { management: { ...M, sheetVersion: 2 }, answers: base.filter((x) => items.has(x.key)) }, { baseMonth: "2026-10", newId: idSeq("v2") });
    const h = r.request.input.household;
    expect(h.members.some((m) => m.kind === "parent")).toBe(false);
    expect(h.careExpenses ?? []).toEqual([]);
    expect(h.incomeFlows ?? []).toEqual([]);
  });
});

describe("見本のシート full-3", () => {
  const NAME = "full-3-sample";
  const json = JSON.parse(readFileSync(join(HEARING_DIR, "samples", `${NAME}.json`), "utf8")) as SampleFile;
  const xlsx = new Uint8Array(readFileSync(join(HEARING_DIR, "samples", `${NAME}.xlsx`)));

  it("リポジトリの .xlsx は、記入例の JSON から作り直したものと同じ（npm run sample）", async () => {
    expect(Buffer.compare(Buffer.from(await sampleBytes(`${NAME}.json`, json)), Buffer.from(xlsx))).toBe(0);
  });

  it("取り込むと、エラーなしでご両親3人・仕送り・援助・母の介護・受け取る予定の相続が入り、計算エンジンで計算できる。前回の値を記入して（今の版の詳細版で）書き出すと同じ回答", async () => {
    const r = await importHearingSheet(xlsx, { baseMonth: "2026-10", newId: idSeq("sample-full3") });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(`${r.definition.sheetId}-${r.definition.version}`).toBe("full-3");
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    const h = r.request.input.household;
    expect(h.members.filter((m) => m.kind === "parent")).toHaveLength(3);
    expect(h.periodicExpenses).toHaveLength(1);
    expect((h.incomeFlows ?? []).map((f) => f.kind).sort()).toEqual(["inheritance", "support"]);
    expect(h.careExpenses).toHaveLength(1);
    if (engineAvailable()) {
      const out = preview(approveAll(r, "2026-11-07T10:00:00+09:00"));
      expect(out.error, JSON.stringify(out.error)).toBeUndefined();
    }
    const s = await createHearingSheet({ definition: full5(), household: { request: r.request, assumed: r.assumed }, requestId: "R-7K3P9Q", customerNo: "A0042", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-11-07" });
    const back = await importHearingSheet(s.bytes, { baseMonth: "2026-10", requests: [s.request], newId: idSeq("again") });
    if (!back.ok) throw new Error(JSON.stringify(back.issues));
    expect(exportAnswers(full5(), back.request, { assumed: back.assumed }).answers).toEqual(s.filled.answers);
    const pick = (list: readonly Answer[]) => list.filter((x) => (x.key.startsWith("hs.family.parent.") || x.key.startsWith("hs.inherit.")) && x.status === "value").map((x) => `${x.key}#${x.index ?? 0}`);
    expect(pick(s.filled.answers)).toContain("hs.family.parent.careMonthly#2");
    expect(pick(s.filled.answers)).toContain("hs.inherit.amount#0");
  });
});
