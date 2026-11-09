// 詳細版 full 版4: 自営業の方の確定申告の仕方（青色申告と控除の額・白色申告）。版3 の項目はそのまま残し、事業の所得の次に1問足した。版3 は廃止（0155）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approveAll, createHearingSheet, exportAnswers, importAnswers, importHearingSheet, type Answer, type FilledSheet } from "../src/index.ts";
import { itemByKey } from "../src/definition.ts";
import { formatValue } from "../src/values.ts";
import { engineAvailable, full3, full4, full5, HEARING_DIR, idSeq, OFFICE, preview } from "./helpers.ts";
import { sampleBytes, type SampleFile } from "./sample.ts";

const def = full4();
const items = itemByKey(def);
const KEY = "hs.income.taxReturn";
const M = { format: "fprise-lifeplan-hearing" as const, formatVersion: "0.1", sheetId: "full", sheetVersion: 4, requestId: "R-ABCDEF", customerNo: "", layoutDigest: "0".repeat(64), appVersion: "0.1.0", exportedOn: "2026-11-07" };

function a(key: string, value: string | number | "unknown" | "notApplicable", index?: number): Answer {
  const at = { key, ...(index !== undefined ? { index } : {}) };
  if (value === "unknown" || value === "notApplicable") return { ...at, status: value };
  const f = formatValue(items.get(key) as NonNullable<ReturnType<typeof items.get>>, value);
  return { ...at, status: "value", raw: f.raw, ...(f.raw2 !== undefined ? { raw2: f.raw2 } : {}) };
}
const sheet = (...answers: Answer[]): FilledSheet => ({ management: M, answers });
const run = (...answers: Answer[]) => importAnswers(def, sheet(...answers), { baseMonth: "2026-10", newId: idSeq("taxReturn") });
const base = [a("hs.meta.filledOn", "2026-10"), a("hs.family.adult.birthYearMonth", "1980-05", 1), a("hs.family.adult.sex", "male", 1), a("hs.family.adult.birthYearMonth", "notApplicable", 2), a("hs.housing.type", "family")];
const self = [a("hs.work.type", "selfEmployed", 1), a("hs.income.business", 4000000, 1)];

describe("詳細版 full 版4 のシート定義", () => {
  it("版3 の項目をそのまま残し、事業の所得の次に確定申告の仕方を足した。版3 は廃止", () => {
    const v3 = full3().items.map((i) => i.key);
    const v4 = def.items.map((i) => i.key);
    expect(v4.filter((k) => k !== KEY)).toEqual(v3);
    expect(v4.indexOf(KEY)).toBe(v4.indexOf("hs.income.business") + 1);
    expect(items.get(KEY)).toMatchObject({ type: "choice", addedIn: 4, retiredIn: null, inputItems: ["member.taxReturn"] });
    expect(items.get(KEY)?.choices?.map((c) => c.value)).toEqual(["blueElectronic", "blueDoubleEntry", "blueSimple", "white"]);
    expect(full3().status).toBe("retired");
    // 版4 も、持ち家の方の家を買った年月・値段を足した版5 で廃止（0176 の追記 2026-11-09）
    expect(def.status).toBe("retired");
    const work = def.sections.find((s) => s.id === "work")!.groups[0]!.items;
    expect(work.indexOf(KEY)).toBe(work.indexOf("hs.income.business") + 1);
  });
});

