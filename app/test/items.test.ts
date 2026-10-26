// 入力のホーム（0045）: 14枚のカードの並び・物の置き場所（1つの物は1つのカードに）・カードの状態4つ・進み具合・最初の5枚と1押し・
// ピン（＋ 項目を追加・📌 ホームに出す・プランの編集中だけのピン）・古い世帯を開いても書き換えない
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { allFields, type FieldDef, type StageDef, type StageId } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputView } from "../src/workspace/input/InputView.tsx";
import {
  ADD_OPTIONS,
  addItem,
  addOptions,
  cardOrder,
  DEFAULT_LAYOUT,
  fillCard,
  GROUP_HEADINGS_FROM,
  groupedItems,
  inputItems,
  itemOf,
  itemStage,
  notApplicableCard,
  pinItems,
  pinOfGroup,
  progressOf,
  saveItem,
  statusOf,
  togglePin,
  type CardLayout,
  type InputItem,
} from "../src/workspace/input/items.ts";
import { addExpense, addIncome, addInheritedDebt, expenseCard, incomeCard, kindsOf } from "../src/workspace/input/moneyRows.ts";
import { STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { fromBody } from "../src/workspace/store/body.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { countsByCard, diffRows, planIndex, planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import type { Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const open = (id: string, memo: string[] = []) => fromRequest(modelHousehold(id), { memo });
const byId = (items: InputItem[], id: string) => items.find((i) => i.id === id) as InputItem;
const sumText = (i: InputItem) => (i.summary === null ? null : `${i.summary.pre ?? ""}${i.summary.main}${i.summary.unit ?? ""}`);
const fieldOf = (stage: StageDef | null, suffix: string): FieldDef => allFields(stage as StageDef).find((f) => f.key.endsWith(suffix)) as FieldDef;
const groupKeys = (wh: WorkingHousehold, card: string) => (itemStage(wh, card) as StageDef).sections.flatMap((s) => s.groups.map((g) => g.key));
const editableKeys = (wh: WorkingHousehold, card: string) => allFields(itemStage(wh, card) as StageDef).filter((f) => f.readOnly === undefined).map((f) => f.key);
const LABELS = ["家族", "働き方と収入", "退職金・企業年金", "年金", "基本生活費", "子ども・教育", "住まい・ローン", "保険", "貯蓄・運用", "ライフイベント", "車", "介護・親", "相続・贈与", "前提条件"];

/** 足した項目をまとめて足す（保存まで） */
function withAdded(wh: WorkingHousehold, keys: string[], id = seq()): WorkingHousehold {
  let w = wh;
  for (const k of keys) {
    const r = addItem(w, k, id);
    if (r === null) throw new Error(k);
    w = saveItem(r.wh, r.itemId);
  }
  return w;
}

describe("14枚のカードと並び", () => {
  it("入力のホームの順に14枚（もとの10項目の相対の順番は変えず、車と新しい3枚を間に入れた）。FP顧問料はカードにしない", () => {
    const items = inputItems(open("salariedCoupleTwoKids"));
    expect(items.map((i) => i.label)).toEqual(LABELS);
    expect(STAGE_ORDER.map((s) => s.label)).toEqual(LABELS);
    expect(items.some((i) => i.id === "fee")).toBe(false);
    // もとの順番（家族→働き方と収入→年金→基本生活費→子ども・教育→住まい・ローン→保険→貯蓄・運用→ライフイベント→前提条件）の相対
    const old = ["家族", "働き方と収入", "年金", "基本生活費", "子ども・教育", "住まい・ローン", "保険", "貯蓄・運用", "ライフイベント", "前提条件"];
    expect(LABELS.filter((l) => old.includes(l))).toEqual(old);
  });

  it("事務所の設定で並べ替え・最初の5枚を変えられる（設定に無いカードは標準の順で後ろに。どのカードも1回）", () => {
    expect(DEFAULT_LAYOUT.first).toEqual(["family", "work", "living", "savings", "housing"]);
    const layout: CardLayout = { order: ["assumptions", "family", "family", "nope" as StageId], first: ["family"] };
    const order = cardOrder(layout);
    expect(order.slice(0, 2)).toEqual(["assumptions", "family"]);
    expect(order).toHaveLength(14);
    expect(new Set(order).size).toBe(14);
    const items = inputItems(blankHousehold("2026-10", seq()), { layout });
    expect(items[0]!.id).toBe("assumptions");
    expect(items.filter((i) => i.first).map((i) => i.id)).toEqual(["family"]);
  });

  it("14枚のときは見出しを出さない。ピンは何枚足してもカードの数に入れない", () => {
    const wh = withAdded(open("salariedCoupleTwoKids"), ["pet", "abroad", "periodic", "care", "pet"]);
    const items = inputItems(wh);
    expect(items).toHaveLength(14);
    expect(items.length).toBeLessThan(GROUP_HEADINGS_FROM);
    expect(groupedItems(items).map((g) => g.group)).toEqual([null]);
    expect(pinItems(wh)).toHaveLength(5);
  });
});

describe("物の置き場所（1つの物は1つのカードにだけ。ほかは読むだけの1行）", () => {
  it("どのモデル世帯でも、入れられる欄のキーとまとまりのキーは14枚の中で重ならない", () => {
    for (const id of MODELS) {
      const wh = open(id);
      const fields = STAGE_ORDER.flatMap((s) => editableKeys(wh, s.id));
      expect(new Set(fields).size, id).toBe(fields.length);
      const groups = STAGE_ORDER.flatMap((s) => groupKeys(wh, s.id));
      expect(new Set(groups).size, id).toBe(groups.length);
    }
  });

  it("退職金・企業年金: 退職給付は働き方と収入から移し、働き方と収入は読むだけの1行。iDeCo・DCの受け取りは読むだけで並べる", () => {
    const wh = open("dualAssetsTwoKids");
    const benefits = wh.request.input.household.retirementBenefits!;
    expect(benefits.length).toBeGreaterThan(0);
    for (const b of benefits) {
      expect(groupKeys(wh, "retirement")).toContain(`work/benefit/${b.id}`);
      expect(groupKeys(wh, "work")).not.toContain(`work/benefit/${b.id}`);
    }
    const workRo = allFields(itemStage(wh, "work") as StageDef).filter((f) => f.readOnly !== undefined && f.label === "退職金・企業年金");
    expect(workRo.length).toBeGreaterThan(0);
    expect(workRo[0]!.readOnly).toBe("退職金・企業年金のカードで入れます");
    // iDeCo の受け取り（物は貯蓄・運用の口座）
    const ideco = open("idecoPayout");
    const dc = (itemStage(ideco, "retirement") as StageDef).sections.find((s) => s.key === "retirement/dc");
    expect(dc).toBeDefined();
    expect(dc!.groups[0]!.fields.every((f) => f.readOnly === "貯蓄・運用のカードで入れます")).toBe(true);
    expect(dc!.groups[0]!.fields[0]!.get(ideco).value).toMatch(/から$/);
    // 「＋ 退職金を入れる」も退職金・企業年金のカード
    const civil = open("civilServant");
    const acts = (itemStage(civil, "retirement") as StageDef).sections.flatMap((s) => s.actions.map((a) => a.key));
    expect(acts.some((k) => k.endsWith("/addBenefit"))).toBe(true);
    expect((itemStage(civil, "work") as StageDef).sections.flatMap((s) => s.actions.map((a) => a.key)).some((k) => k.endsWith("/addBenefit"))).toBe(false);
  });

  it("介護・親: 世帯の外の家族は家族のカードから、介護の費用はライフイベントから移す（もとのカードは読むだけの1行）", () => {
    const wh = open("parentCare");
    const h0 = wh.request.input.household;
    const parent = h0.members.find((m) => m.kind === "parent")!;
    expect(groupKeys(wh, "care")).toContain(`family/${parent.id}`);
    expect(groupKeys(wh, "family")).not.toContain(`family/${parent.id}`);
    expect(allFields(itemStage(wh, "family") as StageDef).find((f) => f.key === "ro/family/outside")?.readOnly).toBe("介護・親のカードで入れます");
    for (const c of h0.careExpenses ?? []) {
      expect(groupKeys(wh, "care")).toContain(`ev/care/${c.id}`);
      expect(groupKeys(wh, "events")).not.toContain(`ev/care/${c.id}`);
    }
    expect(allFields(itemStage(wh, "events") as StageDef).find((f) => f.key === "ro/ev/care")?.get(wh).value).toMatch(/^2件/);
    // 親を足す・介護の費用を足すも介護・親のカード
    const acts = (itemStage(wh, "care") as StageDef).sections.flatMap((s) => s.actions.map((a) => a.key));
    expect(acts).toEqual(expect.arrayContaining(["family/add/parent", "ev/addCare"]));
    expect((itemStage(wh, "family") as StageDef).sections.flatMap((s) => s.actions.map((a) => a.key))).not.toContain("family/add/parent");
    // 介護休業（働き方の期間の物）は読むだけの1行
    const leave = open("parentalLeave");
    const lp = leave.request.input.household.employmentPeriods!.find((p) => p.type === "leave")!;
    const withCare = { ...leave, request: { ...leave.request, input: { ...leave.request.input, household: { ...leave.request.input.household, employmentPeriods: leave.request.input.household.employmentPeriods!.map((p) => (p.id === lp.id ? { ...p, leaveKind: "care" } : p)) } } } };
    const careRo = (itemStage(withCare, "care") as StageDef).sections.find((s) => s.key === "care/leaves");
    expect(careRo?.groups[0]!.fields[0]!.readOnly).toBe("働き方と収入のカードで入れます");
  });

  it("相続・贈与: 贈与する人は家族のカードから移す。子への援助・住宅資金の援助は物を今のカードに置いたまま、読むだけで並べる", () => {
    const wh = open("housingGiftFromParents");
    const h0 = wh.request.input.household;
    for (const d of h0.donors ?? []) {
      expect(groupKeys(wh, "inheritance")).toContain(`family/donor/${d.id}`);
      expect(groupKeys(wh, "family")).not.toContain(`family/donor/${d.id}`);
    }
    const stage = itemStage(wh, "inheritance") as StageDef;
    const ro = allFields(stage).filter((f) => f.readOnly !== undefined);
    expect(ro.length).toBeGreaterThan(0);
    expect(ro.some((f) => f.readOnly === "住まい・ローンのカードで入れます")).toBe(true);
    // 受け取る予定・あげる贈与のお金の行の置き場所（区画）
    expect(stage.sections.map((s) => s.key)).toEqual(expect.arrayContaining(["inherit/receive", "inherit/give", "family/donors"]));
    // 援助の物はもとのカードで入れる（読むだけの1行は書き換えない）
    for (const f of ro) expect(f.set(wh, "x")).toBe(wh);
    const edu = open("educationTwoKids");
    expect(allFields(itemStage(edu, "inheritance") as StageDef).some((f) => f.readOnly === "子ども・教育のカードで入れます")).toBe(true);
  });

  it("介護・親（仕送り・援助）と相続・贈与（受け取る予定・あげる贈与・受け継ぐ借金）のお金の行は、それぞれのカードの区画に出す（ライフイベントには出さない）", () => {
    let wh = open("parentCare");
    for (const card of ["care", "inherit"] as const) {
      const k = kindsOf(card);
      for (const x of k.incomes) wh = addIncome(wh, x.kind);
      for (const x of k.outs) wh = addExpense(wh, x.kind);
    }
    wh = addInheritedDebt(wh);
    const h0 = wh.request.input.household;
    const stageId = (c: string) => (c === "inherit" ? "inheritance" : c);
    for (const f of h0.incomeFlows ?? []) {
      const c = incomeCard(f);
      if (c !== "care" && c !== "inherit") continue;
      expect(editableKeys(wh, stageId(c)).some((k) => k.startsWith(`in/${f.id}/`)), f.kind).toBe(true);
      expect(editableKeys(wh, "events").some((k) => k.startsWith(`in/${f.id}/`)), f.kind).toBe(false);
    }
    for (const p of h0.periodicExpenses ?? []) {
      const c = expenseCard(h0, p);
      if (c !== "care" && c !== "inherit") continue;
      expect(groupKeys(wh, stageId(c)), String(p.kind)).toContain(`ev/${p.id}`);
      expect(groupKeys(wh, "events"), String(p.kind)).not.toContain(`ev/${p.id}`);
    }
    const debt = h0.debts!.find((d) => d.inheritedFrom !== undefined)!;
    expect(groupKeys(wh, "inheritance")).toContain(`inherit/debt/${debt.id}`);
    const acts = (itemStage(wh, "inheritance") as StageDef).sections.flatMap((s) => s.actions.map((x) => x.key));
    expect(acts).toEqual(expect.arrayContaining(["money/inherit/addDebt", "money/inherit/addGrandchild"]));
    expect((itemStage(wh, "events") as StageDef).sections.map((s) => s.key)).toEqual(["ev/periodic", "money/events/in"]);
    expect(byId(inputItems(wh), "inheritance").summary?.unit).toMatch(/受け取る予定/);
  });

  it("読むだけの1行は、確かめの一覧・プランの動かす項目に出ない", () => {
    const wh = open("parentCare");
    expect(checkList(wh).some((r) => r.fieldKey?.startsWith("ro/") === true)).toBe(false);
    const self = roles(wh.request).find((r) => r.key === "self")!.member;
    const cat = buildCatalog(wh, self.id, null);
    expect(cat.items.some((i) => i.key.startsWith("field:ro/"))).toBe(false);
  });

  it("カードを作っても、どのモデル世帯の要求も変わらない（物の形・世帯は変えず、見せるカードだけを変えた）", () => {
    for (const id of MODELS) {
      const wh = fromRequest(modelHousehold(id), {});
      const before = JSON.stringify(wh.request);
      inputItems(wh);
      expect(JSON.stringify(wh.request), id).toBe(before);
    }
  });
});

describe("カードの状態（4つ）", () => {
  it("未入力（0円の所あり）→ 推定で計算中 → 当てはまらない → 入力済み の順に決める", () => {
    const base = { estimated: 0, missing: 0, hasData: true, confirmed: false, none: false };
    expect(statusOf({ ...base, missing: 1, estimated: 3 })).toBe("missing");
    expect(statusOf({ ...base, estimated: 2 })).toBe("est");
    expect(statusOf({ ...base, estimated: 2, countEstimates: false })).toBe("done");
    expect(statusOf({ ...base, none: true })).toBe("na");
    expect(statusOf(base)).toBe("done");
    expect(statusOf({ ...base, hasData: false, confirmed: true })).toBe("na");
    expect(statusOf({ ...base, hasData: false })).toBe("missing");
  });

  it("モデル世帯（会社員の夫婦と子2人）: 働き方と収入（定年で辞めた後の失業給付を入れていない）・保険（終身保険の死亡保険金が無い。0055）・車・介護・親・相続・贈与が未入力。ほかは入力済み", () => {
    const wh = open("salariedCoupleTwoKids");
    const items = inputItems(wh);
    expect(items.filter((i) => i.status === "missing").map((i) => i.id)).toEqual(["work", "insurance", "car", "care", "inheritance"]);
    expect(progressOf(items)).toEqual({ total: 14, done: 9, est: 0, missing: 5, na: 0 });
    // 失業給付を「受け取らない」と決めると、働き方と収入は入力済み
    const decided = notApplicableCard(wh, "work");
    expect(byId(inputItems(decided), "work").status).toBe("done");
  });

  it("空の世帯: 家族・年金（働き方から推計）・基本生活費は推定で計算中、子がいないので子ども・教育は当てはまらない、前提条件は入力済み", () => {
    const items = inputItems(blankHousehold("2026-10", seq()));
    expect(byId(items, "family")).toMatchObject({ status: "est", estimated: 2 });
    // 基本生活費は月額の推定と、推定の段階（退職・70歳・80歳）の3段
    expect(byId(items, "living")).toMatchObject({ status: "est", estimated: 4 });
    expect(byId(items, "pension")).toMatchObject({ status: "est", estimated: 1 });
    expect(byId(items, "education").status).toBe("na");
    expect(byId(items, "assumptions").status).toBe("done");
    expect(byId(items, "insurance")).toMatchObject({ status: "missing", missing: 1 });
    expect(progressOf(items)).toEqual({ total: 14, done: 1, est: 3, missing: 9, na: 1 });
  });

  it("0円で計算している欄（未入力の印の0円）があれば、物があっても未入力（0円の所あり）", () => {
    const r = byId(inputItems(open("lifetime100Plan")), "retirement");
    expect(r.status).toBe("missing");
    expect(r.missing).toBeGreaterThan(0);
    expect(sumText(r)).toMatch(/^見込み /);
  });

  it("保存しても推定の欄が残る間は推定で計算中。推定の欄を入れ直すと入力済みになる", () => {
    const wh = blankHousehold("2026-10", seq());
    const saved = saveItem(wh, "family");
    expect(saved.confirmed).toEqual(["family"]);
    expect(byId(inputItems(saved), "family")).toMatchObject({ status: "est", estimated: 2 });
    const w1 = fieldOf(itemStage(saved, "family"), "/birth").set(saved, "1985-06");
    expect(byId(inputItems(w1), "family")).toMatchObject({ status: "est", estimated: 1 });
    const w2 = fieldOf(itemStage(w1, "family"), "/sex").set(w1, "female");
    expect(byId(inputItems(w2), "family")).toMatchObject({ status: "done", estimated: 0 });
  });

  it("物が無いカードは、保存するか「当てはまらない」を押すと当てはまらない（今の「入力済み（なし）」を名前で分けた）", () => {
    const wh = blankHousehold("2026-10", seq());
    expect(byId(inputItems(wh), "car")).toMatchObject({ status: "missing", summary: null });
    expect(byId(inputItems(saveItem(wh, "car")), "car").status).toBe("na");
    const na = notApplicableCard(wh, "insurance");
    expect(byId(inputItems(na), "insurance")).toMatchObject({ status: "na", missing: 0 });
    expect(progressOf(inputItems(na))).toMatchObject({ missing: 8, na: 2 });
  });

  it("無いと決めた物（どの子も教育費なし・勤め先に制度が無い）も当てはまらない", () => {
    const civil = open("civilServant");
    expect(byId(inputItems(civil), "retirement").status).toBe("missing");
    const na = notApplicableCard(civil, "retirement");
    expect(byId(inputItems(na), "retirement").status).toBe("na");
    expect(checkList(na).some((r) => r.card === "retirement" && r.kind === "missing")).toBe(false);
    const kids = open("highIncome");
    expect(byId(inputItems(kids), "education").status).toBe("missing");
    expect(byId(inputItems(notApplicableCard(kids, "education")), "education").status).toBe("na");
  });

  it("状態の数は、どのモデル世帯でも合計が14枚になる", () => {
    for (const id of MODELS) {
      const p = progressOf(inputItems(open(id)));
      expect(p.done + p.est + p.missing + p.na, id).toBe(14);
      expect(p.total, id).toBe(14);
    }
  });
});

describe("最初の5枚と、残りの9枚の1行の案内・1押し", () => {
  it("最初の5枚には案内を出さず、残りのカードは何で計算しているかの1行と「当てはまらない」「目安で入れる」", () => {
    const items = inputItems(blankHousehold("2026-10", seq()));
    for (const i of items.filter((x) => x.first)) expect(i.hint, i.id).toBeNull();
    expect(byId(items, "insurance")).toMatchObject({ hint: "入れなくても計算できます（保障は無しで計算中）", canNa: true, canFill: false });
    expect(byId(items, "pension")).toMatchObject({ hint: "働き方の期間から推計して計算中です", canNa: false });
    expect(byId(items, "assumptions").hint).toBeNull();
    // 正社員の退職金は「目安で入れる」で推定（統計の退職一時金）にできる
    const couple = open("dualNoKids");
    expect(byId(inputItems(couple), "retirement")).toMatchObject({ canFill: true, canNa: true });
    const filled = fillCard(couple, "retirement");
    expect(byId(inputItems(filled), "retirement").status).toBe("est");
    expect(() => preview(filled.request)).not.toThrow();
  });

  it("描画: 進み具合は未入力（0円の所あり）の数を左に強く、続けて14項目中の入力済み・推定で計算中・当てはまらない。新しい世帯に最初の5枚の案内", () => {
    const wh = blankHousehold("2026-10", seq());
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", onLevel: () => undefined }));
    expect(html).toContain('data-progress-missing="9"');
    expect(html).toMatch(/ih-prog-miss on.*未入力（0円の所あり）.*<span class="n">9<\/span>/);
    expect(html).toContain('14項目中 入力済み <span class="n">1</span>・推定で計算中 <span class="n">3</span>・当てはまらない <span class="n">1</span>');
    expect(html.indexOf("data-progress-missing")).toBeLessThan(html.indexOf("14項目中"));
    expect(html).toContain("data-first-guide");
    expect((html.match(/data-first=/g) ?? []).length).toBe(5);
    expect((html.match(/data-card=/g) ?? []).length).toBe(14);
    expect(html).toContain('data-card-na="insurance"');
    expect(html).toContain("入れなくても計算できます（保障は無しで計算中）");
    // 状態は色だけでなく文字でも
    for (const t of ["入力済み", "推定で計算中（2項目）", "未入力（0円の所あり）", "当てはまらない"]) expect(html).toContain(t);
  });

  it("描画: 最初の5枚がどれも未入力でなければ案内を出さない。FP用のメモは画面に出さない", () => {
    // 失業給付を「受け取らない」と決めて、最初の5枚をどれも未入力でなくする
    const wh = notApplicableCard(open("salariedCoupleTwoKids", ["MEMO-MARK-home"]), "work");
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", onLevel: () => undefined }));
    expect(html).not.toContain("data-first-guide");
    expect(html).toContain('data-progress-missing="4"');
    expect(html).not.toContain("MEMO-MARK-home");
    expect(html).toContain("項目を追加");
  });

  it("パネルを開いた状態（中央のパネル・背景を暗くする・保存のボタン）", () => {
    const wh = blankHousehold("2026-10", seq());
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", onLevel: () => undefined, initialOpen: "family" }));
    expect(html).toContain('class="scrim"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain("推定・仮の値のままの欄が 2つ あります。保存しても、推定の欄が残る間はカードは「推定で計算中」のままです。");
    expect(html).toContain("data-save");
  });
});

describe("ピン", () => {
  it("＋ 項目を追加: 物は種類が属するカードに作り、ホームにはピンとして出す（カードは増えない）。保存するまでは下書き", () => {
    const wh = open("salariedCoupleTwoKids");
    const r = addItem(wh, "pet", seq())!;
    expect(wh.addedItems).toEqual([]);
    expect(inputItems(r.wh)).toHaveLength(14);
    const pet = r.wh.request.input.household.periodicExpenses!.at(-1)!;
    // 物はライフイベントのカードにも出る
    expect(groupKeys(r.wh, "events")).toContain(`ev/${pet.id}`);
    const pins = pinItems(r.wh);
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ id: r.itemId, label: "ペット", art: "pet", owner: "events", status: "est", estimated: 1, planOnly: false });
    expect(sumText(pins[0]!)).toBe("年18万円");
    // ピンを押すと、その物のまとまり（と、その物の段階の表）だけが開く
    const keys = groupKeys(r.wh, r.itemId);
    expect(keys[0]).toBe(`ev/${pet.id}`);
    expect(keys.every((k) => k === `ev/${pet.id}` || k.startsWith(`ev/${pet.id}/`))).toBe(true);
    // ピンは進み具合に数えない（物が属するカードで数える）
    expect(progressOf(inputItems(r.wh)).total).toBe(14);
    expect(byId(inputItems(r.wh), "events").status).toBe("est");
    expect(() => preview(r.wh.request)).not.toThrow();
    // 額を入れると確定（入力済み）。ピンの保存はカードの保存の印を付けない
    const saved = saveItem(r.wh, r.itemId);
    expect(saved.confirmed).not.toContain(r.itemId);
    const w = fieldOf(itemStage(saved, r.itemId), "/amount").set(saved, 240000);
    expect(pinItems(w)[0]).toMatchObject({ status: "done", estimated: 0 });
  });

  it("介護の費用は介護・親、留学で子を選べば子ども・教育のその子の所に入る", () => {
    const wh = open("salariedCoupleTwoKids");
    const care = addItem(wh, "care", seq())!;
    expect(pinItems(care.wh)[0]!.owner).toBe("care");
    const opts = addOptions(wh);
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!;
    expect(opts.map((o) => o.key)).toContain(`abroad:${child.id}`);
    expect(opts.find((o) => o.key === "abroad")!.label).toBe("留学（子を選ばない）");
    const ab = addItem(wh, `abroad:${child.id}`, seq())!;
    const p = ab.wh.request.input.household.periodicExpenses!.at(-1)!;
    expect(p.from.memberAge?.member).toBe(child.id);
    expect(pinItems(ab.wh)[0]!.owner).toBe("education");
    expect(groupKeys(ab.wh, "education")).toContain(`ev/${p.id}`);
    expect(groupKeys(ab.wh, "events")).not.toContain(`ev/${p.id}`);
    expect(() => preview(ab.wh.request)).not.toThrow();
    // 子を選ばない留学はライフイベント
    const plain = addItem(wh, "abroad", seq())!;
    expect(pinItems(plain.wh)[0]!.owner).toBe("events");
    // 子を選べるのは留学だけ
    expect(addItem(wh, `pet:${child.id}`, seq())).toBeNull();
  });

  it("どのカードの物も「📌 ホームに出す」でピンにできる（ライフイベント・介護・車・FP顧問料の物）。外しても物は残る", () => {
    const wh = open("unexplainedSpending");
    const car = wh.request.input.household.cars![0]!;
    const pin = pinOfGroup(`ev/car/${car.id}`)!;
    expect(pin).toEqual({ kind: "car", ref: car.id, art: "car" });
    expect(pinOfGroup(`ev/car/${car.id}/stage/x`)).toBeNull();
    const on = togglePin(wh, pin, seq());
    expect(pinItems(on).map((p) => [p.owner, p.label])).toEqual([["car", expect.stringMatching(/^車（/)]]);
    const off = togglePin(on, pin);
    expect(off.addedItems).toEqual([]);
    expect(off.request.input.household.cars).toHaveLength(1);
  });

  it("ピンの物を外して保存すると、ピンがなくなる（物を外すのは物の所で）", () => {
    const wh = withAdded(open("salariedCoupleTwoKids"), ["periodic"]);
    const pin = pinItems(wh)[0]!;
    const stage = itemStage(wh, pin.id) as StageDef;
    const remove = stage.sections[0]!.groups[0]!.actions.find((a) => a.label === "外す")!;
    const removed = remove.run(wh);
    expect(pinItems(removed)).toEqual([]);
    expect(itemOf(removed, pin.id)?.summary).toBeNull();
    const saved = saveItem(removed, pin.id);
    expect(saved.addedItems).toEqual([]);
  });

  it("足した物の欄も、世帯データ → 入力の表示 → 世帯データ の往復で変わらない", () => {
    const wh = withAdded(open("salariedCoupleTwoKids"), ADD_OPTIONS.map((o) => o.key));
    for (const pin of pinItems(wh)) {
      const fields = allFields(itemStage(wh, pin.id) as StageDef);
      expect(fields.length, pin.label).toBeGreaterThan(2);
      for (const f of fields) expect(JSON.stringify(f.set(wh, f.get(wh).value)), f.key).toBe(JSON.stringify(wh));
    }
  });

  it("プランで足した物のピンは、そのプランの編集中だけ出る（現状のホームには出ない）。カードの違いの数は物が属するカードに数える", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const self = roles(req).find((r) => r.key === "self")!.member;
    const plan: Proposal = { id: "B", name: "プランB", createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base: null, tags: [], diffs: [] };
    const wh = { ...fromRequest(req, {}), proposals: [plan] };
    const cat = buildCatalog(wh, self.id, null);
    const view = planView(wh, cat, "B");
    const r = addItem(view, "pet", seq())!;
    const w = recordPlanEdit(wh, cat, "B", view, r.wh);
    // 現状には物が無い
    expect(w.request.input.household.periodicExpenses).toHaveLength(wh.request.input.household.periodicExpenses!.length);
    expect(pinItems(w)).toEqual([]);
    const pv = planView(w, cat, "B");
    const pins = pinItems(pv, w);
    expect(pins).toHaveLength(1);
    expect(pins[0]!.planOnly).toBe(true);
    // 違いの数はライフイベントのカード
    const rows = diffRows(w, cat, "B", planIndex([w, pv]));
    expect(countsByCard(rows).get("events")).toBe(1);
    // 保存しても、プランで足した物のピンは残る
    expect(saveItem(w, "events").addedItems).toHaveLength(1);
  });

  it("描画: ピンの列（押すとその物だけ開く・外す）", () => {
    const wh = withAdded(open("salariedCoupleTwoKids"), ["pet"]);
    const pin = pinItems(wh)[0]!;
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", onLevel: () => undefined }));
    expect(html).toContain("data-pins");
    expect(html).toContain(`data-pin="${pin.id}"`);
    expect(html).toContain(`data-unpin="${pin.id}"`);
    expect((html.match(/data-card=/g) ?? []).length).toBe(14);
    const panel = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", onLevel: () => undefined, initialOpen: pin.id }));
    expect(panel).toContain("📌 ピン");
    expect(panel).toContain("📌 ホームから外す");
  });
});

