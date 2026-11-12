// 資産運用（0026）の提示用の値（作業の層）: 資産の推移のグラフに重ねる口座の内訳・運用の期間の帯・相場が下がった場合の線、
// 結論の1文「金融資産は○歳まで持ちます」、資産の内訳のドーナツ（プランA と選んだプランを同じ年で）。許可した値だけを選んで写す（0016 の2）
import type { Account, EngineRequest, PreviewResult, TableCell } from "../../engine/types.ts";
import type { DonutItem, DonutPane } from "../../presentation/Donut.tsx";
import type { InvestBandModel, InvestChartModel, ResultVerdict, SeriesNames, StackSeries, StressLineModel, VerdictPart } from "../../presentation/model.ts";
import { ASSET_CLASSES } from "../input/labels.ts";
import { CLASSES, drawdownOf, INVEST_KINDS, investmentOf, KIND_INFO, methodOf, retireAgeOf, RISKY_CLASSES, selfOf, stopAgeOf, stopAgeOrEstimate, stopEstimateOf, totalViewOf } from "../input/savings/model.ts";
import { ageReachedMonth, parseYm } from "../levers.ts";
import { depletionYear } from "../present.ts";
import { ageInYear } from "../roles.ts";
import { OFFICIAL_WORDING, type Wording } from "../resultTexts.ts";
import { presetNum, presetRate } from "../../../../hearing/src/presets.ts";

/** 口座の内訳のまとまり（下から積む順） */
export const GROUPS: readonly { key: string; label: string; kinds: readonly string[] }[] = [
  { key: "dep", label: "預金", kinds: ["deposit", "fxDeposit", "zaikei"] },
  { key: "un", label: "まだ分けていない", kinds: ["pooled"] },
  { key: "dc", label: "iDeCo・企業型DC", kinds: ["ideco", "corporateDc"] },
  { key: "nisa", label: "NISA", kinds: ["nisa", "childNisa", "juniorNisa", "legacyNisa"] },
  { key: "tax", label: "課税口座など", kinds: ["taxable", "esop", "smallBusinessMutualAid", "cryptoAsset"] },
];

const kindOf = (row: string) => (row.startsWith("cf.balance.account.") ? row.slice("cf.balance.account.".length) : null);

/** 口座の内訳（年ごと。マイナス（預金の不足）は0として積む） */
export function breakdownOf(table: readonly TableCell[], years: readonly number[]): StackSeries[] {
  const idx = new Map(years.map((y, i) => [y, i]));
  return GROUPS.map((g) => {
    const values = new Array<number>(years.length).fill(0);
    for (const c of table) {
      const k = kindOf(c.row);
      const i = idx.get(c.year);
      if (k === null || i === undefined || !g.kinds.includes(k)) continue;
      values[i] = (values[i] ?? 0) + c.amount;
    }
    return { key: g.key, label: g.key === "un" ? "まだ分けていない" : g.label, values: values.map((v) => Math.max(0, v)) };
  }).filter((s) => s.values.some((v) => v > 0));
}

/** 何歳まで持つか（尽きる年の前の年の年齢。尽きなければ表の最後の年の年齢） */
export function lastsAge(req: EngineRequest, table: readonly TableCell[], years: readonly number[]): number | null {
  const self = selfOf(req.input.household);
  if (self === undefined || years.length === 0) return null;
  const dep = depletionYear(table, years);
  return ageInYear(self, dep === null ? (years.at(-1) as number) : dep - 1);
}

