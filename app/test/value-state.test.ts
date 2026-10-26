// 値の状態の画面（0041）: 確定は明示の操作だけ・4つの操作・値を打ったときの行の直し・プランの中での操作・古い世帯に自動で推定を
// 入れない・新しく入れるときは推定から・確かめの一覧
import { describe, expect, it } from "vitest";
import type { EngineRequest } from "../src/engine/types.ts";
import { checkList, confirmAllEstimates, isPresetCandidate } from "../src/workspace/input/checkRows.ts";
import { shouldCommitOnBlur } from "../src/workspace/input/FieldViews.tsx";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { EDUCATION_BASIS, educationStagesAddress, fillAll, gapsOf } from "../src/workspace/input/fill.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, confirmedBox, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { inputItems, itemStage } from "../src/workspace/input/items.ts";
import { carryRows, dropStaleRows, rowAt } from "../src/workspace/input/rows.ts";
import { addCar } from "../src/workspace/input/stages/cars.ts";
import { addChildWithEducation } from "../src/workspace/input/stages/family.ts";
import { buildStage, buildStages, STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, availableOps, confirmAll, fieldAddress, fieldStatus, planStateOp } from "../src/workspace/input/valueState.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyPlan, type Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { bodyObject, EMPTY_CARRY, fromBody, type BodyState } from "../src/workspace/store/body.ts";
import { readAt } from "../src/workspace/store/readings.ts";
import { modelHousehold, preview } from "./helpers.ts";

