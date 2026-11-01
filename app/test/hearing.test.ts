// ヒアリングシートを入力のホームにつなぐ部分（workspace/hearing/sheet.ts）: 書き出し → 取り込み → 承認で現状に入る
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyImport, approvalTime, defaultSelection, defaultSheet, exportSheet, importSheet, logOf, sheetFor, SHEET_KINDS, withRequest } from "../src/workspace/hearing/sheet.ts";
import { entryOf } from "../src/workspace/input/stages/housingLoans.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { fillAll, gapsOf } from "../src/workspace/input/fill.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { allFields } from "../src/workspace/input/form.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

const OFFICE = { name: "【架空】みらいFP事務所", purpose: "ライフプランの作成のため", privacyContact: "【架空】個人情報の窓口" };
/** 配った basic 版1（廃止。書き出さないが取り込める）の見本 */
const SAMPLE = new Uint8Array(readFileSync(join(REPO_DIR, "hearing", "samples", "basic-1-sample.xlsx")));
/** 簡易版（basic 版2。初回の前の軽い票）の見本 */
const SIMPLE = new Uint8Array(readFileSync(join(REPO_DIR, "hearing", "samples", "basic-2-sample.xlsx")));
/** 詳細版（full 版2）の見本（ご本人は会社役員で、会社とのお金の欄を記入。0105） */
const FULL2 = new Uint8Array(readFileSync(join(REPO_DIR, "hearing", "samples", "full-2-sample.xlsx")));
/** 配った full 版1（廃止）の見本（会社とのお金の欄が無い） */
const FULL1 = new Uint8Array(readFileSync(join(REPO_DIR, "hearing", "samples", "full-1-sample.xlsx")));
const AT = approvalTime(new Date(2026, 9, 18, 10, 0, 0));

