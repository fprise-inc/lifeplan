// 入力の画面: 結果のタブで動かした「運用の利回り」（前提の returnShifts）・「変動金利の上昇」（前提の loanRateShifts）は、
// 口座の利回り・ローンの金利の欄を書き換えない前提の書き換えなので、前提条件のカードに読むだけで出し、貯蓄・運用のパネルにも
// 口座の利回りに足して計算することを知らせる（プランを入力で開いたとき、現状の利回り・金利だけが見えて計算と違って見えないように）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { SavingsPanel } from "../src/workspace/input/savings/SavingsPanel.tsx";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { pctText, subRate } from "../src/workspace/plans/decimal.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { planView } from "../src/workspace/plans/planEdit.ts";
import { reflectPlan, savePlan } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-10-31T10:00:00.000Z";
const noop = () => {};

function setup(model: string): { wh: WorkingHousehold; cat: Catalog } {
  const req = modelHousehold(model);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const wh = fromRequest(req, {});
  return { wh, cat: buildCatalog(wh, self.id, null) };
}

const shiftField = (wh: WorkingHousehold, item: string): FieldDef | undefined => allFields(buildStage("assumptions", wh)).find((f) => f.item === item);

describe("運用の利回りを動かしたプランを入力の画面で開く", () => {
  for (const model of ["salariedCoupleTwoKids", "single25"]) {
    it(`${model}: 前提条件のカードに、口座の利回りに足す幅が読むだけで出る。現状には出ない`, () => {
      const { wh, cat } = setup(model);
      const raw = cat.byKey.get("inv:rate")!.read(wh) as string;
      const b = savePlan(wh, cat, { name: "プランB", base: null, values: { "inv:rate": "0.02" }, now: NOW });
      const view = planView(b.wh, cat, b.id);
      const f = shiftField(view, "assumptions.returnShifts");
      expect(f).toBeDefined();
      expect(f!.readOnly).toBeDefined();
      const by = view.request.input.baseMonth.slice(0, 4);
      const delta = subRate("0.02", raw);
      expect(f!.get(view).value).toBe(`${by}年から、運用する口座の利回りに ${Number(delta) > 0 ? "+" : ""}${pctText(delta, 1)}`);
      // 現状（書き換えの無い世帯）には出さない
      expect(shiftField(b.wh, "assumptions.returnShifts")).toBeUndefined();
    });
  }

  it("現状に反映したあとは、現状の前提条件のカードに出る", () => {
    const { wh, cat } = setup("salariedCoupleTwoKids");
    const b = savePlan(wh, cat, { name: "プランB", base: null, values: { "inv:rate": "0.02" }, now: NOW });
    const now = reflectPlan(b.wh, cat, b.id, NOW);
    expect(shiftField(now, "assumptions.returnShifts")).toBeDefined();
    // 前提条件のパネルの「標準」の出し方で見える
    const html = renderToString(h(InputPanel, { wh: now, itemId: "assumptions", level: "simple", onLevel: noop, onSave: noop, onClose: noop }));
    expect(html).toContain("結果のタブで動かした利回り・金利");
    expect(html).toContain("運用の利回りの書き換え");
  });

  it("貯蓄・運用のパネルに、口座の利回りに書き換えの幅を足して計算することを出す（現状には出さない）", () => {
    const { wh, cat } = setup("salariedCoupleTwoKids");
    const b = savePlan(wh, cat, { name: "プランB", base: null, values: { "inv:rate": "0.02" }, now: NOW });
    const view = planView(b.wh, cat, b.id);
    const html = renderToString(h(SavingsPanel, { wh: view, level: "simple", onEdit: noop }));
    expect(html).toContain("data-return-shifts");
    expect(html).toContain("運用の利回りの書き換え");
    expect(renderToString(h(SavingsPanel, { wh: b.wh, level: "simple", onEdit: noop }))).not.toContain("data-return-shifts");
  });
});

describe("変動金利の上昇を動かしたプランを入力の画面で開く", () => {
  it("前提条件のカードに、上乗せの始まりと幅が読むだけで出る。現状には出ない", () => {
    const { wh, cat } = setup("salariedCoupleTwoKids");
    expect(cat.byKey.has("rates:shift")).toBe(true);
    const b = savePlan(wh, cat, { name: "プランB", base: null, values: { "rates:shift": { add: "0.01", from: "2030-01" } }, now: NOW });
    const view = planView(b.wh, cat, b.id);
    const f = shiftField(view, "assumptions.loanRateShifts");
    expect(f?.readOnly).toBeDefined();
    expect(f?.get(view).value).toBe("2030年1月から、変動金利の段の金利に +1%");
    expect(shiftField(b.wh, "assumptions.loanRateShifts")).toBeUndefined();
  });
});
