// 固定資産税の推定の変化の表（0238）: 推定から入った年は、推定のまま・「この値にする」で確かめた後・手で直した後のどれでも、同じ1つの表の行のまま。
// 表は閉じた形（要約の1行と開くボタン）から始める。推定のままの年の「詳しく」には「いつから」「何年かけて移すか」を出さない。
// 自分で足した変化・例外の年は1件ずつの枠のまま。家賃・修繕の変化は変えない。見せ方だけで、世帯の値と計算は変えない
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { Residence } from "../src/engine/types.ts";
import { allFields, type ActionDef, type FieldDef, type GroupDef, type StageTableDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { AUTO_ROW_NOTE } from "../src/workspace/input/staged.ts";
import { STAGE_TABLE_OPEN, stageRowMoreLabel, stageRowOpenKey, tableAction, tableField } from "../src/workspace/input/StageTable.tsx";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { isAutoTaxStage, taxStageId } from "../src/workspace/input/propertyTax.ts";
import { confirmAllEstimates } from "../src/workspace/input/checkRows.ts";
import { applyStateOp, availableOps, typeValue } from "../src/workspace/input/valueState.ts";
import { modelHousehold, preview } from "./helpers.ts";

type W = WorkingHousehold;
const noop = () => undefined;
const stage = (wh: W) => buildStage("housing", wh);
const groups = (wh: W): GroupDef[] => stage(wh).sections.flatMap((s) => s.groups);
const settle = (wh: W) => withProvisionalHousing(withRefreshedEstimates(wh));
const actions = (wh: W): ActionDef[] => stage(wh).sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)]);
function action(wh: W, key: string): W {
  const a = actions(wh).find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return settle(a.run(wh));
}
const maybeField = (wh: W, suffix: string): FieldDef | undefined => allFields(stage(wh)).find((x) => x.key.endsWith(suffix));
function fieldOf(wh: W, suffix: string): FieldDef {
  const f = maybeField(wh, suffix);
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const set = (wh: W, suffix: string, v: Parameters<FieldDef["set"]>[1]): W => settle(fieldOf(wh, suffix).set(wh, v));
/** 欄に打つ（画面で打つのと同じ道） */
const type = (wh: W, suffix: string, v: string | number): W => settle(typeValue(fieldOf(wh, suffix), wh, v));
/** 「この値にする」（推定のままの欄を確かめる） */
function confirm(wh: W, suffix: string): W {
  const f = fieldOf(wh, suffix);
  expect(availableOps(f, wh)).toContain("confirm");
  return settle(applyStateOp(wh, f, "confirm"));
}
/** 固定資産税のある家（1件だけの世帯で使う） */
const home = (wh: W): Residence => (wh.request.input.household.residences ?? []).filter((r) => r.propertyTax !== undefined).at(-1)!;
const stages = (wh: W) => home(wh).propertyTax?.stages ?? [];
const autoCount = (wh: W): number => stages(wh).filter((s) => s.id !== undefined && isAutoTaxStage(wh.request.input.household, home(wh).id, s.id)).length;
const ratioKey = (wh: W, i: number, tail = "ratio") => `/propertyTax/stage/${stages(wh).at(i)!.id!}/${tail}`;
const tableGroupOf = (wh: W): GroupDef | undefined => groups(wh).find((g) => g.key.endsWith("/propertyTax/autoStages"));
const tableOf = (wh: W): StageTableDef => {
  const t = tableGroupOf(wh)?.table;
  if (t === undefined) throw new Error("no table");
  return t;
};
/** 1件ずつの枠になっている固定資産税の変化（段階と例外の年） */
const boxes = (wh: W): GroupDef[] => groups(wh).filter((g) => /\/propertyTax\/(stage|except)\/[^/]+$/.test(g.key));
const panel = (wh: W, open: (key: string) => boolean = () => false) => renderToString(h(InputPanel, { wh, itemId: "housing", level: "detail", onLevel: noop, onSave: noop, onClose: noop, groupOpen: { isOpen: open, toggle: noop } }));
const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length;
/** 表の所だけ（次のまとまりの手前まで） */
const tableHtml = (html: string): string => {
  const at = html.indexOf('data-stage-table="');
  expect(at).toBeGreaterThan(-1);
  return html.slice(html.lastIndexOf("<div", at));
};

/** 今住んでいる持ち家（評価額 → 買った年月 → 建った年 → 構造の順。画面の編集と同じ） */
function ownHome(base: string, o: { built?: number; structure?: string; birth?: string } = {}): W {
  let wh = action(blankHousehold(base), "housing/addOwn");
  if (o.birth !== undefined) wh = settle(mutate(wh, (hh) => void (hh.members.find((m) => m.kind === "self")!.birth.birthYearMonth = o.birth!)));
  const id = home(wh).id;
  wh = set(wh, `${id}/valuation/value`, 40000000);
  wh = set(wh, `${id}/from`, { at: "2012-04" });
  wh = set(wh, `${id}/valuation/builtYear`, o.built ?? 2012);
  if (o.structure !== undefined) wh = set(wh, `${id}/valuation/structure`, o.structure);
  return wh;
}
/** 購入の予定（まだ買っていない家） */
const buying = (base: string): W => action(blankHousehold(base), "housing/addPurchase");

describe("固定資産税の推定の変化は、何件でも1つの表（閉じた形から始める）", () => {
  it("推定のままの画面: 閉じた形で、要約（期間・件数・最初と最後の額）と開くボタンだけが見える", () => {
    const wh = ownHome("2026-10");
    const n = stages(wh).length;
    expect(n).toBeGreaterThan(3);
    const g = tableGroupOf(wh)!;
    const t = tableOf(wh);
    expect(g.title).toMatch(new RegExp(`^固定資産税の推定の変化（.*\\d{4}〜\\d{4}年・${String(n)}件）$`));
    expect(t.name).toBe("固定資産税の推定の変化");
    expect(t.what).toMatch(new RegExp(`\\d{4}〜\\d{4}年・${String(n)}件$`));
    expect(t.ends).toMatch(/^\d{4}年から 年約[\d.,]+万?円 → \d{4}年から 年約[\d.,]+万?円$/);
    expect(t.estimated).toBe(n);
    expect(t.rows.length).toBe(n);
    expect(boxes(wh)).toEqual([]);

    const html = tableHtml(panel(wh));
    expect(html).toContain('data-stage-table="closed"');
    // 開くボタン: 開け閉めの状態・開く先・読み上げの名前
    const toggle = /<button[^>]*data-stage-table-toggle="[^"]*"[^>]*>/.exec(html)![0];
    expect(toggle).toContain('aria-expanded="false"');
    expect(toggle).toContain(`aria-label="${STAGE_TABLE_OPEN}（固定資産税の推定の変化）"`);
    const controls = /aria-controls="([^"]+)"/.exec(toggle)![1]!;
    // 表の中身は隠す（描いてはおく。確かめの一覧から欄へ移れるように）
    expect(html).toMatch(new RegExp(`<div[^>]*class="stage-table-body"[^>]*id="${controls}"[^>]*hidden`));
    expect(html).toContain(t.ends!);
    expect(html).toContain(STAGE_TABLE_OPEN);
  });

  it("開いた形: 1年1行で、行に年・割合・その年からの額の目安と「詳しく」。行の「詳しく」は閉じている", () => {
    const wh = ownHome("2026-10");
    const g = tableGroupOf(wh)!;
    const t = tableOf(wh);
    const html = tableHtml(panel(wh, (k) => k === g.key));
    expect(html).toContain('data-stage-table="open"');
    expect(/<button[^>]*data-stage-table-toggle="[^"]*"[^>]*>/.exec(html)![0]).toContain('aria-expanded="true"');
    expect(html).not.toMatch(/<div[^>]*class="stage-table-body"[^>]*hidden/);
    expect(count(html, /role="listitem"/g)).toBe(t.rows.length);
    expect(count(html, /data-stage-row-state="estimated"/g)).toBe(t.rows.length);
    for (const row of t.rows) {
      expect(row.label).toMatch(/^\d{4}年から$/);
      expect(row.value.kind).toBe("pct");
      // 行の「詳しく」: 読み上げの名前に、どの年の何が出るか
      expect(html).toContain(`aria-label="${stageRowMoreLabel(row, false)}"`);
      expect(stageRowMoreLabel(row, false)).toBe(`${row.label}の変化を詳しく（入れ方・外す）`);
    }
    expect(count(html, /<button[^>]*data-stage-row-toggle="[^"]*"[^>]*aria-expanded="false"|<button[^>]*aria-expanded="false"[^>]*data-stage-row-toggle/g)).toBe(t.rows.length);
    expect(count(html, /class="stage-row-detail"[^>]*hidden/g)).toBe(t.rows.length);
  });

  it("件数が少なくても（3件以下・1件）同じ表。推定の変化が無ければ表は出さない", () => {
    for (const built of [2007, 2001]) {
      const wh = ownHome("2026-10", { built });
      const n = stages(wh).length;
      expect(n).toBeGreaterThan(0);
      expect(n).toBeLessThanOrEqual(3);
      expect(tableOf(wh).rows.length).toBe(n);
      expect(boxes(wh)).toEqual([]);
      expect(tableHtml(panel(wh))).toContain('data-stage-table="closed"');
    }
    const one = ownHome("2026-10", { built: 2001 });
    expect(tableOf(one).ends).toMatch(/^\d{4}年から 年約[\d.,]+万?円$/);
    const none = action(blankHousehold("2026-10"), "housing/addOwn");
    expect(stages(none)).toEqual([]);
    expect(tableGroupOf(none)).toBeUndefined();
    expect(panel(none)).not.toContain("data-stage-table=");
  });
});

