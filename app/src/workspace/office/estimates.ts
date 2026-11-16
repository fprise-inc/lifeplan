// 事務所の推定の値（0111）: 空欄・「わからない」を補う推定の元になるマスタデータの値を、事務所の値に置き換える。事務所データの defaults.estimates
// （足すだけの欄。事務所の既定値の画面で変える。カスタム層のファイルでは扱わない。0016 の 2026-11-02 の追記の3）。
// - 推定の目安（hearing/src/estimates.ts など。入力の画面とヒアリングシートの取り込み）は、写しに重ねた事務所の値で作る（setOfficeEstimates）
// - 計算エンジンが計算のときに引く値（介護・学校の費用の目安・平均余命など）には、計算の要求の estimateValues で同じ値を渡す
//   （app/src/engine/officeValues.ts。画面の速い計算と本体の計算は同じ要求の文字列を使うので、両方で同じ値になる）
// - 世帯には写さない（統計の値と同じく、推定の元の値。推定で世帯に入った値は世帯ごとに直せる。変えると、推定のままの値は入れ直しで新しい値になる）
// - 公式の値が新しくなったとき（写しの rev が進んだとき）は、事務所の値を使い続け、知らせを出す（前の公式・新しい公式・事務所の値・出典を並べる。このまま／公式に戻す）
import { officialMasterValue, setOfficeEstimates, type BracketStep, type MasterValue, type OfficeOverride } from "../../../../hearing/src/statistics.ts";
import { FILL_TARGETS } from "../../../../hearing/src/estimates.ts";
import { enginePreset, ENGINE_NO_FILL } from "../../../../engine/src/sdk/estimates.ts";
import { setOfficeEstimateValues } from "../../engine/officeValues.ts";
import type { EngineNoFill, EstimateValue } from "../../engine/types.ts";
import { changeText, estimateEntry, formatNumber, isLegalValue, officialEstimate, sourceText, stepLabel, stepValue, summaryText, type EstimateEntry } from "./estimateCatalog.ts";

export type OfficeValue = MasterValue["value"];

/** 事務所の推定の値の1つ */
export interface OfficeEstimateValue {
  /** 事務所の値（公式の値と同じ形。表は段の数と upTo が同じ。変えていない段は公式の値のまま） */
  value: OfficeValue;
  /** 事務所の根拠の文（FP が書いた文。そのまま出す。書かなければ自動の文「事務所の目安（変えた年月）」） */
  text?: string;
  /** 変えた日（YYYY-MM-DD）。自動の文の後ろの年月 */
  changedOn: string;
  /** 変えたとき（か、公式の値が新しくなって「このまま」を選んだとき）の公式の値の版（写しの rev）と値（知らせの「前の値」） */
  officialRev: number;
  officialValue: OfficeValue;
  /** そのときの公式の値の出典（知らせの「前の出典」。この欄を足す前に変えた値には無い） */
  officialSource?: OfficialSource;
}

/** 公式の値の出典（写しの題名・取得日・原本と照らし合わせたか） */
export interface OfficialSource {
  title: string;
  retrievedAt: string | null;
  reviewed: boolean;
}

const sourceOf = (m: MasterValue): OfficialSource => ({ title: m.title, retrievedAt: m.retrievedAt, reviewed: m.reviewed });

export interface OfficeEstimates {
  /** 値ID → 事務所の値 */
  values: Readonly<Record<string, OfficeEstimateValue>>;
  /** 推定で埋めない入力欄（入力項目ID。hearing の FILL_TARGETS） */
  noFill: readonly string[];
}

export const EMPTY_ESTIMATES: OfficeEstimates = { values: {}, noFill: [] };