type Obj = Record<string, unknown>;
const BASE = "2026-10";
let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const MODELS = ["salariedCoupleTwoKids", "housingPurchase", "elderCare", "educationTwoKids", "sampleSingle40s", "civilServant", "selfEmployed"];
const open = (id: string) => fromRequest(modelHousehold(id));
const state = (wh: WorkingHousehold): BodyState => ({ wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: {}, balance: {} } as unknown as BodyState["display"], carry: EMPTY_CARRY });
const roundTrip = (wh: WorkingHousehold): WorkingHousehold => fromBody(JSON.stringify(bodyObject(state(wh)))).wh;
const input = (wh: WorkingHousehold) => wh.request.input as unknown as Obj;
const fieldOf = (wh: WorkingHousehold, stage: Parameters<typeof buildStage>[0], suffix: string): FieldDef => {
  const f = allFields(buildStage(stage, wh)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
};
const runAction = (wh: WorkingHousehold, stage: Parameters<typeof buildStage>[0], keySuffix: string): WorkingHousehold => {
  for (const s of buildStage(stage, wh).sections) for (const a of [...s.actions, ...s.groups.flatMap((g) => g.actions)]) if (a.key.endsWith(keySuffix)) return a.run(wh);
  throw new Error(`no action ${keySuffix}`);
};
/** 計算できる（エンジンの入力のスキーマを通る） */
const computes = (wh: WorkingHousehold) => {
  const r = preview(wh.request as EngineRequest);
  expect(r.table.length).toBeGreaterThan(0);
};

describe("確定は明示の操作だけ（欄に入って離れる・同じ文字を書き戻すでは何も変えない）", () => {
  it.each([...MODELS, "blank"])("%s: どの欄も、今の値を書き戻すと同じ世帯のまま（推定の欄も推定のまま）", (id) => {
    const wh = id === "blank" ? blankHousehold(BASE, ids()) : open(id);
    const before = JSON.stringify(wh);
    for (const stage of buildStages(wh))
      for (const f of allFields(stage)) {
        const s = fieldStatus(f, wh);
        const w = f.set(wh, f.get(wh).value);
        expect(w, f.key).toBe(wh);
        expect(fieldStatus(f, w), f.key).toEqual(s);
      }
    expect(JSON.stringify(wh)).toBe(before);
  });

  it.each(MODELS)("%s: 時点の欄（時点の部品）も、入っている形のままの時点を書き戻すと同じ世帯のまま。わからない・該当なしは持たない", (id) => {
    const wh = open(id);
    let n = 0;
    for (const stage of buildStages(wh))
      for (const f of allFields(stage)) {
        if (f.kind !== "when") continue;
        const raw = f.get(wh).when?.raw;
        if (raw === undefined) continue;
        n++;
        expect(f.set(wh, raw as never), f.key).toBe(wh);
        expect(availableOps(f, wh).filter((o) => o === "unknown" || o === "notApplicable"), f.key).toEqual([]);
      }
    expect(n).toBeGreaterThan(0);
  });

  it("欄を離れるときは、入ったときと同じ文字なら書かない（Tab で通る・パネルを開いて最初の欄に入るだけ）", () => {
    expect(shouldCommitOnBlur("25", "25")).toBe(false);
    expect(shouldCommitOnBlur("25", "30")).toBe(true);
    expect(shouldCommitOnBlur(null, "25")).toBe(true);
  });

  it("推定の欄に同じ値を入れても確定にならない。確定は「✓ この値で確定」", () => {
    const wh = blankHousehold(BASE, ids());
    const f = fieldOf(wh, "living", "/monthly");
    expect(fieldStatus(f, wh).status).toBe("estimated");
    expect(f.set(wh, f.get(wh).value)).toBe(wh);
    expect(availableOps(f, wh)).toContain("confirm");
    const c = applyStateOp(wh, f, "confirm");
    const s = fieldStatus(f, c);
    expect(s.status).toBe("confirmed");
    expect(s.explicit).toBe(true);
    expect(f.get(c).value).toBe(f.get(wh).value);
    // 確定の箱は推定の根拠を残す（記録の無い確定と見分ける）
    expect(c.request.input.household.livingExpenses![0]!.monthly).toMatchObject({ state: "confirmed", origin: { kind: "manual" }, estimate: { method: "statistic" } });
    // 値を打てば、根拠の無い確定（手で入れた値）になる
    const typed = f.set(c, 300000);
    expect(fieldStatus(f, typed)).toMatchObject({ status: "confirmed", explicit: false });
  });
});

describe("4つの操作（どの欄も同じ部品）", () => {
  it("値の箱の欄: 確定・推定に戻す・わからない・該当なし。どの状態でも計算できる", () => {
    const wh = open("salariedCoupleTwoKids");
    const f = fieldOf(wh, "living", "/monthly");
    const typed = f.set(wh, 270000);
    expect(fieldStatus(f, typed).status).toBe("confirmed");
    // 推定に戻す
    const back = applyStateOp(typed, f, "revert");
    expect(fieldStatus(f, back).status).toBe("estimated");
    // わからない（今の値を代わりの値に）
    const unk = applyStateOp(typed, f, "unknown");
    expect(fieldStatus(f, unk).status).toBe("unknown");
    expect(f.get(unk).value).toBe(270000);
    expect(unk.request.input.household.livingExpenses![0]!.monthly).toMatchObject({ state: "unknown", substitute: { value: 270000, state: "estimated" } });
    computes(unk);
    // わからない → 確定（代わりの値で）
    const conf = applyStateOp(unk, f, "confirm");
    expect(fieldStatus(f, conf).status).toBe("confirmed");
    expect(f.get(conf).value).toBe(270000);
    // 該当なし
    const na = applyStateOp(typed, f, "notApplicable");
    expect(fieldStatus(f, na).status).toBe("notApplicable");
    expect(f.get(na).value).toBeNull();
    computes(na);
    // 使えない操作は世帯を変えない
    expect(applyStateOp(na, f, "notApplicable")).toBe(na);
  });

  it("箱でない値（仮の印の推定）: 確定は行に根拠を残し、仮の印を外す。わからない・該当なしは向き先の物の行に書く", () => {
    const wh = addCar(open("salariedCoupleTwoKids"), ids());
    const f = fieldOf(wh, "car", "/price");
    const a = fieldAddress(f, wh)!;
    expect(a).not.toBeNull();
    expect(fieldStatus(f, wh).status).toBe("estimated");
    const c = applyStateOp(wh, f, "confirm");
    expect(c.assumed[f.key]).toBeUndefined();
    expect(rowAt(input(c), a)).toMatchObject({ state: "confirmed", origin: { kind: "manual" }, estimate: { basis: wh.assumed[f.key] } });
    expect(fieldStatus(f, c)).toMatchObject({ status: "confirmed", explicit: true });
    expect(readAt(input(c), a)).toBe(readAt(input(wh), a));
    // わからない: 値はそのまま、行に代わりの値の根拠
    const u = applyStateOp(wh, f, "unknown");
    expect(u.assumed[f.key]).toBeUndefined();
    expect(rowAt(input(u), a)).toMatchObject({ state: "unknown", estimate: { basis: wh.assumed[f.key] } });
    computes(u);
    // 推定に戻す: 行を外し、仮の印の推定に戻る
    const r = applyStateOp(c, f, "revert");
    expect(rowAt(input(r), a)).toBeUndefined();
    expect(fieldStatus(f, r).status).toBe("estimated");
    expect(r.request).toEqual(wh.request);
  });

  it("推定の入れ直しは、推定のままの値と、わからないの統計の代わりの値だけ（わからないの印は残す。FP の前の値の代わりは変えない）", () => {
    const wh = blankHousehold(BASE, ids());
    const f = fieldOf(wh, "living", "/monthly");
    const unk = applyStateOp(wh, f, "unknown");
    const sub0 = (unk.request.input.household.livingExpenses![0]!.monthly as unknown as { substitute: { value: number } }).substitute.value;
    const two = withRefreshedEstimates(addChildWithEducation(unk, ids()));
    const m = two.request.input.household.livingExpenses![0]!.monthly as unknown as { state: string; substitute: { value: number } };
    expect(m.state).toBe("unknown");
    expect(m.substitute.value).not.toBe(sub0);
    // FP が入れた値をわからないにしたもの（前の値を代わりに使う）は入れ直さない
    const typed = applyStateOp(f.set(wh, 123000), f, "unknown");
    const kept = withRefreshedEstimates(addChildWithEducation(typed, ids()));
    expect((kept.request.input.household.livingExpenses![0]!.monthly as unknown as { substitute: { value: number } }).substitute.value).toBe(123000);
  });

  it("推定をまとめて確定（カード・全部）は、推定の欄だけを確定にする", () => {
    const wh = addCar(blankHousehold(BASE, ids()), ids());
    const card = allFields(buildStage("car", wh));
    const before = card.filter((f) => fieldStatus(f, wh).status === "estimated").length;
    expect(before).toBeGreaterThan(1);
    const r = confirmAll(wh, card);
    expect(r.count).toBe(before);
    expect(card.filter((f) => fieldStatus(f, r.wh).status === "estimated")).toEqual([]);
    const all = confirmAllEstimates(wh);
    expect(all.count).toBeGreaterThanOrEqual(before);
    expect(checkList(all.wh).filter((x) => x.kind === "estimated")).toEqual([]);
    computes(all.wh);
  });
});

describe("値を打ったときに状態の行を直す（推定でない行も）", () => {
  it("わからない・承認の行は、FP が値を打つと外れる。値の変わらない行・ほかの行は残る", () => {
    const wh0 = addCar(open("salariedCoupleTwoKids"), ids());
    const price = fieldOf(wh0, "car", "/price");
    const upkeep = fieldOf(wh0, "car", "/upkeep");
    let wh = applyStateOp(wh0, price, "unknown");
    wh = applyStateOp(wh, upkeep, "confirm");
    const a = fieldAddress(price, wh)!;
    const b = fieldAddress(upkeep, wh)!;
    // 承認の記録のある行（ヒアリングで入った値）も同じ
    const tradeKey = fieldOf(wh, "car", "/tradeIn").key;
    wh = mutate({ ...wh, assumed: Object.fromEntries(Object.entries(wh.assumed).filter(([k]) => k !== tradeKey)) }, (_h, req) => {
      const car = (req.input.household.cars ?? [])[0] as unknown as Obj;
      (car.valueStates as Obj)["car.purchase/tradeIn"] = { state: "confirmed", origin: { kind: "hearing" }, approval: { by: "fp", at: "2026-10-26T10:00:00+09:00" } };
    });
    const typed = price.set(wh, 2_000_000);
    expect(rowAt(input(typed), a)).toBeUndefined();
    expect(rowAt(input(typed), b)).toMatchObject({ state: "confirmed" });
    const trade = fieldOf(typed, "car", "/tradeIn");
    expect(fieldStatus(trade, typed).approved).toBe(true);
    const t2 = trade.set(typed, 400_000);
    expect(fieldStatus(trade, t2)).toMatchObject({ status: "confirmed", approved: false });
    // 同じ値を書き戻しても行は変わらない
    expect(trade.set(typed, trade.get(typed).value)).toBe(typed);
  });

  it("dropStaleRows: 前と同じ行で値が変わった所だけを外す（この変更で書いた行は残す）", () => {
    const wh = addCar(open("salariedCoupleTwoKids"), ids());
    const f = fieldOf(wh, "car", "/price");
    const u = applyStateOp(wh, f, "unknown");
    // 状態の操作は行を書き換えるので外れない
    expect(dropStaleRows(wh, u)).toBe(u);
    const moved = mutate(u, (h) => void ((h.cars![0]!.purchase as Obj).price = 1));
    expect(rowAt(input(dropStaleRows(u, moved)), fieldAddress(f, u)!)).toBeUndefined();
    expect(dropStaleRows(u, u)).toBe(u);
  });

  it("ヒアリングの取り込みで物を置き換えたとき: 値が変わらない所の FP の行は残し、値が変わった所の行は写さない", () => {
    const prev = { id: "x", purchase: { price: 100, tradeIn: 5 }, valueStates: { "car.purchase/price": { state: "unknown", origin: { kind: "manual" }, estimate: { method: "standard", basis: "b" } }, "car.purchase/tradeIn": { state: "notApplicable", origin: { kind: "manual" } } } };
    const next: Obj = { id: "x", purchase: { price: 100, tradeIn: 9 } };
    carryRows(prev, next, { object: "x" });
    expect(next.valueStates).toEqual({ "car.purchase/price": prev.valueStates["car.purchase/price"] });
    // 取り込んだ物が同じ鍵の行を持てば、それが正
    const imported: Obj = { id: "x", purchase: { price: 100 }, valueStates: { "car.purchase/price": { state: "confirmed", origin: { kind: "hearing" }, approval: { by: "fp", at: "2026-10-26T10:00:00+09:00" } } } };
    carryRows(prev, imported, { object: "x" });
    expect((imported.valueStates as Obj)["car.purchase/price"]).toMatchObject({ origin: { kind: "hearing" } });
  });
});

describe("保存と読み直し", () => {
  it("値の状態の行は世帯ファイルに書かれ、読み直しても同じ（推定の行は仮の印に戻る）", () => {
    const wh0 = addCar(open("salariedCoupleTwoKids"), ids());
    const price = fieldOf(wh0, "car", "/price");
    const living = fieldOf(wh0, "living", "/monthly");
    let wh = applyStateOp(wh0, price, "confirm");
    wh = applyStateOp(wh, fieldOf(wh, "car", "/upkeep"), "unknown");
    wh = applyStateOp(wh, living, "unknown");
    const back = roundTrip(wh);
    expect(back.request.input.household.cars).toEqual(wh.request.input.household.cars);
    expect(back.request.input.household.livingExpenses).toEqual(wh.request.input.household.livingExpenses);
    expect(back.assumed[fieldOf(wh, "car", "/tradeIn").key]).toBe(wh.assumed[fieldOf(wh, "car", "/tradeIn").key]);
    expect(fieldStatus(price, back)).toMatchObject({ status: "confirmed", explicit: true });
    computes(back);
  });
});

describe("プランを選んでいるときの操作（状態の変更もそのプランの差分）", () => {
  const withPlan = (wh: WorkingHousehold): WorkingHousehold => ({ ...wh, proposals: [{ id: "P", name: "プランB", createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base: null, tags: [], diffs: [] } as Proposal] });
  it("現状は変えず、プランに値を変える差分を作る。現状と同じに戻すと差分を消す", () => {
    const wh = withPlan(blankHousehold(BASE, ids()));
    const self = roles(wh.request).find((r) => r.key === "self")!;
    const cat = buildCatalog(wh, self.member.id, null);
    const f = fieldOf(wh, "living", "/monthly");
    const p = planStateOp(wh, cat, "P", f, "unknown");
    expect(p.request).toBe(wh.request);
    const d = p.proposals[0]!.diffs;
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ op: "set", item: "livingExpense.monthly", value: { state: "unknown" }, before: { state: "estimated" } });
    const applied = applyPlan(p, "P", buildCatalog(p, self.member.id, null)).request;
    expect(applied.input.household.livingExpenses![0]!.monthly).toMatchObject({ state: "unknown" });
    // プランの中で推定に戻すと、現状と同じになるので差分が消える
    const back = planStateOp(p, cat, "P", f, "revert");
    expect(back.proposals[0]!.diffs).toEqual([]);
  });

  it("箱でない値の確定は、プランの差分の値の箱に根拠を残し、当てると向き先の物の行になる", () => {
    const wh = withPlan(addCar(blankHousehold(BASE, ids()), ids()));
    const self = roles(wh.request).find((r) => r.key === "self")!;
    const cat = buildCatalog(wh, self.member.id, null);
    const f = fieldOf(wh, "car", "/price");
    const p = planStateOp(wh, cat, "P", f, "confirm");
    const d = p.proposals[0]!.diffs[0]!;
    expect(d.value).toMatchObject({ state: "confirmed", origin: { kind: "manual" }, estimate: { basis: wh.assumed[f.key] } });
    expect(d.before).toMatchObject({ state: "estimated" });
    const applied = { ...p, request: applyPlan(p, "P", cat).request };
    expect(rowAt(input(applied), fieldAddress(f, applied)!)).toMatchObject({ state: "confirmed" });
    // 現状は推定のまま
    expect(fieldStatus(f, p).status).toBe("estimated");
  });

  it("このプランで足した物の中の値なら、足す差分の物を直す（set を重ねない）", () => {
    const withCar = addCar(blankHousehold(BASE, ids()), ids());
    const car = withCar.request.input.household.cars![0]!;
    const wh: WorkingHousehold = {
      ...mutate(withCar, (h) => void (h.cars = [])),
      proposals: [{ id: "P", name: "プランB", createdAt: "x", updatedAt: "x", base: null, tags: [], diffs: [{ id: "d1", op: "add", target: { collection: "car" }, item: null, at: [], value: structuredClone(car), before: null, enabled: true, origin: { kind: "manual" }, note: null }] } as Proposal],
    };
    const self = roles(wh.request).find((r) => r.key === "self")!;
    const cat = buildCatalog(wh, self.member.id, null);
    const work = { ...wh, request: applyPlan(wh, "P", cat).request };
    const f = fieldOf(work, "car", "/upkeep");
    const p = planStateOp(wh, cat, "P", f, "unknown");
    const diffs = p.proposals[0]!.diffs;
    expect(diffs).toHaveLength(1);
    expect(((diffs[0]!.value as Obj).valueStates as Obj)["car.upkeep/annual"]).toMatchObject({ state: "unknown" });
  });
});