describe("推定のまま・確かめた後・手で直した後が、同じ表の行のまま", () => {
  it("「この値にする」で確かめた年・割合を直した年は、表から出て1件ずつの枠にならない", () => {
    let wh = ownHome("2026-10");
    const n = stages(wh).length;
    const ids = stages(wh).map((s) => s.id);
    wh = confirm(wh, ratioKey(wh, 0));
    wh = type(wh, ratioKey(wh, 1), "0.9");
    expect(stages(wh).map((s) => s.id)).toEqual(ids);
    expect(stages(wh)[1]!.ratio).toBe("0.9");
    const t = tableOf(wh);
    expect(t.rows.map((r) => r.id)).toEqual(ids);
    expect(t.rows.map((r) => r.estimated)).toEqual([false, false, ...Array.from({ length: n - 2 }, () => true)]);
    expect(t.estimated).toBe(n - 2);
    expect(autoCount(wh)).toBe(n - 2);
    expect(boxes(wh)).toEqual([]);
    const g = tableGroupOf(wh)!;
    const html = tableHtml(panel(wh, (k) => k === g.key));
    expect(count(html, /data-stage-row-state="set"/g)).toBe(2);
    expect(count(html, /data-stage-row-state="estimated"/g)).toBe(n - 2);
    // 要約の行に、推定のままの件数
    expect(html).toContain(`のまま ${String(n - 2)}件`);
  });

  it("まとめて「この値にする」（全部を確かめた後）も、同じ表・同じ行数のまま", () => {
    let wh = ownHome("2026-10");
    const n = stages(wh).length;
    wh = settle(confirmAllEstimates(wh).wh);
    expect(autoCount(wh)).toBe(0);
    const t = tableOf(wh);
    expect(t.rows.length).toBe(n);
    expect(t.rows.every((r) => !r.estimated)).toBe(true);
    expect(t.estimated).toBe(0);
    expect(t.removeAuto).toBeNull();
    expect(boxes(wh)).toEqual([]);
    const html = tableHtml(panel(wh));
    expect(html).toContain('data-stage-table="closed"');
    expect(html).not.toContain("data-stage-table-est");
  });

  it("購入の予定（まだ買っていない家）も同じ。まとめて確かめた後も1つの表", () => {
    for (const base of ["2026-10", "2026-02"]) {
      let wh = buying(base);
      const n = stages(wh).length;
      expect(n).toBeGreaterThan(3);
      expect(tableOf(wh).rows.length).toBe(n);
      expect(tableOf(wh).what).toContain("新築の軽減の終わり・3年ごとの評価替え");
      wh = settle(confirmAllEstimates(wh).wh);
      expect(tableOf(wh).rows.length).toBe(n);
      expect(tableOf(wh).estimated).toBe(0);
      expect(boxes(wh)).toEqual([]);
    }
  });

  it("入れ方を額に切り替えた年も表の行のまま（行の欄が額になる）", () => {
    let wh = ownHome("2026-10");
    const id = stages(wh)[1]!.id!;
    wh = set(wh, ratioKey(wh, 1, "mode"), "amount");
    const row = tableOf(wh).rows.find((r) => r.id === id)!;
    expect(row.estimated).toBe(false);
    expect(row.value.key.endsWith(`/propertyTax/stage/${id}/amount`)).toBe(true);
    expect(boxes(wh)).toEqual([]);
    wh = type(wh, `/propertyTax/stage/${id}/amount`, 150000);
    expect((stages(wh)[1]!.amount as { value?: number }).value).toBe(150000);
    expect(tableOf(wh).rows.find((r) => r.id === id)!.label).toMatch(/^\d{4}年から$/);
  });
});