/** 根拠の文（事務所の文）の長さの上限 */
export const BASIS_TEXT_MAX = 60;
/** 根拠の文を書かなかったときの自動の文 */
export const AUTO_BASIS = "事務所の目安";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const DECIMAL = /^-?\d+(\.\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 根拠の文を整える（前後の空白・改行を外す。長すぎる文は切る）。空なら null（自動の文） */
export function cleanBasisText(t: string | null | undefined): string | null {
  const s = (t ?? "").replace(/[\r\n\t]+/g, " ").trim();
  return s === "" ? null : s.slice(0, BASIS_TEXT_MAX);
}

/** 変えた年月の文（「2026年11月」） */
export const monthText = (on: string): string => `${on.slice(0, 4)}年${String(Number(on.slice(5, 7)))}月`;

/**
 * 推定の根拠の文: FP が書いた文はそのまま（年月を自動で付けない。年月を入れたいときは文に書く）。書かなかったときは自動の文
 * 「事務所の目安」の後ろに変えた年月を付ける。空にはならない
 */
export const basisOf = (v: Pick<OfficeEstimateValue, "text" | "changedOn">): string => cleanBasisText(v.text) ?? `${AUTO_BASIS}（${monthText(v.changedOn)}）`;

/**
 * 値が公式の値と同じ形か（計算エンジンの決まりと同じ。regulation/reader.ts の sameShape）: 定数は同じ種類（額・月数は0以上の数〔公式が整数なら整数〕、
 * 率は10進の文字）、段階表は段の数と upTo が同じで、額の表は0以上の整数、率の表は10進の文字（公式に値の無い段は入れても入れなくてもよい）
 */
export function sameShape(official: OfficeValue, v: unknown): v is OfficeValue {
  if (typeof official === "number") return typeof v === "number" && Number.isFinite(v) && v >= 0 && (!Number.isInteger(official) || Number.isInteger(v));
  if (typeof official === "string") return typeof v === "string" && DECIMAL.test(v);
  if (!Array.isArray(v) || v.length !== official.length) return false;
  const kind = official.some((s) => s.amount !== undefined) ? "amount" : official.some((s) => s.rate !== undefined) ? "rate" : null;
  if (kind === null) return false;
  return official.every((s, i) => {
    const x = (v as unknown[])[i];
    if (!isObj(x) || x.upTo !== s.upTo || Object.keys(x).some((k) => k !== "upTo" && k !== kind)) return false;
    const val = x[kind];
    if (val === undefined) return true;
    return kind === "amount" ? typeof val === "number" && Number.isInteger(val) && val >= 0 : typeof val === "string" && DECIMAL.test(val);
  });
}

/** 段の並びを、値の無い欄を落とした形にそろえる（保存の前に） */
const tidy = (v: OfficeValue): OfficeValue => (Array.isArray(v) ? (v as readonly BracketStep[]).map((s) => ({ upTo: s.upTo, ...(s.amount !== undefined ? { amount: s.amount } : {}), ...(s.rate !== undefined ? { rate: s.rate } : {}) })) : v);

/**
 * 事務所データの defaults.estimates を読む（読めない値・知らない値ID・法令の値は捨てる。公式の値の形が変わって合わなくなった値も読んで残す〔使わずに知らせる〕）。
 * 推定で埋めない欄は、知っている入力欄だけ
 */
export function readOfficeEstimates(v: unknown): OfficeEstimates {
  if (!isObj(v)) return EMPTY_ESTIMATES;
  const values: Record<string, OfficeEstimateValue> = {};
  if (isObj(v.values))
    for (const [id, x] of Object.entries(v.values)) {
      if (!isObj(x) || isLegalValue(id)) continue;
      const official = officialEstimate(id);
      if (official === null || typeof x.changedOn !== "string" || !DATE.test(x.changedOn) || !Number.isInteger(x.officialRev)) continue;
      const kindOk = (y: unknown) => (Array.isArray(official.value) ? Array.isArray(y) : typeof y === typeof official.value);
      if (!kindOk(x.value) || !kindOk(x.officialValue)) continue;
      const text = typeof x.text === "string" ? cleanBasisText(x.text) : null;
      const src = readSource(x.officialSource);
      values[id] = { value: x.value as OfficeValue, ...(text !== null ? { text } : {}), changedOn: x.changedOn, officialRev: x.officialRev as number, officialValue: x.officialValue as OfficeValue, ...(src !== null ? { officialSource: src } : {}) };
    }
  const known = new Set(FILL_TARGETS.map((t) => t.id));
  const noFill = Array.isArray(v.noFill) ? [...new Set(v.noFill.filter((x): x is string => typeof x === "string" && known.has(x)))].sort() : [];
  return { values, noFill };
}

/** 出典の欄を読む（形が違えば null。知らせでは前の出典を「記録が無い」として出す） */
function readSource(v: unknown): OfficialSource | null {
  if (!isObj(v) || typeof v.title !== "string" || typeof v.reviewed !== "boolean") return null;
  if (v.retrievedAt !== null && (typeof v.retrievedAt !== "string" || !DATE.test(v.retrievedAt))) return null;
  return { title: v.title, retrievedAt: v.retrievedAt, reviewed: v.reviewed };
}

export const isEmptyEstimates = (e: OfficeEstimates | undefined): boolean => e === undefined || (Object.keys(e.values).length === 0 && e.noFill.length === 0);

/** 使える事務所の値か（公式の値と同じ形。公式の表の段の分け方が変わると使えない） */
export const usable = (id: string, v: OfficeEstimateValue): boolean => {
  const o = officialEstimate(id);
  return o !== null && sameShape(o.value, v.value);
};

/** エンジンが置き換えられる値か（マスタデータの値と、エンジンが引く目安。画面・ヒアリングシートだけの目安は渡さない） */
const forEngineValue = (id: string): boolean => officialMasterValue(id) !== null || enginePreset(id) !== undefined;

/** 計算の要求の estimateValues（使える値だけ） */
export function engineValuesOf(e: OfficeEstimates): Record<string, EstimateValue> {
  return Object.fromEntries(Object.entries(e.values).filter(([id, v]) => forEngineValue(id) && usable(id, v)).map(([id, v]) => [id, v.value as EstimateValue]));
}

/** 計算の要求の estimateNoFill（推定で埋めない欄のうち、エンジンが引く統計の目安。入力項目ID の「engine.」の後ろ） */
export function engineNoFillOf(e: OfficeEstimates): EngineNoFill[] {
  return e.noFill.filter((t) => t.startsWith("engine.")).map((t) => t.slice("engine.".length)).filter((k): k is EngineNoFill => (ENGINE_NO_FILL as readonly string[]).includes(k));
}

/** 推定の目安の写しに重ねる値（使える値だけ） */
export function overridesOf(e: OfficeEstimates): Record<string, OfficeOverride> {
  return Object.fromEntries(Object.entries(e.values).filter(([id, v]) => usable(id, v)).map(([id, v]) => [id, { value: v.value, basis: basisOf(v) }]));
}

/** 今の事務所の推定の値を、推定の目安（hearing の写しに重ねる）と計算の要求（engine/officeValues.ts）に入れる */
export function publishOfficeEstimates(e: OfficeEstimates | undefined): void {
  const x = e ?? EMPTY_ESTIMATES;
  setOfficeEstimates(overridesOf(x), x.noFill);
  setOfficeEstimateValues(engineValuesOf(x), engineNoFillOf(x));
}

// ---- 変える・戻す ----

/** 値を事務所の値にする（今の公式の版と値を覚える。公式と同じ値なら事務所の値を外す） */
export function withOfficeValue(e: OfficeEstimates, id: string, value: OfficeValue, text: string | null, on: string): OfficeEstimates {
  const official = officialEstimate(id);
  if (official === null || isLegalValue(id) || !sameShape(official.value, value)) return e;
  const { [id]: _old, ...rest } = e.values;
  void _old;
  const v = tidy(value);
  if (JSON.stringify(v) === JSON.stringify(tidy(official.value))) return { ...e, values: rest };
  const t = cleanBasisText(text);
  return { ...e, values: { ...rest, [id]: { value: v, ...(t !== null ? { text: t } : {}), changedOn: on, officialRev: official.rev, officialValue: official.value, officialSource: sourceOf(official) } } };
}

/** 公式の値に戻す（事務所の値を外す） */
export function withoutOfficeValue(e: OfficeEstimates, id: string): OfficeEstimates {
  if (e.values[id] === undefined) return e;
  const { [id]: _old, ...rest } = e.values;
  void _old;
  return { ...e, values: rest };
}

/**
 * 公式の値が新しくなった値を「このまま」使う（今の公式の版・値・出典を覚え直す。根拠の文・変えた年月は変えない）。
 * 表のうち事務所で変えていない段（前の公式の値のままの段）は、新しい公式の値にする（keptValue）
 */
export function keepOfficeValue(e: OfficeEstimates, id: string): OfficeEstimates {
  const v = e.values[id];
  const official = officialEstimate(id);
  if (v === undefined || official === null) return e;
  return { ...e, values: { ...e.values, [id]: { ...v, value: keptValue(v, official.value), officialRev: official.rev, officialValue: official.value, officialSource: sourceOf(official) } } };
}

/** 同じ段の分け方の表か */
const sameSteps = (a: OfficeValue, b: OfficeValue): boolean =>
  Array.isArray(a) && Array.isArray(b) && a.length === b.length && (a as readonly BracketStep[]).every((s, i) => s.upTo === (b as readonly BracketStep[])[i]?.upTo);

/**
 * 「このまま」を選んだ後の事務所の値: 定数はそのまま。表は、事務所で変えた段（前の公式の値と違う段）はそのまま、変えていない段は新しい公式の値
 * （編集の欄で空欄にした段は「公式の値のまま」の約束なので、公式が新しくなれば新しい値に付いていく）。段の分け方が変わった表はそのまま（使えない）
 */
function keptValue(v: OfficeEstimateValue, official: OfficeValue): OfficeValue {
  if (!sameSteps(v.value, official) || !sameSteps(v.value, v.officialValue)) return v.value;
  const before = v.officialValue as readonly BracketStep[];
  const now = official as readonly BracketStep[];
  return tidy((v.value as readonly BracketStep[]).map((s, i) => (stepValue(s) === stepValue(before[i]) ? (now[i] as BracketStep) : s)));
}

/** 推定で埋めない欄を切り替える */
export function withNoFill(e: OfficeEstimates, target: string, on: boolean): OfficeEstimates {
  const set = new Set(e.noFill);
  if (on) set.add(target);
  else set.delete(target);
  return { ...e, noFill: [...set].sort() };
}

// ---- 公式の値が新しくなった知らせ ----
// FP が「このまま」か「公式に戻す」を決められるよう、何がどう変わったか（前の公式・新しい公式・今の事務所の値・出典）と、押したらどうなるかを持つ

/** 知らせの種類: 公式の値が変わった・値は同じで出典だけ新しくなった・段の分け方が変わって事務所の値を使えない */
export type OfficialUpdateKind = "value" | "source" | "broken";

/** 表の段ごとの行（公式の値が変わった段） */
export interface UpdateStep {
  label: string;
  /** 前の公式の値・新しい公式の値（単位つきの文） */
  before: string;
  after: string;
  /** 今の事務所の値（今の計算に使っている値） */
  office: string;
  /** 事務所で変えた段か（false は前の公式の値のままの段。「このまま」で新しい公式の値になる） */
  officeChanged: boolean;
}

export interface OfficialUpdate {
  id: string;
  /** 画面の名前 */
  name: string;
  kind: OfficialUpdateKind;
  /** 公式の表の段の分け方が変わって、事務所の値を使えなくなった（kind が broken。「公式に戻す」か、値を入れ直す） */
  broken: boolean;
  /** 今の公式の値の版 */
  rev: number;
  /** 公式の値の「前 → 新しい」の要約（表は変わった段を1つと「ほか○段」）。値が同じとき・使えないときは null */
  change: string | null;
  /** 定数の値（表は null）: 前の公式・新しい公式・今の事務所の値 */
  single: { before: string; after: string; office: string } | null;
  /** 表: 公式の値が変わった段 */
  steps: UpdateStep[];
  /** 表: 公式の値は変わっていないが事務所で変えている段（「2人 250,000円」）。使えない表は、前の分け方で事務所が変えていた段 */
  officeSteps: string[];
  /** 使えない表の段の分け方（「6段（1人・2人…）」）。ほかは null */
  layout: { before: string; after: string } | null;
  /** 今の事務所の値のあらまし */
  office: string;
  /** 「このまま」を選んだ後の事務所の値が、新しい公式の値と同じ（どちらを押しても計算は同じ） */
  sameAsOfficial: boolean;
  /** 前の出典（記録が無ければ null）と新しい出典 */
  beforeSource: OfficialSource | null;
  afterSource: OfficialSource;
  /** 出典の何が新しくなったか（「出典の題名」「取得日」「原本との照らし合わせ」）。前の出典の記録が無ければ空 */
  sourceChanges: string[];
  /** 「このまま」（使えないときは「値を入れ直す」）を押したらどうなるか */
  keepText: string;
  /** 「公式に戻す」を押したらどうなるか */
  revertText: string;
  /** どの世帯にどう効くか */
  effect: string;
}

/** 日の文（「2026年10月26日」） */
const dayText = (d: string): string => `${d.slice(0, 4)}年${String(Number(d.slice(5, 7)))}月${String(Number(d.slice(8, 10)))}日`;

/** 出典の1行（「「題名」・2026年10月26日に取得」。原本での確認待ちならそう書く）。題名はデータの読み方の注記を外す */
export function sourceLine(s: OfficialSource): string {
  const parts = [`「${sourceText(s.title).trim()}」`];
  if (s.retrievedAt !== null) parts.push(`${dayText(s.retrievedAt)}に取得`);
  if (!s.reviewed) parts.push("原本での確認待ち");
  return parts.join("・");
}

/** 段の分け方の文（8段までは段の名前を並べる） */
function layoutText(e: EstimateEntry, t: readonly BracketStep[]): string {
  const labels = t.map((_, i) => stepLabel(e.axis, t, i));
  if (labels.length <= 8) return `${t.length}段（${labels.join("・")}）`;
  return `${t.length}段（${labels[0] ?? ""} から ${labels.at(-1) ?? ""} まで）`;
}

/** どの世帯にどう効くか（区画の説明と同じ決まり） */
function effectText(e: EstimateEntry): string {
  if (e.use === "template") return "ボタンで新しく足す行の初めの値に効きます。足してある行は変わりません。";
  if (e.use === "engine") return "世帯に値が無いときの計算の目安として、どの世帯の計算にもすぐ効きます。";
  return "どの世帯でも、これから入れる推定と計算のときの目安にすぐ効きます。世帯に入れてある推定のままの値は、その世帯の入力を直したときに入れ直します。FP が入れた値・確定にした値は変わりません。";
}

/** 1つの値の知らせの中身 */
function updateOf(id: string, v: OfficeEstimateValue, entry: EstimateEntry, official: MasterValue): OfficialUpdate {
  const fmt = (x: number | string | undefined) => formatNumber(entry.unit, x);
  const broken = !usable(id, v);
  const valueChanged = JSON.stringify(official.value) !== JSON.stringify(v.officialValue);
  const kind: OfficialUpdateKind = broken ? "broken" : valueChanged ? "value" : "source";
  const isTable = Array.isArray(official.value);
  const single = !isTable && !Array.isArray(v.value) && !Array.isArray(v.officialValue) ? { before: fmt(v.officialValue as number | string), after: fmt(official.value as number | string), office: fmt(v.value as number | string) } : null;

  const steps: UpdateStep[] = [];
  const officeSteps: string[] = [];
  if (isTable && !broken && sameSteps(official.value, v.officialValue) && sameSteps(official.value, v.value)) {
    const now = official.value as readonly BracketStep[];
    const before = v.officialValue as readonly BracketStep[];
    const office = v.value as readonly BracketStep[];
    now.forEach((s, i) => {
      const label = stepLabel(entry.axis, now, i);
      const officeChanged = stepValue(office[i]) !== stepValue(before[i]);
      if (stepValue(s) !== stepValue(before[i])) steps.push({ label, before: fmt(stepValue(before[i])), after: fmt(stepValue(s)), office: fmt(stepValue(office[i])), officeChanged });
      else if (officeChanged) officeSteps.push(`${label} ${fmt(stepValue(office[i]))}`);
    });
  }
  let layout: OfficialUpdate["layout"] = null;
  if (broken && Array.isArray(v.value) && isTable) {
    const office = v.value as readonly BracketStep[];
    const before = sameSteps(v.value, v.officialValue) ? (v.officialValue as readonly BracketStep[]) : null;
    office.forEach((s, i) => {
      if (before === null || stepValue(s) !== stepValue(before[i])) officeSteps.push(`${stepLabel(entry.axis, office, i)} ${fmt(stepValue(s))}`);
    });
    layout = { before: layoutText(entry, office), after: layoutText(entry, official.value as readonly BracketStep[]) };
  }

  const afterSource = sourceOf(official);
  const beforeSource = v.officialSource ?? null;
  const sourceChanges =
    beforeSource === null
      ? []
      : [beforeSource.title !== afterSource.title ? "出典の題名" : null, beforeSource.retrievedAt !== afterSource.retrievedAt ? "取得日" : null, beforeSource.reviewed !== afterSource.reviewed ? "原本との照らし合わせ" : null].filter((x): x is string => x !== null);

  const sameAsOfficial = !broken && JSON.stringify(tidy(keptValue(v, official.value))) === JSON.stringify(tidy(official.value));
  const followsOfficial = steps.some((s) => !s.officeChanged);
  let keepText: string;
  let revertText: string;
  if (broken) {
    keepText = "「値を入れ直す」: 新しい段の分け方で、事務所の値を入れ直します。入れ直すまでは新しい公式の値で計算します。";
    revertText = "「公式に戻す」: 事務所の値を外します。今も新しい公式の値で計算しているので、計算は変わりません。";
  } else {
    const keep = kind === "source" ? "「確かめた」" : "「このまま」";
    keepText = followsOfficial
      ? `${keep}: 事務所で変えた段はその値を使い続け、事務所で変えていない段は新しい公式の値にします。`
      : `${keep}: 事務所の値${single !== null ? ` ${single.office}` : ""}を使い続けます。今の計算は変わりません。`;
    revertText = `「公式に戻す」: 事務所の値を外し、新しい公式の値${single !== null ? ` ${single.after}` : "の表"}で計算します。推定の根拠は公式の出典になります。`;
    if (sameAsOfficial) keepText += "新しい公式の値と同じ値になるので、どちらを押しても計算は同じです。";
  }
  return {
    id,
    name: entry.name,
    kind,
    broken,
    rev: official.rev,
    change: kind === "value" ? changeText(entry, v.officialValue, official.value) : null,
    single,
    steps,
    officeSteps,
    layout,
    office: summaryText(entry, v.value),
    sameAsOfficial,
    beforeSource,
    afterSource,
    sourceChanges,
    keepText,
    revertText,
    effect: effectText(entry),
  };
}

/**
 * 公式の値が新しくなった（写しの rev か、コードの中の目安の版〔rev〕が、変えたとき・「このまま」を選んだときと違う。版を上げ忘れても、
 * 公式の値そのものが変わっていれば知らせる）事務所の値
 */
export function officialUpdates(e: OfficeEstimates | undefined): OfficialUpdate[] {
  const out: OfficialUpdate[] = [];
  for (const [id, v] of Object.entries(e?.values ?? {})) {
    const official = officialEstimate(id);
    const entry = estimateEntry(id);
    if (official === null || entry === undefined) continue;
    if (official.rev === v.officialRev && JSON.stringify(official.value) === JSON.stringify(v.officialValue) && usable(id, v)) continue;
    out.push(updateOf(id, v, entry, official));
  }
  return out;
}

/** 出典が新しくなった所の文（お知らせの一覧の1行。題名が同じなら取得日などだけ） */
export function sourceChangeText(u: Pick<OfficialUpdate, "beforeSource" | "afterSource">): string {
  const b = u.beforeSource;
  const a = u.afterSource;
  if (b === null) return `新しい出典: ${sourceLine(a)}`;
  if (b.title !== a.title) return `出典: 前 ${sourceLine(b)} → 新しい ${sourceLine(a)}`;
  const parts: string[] = [];
  if (b.retrievedAt !== a.retrievedAt) parts.push(`取得日: 前 ${b.retrievedAt === null ? "記録なし" : dayText(b.retrievedAt)} → 新しい ${a.retrievedAt === null ? "記録なし" : dayText(a.retrievedAt)}`);
  if (b.reviewed !== a.reviewed) parts.push(a.reviewed ? "原本との照らし合わせが済みました" : "原本での確認待ちになりました");
  if (parts.length === 0) parts.push("出典の記録の版が新しくなりました");
  return `${parts.join("。")}。出典は同じ「${sourceText(a.title).trim()}」`;
}
