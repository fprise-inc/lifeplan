// 簡易版（basic 版2。初回の前の軽い票）: 金額の範囲の答え → 推定（範囲の真ん中・確かさ「概算」）、年齢 → 仮の生年月、
// ご家族の合計・住宅ローンの残高と返済額・ご両親の読み替え、計算に入れる先の無い保険料の合計はメモ、見本の往復、古い basic 版1 の読み込み
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approveAll, checkDefinition, createHearingSheet, exportableSheets, importAnswers, importHearingSheet, latestSheet, layoutDigest, readSheetXlsx, OFFICIAL_SHEETS, type Answer, type FilledSheet, type SheetDefinition } from "../src/index.ts";
import { itemByKey } from "../src/definition.ts";
import { birthFromAge } from "../src/import.ts";
import { formatValue, parseValue, rangeEstimate } from "../src/values.ts";
import { basic, engineAvailable, full, HEARING_DIR, idSeq, modelHousehold, OFFICE, preview, simple } from "./helpers.ts";
import { sampleBytes, type SampleFile } from "./sample.ts";
import { mortgageRateEstimate } from "../src/housingEstimates.ts";
import { monthsFromPayment } from "../src/loan.ts";

/** 簡易版の住宅ローンに置く仮の金利（変動金利の目安。マスタデータの写しから） */
const VARIABLE_RATE = mortgageRateEstimate("variable").rate;

const def = simple();
const items = itemByKey(def);
const item = (k: string) => items.get(k) as NonNullable<ReturnType<typeof items.get>>;
const M = { format: "fprise-lifeplan-hearing" as const, formatVersion: "0.1", sheetId: "basic", sheetVersion: 2, requestId: "R-ABCDEF", customerNo: "", layoutDigest: "0".repeat(64), appVersion: "0.1.0", exportedOn: "2026-10-27" };

function a(key: string, value: string | number | "unknown" | "notApplicable", index?: number): Answer {
  const at = { key, ...(index !== undefined ? { index } : {}) };
  if (value === "unknown" || value === "notApplicable") return { ...at, status: value };
  const f = formatValue(item(key), value);
  return { ...at, status: "value", raw: f.raw, ...(f.raw2 !== undefined ? { raw2: f.raw2 } : {}) };
}
const sheet = (...answers: Answer[]): FilledSheet => ({ management: M, answers });
const run = (...answers: Answer[]) => importAnswers(def, sheet(...answers), { baseMonth: "2026-10", newId: idSeq("simple") });
const base = [a("hs.meta.filledOn", "2026-10"), a("hs.family.adult.birthYearMonth", "1986-05", 1), a("hs.family.adult.sex", "male", 1), a("hs.family.adult.birthYearMonth", "notApplicable", 2), a("hs.housing.type", "family")];

describe("簡易版のシート定義", () => {
  it("書き出せるのは簡易版（basic 版2）と詳細版（full 版1）。basic 版1 は廃止（書き出さないが取り込める）", () => {
    expect(exportableSheets().map((d) => `${d.sheetId}-${d.version}`).sort()).toEqual(["basic-2", "full-1"]);
    expect(latestSheet("basic")?.version).toBe(2);
    expect(latestSheet("full")?.version).toBe(1);
    expect(basic().status).toBe("retired");
    expect(OFFICIAL_SHEETS.some((d) => d.sheetId === "basic" && d.version === 1)).toBe(true);
  });

  it("詳細版は basic 版1 と同じ項目キー（キーは変えない）", () => {
    expect(full().items.map((i) => i.key)).toEqual(basic().items.map((i) => i.key));
  });

  it("同じ意味の項目は basic 版1 のキーを使い回し、新しい意味の項目は新しいキー", () => {
    const old = new Set(basic().items.map((i) => i.key));
    const reused = def.items.filter((i) => old.has(i.key)).map((i) => i.key);
    expect(reused).toEqual([
      "hs.meta.filledOn",
      "hs.family.adult.birthYearMonth",
      "hs.family.adult.sex",
      "hs.family.child.birthYearMonth",
      "hs.work.type",
      "hs.housing.type",
      "hs.housing.rent",
      "hs.expense.living",
      "hs.plan.events",
      "hs.consult.topics",
      "hs.consent.purpose",
      "hs.consent.familyInfo",
      "hs.consent.externalAi",
    ]);
    for (const k of reused) {
      const x = basic().items.find((i) => i.key === k);
      expect({ type: item(k).type, unit: item(k).unit, choices: item(k).choices }, k).toEqual({ type: x?.type, unit: x?.unit, choices: x?.choices });
    }
  });

  it("範囲の段は下から隙間なく並び、上が開くのは最後の段だけ（崩すと checkDefinition が知らせる）", () => {
    const broken = structuredClone(def) as unknown as { items: { key: string; ranges?: { from: number; to: number | null; label: string }[] }[] };
    const r = broken.items.find((i) => i.key === "hs.income.annualRange");
    if (r?.ranges === undefined) throw new Error("範囲の項目が無い");
    r.ranges[2] = { ...(r.ranges[2] as { from: number; to: number | null; label: string }), from: 250 };
    expect(checkDefinition(broken as unknown as SheetDefinition)).toContain("範囲の段に隙間か重なりがある: hs.income.annualRange の 200〜300万円");
  });
});

