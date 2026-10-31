// 入力のホーム（0045）: 15枚のカードの並び（収益不動産を足した。0079）・物の置き場所（1つの物は1つのカードに）・カードの状態4つ・進み具合・最初の5枚と1押し・
// ピン（＋ 項目を追加・📌 ホームに出す・プランの編集中だけのピン）・古い世帯を開いても書き換えない
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { allFields, type FieldDef, type StageDef, type StageId } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
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
  startedOf,
  statusOf,
  summarySegments,
  togglePin,
  type CardLayout,
  type InputItem,
} from "../src/workspace/input/items.ts";
import { addExpense, addIncome, addInheritedDebt, expenseCard, incomeCard, kindsOf } from "../src/workspace/input/moneyRows.ts";
import { STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
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
const LABELS = ["家族", "働き方と収入", "退職金・企業年金", "年金", "基本生活費", "子ども・教育", "住まい・ローン", "保険", "貯蓄・運用", "収益不動産", "ライフイベント", "車", "介護・親", "相続・贈与", "前提条件"];

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

describe("15枚のカードと並び", () => {
  it("入力のホームの順に15枚（もとの10項目の相対の順番は変えず、車と新しい3枚・収益不動産を間に入れた）。FP顧問料はカードにしない", () => {
    const items = inputItems(open("salariedCoupleTwoKids"));
    expect(items.map((i) => i.label)).toEqual(LABELS);
    expect(STAGE_ORDER.map((s) => s.label)).toEqual(LABELS);
    expect(items.some((i) => i.id === "fee")).toBe(false);
    // もとの順番（家族→働き方と収入→年金→基本生活費→子ども・教育→住まい・ローン→保険→貯蓄・運用→ライフイベント→前提条件）の相対
    const old = ["家族", "働き方と収入", "年金", "基本生活費", "子ども・教育", "住まい・ローン", "保険", "貯蓄・運用", "ライフイベント", "前提条件"];
    expect(LABELS.filter((l) => old.includes(l))).toEqual(old);
  });

  it("事務所の設定で並べ替えられる（設定に無いカードは標準の順で後ろに。どのカードも1回）。最初の5枚の考えは無い", () => {
    expect(DEFAULT_LAYOUT).toEqual({ order: cardOrder() });
    const layout: CardLayout = { order: ["assumptions", "family", "family", "nope" as StageId] };
    const order = cardOrder(layout);
    expect(order.slice(0, 2)).toEqual(["assumptions", "family"]);
    expect(order).toHaveLength(15);
    expect(new Set(order).size).toBe(15);
    const items = inputItems(blankHousehold("2026-10", seq()), { layout });
    expect(items[0]!.id).toBe("assumptions");
    expect(items.every((i) => !("first" in i))).toBe(true);
  });

  it("15枚のときは見出しを出さない。ピンは何枚足してもカードの数に入れない", () => {
    const wh = withAdded(open("salariedCoupleTwoKids"), ["pet", "abroad", "periodic", "care", "pet"]);
    const items = inputItems(wh);
    expect(items).toHaveLength(15);
    expect(items.length).toBeLessThan(GROUP_HEADINGS_FROM);
    expect(groupedItems(items).map((g) => g.group)).toEqual([null]);
    expect(pinItems(wh)).toHaveLength(5);
  });
});

describe("物の置き場所（1つの物は1つのカードにだけ。ほかは読むだけの1行）", () => {
  it("どのモデル世帯でも、入れられる欄のキーとまとまりのキーは15枚の中で重ならない", () => {
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
      expect(groupKeys(wh, "retirement")).toContain(`retirement/${b.id}`);
      expect(groupKeys(wh, "work").some((k) => k.includes(b.id))).toBe(false);
    }
    const workRo = allFields(itemStage(wh, "work") as StageDef).filter((f) => f.readOnly !== undefined && f.label === "退職金・企業年金");
    expect(workRo.length).toBeGreaterThan(0);
    expect(workRo[0]!.readOnly).toBe("退職金・企業年金の項目で入れます");
    // iDeCo の受け取り（物は貯蓄・運用の口座）
    const ideco = open("idecoPayout");
    const dc = (itemStage(ideco, "retirement") as StageDef).sections.find((s) => s.key === "retirement/dc");
    expect(dc).toBeDefined();
    expect(dc!.groups[0]!.fields.every((f) => f.readOnly === "貯蓄・運用の項目で入れます")).toBe(true);
    expect(dc!.groups[0]!.fields[0]!.get(ideco).value).toMatch(/から$/);
    // 「＋ 退職金・企業年金を足す」も退職金・企業年金のカード
    const civil = open("civilServant");
    const acts = (itemStage(civil, "retirement") as StageDef).sections.flatMap((s) => s.actions.map((a) => a.key));
    expect(acts.some((k) => k.endsWith("/add") && k.startsWith("retirement/"))).toBe(true);
    expect((itemStage(civil, "work") as StageDef).sections.flatMap((s) => s.actions.map((a) => a.key)).some((k) => k.startsWith("retirement/"))).toBe(false);
  });

  it("介護・親: 世帯の外の家族は家族のカードから、介護の費用はライフイベントから移す（もとのカードは読むだけの1行）", () => {
    const wh = open("parentCare");
    const h0 = wh.request.input.household;
    const parent = h0.members.find((m) => m.kind === "parent")!;
    expect(groupKeys(wh, "care")).toContain(`family/${parent.id}`);
    expect(groupKeys(wh, "family")).not.toContain(`family/${parent.id}`);
    expect(allFields(itemStage(wh, "family") as StageDef).find((f) => f.key === "ro/family/outside")?.readOnly).toBe("介護・親の項目で入れます");
    for (const c of h0.careExpenses ?? []) {
      expect(groupKeys(wh, "care")).toContain(`ev/care/${c.id}`);
      expect(groupKeys(wh, "events")).not.toContain(`ev/care/${c.id}`);
    }
    // 介護の費用はライフイベントの出るお金には出さず、「この世帯の予定」に介護の始まりとして読むだけ（0068）
    expect(allFields(itemStage(wh, "events") as StageDef).find((f) => f.key === "ro/ev/care")).toBeUndefined();
    expect(allFields(itemStage(wh, "events") as StageDef).some((f) => f.key.startsWith("ro/events/schedule/") && String(f.get(wh).value).startsWith("介護の始まり"))).toBe(true);
    // 親を足す・介護の費用を足すも介護・親のカード
    const acts = (itemStage(wh, "care") as StageDef).sections.flatMap((s) => s.actions.map((a) => a.key));
    expect(acts).toEqual(expect.arrayContaining(["family/add/father", "ev/addCare"]));
    expect((itemStage(wh, "family") as StageDef).sections.flatMap((s) => s.actions.map((a) => a.key))).not.toContain("family/add/father");
    // 介護休業（働き方の期間の物）は読むだけの1行
    const leave = open("parentalLeave");
    const lp = leave.request.input.household.employmentPeriods!.find((p) => p.type === "leave")!;
    const withCare = { ...leave, request: { ...leave.request, input: { ...leave.request.input, household: { ...leave.request.input.household, employmentPeriods: leave.request.input.household.employmentPeriods!.map((p) => (p.id === lp.id ? { ...p, leaveKind: "care" } : p)) } } } };
    const careRo = (itemStage(withCare, "care") as StageDef).sections.find((s) => s.key === "care/leaves");
    expect(careRo?.groups[0]!.fields[0]!.readOnly).toBe("働き方と収入の項目で入れます");
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
    expect(ro.some((f) => f.readOnly === "住まい・ローンの項目で入れます")).toBe(true);
    // 受け取る予定・あげる贈与のお金の行の置き場所（区画）
    expect(stage.sections.map((s) => s.key)).toEqual(expect.arrayContaining(["inherit/receive", "inherit/give", "family/donors"]));
    // 援助の物はもとのカードで入れる（読むだけの1行は書き換えない）
    for (const f of ro) expect(f.set(wh, "x")).toBe(wh);
    const edu = open("educationTwoKids");
    expect(allFields(itemStage(edu, "inheritance") as StageDef).some((f) => f.readOnly === "子ども・教育の項目で入れます")).toBe(true);
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
    expect((itemStage(wh, "events") as StageDef).sections.map((s) => s.key)).toEqual(["ev/periodic", "money/events/in", "events/schedule"]);
    // 主な表示は入れた中身（受け取る予定の行は額が0円のままなので、あげる贈与の額だけ。0060 の 2026-10-29 の追記）
    expect(sumText(byId(inputItems(wh), "inheritance"))).toBe("贈与 110万円");
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

  it("モデル世帯（会社員の夫婦と子2人）: 働き方と収入（定年で辞めた後の失業給付を入れていない）・保険（終身保険の死亡保険金が無い。0055）が未入力、車・介護・親・相続・贈与はまだ入れていない。ほかは入力済み", () => {
    const wh = open("salariedCoupleTwoKids");
    const items = inputItems(wh);
    expect(items.filter((i) => i.status === "missing").map((i) => i.id)).toEqual(["work", "insurance"]);
    expect(items.filter((i) => i.status === "empty").map((i) => i.id)).toEqual(["rental", "car", "care", "inheritance"]);
    // 子ども・教育の学費の統計の平均（学校の種類で決まる推定）は数えないので、進路を入れた子ども・教育は入力済み（0062 の追記 2026-10-31）
    expect(byId(items, "education").status).toBe("done");
    expect(progressOf(items)).toEqual({ total: 15, done: 9, est: 0, missing: 2, na: 0, empty: 4 });
    // 失業給付を「受け取らない」と決めると、働き方と収入は入力済み
    const decided = notApplicableCard(wh, "work");
    expect(byId(inputItems(decided), "work").status).toBe("done");
  });

  it("空の世帯: 家族・年金（働き方から推計）・基本生活費は推定で計算中、子がいないので子ども・教育は当てはまらない、前提条件は入力済み", () => {
    const items = inputItems(blankHousehold("2026-10", seq()));
    // 家族は生年月の仮の値だけ（性別は推定にしない）
    expect(byId(items, "family")).toMatchObject({ status: "est", estimated: 1 });
    // 基本生活費は月額の推定と、推定の段階（退職・70歳・80歳）の3段
    expect(byId(items, "living")).toMatchObject({ status: "est", estimated: 4 });
    expect(byId(items, "pension")).toMatchObject({ status: "est", estimated: 1 });
    expect(byId(items, "education").status).toBe("na");
    expect(byId(items, "assumptions").status).toBe("done");
    // 入れ始める前の項目は、入っていない物があっても「まだ入れていない」（赤い数に入れない。0045 の追記）
    expect(byId(items, "insurance")).toMatchObject({ status: "empty", missing: 1 });
    expect(progressOf(items)).toEqual({ total: 15, done: 1, est: 3, missing: 0, na: 1, empty: 10 });
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
    expect(byId(inputItems(saved), "family")).toMatchObject({ status: "est", estimated: 1 });
    const w1 = fieldOf(itemStage(saved, "family"), "/birth").set(saved, "1985-06");
    expect(byId(inputItems(w1), "family")).toMatchObject({ status: "done", estimated: 0 });
    // 性別を直しても、推定の数・状態は変わらない（性別は推定にしない）
    const w2 = fieldOf(itemStage(w1, "family"), "/sex").set(w1, "female");
    expect(byId(inputItems(w2), "family")).toMatchObject({ status: "done", estimated: 0 });
  });

  it("物が無いカードは、保存するか「当てはまらない」を押すと当てはまらない（今の「入力済み（なし）」を名前で分けた）", () => {
    const wh = blankHousehold("2026-10", seq());
    expect(byId(inputItems(wh), "car")).toMatchObject({ status: "empty", summary: null });
    expect(byId(inputItems(saveItem(wh, "car")), "car").status).toBe("na");
    const na = notApplicableCard(wh, "insurance");
    expect(byId(inputItems(na), "insurance")).toMatchObject({ status: "na", missing: 0 });
    expect(progressOf(inputItems(na))).toMatchObject({ missing: 0, empty: 9, na: 2 });
  });

  it("無いと決めた物（どの子も教育費なし・勤め先に制度が無い）も当てはまらない", () => {
    const civil = open("civilServant");
    expect(byId(inputItems(civil), "retirement").status).toBe("empty");
    const na = notApplicableCard(civil, "retirement");
    expect(byId(inputItems(na), "retirement").status).toBe("na");
    expect(checkList(na).some((r) => r.card === "retirement" && (r.kind === "missing" || r.kind === "notStarted"))).toBe(false);
    const kids = open("highIncome");
    expect(byId(inputItems(kids), "education").status).toBe("empty");
    expect(byId(inputItems(notApplicableCard(kids, "education")), "education").status).toBe("na");
  });

  it("状態の数は、どのモデル世帯でも合計が15枚になる", () => {
    for (const id of MODELS) {
      const p = progressOf(inputItems(open(id)));
      expect(p.done + p.est + p.missing + p.na + p.empty, id).toBe(15);
      expect(p.total, id).toBe(15);
    }
  });
});

describe("入れ始めた項目だけに抜けを知らせる（0045 の追記）", () => {
  const housingAction = (wh: WorkingHousehold, key: string): WorkingHousehold => {
    const st = itemStage(wh, "housing") as StageDef;
    const a = st.sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]).find((x) => x.key.endsWith(key));
    if (a === undefined) throw new Error(key);
    return a.run(wh);
  };

  it("入れ始めたかは世帯の今の情報で決める: 物がある・保存した／当てはまらない・無いと決めてある・FP が入れた印の欄・0円の欄のどれか", () => {
    const none = { hasData: false, confirmed: false, none: false, touched: 0, fieldMissing: 0 };
    expect(startedOf(none)).toBe(false);
    for (const k of ["hasData", "confirmed", "none"] as const) expect(startedOf({ ...none, [k]: true }), k).toBe(true);
    expect(startedOf({ ...none, touched: 1 })).toBe(true);
    expect(startedOf({ ...none, fieldMissing: 1 })).toBe(true);
    // まだ入れていないのは、未入力に当たるときだけ（推定・当てはまらない・入力済みはそのまま）
    const base = { estimated: 0, missing: 0, hasData: false, confirmed: false, none: false, started: false };
    expect(statusOf({ ...base, missing: 1 })).toBe("empty");
    expect(statusOf(base)).toBe("empty");
    expect(statusOf({ ...base, estimated: 1 })).toBe("est");
    expect(statusOf({ ...base, missing: 1, started: true })).toBe("missing");
    expect(statusOf({ ...base, missing: 1, started: undefined } as Parameters<typeof statusOf>[0])).toBe("missing");
  });

  it("新しい世帯: どの項目にも赤い札を出さず、入っていない物のある住まい・ローン・保険・介護・親も「まだ入れていない」。世帯は変えない", () => {
    const wh = blankHousehold("2026-10", seq());
    const before = JSON.stringify(wh);
    const items = inputItems(wh);
    expect(items.filter((i) => i.status === "missing")).toEqual([]);
    expect(items.filter((i) => i.status === "empty").map((i) => i.id)).toEqual(["work", "retirement", "housing", "insurance", "savings", "rental", "events", "car", "care", "inheritance"]);
    for (const id of ["housing", "insurance", "care"]) expect(byId(items, id).missing, id).toBe(1);
    expect(JSON.stringify(wh)).toBe(before);
  });

  it("住まい・ローン: 入れ始める（ローンを足す）と、0円で計算している欄で未入力（0円の所あり）。1欄入れても抜けが残る間は未入力", () => {
    const wh = blankHousehold("2026-10", seq());
    expect(byId(inputItems(wh), "housing").status).toBe("empty");
    const loan = housingAction(wh, "add/cardLoan");
    expect(byId(inputItems(loan), "housing")).toMatchObject({ status: "missing" });
    const balance = allFields(itemStage(loan, "housing") as StageDef).find((f) => f.key.endsWith("/balance")) as FieldDef;
    const one = balance.set(loan, 500000);
    const item = byId(inputItems(one), "housing");
    expect(item.status).toBe("missing");
    expect(item.missing).toBeGreaterThan(0);
    // 確かめの一覧: 入れ始めた項目の入っていない物（住居費）と0円の欄は「未入力」に戻る
    const rows = checkList(one).filter((r) => r.card === "housing");
    expect(rows.find((r) => r.id === "gap:housing")?.kind).toBe("missing");
    expect(rows.some((r) => r.kind === "missing" && r.fieldKey?.endsWith("/payment") === true)).toBe(true);
  });

  it("目安で入れる・当てはまらない・保存を押すと、まだ入れていないから抜ける", () => {
    const wh = blankHousehold("2026-10", seq());
    expect(["est", "done"]).toContain(byId(inputItems(fillCard(wh, "care")), "care").status);
    expect(byId(inputItems(notApplicableCard(wh, "car")), "car").status).toBe("na");
    expect(byId(inputItems(saveItem(wh, "events")), "events").status).toBe("na");
  });

  it("確かめの一覧: まだ入れていない項目の行は警告（未入力）でなく「まだ入れていない項目」にまとめ、入っていない物の無い項目も1行ずつ出す", () => {
    const wh = blankHousehold("2026-10", seq());
    const rows = checkList(wh);
    expect(rows.filter((r) => r.kind === "missing")).toEqual([]);
    const ns = rows.filter((r) => r.kind === "notStarted");
    expect(ns.map((r) => r.id)).toEqual([
      "notStarted:work",
      "notStarted:retirement",
      "gap:housing",
      "gap:insurance",
      "notStarted:savings",
      "notStarted:rental",
      "notStarted:events",
      "notStarted:car",
      `gap:care/${wh.request.input.household.members[0]!.id}`,
      "notStarted:inheritance",
    ]);
    // 操作（推定で埋める・該当なし）は残す
    expect(ns.find((r) => r.id === "gap:housing")!.actions.map((a) => a.key)).toEqual(["fill", "none"]);
    expect(ns.find((r) => r.id === "notStarted:car")!.detail).toBe("入れなくても計算できます（車は無しで計算中）");
    // 未入力のすぐ下（推定より上）
    expect(rows.findIndex((r) => r.kind === "notStarted")).toBeLessThan(rows.findIndex((r) => r.kind === "estimated"));
  });

  it("描画: まだ入れていない項目のパネルは見出しに札を出さず、赤い帯の代わりに目安と「該当なし」の操作だけ。入れ始めると札と帯で知らせる", () => {
    const wh = blankHousehold("2026-10", seq());
    const panel = (w: WorkingHousehold) => {
      const html = renderToString(h(InputView, { wh: w, onSave: () => undefined, level: "simple", initialOpen: "housing" }));
      return html.slice(html.indexOf('class="ipanel'));
    };
    const quiet = panel(wh);
    expect(quiet).toContain('data-gaps="quiet"');
    expect(quiet).not.toContain("未入力（0円で計算中）の所があります");
    expect(quiet).not.toContain("住まいが入っていないので");
    expect(quiet).not.toContain("ih-st missing");
    expect(quiet).toContain("推定で埋める");
    expect(quiet).toContain("該当なし（住居費なし）");
    const started = panel(housingAction(wh, "add/cardLoan"));
    expect(started).toContain('data-gaps="alert"');
    expect(started).toContain("未入力（0円で計算中）の所があります");
    expect(started).toContain('<span class="ih-st missing">未入力（0円の所あり）</span>');
  });
});

