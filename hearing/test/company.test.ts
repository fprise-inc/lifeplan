// 詳細版 full 版2: 会社役員の方の会社とのお金（自社株の出資額・会社への貸付金・会社からの借入金・連帯保証の額。0105）。
// 版1 に項目を足した新しい版で、版1 は廃止（書き出さないが、配ったシートは今までどおり取り込める。0018 の1・7）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approveAll, createHearingSheet, exportAnswers, importAnswers, importHearingSheet, type Answer, type FilledSheet } from "../src/index.ts";
import { itemByKey } from "../src/definition.ts";
import { formatValue } from "../src/values.ts";
import { engineAvailable, full, full2, full3, full4, HEARING_DIR, idSeq, modelHousehold, OFFICE, preview } from "./helpers.ts";
import { sampleAnswers, sampleBytes, type SampleFile } from "./sample.ts";

const def = full2();
const items = itemByKey(def);
const NEW_KEYS = ["hs.company.shares", "hs.company.loanToCompany", "hs.company.loanFromCompany", "hs.company.loanFromCompanyMonthly", "hs.company.guarantee"];
const M = { format: "fprise-lifeplan-hearing" as const, formatVersion: "0.1", sheetId: "full", sheetVersion: 2, requestId: "R-ABCDEF", customerNo: "", layoutDigest: "0".repeat(64), appVersion: "0.1.0", exportedOn: "2026-11-01" };

function a(key: string, value: string | number | "unknown" | "notApplicable", index?: number): Answer {
  const at = { key, ...(index !== undefined ? { index } : {}) };
  if (value === "unknown" || value === "notApplicable") return { ...at, status: value };
  const f = formatValue(items.get(key) as NonNullable<ReturnType<typeof items.get>>, value);
  return { ...at, status: "value", raw: f.raw, ...(f.raw2 !== undefined ? { raw2: f.raw2 } : {}) };
}
const sheet = (...answers: Answer[]): FilledSheet => ({ management: M, answers });
const run = (...answers: Answer[]) => importAnswers(def, sheet(...answers), { baseMonth: "2026-10", newId: idSeq("company") });
const base = [a("hs.meta.filledOn", "2026-10"), a("hs.family.adult.birthYearMonth", "1975-05", 1), a("hs.family.adult.sex", "male", 1), a("hs.family.adult.birthYearMonth", "notApplicable", 2), a("hs.work.type", "executive", 1), a("hs.housing.type", "family")];

describe("詳細版 full 版2 のシート定義", () => {
  it("版1 の項目をそのまま残し（キーは変えない）、会社とのお金の5項目を新しいキーで足した。版1 は廃止", () => {
    const v1 = full().items.map((i) => i.key);
    const v2 = def.items.map((i) => i.key);
    expect(v2.filter((k) => !NEW_KEYS.includes(k))).toEqual(v1);
    for (const k of NEW_KEYS) expect(items.get(k), k).toMatchObject({ addedIn: 2, retiredIn: null, states: ["unknown", "notApplicable"] });
    expect(full().status).toBe("retired");
    // 版2 は版3（ご両親などの欄を足した）で廃止。版2 の項目は版3 にそのまま残る
    expect(def.status).toBe("retired");
    for (const k of v2) expect(full3().items.some((i) => i.key === k), k).toBe(true);
    // お仕事と収入の欄（ご本人・配偶者の方ごと）の最後、退職金の見込み額の後ろ
    const work = def.sections.find((s) => s.id === "work")?.groups.find((g) => g.id === "work");
    expect(work?.axis).toBe("adult");
    expect(work?.items.slice(-6)).toEqual(["hs.retirement.lumpSum", ...NEW_KEYS]);
  });

  it("金額は万円で一度きり（返済額だけ円・月額）。自社株の手引きは時価でなく出資額。会社役員の方だけと書く", () => {
    for (const k of ["hs.company.shares", "hs.company.loanToCompany", "hs.company.loanFromCompany", "hs.company.guarantee"]) expect(items.get(k)?.unit, k).toEqual({ scale: "manYen", basis: "once" });
    expect(items.get("hs.company.loanFromCompanyMonthly")?.unit).toEqual({ scale: "yen", basis: "monthly" });
    for (const k of NEW_KEYS) expect(items.get(k)?.guide, k).toMatch(/^会社役員の方だけ/);
    expect(items.get("hs.company.shares")?.guide).toContain("時価ではなく");
    expect(items.get("hs.company.shares")?.guide).toContain("出資額");
    expect(items.get("hs.company.guarantee")?.inputItems).toEqual(["member.companyGuarantee"]);
  });
});