describe("古い世帯を開いたとき: 0円・未入力だった所に推定を自動で入れない", () => {
  /** 進路・退職金・住まいの無い、前の版で作った世帯 */
  const oldHousehold = () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const h = req.input.household;
    delete h.goals;
    delete h.retirementBenefits;
    delete h.residences;
    h.debts = [];
    return req;
  };

  it("開いても世帯は変わらず、未入力として確かめの一覧のいちばん上に出る", () => {
    const req = oldHousehold();
    const wh = fromRequest(req);
    const reopened = roundTrip(wh);
    for (const w of [wh, reopened]) {
      expect(w.request.input.household.goals ?? []).toEqual([]);
      expect(w.request.input.household.retirementBenefits ?? []).toEqual([]);
      expect(w.request.input.household.residences ?? []).toEqual([]);
    }
    const gaps = gapsOf(wh).map((g) => g.id);
    expect(gaps.filter((g) => g.startsWith("education/"))).toHaveLength(2);
    expect(gaps.some((g) => g.startsWith("work/retirement/"))).toBe(true);
    expect(gaps).toContain("housing");
    const rows = checkList(wh);
    expect(rows[0]!.kind).toBe("missing");
    const kinds = rows.map((r) => r.kind);
    expect([...kinds].sort((a, b) => ["missing", "unknown", "notice", "estimated"].indexOf(a) - ["missing", "unknown", "notice", "estimated"].indexOf(b))).toEqual(kinds);
  });

  it("「推定で埋める」（カードごと・まとめて）を押したときだけ入る。入れた推定は推定の印つき", () => {
    const wh = fromRequest(oldHousehold());
    const edu = fillAll(wh, "education");
    expect(edu.count).toBe(2);
    expect(edu.wh.request.input.household.retirementBenefits ?? []).toEqual([]);
    const goals = edu.wh.request.input.household.goals!;
    for (const g of goals) expect(rowAt(input(edu.wh), educationStagesAddress(g.id))).toMatchObject({ state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: EDUCATION_BASIS } });
    const all = fillAll(wh);
    expect(all.wh.request.input.household.retirementBenefits!.length).toBeGreaterThan(0);
    expect(all.wh.request.input.household.retirementBenefits![0]!.amount).toMatchObject({ state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic" } });
    expect(all.wh.request.input.household.residences![0]!.rent!.monthly).toMatchObject({ state: "estimated", estimate: { method: "standard" } });
    expect(gapsOf(all.wh).filter((g) => g.fill !== undefined)).toEqual([]);
    computes(all.wh);
    // 推定で入れた結果は、0円だった前より教育費・退職金の分だけ変わる
    expect(preview(all.wh.request).table).not.toEqual(preview(wh.request).table);
  });

  it("「該当なし」で、未入力の一覧から消える（教育費なし・勤め先に制度が無い・住居費なし）。計算は変わらない", () => {
    const wh = fromRequest(oldHousehold());
    let w = wh;
    for (const g of gapsOf(wh)) if (g.none !== undefined) w = g.none(w);
    expect(gapsOf(w)).toEqual([]);
    const goal = w.request.input.household.goals![0]!;
    expect(goal.education!.stages).toEqual([]);
    expect(rowAt(input(w), educationStagesAddress(goal.id))).toEqual({ state: "notApplicable", origin: { kind: "manual" } });
    expect(preview(w.request).table).toEqual(preview(wh.request).table);
  });

  it("目安のボタンと同じ確定の値は、値も状態も変えずに確かめの注意に出す。確かめたら出ない", () => {
    const wh0 = fromRequest(oldHousehold());
    const wh = mutate(wh0, (h, req) => void (h.residences = [{ id: "00000000-0000-4000-8000-0000000000aa", kind: "rent", from: { at: req.input.baseMonth }, to: null, rent: { monthly: confirmedBox(80000) } }]));
    const rent = fieldOf(wh, "housing", "/rent");
    expect(isPresetCandidate(rent, wh)).toBe(true);
    const row = checkList(wh).find((r) => r.fieldKey === rent.key)!;
    expect(row.kind).toBe("notice");
    const confirmed = row.actions.find((a) => a.key === "confirm")!.run(wh);
    expect(isPresetCandidate(rent, confirmed)).toBe(false);
    expect(fieldStatus(rent, confirmed)).toMatchObject({ status: "confirmed", explicit: true });
    const std = row.actions.find((a) => a.key === "standard")!.run(wh);
    expect(fieldStatus(rent, std).status).toBe("estimated");
    expect(rent.get(std).value).toBe(80000);
  });
});

