// 事務所の既定値の画面の欄の文字と値の行き来（率・年数・円・料金表・資産配分の割合）。
// 画面の部品（OfficeSettingsPanel.tsx と画面ごとの部品）と、保存していない変更の数え方（pages.ts）が同じ読み方を使う
import { isPresetId } from "../../../../hearing/src/presets.ts";
import { CLASSES } from "../input/savings/model.ts";
import { PREMISE_DEFS, type PremiseDef } from "../input/premiseDefaults.ts";
import { normalizeNumberText, readYen } from "../input/units.ts";
import { FEE_MAX, FEE_STEP_YEAR_MAX, officePremise, type FeeTable, type OfficeSettings } from "./settings.ts";

/**
 * 「1.5」（%）→ "0.015"。空は null。読めない・範囲の外は undefined（整数の部分は3桁まで読む。評価の割合の 100% を入れられるように）。
 * 全角の数字・小数点・マイナスは、入力の画面の率の欄と同じく半角にしてから読む（units.ts の normalizeNumberText。0162）
 */
export function pctToRate(text: string, lo = -5, hi = 20): string | null | undefined {
  const t = normalizeNumberText(text).replace(/[％%]$/, "");
  if (t === "") return null;
  if (!/^-?\d{1,3}(\.\d{1,4})?$/.test(t)) return undefined;
  const v = Number(t);
  if (v < lo || v > hi) return undefined;
  return String(Number((v / 100).toFixed(6)));
}

/** "0.015" → 「1.5」 */
export const rateToPct = (rate: string | null | undefined): string => (rate === null || rate === undefined ? "" : String(Number((Number(rate) * 100).toFixed(4))));

