// 表示の設定（タブごとに独立。事務所の設定として持てる形）: 結果のタブの表示の設定（DisplaySettings）と、資産と負債のタブの表示の設定（BalanceSettings）。
// 万一のときのタブには表示の設定が無い（グラフを小窓で出すボタンはグラフの見出しにある）。
// 結果のタブ: 主画面に出す数字を FP が選ぶ。既定では何も足さない（「○歳時点の資産」も出さない。2026-10-17）。
// 選んだ数字は、案の帯のカード・結論の2行目・グラフ（○歳時点の印）に出す。
// グラフの比べ方（基準の案と選んだ案を1つのグラフに重ねるか、左右に2つ並べるか、帯の全部の案を色分けで重ねるか）もここで選ぶ。既定は重ねる。
// 資産と負債のタブ: 家計の体力の目安の幅と、時点を並べるときの既定の時点（と、この世帯で見出しから選んだ時点）、お金の3つの分け方（0032）。
// どちらも世帯ファイルの本文の display に、タブごとの区画（display.result・display.balance）で書く（形式の版 0.8 から。store/body.ts）
import { man, manDiff } from "../presentation/format.ts";
import type { ChartLayout } from "../presentation/MainChart.tsx";
import type { AgeMark, VerdictPart } from "../presentation/model.ts";
import type { EngineRequest } from "../engine/types.ts";
import type { BsColumn, BsGuide, BsPointKey, MoneyThreeSettings } from "../presentation/model.ts";
import { DEFAULT_BS_GUIDE, DEFAULT_BS_POINTS } from "./balanceTab.ts";
import { DEFAULT_MONEY_THREE } from "./moneyThree.ts";
import type { PlanMetrics } from "./plans/compare.ts";
import { targetYearOf } from "./plans/compare.ts";

export type MetricKey = "assetsAtAge" | "takeHome" | "minAssets" | "feeLine";

/** 結果のタブの表示の設定 */
export interface DisplaySettings {
  /** 出す数字（並びは選択肢の順） */
  metrics: MetricKey[];
  /** 「○歳時点の金融資産」の年齢（本人） */
  atAge: number;
  /** グラフの比べ方: 重ねる（既定）／左右に並べる／全部の案を色分けで重ねる */
  layout: ChartLayout;
  /** 資産の推移に口座の内訳を積み上げて出す（0026。既定は出さない） */
  invBreakdown: boolean;
  /** 資産の推移の上に運用の期間の帯を出す（0026。null は「取り崩しの予定があるときだけ」） */
  invPeriods: boolean | null;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = { metrics: [], atAge: 95, layout: "overlay", invBreakdown: false, invPeriods: null };

/** 資産と負債のタブの表示の設定（0027） */
export interface BalanceSettings {
  /** 家計の体力の目安の幅（最初の値は 6〜12か月分・10〜40%・50%未満） */
  guide: BsGuide;
  /** 時点を並べるときの既定の時点（2〜4つ。最初の値は 今・退職の年・75歳） */
  points: BsPointKey[];
  /** この世帯で見出しから選んだ並べる時点（2〜4つ。候補の鍵か決まった年）。null は既定のまま */
  columns: BsColumn[] | null;
  /** お金の3つの分け方（何か月分・何年先まで・呼び方。0032。形式の版 0.13 から） */
  moneyThree: MoneyThreeSettings;
}

export const DEFAULT_BALANCE_SETTINGS: BalanceSettings = { guide: DEFAULT_BS_GUIDE, points: DEFAULT_BS_POINTS, columns: null, moneyThree: DEFAULT_MONEY_THREE };

export const LAYOUT_CHOICES: readonly { key: ChartLayout; label: string; note: string }[] = [
  { key: "overlay", label: "重ねる", note: "1つのグラフに基準のプラン（点線）と選んだプランを重ねる（既定）" },
  { key: "side", label: "左右に並べる", note: "基準のプランと選んだプランを2つのグラフにして並べる。縦の目盛りはそろえる" },
  { key: "all", label: "全部のプランを色分けで重ねる", note: "帯に並べた全部のプラン（現状を含め最大6本）を1つのグラフに、色で描き分ける（プランごとに色が決まっています）。収支は年間収支の線で比べる" },
];

export const METRIC_CHOICES: readonly { key: MetricKey; label: string; note: string }[] = [
  { key: "assetsAtAge", label: "○歳時点の金融資産", note: "年齢を選べます。カード・結論の2行目・グラフの印に出します" },
  { key: "takeHome", label: "生涯の手取りの合計", note: "収入から税・社会保険料を引いた額の、表の期間の合計" },
  { key: "minAssets", label: "金融資産がいちばん少ない年", note: "その年と額" },
  { key: "feeLine", label: "FP顧問料の一文", note: "顧問料を払っても基準より多いか（顧問料の契約がある世帯だけ）" },
];

/** 「○歳時点」の年齢の選択肢 */
export const AGE_OPTIONS: readonly number[] = [60, 65, 70, 75, 80, 85, 90, 95, 100];

export function toggleMetric(s: DisplaySettings, key: MetricKey, on: boolean): DisplaySettings {
  const set = new Set(s.metrics);
  if (on) set.add(key);
  else set.delete(key);
  return { ...s, metrics: METRIC_CHOICES.map((c) => c.key).filter((k) => set.has(k)) };
}

export const shows = (s: DisplaySettings, key: MetricKey) => s.metrics.includes(key);

/** 案の帯のカードに足す数字 */
export function cardMetrics(s: DisplaySettings, m: PlanMetrics | null): { label: string; text: string; neg: boolean }[] {
  if (m === null) return [];
  const out: { label: string; text: string; neg: boolean }[] = [];
  if (shows(s, "assetsAtAge")) out.push({ label: `${s.atAge}歳時点`, text: `${man(m.target)}万円`, neg: m.target < 0 });
  if (shows(s, "takeHome")) out.push({ label: "生涯の手取り", text: `${man(m.takeHome)}万円`, neg: false });
  if (shows(s, "minAssets")) out.push({ label: `いちばん少ない（${m.min.year}年）`, text: `${man(m.min.amount)}万円`, neg: m.min.amount < 0 });
  return out;
}

/** 結論の2行目に足す数字（選んだ案と基準の案。差はいつも「選んだ案−基準」） */
export function verdictMetrics(s: DisplaySettings, sel: { name: string; m: PlanMetrics }, base: { name: string; m: PlanMetrics } | null): VerdictPart[] {
  const parts: VerdictPart[] = [];
  const add = (label: string, a: number, b: number | null) => {
    parts.push({ text: `${parts.length > 0 ? "／" : "\u3000"}${label}: ${sel.name} ${man(a)}万円` });
    if (b !== null && base !== null) parts.push({ text: `・${base.name} ${man(b)}万円（差 ${manDiff(a - b)}万円）` });
  };
  if (shows(s, "assetsAtAge")) add(`${s.atAge}歳時点`, sel.m.target, base?.m.target ?? null);
  if (shows(s, "takeHome")) add("生涯の手取り", sel.m.takeHome, base?.m.takeHome ?? null);
  if (shows(s, "minAssets")) add("いちばん少ない年の金融資産", sel.m.min.amount, base?.m.min.amount ?? null);
  return parts;
}

/** グラフの「○歳時点」の印（○歳時点の金融資産を選んだときだけ） */
export function ageMarkOf(s: DisplaySettings, req: EngineRequest): AgeMark | null {
  if (!shows(s, "assetsAtAge")) return null;
  return { year: targetYearOf(req, s.atAge), label: `${s.atAge}歳` };
}
