// プランの上書き保存: FP顧問料の契約を現状から外している間でも、プランの顧問料の差分を落とさない
import { describe, expect, it } from "vitest";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addAdvisoryFee } from "../src/workspace/input/stages/fees.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyPlan, diffKey, effectiveValues, normalizeValues, overwritePlan, savePlan } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-10-31T10:00:00.000Z";
let n = 0;
const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const catOf = (wh: WorkingHousehold) => buildCatalog(wh, roles(wh.request).find((r) => r.key === "self")!.member.id, null);
const withoutContract = (wh: WorkingHousehold) =>
  mutate(wh, (h) => {
    delete h.advisoryFees;
  });

describe("FP顧問料の契約を外している間の上書き保存", () => {
  it("顧問料の差分を残し、契約を戻すとプランに顧問料が入ったまま", () => {
    const wh0 = addAdvisoryFee(fromRequest(modelHousehold("salariedCoupleTwoKids")), ids);
    const contract = wh0.request.input.household.advisoryFees![0]!;
    const cat0 = catOf(wh0);
    const saved = savePlan(wh0, cat0, { name: "B", base: null, values: { "lever:fee": true, "lever:retireAge": 66 }, now: NOW });
    const feeDiff = saved.wh.proposals[0]!.diffs.find((d) => diffKey(d, saved.wh) === "lever:fee");
    expect(feeDiff).toBeDefined();
    // 現状から契約を外す（入力の「この契約を外す」）
    const off = withoutContract(saved.wh);
    const catOff = catOf(off);
    expect(catOff.byKey.has("lever:fee")).toBe(false);
    // 外している間に、退職の年齢を動かして上書き保存する
    const values = { ...effectiveValues(off, saved.id), "lever:retireAge": 67 };
    const over = overwritePlan(off, catOff, saved.id, values, NOW);
    const p = over.proposals.find((x) => x.id === saved.id)!;
    expect(p.diffs.some((d) => d.id === feeDiff!.id)).toBe(true);
    // 契約を戻す（同じ契約）と、プランには顧問料が入る
    const back = mutate(over, (h) => {
      h.advisoryFees = [contract];
    });
    expect(effectiveValues(back, saved.id)).toMatchObject({ "lever:fee": true, "lever:retireAge": 67 });
    const req = applyPlan(back, saved.id, catOf(back)).request;
    expect(req.input.household.advisoryFees![0]!.enabled).not.toBe(false);
  });

  it("画面の保存していない変更（契約を外したときに一覧に無い項目を落として整えた値）で上書きしても、顧問料の差分を残す", () => {
    const wh0 = addAdvisoryFee(fromRequest(modelHousehold("salariedCoupleTwoKids")), ids);
    const saved = savePlan(wh0, catOf(wh0), { name: "B", base: null, values: { "lever:fee": true, "lever:retireAge": 66 }, now: NOW });
    const feeDiff = saved.wh.proposals[0]!.diffs.find((d) => diffKey(d, saved.wh) === "lever:fee")!;
    const off = withoutContract(saved.wh);
    const catOff = catOf(off);
    const draft = normalizeValues({ ...effectiveValues(off, saved.id), "lever:retireAge": 68 }, effectiveValues(off, saved.id), off, catOff);
    expect(Object.hasOwn(draft, "lever:fee")).toBe(false);
    const p = overwritePlan(off, catOff, saved.id, draft, NOW).proposals.find((x) => x.id === saved.id)!;
    expect(p.diffs.find((d) => d.id === feeDiff.id)).toEqual(feeDiff);
    expect(p.diffs.filter((d) => diffKey(d, off) === "lever:retireAge")).toHaveLength(1);
  });

  it("契約がある間は、顧問料を現状と同じに戻して上書きすると差分を消す（今までどおり）", () => {
    const wh0 = addAdvisoryFee(fromRequest(modelHousehold("salariedCoupleTwoKids")), ids);
    const cat0 = catOf(wh0);
    const saved = savePlan(wh0, cat0, { name: "B", base: null, values: { "lever:fee": true }, now: NOW });
    const p = overwritePlan(saved.wh, cat0, saved.id, { "lever:fee": false }, NOW).proposals.find((x) => x.id === saved.id)!;
    expect(p.diffs).toEqual([]);
  });
});