const manText = (yen: number) => {
  const v = Math.round(yen / 1000) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

/**
 * 取り崩しの条件の文（例: 「65歳から毎月17万円ずつ取り崩す場合」）。予定が無いときは「取り崩しの予定を入れず、足りない年だけ取り崩す場合」
 * （前の「足りない年だけ取り崩す場合（取り崩しの予定なし）」は、取り崩すのに予定なしと読めて分かりにくかった。0212）。
 * 提案書の資産運用の条件は公式の文のまま（w を渡さない）
 */
export function drawdownText(req: EngineRequest, w: Wording = OFFICIAL_WORDING): string {
  const d = drawdownOf(req);
  if (d.method === "none") return w.text("result:invest/conditionNone");
  return d.method === "fixed" ? w.text("result:invest/conditionFixed", { age: `${d.startAge}歳`, amount: `${manText(d.monthly)}万円` }) : w.text("result:invest/conditionRate", { age: `${d.startAge}歳`, rate: `${(Number(d.rate) * 100).toFixed(1)}%` });
}

/**
 * 結論の1文（資産の推移のとき）: 「金融資産は 99歳 まで持ちます」＋条件、基準のプランは2行目。
 * 文は結果の画面の文の表（resultTexts.ts の result:invest/…）から。事務所の文を承認していれば、その文に同じ値を差し込む（0212）
 */
export function investVerdict(names: SeriesNames, sel: { req: EngineRequest; table: readonly TableCell[] }, base: { req: EngineRequest; table: readonly TableCell[] } | null, years: readonly number[], w: Wording = OFFICIAL_WORDING): ResultVerdict {
  const a = lastsAge(sel.req, sel.table, years);
  const b = base === null ? null : lastsAge(base.req, base.table, years);
  const age = a === null ? "—" : `${a}歳`;
  const parts: VerdictPart[] = names.same ? w.parts("result:invest/verdictSame", { age }) : w.parts("result:invest/verdict", { plan: names.selected, age });
  const sub: VerdictPart[] = [{ text: drawdownText(sel.req, w) }];
  if (!names.same && b !== null) sub.push({ text: `／${w.text("result:invest/verdictBase", { basePlan: names.base, baseAge: `${b}歳` })}` });
  const tone = names.same || b === null || a === null ? "flat" : a > b ? "up" : a < b ? "down" : "flat";
  return { tone, parts, sub };
}

/** 運用の期間の帯（選んだプランの要求から。ages は x 軸の年の本人の年齢）。提案書の運用の期間は公式の文のまま（w を渡さない） */
export function bandOf(req: EngineRequest, ages: readonly (number | null)[], w: Wording = OFFICIAL_WORDING): InvestBandModel | null {
  const h = req.input.household;
  const self = selfOf(h);
  if (self === undefined || !(h.accounts ?? []).some((a) => a.kind !== "realEstate" && a.kind !== "otherAsset")) return null;
  const stopEst = stopAgeOf(h);
  const stopAge = stopEst ?? stopEstimateOf(req).age;
  const d = drawdownOf(req);
  const wdAge = d.method === "none" ? null : d.startAge;
  const at = (age: number) => {
    const i = ages.findIndex((x) => x !== null && x >= age);
    return i < 0 ? ages.length : i;
  };
  const view = totalViewOf(req);
  const first = ages.find((x) => x !== null) ?? 0;
  const steps = view.steps.filter((s) => s.fromAge < stopAge).map((s) => ({ at: at(Math.max(s.fromAge, first)), label: `月${manText(s.monthly)}万` }));
  const accumEnd = at(stopAge);
  const now = ages[0] ?? first;
  const wdStart = wdAge === null ? null : at(wdAge);
  return {
    accumEnd,
    wdStart,
    stopAge,
    wdAge,
    estimated: stopEst === null,
    steps,
    accumText: `積み立てる ${now}〜${stopAge - 1}歳`,
    holdText: "据え置く",
    holdSub: wdAge === null ? w.text("result:invest/holdNone", { age: `${stopAge}歳` }) : wdAge > stopAge ? `${stopAge}〜${wdAge - 1}歳` : "",
    wdText: "取り崩す",
    wdSub: wdAge === null ? "" : d.method === "fixed" ? `${wdAge}歳〜 月${manText(d.monthly)}万円` : `${wdAge}歳〜 年${(Number(d.rate) * 100).toFixed(1)}%`,
    minAge: (now ?? 0) + 1,
    maxAge: 90,
  };
}

// ---- 相場が下がった場合 ----

export const STRESS_KEYS = ["drop", "low", "minus1"] as const;
export type StressKey = (typeof STRESS_KEYS)[number];

/** 退職の年（本人）と、取り崩しを始める年（予定が無ければ退職の年） */
function refYears(req: EngineRequest): { retire: number; wd: number } {
  const self = selfOf(req.input.household);
  const r = retireAgeOf(req) ?? 65;
  const retire = self === undefined ? parseYm(req.input.baseMonth).y + 1 : parseYm(ageReachedMonth(self, r)).y;
  const d = drawdownOf(req);
  return { retire, wd: d.method === "none" || self === undefined ? retire : parseYm(ageReachedMonth(self, d.startAge)).y };
}

/** 相場が下がった場合の3つの型の要求（選んだプランの要求にストレステストの型を重ねる） */
export function stressRequests(req: EngineRequest): Record<StressKey, EngineRequest> {
  const y = refYears(req);
  const withTest = (stressTest: Record<string, unknown>): EngineRequest => ({ ...req, input: { ...req.input, stressTest } });
  return {
    drop: withTest({ template: "marketDropAtRetirement", params: { year: y.retire, drop: presetRate("preset.stress.marketDrop"), assetClasses: [...RISKY_CLASSES] } }),
    low: withTest({ template: "lowReturnPeriod", params: { year: y.wd, years: presetNum("preset.stress.lowReturn.years"), cap: presetRate("preset.stress.lowReturn.cap") } }),
    minus1: withTest({ template: "returnShortfall", params: { add: "-0.01" } }),
  };
}

export function stressLabel(req: EngineRequest, key: StressKey): string {
  if (key === "drop") {
    const d = Number(presetRate("preset.stress.marketDrop"));
    return `退職の直後に株などが${Math.abs(d * 10 - Math.round(d * 10)) < 1e-9 ? `${String(Math.round(d * 10))}割` : `${String(Math.round(d * 1000) / 10)}%`}下がる`;
  }
  if (key === "low") return `${drawdownOf(req).method === "none" ? "退職" : "取り崩しを始めて"}から${String(presetNum("preset.stress.lowReturn.years"))}年間、利回りが低いまま（年${String(Math.round(Number(presetRate("preset.stress.lowReturn.cap")) * 100000) / 1000)}%）`;
  return "利回りがずっと想定より1%低い";
}

export function stressLines(req: EngineRequest, results: Partial<Record<StressKey, PreviewResult | null>>, years: readonly number[], w: Wording = OFFICIAL_WORDING): StressLineModel[] {
  return STRESS_KEYS.map((key) => {
    const r = results[key] ?? null;
    const fin = new Map<number, number>();
    if (r !== null) for (const c of r.table) if (c.row === "cf.balance.financial") fin.set(c.year, (fin.get(c.year) ?? 0) + c.amount);
    const a = r === null ? null : lastsAge(req, r.table, years);
    return { key, label: stressLabel(req, key), values: r === null ? null : years.map((y) => fin.get(y) ?? 0), lasts: a === null ? "計算しています" : w.text("result:invest/stressLasts", { age: `${a}歳` }) };
  });
}

/** 資産の推移に重ねる値 */
export function investChart(input: {
  sel: { req: EngineRequest; res: PreviewResult };
  years: readonly number[];
  ages: readonly (number | null)[];
  stress: Partial<Record<StressKey, PreviewResult | null>> | null;
  view: InvestChartModel["view"];
  /** 結果の画面の文（承認した事務所の文を当てた物。省略は公式の文。0212） */
  wording?: Wording;
}): InvestChartModel {
  const { sel, years, ages } = input;
  const w = input.wording ?? OFFICIAL_WORDING;
  return {
    breakdown: methodOf(sel.req) === "total" ? null : breakdownOf(sel.res.table, years),
    band: bandOf(sel.req, ages, w),
    stress: input.stress === null ? null : stressLines(sel.req, input.stress, years, w),
    view: input.view,
  };
}

/** 運用の期間の帯を出すか（表示の設定。空は「取り崩しの予定があるときだけ」） */
export function bandShown(setting: boolean | null, req: EngineRequest): boolean {
  return setting ?? drawdownOf(req).method !== "none";
}

// ---- 資産の内訳（ドーナツ）----

/**
 * 結果の画面のグラフの下に資産の内訳（ドーナツ）を出すか: グラフの上の「口座の内訳を表示」にチェックが入っているときだけ（既定は出さない）。
 * チェックを出さない入れ方（合計）のときと、全部のプランを色分けで重ねる表示（チェックそのものを出さない）のときは出さない。
 * 入力の「貯蓄・運用」のパネルの中のドーナツはこれに関わらず出す
 */
export function donutShown(breakdownSetting: boolean, canBreakdown: boolean, multi: boolean): boolean {
  return breakdownSetting && canBreakdown && !multi;
}

const CLASS_NAME = (cls: string) => CLASSES.find((c) => c.key === cls)?.name ?? ASSET_CLASSES.find((c) => c.value === cls)?.label ?? "その他";
const CLASS_COLOR: Record<string, string> = Object.fromEntries(CLASSES.map((c) => [c.key, c.color]));
const EXTRA_COLORS = ["#8e7aa3", "#6f9b84", "#b8a8cf", "#c2c7ce", "#a3845c", "#9fb4d3"];

/** 内訳を見る年の既定: 取り崩しを始める年（予定が無ければ積立をやめる年） */
export function donutYear(req: EngineRequest, years: readonly number[]): number {
  const self = selfOf(req.input.household);
  const d = drawdownOf(req);
  const age = d.method !== "none" ? d.startAge : stopAgeOrEstimate(req);
  const y = self === undefined ? (years[0] ?? 0) : parseYm(ageReachedMonth(self, age)).y;
  return years.includes(y) ? y : (years.at(-1) ?? y);
}

/** その年の内訳（口座ごと・資産の種類ごと） */
export function donutItems(req: EngineRequest, table: readonly TableCell[], year: number, by: "account" | "class"): DonutItem[] {
  // 金融資産だけ（不動産は土地と建物の行 realEstate.land・realEstate.building にも分かれて出る。0028）
  const rows = table.filter((c) => c.year === year && c.amount > 0 && kindOf(c.row) !== null && !["realEstate", "insurance", "car", "otherAsset"].includes((kindOf(c.row) as string).split(".")[0] as string));
  if (by === "account") {
    const m = new Map<string, DonutItem>();
    for (const c of rows) {
      const k = kindOf(c.row) as string;
      const info = KIND_INFO[k];
      const label = k === "pooled" && methodOf(req) === "total" ? "金融資産（合計）" : (info?.name.replace(/（.*）$/, "") ?? "その他");
      const cur = m.get(label);
      m.set(label, { label, amount: (cur?.amount ?? 0) + c.amount, color: info?.color ?? "#c2c7ce" });
    }
    return [...m.values()];
  }
  const accounts = new Map((req.input.household.accounts ?? []).map((a) => [a.id, a]));
  const inv = investmentOf(req);
  const alloc = methodOf(req) === "allocation" ? inv.allocation?.mix : undefined;
  const m = new Map<string, number>();
  const add = (label: string, v: number) => m.set(label, (m.get(label) ?? 0) + v);
  for (const c of rows) {
    const k = kindOf(c.row) as string;
    const acc = c.object !== undefined ? (accounts.get(c.object) as Account | undefined) : undefined;
    const mix = alloc !== undefined && INVEST_KINDS.has(k) ? alloc : acc !== undefined && acc.kind === k ? acc.assetMix : undefined;
    if (mix === undefined || mix.length === 0) {
      add(k === "deposit" || k === "zaikei" ? "現金" : k === "fxDeposit" ? "外貨預金" : k === "cryptoAsset" ? "暗号資産" : "運用（配分を入れていない）", c.amount);
      continue;
    }
    const total = mix.reduce((s, x) => s + Number(x.share), 0) || 1;
    for (const x of mix) add(x.assetClass === "cash.deposit" ? "現金" : CLASS_NAME(x.assetClass), Math.round((c.amount * Number(x.share)) / total));
  }
  let extra = 0;
  return [...m.entries()].map(([label, amount]) => ({ label, amount, color: Object.entries(CLASS_COLOR).find(([k]) => (k === "cash.deposit" ? "現金" : CLASS_NAME(k)) === label)?.[1] ?? EXTRA_COLORS[extra++ % EXTRA_COLORS.length] ?? "#c2c7ce" }));
}

/** 内訳を並べる（プランA と選んだプランを同じ年で。同じプランなら1つ） */
export function donutPanes(input: { base: { name: string; req: EngineRequest; table: readonly TableCell[] }; sel: { name: string; req: EngineRequest; table: readonly TableCell[] }; same: boolean; year: number; age: number | null; who: string; by: "account" | "class" }): DonutPane[] {
  const sub = `${input.year}年${input.age !== null ? `（${input.who}${input.age}歳）` : ""}`;
  const one = (p: typeof input.base, tag: string): DonutPane => ({ title: `${p.name}${tag}`, sub, items: donutItems(p.req, p.table, input.year, input.by) });
  return input.same ? [one(input.sel, "")] : [one(input.base, "（基準）"), one(input.sel, "（選んだプラン）")];
}

