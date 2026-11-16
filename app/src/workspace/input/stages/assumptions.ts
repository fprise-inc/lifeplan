// 10. 前提条件（0070）: 物価上昇率・賃金上昇率・運用利回り・教育費の上昇率・年金のマクロ経済スライド（基礎・厚生）の年ごとの列の既定の値と
// 例外の年（0008 の8・0040）、資産の種類ごとの利回り（と例外の年）、持ち家の評価の前提（土地の上昇率の例外の年を含む）、表の最後の年
// （年か人の年齢で）・計算の基準の月と計算の決まり（読むだけ）、FP顧問料（単発・継続・料金の段階。stages/fees.ts）。
// - 前提条件の既定の値のある欄（経済の前提・不動産の評価・資産の種類ごとの利回り）は、事務所の既定値と比較して「事務所の既定値」
//   「この世帯だけ」と見せる（推定にしない。0214。input/premiseDefaults.ts）。空欄にすると事務所の既定値に戻る
// - 高すぎる値の注意の線（運用利回りが年5%を超える・物価が0%未満か4%を超える・賃金が物価を2ポイント超えて上回る・資産の種類ごとの
//   利回りが年8%を超える）は、欄の知らせと確かめの一覧の注意に出す（値は変えない）
// - 表の最後の年は、標準（本人・配偶者のうち若い方が100歳〔事務所の既定値で選んだ年齢〕になる年）と同じなら「事務所の既定値」（推定にしない。
//   0214 の追記 2026-11-16 の2）、人と年齢で選んだ・年で決めたなら「この世帯だけ」。年で決めたら家族の生年月を直しても追いかけない。
//   古い世帯で若い方が表の最後の年に105歳を超える（か85歳に届かない）ときは、確かめの注意に「標準にする」を出す（押したときだけ直す）
// - 表の最後の年はどのプランにも共通（世帯で1つ。プランの差分にしない。0043 の追記 2026-11-05）。何歳まで見るかは、標準の1つの欄
//   「表を何歳まで見るか」で「ご本人が95歳まで」「配偶者が100歳まで（既定）」「年で決める…」のように選ぶ（0070 の追記 2026-11-13）
// - お客さまと確かめる前提（物価の上昇率・給与の上昇率・運用の利回り・表を何歳まで見るか）は最初の区画に、標準・詳細のどちらでもたたまずに出し、
//   欄の下に FP がお客さまに話すときの一言（欄の値で言い換わる）を添える。FP が決める細かい前提と計算の決まりは詳細だけで、入力のパネルが
//   1行にたたむ（PREMISE_FOLD_SECTIONS。0214 の追記 2026-11-16）
// 黒字のうち貯まる割合（0031）は、顧客と一緒に見る基本生活費のカードへ移した（stages/surplusSaving.ts。0031 の追記）
import type { Household, Member, ReturnShift, YearSeries } from "../../../engine/types.ts";
import { ageInYear } from "../../roles.ts";
import { parseYm } from "../../levers.ts";
import type { Address } from "../../store/readings.ts";
import { field, getPath, plain, sameVal, type ActionDef, type FieldDef, type FieldState, type GroupDef, type Option, type PremiseMark, type SectionDef, type StageDef, type Val } from "../form.ts";
import { DEFAULT_ASSUMPTIONS, defaultEndAge, END_AGES, endYearRuleOf, firstTableYear, memberEndYear, MIN_TABLE_YEARS, mutate, STANDARD_END_AGE, standardEndYear, withEndYearChoice, type EndYearRule, type WorkingHousehold } from "../household.ts";
import { ASSET_CLASSES, BUILDING_STRUCTURES, memberLabel, USEFUL_LIFE, VALUATION_DEFAULTS } from "../labels.ts";
import { putRow } from "../rows.ts";
import { sameRate, ymWithEra } from "../units.ts";
import { cmpRate, pctText } from "../../plans/decimal.ts";
import { feeSections } from "./fees.ts";
import { followsHint, ownsRealEstate, PREMISE_DEFS, premiseAddress, TALK_PREMISES, premiseMark, premiseOfKey, premiseShown, premiseValue, resetPremise, typePremise, type PremiseDef } from "../premiseDefaults.ts";
import { GROWTH_RANGE, RETURN_RANGE, SLIDE_RANGE, type PctRange } from "../rateRanges.ts";
import { presetNum } from "../../../../../hearing/src/presets.ts";

type Obj = Record<string, unknown>;
type Assumptions = NonNullable<WorkingHousehold["request"]["input"]["assumptions"]>;

/** 不動産の評価の区画の名前（持ち家だけでなく、収益不動産・貸していない不動産の計算にも使う） */
export const REAL_ESTATE_SECTION = "不動産の評価（持ち家・収益不動産など）";


/** 経済の前提の標準の値（新しい世帯に入れる値と同じ。household.ts の DEFAULT_ASSUMPTIONS） */
const STANDARD: Readonly<Record<string, string>> = {
  inflation: DEFAULT_ASSUMPTIONS.inflation.default,
  wageGrowth: DEFAULT_ASSUMPTIONS.wageGrowth.default,
  investmentReturn: DEFAULT_ASSUMPTIONS.investmentReturn.default,
  depositReturn: DEFAULT_ASSUMPTIONS.depositReturn.default,
  pensionMacroSlide: DEFAULT_ASSUMPTIONS.pensionMacroSlide.default,
};

