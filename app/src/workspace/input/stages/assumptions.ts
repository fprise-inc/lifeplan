// 10. 前提条件: 物価上昇率・賃金上昇率・運用利回り・教育費の上昇率・年金のマクロ経済スライド（年ごとの列の既定の値。0008 の8）、
// 黒字のうち貯まる割合（ゆとりの支出）と生活防衛資金（0031）、資産の種類ごとの利回り、持ち家の評価の前提（土地の上昇率・土地の割合・耐用年数・建物の下限・売却の費用）、表の最後の年、
// FP顧問料（単発・継続。stages/fees.ts。以前は別のカード）
import type { Household, Timepoint, YearSeries } from "../../../engine/types.ts";
import { field, getPath, plain, resolveTimepoint, type FieldDef, type GroupDef, type StageDef } from "../form.ts";
import { mutate, standardEndYear, type WorkingHousehold } from "../household.ts";
import { ASSET_CLASSES, BUILDING_STRUCTURES, USEFUL_LIFE, VALUATION_DEFAULTS } from "../labels.ts";
import { sameRate } from "../units.ts";
import { feeSections } from "./fees.ts";
import { reserveOf, setReserve, setSurplus, surplusOf, yearOfTimepoint } from "../../surplus.ts";
import { ageAt } from "../../levers.ts";

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

// ---- 黒字のうち貯まる割合と生活防衛資金（0031）----

const SURPLUS_ITEM = "assumptions.surplusSaving";
const RESERVE_ITEM = "assumptions.emergencyReserve";
const withReq = (wh: WorkingHousehold, request: WorkingHousehold["request"]): WorkingHousehold => ({ ...wh, request });