describe("新しく作る世帯は最初から推定", () => {
  it("子を足すと進路を推定で入れ、生年月を直すと推定のまま入れ直す。FP が進路を選ぶと推定の印は外れる", () => {
    const wh0 = blankHousehold(BASE, ids());
    const wh = addChildWithEducation(wh0, ids());
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!;
    const goal = wh.request.input.household.goals!.find((g) => g.owner === child.id)!;
    expect(rowAt(input(wh), educationStagesAddress(goal.id))).toMatchObject({ state: "estimated" });
    const preset = fieldOf(wh, "education", `edu/${goal.id}/preset`);
    expect(fieldStatus(preset, wh).status).toBe("estimated");
    expect(gapsOf(wh).filter((g) => g.card === "education")).toEqual([]);
    // 推定のままの進路は、子の生年月に合わせて入れ直す（App・入力のパネルの推定の入れ直し）
    const older = withRefreshedEstimates(mutate(wh, (h) => void (h.members.find((m) => m.id === child.id)!.birth.birthYearMonth = "2010-04")));
    const stages = older.request.input.household.goals!.find((g) => g.id === goal.id)!.education!.stages.map((s) => s.stage);
    expect(stages).not.toContain("elementary");
    expect(rowAt(input(older), educationStagesAddress(goal.id))).toMatchObject({ state: "estimated" });
    // FP が進路の型を選ぶ → 推定の印が外れる（FP が決めた進路は入れ直さない）
    const chosen = preset.set(wh, "allPublic");
    expect(rowAt(input(chosen), educationStagesAddress(goal.id))).toBeUndefined();
    // 「✓ この値で確定」
    const c = applyStateOp(wh, preset, "confirm");
    expect(rowAt(input(c), educationStagesAddress(goal.id))).toMatchObject({ state: "confirmed", estimate: { basis: EDUCATION_BASIS } });
    computes(c);
  });

  it("会社員として入れると、退職金の目安（推定）も入る。正社員に変えたときも", () => {
    const wh0 = blankHousehold(BASE, ids());
    const self = wh0.request.input.household.members[0]!;
    const wh = runAction(wh0, "work", `work/${self.id}/start`);
    const b = wh.request.input.household.retirementBenefits!;
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ kind: "lumpSum", member: self.id, amount: { state: "estimated", origin: { kind: "auto" } } });
    expect(gapsOf(wh).filter((g) => g.card === "work")).toEqual([]);
    computes(wh);
    const self2 = runAction(wh0, "work", `work/${self.id}/startSelf`);
    expect(self2.request.input.household.retirementBenefits ?? []).toEqual([]);
    const type = fieldOf(self2, "work", `work/${self.id}/now/type`);
    const reg = type.set(self2, "civilServant");
    expect(reg.request.input.household.retirementBenefits![0]).toMatchObject({ kind: "civilServantAllowance", estimate: { reason: "retirementAge" } });
    computes(reg);
  });

  it("目安のボタン（賃貸・持ち家・一時的支出）の値は、推定（標準の値）で入る", () => {
    const wh = runAction(blankHousehold(BASE, ids()), "housing", "housing/addRent");
    expect(wh.request.input.household.residences![0]!.rent!.monthly).toMatchObject({ value: 80000, state: "estimated", estimate: { method: "standard" } });
    const own = runAction(blankHousehold(BASE, ids()), "housing", "housing/addOwn");
    expect(own.request.input.household.residences![0]!.propertyTax!.annual).toMatchObject({ state: "estimated", estimate: { method: "standard" } });
    const ev = runAction(blankHousehold(BASE, ids()), "events", "ev/addOnce");
    expect(ev.request.input.household.periodicExpenses![0]!.amount).toMatchObject({ state: "estimated", estimate: { method: "standard" } });
  });
});

