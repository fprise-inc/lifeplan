// 事務所の既定値の画面を7つの画面に分ける（0261）: 画面の並びと名前・左の目次の要約・保存していない変更と直す所の数え方・
// 全部の画面をまとめて保存する中身（事務所データの形は変えない。0073・0111・0121 の置き場所のまま）。
// 画面の部品（OfficeSettingsPanel.tsx）から切り離して、テストで確かめられるようにする
import { CLASSES } from "../input/savings/model.ts";
import { STANDARD_END_AGE } from "../input/household.ts";
import { PREMISE_DEFS, premiseOfId, type PremiseDef } from "../input/premiseDefaults.ts";
import { FEE_RANGE, RETURN_RANGE } from "../input/rateRanges.ts";
import { DEFAULT_LAYOUT } from "../input/items.ts";
import { normalProtection, type ProtectionSetting } from "../contingency/premiseChoice.ts";
import { officeDisplayOf } from "../settings.ts";
import { checkBase } from "../../presentation/theme.ts";
import { STANDARD_BASE } from "../../presentation/theme.ts";
import type { OfficeBranding } from "./branding.ts";
import { estimateEntries } from "./estimateCatalog.ts";
import { EMPTY_ESTIMATES, withOfficeValue, withoutOfficeValue, type OfficeEstimates } from "./estimates.ts";
import { estimateValue, feeFromTexts, feeKey, feePreset, feeTexts, feeYenFromText, hasReturnPreset, mixKey, officeMixFromTexts, pctToRate, premiseFromText, premiseTextKey, protectionAge, retKey, retPreset, settingTexts, type FeeTexts } from "./formText.ts";
import { layoutOf, withEstimates, withOfficeAssetMix, withOfficePremise, type OfficeSettings } from "./settings.ts";

import { OFFICE_PAGES, type OfficePageId } from "./pageNames.ts";
export { isOfficePage, OFFICE_PAGES, officePageName, type OfficePageId } from "./pageNames.ts";

/** 目次で線を引く所（この数の画面の後ろ） */
export const OFFICE_PAGES_TOP = 3;

/** 初めて開いたときの画面 */
export const FIRST_OFFICE_PAGE: OfficePageId = "premises";

/** 前回の画面（アプリを開いている間だけ覚える。保存はしない） */
let lastPage: OfficePageId | null = null;
export const lastOfficePage = (): OfficePageId | null => lastPage;
export function rememberOfficePage(p: OfficePageId): void {
  lastPage = p;
}
/** テスト用: 覚えた画面を忘れる */
export function forgetOfficePage(): void {
  lastPage = null;
}

/** 開く画面: 呼ぶ側の指定（AI の案・知らせから開いたとき）、無ければ前回の画面、初めては前提条件の既定値。出していない画面なら前提条件の既定値 */
export function openingPage(asked: OfficePageId | undefined, shown: readonly OfficePageId[]): OfficePageId {
  const want = asked ?? lastPage ?? FIRST_OFFICE_PAGE;
  return shown.includes(want) ? want : FIRST_OFFICE_PAGE;
}

/** 画面で変えている途中の値（全部の画面の分。保存すると事務所データと事務所の見た目に書く） */
export interface OfficeDraft {
  /** 事務所の既定値（並び・対策・表示の設定・万一・介護・相続・表の最後の年・料金表の払い方・機能の印など。欄の文字から作る値は保存のときに入れる） */
  s: OfficeSettings;
  /** 率・年数・年齢の欄の文字（前提条件・資産配分の割合と信託報酬・評価の割合・必要保障額の年齢） */
  texts: Record<string, string>;
  /** 料金表の額と段階の欄の文字 */
  fee: FeeTexts;
  /** 事務所の推定の値と推定で埋めない入力欄 */
  est: OfficeEstimates;
  /** 事務所の見た目（名前・ロゴ・基調の色。見た目の区画が無い画面では null） */
  brand: OfficeBranding | null;
}

/** 保存した値から、変えていない状態の下書き */
export const draftOf = (v: OfficeSettings, brand: OfficeBranding | null): OfficeDraft => ({ s: v, texts: settingTexts(v), fee: feeTexts(v.fee), est: v.estimates ?? EMPTY_ESTIMATES, brand });

const json = (x: unknown): string => JSON.stringify(x ?? null);