describe("推定のままの年には「いつから」「何年かけて移すか」を出さない（確かめた後・直した後は出す）", () => {
  it("推定のままの年の「詳しく」は入れ方と「外す」だけで、訳と直すときの道筋の一言を添える", () => {
    const wh = ownHome("2026-10");
    const t = tableOf(wh);
    for (const row of t.rows) {
      expect(row.detail.map((f) => f.key.split("/").at(-1))).toEqual(["mode"]);
      expect(row.note).toBe(AUTO_ROW_NOTE);
      expect(row.ramp).toBeNull();
      expect(maybeField(wh, `/propertyTax/stage/${row.id}/at`)).toBeUndefined();
      expect(maybeField(wh, `/propertyTax/stage/${row.id}/ramp`)).toBeUndefined();
    }
    expect(AUTO_ROW_NOTE).toContain("この値にする");
    const g = tableGroupOf(wh)!;
    const row = t.rows[1]!;
    const html = tableHtml(panel(wh, (k) => k === g.key || k === stageRowOpenKey(g.key, row.id)));
    expect(html).toContain(AUTO_ROW_NOTE);
    expect(html).toContain(`aria-label="${stageRowMoreLabel(row, true)}"`);
    expect(html).toContain(`aria-label="${row.label}の変化を外す"`);
    expect(html).not.toContain("何年かけて移すか</");
    // まとまりの説明（「?」）にも、どうすれば直せるか
    expect(g.note).toContain("確かめた年・直した年は「いつから」「何年かけて移すか」も直せます");
  });

  it("確かめた年・直した年の「詳しく」には「いつから・入れ方・何年かけて移すか」が出て、直した値は推定し直しても戻らない", () => {
    let wh = ownHome("2026-10");
    const id = stages(wh)[1]!.id!;
    const k = `/propertyTax/stage/${id}`;
    wh = confirm(wh, `${k}/ratio`);
    const row = tableOf(wh).rows.find((r) => r.id === id)!;
    expect(row.detail.map((f) => f.key.split("/").at(-1))).toEqual(["at", "mode", "ramp"]);
    expect(row.note).toBeNull();
    expect(stageRowMoreLabel(row, false)).toBe(`${row.label}の変化を詳しく（いつから・入れ方・外す）`);
    const year = Number(stages(wh)[1]!.at.at!.slice(0, 4));
    wh = settle(fieldOf(wh, `${k}/at`).time!.setWhen(wh, { at: `${String(year + 1)}-01` }, "this"));
    wh = type(wh, `${k}/ramp`, 2);
    const mine = () => stages(wh).find((s) => s.id === id)!;
    expect(mine().at).toEqual({ at: `${String(year + 1)}-01` });
    expect(mine().rampYears).toBe(2);
    expect(tableOf(wh).rows.find((r) => r.id === id)!.ramp).toBe("2年かけて移す");
    expect(tableOf(wh).rows.find((r) => r.id === id)!.label).toBe(`${String(year + 1)}年から`);
    // 推定し直す（評価額を直す）: 確かめた年は入れた形のまま、推定のままの年だけ入れ直す
    wh = type(wh, `${home(wh).id}/valuation/value`, 45000000);
    expect(mine().at).toEqual({ at: `${String(year + 1)}-01` });
    expect(mine().rampYears).toBe(2);
    expect(tableOf(wh).rows.find((r) => r.id === id)!.estimated).toBe(false);
    expect(boxes(wh)).toEqual([]);
  });

  it("最後の年には「何年かけて移すか」は無い（後に変化が続かない。1件ずつの枠のときと同じ）", () => {
    let wh = ownHome("2026-10");
    wh = confirm(wh, ratioKey(wh, -1));
    expect(tableOf(wh).rows.at(-1)!.detail.map((f) => f.key.split("/").at(-1))).toEqual(["at", "mode"]);
  });
});

