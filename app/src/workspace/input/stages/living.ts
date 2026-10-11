// 4. 基本生活費: 月額の総額＋変動率＋節目（末子独立後・退職後・高齢期）。内訳（費目別）は詳細で。
// 住居費・教育費・保険料・車両費は含めない（それぞれの段階で入れる）
import type { Household, LivingExpense, Timepoint } from "../../../engine/types.ts";
import { addMonths, ageReachedMonth, readLevers } from "../../levers.ts";
import { livingEstimate } from "../estimates.ts";
import { byId, getPath, plain, removeAction, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type StageDef } from "../form.ts";
import { estimatedBox, mutate, newId, type WorkingHousehold } from "../household.ts";
import { GROWTH_KINDS, LIVING_CATEGORIES, LIVING_STAGE_LABELS } from "../labels.ts";

const livings = (h: Household) => h.livingExpenses;
const NOTE = "住居費・教育費・保険料・車両費は含めません（それぞれの段階で入れます）";

/** 節目の時点の目安: 末子独立＝一番下の子の独立、退職後＝本人の働く最後の年齢の翌月、70歳・80歳＝本人がその年齢になる月 */
export function stageDefaultAt(wh: WorkingHousehold, label: string): Timepoint {
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self");
  if (label === "childIndependence") {
    const leaves = h.members.filter((m) => m.kind === "child").map((m) => m.leaves?.at).filter((x): x is string => x !== undefined).sort().at(-1);
    if (leaves !== undefined) return { at: leaves };
  }
  if (label === "retirement" && self !== undefined) {
    const age = readLevers(wh.request, self.id).retireAge ?? 65;
    return { at: ageReachedMonth(self, age) };
  }
  if ((label === "age70" || label === "age80") && self !== undefined) return { memberAge: { member: self.id, years: label === "age70" ? 70 : 80, months: 0 } };
  return { at: addMonths(wh.request.input.baseMonth, 120) };
}

/** 伸び方の種類を変えたあと: 決まった率のときだけ率を持つ（0008 の追記の growth） */
export function fixGrowth(t: Record<string, unknown>, v: unknown): void {
  const g = t.growth as { kind?: string; rate?: string } | undefined;
  if (g === undefined) return;
  if (v === "rate") g.rate ??= "0.01";
  else delete g.rate;
  if (g.kind === undefined) delete t.growth;
}

const DEFAULT_RATIO: Record<string, string> = { childIndependence: "0.85", retirement: "0.8", age70: "0.75", age80: "0.7", other: "0.9" };

function stageGroups(wh: WorkingHousehold, l: LivingExpense, find: Finder): GroupDef[] {
  const self = wh.request.input.household.members.find((m) => m.kind === "self");
  return (l.stages ?? []).map((s, i) => {
    const findStage: Finder = (h, w) => ((getPath(find(h, w), ["stages", String(i)]) as Record<string, unknown> | undefined) ?? undefined);
    const key = `living/${l.id}/stage/${i}`;
    const fields: FieldDef[] = [
      plain({ key: `${key}/label`, item: "livingExpense.stages", label: "節目", level: "detail", kind: "select", options: LIVING_STAGE_LABELS, find: findStage, path: ["label"] }),
      timepointField({ key: `${key}/at`, item: "livingExpense.stages", label: "いつから", level: "detail", find: findStage, path: ["at"], ...(self !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === self.id) } : {}) }),
    ];
    if (s.monthly !== undefined) fields.push(yenBox({ key: `${key}/monthly`, item: "livingExpense.stages", label: "その後の月額", level: "simple", basis: "monthly", find: findStage, path: ["monthly"] }));
    else fields.push(plain({ key: `${key}/ratio`, item: "livingExpense.stages", label: `${LIVING_STAGE_LABELS.find((o) => o.value === s.label)?.label ?? "節目"}の割合（最初の額に対して）`, level: "simple", kind: "pct", find: findStage, path: ["ratio"] }));
    return {
      key,
      title: LIVING_STAGE_LABELS.find((o) => o.value === s.label)?.label ?? "節目",
      level: "simple",
      fields,
      actions: [
        removeAction(`${key}/remove`, "この節目を外す", "simple", (h, w) => {
          const t = find(h, w) as LivingExpense | undefined;
          if (t === undefined) return;
          t.stages = (t.stages ?? []).filter((_, j) => j !== i);
          if (t.stages.length === 0) delete t.stages;
        }),
      ],
    };
  });
}

function addStageActions(wh: WorkingHousehold, l: LivingExpense, find: Finder): ActionDef[] {
  const have = new Set((l.stages ?? []).map((s) => s.label));
  return LIVING_STAGE_LABELS.filter((o) => o.value !== "other" && !have.has(o.value)).map((o) => ({
    key: `living/${l.id}/addStage/${o.value}`,
    label: `＋ ${o.label}`,
    level: "simple",
    run: (w) =>
      mutate(w, (h, req) => {
        const t = find(h, w) as LivingExpense | undefined;
        if (t === undefined) return;
        (t.stages ??= []).push({ at: stageDefaultAt({ ...w, request: req }, o.value), label: o.value, ratio: DEFAULT_RATIO[o.value] ?? "0.9" });
      }),
  }));
}