describe("カードの1行の案内・1押し（どの項目も同じ決まり。最初の5枚の区別はなくした）", () => {
  it("未入力・推定のカードは何で計算しているかの1行と「当てはまらない」「目安で入れる」。家族・基本生活費・前提条件に「当てはまらない」は出さない", () => {
    const items = inputItems(blankHousehold("2026-10", seq()));
    for (const id of ["family", "living", "assumptions"]) expect(byId(items, id).canNa, id).toBe(false);
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

  it("描画: 進み具合は未入力（0円の所あり）の数を左に強く、続けて15項目中の入力済み・推定で計算中・当てはまらない・まだ入れていない。最初の5枚の案内と印は出さない", () => {
    const wh = blankHousehold("2026-10", seq());
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple" }));
    // 新しい世帯は、まだ何も入れていない項目を赤い数に入れない（0045 の追記）
    expect(html).toContain('data-progress-missing="0"');
    expect(html).not.toContain("ih-prog-miss on");
    // 状態ごとの数は押すとそのカードだけに絞るボタン（0072）
    expect(html.replace(/<button[^>]*>|<\/button>/g, "")).toContain('15項目中 入力済み <span class="n">1</span>・推定で計算中 <span class="n">3</span>・当てはまらない <span class="n">1</span>・まだ入れていない <span class="n">10</span>');
    expect(html).toContain('data-progress-filter="est"');
    expect(html.indexOf("data-progress-missing")).toBeLessThan(html.indexOf("15項目中"));
    expect(html).not.toContain("data-first-guide");
    expect(html).not.toContain("data-first=");
    expect(html).not.toContain("最初の5");
    expect((html.match(/data-card=/g) ?? []).length).toBe(15);
    expect(html).toContain('data-card-na="insurance"');
    expect(html).toContain("入れなくても計算できます（保障は無しで計算中）");
    // 状態は色だけでなく文字でも
    for (const t of ["入力済み", "推定で計算中（1項目）", "当てはまらない", "まだ入っていません"]) expect(html).toContain(t);
    // まだ入れていない項目のカードには赤い札を出さない（点線の枠は灰色。s-empty）
    expect(html).not.toContain("ih-st missing mini\">未入力（0円の所あり）</span></span></button>");
    expect((html.match(/ih-card s-empty/g) ?? []).length).toBe(10);
    expect(html).not.toContain("ih-card s-missing");
  });

  it("描画: FP用のメモは画面に出さない", () => {
    // 失業給付を「受け取らない」と決めて、働き方と収入を未入力でなくする
    const wh = notApplicableCard(open("salariedCoupleTwoKids", ["MEMO-MARK-home"]), "work");
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple" }));
    expect(html).toContain('data-progress-missing="1"');
    expect(html).not.toContain("MEMO-MARK-home");
    expect(html).toContain("項目を追加");
  });

  it("パネルを開いた状態（中央のパネル・背景を暗くする・保存のボタン）", () => {
    const wh = blankHousehold("2026-10", seq());
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", initialOpen: "family" }));
    expect(html).toContain('class="scrim"');
    expect(html).toContain('role="dialog"');
    // 保存の下は状態だけ。保存すると何が起きるかは「?」の中（0077）
    expect(html).toContain("推定・仮の値のままの欄: 1つ");
    expect(html).toContain("保存しても、推定の欄が残る間は項目は「推定で計算中」のままです。");
    expect(html).toContain("data-save");
  });
});

describe("ピン", () => {
  it("＋ 項目を追加: 物は種類が属するカードに作り、ホームにはピンとして出す（カードは増えない）。保存するまでは下書き", () => {
    const wh = open("salariedCoupleTwoKids");
    const r = addItem(wh, "pet", seq())!;
    expect(wh.addedItems).toEqual([]);
    expect(inputItems(r.wh)).toHaveLength(15);
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
    expect(progressOf(inputItems(r.wh)).total).toBe(15);
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
    // 子を選んだ留学は、子ども・教育のカードのその子の留学（1回ずつ）を足してカードを開く（ピンにしない。0090）
    const ab = addItem(wh, `abroad:${child.id}`, seq())!;
    expect(ab.itemId).toBe("education");
    expect(pinItems(ab.wh)).toEqual([]);
    const goal = (ab.wh.request.input.household.goals ?? []).find((g) => g.kind === "education" && g.owner === child.id)!;
    expect(goal.education!.abroad!.length).toBe(1);
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
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple" }));
    expect(html).toContain("data-pins");
    expect(html).toContain(`data-pin="${pin.id}"`);
    expect(html).toContain(`data-unpin="${pin.id}"`);
    expect((html.match(/data-card=/g) ?? []).length).toBe(15);
    const panel = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", initialOpen: pin.id }));
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
    expect(items).toHaveLength(15);
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
    expect(add.label).toBe("＋ もう1台（今の車）");
    const two = add.run(wh);
    const cars = two.request.input.household.cars!;
    expect(cars).toHaveLength(2);
    // 車ごとの見出しのまとまり（内訳で入れている車は、詳細に内訳の行のまとまりが続く）
    const groups = (itemStage(two, "car") as StageDef).sections[0]!.groups.filter((g) => g.title?.startsWith("車 ") === true);
    expect(groups.map((g) => g.title)).toEqual([expect.stringMatching(/^車 1（/), expect.stringMatching(/^車 2（/)]);
    const labels = (g: (typeof groups)[number]) => g.fields.filter((f) => f.level === "simple").map((f) => f.label);
    for (const l of ["買い替えの周期", "車両の価格", "買い方", "手放す時期", "次の買い替えの時期", "維持費（年額の合計）"]) expect(labels(groups[1]!), l).toContain(l);
    // 下取りは詳細（0069）。目安は価格×周期の残価の目安（8年で15%）
    expect(labels(groups[1]!)).not.toContain("下取り");
    expect(cars[1]!.purchase).toMatchObject({ price: 2500000, tradeIn: 380000, everyYears: 8, owned: true });
    expect(cars[1]!.upkeep).toEqual({ annual: 360000 });
    expect(cars[1]!.upkeepMode).toBe("total");
    // 推定: 次の買い替えの時期・周期・価格・下取り・維持費
    expect(byId(inputItems(two), "car")).toMatchObject({ status: "est", estimated: 5 });
    expect(sumText(byId(inputItems(two), "car"))).toBe("2台・維持費 年54.6万円");
    const p = preview(two.request);
    for (const c of cars) expect(p.table.some((x) => x.object === c.id && x.row.startsWith("cf.expense")), c.id).toBe(true);
  });

  it("車が無いときは「＋ 今の車」「＋ これから買う車」。次の買い替えの時期は時点の部品（今から○年後は年月に直す）で、3年後の推定", () => {
    const wh = open("salariedCoupleTwoKids");
    const acts = (itemStage(wh, "car") as StageDef).sections[0]!.actions;
    expect(acts.map((a) => a.label)).toEqual(["＋ 今の車", "＋ これから買う車"]);
    const one = acts[0]!.run(wh);
    const first = fieldOf(itemStage(one, "car"), "/first");
    const base = one.request.input.baseMonth;
    const in3 = `${Number(base.slice(0, 4)) + 3}${base.slice(4)}`;
    expect(first.get(one).value).toBe(in3);
    expect(fieldStatus(first, one).status).toBe("estimated");
    const w = first.set(one, `${Number(base.slice(0, 4)) + 5}${base.slice(4)}`);
    expect(w.request.input.household.cars![0]!.purchase.first).toEqual({ at: `${Number(base.slice(0, 4)) + 5}${base.slice(4)}` });
    expect(fieldStatus(first, w).status).toBe("confirmed");
    expect(fieldOf(itemStage(one, "car"), "/firstIn")).toBeUndefined();
    // これから買う車は owned なし（購入の時期）
    const later = acts[1]!.run(wh);
    expect(later.request.input.household.cars![0]!.purchase.owned).toBe(false);
  });

  it("FP顧問料は前提条件のカードの中（前提条件の要約は変えない）", () => {
    const fee = open("lifetime100Plan");
    expect(sumText(byId(inputItems(fee), "assumptions"))).toMatch(/^物価 /);
    expect((itemStage(fee, "assumptions") as StageDef).sections.map((x) => x.title)).toContain("FP顧問料");
    expect(ADD_OPTIONS.map((o) => o.key)).not.toContain("car");
    expect(ADD_OPTIONS.map((o) => o.key)).not.toContain("fee");
  });
});

describe("要約の数字1つ", () => {
  it("相続・贈与: 受け取る予定と贈与の額を短く1〜2つ。相続税の目安は下の小さな1行。何も入れていなければ「まだ入っていません」で、小さな1行も出さない", () => {
    const setAmount = (w: WorkingHousehold, id: string, yen: number, yearly = false) =>
      mutate(w, (hh) => {
        const x = [...(hh.incomeFlows ?? []), ...(hh.periodicExpenses ?? [])].find((f) => f.id === id)!;
        x.amount = { ...x.amount, value: yen };
        if (yearly) x.to = null;
      });
    const base = blankHousehold("2026-10", seq());
    let wh = addIncome(base, "inheritance", "inh1");
    wh = setAmount(wh, "inh1", 30_000_000);
    const opts = { inheritanceTax: "相続税: 約120万円" };
    const one = byId(inputItems(wh, opts), "inheritance");
    expect(sumText(one)).toBe("受け取る予定 3,000万円");
    expect(one.summary?.note).toBe("相続税: 約120万円");
    wh = setAmount(addExpense(wh, "gift", "g1"), "g1", 1_100_000, true);
    expect(sumText(byId(inputItems(wh, opts), "inheritance"))).toBe("受け取る予定 3,000万円・贈与 年110万円");
    // あげる贈与だけ
    expect(sumText(byId(inputItems(setAmount(addExpense(base, "gift", "g2"), "g2", 1_100_000, true)), "inheritance"))).toBe("贈与 年110万円");
    // 何も入れていない: 要約は無し（カードは「まだ入っていません」）。相続税の小さな1行も出さない
    const empty = byId(inputItems(base, opts), "inheritance");
    expect(empty.summary).toBeNull();
    const html = renderToString(h(InputView, { wh: base, onSave: () => undefined, level: "simple" }));
    expect(html).not.toContain('data-note="inheritance"');
  });

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
    // 相続税の目安は要約にしない。入れた中身があるときだけ、下の小さな1行にする（0060 の 2026-10-29 の追記）
    const gift = byId(inputItems(open("housingGiftFromParents"), { inheritanceTax: "相続税: かからない見込み" }), "inheritance");
    expect(sumText(gift)).toBe("2件の援助");
    expect(gift.summary?.note).toBe("相続税: かからない見込み");
    const blank = byId(inputItems(open("salariedCoupleTwoKids"), { inheritanceTax: "相続税: かからない見込み" }), "inheritance");
    expect(blank.summary).toBeNull();
    expect(sumText(byId(inputItems(open("marketDropAtRetirement")), "housing"))).toBe("家賃 月24万円");
    expect(sumText(byId(inputItems(open("deferral")), "pension"))).toMatch(/^月[\d.]+万円（70歳から）$/);
  });
});