describe("金額の範囲の答え", () => {
  it("段の言葉か値で読み、範囲の真ん中を推定の値にする（上が開いた段は下の端、「〜未満」は0との真ん中）", () => {
    const r = item("hs.income.annualRange");
    expect(parseValue(def, r, { kind: "text", text: "400〜500万円" })).toEqual({ ok: true, value: "4000000-5000000" });
    expect(parseValue(def, r, { kind: "text", text: "4000000-5000000" })).toEqual({ ok: true, value: "4000000-5000000" });
    expect(parseValue(def, r, { kind: "text", text: "たくさん" }).ok).toBe(false);
    expect(formatValue(r, "4000000-5000000").raw).toEqual({ kind: "text", text: "400〜500万円" });
    expect(rangeEstimate(r, "4000000-5000000")).toEqual({ value: 4500000, label: "400〜500万円", openTop: false });
    expect(rangeEstimate(r, "20000000-")).toEqual({ value: 20000000, label: "2,000万円以上", openTop: true });
    expect(rangeEstimate(r, "0-1000000")).toEqual({ value: 500000, label: "100万円未満", openTop: false });
    // 円の単位の項目も、言葉は万円で見せる
    expect(rangeEstimate(item("hs.expense.livingRange"), "250000-300000")).toEqual({ value: 275000, label: "25〜30万円", openTop: false });
  });

  it("範囲の答えは推定（確かさ「概算」・根拠は範囲の段）。確定にしない。承認すると承認の記録が付く", () => {
    const r = run(...base, a("hs.work.type", "selfEmployed", 1), a("hs.income.annualRange", "4000000-5000000", 1), a("hs.expense.livingRange", "250000-300000"));
    const h = r.request.input.household;
    expect(h.employmentPeriods[0]?.business?.income).toEqual({ value: 4500000, state: "estimated", origin: { kind: "hearing", ref: "R-ABCDEF" }, estimate: { method: "derived", basis: "ヒアリングシートの範囲 400〜500万円の真ん中" }, certainty: "rough" });
    expect(h.livingExpenses?.[0]?.monthly).toMatchObject({ value: 275000, state: "estimated", certainty: "rough", estimate: { basis: "ヒアリングシートの範囲 25〜30万円の真ん中" } });
    // 欄の記録は、値を出した範囲の項目で、推定（範囲の段つき）
    const f = r.candidates.find((c) => c.collection === "livingExpenses")?.fields[0];
    expect(f).toMatchObject({ key: "hs.expense.livingRange", state: "estimated", range: "25〜30万円" });
    const approved = approveAll(r, "2026-10-27T10:00:00+09:00");
    expect(approved.input.household.livingExpenses?.[0]?.monthly?.approval?.by).toBe("fp");
    if (engineAvailable()) expect(preview(approved).error).toBeUndefined();
  });

  it("上が開いた範囲（2,000万円以上）は下の端を推定にし、根拠に書く", () => {
    const r = run(...base, a("hs.work.type", "regular", 1), a("hs.income.annualRange", "20000000-", 1));
    const s = r.request.input.household.employmentPeriods[0]?.salary;
    expect((s?.annual.value ?? 0) + (s?.bonus.value ?? 0)).toBe(20000000);
    expect(s?.annual).toMatchObject({ state: "estimated", certainty: "rough", origin: { kind: "hearing" } });
    expect(s?.annual.estimate?.basis).toContain("2,000万円以上（上が開いた範囲なので下の端）");
  });

  it("金額と範囲の両方があれば金額を使い（確定）、範囲は使わなかったと知らせる", () => {
    const r = run(...base, a("hs.work.type", "selfEmployed", 1), a("hs.income.annual", 3800000, 1), a("hs.income.annualRange", "4000000-5000000", 1));
    expect(r.request.input.household.employmentPeriods[0]?.business?.income).toMatchObject({ value: 3800000, state: "confirmed" });
    expect(r.issues.some((i) => i.code === "H_IGNORED" && i.key === "hs.income.annualRange")).toBe(true);
  });

  it("「該当なし」と範囲の両方は矛盾にして、範囲を使わない", () => {
    const r = run(...base, a("hs.assets.depositTotal", "notApplicable"), a("hs.assets.depositTotalRange", "500000-1000000"));
    expect(r.issues.some((i) => i.code === "H_CONTRADICTION" && i.key === "hs.assets.depositTotalRange")).toBe(true);
    expect(r.request.input.household.accounts[0]?.marketValue).toMatchObject({ value: 0, state: "estimated", origin: { kind: "auto" } });
  });
});