describe("取り込み", () => {
  it("答えの4つが申告の仕方と青色申告特別控除の区分になる（本人の構成員の欄）", () => {
    const want = { blueElectronic: { method: "blue", blueDeduction: "electronic" }, blueDoubleEntry: { method: "blue", blueDeduction: "doubleEntry" }, blueSimple: { method: "blue", blueDeduction: "simple" }, white: { method: "white" } };
    for (const [answer, tr] of Object.entries(want)) {
      const r = run(...base, ...self, a(KEY, answer, 1));
      const m = r.request.input.household.members.find((x) => x.kind === "self")!;
      expect(m.taxReturn, answer).toEqual(tr);
      expect(r.issues.filter((i) => i.message.includes("確定申告")).map((i) => i.message), answer).toEqual([]);
    }
  });

  it("空欄・わからない・該当なしは入れない（入力の画面で白色の推定）", () => {
    for (const ans of [[], [a(KEY, "unknown", 1)], [a(KEY, "notApplicable", 1)]]) {
      const r = run(...base, ...self, ...ans);
      expect(r.request.input.household.members.find((x) => x.kind === "self")!.taxReturn).toBeUndefined();
    }
  });

  it("働き方が自営業でない人の答えは取り込まずに知らせる", () => {
    const r = run(...base, a("hs.work.type", "regular", 1), a("hs.income.salary", 5000000, 1), a(KEY, "blueElectronic", 1));
    expect(r.request.input.household.members.find((x) => x.kind === "self")!.taxReturn).toBeUndefined();
    expect(r.issues.some((i) => i.code === "H_CONTRADICTION" && i.message.includes("確定申告の仕方"))).toBe(true);
  });

  it("前回の値の書き出し（見直し）: 入れてある自営業の方だけ記入し、取り込み直すと同じ値", () => {
    const r = run(...base, ...self, a(KEY, "blueDoubleEntry", 1));
    const ex = exportAnswers(def, r.request, { assumed: r.assumed }).answers;
    expect(ex.find((x) => x.key === KEY && x.index === 1)).toMatchObject({ status: "value" });
    const back = importAnswers(def, sheet(...ex), { baseMonth: "2026-10", newId: idSeq("again") });
    expect(back.request.input.household.members.find((x) => x.kind === "self")!.taxReturn).toEqual({ method: "blue", blueDeduction: "doubleEntry" });
    const none = run(...base, ...self);
    expect(exportAnswers(def, none.request, { assumed: none.assumed }).answers.find((x) => x.key === KEY && x.index === 1)?.status ?? "blank").toBe("blank");
  });
});

describe("見本のシート full-4", () => {
  const NAME = "full-4-sample";
  const json = JSON.parse(readFileSync(join(HEARING_DIR, "samples", `${NAME}.json`), "utf8")) as SampleFile;
  const xlsx = new Uint8Array(readFileSync(join(HEARING_DIR, "samples", `${NAME}.xlsx`)));

  it("リポジトリの .xlsx は、記入例の JSON から作り直したものと同じ（npm run sample）", async () => {
    expect(Buffer.compare(Buffer.from(await sampleBytes(`${NAME}.json`, json)), Buffer.from(xlsx))).toBe(0);
  });

  it("取り込むと、エラーなしで配偶者の方が青色申告（65万円）の自営業になり、計算エンジンで計算できる。前回の値を記入して書き出すと同じ回答", async () => {
    const r = await importHearingSheet(xlsx, { baseMonth: "2026-10", newId: idSeq("sample-full4") });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(`${r.definition.sheetId}-${r.definition.version}`).toBe("full-4");
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    const h = r.request.input.household;
    const spouse = h.members.find((m) => m.kind === "spouse")!;
    expect(spouse.taxReturn).toEqual({ method: "blue", blueDeduction: "electronic" });
    expect(h.employmentPeriods.find((p) => p.member === spouse.id)?.type).toBe("selfEmployed");
    if (engineAvailable()) {
      const out = preview(approveAll(r, "2026-11-07T10:00:00+09:00"));
      expect(out.error, JSON.stringify(out.error)).toBeUndefined();
    }
    // 前回の値の記入は、書き出せる今の版（版5）で
    const s = await createHearingSheet({ definition: full5(), household: { request: r.request, assumed: r.assumed }, requestId: "R-7K3P9Q", customerNo: "A0042", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-11-07" });
    const back = await importHearingSheet(s.bytes, { baseMonth: "2026-10", requests: [s.request], newId: idSeq("again") });
    if (!back.ok) throw new Error(JSON.stringify(back.issues));
    expect(exportAnswers(full5(), back.request, { assumed: back.assumed }).answers).toEqual(s.filled.answers);
    expect(s.filled.answers.find((x) => x.key === KEY && x.index === 2)).toMatchObject({ status: "value" });
  });
});