function livingGroups(wh: WorkingHousehold, l: LivingExpense, index: number): GroupDef[] {
  const find = byId(livings, l.id);
  const key = `living/${l.id}`;
  const main: FieldDef[] = [
    plain({
      key: `${key}/mode`,
      item: "livingExpense.mode",
      label: "入れ方",
      level: "detail",
      kind: "select",
      options: [
        { value: "total", label: "総額で入れる" },
        { value: "byCategory", label: "内訳（費目別）で入れる" },
      ],
      structural: true,
      find,
      path: ["mode"],
      after: (h, t, v) => {
        const le = t as LivingExpense;
        if (v === "byCategory" && le.categories === undefined) {
          const total = le.monthly?.value ?? livingEstimate(h, wh.request.input.baseMonth).value;
          le.categories = [
            { category: "food", monthly: { value: Math.round(total * 0.3), state: "confirmed", origin: { kind: "manual" } } },
            { category: "utilities", monthly: { value: Math.round(total * 0.08), state: "confirmed", origin: { kind: "manual" } } },
            { category: "transport", monthly: { value: Math.round(total * 0.15), state: "confirmed", origin: { kind: "manual" } } },
            { category: "otherConsumption", monthly: { value: total - Math.round(total * 0.3) - Math.round(total * 0.08) - Math.round(total * 0.15), state: "confirmed", origin: { kind: "manual" } } },
          ];
          delete le.monthly;
        } else if (v === "total" && le.monthly === undefined) {
          const sum = (le.categories ?? []).reduce((s, c) => s + (c.monthly.value ?? 0), 0);
          le.monthly = { value: sum, state: "confirmed", origin: { kind: "manual" } };
          delete le.categories;
        }
      },
    }),
  ];
  if (l.mode === "total")
    main.push(
      yenBox({
        key: `${key}/monthly`,
        item: "livingExpense.monthly",
        label: "基本生活費",
        level: "simple",
        basis: "monthly",
        find,
        path: ["monthly"],
        estimate: (h) => livingEstimate(h, wh.request.input.baseMonth),
        help: "空欄なら統計の目安（世帯の人数ごと）で計算します。主画面の対策「毎月の生活費」でも動かせます",
      }),
    );
  main.push(
    plain({ key: `${key}/growth`, item: "livingExpense.growth", label: "変動率", level: "simple", kind: "select", options: GROWTH_KINDS, find, path: ["growth", "kind"], fallback: "inflation", optional: true, help: "物価上昇率は「前提条件」で決めます", after: (_h, t, v) => fixGrowth(t, v) }),
  );
  if (l.growth?.kind === "rate") main.push(plain({ key: `${key}/growthRate`, item: "livingExpense.growth", label: "決まった変動率（年）", level: "simple", kind: "pct", find, path: ["growth", "rate"] }));
  main.push(
    timepointField({ key: `${key}/from`, item: "livingExpense.from", label: "始まり", level: "detail", find, path: ["from"], optional: true, absentWhenEmpty: true, nullText: "計算の初めから" }),
    timepointField({ key: `${key}/to`, item: "livingExpense.to", label: "終わり", level: "detail", find, path: ["to"], optional: true, absentWhenEmpty: true, nullText: "最後まで" }),
  );
  const groups: GroupDef[] = [
    {
      key,
      title: index === 0 ? "基本生活費" : `基本生活費 ${index + 1}`,
      note: NOTE,
      level: "simple",
      fields: main,
      actions: index === 0 ? [] : [removeAction(`${key}/remove`, "外す", "detail", (h) => void (h.livingExpenses = (h.livingExpenses ?? []).filter((x) => x.id !== l.id)))],
    },
  ];
  if (l.mode === "byCategory") {
    groups.push({
      key: `${key}/categories`,
      title: "内訳（月額）",
      level: "simple",
      fields: (l.categories ?? []).map((c, i) =>
        yenBox({
          key: `${key}/cat/${i}`,
          item: "livingExpense.categories",
          label: LIVING_CATEGORIES.find((o) => o.value === c.category)?.label ?? c.category,
          level: "simple",
          basis: "monthly",
          find: (h, w) => (getPath(find(h, w), ["categories", String(i)]) as Record<string, unknown> | undefined) ?? undefined,
          path: ["monthly"],
        }),
      ),
      actions: LIVING_CATEGORIES.filter((o) => !(l.categories ?? []).some((c) => c.category === o.value)).map((o) => ({
        key: `${key}/addCat/${o.value}`,
        label: `＋ ${o.label}`,
        level: "detail",
        run: (w) => mutate(w, (h) => void ((find(h, w) as LivingExpense).categories ??= []).push({ category: o.value, monthly: { value: 0, state: "confirmed", origin: { kind: "manual" } } })),
      })),
    });
  }
  groups.push(...stageGroups(wh, l, find));
  groups.push({ key: `${key}/stages/add`, title: "節目を足す", level: "simple", fields: [], actions: addStageActions(wh, l, find) });
  return groups;
}

export function livingStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const list = h.livingExpenses ?? [];
  const est = livingEstimate(h, wh.request.input.baseMonth);
  if (list.length === 0)
    return {
      id: "living",
      label: "基本生活費",
      lead: "毎月の生活費（住居費・教育費・保険料・車両費を除く）。",
      sections: [
        {
          key: "living/none",
          title: "基本生活費",
          note: `まだ入っていません（今は0円で計算しています）。${NOTE}`,
          level: "simple",
          groups: [],
          actions: [
            {
              key: "living/add",
              label: `目安（月${(est.value / 10000).toLocaleString("ja-JP")}万円）で入れる`,
              level: "simple",
              run: (w) => mutate(w, (hh) => void (hh.livingExpenses ??= []).push({ id: newId(), mode: "total", monthly: estimatedBox(est.value, est.basis) })),
            },
          ],
        },
      ],
    };
  return {
    id: "living",
    label: "基本生活費",
    lead: "毎月の生活費（住居費・教育費・保険料・車両費を除く）と、節目ごとの変化。",
    sections: [
      {
        key: "living/main",
        title: "基本生活費",
        level: "simple",
        groups: list.flatMap((l, i) => livingGroups(wh, l, i)),
        actions: [],
      },
    ],
  };
}

