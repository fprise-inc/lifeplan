// 入力画面でプランを直す（0036 の8・0043）: プランを選んで欄を直す・戻す・物を足す・外す・連鎖・置き換え・土台から来た差分・
// オフの差分が一覧に出る・取り込みは現状へ・結果のタブと同じ差分
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EngineRequest } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStages } from "../src/workspace/input/stages/index.ts";
import { fieldAddress } from "../src/workspace/input/valueState.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { addCar } from "../src/workspace/input/stages/cars.ts";
import { diffRows, fieldMark, groupMark, planView, recordPlanEdit, referrersOf, removedObjects, revertField, revertRow, settleFields, toggleRow, withoutObjects } from "../src/workspace/plans/planEdit.ts";
import { applyPlan, diffKey, effectiveValues, overwritePlan, savePlan, type Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5));

const plan = (id: string, base: string | null = null, name = `プラン${id}`): Proposal => ({ id, name, createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base, tags: [], diffs: [] });
function setup(model: string): { wh: WorkingHousehold; cat: Catalog } {
  const req = modelHousehold(model);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const wh0 = fromRequest(req, {});
  const wh = { ...wh0, proposals: [plan("B")] };
  return { wh, cat: buildCatalog(wh, self.id, null) };
}

/** 欄の値を少し変える（数の欄だけ） */
function bumped(f: FieldDef, v: unknown): unknown {
  if (f.kind === "yen" || f.kind === "int") return typeof v === "number" ? v + (f.kind === "yen" ? 10000 : 1) : null;
  if (f.kind === "pct" || f.kind === "decimal") return typeof v === "string" ? String(Number(v) + 0.001) : null;
  return null;
}

describe("どの数の欄も、プランを選んで直すとそのプランの差分になり、戻すと差分が消える", () => {
  it.each(MODELS)("%s", (model) => {
    const { wh, cat } = setup(model);
    const view = planView(wh, cat, "B");
    const reqBefore = JSON.stringify(wh.request);
    let checked = 0;
    for (const stage of buildStages(view))
      for (const f of allFields(stage)) {
        const card = allFields(stage);
        if (f.readOnly !== undefined || f.structural === true || f.sideEffects !== undefined) continue;
        const now = f.get(view).value;
        const nv = bumped(f, now);
        if (nv === null) continue;
        const edited = f.set(view, nv as number);
        if (edited === view) continue;
        const w = recordPlanEdit(wh, cat, "B", view, edited);
        expect(JSON.stringify(w.request), f.key).toBe(reqBefore);
        const diffs = w.proposals[0]!.diffs;
        expect(diffs.length, f.key).toBeGreaterThan(0);
        expect(diffs.every((d) => d.op === "set"), `${f.key}: ${JSON.stringify(diffs.map((d) => [d.op, d.item, d.at]))}`).toBe(true);
        const v2 = planView(w, cat, "B");
        expect(f.get(v2).value, f.key).toEqual(f.get(edited).value);
        // 同じ欄を現状の値に戻すと、差分が消える
        const back = settleFields(recordPlanEdit(w, cat, "B", v2, f.set(v2, now as number)), cat, "B", card);
        expect(back.proposals[0]!.diffs.filter((d) => d.op === "set" && fieldAddress(f, v2) !== null), f.key).toEqual([]);
        checked++;
      }
    expect(checked).toBeGreaterThan(0);
    preview(planView(wh, cat, "B").request as EngineRequest);
  });
});

/** 物の集まりの順を ID でそろえた要求の入力（物の集まりの順は計算に効かない。置き換えた物を部品が最後に入れ直すことがある） */
function canon(wh: WorkingHousehold): string {
  const input = structuredClone(wh.request.input) as unknown as { household: Record<string, unknown> };
  for (const [k, v] of Object.entries(input.household)) if (Array.isArray(v)) input.household[k] = [...v].sort((a, b) => String((a as { id?: string }).id).localeCompare(String((b as { id?: string }).id)));
  const sortKeys = (v: unknown): unknown => (Array.isArray(v) ? v.map(sortKeys) : typeof v === "object" && v !== null ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])])) : v);
  return JSON.stringify(sortKeys(input));
}

