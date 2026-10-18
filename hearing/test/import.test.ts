// 取り込み: 不足・矛盾・読めない値の検出、推定の印（入力の画面の推定の印と同じ考え方）、候補・同意・メモ・取り込み保留
import { describe, expect, it } from "vitest";
import { approveAll, importAnswers, type Answer, type FilledSheet } from "../src/index.ts";
import { formatValue } from "../src/values.ts";
import { itemByKey } from "../src/definition.ts";
import { basic, engineAvailable, idSeq, preview } from "./helpers.ts";

const def = basic();
const items = itemByKey(def);
const M = { format: "fprise-lifeplan-hearing" as const, formatVersion: "0.1", sheetId: "basic", sheetVersion: 1, requestId: "R-ABCDEF", customerNo: "", layoutDigest: "0".repeat(64), appVersion: "0.1.0", exportedOn: "2026-10-01" };

/** 値（取り込んだ後の形）から回答を作る */
function a(key: string, value: string | number | "unknown" | "notApplicable", index?: number): Answer {
  const at = { key, ...(index !== undefined ? { index } : {}) };
  if (value === "unknown" || value === "notApplicable") return { ...at, status: value };
  const f = formatValue(items.get(key) as NonNullable<ReturnType<typeof items.get>>, value);
  return { ...at, status: "value", raw: f.raw, ...(f.raw2 !== undefined ? { raw2: f.raw2 } : {}) };
}
const sheet = (...answers: Answer[]): FilledSheet => ({ management: M, answers });
const run = (...answers: Answer[]) => importAnswers(def, sheet(...answers), { baseMonth: "2026-10", newId: idSeq("import") });
const codes = (r: ReturnType<typeof run>) => r.issues.map((i) => `${i.code}:${i.key ?? ""}${i.index !== undefined ? `#${i.index}` : ""}`);

const minimal = [a("hs.meta.filledOn", "2026-10"), a("hs.family.adult.birthYearMonth", "1985-04", 1), a("hs.family.adult.sex", "female", 1), a("hs.family.adult.birthYearMonth", "notApplicable", 2), a("hs.housing.type", "family")];

describe("取り込み", () => {
  it("最小限の記入（ひとり・実家）でも計算できる世帯になる。生活費は統計の目安で補い、推定の印を付ける", () => {
    const r = run(...minimal, a("hs.work.type", "regular", 1), a("hs.income.salary", 4500000, 1), a("hs.income.bonus", 900000, 1));
    const h = r.request.input.household;
    expect(h.members.map((m) => m.kind)).toEqual(["self"]);
    expect(h.livingExpenses?.[0]?.monthly).toMatchObject({ state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic" } });
    expect(h.employmentPeriods[0]?.salary).toMatchObject({ annual: { value: 3600000, state: "confirmed", origin: { kind: "hearing", ref: "R-ABCDEF" } }, bonus: { value: 900000 } });
    // 標準報酬月額は聞かないので、年収からの目安（入力の画面と同じ）
    expect(h.employmentPeriods[0]?.standardMonthlyRemuneration?.health).toMatchObject({ value: 300000, state: "estimated" });
    // 値の箱を持たない欄の仮の値は assumed（入力の画面の欄のキー）
    const pid = h.employmentPeriods[0]?.id as string;
    expect(Object.keys(r.assumed).sort()).toEqual([`work/period/${pid}/branch`, `work/period/${pid}/from`, `work/period/${pid}/hi`, `work/period/${pid}/hours`, `work/period/${pid}/size`].sort());
    // 決済口座の預金が無いので、0円の預金を推定で置く
    expect(h.accounts[0]).toMatchObject({ kind: "deposit", marketValue: { value: 0, state: "estimated" } });
    // 承認する前の世帯は計算エンジンが受け付けず（外から来た値は承認の記録が要る。0008 の2）、承認すると計算できる
    if (engineAvailable()) {
      expect(preview(r.request).error).toMatchObject({ code: "E_INPUT_SCHEMA" });
      const approved = approveAll(r, "2026-10-17T10:00:00+09:00");
      expect(approved.input.household.employmentPeriods[0]?.salary?.annual.approval).toEqual({ by: "fp", at: "2026-10-17T10:00:00+09:00", candidate: r.candidates.find((c) => c.collection === "employmentPeriods")?.id });
      expect(preview(approved).error).toBeUndefined();
    }
  });

  it("「わからない」は値の状態 unknown（代わりの値つき）にして、面談のチェックリストに載せる", () => {
    const r = run(...minimal, a("hs.work.type", "regular", 1), a("hs.income.salary", "unknown", 1), a("hs.expense.living", "unknown"));
    const p = r.request.input.household.employmentPeriods[0];
    expect(p?.salary?.annual).toMatchObject({ state: "unknown", origin: { kind: "hearing" }, substitute: { state: "estimated", value: 3300000 } });
    expect(r.request.input.household.livingExpenses?.[0]?.monthly).toMatchObject({ state: "unknown", substitute: { value: 140000 } });
    expect(r.checklist.filter((c) => c.reason === "unknown").map((c) => c.key)).toEqual(["hs.income.salary", "hs.expense.living"]);
    expect(r.checklist.find((c) => c.key === "hs.income.salary")?.label).toBe("ご本人 給与の年収（賞与を含む）");
  });

  it("賞与が空欄なら、年収を統計の割合で分けて推定の印を付ける", () => {
    const r = run(...minimal, a("hs.work.type", "regular", 1), a("hs.income.salary", 5000000, 1));
    const s = r.request.input.household.employmentPeriods[0]?.salary;
    expect(s?.bonus).toMatchObject({ state: "estimated", estimate: { method: "derived" } });
    expect((s?.annual.value ?? 0) + (s?.bonus.value ?? 0)).toBe(5000000);
    expect(r.candidates.find((c) => c.collection === "employmentPeriods")?.fields.find((f) => f.key === "hs.income.bonus")?.state).toBe("estimated");
  });

  it("ご本人の生年月が無ければ不足として知らせ、仮の値で補う", () => {
    const r = run(a("hs.housing.type", "family"));
    expect(codes(r)).toContain("H_MISSING:hs.family.adult.birthYearMonth#1");
    const self = r.request.input.household.members[0];
    expect(r.assumed[`family/${self?.id}/birth`]).toBe("仮の値（40歳として計算）");
    expect(r.issues.find((i) => i.key === "hs.family.adult.birthYearMonth")?.level).toBe("error");
  });

  it("矛盾を見つける: 賞与が年収より多い・配偶者が該当なしなのに配偶者の欄がある・いない子の保険・ローンの残高が借入額より多い", () => {
    const r = run(
      ...minimal,
      a("hs.work.type", "regular", 1),
      a("hs.income.salary", 3000000, 1),
      a("hs.income.bonus", 4000000, 1),
      a("hs.work.type", "partTime", 2),
      a("hs.insurance.type", "insurance.medical", 1),
      a("hs.insurance.premium", 3000, 1),
      a("hs.insurance.insured", "child.2", 1),
      a("hs.loan.debtor", "adult.1", 1),
      a("hs.loan.principal", 30000000, 1),
      a("hs.loan.start", "2020-04", 1),
      a("hs.loan.termYears", 35, 1),
      a("hs.loan.rate", "0.005", 1),
      a("hs.loan.balance", 40000000, 1),
    );
    expect(codes(r)).toEqual(
      expect.arrayContaining([
        "H_CONTRADICTION:hs.income.bonus#1",
        "H_CONTRADICTION:hs.family.adult.birthYearMonth#2",
        "H_CONTRADICTION:hs.insurance.insured#1",
        "H_CONTRADICTION:hs.loan.balance#1",
        "H_CONTRADICTION:hs.housing.type",
      ]),
    );
    // 配偶者は作らない
    expect(r.request.input.household.members.map((m) => m.kind)).toEqual(["self"]);
    expect(r.checklist.some((c) => c.reason === "contradiction")).toBe(true);
  });

  it("読めない値は取り込まずに知らせる。選べない状態は空欄として扱う", () => {
    const bad: Answer = { key: "hs.income.salary", index: 1, status: "value", raw: { kind: "text", text: "わかりません" } };
    const r = run(...minimal, a("hs.work.type", "regular", 1), bad, { key: "hs.housing.since", status: "notApplicable" });
    expect(codes(r)).toEqual(expect.arrayContaining(["H_INVALID_VALUE:hs.income.salary#1", "H_STATE_NOT_ALLOWED:hs.housing.since"]));
    expect(r.checklist.find((c) => c.key === "hs.income.salary")?.reason).toBe("invalid");
  });

  it("住宅ローンの必須の欄が足りなければ、そのローンは取り込まない", () => {
    const r = run(...minimal, a("hs.loan.debtor", "adult.1", 1), a("hs.loan.principal", 30000000, 1));
    expect(r.request.input.household.debts ?? []).toEqual([]);
    expect(r.issues.find((i) => i.key === "hs.loan.debtor")?.message).toContain("借りた年月・返済期間・金利");
  });

  it("要確認の欄（名前の定義と位置の食い違いなど）を含む物の候補は needsReview", () => {
    const rev: Answer = { ...a("hs.income.salary", 5000000, 1), review: ["名前の定義の位置が、シート定義の位置と違います"] };
    const r = run(...minimal, a("hs.work.type", "regular", 1), rev);
    expect(r.candidates.find((c) => c.collection === "employmentPeriods")?.status).toBe("needsReview");
    expect(r.candidates.find((c) => c.collection === "members")?.status).toBe("pending");
    expect(r.checklist.find((c) => c.reason === "review")?.key).toBe("hs.income.salary");
  });

  it("同意の欄は同意の記録の下書きに、自由記述はメモに。空欄の同意は記録にしない（0014）", () => {
    const r = run(...minimal, a("hs.consent.purpose", "given"), a("hs.consent.externalAi", "refused"), a("hs.consult.topics", "老後が不安"));
    expect(r.consents).toEqual([
      { kind: "purpose", decision: "given", method: "hearingSheet", hearingRef: { requestId: "R-ABCDEF", sheetId: "basic", sheetVersion: 1 } },
      { kind: "externalAi", decision: "refused", method: "hearingSheet", hearingRef: { requestId: "R-ABCDEF", sheetId: "basic", sheetVersion: 1 } },
    ]);
    expect(r.memo).toEqual(["【ご相談したいこと・気になっていること】老後が不安"]);
  });

  it("知らない項目キー・拡張の項目は取り込み保留にする（捨てない）", () => {
    const ext: Answer = { key: "ext.exampleOffice.carCount", status: "value", raw: { kind: "number", text: "2" } };
    const r = run(...minimal, ext);
    expect(r.pending).toEqual([ext]);
    expect(codes(r)).toContain("H_UNKNOWN_KEY:ext.exampleOffice.carCount");
  });

  it("出産予定の子は expected・joins にし、性別は仮の値", () => {
    const r = run(...minimal, a("hs.family.child.birthYearMonth", "2027-03", 1));
    const child = r.request.input.household.members.find((m) => m.kind === "child");
    expect(child).toMatchObject({ expected: true, joins: { at: "2027-03" } });
    expect(r.assumed[`family/${child?.id}/sex`]).toBe("仮の値（出産予定）");
  });

  it("取り込みの記録の下書きに、依頼番号・シートの版・元の回答を残す（0011 の imports）", () => {
    const answers = [...minimal];
    const r = run(...answers);
    expect(r.record).toEqual({ kind: "hearing", requestId: "R-ABCDEF", sheetId: "basic", sheetVersion: 1, layoutDigest: M.layoutDigest, exportedOn: "2026-10-01", answers });
  });
});