describe("年齢で答えたとき", () => {
  it("年齢から仮の生年月（記入の年月にその年齢の真ん中）にして、仮の印を付ける", () => {
    expect(birthFromAge("2026-10", 40)).toBe("1986-04");
    expect(birthFromAge("2027-01", 0)).toBe("2026-07");
    const r = run(a("hs.meta.filledOn", "2026-10"), a("hs.family.adult.age", 40, 1), a("hs.family.adult.sex", "female", 1), a("hs.family.adult.age", 38, 2), a("hs.housing.type", "family"));
    const h = r.request.input.household;
    expect(h.members.map((m) => `${m.kind}:${m.birth.birthYearMonth}`)).toEqual(["self:1986-04", "spouse:1988-04"]);
    const [self, spouse] = h.members;
    expect(r.assumed[`family/${self?.id ?? ""}/birth`]).toContain("40歳として、1986年4月生まれで計算");
    expect(r.assumed[`family/${spouse?.id ?? ""}/birth`]).toContain("38歳");
    expect(r.candidates[0]?.fields[0]).toMatchObject({ key: "hs.family.adult.age", index: 1, state: "assumed" });
  });

  it("生年月と年齢の両方があれば生年月を使い、食い違えば矛盾として知らせる", () => {
    const r = run(...base.slice(0, 3), a("hs.family.adult.age", 30, 1), a("hs.family.adult.birthYearMonth", "notApplicable", 2), a("hs.housing.type", "family"));
    expect(r.request.input.household.members[0]?.birth.birthYearMonth).toBe("1986-05");
    expect(r.issues.some((i) => i.code === "H_CONTRADICTION" && i.key === "hs.family.adult.age")).toBe(true);
  });

  it("配偶者の方の年齢が「該当なし」なら、配偶者の方はいない", () => {
    const r = run(a("hs.meta.filledOn", "2026-10"), a("hs.family.adult.age", 40, 1), a("hs.family.adult.age", "notApplicable", 2), a("hs.housing.type", "family"));
    expect(r.request.input.household.members.map((m) => m.kind)).toEqual(["self"]);
  });
});