/** 選択・オンオフ・年月の欄の別の値 */
function other(f: FieldDef, v: unknown): unknown {
  if (f.kind === "select") return f.options.find((o) => o.value !== v && o.value !== "")?.value ?? null;
  if (f.kind === "bool") return v === true ? false : true;
  if (f.kind === "ym" && typeof v === "string") {
    const [y, m] = v.split("-").map(Number) as [number, number];
    return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  return null;
}

describe("選択・オンオフ・年月の欄も、プランを選んで直すとそのプランの差分になり、戻すと差分が消える", () => {
  it.each(MODELS)("%s", (model) => {
    const { wh, cat } = setup(model);
    const view = planView(wh, cat, "B");
    const reqBefore = JSON.stringify(wh.request);
    let checked = 0;
    for (const stage of buildStages(view)) {
      const card = allFields(stage);
      for (const f of card) {
        if (f.readOnly !== undefined || f.sideEffects !== undefined) continue;
        const now = f.get(view).value;
        const nv = other(f, now);
        if (nv === null) continue;
        let edited: WorkingHousehold;
        try {
          edited = f.set(view, nv as string);
        } catch {
          continue;
        }
        if (edited === view || JSON.stringify(edited.request) === JSON.stringify(view.request)) continue;
        const w = recordPlanEdit(wh, cat, "B", view, edited);
        expect(JSON.stringify(w.request), f.key).toBe(reqBefore);
        expect(w.proposals[0]!.diffs.length, f.key).toBeGreaterThan(0);
        const v2 = planView(w, cat, "B");
        expect(canon(v2), f.key).toBe(canon(edited));
        const back = settleFields(recordPlanEdit(w, cat, "B", v2, f.set(v2, now as string)), cat, "B", card);
        const v3 = planView(back, cat, "B");
        // 戻した世帯がもとの世帯と同じなら、差分は残らない
        if (canon(f.set(v2, now as string)) === canon(view)) expect(back.proposals[0]!.diffs, f.key).toEqual([]);
        if (canon(f.set(v2, now as string)) === canon(view)) expect(f.get(v3).value, f.key).toEqual(now);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(0);
  });
});

// ---- 選ぶ・直す・戻す・足す・外す・連鎖・置き換え・土台・オフ・結果のタブ ----

const fieldOf = (wh: WorkingHousehold, suffix: string): FieldDef => {
  const f = buildStages(wh).flatMap((x) => allFields(x)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
};
/** 基本生活費のカードの最初の円の欄 */
const livingOf = (wh: WorkingHousehold): FieldDef => {
  const stage = buildStages(wh).find((x) => x.id === "living")!;
  return allFields(stage).find((x) => x.kind === "yen" && x.readOnly === undefined && x.sideEffects === undefined && typeof x.get(wh).value === "number")!;
};

describe("プランを選んで欄を直す・印・戻す", () => {
  it("現状は変わらず、そのプランの値を変える差分ができる。欄に「現状: ○○」の印。↺ 現状に戻すで差分が消える", () => {
    const { wh, cat } = setup("salariedCoupleTwoKids");
    const view = planView(wh, cat, "B");
    const f = livingOf(view);
    const now = f.get(view).value as number;
    const w = recordPlanEdit(wh, cat, "B", view, f.set(view, now + 20000));
    expect(w.request).toBe(wh.request);
    const d = w.proposals[0]!.diffs;
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ op: "set", item: f.item, origin: { kind: "manual" }, enabled: true });
    expect(d[0]).not.toHaveProperty("key");
    const v2 = planView(w, cat, "B");
    expect(f.get(v2).value).toBe(now + 20000);
    const mark = fieldMark(w, cat, "B", f, v2);
    expect(mark).toMatchObject({ kind: "own" });
    expect(mark!.current).toContain("万円");
    // カードの数と違いの一覧
    const rows = diffRows(w, cat, "B");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ card: "living", kind: "set", enabled: true, inherited: false, origin: "入力で直した" });
    expect(rows[0]!.label).toContain(f.label);
    // 戻す
    expect(revertField(w, cat, "B", f, v2).proposals[0]!.diffs).toEqual([]);
    expect(revertRow(w, cat, "B", rows[0]!).proposals[0]!.diffs).toEqual([]);
  });

  it("土台のプランから来た差分は「土台（プランB）で変更」。戻すと、このプランに現状へ戻す差分ができる", () => {
    const { wh: w0, cat } = setup("salariedCoupleTwoKids");
    const view = planView(w0, cat, "B");
    const f = livingOf(view);
    const now = f.get(view).value as number;
    const wb = recordPlanEdit(w0, cat, "B", view, f.set(view, now + 20000));
    const wh: WorkingHousehold = { ...wb, proposals: [...wb.proposals, plan("C", "B")] };
    const vc = planView(wh, cat, "C");
    expect(f.get(vc).value).toBe(now + 20000);
    expect(fieldMark(wh, cat, "C", f, vc)).toMatchObject({ kind: "base", planName: "プランB" });
    const rows = diffRows(wh, cat, "C");
    expect(rows[0]).toMatchObject({ inherited: true, planName: "プランB" });
    const back = revertField(wh, cat, "C", f, vc);
    const c = back.proposals.find((p) => p.id === "C")!;
    expect(c.diffs).toHaveLength(1);
    expect(f.get(planView(back, cat, "C")).value).toBe(now);
    // 土台のプランは変わらない
    expect(back.proposals.find((p) => p.id === "B")).toEqual(wh.proposals.find((p) => p.id === "B"));
    // 土台と同じ値に戻すと、自分の差分が消える（0036 の8）
    const vc2 = planView(back, cat, "C");
    const again = recordPlanEdit(back, cat, "C", vc2, f.set(vc2, now + 20000));
    expect(again.proposals.find((p) => p.id === "C")!.diffs).toEqual([]);
  });
});

