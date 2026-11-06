// 見張る世帯: 見本の棚の全部の世帯、data/modelHouseholds の世帯、入力の画面の操作（欄・ボタン）をそのまま関数で行って作る世帯。
// 入力の操作で作る世帯は、FP がよくする操作の後の形（新しい顧客を会社員として入れる・購入の予定を足す・資産配分に切り替える など）。
// 操作は画面の部品と同じ欄の定義とボタン（buildStage）で行い、欄・ボタンの後に推定を入れ直す（入力のパネルと同じ）
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineRequest } from "../../src/engine/types.ts";
import { DEMO_HOUSEHOLDS } from "../../src/workspace/catalog.ts";
import { applyImport, approvalTime, importSheet } from "../../src/workspace/hearing/sheet.ts";
import { withRefreshedEstimates } from "../../src/workspace/input/estimates.ts";
import { allFields, type FieldDef, type StageId, type Val } from "../../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../../src/workspace/input/household.ts";
import { switchMethod } from "../../src/workspace/input/savings/model.ts";
import { buildStage } from "../../src/workspace/input/stages/index.ts";
import { buildCatalog } from "../../src/workspace/plans/items.ts";
import { planView, recordPlanEdit } from "../../src/workspace/plans/planEdit.ts";
import { roles } from "../../src/workspace/roles.ts";
import { REPO_DIR } from "../../scripts/lib.ts";
import { modelHousehold } from "../helpers.ts";

/** 見張る世帯の作り方 */
export interface WatchCase {
  /** 見分ける名前（直す待ちの一覧の鍵。見本は「見本 3-4-01」、モデル世帯は「モデル salariedCoupleTwoKids」、操作は「操作 …」） */
  name: string;
  /** 取り込んだ世帯（ヒアリングシートから）。取り込みの形だけで見る決まりがある */
  imported?: boolean;
  build: () => Promise<WorkingHousehold> | WorkingHousehold;
}

const BASE = "2026-10";
let seq = 0;
const ids = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;

// ---- 入力の画面の操作（欄の定義とボタン） ----

const fieldsOf = (wh: WorkingHousehold, stage: StageId): FieldDef[] => allFields(buildStage(stage, wh));

/** 欄を探す（鍵そのものか、鍵の終わり・条件で） */
export function fieldOf(wh: WorkingHousehold, stage: StageId, key: string | ((f: FieldDef) => boolean)): FieldDef {
  const f = fieldsOf(wh, stage).find((x) => (typeof key === "string" ? x.key === key || x.key.endsWith(key) : key(x)));
  if (f === undefined) throw new Error(`欄が無い: ${stage} ${String(key)}`);
  return f;
}

/** 欄に値を入れる（入力のパネルと同じく、後で推定を入れ直す） */
export function put(wh: WorkingHousehold, stage: StageId, key: string | ((f: FieldDef) => boolean), v: Val): WorkingHousehold {
  return withRefreshedEstimates(fieldOf(wh, stage, key).set(wh, v));
}

/** ボタンを押す（区画のボタンとまとまりのボタン） */
export function press(wh: WorkingHousehold, stage: StageId, key: string | ((k: string) => boolean)): WorkingHousehold {
  const st = buildStage(stage, wh);
  const a = st.sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).find((x) => (typeof key === "string" ? x.key === key : key(x.key)));
  if (a === undefined) throw new Error(`ボタンが無い: ${stage} ${String(key)}`);
  return withRefreshedEstimates(a.run(wh));
}

const open = (id: string): WorkingHousehold => withRefreshedEstimates(fromRequest(modelHousehold(id)));
const memberId = (wh: WorkingHousehold, kind: string): string => {
  const m = wh.request.input.household.members.find((x) => x.kind === kind);
  if (m === undefined) throw new Error(`家族が無い: ${kind}`);
  return m.id;
};

/** 新しい顧客（ご本人だけ）。生年月を入れる */
function newCustomer(birth: string): WorkingHousehold {
  const wh = withRefreshedEstimates(blankHousehold(BASE, ids));
  const self = memberId(wh, "self");
  return put(wh, "family", `family/${self}/birth`, birth);
}

