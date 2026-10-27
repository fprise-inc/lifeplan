// 推定の値を1回の操作で欄に入れる（0041 の追記 2026-10-27）: 推定の欄にだけ「✓ 入れる」を出す（数の欄は欄の中、ほかは欄の横）。
// 押すと「✓ この値で確定」と同じ操作（値はそのまま・推定の根拠を残した確定）。プランを直しているときは差分になる。
// 確定の欄・未入力の欄には出さない。パネルの上の「推定をまとめて入れる」は、見えている推定の欄の数と同じ
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { Field, FieldStateOps, fillInside } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, availableOps, FILL_LABEL, fieldStatus, planStateOp } from "../src/workspace/input/valueState.ts";
import { applyPlan, type Proposal } from "../src/workspace/plans/plans.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const BASE = "2026-10";
let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const noop = () => undefined;
const fieldOf = (wh: WorkingHousehold, stage: Parameters<typeof buildStage>[0], suffix: string): FieldDef => {
  const f = allFields(buildStage(stage, wh)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
};
/** 欄1つを、現状を直す操作を渡して描く（入力のパネルと同じ形） */
const fieldHtml = (wh: WorkingHousehold, f: FieldDef) => renderToString(h(FieldStateOps.Provider, { value: applyStateOp }, h(Field, { f, wh, onEdit: noop })));
const panel = (wh: WorkingHousehold, card: string, level: "simple" | "detail" = "simple") => renderToString(h(InputPanel, { wh, itemId: card, level, onLevel: noop, onSave: noop, onClose: noop }));
const count = (html: string, s: string) => html.split(s).length - 1;

describe("推定の欄の「✓ 入れる」", () => {
  it("数の欄は、灰色の推定の値と同じ欄の中に置く（欄の下の「✓ この値で確定」の行は無い）", () => {
    const wh = blankHousehold(BASE, ids());
    const f = fieldOf(wh, "living", "/monthly");
    expect(fieldStatus(f, wh).status).toBe("estimated");
    const html = fieldHtml(wh, f);
    expect(html).toMatch(/<span class="fld-box"><input [^>]*class="num has-fill"[^>]*\/><button type="button" class="fld-fill inside"[^>]*data-op="confirm" data-fill-estimate="true">✓ 入れる<\/button><\/span>/);
    expect(html).toContain('aria-label="基本生活費（月額）: 推定の値をこの欄にそのまま入れます（確定になります）"');
    expect(html).not.toContain("✓ この値で確定");
    // ほかの操作（わからない・該当なしなど）は欄の下のまま
    expect(html).toContain("data-op-menu");
    expect(count(html, "data-fill-estimate")).toBe(1);
  });

  it("選択の欄（仮の値）は欄の横に置く", () => {
    const wh = blankHousehold(BASE, ids());
    const f = fieldOf(wh, "family", "/sex");
    expect(fieldStatus(f, wh).status).toBe("estimated");
    const html = fieldHtml(wh, f);
    expect(html).toMatch(/<\/select><button type="button" class="fld-fill"[^>]*data-fill-estimate="true">✓ 入れる<\/button>/);
  });

  it("確定の欄には出さない（押して確定にした後も出ない）", () => {
    const wh = blankHousehold(BASE, ids());
    const f = fieldOf(wh, "living", "/monthly");
    const next = applyStateOp(wh, f, "confirm");
    expect(fieldStatus(f, next).status).toBe("confirmed");
    const html = fieldHtml(next, f);
    expect(html).not.toContain("data-fill-estimate");
    expect(html).not.toContain("has-fill");
    // 操作を渡さない画面（結果のタブの項目など）にも出さない
    expect(renderToString(h(Field, { f, wh, onEdit: noop }))).not.toContain("data-fill-estimate");
  });

  it("値の文字がボタンと重なる長さなら欄の横に出す", () => {
    expect(fillInside("num", "14")).toBe(true);
    expect(fillInside("num", "123.4")).toBe(true);
    expect(fillInside("num", "1,234")).toBe(true);
    expect(fillInside("num", "26.4456")).toBe(false);
    expect(fillInside("num", "12,345,678")).toBe(false);
    expect(fillInside("num", "")).toBe(false);
    expect(fillInside("ym", "1986-04")).toBe(false);
    expect(FILL_LABEL).toBe("✓ 入れる");
  });

  it("1回の操作で、値はそのまま・状態は確定（推定の根拠を残す）。打ち直せば打った値", () => {
    const wh = blankHousehold(BASE, ids());
    const f = fieldOf(wh, "living", "/monthly");
    const before = f.get(wh).value;
    const basis = fieldStatus(f, wh).basis;
    expect(availableOps(f, wh)).toContain("confirm");
    const next = applyStateOp(wh, f, "confirm");
    expect(f.get(next).value).toBe(before);
    expect(fieldStatus(f, next)).toMatchObject({ status: "confirmed", explicit: true, basis });
    expect(next.request.input.household.livingExpenses![0]!.monthly).toMatchObject({ state: "confirmed", origin: { kind: "manual" }, estimate: { basis } });
    // 入れた後に打ち直すのは今までどおり（打った値の確定）
    const typed = f.set(next, 150000);
    expect(f.get(typed).value).toBe(150000);
    expect(fieldStatus(f, typed).status).toBe("confirmed");
  });

  it("プランを直しているときは、そのプランの差分として入る（現状は推定のまま）", () => {
    const base = blankHousehold(BASE, ids());
    const wh: WorkingHousehold = { ...base, proposals: [{ id: "P", name: "プランB", createdAt: "2026-10-27T00:00:00Z", updatedAt: "2026-10-27T00:00:00Z", base: null, tags: [], diffs: [] } as Proposal] };
    const self = roles(wh.request).find((r) => r.key === "self")!;
    const cat = buildCatalog(wh, self.member.id, null);
    const f = fieldOf(wh, "living", "/monthly");
    const p = planStateOp(wh, cat, "P", f, "confirm");
    expect(p.request).toBe(wh.request);
    expect(p.proposals[0]!.diffs).toHaveLength(1);
    expect(p.proposals[0]!.diffs[0]).toMatchObject({ op: "set", value: { state: "confirmed", estimate: { basis: fieldStatus(f, wh).basis } }, before: { state: "estimated" } });
    expect(applyPlan(p, "P", cat).request.input.household.livingExpenses![0]!.monthly).toMatchObject({ state: "confirmed", value: f.get(wh).value });
    expect(fieldStatus(f, p).status).toBe("estimated");
    // プランを直しているパネルにも同じボタンが出る
    const html = renderToString(h(InputPanel, { wh, itemId: "living", level: "simple", onLevel: noop, onSave: noop, onClose: noop, plan: { id: "P", label: "プランB", color: "#0072c6", cat } }));
    expect(html).toContain("data-fill-estimate");
  });
});

describe("パネルの「推定をまとめて入れる」", () => {
  it.each([
    ["blank", "assumptions"],
    ["blank", "living"],
    ["blank", "family"],
    ["salariedCoupleTwoKids", "assumptions"],
  ])("%s の %s: パネルの上に出し、数は欄の「✓ 入れる」の数と同じ", (m, card) => {
    const wh = m === "blank" ? blankHousehold(BASE, ids()) : fromRequest(modelHousehold(m), {});
    for (const level of ["simple", "detail"] as const) {
      const html = panel(wh, card, level);
      const fills = count(html, "data-fill-estimate");
      expect(fills, level).toBeGreaterThan(0);
      const bulk = /<div class="ip-bulk"><button type="button" class="fld-fill"[^>]*data-confirm-all="true">✓ 推定をまとめて入れる（(\d+)つ）<\/button>/.exec(html);
      expect(bulk, level).not.toBeNull();
      expect(Number(bulk![1])).toBe(fills);
      // パネルの頭（本体より上）にある
      expect(html.indexOf("data-confirm-all")).toBeLessThan(html.indexOf('class="ip-body"'));
    }
  });

  it("推定の欄が無いパネルには出さない", () => {
    const html = panel(fromRequest(modelHousehold("salariedCoupleTwoKids"), {}), "family");
    expect(html).not.toContain("data-fill-estimate");
    expect(html).not.toContain("data-confirm-all");
  });
});
