// 表示の設定（事務所の設定）: 主画面に出す数字を FP が選ぶ。既定では何も足さない（「○歳時点の資産」も出さない。2026-10-17）。
// 事務所の設定として持てる形（0016 の3 の settings/ の宣言型の設定に入れる形）にしてあるが、まだファイルには保存しない（画面の中で持つ）。
// 選んだ数字は、案の帯のカード・結論の2行目・グラフ（○歳時点の印）に出す。
// グラフの比べ方（基準の案と選んだ案を1つのグラフに重ねるか、左右に2つ並べるか、帯の全部の案を色分けで重ねるか）もここで選ぶ。既定は重ねる
import { man, manDiff } from "../presentation/format.ts";
import type { DockMode } from "../presentation/ChartDock.tsx";
import type { ChartLayout } from "../presentation/MainChart.tsx";
import type { AgeMark, VerdictPart } from "../presentation/model.ts";
import type { EngineRequest } from "../engine/types.ts";
import type { PlanMetrics } from "./plans/compare.ts";
import { targetYearOf } from "./plans/compare.ts";

export type { DockMode };

export type MetricKey = "assetsAtAge" | "takeHome" | "minAssets" | "feeLine";

export interface DisplaySettings {
  /** 出す数字（並びは選択肢の順） */
  metrics: MetricKey[];
  /** 「○歳時点の金融資産」の年齢（本人） */
  atAge: number;
  /** グラフの比べ方: 重ねる（既定）／左右に並べる／全部の案を色分けで重ねる */
  layout: ChartLayout;
  /** 操作中はグラフを上に表示（操作の欄までスクロールすると、グラフが画面の上に付いてくる。見通しと万一のときで同じ）: 出さない／小さく／大きく（既定） */
  dock: DockMode;
  /** 資産の推移に口座の内訳を積み上げて出す（0026。既定は出さない） */
  invBreakdown: boolean;
  /** 資産の推移の上に運用の期間の帯を出す（0026。null は「取り崩しの予定があるときだけ」） */
  invPeriods: boolean | null;
}

export const DEFAULT_DISPLAY_SETTINGS: DisplaySettings = { metrics: [], atAge: 95, layout: "overlay", dock: "large", invBreakdown: false, invPeriods: null };

export const DOCK_CHOICES: readonly { key: DockMode; label: string; note: string }[] = [
  { key: "off", label: "出さない", note: "対策・想定の前提までスクロールしても、グラフは付いてきません" },
  { key: "small", label: "小さく", note: "グラフを元の約4割の高さに縮めて付いてこさせます。操作の欄が多く見えます。窓の高さが低いときは出しません" },
  { key: "large", label: "大きく（操作の欄は1行分を残す）", note: "グラフを大きく取り、その下に操作の欄の1行分（つまみ4つ）を残します。隠れた行を動かすと、その行が見えるところまで少しスクロールします" },
];

/** 保存した本文の値を読む（前の版は「上に表示する／しない」の2つ: する→既定、しない→出さない） */
export function readDockMode(v: unknown): DockMode {
  if (v === "off" || v === "small" || v === "large") return v;
  if (v === false) return "off";
  return DEFAULT_DISPLAY_SETTINGS.dock;
}

export const LAYOUT_CHOICES: readonly { key: ChartLayout; label: string; note: string }[] = [
  { key: "overlay", label: "重ねる", note: "1つのグラフに基準のプラン（点線）と選んだプランを重ねる（既定）" },
  { key: "side", label: "左右に並べる", note: "基準のプランと選んだプランを2つのグラフにして並べる。縦の目盛りはそろえる" },
  { key: "all", label: "全部のプランを色分けで重ねる", note: "帯に並べた全部のプラン（現状を含め最大6本）を1つのグラフに、色で描き分ける（プランごとに色が決まっています）。収支は年間収支、資産と負債は純資産の線で比べる" },
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
