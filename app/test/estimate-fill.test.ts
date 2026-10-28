// 推定の値を1回の操作で欄に入れる（0041 の追記 2026-10-27）: 推定の欄にだけ「この値にする」を出す（数の欄は欄の中、ほかは欄の横）。
// 押すと「この値にする」と同じ操作（値はそのまま・推定の根拠を残した確定）。プランを直しているときは差分になる。
// 確定の欄・未入力の欄には出さない。パネルの上の「推定の値をまとめて使う」は、見えている推定の欄の数と同じ
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { Field, FieldStateOps, fillInside } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { householdSize, isPureSplit, LIVING_CATEGORY_ORDER, withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { addChildWithEducation, addMember } from "../src/workspace/input/stages/family.ts";
import { livingStatistic } from "../../hearing/src/estimates.ts";
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

describe("推定の欄の「この値にする」", () => {
  it("数の欄は、灰色の推定の値と同じ欄の中に置く（欄の下の「この値にする」の行は無い）", () => {
    const wh = blankHousehold(BASE, ids());
    const f = fieldOf(wh, "living", "/monthly");
    expect(fieldStatus(f, wh).status).toBe("estimated");
    const html = fieldHtml(wh, f);
    expect(html).toMatch(/<span class="fld-box"><input [^>]*class="num has-fill"[^>]*\/><button type="button" class="fld-fill inside"[^>]*data-op="confirm" data-fill-estimate="true">この値にする<\/button><\/span>/);
    expect(html).toContain('aria-label="基本生活費（月額）: 推定の値をこの欄にそのまま入れます（確定になります）"');
    expect(count(html, "この値にする")).toBe(1);
    // ほかの操作（わからない・該当なしなど）は欄の下のまま
    expect(html).toContain("data-op-menu");
    expect(count(html, "data-fill-estimate")).toBe(1);
  });

  it("選択の欄（推定）は欄の横に置く", () => {
    const wh = addChildWithEducation(blankHousehold(BASE, ids()), ids());
    const f = fieldOf(wh, "education", "/preset");
    expect(fieldStatus(f, wh).status).toBe("estimated");
    const html = fieldHtml(wh, f);
    expect(html).toMatch(/<\/select><button type="button" class="fld-fill"[^>]*data-fill-estimate="true">この値にする<\/button>/);
  });

  it("性別の欄は推定にしない（推定の印・「この値にする」・「推定に戻す」を出さない）", () => {
    let wh = addMember(blankHousehold(BASE, ids()), "spouse", ids());
    wh = addMember(wh, "parent", ids());
    wh = addChildWithEducation(wh, ids(), true);
    for (const stage of ["family", "care"] as const) {
      for (const f of allFields(buildStage(stage, wh)).filter((x) => x.key.endsWith("/sex"))) {
        expect(fieldStatus(f, wh).status).toBe("confirmed");
        expect(availableOps(f, wh)).toEqual([]);
        const html = fieldHtml(wh, f);
        expect(html).not.toContain("data-fill-estimate");
        expect(html).not.toContain(FILL_LABEL);
        expect(html).not.toContain("推定に戻す");
        expect(html).not.toContain(">推定<");
      }
    }
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
    // 「この値にする」の分（欄の左の 5.4em）を空けると、値に使えるのは 3.6em まで
    expect(fillInside("num", "715.9")).toBe(true);
    expect(fillInside("num", "12,345")).toBe(false);
    expect(fillInside("num", "12,345,678")).toBe(false);
    expect(fillInside("num", "")).toBe(false);
    expect(fillInside("ym", "1986-04")).toBe(false);
    expect(FILL_LABEL).toBe("この値にする");
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

describe("パネルの「推定の値をまとめて使う」", () => {
  it.each([
    ["blank", "assumptions"],
    ["blank", "living"],
    ["blank", "family"],
    ["salariedCoupleTwoKids", "assumptions"],
  ])("%s の %s: パネルの上に出し、数は欄の「この値にする」の数と同じ", (m, card) => {
    const wh = m === "blank" ? blankHousehold(BASE, ids()) : fromRequest(modelHousehold(m), {});
    for (const level of ["simple", "detail"] as const) {
      const html = panel(wh, card, level);
      const fills = count(html, "data-fill-estimate");
      expect(fills, level).toBeGreaterThan(0);
      const bulk = /<div class="ip-bulk"><button type="button" class="fld-fill"[^>]*data-confirm-all="true">推定の値をまとめて使う（(\d+)つ）<\/button>/.exec(html);
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

describe("基本生活費の総額の推定は千円単位（前に保存した世帯は黙って書き換えない）", () => {
  const two = (): WorkingHousehold => {
    let wh = blankHousehold(BASE, ids());
    wh = withRefreshedEstimates(addMember(wh, "spouse"));
    return wh;
  };
  const living = (wh: WorkingHousehold) => wh.request.input.household.livingExpenses![0]!;
  /** 前の版で保存した形: 総額の推定が表の額のまま（丸める前） */
  const legacy = (wh: WorkingHousehold, byCategory: boolean): WorkingHousehold =>
    mutate(wh, (h) => {
      const l = h.livingExpenses![0]!;
      const raw = livingStatistic(2).value;
      l.monthly = { ...(l.monthly as object), value: raw } as typeof l.monthly;
      if (byCategory) {
        l.mode = "byCategory";
        // 前の版の按分（1円単位。端は「その他の消費」）
        l.categories = LIVING_CATEGORY_ORDER.map((category, i) => ({ id: `00000000-0000-4000-8000-0000000009${String(i).padStart(2, "0")}`, category, monthly: { value: category === "allowance" ? 0 : category === "otherConsumption" ? raw - 7 * 12345 : 12345, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: "総額を費目に分けた目安（前の版）" } } })) as typeof l.categories;
      }
    });

  it("新しく入れる推定は千円単位", () => {
    const wh = two();
    expect(householdSize(wh.request.input.household, BASE)).toBe(2);
    expect(living(wh).monthly!.value).toBe(235000);
  });

  it("前の版の推定（丸める前の額）は、ほかを直しても人数が同じなら書き換えない（総額で・費目で）", () => {
    for (const byCategory of [false, true]) {
      const old = legacy(two(), byCategory);
      // 推定の入れ直し（パネルで何かを直すたびに通る）
      expect(withRefreshedEstimates(old), String(byCategory)).toBe(old);
      const edited = withRefreshedEstimates(mutate(old, (h) => void (h.members[0]!.birth.birthYearMonth = "1980-01")));
      expect(living(edited).monthly!.value).toBe(livingStatistic(2).value);
      expect(living(edited).categories).toEqual(living(old).categories);
    }
  });

  it("人数が変わったら、新しい人数の推定（千円単位）に入れ直す。按分のままの費目も千円単位で、合計は総額", () => {
    const pure = legacy(two(), true);
    // 前の版の按分（根拠の文の頭が同じ）は、按分のままと読む
    expect(isPureSplit(living(pure))).toBe(true);
    const three = withRefreshedEstimates(addMember(pure, "child"));
    const l = living(three);
    expect(l.monthly!.value).toBe(264000);
    expect(l.categories!.reduce((s, c) => s + c.monthly.value!, 0)).toBe(264000);
    for (const c of l.categories!) expect(c.monthly.value! % 1000, c.category).toBe(0);
  });
});