let n = 0;
const seq = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const blank = (): WorkingHousehold => withRefreshedEstimates(blankHousehold("2026-10", seq));
const exportOf = (wh: WorkingHousehold, prefill: boolean) =>
  exportSheet(wh, { definition: sheetFor(prefill ? "review" : "simple"), prefill, customerNo: "A0001", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-10-18", random: new Uint8Array([1, 2, 3, 4, 5, 6]) });

/** 承認の記録の無い「ヒアリング」の値の箱を数える（承認すると0になる） */
function unapproved(v: unknown): number {
  if (Array.isArray(v)) return v.reduce((s: number, x) => s + unapproved(x), 0);
  if (v === null || typeof v !== "object") return 0;
  const o = v as Record<string, unknown>;
  const self = typeof o.state === "string" && (o.origin as { kind?: string } | undefined)?.kind === "hearing" && o.approval === undefined ? 1 : 0;
  return self + Object.values(o).reduce((s: number, x) => s + unapproved(x), 0);
}

describe("見本の記入済みシートを空の世帯に取り込む", () => {
  it("候補は新規（家族・仕事・住まい …）と変更（本人の仮の生年月・生活費の目安）に分かれる", async () => {
    const wh = blank();
    const r = await importSheet(SAMPLE, wh, seq);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.view;
    const self = v.candidates.find((c) => c.group === "家族" && c.kind === "changed");
    expect(self?.title).toBe("ご本人");
    expect(v.candidates.filter((c) => c.group === "家族" && c.kind === "new")).toHaveLength(4);
    expect(v.candidates.find((c) => c.group === "生活費")?.kind).toBe("changed");
    expect(v.candidates.filter((c) => c.kind === "new").length).toBeGreaterThan(10);
    // 推定・仮の印（入力の画面と同じ）
    const marks = v.candidates.flatMap((c) => c.fields.map((f) => f.mark));
    expect(marks).toContain("assumed");
    // 見本のシートの推定の印は、前は年収から推定して書いた標準報酬月額だった。今は書かない（空欄なら給与から毎年決め直す。0047 の追記 2026-10-29 の2）
    expect(marks).not.toContain("estimated");
    expect(v.checklist.some((c) => c.reason === "unknown")).toBe(true);
    // 返ってきたシートの依頼が手元の記録に無いことを知らせる（公式のシートなので同梱の定義で読む）
    expect(v.issues.some((i) => i.code === "H_REQUEST_UNKNOWN")).toBe(true);
    expect(v.memo.length).toBeGreaterThan(0);
  });

  it("承認すると現状に入る: 承認の記録が付き、計算でき、入力のホームのカードが変わる", async () => {
    const wh = blank();
    const before = inputItems(wh);
    const r = await importSheet(SAMPLE, wh, seq);
    if (!r.ok) throw new Error("取り込めない");
    const sel = defaultSelection(r.view);
    const out = applyImport(wh, r.view, sel, AT);
    expect(out.skipped).toEqual([]);
    expect(out.added).toBeGreaterThan(10);
    expect(out.replaced).toBe(2);
    const h = out.wh.request.input.household;
    expect(h.members).toHaveLength(5);
    expect(h.members.find((m) => m.kind === "self")?.id).toBe(wh.request.input.household.members[0]?.id);
    expect(h.members.find((m) => m.kind === "self")?.birth.birthYearMonth).toBe("1986-05");
    // 承認の記録（0008 の2・5）
    expect(unapproved(out.wh.request)).toBe(0);
    expect(JSON.stringify(out.wh.request)).toContain(`"approval":{"by":"fp","at":"${AT}"`);
    // 本人の仮の生年月の印は外れ、取り込んだ物の印が入る。性別は推定にしないので、記入の無い子の性別にも印を付けない
    expect(Object.keys(out.wh.assumed).some((k) => k.endsWith("/birth"))).toBe(false);
    expect(Object.keys(out.wh.assumed).some((k) => k.endsWith("/sex"))).toBe(false);
    expect(Object.keys(out.wh.assumed).length).toBeGreaterThan(0);
    // 取り込みの記録と同意の下書き
    expect(logOf(out.wh).imports).toHaveLength(1);
    expect(logOf(out.wh).consents.map((c) => `${c.kind}:${c.decision}`)).toEqual(["purpose:given", "familyInfo:given", "externalAi:refused"]);
    expect(out.wh.memo.some((m) => m.startsWith("ヒアリング（R-"))).toBe(true);
    // 計算エンジンが受け付ける（出どころ「ヒアリング」の値は承認の記録が要る）
    const res = preview(withRefreshedEstimates(out.wh).request);
    expect(res.table.length).toBeGreaterThan(0);
    // 入力のホームのカード: 未入力が減り、仕事・住まい・保険などが入る。取り込んだ働き方の失業給付は推定で入れない（確かめの一覧の
    // 「失業給付を入れていません」だけが残る）ので、推定で埋めてから見る
    const workGaps = gapsOf(out.wh).filter((g) => g.card === "work");
    expect(workGaps.every((g) => g.id.startsWith("work/unemployment/"))).toBe(true);
    const after = inputItems(withRefreshedEstimates(fillAll(out.wh, "work").wh));
    // 空の世帯の項目は「まだ入れていない」（赤い知らせを出さない。0045 の追記）。取り込むと入れ始めた項目になる
    const none = (xs: typeof before) => xs.filter((i) => i.status === "missing" || i.status === "empty").map((i) => i.id);
    expect(none(after).length).toBeLessThan(none(before).length);
    expect(before.find((i) => i.id === "work")?.status).toBe("empty");
    expect(after.find((i) => i.id === "work")?.status).not.toBe("missing");
    expect(after.find((i) => i.id === "work")?.status).not.toBe("empty");
    // 保険: 契約は入るが、シートに無い主な保障の額（医療保険の入院日額・学資保険の満期金）は未入力の警告で残る（0055）
    const insMissing = allFields(buildStage("insurance", withRefreshedEstimates(out.wh))).filter((f) => fieldStatus(f, withRefreshedEstimates(out.wh)).status === "missing").map((f) => f.label);
    expect(insMissing).toEqual(["入院日額（1日）", "満期金"]);
    // 住まい: 住まいとローンが入る。シートに無い持ち家の評価額だけが未入力の警告で残る（0052）
    expect(before.find((i) => i.id === "housing")?.status).toBe("empty");
    const housingMissing = allFields(buildStage("housing", withRefreshedEstimates(out.wh))).filter((f) => fieldStatus(f, withRefreshedEstimates(out.wh)).status === "missing").map((f) => f.key.split("/").slice(-2).join("/"));
    expect(housingMissing).toEqual(["valuation/value"]);
  });

  it("承認しなかった家族を指す物は入れない", async () => {
    const wh = blank();
    const r = await importSheet(SAMPLE, wh, seq);
    if (!r.ok) throw new Error("取り込めない");
    const spouse = r.view.candidates.find((c) => c.title === "配偶者");
    const sel = defaultSelection(r.view);
    sel.delete(spouse?.id ?? "");
    const out = applyImport(wh, r.view, sel, AT);
    expect(out.wh.request.input.household.members.some((m) => m.kind === "spouse")).toBe(false);
    expect(out.skipped.length).toBeGreaterThan(0);
    expect(out.skipped.every((t) => t.startsWith("配偶者"))).toBe(true);
  });
});

describe("書き出しから取り込みまでの往復（画面の中の流れ）", () => {
  it("前回の値入りで書き出したシートを、空の世帯に取り込んで承認すると、元の世帯の値に戻る", async () => {
    const src = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const sheet = await exportOf(src, true);
    expect(sheet.issues.some((i) => i.code === "H_EXPORT_PREFILL")).toBe(true);
    expect(sheet.request.prefilled).toBe(true);
    const wh = withRequest(blank(), sheet.request);
    const r = await importSheet(sheet.bytes, wh, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    // 手元の依頼の記録で読む（知らない依頼の知らせは出ない）
    expect(r.view.issues.some((i) => i.code === "H_REQUEST_UNKNOWN")).toBe(false);
    const out = applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), AT);
    const a = src.request.input.household;
    const b = out.wh.request.input.household;
    const births = (h: typeof a) => h.members.map((m) => `${m.kind}:${m.birth.birthYearMonth}:${m.sex}`).sort();
    expect(births(b)).toEqual(births(a));
    const salary = (h: typeof a, kind: string) => {
      const m = h.members.find((x) => x.kind === kind);
      return (h.employmentPeriods ?? []).filter((p) => p.member === m?.id).map((p) => p.salary?.annual.value ?? null)[0];
    };
    expect(salary(b, "self")).toBe(salary(a, "self"));
    expect(salary(b, "spouse")).toBe(salary(a, "spouse"));
    expect(preview(withRefreshedEstimates(out.wh).request).table.length).toBeGreaterThan(0);
  });

  it("同じ世帯に取り込み直すと、家族は「新規」にならない（今の物と対応づける）", async () => {
    const src = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const sheet = await exportOf(src, true);
    const r = await importSheet(sheet.bytes, withRequest(src, sheet.request), seq);
    if (!r.ok) throw new Error("取り込めない");
    const family = r.view.candidates.filter((c) => c.group === "家族");
    expect(family.length).toBe(src.request.input.household.members.length);
    expect(family.every((c) => c.kind !== "new")).toBe(true);
    expect(family.filter((c) => c.kind === "same").length).toBeGreaterThan(0);
  });

  it("住宅ローンは仮の住宅ローン控除の条件と入居のイベントつきで入り、取り込み直しても「同じ」になる", async () => {
    // 2024年4月に借りた住宅ローン（控除の条件なし）の世帯から、前回の値入りで書き出す
    const req = modelHousehold("salariedCoupleTwoKids");
    for (const d of req.input.household.debts ?? []) {
      if (d.kind !== "mortgage") continue;
      d.start = { at: "2024-04" };
      d.rateSchedule = [{ ...d.rateSchedule[0]!, from: { at: "2024-04" } }];
      delete d.housing;
      delete d.balance;
      delete d.balanceAsOf;
    }
    const sheet = await exportOf(fromRequest(req), true);
    const wh = withRequest(blank(), sheet.request);
    const r = await importSheet(sheet.bytes, wh, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const out = applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), AT);
    const h = out.wh.request.input.household;
    const d = (h.debts ?? []).find((x) => x.kind === "mortgage");
    expect(d?.housing?.moveIn).toBeDefined();
    expect(h.events?.find((e) => e.id === d?.housing?.moveIn)).toMatchObject({ kind: "moveIn", at: { at: "2024-04" } });
    expect(out.wh.assumed[`housing/debt/${d?.id}/credit`]).toContain("仮の条件");
    expect(preview(withRefreshedEstimates(out.wh).request).table.length).toBeGreaterThan(0);
    // 同じシートを取り込み直すと、住宅ローンは「同じ」（入居のイベントの ID は比べない）で、入居のイベントは増えない
    const again = await importSheet(sheet.bytes, out.wh, seq);
    if (!again.ok) throw new Error("取り込めない");
    expect(again.view.candidates.find((c) => c.group === "住宅ローン")?.kind).toBe("same");
    const out2 = applyImport(out.wh, again.view, new Set(again.view.candidates.map((c) => c.id)), AT);
    expect(out2.wh.request.input.household.events?.filter((e) => e.kind === "moveIn")).toHaveLength(1);
  });

  it("空欄のシート（前回の値なし）は値を載せず、名前の欄も無い", async () => {
    const src = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const sheet = await exportOf(src, false);
    expect(sheet.request.prefilled).toBe(false);
    expect(sheet.issues.some((i) => i.code === "H_EXPORT_PREFILL")).toBe(false);
    const r = await importSheet(sheet.bytes, withRequest(blank(), sheet.request), seq);
    if (!r.ok) throw new Error("取り込めない");
    expect(r.view.candidates.filter((c) => c.group === "仕事と収入")).toEqual([]);
  });

  it("顧客番号は世帯の保存と同じ決まり（英数字・ハイフン・下線の16字まで。氏名を入れない）", async () => {
    await expect(exportSheet(blank(), { definition: defaultSheet(), prefill: false, customerNo: "山田", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-10-18", random: new Uint8Array(6) })).rejects.toThrow("E_HEARING_CUSTOMER_NO");
    const r = await exportSheet(blank(), { definition: defaultSheet(), prefill: false, customerNo: "A_0042", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-10-18", random: new Uint8Array(6) });
    expect(r.request.customerNo).toBe("A_0042");
  });

  it("壊れたファイル・.xlsx 以外は、分かる言葉で止まり、現状は変わらない", async () => {
    const wh = blank();
    const r = await importSheet(new TextEncoder().encode("hello"), wh);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.some((i) => i.code === "H_FILE_NOT_XLSX")).toBe(true);
  });
});

describe("シートの種類（簡易・詳細・見直し）", () => {
  it("既定は簡易（basic の最新の版）。詳細と見直しは詳細のシート（full）で、見直しだけ前回の値を記入する", async () => {
    expect(SHEET_KINDS.map((k) => k.value)).toEqual(["simple", "detail", "review"]);
    expect(`${defaultSheet().sheetId}-${defaultSheet().version}`).toBe("basic-2");
    expect(`${sheetFor("detail").sheetId}-${sheetFor("detail").version}`).toBe("full-2");
    expect(sheetFor("review")).toBe(sheetFor("detail"));
    const src = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const review = await exportSheet(src, { definition: sheetFor("review"), prefill: true, customerNo: "A0001", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-10-27", random: new Uint8Array([1, 2, 3, 4, 5, 6]) });
    expect(review.request).toMatchObject({ sheetId: "full", sheetVersion: 2, prefilled: true });
    expect(review.issues.some((i) => i.code === "H_EXPORT_PREFILL")).toBe(true);
    // 簡易のシートには前回の値を記入しない（範囲・合計の欄の形が違う）
    await expect(exportSheet(src, { definition: sheetFor("simple"), prefill: true, customerNo: "A0001", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-10-27", random: new Uint8Array(6) })).rejects.toThrow("詳細版");
  });
});

describe("簡易版の記入済みシートを空の世帯に取り込む", () => {
  it("範囲の答えは「推定（範囲の真ん中）」の印と根拠、年齢は仮の生年月、ご両親は父・母・義母の候補になる", async () => {
    const r = await importSheet(SIMPLE, blank(), seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const v = r.view;
    expect(v.definition.version).toBe(2);
    const ranged = v.candidates.flatMap((c) => c.fields.filter((f) => f.mark === "range").map((f) => `${c.group}:${f.label}:${f.answer}`));
    expect(ranged).toContain("生活費:生活費のだいたいの範囲:25〜30万円");
    expect(ranged).toContain("住宅ローン:残高のだいたいの範囲:2,500〜3,000万円");
    const living = v.candidates.find((c) => c.group === "生活費")?.fields.find((f) => f.mark === "range");
    expect(living?.note).toBe("ヒアリングシートの範囲 25〜30万円の真ん中");
    expect(v.candidates.filter((c) => c.group === "家族").map((c) => c.title)).toEqual(["ご本人", "配偶者", "第1子", "第2子", "父", "母", "義母"]);
    const spouse = v.candidates.find((c) => c.title === "配偶者");
    expect(spouse?.fields.find((f) => f.label.startsWith("年齢"))).toMatchObject({ answer: "39歳", mark: "assumed" });
    // シートで聞いていない欄を仮の値で補ったものは「聞いていない」と出す
    const work = v.candidates.find((c) => c.group === "仕事と収入");
    expect(work?.fields.find((f) => f.label === "いまの仕事を始めた年月")).toMatchObject({ answer: "（このシートでは聞いていない）", mark: "assumed" });
    expect(v.memo[0]).toContain("保険料の合計");
  });

  it("承認すると、住宅ローンは「今の残高から」、新しい親は亡くなる見込み（平均余命の仮）つきで入り、計算できる。取り込み直すと親は新規にならない", async () => {
    const wh = blank();
    const r = await importSheet(SIMPLE, wh, seq);
    if (!r.ok) throw new Error("取り込めない");
    const out = applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), AT);
    const h = out.wh.request.input.household;
    const d = (h.debts ?? []).find((x) => x.kind === "mortgage");
    expect(d).toBeDefined();
    expect(entryOf(out.wh, d?.id ?? "")).toBe("balance");
    const parents = h.members.filter((m) => m.kind === "parent");
    expect(parents).toHaveLength(3);
    for (const p of parents) {
      expect(p.leaves).not.toBeNull();
      expect(out.wh.assumed[`family/${p.id}/leaves`]).toBeDefined();
    }
    expect(unapproved(out.wh.request)).toBe(0);
    expect(preview(withRefreshedEstimates(out.wh).request).table.length).toBeGreaterThan(0);
    const again = await importSheet(SIMPLE, out.wh, seq);
    if (!again.ok) throw new Error("取り込めない");
    const fam = again.view.candidates.filter((c) => c.group === "家族" && ["父", "母", "義母"].includes(c.title));
    expect(fam.map((c) => c.kind)).toEqual(["same", "same", "same"]);
    // 承認し直しても、聞いていない欄（亡くなる見込み）は今の値を残す
    const out2 = applyImport(out.wh, again.view, new Set(again.view.candidates.map((c) => c.id)), AT);
    const before = parents.map((p) => JSON.stringify(p.leaves));
    expect(out2.wh.request.input.household.members.filter((m) => m.kind === "parent").map((p) => JSON.stringify(p.leaves))).toEqual(before);
    expect(out2.wh.request.input.household.members.filter((m) => m.kind === "parent")).toHaveLength(3);
  });
});

describe("会社役員の方の会社とのお金（詳細版 full 版2。0105）", () => {
  it("自社株・会社への貸付金・会社からの借入金の候補になり、承認すると借入金は「今の残高から」、連帯保証の額はご本人の欄に入る。取り込み直すと「同じ」", async () => {
    const wh = blank();
    const r = await importSheet(FULL2, wh, seq);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(`${r.view.definition.sheetId}-${r.view.definition.version}`).toBe("full-2");
    const titles = r.view.candidates.map((c) => `${c.group}:${c.title}`);
    expect(titles).toContain("貯蓄・投資:ご本人の自社株（出資額）");
    expect(titles).toContain("貯蓄・投資:ご本人の会社への貸付金");
    expect(titles).toContain("借入金:ご本人の会社からの借入金");
    const self = r.view.candidates.find((c) => c.group === "家族" && c.title === "ご本人");
    expect(self?.fields.find((f) => f.label === "会社の借入の連帯保証の額")).toMatchObject({ answer: "3,000万円", mark: null });
    const out = applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), AT);
    const h = out.wh.request.input.household;
    const me = h.members.find((m) => m.kind === "self");
    expect((h.accounts ?? []).filter((x) => x.kind === "otherAsset").map((x) => `${x.subtype ?? ""}:${x.owner === me?.id ? "self" : "?"}:${x.marketValue?.value ?? ""}`)).toEqual(["ownCompanyShares:self:3000000", "loanToCompany:self:5000000"]);
    const loan = (h.debts ?? []).find((d) => d.subtype === "companyLoan");
    expect(loan).toMatchObject({ kind: "other", balance: { value: 2000000 }, repayment: { termMonths: 40 } });
    expect(entryOf(out.wh, loan?.id ?? "")).toBe("balance");
    expect(me?.companyGuarantee).toMatchObject({ value: 30000000, state: "confirmed", approval: { by: "fp" } });
    expect(unapproved(out.wh.request)).toBe(0);
    expect(preview(withRefreshedEstimates(out.wh).request).table.length).toBeGreaterThan(0);
    const again = await importSheet(FULL2, out.wh, seq);
    if (!again.ok) throw new Error("取り込めない");
    const company = again.view.candidates.filter((c) => /自社株|会社への貸付金|会社からの借入金/.test(c.title));
    expect(company.map((c) => c.kind)).toEqual(["same", "same", "same"]);
  });

  it("連帯保証の額の欄が無い版1 のシートを取り込み直しても、今の連帯保証の額を残す", async () => {
    const wh = blank();
    const r = await importSheet(FULL2, wh, seq);
    if (!r.ok) throw new Error("取り込めない");
    const out = applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), AT);
    const old = await importSheet(FULL1, out.wh, seq);
    if (!old.ok) throw new Error("取り込めない");
    const out2 = applyImport(out.wh, old.view, new Set(old.view.candidates.map((c) => c.id)), AT);
    expect(out2.wh.request.input.household.members.find((m) => m.kind === "self")?.companyGuarantee).toMatchObject({ value: 30000000 });
  });
});

describe("承認の日時", () => {
  it("時差つき・秒まで（計算エンジンの approval.at の形。ミリ秒は付けない）", () => {
    expect(approvalTime(new Date(2026, 9, 18, 10, 5, 7))).toMatch(/^2026-10-18T10:05:07[+-]\d{2}:\d{2}$/);
    expect(approvalTime()).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|[+-][0-9]{2}:[0-9]{2})$/);
  });
});
