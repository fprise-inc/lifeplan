// 10. 前提条件（0070）: 物価上昇率・賃金上昇率・運用利回り・教育費の上昇率・年金のマクロ経済スライド（基礎・厚生）の年ごとの列の既定の値と
// 例外の年（0008 の8・0040）、資産の種類ごとの利回り（と例外の年）、持ち家の評価の前提（土地の上昇率の例外の年を含む）、表の最後の年
// （年か人の年齢で）・計算の基準の月と計算の決まり（読むだけ）、FP顧問料（単発・継続・料金の段階。stages/fees.ts）。
// - 経済の前提の値は「既定の値（仮の値）」の推定として見せる（標準と同じ値で、値の状態の行が無いとき。古い世帯も書き換えずに読む）。
//   空欄にすると標準（教育費・厚生年金の調整率は、物価・基礎年金の調整率と同じ）に戻る。確定は「この値にする」だけ（0041）
// - 高すぎる値の注意の線（運用利回りが年5%を超える・物価が0%未満か4%を超える・賃金が物価を2ポイント超えて上回る・資産の種類ごとの
//   利回りが年8%を超える）は、欄の知らせと確かめの一覧の注意に出す（値は変えない）
// - 表の最後の年は、標準（本人・配偶者のうち若い方が100歳〔事務所の既定値で選んだ年齢〕になる年）と同じなら推定。確定にしたら家族の生年月を直しても追いかけない。
//   古い世帯で若い方が表の最後の年に105歳を超える（か85歳に届かない）ときは、確かめの注意に「標準にする」を出す（押したときだけ直す）
// - 表の最後の年はどのプランにも共通（世帯で1つ。プランの差分にしない。0043 の追記 2026-11-05）。何歳まで見るかは、標準の欄の選び方
//   「若い方が［90・95・100・105］歳になる年まで」で選ぶ。年・人の年齢で入れる欄は詳細
// 黒字のうち貯まる割合（0031）は、顧客と一緒に見る基本生活費のカードへ移した（stages/surplusSaving.ts。0031 の追記）
import type { Household, ReturnShift, YearSeries } from "../../../engine/types.ts";
import { ageInYear } from "../../roles.ts";
import type { Address } from "../../store/readings.ts";
import { field, getPath, plain, type ActionDef, type FieldDef, type FieldState, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { DEFAULT_ASSUMPTIONS, defaultEndAge, END_AGES, endAgeOf, endYearForAge, mutate, STANDARD_END_AGE, standardEndYear, type WorkingHousehold } from "../household.ts";
import { ASSET_CLASSES, BUILDING_STRUCTURES, memberLabel, USEFUL_LIFE, VALUATION_DEFAULTS } from "../labels.ts";
import { sameRate } from "../units.ts";
import { cmpRate, pctText } from "../../plans/decimal.ts";
import { feeSections } from "./fees.ts";
import { GROWTH_RANGE, RETURN_RANGE, SLIDE_RANGE, type PctRange } from "../rateRanges.ts";
import { presetNum } from "../../../../../hearing/src/presets.ts";

type Obj = Record<string, unknown>;
type Assumptions = NonNullable<WorkingHousehold["request"]["input"]["assumptions"]>;

/** 既定の値（仮の値）の根拠の文（事務所の標準値ができるまで。0070） */
export const STANDARD_BASIS = "既定の値（仮の値。事務所で根拠を確かめて直してください）";

/** 経済の前提の標準の値（新しい世帯に入れる値と同じ。household.ts の DEFAULT_ASSUMPTIONS） */
const STANDARD: Readonly<Record<string, string>> = {
  inflation: DEFAULT_ASSUMPTIONS.inflation.default,
  wageGrowth: DEFAULT_ASSUMPTIONS.wageGrowth.default,
  investmentReturn: DEFAULT_ASSUMPTIONS.investmentReturn.default,
  pensionMacroSlide: DEFAULT_ASSUMPTIONS.pensionMacroSlide.default,
};

/** 経済の前提の列の範囲（0098。例外の年の率も同じ範囲） */
const SERIES_RANGES: Readonly<Record<string, PctRange>> = {
  inflation: GROWTH_RANGE,
  wageGrowth: GROWTH_RANGE,
  educationInflation: GROWTH_RANGE,
  investmentReturn: RETURN_RANGE,
  pensionMacroSlide: SLIDE_RANGE,
  pensionMacroSlideEmployee: SLIDE_RANGE,
};

/** 空欄のとき、ほかの前提と同じ値になる前提（教育費は物価、厚生年金の調整率は基礎年金の調整率） */
const FOLLOWS: Readonly<Record<string, { name: string; basis: string }>> = {
  educationInflation: { name: "inflation", basis: "物価上昇率と同じ" },
  pensionMacroSlideEmployee: {
    name: "pensionMacroSlide",
    basis: "基礎年金の調整率と同じ",
  },
};

const num = (v: string | undefined | null) => (v === undefined || v === null ? null : Number(v));

/** 高すぎる値の注意の線（事務所で直す。今は初めの線の仮の値。0070） */
export function rateWarning(name: string, a: Assumptions | undefined): string | null {
  const v = num((getPath(a, [name, "default"]) as string | undefined) ?? null);
  if (v === null) return null;
  // 線は presets.ts の目安（事務所の推定の値があればその値）
  const ret = presetNum("preset.assumptions.warn.investmentReturn");
  const inf = presetNum("preset.assumptions.warn.inflationHigh");
  const pct = (x: number) => `${String(Math.round(x * 100000) / 1000)}%`;
  if (name === "investmentReturn" && v > ret) return `運用利回りが年${pct(ret)}を超えています（事務所の注意の線）。長い期間の平均として高すぎないか確かめてください`;
  if (name === "inflation" && (v < 0 || v > inf)) return `物価上昇率が0%未満か${pct(inf)}を超えています（事務所の注意の線）`;
  if (name === "wageGrowth") {
    const inf = num(a?.inflation?.default ?? null) ?? 0;
    if (v - inf > 0.02) return "賃金上昇率が物価上昇率を2ポイント超えて上回っています（事務所の注意の線）";
  }
  return null;
}

/** 前提の列の置き場所（前提の中の道と、当て先の入力項目ID） */
interface SeriesPlace {
  path: readonly string[];
  item: string;
}

const assumptionsOf = (wh: WorkingHousehold): Assumptions | undefined => wh.request.input.assumptions;
const seriesAt = (wh: WorkingHousehold, sp: SeriesPlace): YearSeries | undefined => getPath(assumptionsOf(wh), sp.path) as YearSeries | undefined;

/** 列を書く（undefined は列を外す）。前提が無ければ作る */
function writeSeries(wh: WorkingHousehold, sp: SeriesPlace, next: YearSeries | undefined): WorkingHousehold {
  const request = structuredClone(wh.request);
  const a = (request.input.assumptions ??= structuredClone(DEFAULT_ASSUMPTIONS) as Assumptions) as unknown as Obj;
  const chain: Obj[] = [a];
  for (const k of sp.path.slice(0, -1)) {
    const holder = chain[chain.length - 1] as Obj;
    if (typeof holder[k] !== "object" || holder[k] === null) {
      if (next === undefined) return wh;
      holder[k] = {};
    }
    chain.push(holder[k] as Obj);
  }
  const last = sp.path[sp.path.length - 1] as string;
  const holder = chain[chain.length - 1] as Obj;
  if (next !== undefined) holder[last] = next;
  else {
    delete holder[last];
    // 空になった入れ物（持ち家の評価の前提など）も外す
    for (let i = chain.length - 1; i > 0; i--) if (Object.keys(chain[i] as Obj).length === 0) delete (chain[i - 1] as Obj)[sp.path[i - 1] as string];
  }
  return { ...wh, request };
}

/** 年ごとの列の既定の値（default）の欄（経済の前提） */
function seriesField(name: string, label: string, help: string, level: "simple" | "detail"): FieldDef {
  const sp: SeriesPlace = { path: [name], item: `assumptions.${name}` };
  const follows = FOLLOWS[name];
  const standard = STANDARD[name];
  const address = (): Address => ({
    target: { plan: "assumptions" },
    item: sp.item,
    at: ["default"],
  });
  return field({
    key: `assume/${name}`,
    item: sp.item,
    label,
    level,
    kind: "pct",
    ...SERIES_RANGES[name],
    optional: true,
    blankIsEstimate: true,
    help,
    address,
    get: (wh): FieldState => {
      const s = seriesAt(wh, sp);
      const a = assumptionsOf(wh);
      const ex = s?.byYear !== undefined ? Object.keys(s.byYear).length : 0;
      const derived = ex > 0 ? `例外の年 ${ex}年（「詳細」の「例外の年」で直します）` : null;
      const warn = rateWarning(name, a);
      if (follows !== undefined && s === undefined) {
        const v = (getPath(a, [follows.name, "default"]) as string | undefined) ?? null;
        return { value: v, estimated: follows.basis, derived, warn };
      }
      if (s === undefined) return { value: null, hint: "入れない（0%で計算）", derived, warn };
      const fv = follows !== undefined ? ((getPath(a, [follows.name, "default"]) as string | undefined) ?? null) : null;
      const est = standard !== undefined && sameRate(s.default, standard) ? STANDARD_BASIS : follows !== undefined && fv !== null && sameRate(s.default, fv) ? follows.basis : null;
      return {
        value: s.default,
        ...(est !== null ? { estimated: est } : {}),
        derived,
        warn,
      };
    },
    set: (wh, v) => {
      const cur = seriesAt(wh, sp);
      if (v === null) {
        // 空欄: 標準の値に戻す（ほかの前提と同じ値になる前提は、例外の年が無ければ列を外す）
        if (follows !== undefined) {
          if (cur?.byYear === undefined) return writeSeries(wh, sp, undefined);
          const f = (getPath(assumptionsOf(wh), [follows.name, "default"]) as string | undefined) ?? "0";
          return writeSeries(wh, sp, { ...cur, default: f });
        }
        if (standard === undefined) return writeSeries(wh, sp, undefined);
        return writeSeries(wh, sp, { ...cur, default: standard });
      }
      if (cur !== undefined && sameRate(cur.default, String(v))) return wh;
      return writeSeries(wh, sp, { ...cur, default: String(v) });
    },
  });
}

// ---- 例外の年（0040・0070）: 年ごとの値（byYear）を、続いた年で同じ率のまとまり（範囲）で見せて直す ----

/** 例外の年の範囲（始まりの年〜終わりの年・率） */
export interface YearRange {
  from: number;
  to: number;
  rate: string;
}

/** 年ごとの値 → 範囲（続いた年で同じ率をまとめる） */
export function yearRanges(byYear: Readonly<Record<string, string>> | undefined): YearRange[] {
  const ys = Object.keys(byYear ?? {})
    .map(Number)
    .sort((a, b) => a - b);
  const out: YearRange[] = [];
  for (const y of ys) {
    const r = (byYear as Record<string, string>)[String(y)] as string;
    const last = out.at(-1);
    if (last !== undefined && last.to === y - 1 && sameRate(last.rate, r)) last.to = y;
    else out.push({ from: y, to: y, rate: r });
  }
  return out;
}

/** 範囲 → 年ごとの値 */
function byYearOf(ranges: readonly YearRange[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const r of ranges) for (let y = r.from; y <= r.to; y++) out[String(y)] = r.rate;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 列の例外の年を書き直す（i 番目の範囲を next に。null は外す。i が範囲の数以上なら足す） */
function rewriteRange(wh: WorkingHousehold, sp: SeriesPlace, i: number, next: YearRange | null, fallback: string): WorkingHousehold {
  const cur = seriesAt(wh, sp);
  const ranges = yearRanges(cur?.byYear);
  if (i < ranges.length) ranges.splice(i, 1);
  if (next !== null) {
    // 直した範囲がほかの範囲と重なれば、直した範囲を勝たせる
    for (const r of ranges) if (r.to >= next.from && r.from <= next.to) [r.from, r.to] = r.from < next.from ? [r.from, next.from - 1] : [next.to + 1, r.to];
    ranges.push({ ...next });
  }
  const byYear = byYearOf(ranges.filter((r) => r.from <= r.to));
  const base: YearSeries = { default: cur?.default ?? fallback };
  return writeSeries(wh, sp, byYear === undefined ? (cur === undefined ? undefined : base) : { ...base, byYear });
}

/** 例外の年のまとまり（範囲ごと）と「＋ 例外の年」 */
function exceptionGroups(wh: WorkingHousehold, key: string, sp: SeriesPlace, what: string, fallback: string, range: PctRange): { groups: GroupDef[]; add: ActionDef } {
  const ranges = yearRanges(seriesAt(wh, sp)?.byYear);
  const by = Number(wh.request.input.baseMonth.slice(0, 4));
  const rangeAt = (w: WorkingHousehold, i: number) => yearRanges(seriesAt(w, sp)?.byYear)[i];
  const groups = ranges.map((r, i): GroupDef => {
    const k = `${key}/ex/${i}`;
    const yearField = (end: "from" | "to") =>
      field({
        key: `${k}/${end}`,
        item: sp.item,
        label: end === "from" ? "始まりの年" : "終わりの年",
        level: "detail",
        kind: "int",
        suffix: "年",
        min: by,
        max: wh.request.input.endYear,
        get: (w) => ({ value: rangeAt(w, i)?.[end] ?? null }),
        set: (w, v) => {
          const x = rangeAt(w, i);
          if (x === undefined || v === null) return w;
          const n = Number(v);
          // 始まりの年を直すと範囲ごと動かす（年数はそのまま）。終わりの年は、始まりより前にしたら始まりも合わせる
          const next = end === "from" ? { ...x, from: n, to: n + (x.to - x.from) } : { ...x, to: n, from: Math.min(n, x.from) };
          return rewriteRange(w, sp, i, next, fallback);
        },
      });
    return {
      key: k,
      title: `例外の年（${what}）: ${r.from === r.to ? `${r.from}年` : `${r.from}〜${r.to}年`} ${pctText(r.rate)}`,
      level: "detail",
      fields: [
        yearField("from"),
        yearField("to"),
        field({
          key: `${k}/rate`,
          item: sp.item,
          label: "その間の率（年）",
          level: "detail",
          kind: "pct",
          ...range,
          get: (w) => ({ value: rangeAt(w, i)?.rate ?? null }),
          set: (w, v) => {
            const x = rangeAt(w, i);
            return x === undefined || v === null ? w : rewriteRange(w, sp, i, { ...x, rate: String(v) }, fallback);
          },
        }),
      ],
      actions: [
        {
          key: `${k}/remove`,
          label: "この例外の年を外す",
          level: "detail",
          danger: true,
          run: (w) => rewriteRange(w, sp, i, null, fallback),
        },
      ],
    };
  });
  const last = ranges.at(-1);
  const from = Math.max(by, (last?.to ?? by - 1) + 1);
  const add: ActionDef = {
    key: `${key}/ex/add`,
    label: `＋ 例外の年（${what}）`,
    level: "detail",
    run: (w) => rewriteRange(w, sp, Number.MAX_SAFE_INTEGER, { from, to: from, rate: seriesAt(w, sp)?.default ?? fallback }, fallback),
  };
  return { groups, add };
}

/** 率の幅の見せ方（足す幅なので、プラスにも符号を付ける） */
const signedPct = (r: string): string => (cmpRate(r, "0") > 0 ? `+${pctText(r, 1)}` : pctText(r, 1));

type LoanRateShift = { from: string; add: string };

/** 運用の利回りの書き換え1件の言葉（例: 「2026年から、運用する口座の利回りに -2%」） */
function returnShiftText(s: ReturnShift): string {
  const span = `${s.from}年${s.to !== undefined ? `〜${s.to}年` : "から"}`;
  const what = [s.add !== undefined ? `運用する口座の利回りに ${signedPct(s.add)}` : null, s.cap !== undefined ? `利回りの上限 ${pctText(s.cap, 1)}` : null].filter((x) => x !== null).join("・");
  return `${span}、${what === "" ? "変えない" : what}`;
}

/**
 * 結果のタブで動かした利回り・金利（前提の書き換え。読むだけ）: 「運用の利回り」の項目は口座の利回りの欄を書き換えず、運用する器の利回りに
 * 幅を足す書き換え（returnShifts。0026）を、「変動金利の上昇」の項目は変動金利の段に足す上乗せ（loanRateShifts）を作る。どちらも口座・
 * ローンの欄には出ないので、ある物だけここに出す（プランを入力で開いたとき、現状の利回り・金利だけが見えて、計算と違って見えないように）。
 * 動かすのは結果のタブで（0043 の3: 結果のタブの対策で変わる値は、入力では直さない。直すと項目の差分と重なる）
 */
function shiftFields(wh: WorkingHousehold): FieldDef[] {
  const a = wh.request.input.assumptions;
  const ro = (key: string, item: string, label: string, how: string, read: (w: WorkingHousehold) => string | null) =>
    field({ key, item, label, level: "simple", kind: "text", readOnly: how, get: (w) => ({ value: read(w) }), set: (w) => w });
  const returns = (a?.returnShifts ?? []).map((_s, i) =>
    ro(`assume/returnShifts/${i}`, "assumptions.returnShifts", "運用の利回りの書き換え", "結果のタブの「運用の利回り」で動かします。口座の利回りの欄の値はそのままで、計算でこの幅を足します。現状に反映し直すと1件にまとめ、元の利回りに戻したプランを反映すると無くなります", (w) => {
      const x = w.request.input.assumptions?.returnShifts?.[i];
      return x === undefined ? null : returnShiftText(x);
    }),
  );
  const loans = ((a?.loanRateShifts as LoanRateShift[] | undefined) ?? []).map((_s, i) =>
    ro(`assume/loanRateShifts/${i}`, "assumptions.loanRateShifts", "変動金利の上乗せ", "結果のタブの「変動金利の上昇」で動かします。ローンの金利の欄の値はそのままで、変動金利の段の金利にこの幅を足して計算します（固定金利の段は変わりません）", (w) => {
      const x = (w.request.input.assumptions?.loanRateShifts as LoanRateShift[] | undefined)?.[i];
      return x === undefined ? null : `${Number(x.from.slice(0, 4))}年${Number(x.from.slice(5, 7))}月から、変動金利の段の金利に ${signedPct(x.add)}`;
    }),
  );
  return [...returns, ...loans];
}

function assetReturnGroups(wh: WorkingHousehold): GroupDef[] {
  const ar = wh.request.input.assumptions?.assetReturns ?? {};
  return Object.keys(ar).flatMap((cls) => {
    const label = ASSET_CLASSES.find((o) => o.value === cls)?.label ?? cls;
    const ex = exceptionGroups(wh, `assume/assetReturns/${cls}`, { path: ["assetReturns", cls], item: "assumptions.assetReturns" }, label, "0.03", RETURN_RANGE);
    const main: GroupDef = {
      key: `assume/assetReturns/${cls}`,
      title: label,
      level: "detail" as const,
      fields: [
        plain({
          key: `assume/assetReturns/${cls}/default`,
          item: "assumptions.assetReturns",
          label: "利回り（年・費用と税を引く前）",
          level: "detail",
          kind: "pct",
          ...RETURN_RANGE,
          find: (_h, w) => (getPath(w.request.input.assumptions, ["assetReturns", cls]) as Obj | undefined) ?? undefined,
          path: ["default"],
          hint: (v) => (v !== null && Number(v) > 0.08 ? "年8%を超えています（事務所の注意の線）" : null),
        }),
      ],
      actions: [
        ex.add,
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
    };
    return [main, ...ex.groups];
  });
}

/** 持ち家の評価の前提（assumptions.realEstateValuation。空欄は計算エンジンの目安を推定として見せる。0025） */
function valuationGroups(wh: WorkingHousehold): GroupDef[] {
  const find = (_h: Household, w: WorkingHousehold) => w.request.input.assumptions as Record<string, unknown> | undefined;
  const item = "assumptions.realEstateValuation";
  const R = "realEstateValuation";
  /** 空欄は目安（推定。根拠 0025 の目安）。持ち家・不動産が無い世帯では使わないので、推定の数に入れない */
  const owns = (w: WorkingHousehold) => (w.request.input.household.residences ?? []).some((r) => r.kind === "own") || (w.request.input.household.accounts ?? []).some((x) => x.kind === "realEstate");
  const est = (f: FieldDef, basis: string): FieldDef => ({
    ...f,
    get: (w) => {
      const st = f.get(w);
      return st.implicit === true && owns(w) ? { ...st, estimated: basis } : st;
    },
  });
  const ex = exceptionGroups(wh, "assume/realEstate/landGrowth", { path: [R, "landGrowth"], item }, "土地の上昇率", wh.request.input.assumptions?.inflation?.default ?? "0", GROWTH_RANGE);
  return [
    {
      key: "assume/realEstate/fields",
      level: "detail",
      fields: [
        field({
          key: "assume/realEstate/landGrowth",
          item,
          label: "土地の上昇率（年）",
          level: "detail",
          kind: "pct",
          ...GROWTH_RANGE,
          optional: true,
          blankIsEstimate: true,
          help: "入れなければ物価上昇率と同じ",
          address: () => ({ target: { plan: "assumptions" }, item, at: ["landGrowth", "default"] }),
          // 空欄は物価上昇率と同じ（推定。見せる値は物価上昇率）
          get: (w) => {
            const raw = w.request.input.assumptions?.realEstateValuation?.landGrowth?.default;
            const inf = w.request.input.assumptions?.inflation?.default ?? null;
            if (raw === undefined) return { value: inf, estimated: "物価上昇率と同じ" };
            return inf !== null && sameRate(raw, inf) ? { value: raw, estimated: "物価上昇率と同じ" } : { value: raw };
          },
          set: (w, v) => {
            const sp: SeriesPlace = { path: [R, "landGrowth"], item };
            const cur = seriesAt(w, sp);
            if (v !== null) return writeSeries(w, sp, { ...cur, default: String(v) });
            if (cur?.byYear === undefined) return writeSeries(w, sp, undefined);
            return writeSeries(w, sp, { ...cur, default: w.request.input.assumptions?.inflation?.default ?? "0" });
          },
        }),
        est(
          plain({
            key: "assume/realEstate/landShare",
            item,
            label: "土地の割合",
            level: "detail",
            kind: "pct",
            min: 0,
            max: 100,
            find,
            path: [R, "landShare"],
            optional: true,
            fallback: VALUATION_DEFAULTS.landShare,
            help: "物件に入れていないときに使います。目安は3割（土地付きの注文住宅の土地の取得費の全国の割合）。地域で大きく違うので物件ごとに直します",
          }),
          "目安（土地付きの注文住宅の土地の割合）",
        ),
        ...BUILDING_STRUCTURES.map((o) =>
          est(
            plain({
              key: `assume/realEstate/life/${o.value}`,
              item,
              label: `耐用年数: ${o.label}`,
              level: "detail",
              kind: "int",
              suffix: "年",
              min: 1,
              max: 100,
              find,
              path: [R, "usefulLife", o.value],
              optional: true,
              fallback: USEFUL_LIFE[o.value] ?? 22,
              help: "建物はこの年数で定額で減らします（目安は住宅用の建物の法定耐用年数）",
            }),
            "目安（住宅用の建物の法定耐用年数）",
          ),
        ),
        est(
          plain({
            key: "assume/realEstate/floor",
            item,
            label: "建物の残りの価値の下限",
            level: "detail",
            kind: "pct",
            min: 0,
            max: 100,
            find,
            path: [R, "residualFloor"],
            optional: true,
            fallback: VALUATION_DEFAULTS.residualFloor,
            help: "建てた時の価値に対する割合。目安は2割（固定資産の評価で古い家屋の価値を下げる下限と同じ）",
          }),
          "目安（固定資産の評価の下限と同じ）",
        ),
        est(
          plain({
            key: "assume/realEstate/saleCost",
            item,
            label: "売却の費用（売却価格に対する割合）",
            level: "detail",
            kind: "pct",
            find,
            path: [R, "saleCostRate"],
            optional: true,
            fallback: VALUATION_DEFAULTS.saleCostRate,
            help: "仲介手数料（上限は価格の3%＋6万円と消費税）・印紙税・登記などの目安",
          }),
          "目安（仲介手数料の上限・印紙税・登記）",
        ),
      ],
      actions: [ex.add],
    },
    ...ex.groups,
  ];
}

// ---- 表の最後の年（0070） ----

/** 本人・配偶者（表の最後の年を年齢で入れる人） */
const adultsOf = (h: Household) => h.members.filter((m) => m.kind === "self" || m.kind === "spouse");

/** 表の最後の年が標準から大きく外れているときの中身（endYearOff） */
export interface EndYearOff {
  /** 今の表の最後の年 */
  end: number;
  /** 既定（標準）の年 */
  std: number;
  /** 大人（本人・配偶者）のその年の年齢（例: 「ご本人129歳・配偶者128歳」） */
  ages: string;
}

/**
 * 表の最後の年が、若い方の大人の年齢で 85〜105歳の外か（古い世帯・前の版の見本の写しの確かめの注意。黙って直さない）。
 * 外なら中身、内なら null
 */
export function endYearOff(wh: WorkingHousehold): EndYearOff | null {
  const h = wh.request.input.household;
  const end = wh.request.input.endYear;
  const std = standardEndYear(h);
  const ad = adultsOf(h);
  if (!Number.isFinite(std) || ad.length === 0 || end === std) return null;
  const young = ad.reduce((a, b) => (a.birth.birthYearMonth > b.birth.birthYearMonth ? a : b));
  const age = ageInYear(young, end);
  if (age <= 105 && age >= 85) return null;
  return { end, std, ages: ad.map((m) => `${memberLabel(wh, m.id)}${ageInYear(m, end)}歳`).join("・") };
}

/** 表の最後の年の注意の文（前提条件の欄の注意と確かめの一覧。外れていなければ null） */
export function endYearNotice(wh: WorkingHousehold): string | null {
  const o = endYearOff(wh);
  return o === null ? null : `表の最後の年が${o.end}年（${o.ages}）です。既定（${o.std}年）にしますか`;
}

/** 表の最後の年を既定（標準）にする（注意の「既定（○年）にする」） */
export function endYearToStandard(wh: WorkingHousehold): WorkingHousehold {
  return mutate(wh, (h, req) => {
    const std = standardEndYear(h);
    if (Number.isFinite(std)) req.input.endYear = std;
  });
}

/** プランを直している間に表の最後の年の欄の下に出す一言（どのプランにも共通。0043 の追記 2026-11-05） */
export const END_YEAR_SHARED = "どのプランにも共通です（変えると現状と全部のプランが変わります）";

/** 既定の年の根拠の文（提供元の100歳か、事務所の既定値の年齢） */
const defaultEndText = (): string => {
  const a = defaultEndAge();
  return a === STANDARD_END_AGE ? `既定の値（ご本人・配偶者のうち若い方が${a}歳になる年）` : `事務所の既定値（ご本人・配偶者のうち若い方が${a}歳になる年）`;
};

function endYearFields(wh: WorkingHousehold): FieldDef[] {
  // 表の最後の年は計算基準月の年より前にできない（前にすると計算エンジンが止まる〔E_ARGUMENT endYear〕）。欄の下限をその年にする
  const baseYear = Number(wh.request.input.baseMonth.slice(0, 4));
  const address = (): Address => ({
    target: { plan: "input" },
    item: "plan.endYear",
    at: [],
  });
  const agesText = (w: WorkingHousehold, v: number) =>
    adultsOf(w.request.input.household)
      .map((m) => `${memberLabel(w, m.id)} ${ageInYear(m, v)}歳`)
      .join("・");
  // 何歳まで見るかの選び方（若い方の大人がその年齢になる年まで。標準の欄。0070 の追記 2026-11-05）。選んだ年齢は年にして持つ
  // （家族を直すと、その年齢のまま付いていく。household.ts の followStandards）。選び方の外の年は「その他」と見せ、詳細の欄で入れる
  const adults = adultsOf(wh.request.input.household);
  const who = adults.length === 1 && adults[0] !== undefined ? memberLabel(wh, adults[0].id) : "若い方";
  const choice = field({
    key: "assume/endYear/choice",
    item: null,
    label: `表を何歳まで見るか（${who}の年齢）`,
    level: "simple",
    kind: "select",
    options: [
      ...END_AGES.map((a) => ({ value: String(a), label: `${a}歳まで${a === defaultEndAge() ? "（既定）" : ""}` })),
      ...(endAgeOf(wh.request.input.household, wh.request.input.endYear) === null ? [{ value: "other", label: `その他（${wh.request.input.endYear}年まで）` }] : []),
    ],
    planShared: END_YEAR_SHARED,
    help: `ご本人・配偶者のうち若い方が、その年齢になる年までの表にします（既定は${defaultEndAge()}歳）。家族の生年月を直すと、同じ年齢のまま年が変わります。ほかの年齢・年は「調整率・表の最後の年を決める」の欄で入れます`,
    get: (w) => {
      const v = w.request.input.endYear;
      const age = endAgeOf(w.request.input.household, v);
      const ages = agesText(w, v);
      return {
        value: age === null ? "other" : String(age),
        hint: `${v}年まで${ages !== "" ? `（${ages}の年）` : ""}`,
        // 選び方の外の年は「その他」と見せる（選び方から選ぶと、その年齢の年に変わる。戻すには年・年齢の欄で入れ直す）
        ...(age === null ? { derived: "選び方の年齢の外の年です（年・年齢は「調整率・表の最後の年を決める」の欄で入れます）" } : {}),
      };
    },
    set: (w, v) => {
      if (v === null || v === "other") return w;
      const y = endYearForAge(w.request.input.household, Number(v));
      if (!Number.isFinite(y) || y === w.request.input.endYear) return w;
      return mutate(w, (_h, req) => {
        req.input.endYear = y;
      });
    },
  });
  const endYear = field({
    key: "assume/endYear",
    item: "plan.endYear",
    label: "表の最後の年",
    // 標準（若い方が100歳）でほぼ足りるので詳細（0078）。何歳まで見るかは標準の選び方で選ぶ
    level: "detail",
    kind: "int",
    suffix: "年",
    min: baseYear,
    max: 2200,
    optional: true,
    blankIsEstimate: true,
    address,
    planShared: END_YEAR_SHARED,
    help: `既定は、ご本人・配偶者のうち若い方が${defaultEndAge()}歳になる年（推定のままなら、家族の生年月を直すと合わせて変わります。確定にすると変わりません）。空にすると既定に戻します`,
    get: (w) => {
      const h = w.request.input.household;
      const std = standardEndYear(h);
      const v = w.request.input.endYear;
      const ages = agesText(w, v);
      const notice = endYearNotice(w);
      return {
        value: v,
        hint: Number.isFinite(std) ? `${v === std ? "既定の年" : `既定は ${std}年`}${ages !== "" ? `（${ages}の年）` : ""}` : ages !== "" ? `${ages}の年` : null,
        ...(Number.isFinite(std) && v === std ? { estimated: defaultEndText() } : {}),
        ...(notice !== null
          ? {
              warn: notice,
              warnFix: { label: `既定（${std}年）にする`, run: endYearToStandard },
            }
          : {}),
      };
    },
    set: (w, v) =>
      mutate(w, (h, req) => {
        const std = standardEndYear(h);
        if (v !== null) req.input.endYear = Number(v);
        else if (Number.isFinite(std)) req.input.endYear = std;
      }),
  });
  // 人の年齢で入れる（「配偶者が［100］歳になる年まで」）。書くと表の最後の年が変わる（値は年だけを持つ）
  const byAge = adults.map((m) =>
    field({
      key: `assume/endYear/age/${m.id}`,
      item: null,
      label: `${memberLabel(wh, m.id)}が何歳になる年まで`,
      // 年で入れる欄と同じく詳細（標準でほぼ足りる。0078）
      level: "detail",
      kind: "int",
      suffix: "歳",
      // 下限は60歳か、計算基準月の年のその人の年齢の高い方（それより下は表の最後の年が計算基準月の年より前になる）
      min: Math.min(120, Math.max(60, ageInYear(m, baseYear))),
      max: 120,
      planShared: END_YEAR_SHARED,
      help: "年齢で入れると、その人がその年齢になる年を表の最後の年にします",
      get: (w) => {
        const x = w.request.input.household.members.find((y) => y.id === m.id);
        return {
          value: x === undefined ? null : ageInYear(x, w.request.input.endYear),
        };
      },
      set: (w, v) =>
        mutate(w, (h, req) => {
          const x = h.members.find((y) => y.id === m.id);
          if (x !== undefined && v !== null) req.input.endYear = Number(x.birth.birthYearMonth.slice(0, 4)) + Number(v);
        }),
    }),
  );
  return [choice, endYear, ...byAge];
}

/** 計算の決まり（読むだけ。0003 の7） */
function conventionFields(): FieldDef[] {
  const AGG: Record<string, string> = {
    cash: "お金が出入りした月で数える（現金の出入り）",
    accrual: "発生した月で数える",
  };
  const TIMING: Record<string, string> = {
    midYear: "1年の運用益は、その年の出入りが年の真ん中にあったとして計算する",
    beginning: "年の初めにあったとして計算する",
    end: "年の終わりにあったとして計算する",
  };
  const ro = (key: string, label: string, read: (w: WorkingHousehold) => string) =>
    field({
      key,
      item: null,
      label,
      level: "detail",
      kind: "text",
      readOnly: "計算の決まりです（変えられません）",
      get: (w) => ({ value: read(w) }),
      set: (w) => w,
    });
  const conv = (w: WorkingHousehold) =>
    (w.request.input.calcConventions ?? {}) as {
      aggregation?: string;
      investmentTiming?: string;
    };
  return [
    ro("assume/conv/aggregation", "計算の決まり: お金の数え方", (w) => AGG[conv(w).aggregation ?? ""] ?? conv(w).aggregation ?? "—"),
    ro("assume/conv/timing", "計算の決まり: 運用益の数え方", (w) => TIMING[conv(w).investmentTiming ?? ""] ?? conv(w).investmentTiming ?? "—"),
  ];
}

/** 推定のままの経済の前提の数（カードの上の1行に使う） */
export function standardCount(wh: WorkingHousehold): number {
  const a = wh.request.input.assumptions;
  const rows = (wh.request.input as { valueStates?: Record<string, unknown> }).valueStates ?? {};
  return Object.entries(STANDARD).filter(([name, v]) => {
    const s = a?.[name] as YearSeries | undefined;
    return s !== undefined && sameRate(s.default, v) && rows[`assumptions.${name}/default`] === undefined;
  }).length;
}

export function assumptionsStage(wh: WorkingHousehold): StageDef {
  const have = new Set(Object.keys(wh.request.input.assumptions?.assetReturns ?? {}));
  const baseMonth = field({
    key: "assume/baseMonth",
    item: "plan.baseMonth",
    label: "計算の基準の月",
    level: "detail",
    kind: "ym",
    help: "この月から計算します。入れる額は、この月の年の値段で入れます（物価で伸ばす額は、この年から伸びます）",
    readOnly: "見直しの版（現状の版を積む）ができてから変えられます",
    get: (w) => ({ value: w.request.input.baseMonth }),
    set: (w) => w,
  });
  const series: [string, string, string, "simple" | "detail"][] = [
    ["inflation", "物価上昇率（年）", "基本生活費などの変動率に使います（今の値段で入れた額を、この率で伸ばします）", "simple"],
    ["wageGrowth", "賃金上昇率（年）", "給与の伸び（年齢ごとの昇給カーブとは別。名目の率）", "simple"],
    ["investmentReturn", "運用利回り（年）", "資産の配分を入れていない口座の利回り（費用・税を引く前。長い期間の平均の目安）", "simple"],
    ["educationInflation", "教育費の上昇率（年）", "入れなければ物価上昇率と同じ", "detail"],
    ["pensionMacroSlide", "年金の調整率（基礎年金・年）", "マクロ経済スライドの率。将来の年金額の伸びから差し引く率", "detail"],
    ["pensionMacroSlideEmployee", "年金の調整率（厚生年金・年）", "入れなければ基礎年金の調整率と同じ", "detail"],
  ];
  const exGroups: GroupDef[] = [];
  const exAdds: ActionDef[] = [];
  for (const [name, label] of series) {
    const fol = FOLLOWS[name];
    const fb = fol !== undefined ? ((getPath(wh.request.input.assumptions, [fol.name, "default"]) as string | undefined) ?? "0") : (STANDARD[name] ?? "0");
    const ex = exceptionGroups(wh, `assume/${name}`, { path: [name], item: `assumptions.${name}` }, label.replace(/（.*$/, ""), fb, SERIES_RANGES[name] ?? GROWTH_RANGE);
    exGroups.push(...ex.groups);
    exAdds.push(ex.add);
  }
  const std = standardCount(wh);
  const shifts = shiftFields(wh);
  const sections: SectionDef[] = [
    {
      key: "assume/main",
      title: "経済の前提",
      note: `${std > 0 ? `前提は既定の値（仮の値）で計算中です（${std}つ）。` : ""}事務所の既定値（設定）はまだありません。入れる額は計算の基準の年の値段で、物価で伸びます`,
      level: "simple",
      groups: [
        {
          key: "assume/main/fields",
          level: "simple",
          moreLabel: "調整率・表の最後の年を決める",
          // 運用利回りは率をそのまま入れる（名前の付いた選び方のボタンは置かない。0070 の 2026-10-31 の追記）
          fields: [...series.map(([n, l, h, lv]) => seriesField(n, l, h, lv)), ...endYearFields(wh), baseMonth, ...conventionFields()],
          actions: [],
        },
      ],
      actions: [],
    },
    ...(shifts.length > 0
      ? [
          {
            key: "assume/shifts",
            title: "結果のタブで動かした利回り・金利",
            note: "結果のタブの「運用の利回り」「変動金利の上昇」で動かした前提です。口座の利回り・ローンの金利の欄の値は変えずに、計算でこの幅を足します。動かすのは結果のタブで",
            level: "simple" as const,
            groups: [{ key: "assume/shifts/list", level: "simple" as const, fields: shifts, actions: [] }],
            actions: [],
          },
        ]
      : []),
    {
      key: "assume/exceptions",
      title: "例外の年（経済の前提）",
      note: "決まった年だけ違う率にします（例: 2026〜2028年は物価3%）。続いた年で同じ率は1つの範囲にまとめて見せます。ふだんの年の率を直しても、例外の年はそのままです",
      level: "detail",
      groups: exGroups,
      actions: exAdds,
    },
    {
      key: "assume/realEstate",
      title: "持ち家の評価",
      note: "土地は上昇率で動き、建物は構造の耐用年数で定額で減らします。入れなければ推定で計算します",
      level: "detail",
      groups: valuationGroups(wh),
      actions: [],
    },
    {
      key: "assume/assetReturns",
      title: "資産の種類ごとの利回り",
      note: "貯蓄・運用の項目の資産配分と同じ値です（どちらで直しても同じ）。利回りは費用・税を引く前の年率",
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
            const a = (request.input.assumptions ??= {
              investmentReturn: { default: "0.01" },
            });
            (a.assetReturns ??= {})[o.value] = {
              default: o.value.startsWith("cash") ? "0.001" : "0.03",
            };
            return { ...w, request };
          },
        })),
    },
    ...feeSections(wh),
  ];
  return {
    id: "assumptions",
    label: "前提条件",
    lead: "物価・賃金・運用利回りなどの前提と、表の最後の年、FP顧問料。顧客ごとに変えられます。入れる額は計算の基準の年の値段です。",
    sections,
  };
}
