// 全部のプランを色分けで重ねる表示（提示層の部品）: プランごとの線の色と、凡例。
// 線は全部実線、線の端の印は全部同じ丸にして、色だけで描き分ける（線の種類・印の形を変えると、6本重なったときにかえって読みにくいため）。
// 色だけに頼らないための最低限の手がかりとして、線の右端にプランの文字（A・B…）を出し、基準のプランには「基準」の札を付ける。
// 色はプランごとに決まった番号（colorIndex。0 は現状＝プランA）で引く。基準を変えても、帯の並びを変えても、同じプランは同じ色
// （番号の割り当ては作業の層の band.ts の assignColors）。帯のカードの小さな印・グラフの線・凡例・年の表示で同じ色を使う。
// 受け取るのはプランの名前と数字と色の番号だけ（PlanLineModel。0016 の2）
import type { PlanLineModel } from "./model.ts";
import type { ChartMode } from "./MainChart.tsx";

export interface PlanStyle {
  /** 線の色 */
  color: string;
  /** 読み上げ・説明用の色の名前 */
  colorName: string;
}

/**
 * 色の番号ごとの線の色（0: 現状、1〜5: 帯に並べるプラン）。実線だけで6本を見分けられるように選んだ:
 * - 白地とのコントラスト比はすべて 3:1 以上
 * - 色の見分け方の違い（1型・2型・3型）を模した見え方でも、どの2色も近づきすぎない（色差 ΔE2000 でおよそ 10 以上）
 * - 現状は落ち着いた濃い青灰（ほかの5色より彩度を落として、現状だと分かるように）
 */
export const PLAN_COLOR_STYLES: readonly PlanStyle[] = [
  { color: "#4c5563", colorName: "青灰" },
  { color: "#0072c6", colorName: "青" },
  { color: "#d95f02", colorName: "橙" },
  { color: "#009a5b", colorName: "緑" },
  { color: "#c2309a", colorName: "赤紫" },
  { color: "#2f2380", colorName: "藍" },
];

/** 帯に並べるプランの色の数（現状のほか） */
export const PLAN_COLORS = PLAN_COLOR_STYLES.length - 1;

/** 色の番号の見た目（範囲の外は 1〜5 に折り返す） */
export function colorStyle(index: number): PlanStyle {
  if (index <= 0) return PLAN_COLOR_STYLES[0] as PlanStyle;
  return PLAN_COLOR_STYLES[((index - 1) % PLAN_COLORS) + 1] as PlanStyle;
}

/** プランごとの見た目（鍵 → 見た目）。基準かどうか・帯の順には関わらず、色の番号だけで決まる */
export function planStyles(list: readonly { key: string; colorIndex: number }[]): Map<string, PlanStyle> {
  return new Map(list.map((p) => [p.key, colorStyle(p.colorIndex)]));
}

/** 線の端の印（中心 x・y、大きさ r）。どのプランも同じ丸。白い縁取りで、線が重なっても読める */
export function PlanMarker({ x, y, r, color, cls }: { x: number; y: number; r: number; color: string; cls?: string }) {
  return <circle class={`pl-mk${cls !== undefined ? ` ${cls}` : ""}`} fill={color} stroke="#fff" cx={x.toFixed(1)} cy={y.toFixed(1)} r={r.toFixed(1)} />;
}

/** 小さな見本（実線＋真ん中に丸）。凡例・帯のカード・年の表示で使う */
export function PlanSwatch({ style, w = 34, h = 14 }: { style: PlanStyle; w?: number; h?: number }) {
  return (
    <svg class="pl-sw" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <line x1="1" x2={w - 1} y1={h / 2} y2={h / 2} stroke={style.color} stroke-width="3" />
      <PlanMarker x={w / 2} y={h / 2} r={4.2} color={style.color} />
    </svg>
  );
}

/** グラフの種類ごとに、各プランの何の線を描くか（見出し・凡例・年の表示に出す） */
export const MULTI_WHAT: Record<ChartMode, { lead: string; caption: string; zone: string }> = {
  assets: { lead: "金融資産", caption: "全部のプランの金融資産の推移（色で描き分け）", zone: "0未満は不足" },
  flows: { lead: "年間収支", caption: "全部のプランの年間収支（収入−支出）の線（積み上げの棒は出しません）", zone: "0未満は赤字" },
  balance: { lead: "純資産", caption: "全部のプランの純資産（不動産・その他の資産を含む資産−負債）の線（積み上げの棒は出しません）", zone: "0未満は負債が上回る" },
};

/** そのプランのその種類の線（計算中は null） */
export function lineOf(p: PlanLineModel, mode: ChartMode): readonly number[] | null {
  return mode === "flows" ? p.net : mode === "balance" ? p.netWorth : p.financial;
}

export interface MultiLegendProps {
  plans: PlanLineModel[];
  mode: ChartMode;
  /** カーソルを合わせて強調しているプラン（無ければ null） */
  focus: string | null;
  onFocus: (key: string | null) => void;
  /** 一時的に隠しているプラン */
  hidden: readonly string[];
  onToggle: (key: string) => void;
}

/** 全部のプランを重ねる表示の凡例: 何の線か（見出し）と、プランごとの見本・名前。合わせると強調、クリックで一時的に隠す・戻す */
export function MultiLegend({ plans, mode, focus, onFocus, hidden, onToggle }: MultiLegendProps) {
  const styles = planStyles(plans);
  const what = MULTI_WHAT[mode];
  return (
    <div class="legend main-legend multi-legend" data-multi-legend={mode}>
      <b class="ml-cap" data-multi-caption>
        {what.caption}
      </b>
      <span class="ml-items" role="group" aria-label="プランの線（クリックで一時的に隠す・戻す）">
        {plans.map((p) => {
          const st = styles.get(p.key) as PlanStyle;
          const off = hidden.includes(p.key);
          const wait = lineOf(p, mode) === null;
          return (
            <button
              type="button"
              key={p.key}
              class={`ml-item${off ? " off" : ""}${focus === p.key ? " on" : ""}${p.selected ? " sel" : ""}`}
              aria-pressed={!off}
              disabled={wait}
              title={`${p.name} ${p.title}（${st.colorName}の線）${off ? "。クリックで戻す" : "。クリックで一時的に隠す"}`}
              onMouseEnter={() => onFocus(p.key)}
              onMouseLeave={() => onFocus(null)}
              onFocus={() => onFocus(p.key)}
              onBlur={() => onFocus(null)}
              onClick={() => onToggle(p.key)}
              data-multi-item={p.key}
            >
              <PlanSwatch style={st} />
              <span class="ml-n">{p.name}</span>
              <span class="ml-t">{p.title}</span>
              {p.base ? <span class="ml-tag">基準</span> : null}
              {wait ? <span class="ml-tag wait">計算中</span> : null}
            </button>
          );
        })}
      </span>
      <span class="hint">名前に合わせるとその線を強調、クリックで一時的に隠す・戻す。グラフに合わせるとその年の全部のプランの数字（クリックで固定）。{what.zone}</span>
    </div>
  );
}