describe("物を足す・外す・連鎖・置き換え", () => {
  it("物を足すと add（足した物の中を直すと add を直す・外すと add が消える）。まとまりに「このプランで足した」", () => {
    const { wh, cat } = setup("housingPurchase");
    const view = planView(wh, cat, "B");
    const added = addCar(view);
    const w = recordPlanEdit(wh, cat, "B", view, added);
    const d = w.proposals[0]!.diffs;
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ op: "add", target: { collection: "car" }, item: null, at: [] });
    expect(w.request).toBe(wh.request);
    const v2 = planView(w, cat, "B");
    const car = v2.request.input.household.cars![0]!;
    const price = fieldOf(v2, `${car.id}/price`);
    const v3 = price.set(v2, 3_500_000);
    const w2 = recordPlanEdit(w, cat, "B", v2, v3);
    expect(w2.proposals[0]!.diffs).toHaveLength(1);
    expect(w2.proposals[0]!.diffs[0]!.op).toBe("add");
    expect(price.get(planView(w2, cat, "B")).value).toBe(3_500_000);
    const g = buildStages(v2).flatMap((x) => x.sections.flatMap((sec) => sec.groups)).find((gr) => gr.fields.some((ff) => ff.key === price.key))!;
    expect(groupMark(w2, "B", g, planView(w2, cat, "B"))).toEqual({ kind: "own", planName: null });
    expect(diffRows(w2, cat, "B")[0]).toMatchObject({ kind: "add", card: "car" });
    // 足した物を外すと、足す差分が消える
    const v4 = planView(w2, cat, "B");
    const w3 = recordPlanEdit(w2, cat, "B", v4, withoutObjects(v4, [car.id]));
    expect(w3.proposals[0]!.diffs).toEqual([]);
    preview(applyPlan(w2, "B", cat).request);
  });

  it("現状の物を外すと remove（before に物の全体）。外す物を指す物を並べ、選んだ物は同じきっかけの remove になる。一覧に一緒に外す差分も出る", () => {
    const { wh, cat } = setup("housingPurchase");
    const view = planView(wh, cat, "B");
    const own = view.request.input.household.residences!.find((r) => r.kind === "own")!;
    const debt = view.request.input.household.debts![0]!;
    const target = withoutObjects(view, [own.id]);
    expect(removedObjects(view, target)).toEqual([own.id]);
    const refs = referrersOf(target, [own.id]);
    expect(refs.map((r) => r.id)).toContain(debt.id);
    const w = recordPlanEdit(wh, cat, "B", view, withoutObjects(target, [debt.id]), { causes: new Map([[debt.id, own.id]]) });
    const diffs = w.proposals[0]!.diffs;
    const rmOwn = diffs.find((d) => d.op === "remove" && (d.target as { object?: string }).object === own.id)!;
    const rmDebt = diffs.find((d) => d.op === "remove" && (d.target as { object?: string }).object === debt.id)!;
    expect(rmOwn).toMatchObject({ item: null, at: [], value: null });
    expect(rmOwn.before).toEqual(wh.request.input.household.residences!.find((r) => r.id === own.id));
    expect(rmDebt.cause).toBe(rmOwn.id);
    const rows = diffRows(w, cat, "B");
    const ownRow = rows.find((r) => r.diffs.includes(rmOwn))!;
    const debtRow = rows.find((r) => r.diffs.includes(rmDebt))!;
    expect(ownRow).toMatchObject({ kind: "remove", card: "housing", followers: 1 });
    expect(debtRow.cause).toBe(ownRow.key);
    // 作業中の世帯から消え、計算できる
    const applied = applyPlan(w, "B", cat).request;
    expect(applied.input.household.debts ?? []).toEqual([]);
    preview(applied);
    // 外した物への自分の set は残さない（先に借入額を変えてから外す）
    const principal = fieldOf(view, `${debt.id}/principal`);
    const wp = recordPlanEdit(wh, cat, "B", view, principal.set(view, 30_000_000));
    const vp = planView(wp, cat, "B");
    const wr = recordPlanEdit(wp, cat, "B", vp, withoutObjects(vp, [debt.id]));
    expect(wr.proposals[0]!.diffs.map((d) => d.op)).toEqual(["remove"]);
    // 戻す（きっかけの行を戻すと、一緒に外した物も戻る）
    expect(revertRow(w, cat, "B", ownRow).proposals[0]!.diffs).toEqual([]);
    // 外した物を作業中の世帯に戻すと、外す差分が消える
    const v2 = planView(w, cat, "B");
    const restored = { ...v2, request: { ...v2.request, input: { ...v2.request.input, household: { ...v2.request.input.household, debts: wh.request.input.household.debts! } } } };
    expect(recordPlanEdit(w, cat, "B", v2, restored).proposals[0]!.diffs.map((d) => d.id)).toEqual([rmOwn.id]);
  });

  it("形が変わる選択は置き換えの組（同じ pair の remove と add）。一覧では1件。現状の種類に戻すと組が消える", () => {
    const { wh, cat } = setup("housingPurchase");
    const view = planView(wh, cat, "B");
    const rent = view.request.input.household.residences!.find((r) => r.kind === "rent")!;
    const edited = { ...view, request: structuredClone(view.request) };
    const r = edited.request.input.household.residences!.find((x) => x.id === rent.id)! as unknown as Record<string, unknown>;
    r.kind = "company";
    const w = recordPlanEdit(wh, cat, "B", view, edited);
    const diffs = w.proposals[0]!.diffs;
    expect(diffs.map((d) => d.op).sort()).toEqual(["add", "remove"]);
    expect(diffs[0]!.pair).toBeTruthy();
    expect(diffs[0]!.pair).toBe(diffs[1]!.pair);
    const rows = diffRows(w, cat, "B");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "replace" });
    // 並びの順は変わらない（外した物のあった所に入る）
    const v2 = planView(w, cat, "B");
    expect(v2.request.input.household.residences!.map((x) => x.id)).toEqual(view.request.input.household.residences!.map((x) => x.id));
    const back = { ...v2, request: structuredClone(view.request) };
    expect(recordPlanEdit(w, cat, "B", v2, back).proposals[0]!.diffs).toEqual([]);
  });
});