// ---- 入力の操作で作る世帯 ----

const OPERATIONS: readonly WatchCase[] = [
  {
    // 60歳の新しい顧客を「会社員として入れる」: 定年（60歳）が計算の基準の月より前になる
    name: "操作 60歳の新しい顧客を会社員として入れる",
    build: () => {
      const wh = newCustomer("1966-06");
      return press(wh, "work", `work/${memberId(wh, "self")}/start`);
    },
  },
  {
    // 見本 5-6-01（シニアの夫婦）の配偶者を「会社員として入れる」
    name: "操作 シニアの夫婦の配偶者を会社員として入れる",
    build: () => {
      const wh = open("sampleSeniorCouple");
      return press(wh, "work", `work/${memberId(wh, "spouse")}/start`);
    },
  },
  {
    name: "操作 会社員として入れてからパートに変える",
    build: () => {
      let wh = newCustomer("1980-06");
      const self = memberId(wh, "self");
      wh = press(wh, "work", `work/${self}/start`);
      return put(wh, "work", `work/${self}/now/type`, "partTime");
    },
  },
  {
    name: "操作 自営業として入れる",
    build: () => {
      const wh = newCustomer("1980-06");
      return press(wh, "work", `work/${memberId(wh, "self")}/startSelf`);
    },
  },
  {
    name: "操作 自営業として入れてから公務員に変える",
    build: () => {
      let wh = newCustomer("1980-06");
      const self = memberId(wh, "self");
      wh = press(wh, "work", `work/${self}/startSelf`);
      return put(wh, "work", `work/${self}/now/type`, "civilServant");
    },
  },
  {
    // 見本 3-4-03（持ち家・2012年から）に「＋ 住宅購入の予定」
    name: "操作 持ち家の世帯に住宅購入の予定を足す",
    build: () => press(open("dualAssetsTwoKids"), "housing", "housing/addPurchase"),
  },
  {
    // 見本 3-4-01 の持ち家に住み終わり（2050年3月）を入れる（住み終わりの後は既定の「そのまま持つ」）
    name: "操作 持ち家に住み終わりを入れる",
    build: () => put(open("salariedCoupleTwoKids"), "housing", (f) => /^housing\/res\/[^/]+\/to$/.test(f.key), "2050-03"),
  },
  {
    // 見本 3-4-01 の持ち家を2035年3月に売る（住宅ローンが残る）
    name: "操作 住宅ローンの残る持ち家を売る",
    build: () => {
      const wh = put(open("salariedCoupleTwoKids"), "housing", (f) => /^housing\/res\/[^/]+\/to$/.test(f.key), "2035-03");
      return put(wh, "housing", (f) => /^housing\/res\/[^/]+\/after$/.test(f.key), "sell");
    },
  },
  {
    // 購入の予定の世帯で、購入の時期を1年遅らせる
    name: "操作 購入の時期を1年遅らせる",
    build: () => put(open("housingPurchase"), "housing", (f) => /\/purchase\/at$/.test(f.key), { at: "2029-04" }),
  },
  {
    // 介護の途中（施設 2027年4月から60か月）で母が亡くなる見込みを入れる
    name: "操作 介護の途中で亡くなる見込みを入れる",
    build: () => {
      const wh = open("parentCare");
      const mother = memberId(wh, "parent");
      return put(wh, "care", `family/${mother}/leaves`, "2029-03");
    },
  },
  {
    // 父・母を足し、父から相続を受け取る行を足してから、相手を母に変える
    name: "操作 受け取る相続の相手を変える",
    build: () => {
      let wh = open("salariedCoupleTwoKids");
      wh = press(wh, "care", "care/add/selfParents");
      wh = press(wh, "inheritance", "money/inherit/in/add/inheritance");
      const h = wh.request.input.household;
      const flow = (h.incomeFlows ?? []).find((f) => f.kind === "inheritance")!;
      const father = h.members.find((m) => m.kind === "parent" && m.sex === "male")!;
      const mother = h.members.find((m) => m.kind === "parent" && m.sex === "female")!;
      if (flow.counterparty !== father.id) wh = put(wh, "inheritance", `in/${flow.id}/counterparty`, father.id);
      return put(wh, "inheritance", `in/${flow.id}/counterparty`, mother.id);
    },
  },
  {
    // 新しい顧客の基本生活費で、退職後の割合だけを 55% に下げる（70歳・80歳の段は推定のまま）
    name: "操作 退職後の生活費の割合だけを下げる",
    build: () => {
      let wh = newCustomer("1986-06");
      wh = press(wh, "work", `work/${memberId(wh, "self")}/start`);
      return put(wh, "living", (f) => /\/stage\/0\/ratio$/.test(f.key), "0.55");
    },
  },
  {
    // 見本 3-4-02（資産運用の見本）の運用の入れ方を「資産配分」に切り替える
    name: "操作 運用の入れ方を資産配分に切り替える",
    build: () => withRefreshedEstimates(switchMethod(open("investmentCouple"), "allocation")),
  },
  {
    // 見本 3-4-01 に NISA と課税口座を足して、今の残高を入れる
    name: "操作 NISA と課税口座を足して残高を入れる",
    build: () => {
      let wh = open("salariedCoupleTwoKids");
      const before = new Set((wh.request.input.household.accounts ?? []).map((a) => a.id));
      wh = press(wh, "savings", "sav/add/nisa");
      wh = press(wh, "savings", "sav/add/taxable");
      for (const a of (wh.request.input.household.accounts ?? []).filter((x) => !before.has(x.id))) wh = put(wh, "savings", `sav/${a.id}/value`, 1_000_000);
      return wh;
    },
  },
  {
    // 相続・遺贈を受け取る行と、あげる贈与を足し、プランBで介護の場所を在宅から施設に変えて、親を外す
    name: "操作 相続・贈与の行とプランの違い",
    build: () => {
      let wh = open("parentCare");
      wh = press(wh, "inheritance", "money/inherit/in/add/inheritance");
      wh = press(wh, "inheritance", "money/inherit/out/add/gift");
      wh = { ...wh, proposals: [{ id: "B", name: "プランB", createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base: null, tags: [], diffs: [] }] };
      const self = roles(wh.request).find((r) => r.key === "self")!.member.id;
      const cat = buildCatalog(wh, self, null);
      const view = planView(wh, cat, "B");
      const care = (view.request.input.household.careExpenses ?? []).find((c) => c.place === "home") ?? (view.request.input.household.careExpenses ?? [])[0]!;
      let edited = put(view, "care", `ev/care/${care.id}/place`, care.place === "home" ? "facility" : "home");
      const mother = memberId(edited, "parent");
      edited = press(edited, "care", `family/${mother}/remove`);
      return recordPlanEdit(wh, cat, "B", view, edited);
    },
  },
  {
    // ヒアリングシート（簡易版の見本）を新しい顧客に取り込み、全部を承認する
    name: "操作 ヒアリングシートを取り込む",
    imported: true,
    build: async () => {
      const wh = withRefreshedEstimates(blankHousehold(BASE, ids));
      const r = await importSheet(new Uint8Array(readFileSync(join(REPO_DIR, "hearing", "samples", "basic-2-sample.xlsx"))), wh, ids);
      if (!r.ok) throw new Error("取り込めない");
      return withRefreshedEstimates(applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), approvalTime(new Date(2026, 9, 18, 10, 0, 0))).wh);
    },
  },
];

// ---- 見本の棚とモデル世帯 ----

const DEMOS: readonly WatchCase[] = DEMO_HOUSEHOLDS.map((d) => ({ name: `見本 ${d.sampleNo}`, build: () => fromRequest(modelHousehold(d.id)) }));
const SHELF = new Set(DEMO_HOUSEHOLDS.map((d) => d.id));
const MODELS: readonly WatchCase[] = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .filter((id) => !SHELF.has(id))
  .sort()
  .map((id) => ({ name: `モデル ${id}`, build: () => fromRequest(modelHousehold(id) as EngineRequest) }));

/** 見張る世帯の全部（見本の棚 → モデル世帯 → 入力の操作） */
export const WATCH_CASES: readonly WatchCase[] = [...DEMOS, ...MODELS, ...OPERATIONS];