describe("古い世帯を開いても書き換えない", () => {
  it("前の版で足したカード（周期的な支出・車の記録）は、物を属するカードに出し、ピンとして見せる。開いて見るだけでは世帯は変わらない", () => {
    const body = JSON.parse(readFileSync(join(REPO_DIR, "crates", "household-store", "tests", "fixtures", "household-format", "0.18", "body.json"), "utf8")) as { household: WorkingHousehold };
    const hh = body.household.request.input.household;
    const periodic = hh.periodicExpenses![0]!;
    const car = hh.cars![0]!;
    body.household.addedItems = [
      { id: "added:old-periodic", kind: "periodic", ref: periodic.id, art: "events" },
      { id: "added:old-car", kind: "car", ref: car.id, art: "car" },
    ];
    body.household.confirmed = ["added:old-periodic", "car", "insurance"];
    const wh = fromBody(JSON.stringify(body)).wh;
    const before = JSON.stringify(wh);
    const items = inputItems(wh);
    const pins = pinItems(wh);
    for (const i of [...items, ...pins]) itemStage(wh, i.id);
    checkList(wh);
    expect(JSON.stringify(wh)).toBe(before);
    expect(items).toHaveLength(14);
    expect(pins.map((p) => p.id)).toEqual(["added:old-periodic", "added:old-car"]);
    // 物は属するカードにも出る（前は足したカードにだけ出していた）
    expect(groupKeys(wh, "events")).toContain(`ev/${periodic.id}`);
    expect(groupKeys(wh, "car")).toContain(`ev/car/${car.id}`);
    // 世帯の外の家族（親）は介護・親のカード（生年月の無い人は本文の別の区画に持つので、カードには出ない）
    for (const m of wh.request.input.household.members.filter((x) => x.kind === "parent" || x.kind === "grandparent")) expect(groupKeys(wh, "care")).toContain(`family/${m.id}`);
    expect(sumText(byId(items, "family"))).toMatch(/人（＋親1）$/);
  });
});

