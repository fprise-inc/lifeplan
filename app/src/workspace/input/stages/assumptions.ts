// 10. 前提条件: 物価上昇率・賃金上昇率・運用利回り・教育費の上昇率・年金のマクロ経済スライド（年ごとの列の既定の値。0008 の8）、
// 資産の種類ごとの利回り、持ち家の評価の前提（土地の上昇率・土地の割合・耐用年数・建物の下限・売却の費用）、表の最後の年、
// FP顧問料（単発・継続。stages/fees.ts。以前は別のカード）。
// 黒字のうち貯まる割合（0031）は、顧客と一緒に見る基本生活費のカードへ移した（stages/surplusSaving.ts。0031 の追記）
import type { Household, YearSeries } from "../../../engine/types.ts";
import { field, getPath, plain, type FieldDef, type GroupDef, type StageDef } from "../form.ts";
import { mutate, standardEndYear, type WorkingHousehold } from "../household.ts";
import { ASSET_CLASSES, BUILDING_STRUCTURES, USEFUL_LIFE, VALUATION_DEFAULTS } from "../labels.ts";
import { sameRate } from "../units.ts";
import { feeSections } from "./fees.ts";

/** 年ごとの列の既定の値（default）の欄。年ごとの値（byYear）があるときは、その旨を出す */
function seriesField(name: string, label: string, help: string, level: "simple" | "detail", optional: boolean): FieldDef {
  return field({
    key: `assume/${name}`,
    item: `assumptions.${name}`,
    label,
    level,
    kind: "pct",
    optional,
    help,
    get: (wh) => {
      const s = getPath(wh.request.input.assumptions, [name]) as YearSeries | undefined;
      return { value: s?.default ?? null, hint: s === undefined ? "入れない（計算エンジンの既定）" : null, derived: s?.byYear !== undefined ? `年ごとの値が ${Object.keys(s.byYear).length} 年分あります（詳しい入力は次の版）` : null };
    },
    set: (wh, v) => {
      const request = structuredClone(wh.request);
      const a = (request.input.assumptions ??= { investmentReturn: { default: "0.01" } }) as Record<string, unknown>;
      const cur = a[name] as YearSeries | undefined;
      if (v === null) delete a[name];
      else if (!(cur !== undefined && sameRate(cur.default, String(v)))) a[name] = { ...cur, default: String(v) };
      return { ...wh, request };
    },
  });
}

function assetReturnGroups(wh: WorkingHousehold): GroupDef[] {
  const ar = wh.request.input.assumptions?.assetReturns ?? {};
  return Object.keys(ar).map((cls) => ({
    key: `assume/assetReturns/${cls}`,
    title: ASSET_CLASSES.find((o) => o.value === cls)?.label ?? cls,
    level: "detail" as const,
    fields: [
      plain({
        key: `assume/assetReturns/${cls}/default`,
        item: "assumptions.assetReturns",
        label: "利回り（年）",
        level: "detail",
        kind: "pct",
        find: (_h, w) => (getPath(w.request.input.assumptions, ["assetReturns", cls]) as Record<string, unknown> | undefined) ?? undefined,
        path: ["default"],
      }),
    ],
    actions: [
      {
        key: `assume/assetReturns/${cls}/remove`,
        label: "外す",
        level: "detail" as const,
        danger: true,
        run: (w: WorkingHousehold) => {
          const request = structuredClone(w.request);
          const a = request.input.assumptions;
          if (a?.assetReturns !== undefined) {
            delete a.assetReturns[cls];
            if (Object.keys(a.assetReturns).length === 0) delete a.assetReturns;
          }
          return { ...w, request };
        },
      },
    ],
  }));
}

/** 持ち家の評価の前提（assumptions.realEstateValuation。空欄は計算エンジンの目安） */
function valuationGroup(): GroupDef {
  const find = (_h: Household, w: WorkingHousehold) => w.request.input.assumptions as Record<string, unknown> | undefined;
  const item = "assumptions.realEstateValuation";
  const R = "realEstateValuation";
  return {
    key: "assume/realEstate/fields",
    level: "detail",
    fields: [
      plain({ key: "assume/realEstate/landGrowth", item, label: "土地の上昇率（年）", level: "detail", kind: "pct", find, path: [R, "landGrowth", "default"], optional: true, help: "空欄なら物価上昇率と同じ" }),
      plain({ key: "assume/realEstate/landShare", item, label: "土地の割合（物件に入れていないとき）", level: "detail", kind: "pct", find, path: [R, "landShare"], optional: true, fallback: VALUATION_DEFAULTS.landShare, help: "目安は3割（土地付きの注文住宅の土地の取得費の全国の割合）。地域で大きく違うので物件ごとに直します" }),
      ...BUILDING_STRUCTURES.map((o) =>
        plain({ key: `assume/realEstate/life/${o.value}`, item, label: `耐用年数: ${o.label}`, level: "detail", kind: "int", suffix: "年", min: 1, max: 100, find, path: [R, "usefulLife", o.value], optional: true, fallback: USEFUL_LIFE[o.value] ?? 22, help: "建物はこの年数で定額で減らします（目安は住宅用の建物の法定耐用年数）" }),
      ),
      plain({ key: "assume/realEstate/floor", item, label: "建物の残りの価値の下限", level: "detail", kind: "pct", find, path: [R, "residualFloor"], optional: true, fallback: VALUATION_DEFAULTS.residualFloor, help: "建てた時の価値に対する割合。目安は2割（固定資産の評価で古い家屋の価値を下げる下限と同じ）" }),
      plain({ key: "assume/realEstate/saleCost", item, label: "売却の費用（売却価格に対する割合）", level: "detail", kind: "pct", find, path: [R, "saleCostRate"], optional: true, fallback: VALUATION_DEFAULTS.saleCostRate, help: "仲介手数料（上限は価格の3%＋6万円と消費税）・印紙税・登記などの目安" }),
    ],
    actions: [],
  };
}