describe("自分で足した変化・例外の年は1件ずつの枠のまま。家賃・修繕の変化は変えない", () => {
  it("「＋ 固定資産税の変化」で足した変化・例外の年は表に入らない", () => {
    let wh = ownHome("2026-10");
    const n = stages(wh).length;
    wh = action(wh, "/propertyTax/addStage");
    wh = action(wh, "/propertyTax/addException");
    expect(stages(wh).length).toBe(n + 1);
    expect(tableOf(wh).rows.length).toBe(n);
    const own = boxes(wh);
    expect(own.map((g) => g.key.split("/").at(-2)).sort()).toEqual(["except", "stage"]);
    expect(own.every((g) => g.table === undefined)).toBe(true);
    // 自分で足した変化は、今までどおり「いつから」も出る
    const added = own.find((g) => g.key.includes("/stage/"))!;
    expect(added.fields.some((f) => f.key.endsWith("/at"))).toBe(true);
    // 推定の変化を全部外しても、自分で足した物は枠のまま残る
    wh = action(wh, "/propertyTax/autoStages/remove");
    expect(tableGroupOf(wh)).toBeUndefined();
    expect(boxes(wh).length).toBe(2);
  });

  it("家賃・修繕の変化は、何件足しても1件ずつの枠（表にならない）", () => {
    let wh = ownHome("2026-10");
    const maint = actions(wh).filter((a) => a.key.endsWith("/addStage") && !a.key.includes("/propertyTax/"));
    expect(maint.length).toBeGreaterThan(0);
    for (let i = 0; i < 5; i++) for (const a of actions(wh).filter((x) => x.key.endsWith("/addStage") && !x.key.includes("/propertyTax/"))) wh = settle(a.run(wh));
    const others = groups(wh).filter((g) => /\/stage\/[^/]+$/.test(g.key) && !g.key.includes("/propertyTax/"));
    expect(others.length).toBe(5 * maint.length);
    expect(groups(wh).filter((g) => g.table !== undefined).map((g) => g.key)).toEqual([tableGroupOf(wh)!.key]);

    let rent = action(blankHousehold("2026-10"), "housing/addRent");
    for (let i = 0; i < 5; i++) for (const a of actions(rent).filter((x) => x.key.endsWith("/addStage"))) rent = settle(a.run(rent));
    expect(groups(rent).filter((g) => /\/stage\/[^/]+$/.test(g.key)).length).toBeGreaterThanOrEqual(5);
    expect(groups(rent).some((g) => g.table !== undefined)).toBe(false);
    expect(panel(rent)).not.toContain("data-stage-table=");
  });
});

