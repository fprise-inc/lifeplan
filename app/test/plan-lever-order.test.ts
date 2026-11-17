// プランで「毎月の取り崩し額」「毎年の取り崩し率」だけを入れ（取り崩しを始める年齢は入れない）、同じプランで「働く最後の年齢」も変えたとき、
// 取り崩しの始まりは、プランの退職の年齢から決まる（65歳か退職の年齢の遅い方。現状の退職の年齢から決めない）。0036 の追記 2026-11-17。
// 動かす項目は欄 → 対策の順に反映するので、取り崩しの額・率の項目が始まりを決める時点では、まだプランの退職の年齢が入っていなかった
import { describe, expect, it } from "vitest";
import { applyPlan as connectorApply, listPlanItems } from "../src/connector/plan.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { drawdownOf, nextAgeOf, retireAgeOf } from "../src/workspace/input/savings/model.ts";
import { ageReachedMonth } from "../src/workspace/levers.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { applyPlan, applyValues, normalizeValues, savePlan, type Values } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-11-17T10:00:00.000Z";

function open(id: string, edit?: (req: EngineRequest) => void): { req: EngineRequest; wh: WorkingHousehold; cat: Catalog } {
  const req = modelHousehold(id);
  edit?.(req);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const wh = fromRequest(req, {});
  return { req, wh, cat: buildCatalog(wh, self.id, demoHousehold(id) ?? null) };
}

/** 取り崩しの始まりの年齢と、始まりの月が本人がその年齢に達する月か */
function startOf(req: EngineRequest): { age: number; exact: boolean } {
  const d = drawdownOf(req);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const at = req.input.assumptions?.investment?.drawdown?.start;
  return { age: d.startAge, exact: JSON.stringify(at) === JSON.stringify({ at: ageReachedMonth(self, d.startAge) }) };
}

/** 本来の始まり: 65歳か退職の年齢の遅い方（過ぎていれば次に迎える年齢） */
const expected = (req: EngineRequest, retire: number): number => Math.max(65, retire, nextAgeOf(req) ?? 0);

/** 毎月の取り崩し額・毎年の取り崩し率の値 */
const AMOUNTS: readonly [string, Values][] = [
  ["毎月の取り崩し額", { "inv:wAmt": 100_000 }],
  ["毎年の取り崩し率", { "inv:wRate": "0.04" }],
];