describe("合計の欄・住宅ローン・ご両親・メモ", () => {
  it("預貯金・投資の合計はご本人の名義の預金・課税口座（名義・口座の種類は仮）", () => {
    const r = run(...base, a("hs.assets.depositTotal", 4500000), a("hs.assets.investTotal", 3000000));
    const [dep, inv] = r.request.input.household.accounts;
    expect(dep).toMatchObject({ kind: "deposit", marketValue: { value: 4500000, state: "confirmed" } });
    expect(inv).toMatchObject({ kind: "taxable", marketValue: { value: 3000000, state: "confirmed" } });
    expect(r.assumed[`sav/${inv?.id ?? ""}/kind`]).toContain("課税口座");
    expect(r.assumed[`sav/${dep?.id ?? ""}/owner`]).toContain("ご本人の名義");
  });

  it("住宅ローンの残高と毎月の返済額から「今の残高から」の形で1本置き、仮の金利で返済期間を逆算する（控除は計算しない）", () => {
    const r = run(...base.slice(0, 4), a("hs.housing.type", "own"), a("hs.loan.monthlyTotal", 98000), a("hs.loan.balanceTotal", 29800000));
    const d = r.request.input.household.debts?.[0];
    expect(d).toMatchObject({ kind: "mortgage", principal: 29800000, start: { at: "2026-10" }, balance: { value: 29800000, state: "confirmed" }, balanceAsOf: "2026-10", rateSchedule: [{ type: "variable", rate: VARIABLE_RATE }], repayment: { method: "equalPayment", termMonths: monthsFromPayment(29800000, 98000, Number(VARIABLE_RATE)) } });
    expect(d?.housing).toBeUndefined();
    expect(r.loanEntry).toEqual({ [d?.id ?? ""]: "balance" });
    expect(Object.keys(r.assumed).filter((k) => k.startsWith(`housing/debt/${d?.id ?? ""}/`)).map((k) => k.split("/").at(-1)).sort()).toEqual(["debtor", "fromBalance", "rate", "term"]);
    if (engineAvailable()) expect(preview(approveAll(r, "2026-10-27T10:00:00+09:00")).error).toBeUndefined();
  });

  it("返済額だけなら、標準の返済期間と仮の金利で残高を逆算して推定にする", () => {
    const r = run(...base.slice(0, 4), a("hs.housing.type", "own"), a("hs.loan.monthlyTotal", 98000), a("hs.loan.balanceTotal", "unknown"));
    const d = r.request.input.household.debts?.[0];
    expect(d?.repayment.termMonths).toBe(420);
    expect(d?.balance).toMatchObject({ state: "unknown", substitute: { state: "estimated", estimate: { method: "derived" } } });
    expect(d?.balance?.substitute?.value).toBeGreaterThan(30000000);
  });

  it("ご両親は世帯の外の家族（誰の親か・性別は欄で決まる。年齢は仮の生年月・同居かは扶養と同居の欄）", () => {
    const r = run(
      ...base.slice(0, 3),
      a("hs.family.adult.birthYearMonth", "1988-09", 2),
      a("hs.housing.type", "family"),
      a("hs.family.parent.alive", "alive", 1),
      a("hs.family.parent.age", 70, 1),
      a("hs.family.parent.cohabiting", "together", 1),
      a("hs.family.parent.alive", "deceased", 2),
      a("hs.family.parent.alive", "alive", 4),
    );
    const h = r.request.input.household;
    const self = h.members.find((m) => m.kind === "self");
    const spouse = h.members.find((m) => m.kind === "spouse");
    const parents = h.members.filter((m) => m.kind === "parent");
    expect(parents.map((m) => `${m.sex}:${m.outside?.of === self?.id ? "self" : m.outside?.of === spouse?.id ? "spouse" : "?"}:${m.birth.birthYearMonth}:${String(m.support?.cohabiting)}`)).toEqual(["male:self:1956-04:true", "female:spouse:1958-04:undefined"]);
    expect(r.assumed[`family/${parents[1]?.id ?? ""}/birth`]).toBe("仮の値（配偶者の方の生年の30年前）");
    // 生活費の人数には入れない（家計が別）
    expect(h.livingExpenses?.[0]?.monthly).toMatchObject({ state: "estimated", estimate: { basis: expect.stringContaining("2人") } });
    if (engineAvailable()) expect(preview(approveAll(r, "2026-10-27T10:00:00+09:00")).error).toBeUndefined();
  });

  it("配偶者の方がいないのに配偶者の方のご両親の記入があれば、取り込まずに知らせる", () => {
    const r = run(...base, a("hs.family.parent.alive", "alive", 3));
    expect(r.request.input.household.members.some((m) => m.kind === "parent")).toBe(false);
    expect(r.issues.some((i) => i.code === "H_CONTRADICTION" && i.key === "hs.family.parent.alive" && i.index === 3)).toBe(true);
  });

  it("保険料の合計は計算に入れる先が無いので、FP 用のメモに入れる（候補にしない）", () => {
    const a1 = run(...base, a("hs.insurance.premiumTotal", 18000));
    expect(a1.memo).toEqual(["【生命保険・医療保険などの保険料の合計（月）】月18,000円"]);
    expect(a1.request.input.household.insuranceContracts).toEqual([]);
    const a2 = run(...base, a("hs.insurance.premiumTotalRange", "20000-30000"));
    expect(a2.memo).toEqual(["【生命保険・医療保険などの保険料の合計（月）】2〜3万円（だいたいの範囲）"]);
  });

  it("シートで聞いていない詳細版の欄の不足は、知らせだけにして面談のチェックリストに載せる", () => {
    const r = run(...base, a("hs.work.type", "partTime", 1), a("hs.income.annual", 1000000, 1));
    const m = r.issues.find((i) => i.code === "H_MISSING" && i.key === "hs.work.weeklyHours");
    expect(m?.level).toBe("info");
    expect(m?.message).toContain("このシートではお聞きしていません");
    expect(r.checklist.find((c) => c.key === "hs.work.weeklyHours")?.label).toBe("ご本人 1週間の勤務時間（契約上）");
  });
});