/** 率の欄の文字が同じ値か（「1」と「1.0」は同じ。読めない文字は違う） */
function samePremise(d: PremiseDef, a: string, b: string): boolean {
  const x = premiseFromText(d, a);
  const y = premiseFromText(d, b);
  if (x === undefined || y === undefined) return a.trim() === b.trim();
  return x === y || (x !== null && y !== null && Number(x) === Number(y));
}
function samePct(a: string, b: string, lo: number, hi: number): boolean {
  const x = pctToRate(a, lo, hi);
  const y = pctToRate(b, lo, hi);
  if (x === undefined || y === undefined) return a.trim() === b.trim();
  return x === y || (x !== null && y !== null && Number(x) === Number(y));
}

/** 文字の欄から作った必要保障額の数え方（読めない年齢は undefined） */
export function protectionFrom(p: ProtectionSetting, texts: Readonly<Record<string, string>>): ProtectionSetting | undefined {
  const ha = p.horizon?.kind === "age" ? protectionAge(texts.horizonAge, false) : null;
  const ra = p.protection?.method === "reverse" ? protectionAge(texts.reverseAge, true) : null;
  if (ha === undefined || ra === undefined) return undefined;
  return normalProtection({
    ...(p.horizon !== undefined ? { horizon: { kind: p.horizon.kind, ...(ha !== null ? { age: ha } : {}) } } : {}),
    ...(p.protection?.method === "reverse" ? { protection: { method: "reverse", ...(ra !== null ? { reverseUntilAge: ra } : {}) } } : {}),
  });
}

/** 見た目が同じか（名前・基調の色・ロゴ） */
export const sameBranding = (a: OfficeBranding, b: OfficeBranding): boolean => (a.name ?? "") === (b.name ?? "") && (a.color ?? STANDARD_BASE) === (b.color ?? STANDARD_BASE) && (a.logo?.data ?? "") === (b.logo?.data ?? "");

/** 画面ごとの保存していない変更の数（か所）。カスタム層は押すとすぐ効くので数えない */
export function pageChanges(base: OfficeDraft, d: OfficeDraft): Record<OfficePageId, number> {
  const t = (k: string) => d.texts[k] ?? "";
  const b = (k: string) => base.texts[k] ?? "";
  // 前提条件の既定値: 率・年数の欄・資産配分の割合と信託報酬・評価の割合・表の最後の年
  let premises = PREMISE_DEFS.filter((x) => !samePremise(x, t(premiseTextKey(x)), b(premiseTextKey(x)))).length;
  premises += CLASSES.filter((c) => !samePct(t(mixKey(c.key)), b(mixKey(c.key)), 0, 100)).length;
  premises += CLASSES.filter((c) => !samePct(t(feeKey(c.key)), b(feeKey(c.key)), FEE_RANGE.min, FEE_RANGE.max)).length;
  premises += CLASSES.filter((c) => hasReturnPreset(c.key) && !samePct(t(retKey(c.key)), b(retKey(c.key)), RETURN_RANGE.min, RETURN_RANGE.max)).length;
  if (!samePct(t("realEstateRatio"), b("realEstateRatio"), 0, 100)) premises++;
  if ((d.s.endAge ?? STANDARD_END_AGE) !== (base.s.endAge ?? STANDARD_END_AGE)) premises++;
  // FP顧問料の料金表
  let fee = 0;
  const sameYen = (x: string, y: string) => {
    const a = feeYenFromText(x);
    const c = feeYenFromText(y);
    return a !== undefined && c !== undefined ? a === c : x.trim() === y.trim();
  };
  if (!sameYen(d.fee.oneTime, base.fee.oneTime)) fee++;
  if (!sameYen(d.fee.amount, base.fee.amount)) fee++;
  const steps = (f: FeeTexts) => json(f.steps.map((x) => ({ year: x.year.trim(), amount: feeYenFromText(x.amount) ?? x.amount })));
  if (steps(d.fee) !== steps(base.fee)) fee++;
  if (d.s.fee.per !== base.s.fee.per) fee++;
  if (d.s.fee.onContingency !== base.s.fee.onContingency) fee++;
  // 推定の値（値ごと・推定で埋めない欄ごと）
  const ids = new Set([...Object.keys(d.est.values), ...Object.keys(base.est.values)]);
  let estimates = [...ids].filter((id) => json(d.est.values[id]) !== json(base.est.values[id])).length;
  estimates += [...new Set([...d.est.noFill, ...base.est.noFill])].filter((x) => d.est.noFill.includes(x) !== base.est.noFill.includes(x)).length;
  // 入力の画面
  let input = 0;
  if (json(layoutOf(d.s)) !== json(layoutOf(base.s))) input++;
  if (json(d.s.items) !== json(base.s.items)) input++;
  if (json(d.s.living) !== json(base.s.living)) input++;
  if (json(d.s.care) !== json(base.s.care)) input++;
  if (d.s.inheritLikelihood !== base.s.inheritLikelihood) input++;
  // 結果と万一の画面
  let results = 0;
  if (json(d.s.levers) !== json(base.s.levers)) results++;
  if (json(officeDisplayOf(d.s.display)) !== json(officeDisplayOf(base.s.display))) results++;
  if (json(d.s.scenes) !== json(base.s.scenes)) results++;
  if (json(d.s.premises) !== json(base.s.premises)) results++;
  const prot = protectionFrom(d.s.protection, d.texts);
  if (prot === undefined || json(prot) !== json(protectionFrom(base.s.protection, base.texts) ?? base.s.protection)) results++;
  // 事務所の見た目と機能
  let look = 0;
  if (d.brand !== null && base.brand !== null) {
    if ((d.brand.name ?? "").trim() !== (base.brand.name ?? "").trim()) look++;
    if ((d.brand.color ?? STANDARD_BASE) !== (base.brand.color ?? STANDARD_BASE)) look++;
    if ((d.brand.logo?.data ?? "") !== (base.brand.logo?.data ?? "")) look++;
  }
  if (d.s.features.combinedBs !== base.s.features.combinedBs) look++;
  return { premises, fee, estimates, input, results, look, custom: 0 };
}

