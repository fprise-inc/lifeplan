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
    // 標準報酬月額は聞かず、書かない（空欄なら計算エンジンが給与から毎年決め直す。入力の画面と同じ）
    expect(h.employmentPeriods[0]?.standardMonthlyRemuneration).toBeUndefined();
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

  it("書類で確かめる欄でない項目の「わからない」は推定にして、面談のチェックリストに載せる（年収・基本生活費）", () => {
    const r = run(...minimal, a("hs.work.type", "regular", 1), a("hs.income.salary", "unknown", 1), a("hs.expense.living", "unknown"));
    const p = r.request.input.household.employmentPeriods[0];
    // 年収は書類で確かめる欄でない（0041 の追記 2026-10-31）: 統計の目安の推定にし、根拠に「ヒアリングで『わからない』」と書く
    expect(p?.salary?.annual).toMatchObject({ state: "estimated", value: 4979000, origin: { kind: "auto" }, estimate: { method: "statistic" } });
    expect((p?.salary?.annual as { estimate?: { basis?: string } } | undefined)?.estimate?.basis?.startsWith("ヒアリングで「わからない」。")).toBe(true);
    expect(r.candidates.find((c) => c.collection === "employmentPeriods")?.fields.find((f) => f.key === "hs.income.salary")?.state).toBe("estimated");
    // 基本生活費は「わからない」を持たない（0100）: 統計の目安の推定にし、根拠に「ヒアリングで『わからない』」と書く（チェックリストには載る）
    const living = r.request.input.household.livingExpenses?.[0]?.monthly;
    expect(living).toMatchObject({ state: "estimated", value: 140000, origin: { kind: "auto" }, estimate: { method: "statistic" } });
    expect((living as { estimate?: { basis?: string } } | undefined)?.estimate?.basis?.startsWith("ヒアリングで「わからない」。")).toBe(true);
    expect(r.candidates.find((c) => c.collection === "livingExpenses")?.fields.find((f) => f.key === "hs.expense.living")?.state).toBe("estimated");
    expect(r.checklist.filter((c) => c.reason === "unknown").map((c) => c.key)).toEqual(["hs.income.salary", "hs.expense.living"]);
    expect(r.checklist.find((c) => c.key === "hs.income.salary")).toMatchObject({ label: "ご本人 給与の年収（賞与を含む）", message: "わからない" });
    // どこにも unknown の値の箱が残らない
    expect(JSON.stringify(r.request)).not.toContain('"state":"unknown"');
  });

  it("書類で確かめる欄（住民税・退職金・年金の加入月数）の「わからない」は書類待ち（unknown）で取り込み、チェックリストに書類を添える", () => {
    const r = run(
      ...minimal,
      a("hs.work.type", "regular", 1),
      a("hs.work.since", "2008-04", 1),
      a("hs.income.salary", 5000000, 1),
      a("hs.income.bonus", 1000000, 1),
      a("hs.income.residentTax", "unknown", 1),
      a("hs.retirement.lumpSum", "unknown", 1),
      a("hs.pension.notice.type", "statementUnder50", 1),
      a("hs.pension.notice.asOf", "2026-06", 1),
      a("hs.pension.months.total", "unknown", 1),
      a("hs.pension.amount.basic", 700000, 1),
      a("hs.pension.amount.employee", 900000, 1),
    );
    const h = r.request.input.household;
    expect(h.residentTaxAssessments?.[0]?.amount).toMatchObject({ state: "unknown", origin: { kind: "hearing" }, substitute: { state: "estimated" } });
    // 退職金: 会社員の退職一時金の目安を代わりの値にした書類待ち
    const rb = h.retirementBenefits?.[0];
    expect(rb).toMatchObject({ kind: "lumpSum", amount: { state: "unknown", origin: { kind: "hearing" }, substitute: { state: "estimated", estimate: { method: "statistic" } } } });
    expect((rb?.amount as { substitute?: { value?: number } } | undefined)?.substitute?.value).toBeGreaterThan(0);
    // 年金の加入月数: 20歳の月（2005-04）から書類の作成年月（2026-06）まで＝255か月、厚生年金は働き方の期間（2008-04〜2026-06）＝219か月
    const rec = h.pensionRecords?.[0];
    expect(rec?.months).toEqual({ basic: 255, employee: 219 });
    const rows = (rec as { valueStates?: Record<string, { state: string }> } | undefined)?.valueStates ?? {};
    expect(rows["pensionRecord.months/basic"]).toMatchObject({ state: "unknown", origin: { kind: "hearing" } });
    expect(rows["pensionRecord.months/employee"]).toMatchObject({ state: "unknown" });
    const msgs = Object.fromEntries(r.checklist.filter((c) => c.reason === "unknown").map((c) => [c.key, c.message]));
    expect(msgs).toEqual({
      "hs.income.residentTax": "わからない（書類で確かめる: 住民税の決定通知書）",
      "hs.retirement.lumpSum": "わからない（書類で確かめる: 会社の退職金規程・制度の資料）",
      "hs.pension.months.total": "わからない（書類で確かめる: ねんきん定期便）",
    });
    // 承認すると書類待ちの行にも承認の記録が付き、計算できる
    const approved = approveAll(r, "2026-10-17T10:00:00+09:00");
    const arow = ((approved.input.household.pensionRecords?.[0] as { valueStates?: Record<string, { approval?: unknown }> } | undefined)?.valueStates ?? {})["pensionRecord.months/basic"];
    expect(arow?.approval).toBeDefined();
  });

  it("加入月数の片方だけが「わからない」なら、書類待ちの行の根拠はその片方の代わりの値だけを書く（もう片方はシートの値）", () => {
    const common = [...minimal, a("hs.work.type", "regular", 1), a("hs.work.since", "2008-04", 1), a("hs.income.salary", 5000000, 1), a("hs.pension.notice.type", "statementUnder50", 1), a("hs.pension.notice.asOf", "2026-06", 1), a("hs.pension.amount.basic", 700000, 1), a("hs.pension.amount.employee", 900000, 1)];
    const rowsOf = (r: ReturnType<typeof run>) => (r.request.input.household.pensionRecords?.[0] as { valueStates?: Record<string, { state: string; estimate?: { basis?: string } }> } | undefined)?.valueStates ?? {};
    // 厚生年金だけ「わからない」: 国民年金はシートの 250か月、厚生年金は働き方の期間（2008-04〜2026-06）の 219か月
    const empOnly = run(...common, a("hs.pension.months.total", 250, 1), a("hs.pension.months.employee", "unknown", 1));
    expect(empOnly.request.input.household.pensionRecords?.[0]?.months).toEqual({ basic: 250, employee: 219 });
    expect(Object.keys(rowsOf(empOnly))).toEqual(["pensionRecord.months/employee"]);
    expect(rowsOf(empOnly)["pensionRecord.months/employee"]?.estimate?.basis).toBe("代わりの値（厚生年金は働き方の期間の厚生年金の219か月）");
    // 合計だけ「わからない」: 厚生年金はシートの 200か月、国民年金は20歳の月（2005-04）から作成年月まで 255か月
    const totalOnly = run(...common, a("hs.pension.months.total", "unknown", 1), a("hs.pension.months.employee", 200, 1));
    expect(totalOnly.request.input.household.pensionRecords?.[0]?.months).toEqual({ basic: 255, employee: 200 });
    expect(Object.keys(rowsOf(totalOnly))).toEqual(["pensionRecord.months/basic"]);
    expect(rowsOf(totalOnly)["pensionRecord.months/basic"]?.estimate?.basis).toBe("代わりの値（国民年金は20歳の月から書類の作成年月まで〔60歳まで〕の255か月）");
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

  it("住宅ローンは、シートで聞かない住宅ローン控除の条件を仮の条件にして、控除を計算する（「仮」の印）", () => {
    const loan = (start: string) => [
      a("hs.work.type", "regular", 1),
      a("hs.income.salary", 6000000, 1),
      a("hs.income.bonus", 0, 1),
      a("hs.housing.type", "own"),
      a("hs.loan.debtor", "adult.1", 1),
      a("hs.loan.principal", 30000000, 1),
      a("hs.loan.start", start, 1),
      a("hs.loan.termYears", 35, 1),
      a("hs.loan.rate", "0.008", 1),
    ];
    const base = minimal.filter((x) => x.key !== "hs.housing.type");
    const r = run(...base, ...loan("2024-04"));
    const h = r.request.input.household;
    const d = h.debts?.[0];
    const own = h.residences?.find((x) => x.kind === "own");
    expect(d?.housing).toMatchObject({ residence: own?.id, propertyType: "energySaving", newBuild: true });
    expect(h.events).toEqual([{ id: d?.housing?.moveIn, kind: "moveIn", at: { at: "2024-04" } }]);
    expect(r.assumed[`housing/debt/${d?.id}/credit`]).toContain("仮の条件");
    const cand = r.candidates.find((c) => c.collection === "debts");
    expect(cand?.note).toContain("仮の条件で控除を計算します");
    expect(cand?.fields.find((f) => f.item === "debt.housing")?.state).toBe("assumed");
    if (engineAvailable()) {
      const tax = (req: typeof r.request) => ((preview(approveAll({ ...r, request: req }, "2026-10-17T10:00:00+09:00")).table as { row: string; year: number; amount: number }[]) ?? []).filter((c) => c.row === "cf.taxSi.incomeTax" && c.year === 2027).reduce((s, c) => s + c.amount, 0);
      const none = structuredClone(r.request);
      delete none.input.household.debts?.[0]?.housing;
      expect(tax(none) - tax(r.request)).toBeGreaterThan(100000);
    }
    // 平成25年以前に借りたローンは、控除の制度データが無いので条件を置かない
    const old = run(...base, ...loan("2013-04"));
    expect(old.request.input.household.debts?.[0]?.housing).toBeUndefined();
    expect(old.request.input.household.events).toEqual([]);
    expect(old.candidates.find((c) => c.collection === "debts")?.note).toContain("2013年以前に借りたローンの控除は計算しません");
  });

  it("2028年からの入居の住宅ローンの仮の住宅の種類は、入力の画面と同じく ZEH水準省エネ住宅（省エネ基準適合住宅は控除が無い）", () => {
    const base = minimal.filter((x) => x.key !== "hs.housing.type" && x.key !== "hs.meta.filledOn");
    const loan = [
      a("hs.meta.filledOn", "2028-10"),
      a("hs.work.type", "regular", 1),
      a("hs.income.salary", 6000000, 1),
      a("hs.income.bonus", 0, 1),
      a("hs.housing.type", "own"),
      a("hs.loan.debtor", "adult.1", 1),
      a("hs.loan.principal", 30000000, 1),
      a("hs.loan.start", "2028-04", 1),
      a("hs.loan.termYears", 35, 1),
      a("hs.loan.rate", "0.008", 1),
    ];
    const r = importAnswers(def, sheet(...base, ...loan), { baseMonth: "2028-10", newId: idSeq("import") });
    const d = r.request.input.household.debts?.[0];
    expect(d?.housing).toMatchObject({ propertyType: "zeh", newBuild: true });
    expect(r.assumed[`housing/debt/${d?.id}/credit`]).toContain("新築はZEH水準省エネ住宅");
    expect(r.candidates.find((c) => c.collection === "debts")?.note).toContain("新築のZEH水準省エネ住宅");
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

  it("出産予定の子は expected・joins にし、性別は推定・仮の印を付けない", () => {
    const r = run(...minimal, a("hs.family.child.birthYearMonth", "2027-03", 1));
    const child = r.request.input.household.members.find((m) => m.kind === "child");
    expect(child).toMatchObject({ expected: true, joins: { at: "2027-03" } });
    expect(r.assumed[`family/${child?.id}/sex`]).toBeUndefined();
    expect(Object.keys(r.assumed).some((k) => k.endsWith("/sex"))).toBe(false);
  });

  it("取り込みの記録の下書きに、依頼番号・シートの版・元の回答を残す（0011 の imports）", () => {
    const answers = [...minimal];
    const r = run(...answers);
    expect(r.record).toEqual({ kind: "hearing", requestId: "R-ABCDEF", sheetId: "basic", sheetVersion: 1, layoutDigest: M.layoutDigest, exportedOn: "2026-10-01", answers });
  });
});

describe("取り込み: 答えの無い欄の印と、Web の記入の年月（今の値を壊さないため）", () => {
  it("答えの無い欄（空欄・聞いていない）で補った値の欄には noAnswer、仮の値の欄には入力の画面のキー（uiKey）が付く。答えた欄には付かない", () => {
    const r = run(...minimal, a("hs.work.type", "regular", 1), a("hs.income.salary", 4500000, 1));
    const work = r.candidates.find((c) => c.collection === "employmentPeriods");
    const from = work?.fields.find((f) => f.path === "/from/at");
    expect(from).toMatchObject({ state: "assumed", noAnswer: true });
    expect(from?.uiKey).toBe(`work/period/${work?.target.object ?? ""}/from`);
    expect(r.assumed[from?.uiKey ?? ""]).toBeDefined();
    const salary = work?.fields.find((f) => f.path === "/salary/annual");
    expect(salary?.noAnswer).toBeUndefined();
    // 生活費は空欄 → 目安で補った値（noAnswer）
    expect(r.candidates.find((c) => c.collection === "livingExpenses")?.fields[0]).toMatchObject({ state: "estimated", noAnswer: true });
    // 本人の生年月は答えた
    expect(r.candidates.find((c) => c.collection === "members")?.fields.find((f) => f.path === "/birth/birthYearMonth")?.noAnswer).toBeUndefined();
  });

  it("定年の答えが無い働き方の期間にも、終わりの欄の記録（noAnswer）が付く。「わからない」は答え、記入があれば年月の欄（0139）", () => {
    const end = (...more: Answer[]) => r0(...more).candidates.find((c) => c.collection === "employmentPeriods")?.fields.find((f) => f.path.startsWith("/to"));
    const r0 = (...more: Answer[]) => run(...minimal, a("hs.work.type", "regular", 1), a("hs.income.salary", 4500000, 1), ...more);
    expect(end()).toMatchObject({ path: "/to", noAnswer: true });
    expect(end(a("hs.work.retireAge", "unknown", 1))).toMatchObject({ path: "/to", state: "unknown" });
    expect(end(a("hs.work.retireAge", "unknown", 1))?.noAnswer).toBeUndefined();
    expect(end(a("hs.work.retireAge", 60, 1))).toMatchObject({ path: "/to/at", state: "confirmed" });
  });

  it("「わからない」は答え（noAnswer にしない）", () => {
    const r = run(...minimal, a("hs.expense.living", "unknown"));
    expect(r.candidates.find((c) => c.collection === "livingExpenses")?.fields[0]?.noAnswer).toBeUndefined();
  });

  it("Web の答え（記入の年月は送った月）は、計算基準月より後でも1年までは知らせない。1年を超えたら知らせる。Excel は今までどおり知らせる", () => {
    const base = minimal.filter((x) => x.key !== "hs.meta.filledOn");
    const web = (filledOn: string) => importAnswers(def, sheet(a("hs.meta.filledOn", filledOn), ...base), { baseMonth: "2026-10", newId: idSeq("web"), filledOnIsSubmission: true });
    const later = (r: ReturnType<typeof run>) => r.issues.filter((i) => i.key === "hs.meta.filledOn" && i.code === "H_CONTRADICTION");
    expect(later(web("2026-11"))).toEqual([]);
    expect(web("2026-11").checklist.some((c) => c.key === "hs.meta.filledOn")).toBe(false);
    expect(later(web("2027-10"))).toEqual([]);
    expect(later(web("2027-11"))[0]?.message).toContain("1年を超えて後");
    expect(later(run(a("hs.meta.filledOn", "2026-11"), ...base))[0]?.message).toContain("記入の年月が計算基準月より後");
  });
});