/** 経済の前提の列の範囲（0098。例外の年の率も同じ範囲） */
const SERIES_RANGES: Readonly<Record<string, PctRange>> = {
  inflation: GROWTH_RANGE,
  wageGrowth: GROWTH_RANGE,
  educationInflation: GROWTH_RANGE,
  investmentReturn: RETURN_RANGE,
  depositReturn: RETURN_RANGE,
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
  if (name === "investmentReturn" && v > ret) return `運用の利回りが年${pct(ret)}を超えています（事務所の注意の線）。長い期間の平均として高すぎないか確かめてください`;
  if (name === "inflation" && (v < 0 || v > inf)) return `物価の上昇率が0%未満か${pct(inf)}を超えています（事務所の注意の線）`;
  if (name === "wageGrowth") {
    const inf = num(a?.inflation?.default ?? null) ?? 0;
    if (v - inf > 0.02) return "給与の上昇率が物価の上昇率を2ポイント超えて上回っています（事務所の注意の線）";
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

// ---- お客さまと確かめる前提の一言（0214 の追記 2026-11-16）: FP がお客さまに話すときの言葉。欄の値で言い換わる ----

/** 率の文字の大きさ（符号を外す） */
const absRate = (r: string): string => r.replace(/^-/, "");
/** 100万円を年 r で n 年伸ばした額（万円。丸めた整数） */
const grown = (base: number, r: number, n: number): number => Math.round(base * Math.pow(1 + r, n));

/** 物価の上昇率の一言（30年後の100万円が今のいくらの値打ちか） */
export function inflationTalk(r: string): string {
  const v = Number(r);
  if (v === 0) return "物価が変わらないとすると、30年後の100万円も、今の100万円と同じ値打ちです";
  const now = Math.round(100 / Math.pow(1 + v, 30));
  return `物価が年${pctText(absRate(r))}${v > 0 ? "上がる" : "下がる"}と、30年後の100万円は、今の約${now}万円の値打ちになります`;
}

/** 給与の上昇率の一言（今の年収500万円が20年後にいくらか。物価の上昇率と比較して、暮らし向きがどうなる計算か） */
export function wageTalk(r: string, inflation: string | null): string {
  const v = Number(r);
  const head = v === 0 ? "給与が変わらないとすると、今の年収500万円は20年後も500万円のままです" : `給与が年${pctText(absRate(r))}${v > 0 ? "上がる" : "下がる"}と、今の年収500万円は20年後に約${grown(500, v, 20)}万円になります`;
  if (inflation === null) return head;
  const gap = Math.round((v - Number(inflation)) * 10000) / 100;
  if (gap === 0) return `${head}（物価の上昇率と同じなので、暮らし向きは今と同じ計算です）`;
  return `${head}（物価の上昇率より${String(Math.abs(gap))}ポイント${gap > 0 ? "高いので、暮らし向きは少しずつ良くなる" : "低いので、暮らし向きは少しずつ苦しくなる"}計算です）`;
}

/** 運用の利回りの一言（100万円が10年後・20年後にいくらか。運用の費用を引いた後の率で、税は計算で引く） */
export function returnTalk(r: string): string {
  const v = Number(r);
  if (v === 0) return "運用で増えないとすると、100万円は10年後も20年後も100万円のままです";
  return `年${pctText(absRate(r))}${v > 0 ? "で運用できる" : "ずつ減る"}と、100万円は10年後に約${grown(100, v, 10)}万円、20年後に約${grown(100, v, 20)}万円になります（運用の費用を引いた後、税を引く前の額）`;
}

/** 表を何歳まで見るかの一言（何年分のお金の流れを見るか） */
export function endYearTalk(wh: WorkingHousehold): string {
  const first = firstTableYear(wh.request.input.baseMonth);
  const end = wh.request.input.endYear;
  return `${String(first)}年から${String(end)}年まで、${String(Math.max(1, end - first + 1))}年分のお金の流れを見ます。長生きしても、暮らしのお金が足りるかを確かめるためです`;
}

/** 欄の一言（お客さまと確かめる前提の3つの率だけ。ほかは無し） */
function talkOf(name: string, rate: string, wh: WorkingHousehold): { talk?: string } {
  if (name === "inflation") return { talk: inflationTalk(rate) };
  if (name === "wageGrowth") return { talk: wageTalk(rate, (getPath(assumptionsOf(wh), ["inflation", "default"]) as string | undefined) ?? null) };
  if (name === "investmentReturn") return { talk: returnTalk(rate) };
  return {};
}

/**
 * 年ごとの列の既定の値（default）の欄（経済の前提）。値は事務所の既定値（0214）と比較して「事務所の既定値」「この世帯だけ」と見せ、推定にしない。
 * 空欄にすると事務所の既定値に戻る（教育費・厚生年金の調整率は、事務所で決めていなければ物価・基礎年金の調整率と同じ）
 */
function seriesField(name: string, label: string, help: string, level: "simple" | "detail"): FieldDef {
  const sp: SeriesPlace = { path: [name], item: `assumptions.${name}` };
  const def = premiseOfKey(`assume/${name}`) as PremiseDef;
  const follows = FOLLOWS[name];
  const address = (): Address => premiseAddress(def);
  const seriesState = (wh: WorkingHousehold): FieldState => {
    const s = seriesAt(wh, sp);
    const a = assumptionsOf(wh);
    const ex = s?.byYear !== undefined ? Object.keys(s.byYear).length : 0;
    const derived = ex > 0 ? `例外の年 ${ex}年（「詳細」の「例外の年」で直します）` : null;
    const warn = rateWarning(name, a);
    const mark = premiseMark(def, wh);
    const premise = mark !== null ? { premise: mark } : {};
    // ほかの前提と同じ値になる前提（教育費・厚生年金の調整率）で値が無い: 空欄で、横に「物価上昇率と同じ（1.0%）」
    if (follows !== undefined && s === undefined) return { value: null, hint: followsHint(def, wh), derived, warn, ...premise };
    // 預金の利回りの無い前の要求（変換の段を通らない計算の要求の写しなど）は空欄で、計算は運用利回りと同じと添える（入れるとその率。0137）
    if (s === undefined && name === "depositReturn") {
      const inv = (getPath(a, ["investmentReturn", "default"]) as string | undefined) ?? null;
      return { value: null, hint: `空欄（運用利回りと同じ${inv !== null ? ` ${pctText(inv)}` : ""}で計算しています）`, derived, warn, ...premise };
    }
    if (s === undefined) return { value: null, hint: "入れない（0%で計算）", derived, warn, ...premise, ...talkOf(name, "0", wh) };
    return { value: s.default, derived, warn, ...premise, ...talkOf(name, s.default, wh) };
  };
  return field({
    key: `assume/${name}`,
    item: sp.item,
    label,
    level,
    kind: "pct",
    ...SERIES_RANGES[name],
    optional: true,
    help,
    address,
    get: (wh): FieldState => {
      const st = seriesState(wh);
      // 預金の利回り: 資産の種類ごとの利回りに預金・外貨預金があれば、その種類はそちらで計算する（0137）
      const a = assumptionsOf(wh);
      const own = name === "depositReturn" ? ASSET_CLASSES.filter((o) => o.value.startsWith("cash.") && a?.assetReturns?.[o.value] !== undefined) : [];
      return own.length === 0 ? st : { ...st, hint: `${own.map((o) => `${o.label}は「資産の種類ごとの利回り」の${o.label}（${pctText(a?.assetReturns?.[o.value]?.default ?? "0")}）`).join("、")}で計算しています` };
    },
    // 空欄: 事務所の既定値に戻す。打った値: 事務所の既定値と同じなら「事務所の既定値」、違えば「この世帯だけ」（premiseDefaults.ts）
    set: (wh, v) => (v === null ? resetPremise(def, wh) : typePremise(def, wh, String(v))),
  });
}

/** 前提条件の事務所の既定値の欄にする（plain の欄の値の読み書きを、事務所の既定値と比較して見せる形に。0214） */
function premised(f: FieldDef, def: PremiseDef): FieldDef {
  const put = (w: WorkingHousehold, v: Val) => (v === null || v === "" ? resetPremise(def, w) : typePremise(def, w, String(v)));
  return {
    ...f,
    address: () => premiseAddress(def),
    get: (w) => {
      const st = f.get(w);
      const mark = premiseMark(def, w);
      // 写したときの仮の印は「事務所の既定値に従う」の印で、推定ではない（印は見せ方の premise で出す）
      return mark === null ? st : { ...st, assumed: null, premise: mark };
    },
    set: (w, v) => (sameVal(f.get(w).value, v, f.kind) ? w : put(w, v)),
    write: put,
  };
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

/**
 * 例外の年の見出し・足すボタンの括弧の中の名前: 欄の名前から「（年）」を外す。括弧の中に区別がある欄（年金の調整率の基礎年金・厚生年金）は
 * 区別を残す（「年金の調整率（基礎年金・年）」→「年金の調整率・基礎年金」）
 */
export const exceptionWhat = (label: string): string => label.replace(/（年）$/, "").replace(/（(.+)・年）$/, "・$1");

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

/**
 * 資産の種類ごとの利回り（0214 の4）: 12種類を全部、不動産の評価と同じ3列の小さな欄の並びで出す。空欄は計算と同じ値（預金・外貨預金は預金の利回り、
 * 不動産は0%、ほかは運用利回り）を見せ、空にすると事務所の既定値に戻る。この世帯だけ値を入れた種類には例外の年を足せる
 */
function assetReturnSection(wh: WorkingHousehold): { groups: GroupDef[]; actions: ActionDef[] } {
  const defs = PREMISE_DEFS.filter((d) => d.section === "assetReturns");
  const fields = defs.map((def) => {
    const cls = def.path[1] as string;
    return field({
      key: def.key,
      item: "assumptions.assetReturns",
      label: def.label,
      level: "detail",
      kind: "pct",
      ...RETURN_RANGE,
      optional: true,
      address: () => premiseAddress(def),
      // 不動産は、資産配分の種類でなく、貸していない不動産（空き家・土地・別荘）の値動きに使う（事務所の既定値で写すこともある。0073 の追記 2026-11-07）
      ...(cls === "realEstate" ? { help: "貯蓄・運用の貸していない不動産（空き家・土地・別荘など）の値動きです（外すと0%）。貯蓄・運用の入力項目で、物ごとに「評価額の増減率（年）」を入れると、その物はそちらを使います。入れていない物は、この値を使います。持ち家・収益不動産には使いません" } : { help: `資産の配分に${def.label}を入れた口座の、${def.label}の利回りです${cls.startsWith("cash.") ? `（配分の無い${def.label}の口座にも使います）` : ""}。貯蓄・運用の入力項目で、口座ごとに「利回り（年）」を入れると、その口座はそちらを使います。入れていない口座は、この値を使います` }),
      get: (w): FieldState => {
        const shown = premiseShown(def, w);
        const mark = premiseMark(def, w);
        const high = shown !== null && Number(shown) > 0.08 ? "年8%を超えています（事務所の注意の線）" : null;
        return { value: shown, hint: high ?? followsHint(def, w), ...(mark !== null ? { premise: mark } : {}) };
      },
      set: (w, v) => (v === null ? resetPremise(def, w) : typePremise(def, w, String(v))),
    });
  });
  const groups: GroupDef[] = [{ key: "assume/assetReturns/grid", level: "detail", fields, actions: [] }];
  const actions: ActionDef[] = [];
  for (const def of defs) {
    if (premiseValue(def, wh) === null) continue;
    const cls = def.path[1] as string;
    const ex = exceptionGroups(wh, `assume/assetReturns/${cls}`, { path: ["assetReturns", cls], item: "assumptions.assetReturns" }, def.label, premiseShown(def, wh) ?? "0", RETURN_RANGE);
    groups.push(...ex.groups);
    actions.push(ex.add);
  }
  return { groups, actions };
}

/** 不動産（持ち家・購入の予定・収益不動産・貸していない不動産）を持つ世帯か。無ければ不動産の評価の区画を出さない（premiseDefaults.ts） */
export { ownsRealEstate };

/**
 * 不動産の評価の前提（assumptions.realEstateValuation。持ち家・収益不動産・貸していない不動産の計算に使う。0025）。値は事務所の既定値（0214）と
 * 比較して見せ、空欄は事務所の既定値に戻る（土地の割合・建物の残りの価値の下限・売却の費用は事務所の推定の値〔0111〕で、空欄ならその場の値）
 */
function valuationGroups(wh: WorkingHousehold): GroupDef[] {
  const find = (_h: Household, w: WorkingHousehold) => w.request.input.assumptions as Record<string, unknown> | undefined;
  const item = "assumptions.realEstateValuation";
  const R = "realEstateValuation";
  const def = (key: string) => premiseOfKey(key) as PremiseDef;
  const ex = exceptionGroups(wh, "assume/realEstate/landGrowth", { path: [R, "landGrowth"], item }, "土地の上昇率", wh.request.input.assumptions?.inflation?.default ?? "0", GROWTH_RANGE);
  const landGrowth = def("assume/realEstate/landGrowth");
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
          help: "持ち家・収益不動産の土地の値動きです（入れなければ物価上昇率と同じ）。収益不動産の入力項目で、物件ごとに「土地の評価額の増減率（年）」を入れると、その物件はそちらを使います。入れていない物件（持ち家はすべて）は、この値を使います。貸していない土地・別荘・空き家には使いません",
          address: () => premiseAddress(landGrowth),
          // 値が無ければ物価上昇率と同じ（見せる値は物価上昇率）
          get: (w) => {
            const raw = w.request.input.assumptions?.realEstateValuation?.landGrowth?.default;
            const mark = premiseMark(landGrowth, w);
            return { value: raw ?? null, hint: followsHint(landGrowth, w), ...(mark !== null ? { premise: mark } : {}) };
          },
          set: (w, v) => (v === null ? resetPremise(landGrowth, w) : typePremise(landGrowth, w, String(v))),
        }),
        premised(
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
            help: "物件の価値のうち土地の割合です。住まい・収益不動産の入力項目で、物件ごとに「土地の割合」（購入の予定は「うち土地の値段」）を入れると、その物件はそちらを使います。入れていない物件は、この値を使います",
          }),
          def("assume/realEstate/landShare"),
        ),
        ...BUILDING_STRUCTURES.map((o) =>
          premised(
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
              help: "建物の価値を定額で減らす年数です。どの年数を使うかは、住まい・収益不動産の入力項目の物件ごとの「建物の構造」で決まります。年数は物件ごとには入れられないので、この構造のすべての物件にこの値を使います。収益不動産の減価償却には使いません",
            }),
            def(`assume/realEstate/life/${o.value}`),
          ),
        ),
        premised(
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
            help: "古くなった建物の価値を、これより下げない割合です（建てた時の価値に対して）。物件ごとには入れられないので、すべての物件にこの値を使います",
          }),
          def("assume/realEstate/floor"),
        ),
        premised(
          plain({
            key: "assume/realEstate/saleCost",
            item,
            label: "売却の費用（売却価格に対する割合）",
            level: "detail",
            kind: "pct",
            min: 0,
            max: 100,
            find,
            path: [R, "saleCostRate"],
            optional: true,
            fallback: VALUATION_DEFAULTS.saleCostRate,
            help: "売るときに売却価格から引く費用（仲介手数料・印紙税など）の割合です。住まい・収益不動産・貯蓄・運用の入力項目で、物件ごとに「売却の費用（売却価格に対する割合）」を入れると、その物件はそちらを使います。入れていない物件は、この値を使います",
          }),
          def("assume/realEstate/saleCost"),
        ),
      ],
      actions: [ex.add],
    },
    ...ex.groups,
  ];
}