describe("プランで取り崩しの額・率と働く最後の年齢を一緒に変える", () => {
  // 現状の退職の年齢（直す前にずれていた世帯）→ プランの退職の年齢と、本来の始まり
  const CASES: readonly { id: string; now: number; plan: number; start: number }[] = [
    { id: "civilServant", now: 64, plan: 70, start: 70 },
    { id: "executiveOwner", now: 73, plan: 60, start: 65 },
    { id: "executiveOwner", now: 73, plan: 68, start: 68 },
    { id: "parentCare", now: 70, plan: 60, start: 65 },
    { id: "sampleExecutive", now: 70, plan: 60, start: 65 },
    { id: "sampleOwnerCompany", now: 70, plan: 60, start: 65 },
    { id: "sampleSelfEmployedFamily", now: 70, plan: 60, start: 65 },
    { id: "workingSixties", now: 70, plan: 60, start: 65 },
  ];
  for (const c of CASES)
    for (const [name, v] of AMOUNTS)
      it(`${c.id}: 現状${c.now}歳・プランで${c.plan}歳まで働く・${name}だけ → ${c.start}歳から`, () => {
        const { req, wh, cat } = open(c.id);
        expect(drawdownOf(req).method).toBe("none");
        expect(retireAgeOf(req)).toBe(c.now);
        const out = applyValues(wh, { ...v, "lever:retireAge": c.plan }, cat);
        expect(retireAgeOf(out)).toBe(c.plan);
        expect(startOf(out)).toEqual({ age: c.start, exact: true });
      });

  // 境目: プランの退職の年齢が65歳より前・65歳ちょうど・後。現状より上げる・下げる
  for (const id of ["civilServant", "salariedCoupleTwoKids", "workingSixties", "executiveOwner", "sampleSingle20s"])
    for (const plan of [60, 64, 65, 66, 70])
      it(`${id}: プランで${plan}歳まで働く → 65歳か${plan}歳の遅い方から`, () => {
        const { req, wh, cat } = open(id);
        for (const [name, v] of AMOUNTS) {
          const out = applyValues(wh, { ...v, "lever:retireAge": plan }, cat);
          expect(startOf(out), name).toEqual({ age: expected(req, plan), exact: true });
        }
      });

  it("働く最後の年齢を変えないプランは、今まで通り現状の退職の年齢から決まる（項目だけを反映したときと同じ要求）", () => {
    for (const id of ["civilServant", "executiveOwner", "workingSixties", "salariedCoupleTwoKids"]) {
      const { req, wh, cat } = open(id);
      for (const [, v] of AMOUNTS) {
        const out = applyValues(wh, v, cat);
        expect(startOf(out).age, id).toBe(expected(req, retireAgeOf(req)!));
        const [key, value] = Object.entries(v)[0]!;
        expect(out, id).toEqual(cat.byKey.get(key)!.apply(wh, value).request);
      }
    }
  });

  it("現状に取り崩しの計画がある世帯は、プランで働く最後の年齢を変えても始まりは変わらない", () => {
    for (const id of ["investmentCouple", "dualAssetsTwoKids", "surplusSaving"]) {
      const { req, wh, cat } = open(id);
      const now = drawdownOf(req);
      expect(now.method, id).not.toBe("none");
      for (const plan of [60, 70]) {
        expect(drawdownOf(applyValues(wh, { "inv:wAmt": 123_000, "lever:retireAge": plan }, cat)).startAge, `${id} ${plan}`).toBe(now.startAge);
        expect(drawdownOf(applyValues(wh, { "inv:wRate": "0.03", "lever:retireAge": plan }, cat)).startAge, `${id} ${plan}`).toBe(now.startAge);
      }
    }
  });

  it("プランで取り崩しを始める年齢も入れたときは、その年齢から（働く最後の年齢では決め直さない）", () => {
    for (const id of ["civilServant", "executiveOwner", "workingSixties"]) {
      const { wh, cat } = open(id);
      for (const [, v] of AMOUNTS)
        for (const [start, plan] of [
          [68, 60],
          [66, 70],
          [72, 65],
        ] as const)
          expect(startOf(applyValues(wh, { ...v, "inv:wStart": start, "lever:retireAge": plan }, cat)), `${id} ${start} ${plan}`).toEqual({ age: start, exact: true });
    }
  });

  it("保存したプラン・積み重ねたプラン（土台で額、上で働く最後の年齢。その逆）でも同じ", () => {
    for (const c of [
      { id: "civilServant", plan: 70, start: 70 },
      { id: "executiveOwner", plan: 60, start: 65 },
      { id: "workingSixties", plan: 60, start: 65 },
    ]) {
      const { wh, cat } = open(c.id);
      const save = (w: WorkingHousehold, values: Values, base: string | null) => savePlan(w, cat, { name: "プラン", base, tags: [], values, now: NOW });
      // 1つのプランに両方
      const one = save(wh, { "inv:wAmt": 100_000, "lever:retireAge": c.plan }, null);
      expect(startOf(applyPlan(one.wh, one.id, cat).request).age, c.id).toBe(c.start);
      // 土台で額、上のプランで働く最後の年齢
      const a = save(wh, { "inv:wAmt": 100_000 }, null);
      const b = save(a.wh, normalizeValues({ "inv:wAmt": 100_000, "lever:retireAge": c.plan }, { "inv:wAmt": 100_000 }, a.wh, cat), a.id);
      expect(startOf(applyPlan(b.wh, b.id, cat).request).age, `${c.id} 土台で額`).toBe(c.start);
      // 土台だけを反映すると、現状の退職の年齢から（土台は変わらない）
      expect(startOf(applyPlan(b.wh, a.id, cat).request).age, `${c.id} 土台`).toBe(startOf(applyValues(wh, { "inv:wAmt": 100_000 }, cat)).age);
      // 土台で働く最後の年齢、上のプランで率
      const x = save(wh, { "lever:retireAge": c.plan }, null);
      const y = save(x.wh, { "lever:retireAge": c.plan, "inv:wRate": "0.04" }, x.id);
      expect(startOf(applyPlan(y.wh, y.id, cat).request).age, `${c.id} 土台で働く年齢`).toBe(c.start);
      // 結果のタブで動かす値で反映しても同じ
      expect(startOf(applyValues(y.wh, { "lever:retireAge": c.plan, "inv:wRate": "0.04" }, cat)).age, c.id).toBe(c.start);
    }
  });

  it("計算の基準の月が1〜3月の世帯でも、本人がその年齢に達する月から", () => {
    for (const [id, base] of [
      ["civilServant", "2027-01"],
      ["workingSixties", "2027-02"],
      ["executiveOwner", "2027-03"],
      ["sampleSingle20s", "2027-03"],
    ] as const) {
      const { req, wh, cat } = open(id, (r) => {
        r.input.baseMonth = base;
      });
      for (const plan of [60, 65, 70])
        for (const [name, v] of AMOUNTS) {
          const out = applyValues(wh, { ...v, "lever:retireAge": plan }, cat);
          expect(startOf(out), `${id} ${plan} ${name}`).toEqual({ age: expected(req, plan), exact: true });
        }
    }
  });

  it("AI接続口でプランの候補として反映しても、画面と同じ始まりになる", () => {
    for (const c of [
      { id: "civilServant", plan: 70, start: 70 },
      // 本人が64歳なので、接続口で選べる働く最後の年齢は今より後だけ
      { id: "executiveOwner", plan: 68, start: 68 },
      { id: "sampleOwnerCompany", plan: 60, start: 65 },
    ]) {
      const req = modelHousehold(c.id);
      const items = (JSON.parse(listPlanItems(JSON.stringify(req), JSON.stringify({ sampleId: c.id }), "null")) as { items: { target: string; item: string; lever?: string; at?: string[]; label: string }[] }).items;
      const ref = (label: string) => {
        const x = items.find((i) => i.label.includes(label))!;
        return { target: x.target, item: x.item, ...(x.at !== undefined ? { at: x.at } : {}), ...(x.lever !== undefined ? { lever: x.lever } : {}) };
      };
      const changes = [
        { ...ref("毎月の取り崩し額"), value: 100_000 },
        { ...ref("働く最後の年齢"), value: c.plan },
      ];
      const got = JSON.parse(connectorApply(JSON.stringify(req), JSON.stringify(changes), JSON.stringify({ args: { sampleId: c.id }, office: null }))) as { status: string; request: EngineRequest };
      expect(got.status, c.id).toBe("ok");
      expect(startOf(got.request).age, c.id).toBe(c.start);
    }
  });
});