export function assumptionsStage(wh: WorkingHousehold): StageDef {
  const have = new Set(Object.keys(wh.request.input.assumptions?.assetReturns ?? {}));
  const endYear = field({
    key: "assume/endYear",
    item: null,
    label: "表の最後の年",
    level: "detail",
    kind: "int",
    suffix: "年",
    min: 2000,
    max: 2200,
    optional: true,
    help: "標準は、本人・配偶者のうち若い方が100歳になる年。標準のままなら、家族の生年月を直すと合わせて変わります。空にすると標準に戻します",
    get: (w) => {
      const std = standardEndYear(w.request.input.household);
      const v = w.request.input.endYear;
      return { value: v, hint: Number.isFinite(std) ? (v === std ? "標準の年" : `標準は ${std}年`) : null };
    },
    set: (w, v) =>
      mutate(w, (h: Household, req) => {
        const std = standardEndYear(h);
        if (v !== null) req.input.endYear = Number(v);
        else if (Number.isFinite(std)) req.input.endYear = std;
      }),
  });
  const baseMonth = field({
    key: "assume/baseMonth",
    item: null,
    label: "計算の基準の月",
    level: "detail",
    kind: "ym",
    help: "この月から計算します。保存と見直しの版ができるまでは、世帯を開いたときの値のままにします",
    readOnly: "見直しの版（現状の版を積む）ができてから変えられます",
    get: (w) => ({ value: w.request.input.baseMonth }),
    set: (w) => w,
  });
  return {
    id: "assumptions",
    label: "前提条件",
    lead: "物価・賃金・運用利回りなどの前提と、FP顧問料。顧客ごとに変えられます。",
    sections: [
      {
        key: "assume/main",
        title: "経済の前提",
        note: "事務所の標準値（設定）はまだありません。今は世帯ごとの値を使います",
        level: "simple",
        groups: [
          {
            key: "assume/main/fields",
            level: "simple",
            fields: [
              seriesField("inflation", "物価上昇率（年）", "基本生活費などの変動率に使います", "simple", true),
              seriesField("wageGrowth", "賃金上昇率（年）", "給与の伸び（年齢ごとの昇給カーブとは別）", "simple", true),
              seriesField("investmentReturn", "運用利回り（年）", "資産の配分を入れていない口座の利回り", "simple", false),
              seriesField("educationInflation", "教育費の上昇率（年）", "空欄なら物価上昇率と同じ", "detail", true),
              seriesField("pensionMacroSlide", "年金のマクロ経済スライドの調整率（年）", "将来の年金額の伸びから差し引く率", "detail", true),
              endYear,
              baseMonth,
            ],
            actions: [],
          },
        ],
        actions: [],
      },
      {
        key: "assume/realEstate",
        title: "持ち家の評価（資産と負債の推移）",
        note: "土地は上昇率で動き、建物は構造の耐用年数で定額で減らします。空欄は目安を使います",
        level: "detail",
        groups: [valuationGroup()],
        actions: [],
      },
      {
        key: "assume/assetReturns",
        title: "資産の種類ごとの利回り",
        level: "detail",
        groups: assetReturnGroups(wh),
        actions: ASSET_CLASSES.filter((o) => !have.has(o.value))
          .slice(0, 6)
          .map((o) => ({
            key: `assume/addReturn/${o.value}`,
            label: `＋ ${o.label}`,
            level: "detail" as const,
            run: (w: WorkingHousehold) => {
              const request = structuredClone(w.request);
              const a = (request.input.assumptions ??= { investmentReturn: { default: "0.01" } });
              (a.assetReturns ??= {})[o.value] = { default: o.value.startsWith("cash") ? "0.001" : "0.03" };
              return { ...w, request };
            },
          })),
      },
      ...feeSections(wh),
    ],
  };
}