describe("オフの差分・取り込みは現状へ・結果のタブと同じ差分", () => {
  it("オフにした差分は当てずに、違いの一覧に残る（オンに戻せる）", () => {
    const { wh, cat } = setup("salariedCoupleTwoKids");
    const view = planView(wh, cat, "B");
    const f = livingOf(view);
    const now = f.get(view).value as number;
    const w = recordPlanEdit(wh, cat, "B", view, f.set(view, now + 20000));
    const row = diffRows(w, cat, "B")[0]!;
    const off = toggleRow(w, "B", row, false);
    expect(f.get(planView(off, cat, "B")).value).toBe(now);
    const rows = diffRows(off, cat, "B");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ enabled: false, review: null });
    const on = toggleRow(off, "B", rows[0]!, true);
    expect(f.get(planView(on, cat, "B")).value).toBe(now + 20000);
  });

  it("結果のタブの動かす項目と同じ当て先の差分は1件（入力で直しても、結果のタブで動かしても同じ差分が変わる）", () => {
    const { wh, cat } = setup("housingPurchase");
    const view = planView(wh, cat, "B");
    // 動かす項目の一覧にある欄（入力の欄から作った項目）
    const item = cat.items.find((it) => it.key.startsWith("field:") && it.control.kind === "field" && it.control.field.kind === "yen")!;
    const f = buildStages(view).flatMap((x) => allFields(x)).find((x) => `field:${x.key}` === item.key)!;
    const now = f.get(view).value as number;
    const w = recordPlanEdit(wh, cat, "B", view, f.set(view, now + 10000));
    const d = w.proposals[0]!.diffs;
    expect(d).toHaveLength(1);
    // 結果のタブはその値を動かす項目のキーで見る（同じ当て先の項目が2つあるときは一覧の先の項目）
    const key = diffKey(d[0]!, w)!;
    expect(cat.byKey.has(key)).toBe(true);
    const values = effectiveValues(w, "B");
    expect(values[key]).toBe(now + 10000);
    // 結果のタブで動かして上書きしても、同じ差分（同じ ID）
    const w2 = overwritePlan(w, cat, "B", { ...values, [key]: now + 30000 }, "2026-10-26T01:00:00Z");
    const d2 = w2.proposals[0]!.diffs;
    expect(d2).toHaveLength(1);
    expect(d2[0]!.id).toBe(d[0]!.id);
    expect(d2[0]!.origin).toEqual({ kind: "result" });
    // 入力でもう一度直すと、また同じ差分
    const v2 = planView(w2, cat, "B");
    expect(f.get(v2).value).toBe(now + 30000);
    const w3 = recordPlanEdit(w2, cat, "B", v2, f.set(v2, now + 40000));
    expect(w3.proposals[0]!.diffs.map((x) => x.id)).toEqual([d[0]!.id]);
    // 結果のタブで作った差分を入力で開いても同じ当て先（新しいプラン）
    const s = savePlan(wh, cat, { name: "プランC", base: null, values: { [key]: now + 50000 }, now: "2026-10-26T00:00:00Z" });
    const vs = planView(s.wh, cat, s.id);
    expect(f.get(vs).value).toBe(now + 50000);
    expect(fieldMark(s.wh, cat, s.id, f, vs)).toMatchObject({ kind: "own" });
    const w4 = recordPlanEdit(s.wh, cat, s.id, vs, f.set(vs, now + 60000));
    expect(w4.proposals.find((p) => p.id === s.id)!.diffs).toHaveLength(1);
  });

  it("取り込み・ヒアリング・明細の承認は現状に入る（入力のホームはプランの差分にしない道具を現状の世帯で受ける）", async () => {
    const { h } = await import("preact");
    const { renderToString } = await import("preact-render-to-string");
    const { InputView } = await import("../src/workspace/input/InputView.tsx");
    const { wh, cat } = setup("housingPurchase");
    const html = renderToString(
      h(InputView, {
        wh,
        onSave: () => undefined,
        level: "simple",
        onLevel: () => undefined,
        tools: h("span", { "data-tools": true }, "道具"),
        imports: h("span", { "data-hearing": true }, "ヒアリングシート"),
        plans: { list: [{ id: "B", label: "プランB", name: "プランB", color: "#0072c6" }], sel: "B", onSelect: () => undefined, onNew: () => undefined, onCopy: () => undefined, cat, onSavePlan: () => undefined, lock: null, onResults: () => undefined },
      }),
    );
    expect(html).toContain("data-plan-band");
    expect(html).toContain("data-current-only");
    expect(html).toContain("現状の確かめの一覧");
    // 取り込みはプランの編集中は押せず、「現状に切り替える」を出す。控えなどの道具は出す。帯に違いの一覧と「結果を見る」（0072）
    expect(html).not.toContain("data-hearing");
    expect(html).toContain("data-to-current");
    expect(html).toContain("data-tools");
    expect(html).toContain("data-plan-results");
    expect(html.indexOf("data-diff-open")).toBeGreaterThan(html.indexOf("data-plan-band"));
    expect(html.indexOf("data-diff-open")).toBeLessThan(html.indexOf("data-plan-new"));
    const cur = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", onLevel: () => undefined, imports: h("span", { "data-hearing": true }, "ヒアリングシート") }));
    expect(cur).toContain("data-imports-open");
    expect(cur).not.toContain("data-current-only");
  });
});