describe("ホームの要約は「・」の区切りでだけ改行する（0045 の 2026-10-29 の追記）", () => {
  const texts = (s: Parameters<typeof summarySegments>[0]) => summarySegments(s).map((g) => g.map((p) => p.text).join(""));
  it("「・」で区切ったまとまりに分け、「・」は前のまとまりに付ける。見た目の違う一片（数字と単位）は保つ", () => {
    expect(texts({ pre: "受け取る予定 ", main: "3,000", unit: "万円・贈与 年110万円" })).toEqual(["受け取る予定 3,000万円・", "贈与 年110万円"]);
    expect(texts({ main: "1", unit: "台・維持費 年36万円" })).toEqual(["1台・", "維持費 年36万円"]);
    expect(summarySegments({ main: "1", unit: "台・維持費 年36万円" })).toEqual([
      [
        { text: "1", small: false },
        { text: "台・", small: true },
      ],
      [{ text: "維持費 年36万円", small: true }],
    ]);
    // 区切りの無い要約は1つのまとまり。かっこはひとまとまりにしてその前で分け、かっこの中の「・」では分けない
    expect(texts({ pre: "年収 ", main: "720", unit: "万円" })).toEqual(["年収 720万円"]);
    expect(texts({ main: "2", unit: "件（受け取る予定・あげる贈与）" })).toEqual(["2件", "（受け取る予定・あげる贈与）"]);
    expect(texts({ pre: "夫婦で月", main: "39.1", unit: "万円（65歳から・推定）" })).toEqual(["夫婦で月39.1万円", "（65歳から・推定）"]);
    expect(texts({ main: "3", unit: "件の介護・世帯の外 1人" })).toEqual(["3件の介護・", "世帯の外 1人"]);
  });
  it("ホームの入力項目の要約は、まとまりごとの要素の間に改行できる位置を置く", () => {
    const wh = open("unexplainedSpending");
    expect(sumText(byId(inputItems(wh), "car"))).toBe("1台・維持費 年18.6万円");
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple" }));
    expect(html).toMatch(/<span class="sum-seg">1<small>台・<\/small><\/span><wbr\/?><span class="sum-seg"><small>維持費 年18.6万円<\/small><\/span>/);
  });
});