/** 画面ごとの直す所の数（読めない・範囲の外の欄。あると保存できない） */
export function pageProblems(d: OfficeDraft): Record<OfficePageId, number> {
  const t = (k: string) => d.texts[k] ?? "";
  let premises = PREMISE_DEFS.filter((x) => premiseFromText(x, t(premiseTextKey(x))) === undefined).length;
  if (pctToRate(t("realEstateRatio"), 0, 100) === undefined) premises++;
  if (officeMixFromTexts(d.texts) === undefined) premises++;
  premises += CLASSES.filter((c) => pctToRate(t(feeKey(c.key)), FEE_RANGE.min, FEE_RANGE.max) === undefined).length;
  premises += CLASSES.filter((c) => hasReturnPreset(c.key) && pctToRate(t(retKey(c.key)), RETURN_RANGE.min, RETURN_RANGE.max) === undefined).length;
  const fee = feeFromTexts(d.s.fee, d.fee) === null ? 1 : 0;
  const results = protectionFrom(d.s.protection, d.texts) === undefined ? 1 : 0;
  const look = d.brand !== null && !checkBase(d.brand.color ?? STANDARD_BASE).ok ? 1 : 0;
  return { premises, fee, estimates: 0, input: 0, results, look, custom: 0 };
}

/** 変えた・直す所のある画面の一覧の文（「前提条件の既定値（2か所）・入力の画面（1か所）」。無ければ空） */
export function pagesText(counts: Readonly<Record<OfficePageId, number>>): string {
  return OFFICE_PAGES.filter((p) => counts[p.id] > 0)
    .map((p) => `${p.name}（${counts[p.id]}か所）`)
    .join("・");
}