// ---- 表の最後の年（0070） ----

/** 本人・配偶者（表を何歳まで見るかを選べる人） */
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
 * 外なら中身、内なら null。表を何歳まで見るかの欄の人と年齢の選択肢の年（「ご本人が90歳まで」など。endYearRuleOf が member）には出さない
 * （選択肢から選んだ年。年上の人の年齢で選ぶと若い方が85歳に届かないことがある）。年で決めた年・既定から外れた古い世帯の年には今までどおり出す
 */
export function endYearOff(wh: WorkingHousehold): EndYearOff | null {
  const h = wh.request.input.household;
  const end = wh.request.input.endYear;
  const std = standardEndYear(h, wh.request.input.baseMonth);
  const ad = adultsOf(h);
  if (!Number.isFinite(std) || ad.length === 0 || end === std || endYearRuleOf(wh).kind === "member") return null;
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

/** 表の最後の年の当て先（要求の入力の plan.endYear） */
const END_ADDRESS: Address = { target: { plan: "input" }, item: "plan.endYear", at: [] };

/** 決め方を既定にした世帯（表の最後の年を既定の年にし、確定の行と決め方を外す） */
function toDefault(wh: WorkingHousehold): WorkingHousehold {
  const next = mutate(wh, (h, req) => {
    const std = standardEndYear(h, req.input.baseMonth);
    if (Number.isFinite(std)) req.input.endYear = std;
    putRow(req.input as unknown as Record<string, unknown>, END_ADDRESS, undefined);
  });
  return withEndYearChoice(next, undefined);
}

/** 表の最後の年を既定（標準）にする（注意の「既定（○年）にする」） */
export function endYearToStandard(wh: WorkingHousehold): WorkingHousehold {
  return toDefault(wh);
}

/** プランを直している間に表の最後の年の欄の下に出す一言（どのプランにも共通。0043 の追記 2026-11-05） */
export const END_YEAR_SHARED = "どのプランにも共通です（変えると現状と全部のプランが変わります）";

/**
 * 表を何歳まで見るかの見せ方（ほかのお客さまと確かめる前提と同じ「事務所の既定値」「この世帯だけ」と「事務所の既定値に戻す」。0214 の追記 2026-11-16 の2）。
 * 既定（若い方が既定の年齢〔100歳か事務所の既定値の年齢〕になる年）なら事務所の既定値、人と年齢で選んだ・年で決めたならこの世帯だけ。
 * 推定にしない（推定の数・「この値にする」に入れない）。事務所の年齢を後で変えた世帯は、前の年齢の年が人と年齢で選んだ年と見分けられないので、
 * 「既定値が変わりました」でなく「この世帯だけ」と読む（0073 の追記 2026-11-05 の、表の最後の年には事務所の新しい値の知らせを出さない、のまま）
 */
function endYearMark(wh: WorkingHousehold, rule: EndYearRule): PremiseMark {
  const a = defaultEndAge();
  const std = standardEndYear(wh.request.input.household, wh.request.input.baseMonth);
  const officeText = `ご本人・配偶者のうち若い方が${String(a)}歳になる年${Number.isFinite(std) ? `（${String(std)}年）` : ""}`;
  const decided = a !== STANDARD_END_AGE;
  if (rule.kind === "default") return { id: END_YEAR_PREMISE, state: "office", officeText, decided, reset: endYearToStandard };
  const v = wh.request.input.endYear;
  const wasText = rule.kind === "member" ? `${memberLabel(wh, rule.member)}が${String(rule.age)}歳まで（${String(v)}年）` : `${String(v)}年まで`;
  return { id: END_YEAR_PREMISE, state: "household", officeText, wasText, decided, reset: endYearToStandard };
}

/** 表を何歳まで見るかの見せ方の id（事務所の既定値の欄の表 PREMISE_DEFS には無い。事務所データの置き場所は defaults.endAge） */
export const END_YEAR_PREMISE = "endAge";

/** 選び方の値: 既定・人と年齢（「m:<構成員の ID>:<年齢>」）・年で決める */
const DEFAULT_VALUE = "default";
const YEAR_VALUE = "year";
const memberValue = (id: string, age: number): string => `m:${id}:${String(age)}`;

/** 選択肢1つ（人と年齢の選択肢は、まとめた人〔生まれ年が同じ〕と年齢を持つ） */
interface EndOption extends Option {
  age?: number;
  members?: string[];
}

/**
 * 表を何歳まで見るかの選択肢（0070 の追記 2026-11-13）: ご本人の90・95・100・105歳、配偶者の同じ年齢（配偶者がいるときだけ）、「年で決める…」。
 * 既定（若い方が既定の年齢になる年）は、その人のその年齢の選択肢に「（既定）」を付ける（値は既定）。ご本人と配偶者で同じ年になる年齢
 * （生まれ年が同じ）は「ご本人・配偶者が○歳まで」の1つにまとめる（値は並びの先の人〔ご本人〕）
 */
function endOptions(wh: WorkingHousehold): EndOption[] {
  const h = wh.request.input.household;
  const bm = wh.request.input.baseMonth;
  const adults = adultsOf(h);
  const std = standardEndYear(h, bm);
  const d = defaultEndAge();
  // 既定に当たる人: 若い方（生まれ年が同じなら、並びの先の人）
  const youngest = adults.reduce<Member | undefined>((a, b) => (a === undefined || parseYm(b.birth.birthYearMonth).y > parseYm(a.birth.birthYearMonth).y ? b : a), undefined);
  const out: EndOption[] = [];
  const seen = new Set<string>();
  for (const m of adults) {
    for (const a of END_AGES) {
      const y = memberEndYear(m, a, bm);
      const key = `${String(a)}:${String(y)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const same = adults.filter((x) => memberEndYear(x, a, bm) === y);
      const isDefault = a === d && y === std && same.some((x) => x.id === youngest?.id);
      out.push({
        value: isDefault ? DEFAULT_VALUE : memberValue(m.id, a),
        label: `${same.map((x) => memberLabel(wh, x.id)).join("・")}が${String(a)}歳まで${isDefault ? "（既定）" : ""}`,
        age: a,
        members: same.map((x) => x.id),
      });
    }
  }
  out.push({ value: YEAR_VALUE, label: "年で決める…" });
  return out;
}

/** 表を何歳まで見るかの選択肢（欄の options） */
export const endYearOptions = (wh: WorkingHousehold): Option[] => endOptions(wh).map(({ value, label }) => ({ value, label }));

/** 決め方の選び方の値（endYearRuleOf の決め方から。人と年齢は、その人を含む選択肢〔まとめた選択肢・既定の選択肢〕の値） */
function ruleValue(wh: WorkingHousehold, r: EndYearRule): string {
  if (r.kind !== "member") return r.kind === "default" ? DEFAULT_VALUE : YEAR_VALUE;
  return endOptions(wh).find((o) => o.age === r.age && o.members?.includes(r.member) === true)?.value ?? memberValue(r.member, r.age);
}

function endYearFields(wh: WorkingHousehold): FieldDef[] {
  // 表の最後の年は表の最初の年（計算基準月が年の途中なら翌年）より前にできない（計算基準月の年より前にすると計算エンジンが止まる〔E_ARGUMENT endYear〕。
  // 年の途中の計算基準月の年にすると表が0年になる。0169）。年で決める欄の下限をその年にする
  const firstYear = firstTableYear(wh.request.input.baseMonth);
  const agesText = (w: WorkingHousehold, v: number) =>
    adultsOf(w.request.input.household)
      .map((m) => `${memberLabel(w, m.id)} ${ageInYear(m, v)}歳`)
      .join("・");
  // 何歳まで見るか（0070 の追記 2026-11-05・2026-11-13）: 前は「若い方の年齢」の選び方・年の欄・人ごとの年齢の欄の4つで同じ値を入れていたのを、
  // 人と年齢で選ぶ1つの欄にした。選んだ人と年齢は世帯に持ち（endYearChoice）、その人の生年月を直しても同じ年齢のまま付いていく（followStandards）。
  // 既定は持たない（「事務所の既定値」。家族を直すと若い方の既定の年齢の年に付いていく）。「年で決める…」で入れた年は付いていかない
  const choice = field({
    key: "assume/endYear",
    item: "plan.endYear",
    label: "表を何歳まで見るか",
    level: "simple",
    kind: "select",
    options: endYearOptions(wh),
    address: () => END_ADDRESS,
    planShared: END_YEAR_SHARED,
    help: `ご本人か配偶者が、その年齢になる年までの表にします。既定は、ご本人・配偶者のうち若い方が${defaultEndAge()}歳になる年です（家族の生年月を直すと合わせて変わります）。人と年齢で選ぶと、その人の生年月を直しても同じ年齢のまま年が変わります。「年で決める…」で入れた年は変わりません。すでにその年齢に近い・過ぎているときは、表を${MIN_TABLE_YEARS}年分にします`,
    get: (w) => {
      const v = w.request.input.endYear;
      const rule = endYearRuleOf(w);
      const ages = agesText(w, v);
      const notice = endYearNotice(w);
      const std = standardEndYear(w.request.input.household, w.request.input.baseMonth);
      return {
        value: ruleValue(w, rule),
        hint: `${v}年まで${ages !== "" ? `（${ages}の年）` : ""}`,
        talk: endYearTalk(w),
        premise: endYearMark(w, rule),
        ...(notice !== null
          ? {
              warn: notice,
              warnFix: { label: `既定（${std}年）にする`, run: endYearToStandard },
            }
          : {}),
      };
    },
    set: (w, v) => {
      // 今の決め方と同じ選択肢（年から読んだ決め方を含む）なら世帯を変えない（書き戻しても決め方を書き足さない）
      if (v !== null && String(v) === ruleValue(w, endYearRuleOf(w))) return w;
      if (v === null || v === DEFAULT_VALUE) return toDefault(w);
      if (v === YEAR_VALUE) return withEndYearChoice(w, { by: "year" });
      const m = /^m:(.+):(\d+)$/.exec(String(v));
      const member = m === null ? undefined : adultsOf(w.request.input.household).find((x) => x.id === m[1]);
      if (m === null || member === undefined) return w;
      const age = Number(m[2]);
      const y = memberEndYear(member, age, w.request.input.baseMonth);
      if (!Number.isFinite(y)) return w;
      const next = mutate(w, (_h, req) => {
        req.input.endYear = y;
        putRow(req.input as unknown as Record<string, unknown>, END_ADDRESS, undefined);
      });
      return withEndYearChoice(next, { by: "member", member: member.id, age });
    },
  });
  // 「年で決める…」を選んだときだけ、すぐ下に年を入れる欄を出す（選び方の外の年〔ご本人102歳の年など〕もこの形で見せる）
  if (endYearRuleOf(wh).kind !== "year") return [choice];
  const year = field({
    key: "assume/endYear/year",
    item: null,
    label: "年で決める",
    level: "simple",
    kind: "int",
    suffix: "年",
    min: firstYear,
    max: 2200,
    planShared: END_YEAR_SHARED,
    help: "表の最後の年を年で入れます（家族の生年月を直しても変わりません）。人と年齢で決めるときは、上の欄で選び直します",
    get: (w) => ({ value: w.request.input.endYear }),
    set: (w, v) => {
      // 年から読んだ「年で決める」の年と同じ年を書き戻しても、世帯を変えない
      if (v === null || (Number(v) === w.request.input.endYear && endYearRuleOf(w).kind === "year")) return w;
      const next = mutate(w, (_h, req) => {
        req.input.endYear = Number(v);
      });
      return withEndYearChoice(next, { by: "year" });
    },
  });
  return [choice, year];
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

/** お客さまと確かめる前提の率（物価・給与・運用の利回り。表を何歳まで見るかと同じ最初の区画に出す） */
const TALK: ReadonlySet<string> = new Set(TALK_PREMISES);

/** 前提条件の入力項目で、詳細のときに1行にたたむ区画（FP が決める細かい前提と計算の決まり。0214 の4・その追記 2026-11-16） */
export const PREMISE_FOLD_SECTIONS: ReadonlySet<string> = new Set(["assume/fine", "assume/exceptions", "assume/realEstate", "assume/assetReturns", "assume/conv"]);

/** お客さまと確かめる前提の区画・まとまり・欄のキー（たたまない） */
const TALK_KEY = /^assume\/(main(\/fields)?|inflation|wageGrowth|investmentReturn|endYear(\/year)?)$/;

/**
 * たたむ区画の中の欄・まとまり・区画のキーか（確かめの一覧・検索・前提と推定の一覧からそこへ移るときは、たたんだ1行を開いて出す）。
 * お客さまと確かめる前提・結果のタブで動かした前提・FP顧問料はたたまない
 */
export const inPremiseFold = (key: string | undefined): boolean => key !== undefined && key.startsWith("assume/") && !TALK_KEY.test(key) && !/^assume\/(shifts|returnShifts|loanRateShifts)/.test(key);

export function assumptionsStage(wh: WorkingHousehold): StageDef {
  const baseMonth = field({
    key: "assume/baseMonth",
    item: "plan.baseMonth",
    label: "計算の基準の月",
    level: "detail",
    kind: "text",
    help: "この月から計算します。入れる額は、この月の年の値段で入れます（物価で伸ばす額は、この年から伸びます）",
    readOnly: "見直しの版（現状の版を積む）ができてから変えられます",
    // 欄の外の年月の書き方（「2026年11月・令和8年」。読むだけの欄なので、欄の中の「2026-11」の形にしない）
    get: (w) => ({ value: ymWithEra(w.request.input.baseMonth) }),
    set: (w) => w,
  });
  const series: [string, string, string, "simple" | "detail"][] = [
    ["inflation", "物価の上昇率", "今の値段で入れた額（基本生活費など）を伸ばす率です。各入力項目で、行ごとに「伸び方」を「決まった率で」か「変えない」にすると、その行はそちらを使います。「物価に合わせる」のままの行は、この値を使います", "simple"],
    ["wageGrowth", "給与の上昇率", "給与・事業所得を伸ばす率（名目）です。働き方と収入の入力項目で、働き方ごとに「増減率（年）」を入れると、その働き方はそちらを使います。入れていない働き方は、この値を使います（昇給カーブを使う働き方にも、この率を掛けます）", "simple"],
    ["investmentReturn", "運用の利回り", "預金以外の口座の利回りです（運用の費用を引いた後。税は計算で引きます）。貯蓄・運用の入力項目で、口座ごとに「利回り（年）」か資産の配分を入れると、その口座はそちらを使います。入れていない口座は、この値を使います", "simple"],
    ["depositReturn", "預金の利回り（年）", "預金・外貨預金と、合計の入れ方の運用しない分の利回りです（資産配分の現金も同じ）。「資産の種類ごとの利回り」に預金・外貨預金を足すと、その種類はそちらを使います（口座ごとに「利回り（年）」を入れた口座も、そちら）。入れていない物は、この値を使います", "detail"],
    ["educationInflation", "教育費の上昇率（年）", "入れなければ物価上昇率と同じ", "detail"],
    ["pensionMacroSlide", "年金の調整率（基礎年金・年）", "マクロ経済スライドの率。将来の年金額の伸びから差し引く率", "detail"],
    ["pensionMacroSlideEmployee", "年金の調整率（厚生年金・年）", "入れなければ基礎年金の調整率と同じ", "detail"],
  ];
  const exGroups: GroupDef[] = [];
  const exAdds: ActionDef[] = [];
  for (const [name, label] of series) {
    const fol = FOLLOWS[name];
    const fb = fol !== undefined ? ((getPath(wh.request.input.assumptions, [fol.name, "default"]) as string | undefined) ?? "0") : (STANDARD[name] ?? "0");
    const ex = exceptionGroups(wh, `assume/${name}`, { path: [name], item: `assumptions.${name}` }, exceptionWhat(label), fb, SERIES_RANGES[name] ?? GROWTH_RANGE);
    exGroups.push(...ex.groups);
    exAdds.push(ex.add);
  }
  const shifts = shiftFields(wh);
  const assetReturns = assetReturnSection(wh);
  const seriesField1 = ([n, l, h, lv]: (typeof series)[number]) => seriesField(n, l, h, lv);
  const sections: SectionDef[] = [
    // お客さまと確かめる前提（物価・給与・運用の利回り・表を何歳まで見るか）: 標準・詳細のどちらでも、たたまずにいつも出す（0214 の追記 2026-11-16）
    {
      key: "assume/main",
      title: "お客さまと確かめる前提",
      note: "面談でお客さまと一緒に見て、この世帯で変えるべき所があれば、話しながら変えます。値は事務所の既定値の画面で決めた値です（欄の横に「事務所の既定値」）。この世帯だけ変えた欄は「この世帯だけ」と出て、「事務所の既定値に戻す」で戻せます。欄の下の一言は、お客さまに話すときの言い方の例です（値を変えると、その値で言い換わります）。入れる額は計算の基準の年の値段で、物価で伸びます",
      level: "simple",
      groups: [
        {
          key: "assume/main/fields",
          level: "simple",
          // 運用利回りは率をそのまま入れる（名前の付いた選び方のボタンは置かない。0070 の 2026-10-31 の追記）
          fields: [...series.filter(([n]) => TALK.has(n)).map(seriesField1), ...endYearFields(wh)],
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
    // ここから下（FP が決める細かい前提と計算の決まり）は、詳細のときだけ、ふだんは1行にたたんで出す（PREMISE_FOLD_SECTIONS。入力のパネル）
    {
      key: "assume/fine",
      title: "預金の利回り・年金の調整率など",
      note: "FP が決める前提です。値は事務所の既定値の画面で決めた値で、この世帯だけ変えた欄は「この世帯だけ」と出ます",
      level: "detail",
      groups: [{ key: "assume/fine/fields", level: "detail", fields: series.filter(([n]) => !TALK.has(n)).map(seriesField1), actions: [] }],
      actions: [],
    },
    {
      key: "assume/exceptions",
      title: "例外の年（経済の前提）",
      note: "決まった年だけ違う率にします（例: 2026〜2028年は物価3%）。続いた年で同じ率は1つの範囲にまとめて見せます。ふだんの年の率を直しても、例外の年はそのままです",
      level: "detail",
      groups: exGroups,
      actions: exAdds,
    },
    // 持ち家・収益不動産・貸していない不動産のどれも無い世帯では出さない（使わない前提を見せない）
    ...(ownsRealEstate(wh)
      ? [
          {
            key: "assume/realEstate",
            title: REAL_ESTATE_SECTION,
            note: "持ち家・収益不動産の土地は上昇率で動き、建物は構造の耐用年数で定額で減らします（物件ごとに入れた値があればそちら）。空欄は事務所の既定値で計算します",
            level: "detail" as const,
            groups: valuationGroups(wh),
            actions: [],
          },
        ]
      : []),
    {
      key: "assume/assetReturns",
      title: "資産の種類ごとの利回り",
      note: "貯蓄・運用の項目の資産配分と同じ値です（どちらで直しても同じ）。資産の種類ごとの利回りは、信託報酬などの運用の費用を引く前の年率です（費用は資産配分の信託報酬で引きます。税は計算で引きます）。運用利回り・預金の利回りは費用を引いた後の率です",
      level: "detail",
      groups: assetReturns.groups,
      actions: assetReturns.actions,
    },
    {
      key: "assume/conv",
      title: "計算の基準の月と計算の決まり",
      level: "detail",
      groups: [{ key: "assume/conv/fields", level: "detail", fields: [baseMonth, ...conventionFields()], actions: [] }],
      actions: [],
    },
    ...feeSections(wh),
  ];
  return {
    id: "assumptions",
    label: "前提条件",
    lead: "お客さまと面談で一緒に確かめる前提（物価・給与・運用の利回り・表を何歳まで見るか）と、FP が決める細かい前提（詳細）、FP顧問料。値は事務所の既定値で、この世帯で変えるべき所があれば話しながら変えます。入れる額は計算の基準の年の値段です。",
    sections,
  };
}