describe("確かめの一覧", () => {
  it.each(MODELS)("%s: 行の欄はそのカードのパネルにあり、同じ値は1行。推定は影響の大きい順", (id) => {
    const wh = addCar(open(id), ids());
    const rows = checkList(wh);
    const items = new Set(inputItems(wh).map((i) => i.id));
    for (const r of rows) {
      expect(items.has(r.card), r.id).toBe(true);
      if (r.fieldKey === null) continue;
      const stage = itemStage(wh, r.card)!;
      expect(allFields(stage).some((f) => f.key === r.fieldKey), r.id).toBe(true);
    }
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    const est = rows.filter((r) => r.kind === "estimated").map((r) => r.impact);
    expect([...est].sort((a, b) => b - a)).toEqual(est);
    expect(rows.some((r) => r.kind === "estimated" && r.card === "car")).toBe(true);
  });

  it("今の働き方の欄と働き方の期間の欄（同じ値）は1行にまとめる", () => {
    const wh0 = blankHousehold(BASE, ids());
    const self = wh0.request.input.household.members[0]!;
    const wh = runAction(wh0, "work", `work/${self.id}/start`);
    // 今の勤め先の年収の行は1つ（定年後の再雇用の年収の推定は、別の値なので別の行）
    const main = wh.request.input.household.employmentPeriods![0]!.id;
    const salary = checkList(wh).filter((r) => r.card === "work" && r.label.includes("年収") && !r.label.includes("定年後"));
    expect(salary).toHaveLength(1);
    expect(salary[0]!.fieldKey).toBe(`work/${self.id}/now/annual`);
    expect(checkList(wh).filter((r) => r.fieldKey === `work/period/${main}/annual`)).toHaveLength(0);
  });

  it("一覧はカードの順で、どのカードの行も STAGE_ORDER のカード", () => {
    const rows = checkList(blankHousehold(BASE, ids()));
    const order = STAGE_ORDER.map((s) => s.id as string);
    for (const r of rows) expect(order.includes(r.card) || r.card.startsWith("added:")).toBe(true);
  });
});