/** 事務所の既定値（事務所データの defaults）として保存する中身。見た目は別に保存する（0121 の置き場所） */
export function settingsToSave(d: OfficeDraft, today: string): OfficeSettings {
  // 前提条件の既定値（0214）: 写す物は事務所の既定値に、土地の割合など3つは事務所の推定の値に（変えた物だけ。変えていない値の年月は変えない）
  let withPremises: OfficeSettings = d.s;
  let est = d.est;
  for (const x of PREMISE_DEFS) {
    const r = premiseFromText(x, d.texts[premiseTextKey(x)] ?? "");
    if (r === undefined) continue;
    if (x.live === undefined) withPremises = withOfficePremise(withPremises, x.id, r);
    else {
      const cur = estimateValue({ ...d.s, estimates: est }, x.live);
      if (r === cur || (r !== null && cur !== null && Number(r) === Number(cur))) continue;
      est = r === null ? withoutOfficeValue(est, x.live) : withOfficeValue(est, x.live, r, null, today);
    }
  }
  // 資産の種類ごとの割合（0252）と、種類ごとの信託報酬・期待リターンの目安（事務所の推定の値。変えた物だけ）
  const mix = officeMixFromTexts(d.texts);
  if (mix !== undefined) withPremises = withOfficeAssetMix(withPremises, mix);
  const putEstimate = (id: string, r: string | null | undefined) => {
    if (r === undefined) return;
    const cur = estimateValue({ ...d.s, estimates: est }, id);
    if (r === cur || (r !== null && cur !== null && Number(r) === Number(cur))) return;
    est = r === null ? withoutOfficeValue(est, id) : withOfficeValue(est, id, r, null, today);
  };
  for (const c of CLASSES) {
    putEstimate(feePreset(c.key), pctToRate(d.texts[feeKey(c.key)] ?? "", FEE_RANGE.min, FEE_RANGE.max));
    if (hasReturnPreset(c.key)) putEstimate(retPreset(c.key), pctToRate(d.texts[retKey(c.key)] ?? "", RETURN_RANGE.min, RETURN_RANGE.max));
  }
  const ratio = pctToRate(d.texts.realEstateRatio ?? "", 0, 100);
  const layout = layoutOf(d.s);
  const sameLayout = JSON.stringify(layout) === JSON.stringify(DEFAULT_LAYOUT);
  return withEstimates(
    { ...withPremises, layout: sameLayout ? null : layout, realEstateRatio: typeof ratio === "string" ? ratio : null, fee: feeFromTexts(d.s.fee, d.fee) ?? d.s.fee, protection: protectionFrom(d.s.protection, d.texts) ?? {}, changedOn: today },
    est,
  );
}

/** 左の目次の要約に出す率（「1%」。空欄なら事務所の今の値か提供元の既定の値） */
function premiseShort(d: OfficeDraft, id: string): string {
  const def = premiseOfId(id);
  if (def === undefined) return "";
  const r = premiseFromText(def, d.texts[premiseTextKey(def)] ?? "");
  const v = r === undefined || r === null ? def.standard : r;
  return v === null ? "" : `${Number((Number(v) * 100).toFixed(2))}%`;
}

/** 推定の値の数（前の分け方の値は数えない） */
export const estimateTotal = (): number => estimateEntries().filter((e) => e.legacy !== true).length;

/** 左の目次の要約（今の値か中身。変えている途中の値で作る） */
export function pageSummary(id: OfficePageId, d: OfficeDraft): string {
  switch (id) {
    case "premises":
      return `物価${premiseShort(d, "inflation")}・賃金${premiseShort(d, "wageGrowth")}・${d.s.endAge ?? STANDARD_END_AGE}歳まで`;
    case "fee": {
      const f = feeFromTexts(d.s.fee, d.fee) ?? d.s.fee;
      const man = (yen: number) => `${Number((yen / 10000).toFixed(2))}万円`;
      return `単発${man(f.oneTime)}・${f.per === "month" ? "月" : "年"}${man(f.amount)}${f.steps.length > 0 ? `・段階${f.steps.length}` : ""}`;
    }
    case "estimates":
      return `事務所で変えた値 ${Object.keys(d.est.values).length}件／${estimateTotal()}件`;
    default:
      return OFFICE_PAGES.find((p) => p.id === id)?.about ?? "";
  }
}

/**
 * 前提条件の既定値の画面で変える、事務所の推定の値（置き場所は推定の値のまま。0214 の1・0252）: 土地の割合・建物の残りの価値の下限・売却の費用と、
 * 資産の種類の信託報酬・期待リターンの目安。推定の値の画面では読むだけにして、前提条件の既定値の画面のどの欄で変えるかを返す（欄の名前。無ければ null）
 */
export function premisePageField(estimateId: string): string | null {
  const d = PREMISE_DEFS.find((x) => x.live === estimateId);
  if (d !== undefined) return premiseTextKey(d);
  const m = /^preset\.invest\.(.+)\.(fee|return)$/.exec(estimateId);
  if (m === null || !CLASSES.some((c) => c.key === m[1])) return null;
  return m[2] === "fee" ? feeKey(m[1] as string) : hasReturnPreset(m[1] as string) ? retKey(m[1] as string) : null;
}