describe("車を複数台・FP顧問料は前提条件の中", () => {
  it("車のパネルの「＋ もう1台」で同じ欄の車を足し、カードの要約は台数と維持費の合計", () => {
    const wh = open("unexplainedSpending");
    const stage = itemStage(wh, "car") as StageDef;
    const add = stage.sections[0]!.actions.find((a) => a.key === "ev/addCar")!;
    expect(add.label).toBe("＋ もう1台（目安の値で入れる）");
    const two = add.run(wh);
    const cars = two.request.input.household.cars!;
    expect(cars).toHaveLength(2);
    const groups = (itemStage(two, "car") as StageDef).sections[0]!.groups;
    expect(groups.map((g) => g.title)).toEqual([expect.stringMatching(/^車 1（/), expect.stringMatching(/^車 2（/)]);
    const labels = (g: (typeof groups)[number]) => g.fields.filter((f) => f.level === "simple").map((f) => f.label);
    for (const l of ["買い替えの周期", "車両の価格", "下取り", "買い方", "手放す年齢（名義の人）", "次の買い替えまでの年数"]) expect(labels(groups[1]!), l).toContain(l);
    expect(cars[1]!.purchase).toMatchObject({ price: 2500000, tradeIn: 500000, everyYears: 8, owned: true });
    expect(cars[1]!.upkeep).toEqual({ annual: 360000 });
    expect(byId(inputItems(two), "car")).toMatchObject({ status: "est", estimated: 3 });
    expect(sumText(byId(inputItems(two), "car"))).toBe("2台・維持費 年54.6万円");
    const p = preview(two.request);
    for (const c of cars) expect(p.table.some((x) => x.object === c.id && x.row.startsWith("cf.expense")), c.id).toBe(true);
  });

  it("車が無いときは「＋ 車」、次の買い替えまでの年数は計算の基準の月から数えて年月に直す", () => {
    const wh = open("salariedCoupleTwoKids");
    const add = (itemStage(wh, "car") as StageDef).sections[0]!.actions[0]!;
    expect(add.label).toBe("＋ 車（目安の値で入れる）");
    const one = add.run(wh);
    const years = fieldOf(itemStage(one, "car"), "/firstIn");
    expect(years.get(one).value).toBe(3);
    const w = years.set(one, 5);
    const base = one.request.input.baseMonth;
    expect(w.request.input.household.cars![0]!.purchase.first).toEqual({ at: `${Number(base.slice(0, 4)) + 5}${base.slice(4)}` });
  });

  it("FP顧問料は前提条件のカードの中（前提条件の要約は変えない）", () => {
    const fee = open("lifetime100Plan");
    expect(sumText(byId(inputItems(fee), "assumptions"))).toMatch(/^物価 /);
    expect((itemStage(fee, "assumptions") as StageDef).sections.map((x) => x.title)).toContain("FP顧問料（単発・継続）");
    expect(ADD_OPTIONS.map((o) => o.key)).not.toContain("car");
    expect(ADD_OPTIONS.map((o) => o.key)).not.toContain("fee");
  });
});

