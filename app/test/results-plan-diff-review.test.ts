// 結果・プランの差分・面談の準備・見本の棚の手直し（0146）が戻らないことの確かめ:
// - キャッシュフロー表の「○○の事業所得」（人ごと）と「企業年金・個人年金」の行（「その他の収入」に入れない）
// - 違いの一覧・変えたこと・世帯の中身の一覧の言葉（内部の名前・生の値を出さない。変えたことは違いの一覧と同じ文。提案書の変更点にも入る）
// - 世帯の中身の一覧の人の置き場所と、介護・FP顧問料の額
// - 編集の対象の箱の「違いの一覧（n）」と、違いの一覧の見出し・閉じる・「計算に入れる」
// - 目標のカードの1回・毎年の行の時期と見込み（2026-11-12 から区画「これからの大きなお金」）、結果の上の行に世帯の外の家族を出さない、資産と負債の今の年の印と生活費の内訳
// - 見本の棚の世帯に赤い未入力が無い
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { EngineRequest } from "../src/engine/types.ts";
import { DEMO_HOUSEHOLDS } from "../src/workspace/catalog.ts";
import { COLLECTIONS } from "../src/generated/readings.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { DiffList, PlanTarget } from "../src/workspace/input/PlanEdit.tsx";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { allFields } from "../src/workspace/input/form.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { COLLECTION_LABELS, diffRows, planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import { changesOf, changesOfValues, effectiveValues } from "../src/workspace/plans/plans.ts";
import { flowChart, rowDefs, toPresentation } from "../src/workspace/present.ts";
import { householdContents } from "../src/workspace/tools/fpTools.ts";
import { livingBasisText } from "../src/presentation/BalanceTab.tsx";
import { roles } from "../src/workspace/roles.ts";
import { bigMoneyOf } from "../src/workspace/bigMoney.ts";
import { ALL_ROWS } from "../src/engine/moneyRows.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const selfOf = (wh: WorkingHousehold) => roles(wh.request).find((r) => r.key === "self")!.member.id;
const withPlan = (wh: WorkingHousehold): WorkingHousehold => ({ ...wh, proposals: [{ id: "B", name: "プランB", createdAt: "2026-11-07T00:00:00Z", updatedAt: "2026-11-07T00:00:00Z", base: null, tags: [], diffs: [] }] });
const RAW = /(?<![A-Za-z])[a-z]+[A-Z][A-Za-z]*|\{"|(?<![A-Za-z])(member|relation|care|home|facility)(?![A-Za-z])/;

describe("キャッシュフロー表の事業所得と企業年金の行", () => {
  it("自営業の事業所得は人ごとの「○○の事業所得」の行。「その他の収入」に入れず、収入合計は同じ", () => {
    const req = modelHousehold("sampleSelfEmployedFamily");
    const table = preview(req).table;
    const defs = rowDefs(req);
    const biz = defs.find((d) => d.key === "business:self")!;
    expect(biz.label).toBe("ご本人の事業所得");
    const cells = table.filter((c) => c.row.startsWith("cf.income.business") && c.amount !== 0);
    expect(cells.length).toBeGreaterThan(0);
    const other = defs.find((d) => d.key === "incomeOther")!;
    expect(cells.some((c) => other.match(c))).toBe(false);
    expect(cells.every((c) => defs.filter((d) => d.kind === "value" && d.group === "income" && d.match(c)).length === 1)).toBe(true);
    // グラフは給与の系列のまま、名前は「給与・事業の収入」
    const chart = flowChart(req, table, [2027], "");
    expect(chart.income.find((s) => s.key === "salary")?.label).toBe("給与・事業の収入");
  });

  it("年金で受け取る企業年金・iDeCo などは「企業年金・個人年金」の行", () => {
    const req = modelHousehold("idecoPayout");
    const table = preview(req).table;
    const defs = rowDefs(req);
    const cp = defs.find((d) => d.key === "corporatePension")!;
    expect(cp.label).toBe("企業年金・個人年金");
    const cells = table.filter((c) => c.row.startsWith("cf.income.corporatePension") && c.amount !== 0);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => cp.match(c) && !defs.find((d) => d.key === "incomeOther")!.match(c))).toBe(true);
    // 会社員だけの世帯のグラフの名前は「給与」のまま
    expect(flowChart(req, table, [2027], "").income.find((s) => s.key === "salary")?.label).toBe("給与");
  });
});

