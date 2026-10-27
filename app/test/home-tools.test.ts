// 入力のホームの仕上げ（0072）: 確かめの一覧の今の値・出どころ・確かさと絞り込み・カードごとのまとめての確定・次回確かめるの印・
// プランで足した物の行・小さな結果・取り込みの入口
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { checkList, confirmAllEstimates, DEFAULT_KINDS, valueMeta } from "../src/workspace/input/checkRows.ts";
import { passesFilter, planOnlyRows } from "../src/workspace/input/CheckList.tsx";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputView } from "../src/workspace/input/InputView.tsx";
import { readRecheck, recheckText, setRecheck } from "../src/workspace/input/recheck.ts";
import { addCar } from "../src/workspace/input/stages/cars.ts";
import { buildStages } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import type { Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const open = (id: string) => fromRequest(modelHousehold(id));
const NO_FILTER = { card: "", kind: "", origin: "", certainty: "" } as const;

/** 確定の値の箱を持つ最初の欄 */
function confirmedBoxField(wh: WorkingHousehold): FieldDef {
  for (const st of buildStages(wh))
    for (const f of allFields(st)) {
      if (f.boxed === undefined || f.readOnly !== undefined || f.kind !== "yen") continue;
      const b = f.boxed.read(wh) as { state?: string } | undefined;
      if (b?.state === "confirmed" && fieldStatus(f, wh).status === "confirmed") return f;
    }
  throw new Error("no confirmed box");
}

describe("確かめの一覧の1行（今の値・出どころ・確かさ）と絞り込み", () => {
  it("推定の行に今の値を言葉で出す。未入力の行は値を出さない", () => {
    const rows = checkList(open("salariedCoupleTwoKids"));
    const est = rows.filter((r) => r.kind === "estimated");
    expect(est.length).toBeGreaterThan(0);
    expect(est.some((r) => typeof r.value === "string" && r.value.length > 0)).toBe(true);
    for (const r of rows.filter((x) => x.kind === "missing")) expect(r.value ?? null).toBeNull();
  });

  it("ヒアリングで入った確定の値は確かさ「本人の申告」。確かさの行は、確かさか種類で絞り込んだときだけ出す", () => {
    const wh0 = open("salariedCoupleTwoKids");
    const f = confirmedBoxField(wh0);
    const b = f.boxed!.read(wh0) as Record<string, unknown>;
    const wh = f.boxed!.write(wh0, { ...b, origin: { kind: "hearing" }, approval: { by: "fp", at: "2026-10-27T10:00:00+09:00" } } as never);
    expect(valueMeta(f, wh)).toEqual({ origin: "hearing", certainty: "declared" });
    const row = checkList(wh).find((r) => r.id === `field:${f.key}`)!;
    expect(row).toMatchObject({ kind: "certainty", origin: "hearing", certainty: "declared" });
    expect(DEFAULT_KINDS).not.toContain("certainty");
    expect(passesFilter(row, NO_FILTER, () => false)).toBe(false);
    expect(passesFilter(row, { ...NO_FILTER, certainty: "declared" }, () => false)).toBe(true);
    expect(passesFilter(row, { ...NO_FILTER, kind: "certainty" }, () => false)).toBe(true);
    expect(passesFilter(row, { ...NO_FILTER, origin: "import" }, () => false)).toBe(false);
    // 概算の印（ヒアリングシートの範囲の答えなど）は印のほうが勝つ
    const rough = f.boxed!.write(wh0, { ...b, certainty: "rough", origin: { kind: "hearing" }, approval: { by: "fp", at: "2026-10-27T10:00:00+09:00" } } as never);
    expect(valueMeta(f, rough).certainty).toBe("rough");
    // 手で入れた値は確かさを決めない（行に出ない）
    expect(valueMeta(f, wh0)).toEqual({ origin: "manual", certainty: null });
    expect(checkList(wh0).some((r) => r.id === `field:${f.key}`)).toBe(false);
  });

  it("「このカードの推定をまとめて確定」はそのカードの推定だけを確定にする", () => {
    const wh = open("salariedCoupleTwoKids");
    const before = checkList(wh).filter((r) => r.kind === "estimated");
    const card = before.find((r) => r.actions.some((a) => a.key === "confirm"))!.card;
    const r = confirmAllEstimates(wh, card);
    expect(r.count).toBeGreaterThan(0);
    const after = checkList(r.wh).filter((x) => x.kind === "estimated");
    expect(after.filter((x) => x.card === card && x.actions.some((a) => a.key === "confirm"))).toEqual([]);
    expect(after.filter((x) => x.card !== card).map((x) => x.id)).toEqual(before.filter((x) => x.card !== card).map((x) => x.id));
  });
});

describe("次回確かめるの印", () => {
  it("付け外しと書き出しの文。値は写さず、書き出すときの今の値を添える。氏名は入らない", () => {
    const wh = open("salariedCoupleTwoKids");
    const rows = checkList(wh);
    const r = rows.find((x) => x.kind === "estimated" && x.value != null)!;
    const on = setRecheck(wh, r, "2026-10-27");
    expect(on.recheck).toEqual([{ id: r.id, card: r.card, cardLabel: r.cardLabel, label: r.label, on: "2026-10-27" }]);
    expect(setRecheck(on, r, "2026-10-28").recheck).toHaveLength(1);
    expect("recheck" in setRecheck(on, r, null)).toBe(false);
    const text = recheckText(on.recheck!, rows);
    expect(text).toContain(`${r.cardLabel} › ${r.label}`);
    expect(text).toContain(`今: ${r.value}`);
    const gone = recheckText([{ id: "field:none", card: "living", cardLabel: "基本生活費", label: "毎月の生活費", on: "2026-10-27" }], rows);
    expect(gone).toContain("今は確かめの一覧にありません");
    expect(passesFilter(r, { ...NO_FILTER, kind: "recheck" }, (id) => id === r.id)).toBe(true);
    expect(readRecheck([{ ...on.recheck![0] }, { ...on.recheck![0] }, { id: "x" }, null])).toHaveLength(1);
  });
});

describe("プランの編集中: そのプランで足した物の行", () => {
  it("プランで足した車の推定はプランの行に出て、現状の物の行は出ない", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const self = roles(req).find((x) => x.key === "self")!.member;
    const plan: Proposal = { id: "B", name: "プランB", createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base: null, tags: [], diffs: [] };
    const wh0 = { ...fromRequest(req, {}), proposals: [plan] };
    const cat = buildCatalog(wh0, self.id, null);
    const view0 = planView(wh0, cat, "B");
    const wh = recordPlanEdit(wh0, cat, "B", view0, addCar(view0));
    const view = planView(wh, cat, "B");
    const rows = planOnlyRows(wh, view);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.card === "car")).toBe(true);
    expect(planOnlyRows(wh0, view0)).toEqual([]);
  });
});

describe("取り込みの入口", () => {
  it("描画: 取り込む（現状のとき）。小さな結果と全部のカードの入れ方の一括の切り替えは出さない（0077）", () => {
    const wh = open("salariedCoupleTwoKids");
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", imports: h("span", { "data-x": true }, "x") }));
    expect(html).not.toContain("data-mini-result");
    expect(html).not.toContain("金融資産の見込み");
    expect(html).not.toContain("data-home-level");
    expect(html).toContain("data-imports-open");
  });
});