describe("会社とのお金の取り込み", () => {
  it("自社株の出資額・会社への貸付金は、その方の名義のその他の資産（細目つき）", () => {
    const r = run(...base, a("hs.company.shares", 3000000, 1), a("hs.company.loanToCompany", 5000000, 1));
    const self = r.request.input.household.members[0];
    const others = r.request.input.household.accounts.filter((x) => x.kind === "otherAsset");
    expect(others).toEqual([
      { id: expect.any(String), kind: "otherAsset", subtype: "ownCompanyShares", owner: self?.id, marketValue: { value: 3000000, state: "confirmed", origin: { kind: "hearing", ref: "R-ABCDEF" } }, asOf: "2026-10", contributions: [] },
      { id: expect.any(String), kind: "otherAsset", subtype: "loanToCompany", owner: self?.id, marketValue: { value: 5000000, state: "confirmed", origin: { kind: "hearing", ref: "R-ABCDEF" } }, asOf: "2026-10", contributions: [] },
    ]);
    const cands = r.candidates.filter((c) => c.collection === "accounts" && (c.value as { kind: string }).kind === "otherAsset");
    expect(cands.map((c) => c.fields.map((f) => `${f.key}#${f.index ?? 0}:${f.item}:${f.state}`))).toEqual([["hs.company.shares#1:account.marketValue:confirmed"], ["hs.company.loanToCompany#1:account.marketValue:confirmed"]]);
  });

  it("会社からの借入金は「今の残高から」のほかのローン（細目 companyLoan）。返済額があれば利息なしとして期間を逆算する", () => {
    const r = run(...base, a("hs.company.loanFromCompany", 2000000, 1), a("hs.company.loanFromCompanyMonthly", 30000, 1));
    const self = r.request.input.household.members[0];
    const d = r.request.input.household.debts?.[0];
    expect(d).toEqual({
      id: expect.any(String),
      kind: "other",
      subtype: "companyLoan",
      debtors: [{ member: self?.id, role: "primary" }],
      principal: 2000000,
      start: { at: "2026-10" },
      balance: { value: 2000000, state: "confirmed", origin: { kind: "hearing", ref: "R-ABCDEF" } },
      balanceAsOf: "2026-10",
      rateSchedule: [{ from: { at: "2026-10" }, type: "fixed", rate: "0" }],
      repayment: { method: "equalPayment", termMonths: 67 },
    });
    expect(r.loanEntry).toEqual({ [d?.id ?? ""]: "balance" });
    expect(Object.keys(r.assumed).filter((k) => k.startsWith(`housing/debt/${d?.id ?? ""}/`)).map((k) => k.split("/").at(-1)).sort()).toEqual(["fromBalance", "rate", "term"]);
    expect(r.assumed[`housing/debt/${d?.id ?? ""}/term`]).toMatch(/^逆算（残高 2,000,000円・毎月の返済額 30,000円・利息なしとして 67か月）/);
    expect(r.assumed[`housing/debt/${d?.id ?? ""}/rate`]).toContain("利息なし");
    const c = r.candidates.find((x) => x.collection === "debts");
    expect(c?.note).toContain("今の残高から");
    // 負債に入るのは借入金だけ（連帯保証は負債にしない）
    expect(r.request.input.household.debts).toHaveLength(1);
  });

  it("返済額が無ければ5年で返すとみなす（仮）。返済額だけで残高が無ければ取り込まずに知らせる", () => {
    const r = run(...base, a("hs.company.loanFromCompany", 1200000, 1));
    const d = r.request.input.household.debts?.[0];
    expect(d?.repayment.termMonths).toBe(60);
    expect(r.assumed[`housing/debt/${d?.id ?? ""}/term`]).toContain("5年");
    const only = run(...base, a("hs.company.loanFromCompanyMonthly", 30000, 1));
    expect(only.request.input.household.debts ?? []).toEqual([]);
    expect(only.issues.some((i) => i.code === "H_MISSING" && i.key === "hs.company.loanFromCompany")).toBe(true);
  });

  it("連帯保証の額は構成員の欄（値の箱）。負債には入れない。わからない・該当なしも状態で入れる", () => {
    const r = run(...base.slice(0, 3), a("hs.family.adult.birthYearMonth", "1978-02", 2), a("hs.family.adult.sex", "female", 2), ...base.slice(4), a("hs.company.guarantee", 30000000, 1), a("hs.company.guarantee", "unknown", 2));
    const [self, spouse] = r.request.input.household.members;
    expect(self?.companyGuarantee).toEqual({ value: 30000000, state: "confirmed", origin: { kind: "hearing", ref: "R-ABCDEF" } });
    expect(spouse?.companyGuarantee).toMatchObject({ state: "unknown", origin: { kind: "hearing", ref: "R-ABCDEF" }, substitute: { value: 0, state: "estimated" } });
    expect(r.request.input.household.debts ?? []).toEqual([]);
    const fs = r.candidates.filter((c) => c.collection === "members").flatMap((c) => c.fields.filter((f) => f.key === "hs.company.guarantee").map((f) => `${f.index ?? 0}:${f.path}:${f.state}`));
    expect(fs).toEqual(["1:/companyGuarantee:confirmed", "2:/companyGuarantee:unknown"]);
    expect(r.checklist.filter((c) => c.reason === "unknown").map((c) => c.label)).toContain("配偶者の方 会社の借入の連帯保証の額");
    // わからないは代わりの値（0円）つきで、計算エンジンが受け付ける
    if (engineAvailable()) expect(preview(approveAll(r, "2026-11-01T10:00:00+09:00")).error).toBeUndefined();
    const na = run(...base, a("hs.company.guarantee", "notApplicable", 1));
    expect(na.request.input.household.members[0]?.companyGuarantee).toEqual({ state: "notApplicable", origin: { kind: "hearing", ref: "R-ABCDEF" } });
  });

  it("自社株の出資額が「わからない」なら、0円の推定（根拠に「わからない」）。該当なしは器を作らない", () => {
    const r = run(...base, a("hs.company.shares", "unknown", 1), a("hs.company.loanToCompany", "notApplicable", 1));
    const others = r.request.input.household.accounts.filter((x) => x.kind === "otherAsset");
    expect(others).toHaveLength(1);
    expect(others[0]).toMatchObject({ subtype: "ownCompanyShares", marketValue: { value: 0, state: "estimated" } });
    expect(others[0]?.marketValue.estimate?.basis).toContain("出資額がわからない");
  });
});