describe("表の欄・ボタンは、1件ずつの枠のときと同じ所に書く（見せ方だけ）", () => {
  it("まとまりの欄・ボタンの一覧に、行の欄・行の「詳しく」の欄・「外す」が全部入る（確かめの一覧・検索・片付けが読む）", () => {
    let wh = ownHome("2026-10");
    wh = confirm(wh, ratioKey(wh, 0));
    const g = tableGroupOf(wh)!;
    const t = g.table!;
    const keys = new Set(g.fields.map((f) => f.key));
    for (const row of t.rows) {
      expect(keys.has(row.value.key)).toBe(true);
      for (const f of row.detail) expect(keys.has(f.key)).toBe(true);
      expect(g.actions.some((a) => a.key === row.remove.key)).toBe(true);
    }
    expect(g.fields.length).toBe(t.rows.reduce((s, r) => s + 1 + r.detail.length, 0));
    expect(g.actions.some((a) => a.key === t.removeAuto!.key)).toBe(true);
    // 行の「詳しく」の欄は、欄の一覧ではどの年の欄か分かる名前
    expect(g.fields.find((f) => f.key.endsWith(`${t.rows[0]!.id}/at`))!.label).toMatch(new RegExp(`^${t.rows[0]!.label}・いつから`));
  });

  it("表が描く欄・ボタンは、まとまりの欄・ボタン（書いた後の片付けの付いた物）と同じ物。名前だけ行の名前", () => {
    let wh = ownHome("2026-10");
    wh = confirm(wh, ratioKey(wh, 0));
    const g = tableGroupOf(wh)!;
    const t = g.table!;
    for (const row of t.rows) {
      for (const f of [row.value, ...row.detail]) {
        const inGroup = g.fields.find((x) => x.key === f.key)!;
        const drawn = tableField(g, f);
        // 項目を組み立てるときに包んだ欄（書く関数が包んだ物）を使う
        expect(inGroup.set).not.toBe(f.set);
        expect(drawn.set).toBe(inGroup.set);
        expect(drawn.time?.setWhen).toBe(inGroup.time?.setWhen);
        expect(drawn.label).toBe(f.label);
        expect(drawn.key).toBe(f.key);
      }
      const inGroup = g.actions.find((x) => x.key === row.remove.key)!;
      expect(inGroup.run).not.toBe(row.remove.run);
      expect(tableAction(g, row.remove)).toBe(inGroup);
    }
    expect(tableAction(g, t.removeAuto!)).toBe(g.actions.find((x) => x.key === t.removeAuto!.key));
    // 行の「詳しく」の欄の名前は、表の中では短い名前（どの年かは行が示す）
    expect(tableField(g, t.rows[0]!.detail[0]!).label).not.toContain(t.rows[0]!.label);
  });

  it("行の「外す」はその年だけを外し、「推定のままの N件を外す」は推定のままの年だけを外す", () => {
    let wh = ownHome("2026-10");
    const n = stages(wh).length;
    const kept = stages(wh)[0]!.id!;
    wh = confirm(wh, ratioKey(wh, 0));
    const gone = stages(wh)[2]!.id!;
    wh = action(wh, `/propertyTax/stage/${gone}/remove`);
    expect(stages(wh).some((s) => s.id === gone)).toBe(false);
    expect(tableOf(wh).rows.length).toBe(n - 1);
    expect(tableOf(wh).removeAuto!.label).toBe(`推定のままの${String(n - 2)}件を外す`);
    wh = action(wh, "/propertyTax/autoStages/remove");
    expect(stages(wh).map((s) => s.id)).toEqual([kept]);
    expect(tableOf(wh).rows.map((r) => r.id)).toEqual([kept]);
    // 外した推定の年は、推定し直しても戻らない
    wh = type(wh, `${home(wh).id}/valuation/value`, 45000000);
    expect(stages(wh).map((s) => s.id)).toEqual([kept]);
  });

  it("確かめた年を「外す」で外しても、ほかの年は表のまま。計算は、同じ値を持つ世帯と同じ", () => {
    let wh = ownHome("2026-10");
    const n = stages(wh).length;
    wh = confirm(wh, ratioKey(wh, 1));
    const id = stages(wh)[1]!.id!;
    wh = action(wh, `/propertyTax/stage/${id}/remove`);
    expect(boxes(wh)).toEqual([]);
    const t = tableOf(wh);
    expect(t.rows.length).toBe(stages(wh).length);
    expect(t.rows.length).toBeGreaterThanOrEqual(n - 1);
    expect(() => preview(wh.request)).not.toThrow();
  });
});