/** 黒字のうち貯まる割合・上限（空欄は今まで通り＝全部貯まる）と、期間で変える組 */
function surplusGroups(wh: WorkingHousehold): GroupDef[] {
  const req = wh.request;
  const self = req.input.household.members.find((m) => m.kind === "self");
  const main: GroupDef = {
    key: "assume/surplus/fields",
    level: "simple",
    fields: [
      field({
        key: "assume/surplus/ratio",
        item: SURPLUS_ITEM,
        label: "黒字のうち貯まる割合",
        level: "simple",
        kind: "pct",
        optional: true,
        help: "空欄は100%（今まで通り、黒字が全部貯まる）。例えば60%なら、黒字の4割は実際には使ってしまう「ゆとりの支出」として支出に入れます。赤字の年と、退職金などの一時金は対象にしません",
        get: (w) => ({ value: surplusOf(w.request)?.ratio ?? null, hint: surplusOf(w.request)?.ratio === undefined ? "空欄＝100%" : null }),
        set: (w, v) => {
          const cur = surplusOf(w.request) ?? {};
          const { ratio: _r, ...rest } = cur;
          void _r;
          return withReq(w, setSurplus(w.request, v === null ? rest : { ...rest, ratio: String(v) }));
        },
      }),
      field({
        key: "assume/surplus/cap",
        item: SURPLUS_ITEM,
        label: "黒字のうち貯まる額の上限（年）",
        level: "simple",
        kind: "yen",
        basis: "annual",
        optional: true,
        help: "割合の代わりに「年○万円までしか貯まらない」と決めるとき。割合と両方なら少ないほう",
        get: (w) => ({ value: surplusOf(w.request)?.cap ?? null }),
        set: (w, v) => {
          const cur = surplusOf(w.request) ?? {};
          const { cap: _c, ...rest } = cur;
          void _c;
          return withReq(w, setSurplus(w.request, v === null ? rest : { ...rest, cap: Number(v) }));
        },
      }),
    ],
    actions: [],
  };
  const changes = surplusOf(req)?.changes ?? [];
  const groups = changes.map((c, i): GroupDef => {
    const edit = (w: WorkingHousehold, f: (x: (typeof changes)[number]) => (typeof changes)[number] | null) => {
      const cur = surplusOf(w.request) ?? {};
      const list = [...(cur.changes ?? [])];
      const old = list[i];
      if (old === undefined) return w;
      const next = f(old);
      if (next === null) list.splice(i, 1);
      else list[i] = next;
      return withReq(w, setSurplus(w.request, { ...cur, changes: list }));
    };
    const fromAge = (w: WorkingHousehold) => {
      const x = (surplusOf(w.request)?.changes ?? [])[i];
      if (x === undefined || self === undefined) return null;
      if (x.from.memberAge !== undefined && x.from.memberAge.member === self.id) return x.from.memberAge.years;
      const ym = resolveTimepoint(w.request.input.household, x.from);
      return ym === null ? null : ageAt(self, ym);
    };
    return {
      key: `assume/surplus/change/${i}`,
      title: `期間を変える ${i + 1}`,
      level: "simple",
      fields: [
        field({
          key: `assume/surplus/change/${i}/age`,
          item: SURPLUS_ITEM,
          label: "本人の年齢（この年から）",
          level: "simple",
          kind: "int",
          suffix: "歳から",
          min: 0,
          max: 110,
          get: (w) => {
            const x = (surplusOf(w.request)?.changes ?? [])[i];
            const derived = x !== undefined && x.from.memberAge === undefined ? "年月・できごとで決めた時点を年齢で見せています（書き換えると年齢の形になります）" : null;
            return { value: fromAge(w), derived };
          },
          set: (w, v) => (v === null || self === undefined ? w : edit(w, (x) => ({ ...x, from: { memberAge: { member: self.id, years: Number(v), months: 0 } } }))),
        }),
        field({
          key: `assume/surplus/change/${i}/ratio`,
          item: SURPLUS_ITEM,
          label: "黒字のうち貯まる割合",
          level: "simple",
          kind: "pct",
          optional: true,
          get: (w) => ({ value: (surplusOf(w.request)?.changes ?? [])[i]?.ratio ?? null, hint: (surplusOf(w.request)?.changes ?? [])[i]?.ratio === undefined ? "空欄＝100%" : null }),
          set: (w, v) =>
            edit(w, (x) => {
              const { ratio: _r, ...rest } = x;
              void _r;
              return v === null ? rest : { ...rest, ratio: String(v) };
            }),
        }),
        field({
          key: `assume/surplus/change/${i}/cap`,
          item: SURPLUS_ITEM,
          label: "貯まる額の上限（年）",
          level: "detail",
          kind: "yen",
          basis: "annual",
          optional: true,
          get: (w) => ({ value: (surplusOf(w.request)?.changes ?? [])[i]?.cap ?? null }),
          set: (w, v) =>
            edit(w, (x) => {
              const { cap: _c, ...rest } = x;
              void _c;
              return v === null ? rest : { ...rest, cap: Number(v) };
            }),
        }),
      ],
      actions: [{ key: `assume/surplus/change/${i}/remove`, label: "外す", level: "simple", danger: true, run: (w) => edit(w, () => null) }],
    };
  });
  return [main, ...groups];
}

/** 期間を足すときの始まり: 基本生活費の「子の独立」の時点があればそこ、無ければ本人の今の年齢＋10歳 */
function nextChangeFrom(wh: WorkingHousehold): { from: Timepoint; ratio: string } | null {
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self");
  if (self === undefined) return null;
  const used = new Set((surplusOf(wh.request)?.changes ?? []).map((c) => yearOfTimepoint(wh.request, c.from)));
  const indep = (h.livingExpenses ?? []).flatMap((l) => l.stages ?? []).find((s) => s.label === "childIndependence");
  if (indep !== undefined && !used.has(yearOfTimepoint(wh.request, indep.at))) return { from: structuredClone(indep.at), ratio: "0.8" };
  const age = ageAt(self, wh.request.input.baseMonth) + 10 + used.size * 5;
  return { from: { memberAge: { member: self.id, years: age, months: 0 } }, ratio: "0.8" };
}