/** 「12,000」（円）→ 12000。空・読めない・範囲の外は undefined */
export function yenFromText(text: string): number | undefined {
  const t = text.trim().replace(/[,，、円]/g, "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (!/^\d{1,8}$/.test(t)) return undefined;
  const v = Number(t);
  return v <= FEE_MAX ? v : undefined;
}

/**
 * 料金表の額の欄（万円）の文字 → 円。入力の画面の FP顧問料の欄と同じ万円で入れる（「30」は30万円、「1.5」は1.5万円。「12,000円」のように円を付ければ円）。
 * 空・読めない・1円未満の端数・範囲の外は undefined
 */
export function feeYenFromText(text: string): number | undefined {
  const r = readYen(text, "man");
  if (!r.ok || !Number.isInteger(r.yen) || r.yen < 0) return undefined;
  return r.yen <= FEE_MAX ? r.yen : undefined;
}

/** 円 → 料金表の額の欄（万円）の文字 */
export const feeManText = (yen: number): string => String(yen / 10000);

/** 料金表の欄の文字（額は万円・段階は年目と額） */
export interface FeeTexts {
  oneTime: string;
  amount: string;
  steps: { year: string; amount: string }[];
}

export const feeTexts = (f: FeeTable): FeeTexts => ({ oneTime: feeManText(f.oneTime), amount: feeManText(f.amount), steps: f.steps.map((x) => ({ year: String(x.year), amount: feeManText(x.amount) })) });

/** 料金表の文字から料金表（読めない欄があれば null） */
export function feeFromTexts(base: FeeTable, t: FeeTexts): FeeTable | null {
  const oneTime = feeYenFromText(t.oneTime);
  const amount = feeYenFromText(t.amount);
  if (oneTime === undefined || amount === undefined) return null;
  const steps: { year: number; amount: number }[] = [];
  for (const x of t.steps) {
    const year = Number(x.year.trim());
    const a = feeYenFromText(x.amount);
    if (!Number.isInteger(year) || year < 2 || year > FEE_STEP_YEAR_MAX || a === undefined || steps.some((y) => y.year === year)) return null;
    steps.push({ year, amount: a });
  }
  steps.sort((a, b) => a.year - b.year);
  return { ...base, oneTime, amount, steps };
}

/** 前提条件の欄の文字の鍵（前提条件の id。欄の data-office-setting にも使う） */
export const premiseTextKey = (d: PremiseDef): string => d.id;

/** 事務所の推定の値で決める前提条件（土地の割合など。0214 の1）の今の事務所の値（率の文字。決めていなければ null） */
export const liveValue = (v: OfficeSettings, d: PremiseDef): string | null => {
  const x = d.live !== undefined ? v.estimates?.values[d.live]?.value : undefined;
  return typeof x === "string" || typeof x === "number" ? String(x) : null;
};

/** 前提条件の欄の文字（率は％、耐用年数は年。決めていなければ空） */
export const premiseInput = (d: PremiseDef, v: string | null): string => (v === null ? "" : d.kind === "int" ? v : rateToPct(v));

/** 前提条件の欄の文字を読む（空は null、読めない・範囲の外は undefined） */
export function premiseFromText(d: PremiseDef, text: string): string | null | undefined {
  if (d.kind === "pct") return pctToRate(text, d.min, d.max);
  const t = normalizeNumberText(text).trim().replace(/年$/, "");
  if (t === "") return null;
  if (!/^\d{1,3}$/.test(t) || Number(t) < d.min || Number(t) > d.max) return undefined;
  return String(Number(t));
}

/** 前提条件の欄の空欄のときの言葉（提供元の既定の値。ほかの値と同じになる物は空） */
export const premisePlaceholder = (d: PremiseDef): string => (d.standard === null ? "" : premiseInput(d, d.standard));

/** 資産配分の資産の種類ごとの割合・信託報酬の欄の文字の鍵（0252。欄の data-office-setting にも使う） */
export const mixKey = (cls: string): string => `assetMix.${cls}`;
export const feeKey = (cls: string): string => `assetFee.${cls}`;
export const retKey = (cls: string): string => `assetRet.${cls}`;
/** 種類の信託報酬の目安の値ID（事務所の推定の値に置く） */
export const feePreset = (cls: string): string => `preset.invest.${cls}.fee`;
/** 種類の期待リターンの目安の値ID（事務所の推定の値に置く。目安の無い種類〔外貨預金〕は無い） */
export const retPreset = (cls: string): string => `preset.invest.${cls}.return`;
/** 期待リターンの目安のある種類か */
export const hasReturnPreset = (cls: string): boolean => isPresetId(retPreset(cls));

/** 事務所の推定の値の今の値（率の文字。決めていなければ null） */
export const estimateValue = (v: OfficeSettings, id: string): string | null => {
  const x = v.estimates?.values[id]?.value;
  return typeof x === "string" || typeof x === "number" ? String(x) : null;
};

/**
 * 資産の種類ごとの割合の欄の文字を読む（0252）: 全部空なら null（提供元の既定＝GPIF の基本ポートフォリオ）、読めない・合計が100%でなければ undefined。
 * 空の種類は入れない（0%と同じ）
 */
export function officeMixFromTexts(texts: Readonly<Record<string, string>>): { assetClass: string; share: string }[] | null | undefined {
  const out: { assetClass: string; share: string }[] = [];
  for (const c of CLASSES) {
    const r = pctToRate(texts[mixKey(c.key)] ?? "", 0, 100);
    if (r === undefined) return undefined;
    if (r !== null && Number(r) > 0) out.push({ assetClass: c.key, share: r });
  }
  if (out.length === 0) return CLASSES.every((c) => (texts[mixKey(c.key)] ?? "").trim() === "") ? null : undefined;
  const total = out.reduce((x, m) => x + Number(m.share), 0);
  return Math.abs(total - 1) < 0.00005 ? out : undefined;
}

/** 資産の種類ごとの割合の欄の合計（％。読めない欄は数えない） */
export const mixTotalPct = (texts: Readonly<Record<string, string>>): number => Math.round(CLASSES.reduce((x, c) => x + Number(pctToRate(texts[mixKey(c.key)] ?? "", 0, 100) ?? 0), 0) * 10000) / 100;

/** 事務所の既定値から、％・年齢の欄の文字 */
export const settingTexts = (v: OfficeSettings): Record<string, string> => ({
  ...Object.fromEntries(PREMISE_DEFS.map((d) => [premiseTextKey(d), premiseInput(d, d.live !== undefined ? liveValue(v, d) : officePremise(v, d.id))])),
  ...Object.fromEntries(CLASSES.map((c) => [mixKey(c.key), rateToPct(v.assetMix?.find((m) => m.assetClass === c.key)?.share ?? (v.assetMix !== undefined ? "0" : null))])),
  ...Object.fromEntries(CLASSES.map((c) => [feeKey(c.key), rateToPct(estimateValue(v, feePreset(c.key)))])),
  ...Object.fromEntries(CLASSES.filter((c) => hasReturnPreset(c.key)).map((c) => [retKey(c.key), rateToPct(estimateValue(v, retPreset(c.key)))])),
  realEstateRatio: rateToPct(v.realEstateRatio),
  horizonAge: String(v.protection.horizon?.age ?? 90),
  reverseAge: v.protection.protection?.reverseUntilAge !== undefined ? String(v.protection.protection.reverseUntilAge) : "",
});

/** 必要保障額の数え方の年齢の欄（50〜110歳。empty なら空欄は null） */
export function protectionAge(t: string | undefined, empty: boolean): number | null | undefined {
  const v = normalizeNumberText(t ?? "").trim();
  if (v === "") return empty ? null : undefined;
  if (!/^\d{2,3}$/.test(v) || Number(v) < 50 || Number(v) > 110) return undefined;
  return Number(v);
}

/** FP顧問料の料金の段階の年目の上限（料金表の決まり。画面の知らせにも使う） */
export { FEE_STEP_YEAR_MAX };