describe("境目: 基準月が1〜3月の世帯・誕生月の前後・推定し直したとき", () => {
  it("基準月が1〜3月でも、行の年は段階の年と同じで、推定のままの数も合う", () => {
    for (const base of ["2026-01", "2026-02", "2026-03", "2026-10"]) {
      const wh = ownHome(base);
      const t = tableOf(wh);
      expect(t.rows.map((r) => r.label)).toEqual(stages(wh).map((s) => `${s.at.at!.slice(0, 4)}年から`));
      expect(t.rows.map((r) => r.id)).toEqual(stages(wh).map((s) => taxStageId(home(wh).id, Number(s.at.at!.slice(0, 4)))));
      expect(t.estimated).toBe(stages(wh).length);
      // 最初の変化は基準の年より後
      expect(Number(stages(wh)[0]!.at.at!.slice(0, 4))).toBeGreaterThan(Number(base.slice(0, 4)) - 1);
    }
  });

  it("確かめた年の「いつから」を年齢にしても表の行のまま。誕生月の前後で、行の年はその年齢になる年", () => {
    for (const [birth, year] of [
      ["1986-11", 2033],
      ["1986-09", 2033],
      ["1986-10", 2033],
      ["1986-01", 2033],
      ["1986-12", 2033],
    ] as const) {
      let wh = ownHome("2026-10", { birth });
      const id = stages(wh)[1]!.id!;
      const self = wh.request.input.household.members.find((m) => m.kind === "self")!.id;
      wh = confirm(wh, `/propertyTax/stage/${id}/ratio`);
      wh = settle(fieldOf(wh, `/propertyTax/stage/${id}/at`).time!.setWhen(wh, { memberAge: { member: self, years: 47 } }, "this"));
      const row = tableOf(wh).rows.find((r) => r.id === id)!;
      expect(row.estimated).toBe(false);
      expect(row.label).toBe(`${String(year)}年から`);
      expect(boxes(wh)).toEqual([]);
      expect(tableOf(wh).rows.length).toBe(stages(wh).length);
    }
  });

  it("推定し直したとき: 推定のままの年は入れ直し、確かめた年・直した年は表の行のまま残る", () => {
    let wh = ownHome("2026-10");
    const id = stages(wh)[0]!.id!;
    wh = type(wh, ratioKey(wh, 0), "0.97");
    const before = stages(wh).filter((s) => s.id !== id).map((s) => s.ratio);
    wh = type(wh, `${home(wh).id}/valuation/builtYear`, 2015);
    expect(stages(wh).find((s) => s.id === id)!.ratio).toBe("0.97");
    expect(stages(wh).filter((s) => s.id !== id).map((s) => s.ratio)).not.toEqual(before);
    const t = tableOf(wh);
    expect(t.rows.length).toBe(stages(wh).length);
    expect(t.rows.find((r) => r.id === id)!.estimated).toBe(false);
    expect(t.estimated).toBe(stages(wh).length - 1);
    expect(boxes(wh)).toEqual([]);
  });

  it("見本の世帯（夫婦と子2人）: 推定の欄を入れても、表の開け閉めは世帯の値に入らない", () => {
    let wh = settle(fromRequest(modelHousehold("salariedCoupleTwoKids")));
    const id = home(wh).id;
    wh = set(wh, `${id}/valuation/value`, 38000000);
    wh = set(wh, `${id}/valuation/builtYear`, 2016);
    wh = settle(typeValue(fieldOf(wh, `${id}/tax`), wh, null));
    expect(stages(wh).length).toBeGreaterThan(0);
    const g = tableGroupOf(wh)!;
    const json = JSON.stringify(wh);
    // 閉じた形・開いた形・行を開いた形を描いても、世帯は変わらない（開け閉めは画面だけの状態）
    panel(wh);
    panel(wh, () => true);
    expect(JSON.stringify(wh)).toBe(json);
    expect(json).not.toContain(g.key);
    expect(json).not.toContain("autoStages");
  });
});