describe("違いの一覧・変えたこと・世帯の中身の一覧の言葉", () => {
  it("物の集まりの呼び名は、どの物の集まりにもある（英字のまま出さない）", () => {
    for (const name of Object.keys(COLLECTIONS)) expect(COLLECTION_LABELS[name], name).toBeDefined();
    expect(COLLECTION_LABELS.incomeFlow).toBe("入るお金");
    expect(COLLECTION_LABELS.periodicExpense).toBe("出るお金");
  });

  /** 介護の親の世帯で、プランBで介護の場所・同居を直し、母を外す */
  function edited(): { wh: WorkingHousehold; cat: ReturnType<typeof buildCatalog> } {
    const wh0 = withPlan(open("parentMoney"));
    const cat = buildCatalog(wh0, selfOf(wh0), null);
    const view = planView(wh0, cat, "B");
    const care = buildStage("care", view);
    const fields = allFields(care);
    const place = fields.find((f) => f.key.endsWith("/place"))!;
    const coh = fields.find((f) => f.key.endsWith("/cohabiting"))!;
    let next = place.set(view, place.get(view).value === "home" ? "facility" : "home");
    next = coh.set(next, coh.get(next).value !== true);
    return { wh: recordPlanEdit(wh0, cat, "B", view, next), cat };
  }

  it("違いの一覧は選択肢・はい／いいえの言葉で、変えたことも同じ文", () => {
    const { wh, cat } = edited();
    const rows = diffRows(wh, cat, "B");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) for (const t of [r.label, r.from, r.to]) expect(t, t).not.toMatch(RAW);
    // 介護の場所を変えると物の置き換え（在宅と施設で欄が違う）。前と後の呼び名に場所を添える
    expect(rows.some((r) => r.label === "置き換え: 介護" && /施設）$/.test(r.from) && /在宅）$/.test(r.to))).toBe(true);
    expect(rows.some((r) => r.label.endsWith("同居している") && r.from === "はい" && r.to === "いいえ")).toBe(true);
    const ch = changesOf(wh.proposals, "B", wh, cat);
    expect(ch.map((c) => [c.label, c.from, c.to]).sort()).toEqual(rows.map((r) => [r.label, r.from, r.to]).sort());
    for (const c of ch) expect(c.from, c.label).not.toBe("—");
  });

  it("入力で直した差分は、提案書・持ち帰り用のレポートの変更点（動かした値の一覧）にも同じ文で入る", () => {
    const { wh, cat } = edited();
    const values = effectiveValues(wh, "B");
    const rows = changesOfValues(values, wh, cat);
    expect(rows.length).toBe(diffRows(wh, cat, "B").length);
    expect(rows.some((r) => /在宅）$/.test(r.to))).toBe(true);
  });

  it("まとまった値（扶養と同居）を丸ごと変えた差分は、欄ごとの言葉にする", () => {
    // 扶養と同居の値をまだ持っていない親（取り込んだ世帯など）に、プランで丸ごと入れる
    const req0 = structuredClone(modelHousehold("elderCare"));
    for (const m of req0.input.household.members) if (m.kind === "parent") delete m.support;
    const wh0 = withPlan(fromRequest(req0));
    const cat = buildCatalog(wh0, selfOf(wh0), null);
    const view = planView(wh0, cat, "B");
    const parent = view.request.input.household.members.find((m) => m.kind === "parent")!;
    const next = structuredClone(view);
    const p = next.request.input.household.members.find((m) => m.id === parent.id)!;
    const was = p.support;
    p.support = { dependent: !(was?.dependent ?? false), cohabiting: !(was?.cohabiting ?? false) };
    const w = recordPlanEdit(wh0, cat, "B", view, next);
    const texts = diffRows(w, cat, "B").flatMap((r) => [r.label, r.from, r.to]);
    expect(texts.join(" ")).not.toMatch(/\{"|cohabiting|dependent/);
    expect(texts.join(" ")).toMatch(/同居している: (はい|いいえ)/);
  });

  it("世帯の中身の一覧: 世帯の中の人は家族、世帯の外の親は介護・親の下。介護・FP顧問料に額", () => {
    const wh = open("parentMoney");
    const secs = householdContents(wh);
    const fam = secs.find((s) => s.card === "family")!;
    expect(fam.rows.some((r) => r.label.includes("ご本人"))).toBe(true);
    expect(secs.find((s) => s.card === "pension")?.rows.some((r) => r.label.includes("家族")) ?? false).toBe(false);
    const care = secs.find((s) => s.card === "care")!;
    expect(care.rows.some((r) => r.label.includes("母") && r.text?.includes("世帯の外"))).toBe(true);
    expect(care.rows.find((r) => r.label === "介護（母・施設）")?.text).toMatch(/^施設・月[\d.,]+万円・60か月$/);
    const fee = householdContents(open("advisoryFeeProposal")).flatMap((s) => s.rows).find((r) => r.label.startsWith("FP顧問料"));
    expect(fee?.text).toMatch(/単発[\d.,]+万円＋年[\d.,]+万円/);
  });
});

describe("編集の対象の箱の違いの一覧", () => {
  const props = (sel: string | null) => ({ list: [{ id: "B", label: "プランB", name: "プランB", color: "#0072c6" }], sel, onSelect: () => undefined, onNew: () => undefined, onCopy: () => undefined, cat: buildCatalog(open("salariedCoupleTwoKids"), selfOf(open("salariedCoupleTwoKids")), null), onSavePlan: () => undefined, lock: null });

  it("プランを選んでいると箱の中に文字のリンク「違いの一覧（n）」。現状のときも同じ部品を見えない形で置く（配置を動かさない）", () => {
    const on = renderToString(h(PlanTarget, { p: props("B"), diffs: { rows: [], open: false, onOpen: () => undefined } }));
    expect(on).toContain("違いの一覧（0）");
    expect(on).toContain("data-diff-open");
    // プランの操作のメニューの中には出さない（閉じているとき）
    expect(on).not.toContain("data-plan-menu-list");
    const cur = renderToString(h(PlanTarget, { p: props(null) }));
    expect(cur).toMatch(/class="link-btn ih-target-diffs off"[^>]*disabled/);
    expect(cur).not.toContain("data-diff-open");
  });

  it("違いの一覧の見出しは「プランBで現状から変えた所（n）」と「閉じる」。チェックの横に「計算に入れる」", () => {
    const wh0 = withPlan(open("parentMoney"));
    const cat = buildCatalog(wh0, selfOf(wh0), null);
    const view = planView(wh0, cat, "B");
    const place = allFields(buildStage("care", view)).find((f) => f.key.endsWith("/place"))!;
    const wh = recordPlanEdit(wh0, cat, "B", view, place.set(view, place.get(view).value === "home" ? "facility" : "home"));
    let closed = false;
    const html = renderToString(h(DiffList, { rows: diffRows(wh, cat, "B"), wh, planId: "B", planLabel: "プランB", cat, onEdit: () => undefined, onOpen: () => undefined, onClose: () => (closed = true) }));
    expect(html).toContain("プランBで現状から変えた所（1）");
    expect(html).toContain("data-diff-close");
    expect(html).toContain("計算に入れる");
    expect(closed).toBe(false);
  });
});

describe("結果のご家族の夢・上の行・資産と負債", () => {
  it("これからの大きなお金: ふつうの出るお金の行（贈与など）は「支払いの予定」に1行ずつ（夢の無い世帯は「ご家族の夢」を出さない）", () => {
    const req = structuredClone(modelHousehold("parentMoney")) as EngineRequest;
    const h0 = req.input.household;
    h0.periodicExpenses = [
      { id: "11111111-1111-4111-8111-111111111111", row: "cf.expense.lumpSum.gift", label: "あげる贈与", from: { at: "2027-11" }, to: { at: "2027-11" }, everyYears: 1, amount: { value: 1_100_000, state: "confirmed", origin: { kind: "manual" } }, kind: "gift", priority: "want" },
      { id: "22222222-2222-4222-8222-222222222222", row: "cf.expense.lumpSum.gift", label: "あげる贈与", from: { at: "2027-01" }, to: { at: "2031-12" }, everyYears: 1, amount: { value: 500_000, state: "confirmed", origin: { kind: "manual" } }, kind: "gift" },
    ] as never;
    const res = preview(req);
    const bm = bigMoneyOf(req, res.table, { raw: req, view: ALL_ROWS, certainTable: null });
    expect(bm.groups.map((g) => g.key)).toEqual(["pay"]);
    expect(bm.groups[0]!.rows.map((r) => [r.name, r.when, r.amount, r.tag, r.pick !== null])).toEqual([
      ["あげる贈与", "2027〜2031年・毎年", "年50万円", "確実", false],
      ["あげる贈与", "2027年", "110万円", "不確実", true],
    ]);
  });

  it("結果の上の行（世帯の人の並び）に、世帯の外の家族を出さない", () => {
    const req = modelHousehold("parentMoney");
    const res = preview(req);
    const m = toPresentation({ base: req, proposal: req, current: res, proposed: res, targetAge: 95, selectedYear: null, provisional: false });
    expect(m.members.map((x) => x.label)).toEqual(["ご本人"]);
  });

  it("家計の体力の目安の文は、基本生活費と車を分ける（月額は欄の外の書き方）", () => {
    expect(livingBasisText({ living: 3_960_000, livingCar: 360_000, loanPay: 0 }, false)).toBe("基本生活費 月30万円＋車 月3万円で計算");
    expect(livingBasisText({ living: 3_600_000, loanPay: 1_080_000 }, true)).toBe("基本生活費 月30万円＋ローン返済 月9万円で計算");
    expect(livingBasisText({ living: 0, loanPay: 0 }, false)).toBe("");
  });
});

describe("見本の棚", () => {
  it("どの見本にも赤い未入力（0円の所あり）の入力項目が無い", () => {
    for (const d of DEMO_HOUSEHOLDS) {
      const miss = inputItems(open(d.id)).filter((i) => i.status === "missing").map((i) => i.id);
      expect(miss, `${d.sampleNo} ${d.id}`).toEqual([]);
    }
  });

  it("親の介護と相続・収益不動産の見本が棚にあり、絞り込みの項目を持つ", () => {
    const ids = DEMO_HOUSEHOLDS.filter((d) => d.traits.includes("親の介護・相続")).map((d) => d.id);
    expect(ids).toEqual(["sampleParentsCare", "sampleSeniorRental"]);
    expect(DEMO_HOUSEHOLDS.filter((d) => d.traits.includes("収益不動産")).map((d) => d.id).sort()).toEqual(["dualAssetsTwoKids", "rentalSample", "sampleSeniorRental"]);
    expect(DEMO_HOUSEHOLDS.every((d) => !d.title.includes("（見本）"))).toBe(true);
    const senior = modelHousehold("sampleSeniorRental").input.household;
    expect(senior.members.some((m) => m.kind === "parent" && m.outside !== undefined)).toBe(true);
    expect(senior.retirementBenefits?.some((b) => b.kind === "db" && b.receipt?.method === "annuity")).toBe(true);
    expect(senior.accounts?.some((a) => a.kind === "realEstate" && a.property?.rental !== undefined)).toBe(true);
    expect((senior.careExpenses ?? []).length).toBeGreaterThan(0);
    expect(senior.incomeFlows?.some((f) => f.kind === "inheritance")).toBe(true);
    const fifty = modelHousehold("sampleParentsCare").input.household;
    expect((fifty.advisoryFees ?? []).length).toBe(1);
    expect(fifty.periodicExpenses?.some((p) => p.gift !== undefined)).toBe(true);
    expect(fifty.members.filter((m) => m.outside !== undefined).map((m) => m.kind).sort()).toEqual(["grandchild", "parent", "parent"]);
  });
});