/** 生活防衛資金（決め方: 入れない・基本生活費の○か月分・金額）と、「○歳まで持つ」の判定に含めるか */
function reserveGroup(wh: WorkingHousehold): GroupDef {
  const r = reserveOf(wh.request);
  const mode = r === undefined ? "none" : r.amount !== undefined ? "amount" : "months";
  const fields: FieldDef[] = [
    field({
      key: "assume/reserve/mode",
      item: RESERVE_ITEM,
      label: "生活防衛資金（取り崩さないお金）",
      level: "simple",
      kind: "select",
      structural: true,
      options: [
        { value: "none", label: "入れない" },
        { value: "months", label: "基本生活費の○か月分" },
        { value: "amount", label: "金額で入れる" },
      ],
      help: "運用せずに（預金の利回りで）持ち、ほかのお金を使い切るまで取り崩さないお金。金融資産の残高には含めますが、「金融資産は○歳まで持つ」は、既定ではこのお金を除いて判定します",
      get: (w) => {
        const x = reserveOf(w.request);
        return { value: x === undefined ? "none" : x.amount !== undefined ? "amount" : "months" };
      },
      set: (w, v) => {
        const x = reserveOf(w.request);
        const count = x?.countInLasting === true ? { countInLasting: true } : {};
        if (v === "none") return withReq(w, setReserve(w.request, undefined));
        if (v === "amount") return withReq(w, setReserve(w.request, { amount: x?.amount ?? 3_000_000, ...count }));
        return withReq(w, setReserve(w.request, { months: x?.months ?? 6, ...count }));
      },
    }),
  ];
  if (mode === "months")
    fields.push(
      field({
        key: "assume/reserve/months",
        item: RESERVE_ITEM,
        label: "基本生活費の",
        level: "simple",
        kind: "int",
        suffix: "か月分",
        min: 1,
        max: 120,
        help: "その年の基本生活費（月）×月数。生活費が変われば目安も動きます",
        get: (w) => ({ value: reserveOf(w.request)?.months ?? null }),
        set: (w, v) => (v === null ? w : withReq(w, setReserve(w.request, { ...reserveOf(w.request), months: Number(v) }))),
      }),
    );
  if (mode === "amount")
    fields.push(
      field({
        key: "assume/reserve/amount",
        item: RESERVE_ITEM,
        label: "生活防衛資金の金額",
        level: "simple",
        kind: "yen",
        basis: "once",
        get: (w) => ({ value: reserveOf(w.request)?.amount ?? null }),
        set: (w, v) => (v === null ? w : withReq(w, setReserve(w.request, { ...reserveOf(w.request), amount: Number(v) }))),
      }),
    );
  if (mode !== "none")
    fields.push(
      field({
        key: "assume/reserve/count",
        item: RESERVE_ITEM,
        label: "「金融資産は○歳まで持つ」の判定",
        level: "detail",
        kind: "select",
        options: [
          { value: "exclude", label: "除いて判定（既定）" },
          { value: "include", label: "含めて判定" },
        ],
        help: "除いて判定すると、生活防衛資金に手をつけ始める年を「足りなくなる年」として見せます（資金の不足が出るのは、生活防衛資金も使い切った後）",
        get: (w) => ({ value: reserveOf(w.request)?.countInLasting === true ? "include" : "exclude" }),
        set: (w, v) => {
          const { countInLasting: _c, ...rest } = reserveOf(w.request) ?? {};
          void _c;
          return withReq(w, setReserve(w.request, v === "include" ? { ...rest, countInLasting: true } : rest));
        },
      }),
    );
  return { key: "assume/reserve/fields", level: "simple", fields, actions: [] };
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
    help: "標準は、本人・配偶者のうち若い方が100歳になる年",
    get: (w) => ({ value: w.request.input.endYear, hint: `標準は ${standardEndYear(w.request.input.household)}年` }),
    set: (w, v) => (v === null ? w : mutate(w, (_h: Household, req) => void (req.input.endYear = Number(v)))),
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
        key: "assume/surplus",
        title: "黒字の貯まり方と生活防衛資金",
        note: "黒字が全部は貯まらない現実に近づけるときに。空欄なら今まで通りの計算です",
        level: "simple",
        groups: [...surplusGroups(wh), reserveGroup(wh)],
        actions:
          (surplusOf(wh.request)?.changes ?? []).length >= 4
            ? []
            : [
                {
                  key: "assume/surplus/addChange",
                  label: "＋ 期間で割合を変える（例: 子の独立の後は80%）",
                  level: "simple" as const,
                  run: (w: WorkingHousehold) => {
                    const next = nextChangeFrom(w);
                    if (next === null) return w;
                    const cur = surplusOf(w.request) ?? {};
                    return withReq(w, setSurplus(w.request, { ...cur, changes: [...(cur.changes ?? []), next] }));
                  },
                },
              ],
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