describe("見本のシート basic-2（通常版）", () => {
  const NAME = "basic-2-sample";
  const json = JSON.parse(readFileSync(join(HEARING_DIR, "samples", `${NAME}.json`), "utf8")) as SampleFile;
  const xlsx = new Uint8Array(readFileSync(join(HEARING_DIR, "samples", `${NAME}.xlsx`)));

  it("リポジトリの .xlsx は、記入例の JSON から作り直したものと同じ（npm run sample）", async () => {
    expect(Buffer.compare(Buffer.from(await sampleBytes(`${NAME}.json`, json)), Buffer.from(xlsx))).toBe(0);
  });

  it("取り込むと、エラーなしで期待どおりの世帯の候補になる（範囲は推定・年齢は仮の生年月）", async () => {
    const r = await importHearingSheet(xlsx, { baseMonth: "2026-10", newId: idSeq("sample2") });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.definition.sheetId).toBe("basic");
    expect(r.definition.version).toBe(2);
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    const h = r.request.input.household;
    expect(h.members.map((m) => `${m.kind}:${m.birth.birthYearMonth}${m.expected ? "（予定）" : ""}`)).toEqual(["self:1984-07", "spouse:1987-04", "child:2015-06", "child:2027-03（予定）", "parent:1958-04", "parent:1960-04", "parent:1957-04"]);
    const [p1, p2] = h.employmentPeriods;
    expect((p1?.salary?.annual.value ?? 0) + (p1?.salary?.bonus.value ?? 0)).toBe(6500000);
    expect(p1?.salary?.annual).toMatchObject({ state: "estimated", certainty: "rough" });
    expect(p2?.salary?.annual.value).toBe(1200000);
    expect(h.debts?.[0]).toMatchObject({ principal: 27500000, balance: { value: 27500000, state: "estimated", certainty: "rough" }, repayment: { termMonths: 336 } }); // 期間は変動金利の目安（マスタデータ）で逆算する（目安を直したら、ここも直す）
    expect(h.accounts.map((x) => `${x.kind}:${x.marketValue.value}:${x.marketValue.state}`)).toEqual(["deposit:6000000:estimated", "taxable:1800000:confirmed"]);
    expect(h.livingExpenses?.[0]?.monthly).toMatchObject({ value: 275000, state: "estimated", certainty: "rough" });
    expect(r.memo[0]).toBe("【生命保険・医療保険などの保険料の合計（月）】2〜3万円（だいたいの範囲）");
    expect(r.memo).toHaveLength(3);
    expect(r.consents.map((c) => `${c.kind}:${c.decision}`)).toEqual(["purpose:given", "familyInfo:given", "externalAi:refused"]);
    expect(r.checklist.filter((c) => c.reason === "unknown").map((c) => c.label)).toEqual(["配偶者の方のお母さま 年齢"]);
    if (engineAvailable()) expect(preview(approveAll(r, "2026-10-27T10:00:00+09:00")).error).toBeUndefined();
  });

  it("空欄のシートを書き出して読むと、すべて未回答。前回の値の記入（見直し）は詳細版だけ", async () => {
    const s = await createHearingSheet({ definition: def, requestId: "R-ABCDEF", customerNo: "B0007", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-10-27" });
    const back = await readSheetXlsx(s.bytes, { definitions: OFFICIAL_SHEETS, requests: [s.request] });
    if (!back.ok) throw new Error(JSON.stringify(back.issues));
    expect(back.definition).toBe(def);
    expect(back.filled.answers.every((x) => x.status === "blank")).toBe(true);
    await expect(createHearingSheet({ definition: def, household: { request: modelHousehold("salariedCoupleTwoKids") }, requestId: "R-ABCDEF", customerNo: "", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-10-27" })).rejects.toThrow("詳細版");
    await expect(createHearingSheet({ definition: basic(), requestId: "R-ABCDEF", customerNo: "", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-10-27" })).rejects.toThrow("廃止");
  });
});

describe("古いシートの読み込み", () => {
  it("配った basic 版1 のシート（見本）は今までどおり basic 版1 の定義で読め、詳細版の見本と同じ世帯になる", async () => {
    const old = new Uint8Array(readFileSync(join(HEARING_DIR, "samples", "basic-1-sample.xlsx")));
    const detail = new Uint8Array(readFileSync(join(HEARING_DIR, "samples", "full-1-sample.xlsx")));
    const a1 = await importHearingSheet(old, { baseMonth: "2026-10", newId: idSeq("same") });
    const b1 = await importHearingSheet(detail, { baseMonth: "2026-10", newId: idSeq("same") });
    if (!a1.ok || !b1.ok) throw new Error("読めない");
    expect(`${a1.definition.sheetId}-${a1.definition.version}`).toBe("basic-1");
    expect(`${b1.definition.sheetId}-${b1.definition.version}`).toBe("full-1");
    // 見本の依頼番号だけが違う（出どころの ref）
    expect(JSON.parse(JSON.stringify(b1.request).replaceAll("R-9W4K2D", "R-7K3P9Q"))).toEqual(a1.request);
    expect(b1.memo).toEqual(a1.memo);
  });

  it("題を変える前に配ったシート（題が「簡易版」のまま）も、今の見本と同じ世帯に取り込める。配置の指紋は題で変わらない", async () => {
    // test/fixtures/basic-2-sample.old-title.xlsx は、題を変える前の samples/basic-2-sample.xlsx（題「…事前のご質問（簡易版）」）をそのまま写したもの
    const pairs = [
      ["basic-2-sample.old-title.xlsx", "basic-2-sample.xlsx"],
      // openpyxl で保存し直した basic 版1 の見本も、題を変える前に作ったもの（題「…ヒアリングシート（簡易版）」）
      ["basic-1-sample.resaved-openpyxl.xlsx", "basic-1-sample.xlsx"],
    ] as const;
    const oldTitle = new TextEncoder().encode("ライフプランのための事前のご質問（簡易版）");
    const before = new Uint8Array(readFileSync(join(HEARING_DIR, "test", "fixtures", pairs[0][0])));
    expect(Buffer.from(before).includes(Buffer.from(oldTitle))).toBe(true);
    for (const [oldFile, nowFile] of pairs) {
      const o = new Uint8Array(readFileSync(join(HEARING_DIR, "test", "fixtures", oldFile)));
      const n = new Uint8Array(readFileSync(join(HEARING_DIR, "samples", nowFile)));
      const ro = await importHearingSheet(o, { baseMonth: "2026-10", newId: idSeq("title") });
      const rn = await importHearingSheet(n, { baseMonth: "2026-10", newId: idSeq("title") });
      if (!ro.ok || !rn.ok) throw new Error(`${oldFile}: 読めない`);
      expect(ro.definition).toBe(rn.definition);
      expect(ro.request).toEqual(rn.request);
      expect(ro.issues.map((i) => i.code)).toEqual(rn.issues.map((i) => i.code));
      expect(ro.memo).toEqual(rn.memo);
      // 配った時のシートに入っている配置の指紋は、題を変えた今の定義の指紋と同じ（依頼の記録の照合も通る）
      const back = await readSheetXlsx(o, { definitions: OFFICIAL_SHEETS, requests: [] });
      if (!back.ok) throw new Error(`${oldFile}: 読めない`);
      expect(back.filled.management.layoutDigest).toBe(await layoutDigest(rn.definition));
    }
  });
});