describe("要約の数字1つ", () => {
  it("会社員の夫婦と子2人", () => {
    const items = inputItems(open("salariedCoupleTwoKids"));
    expect(sumText(byId(items, "family"))).toBe("4人");
    expect(sumText(byId(items, "work"))).toMatch(/^年収 [\d,]+万円$/);
    expect(sumText(byId(items, "retirement"))).toBe("見込み 1,800万円");
    expect(sumText(byId(items, "living"))).toBe("月30万円");
    expect(sumText(byId(items, "education"))).toBe("2人・私立あり");
    expect(sumText(byId(items, "housing"))).toBe("残高 2,240万円");
    expect(sumText(byId(items, "assumptions"))).toBe("物価 1.0%");
  });
  it("車・介護・親・相続・贈与・ほかの型", () => {
    expect(sumText(byId(inputItems(open("unexplainedSpending")), "car"))).toBe("1台・維持費 年18.6万円");
    const care = inputItems(open("parentCare"));
    expect(sumText(byId(care, "family"))).toBe("1人（＋親1）");
    expect(sumText(byId(care, "care"))).toBe("2件の介護・世帯の外 1人");
    expect(sumText(byId(inputItems(open("housingGiftFromParents")), "inheritance"))).toBe("2件の援助");
    // 相続税の目安を渡すと、それを要約にする（計算の結果から読むだけ）
    expect(sumText(byId(inputItems(open("salariedCoupleTwoKids"), { inheritance: { pre: "相続税 ", main: "かからない見込み" } }), "inheritance"))).toBe("相続税 かからない見込み");
    expect(sumText(byId(inputItems(open("marketDropAtRetirement")), "housing"))).toBe("家賃 月24万円");
    expect(sumText(byId(inputItems(open("deferral")), "pension"))).toMatch(/^月[\d.]+万円（70歳から）$/);
  });
});