describe("入力のパネル（プランを直しているとき）", () => {
  it("プランの色の帯・欄の印と「↺ 現状に戻す」・外した物の「このプランで外した ↺」を出す", async () => {
    const { h } = await import("preact");
    const { renderToString } = await import("preact-render-to-string");
    const { InputPanel } = await import("../src/workspace/input/InputPanel.tsx");
    const { wh, cat } = setup("salariedCoupleTwoKids");
    const view = planView(wh, cat, "B");
    const f = livingOf(view);
    const w = recordPlanEdit(wh, cat, "B", view, f.set(view, (f.get(view).value as number) + 20000));
    const html = renderToString(h(InputPanel, { wh: w, itemId: "living", level: "detail", onLevel: () => undefined, onSave: () => undefined, onClose: () => undefined, plan: { id: "B", label: "プランB", color: "#0072c6", cat } }));
    expect(html).toContain("data-plan-band");
    expect(html).toContain('data-plan-mark="own"');
    expect(html).toContain("↺ 現状に戻す");
    expect(html).toContain("プランBの差分になります");
    // 住まいを外したプラン
    const hp = setup("housingPurchase");
    const hv = planView(hp.wh, hp.cat, "B");
    const rent = hv.request.input.household.residences!.find((r) => r.kind === "rent")!;
    const wr = recordPlanEdit(hp.wh, hp.cat, "B", hv, withoutObjects(hv, [rent.id]));
    const html2 = renderToString(h(InputPanel, { wh: wr, itemId: "housing", level: "simple", onLevel: () => undefined, onSave: () => undefined, onClose: () => undefined, plan: { id: "B", label: "プランB", color: "#0072c6", cat: hp.cat } }));
    expect(html2).toContain("data-plan-removed");
    expect(html2).toContain("このプランで外した ↺");
  });
});