describe("見本のシート full-2", () => {
  const NAME = "full-2-sample";
  const json = JSON.parse(readFileSync(join(HEARING_DIR, "samples", `${NAME}.json`), "utf8")) as SampleFile;
  const xlsx = new Uint8Array(readFileSync(join(HEARING_DIR, "samples", `${NAME}.xlsx`)));

  it("リポジトリの .xlsx は、記入例の JSON から作り直したものと同じ（npm run sample）", async () => {
    expect(Buffer.compare(Buffer.from(await sampleBytes(`${NAME}.json`, json)), Buffer.from(xlsx))).toBe(0);
  });

  it("取り込むと、エラーなしで会社役員のご本人の会社とのお金が入る。計算エンジンで計算できる", async () => {
    const r = await importHearingSheet(xlsx, { baseMonth: "2026-10", newId: idSeq("sample-full2") });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(`${r.definition.sheetId}-${r.definition.version}`).toBe("full-2");
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    const h = r.request.input.household;
    const [self, spouse] = h.members;
    expect(h.employmentPeriods[0]).toMatchObject({ member: self?.id, type: "executive" });
    expect(h.accounts.filter((x) => x.kind === "otherAsset").map((x) => `${x.subtype ?? ""}:${x.owner === self?.id ? "self" : "?"}:${x.marketValue.value ?? ""}`)).toEqual(["ownCompanyShares:self:3000000", "loanToCompany:self:5000000"]);
    const loans = (h.debts ?? []).filter((d) => d.subtype === "companyLoan");
    expect(loans).toHaveLength(1);
    expect(loans[0]).toMatchObject({ kind: "other", debtors: [{ member: self?.id, role: "primary" }], balance: { value: 2000000, state: "confirmed" }, repayment: { termMonths: 40 } });
    expect(self?.companyGuarantee).toMatchObject({ value: 30000000, state: "confirmed" });
    expect(spouse?.companyGuarantee).toMatchObject({ state: "notApplicable" });
    if (engineAvailable()) {
      const out = preview(approveAll(r, "2026-11-01T10:00:00+09:00"));
      expect(out.error, JSON.stringify(out.error)).toBeUndefined();
    }
  });

  it("取り込んだ世帯から前回の値を記入して書き出すと、会社とのお金の欄が同じ値になる（見直し）", async () => {
    const r = await importHearingSheet(xlsx, { baseMonth: "2026-10", newId: idSeq("sample-full2") });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const ex = exportAnswers(def, r.request, { assumed: r.assumed });
    const pick = (list: readonly Answer[]) => list.filter((x) => NEW_KEYS.includes(x.key) && x.status !== "blank");
    const want = pick(sampleAnswers(def, json));
    expect(pick(ex.answers).sort((x, y) => `${x.key}#${x.index ?? 0}`.localeCompare(`${y.key}#${y.index ?? 0}`))).toEqual(want.sort((x, y) => `${x.key}#${x.index ?? 0}`.localeCompare(`${y.key}#${y.index ?? 0}`)));

    // .xlsx の往復（今の版の詳細版で）: 書き出し → 取り込み → 書き出しで同じ回答
    const s = await createHearingSheet({ definition: full4(), household: { request: r.request, assumed: r.assumed }, requestId: "R-7K3P9Q", customerNo: "A0042", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-11-01" });
    const back = await importHearingSheet(s.bytes, { baseMonth: "2026-10", requests: [s.request], newId: idSeq("again") });
    if (!back.ok) throw new Error(JSON.stringify(back.issues));
    expect(exportAnswers(full4(), back.request, { assumed: back.assumed }).answers).toEqual(s.filled.answers);
  });

  it("返済期間を仮の値（返済額が無いので5年）で置いた借入金は、毎月の返済額を書かない", () => {
    const r = run(...base, a("hs.company.loanFromCompany", 1200000, 1));
    const ex = exportAnswers(def, r.request, { assumed: r.assumed });
    expect(ex.answers.find((x) => x.key === "hs.company.loanFromCompany" && x.index === 1)?.status).toBe("value");
    expect(ex.answers.find((x) => x.key === "hs.company.loanFromCompanyMonthly" && x.index === 1)?.status).toBe("blank");
  });
});

describe("full 版1 のシート（廃止）", () => {
  it("配った版1 の見本は今までどおり版1 の定義で読め、会社とのお金の物は作らない", async () => {
    const xlsx = new Uint8Array(readFileSync(join(HEARING_DIR, "samples", "full-1-sample.xlsx")));
    const r = await importHearingSheet(xlsx, { baseMonth: "2026-10", newId: idSeq("full1") });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(`${r.definition.sheetId}-${r.definition.version}`).toBe("full-1");
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    const h = r.request.input.household;
    expect(h.accounts.some((x) => x.kind === "otherAsset")).toBe(false);
    expect((h.debts ?? []).some((d) => d.subtype === "companyLoan")).toBe(false);
    expect(h.members.some((m) => m.companyGuarantee !== undefined)).toBe(false);
  });

  it("版1 は書き出さない。版1 の定義で回答を作っても、会社とのお金の欄が無いので書かない", async () => {
    await expect(createHearingSheet({ definition: full(), requestId: "R-ABCDEF", customerNo: "", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-11-01" })).rejects.toThrow("廃止");
    const r = run(...base, a("hs.company.shares", 3000000, 1), a("hs.company.loanFromCompany", 2000000, 1), a("hs.company.guarantee", 30000000, 1));
    const ex = exportAnswers(full(), r.request, { assumed: r.assumed });
    expect(ex.answers.some((x) => x.key.startsWith("hs.company."))).toBe(false);
  });

  it("会社とのお金の無いモデル世帯は、版2 でもその欄が空欄", () => {
    const ex = exportAnswers(def, modelHousehold("salariedCoupleTwoKids"));
    expect(ex.answers.filter((x) => x.key.startsWith("hs.company.")).every((x) => x.status === "blank")).toBe(true);
  });
});
