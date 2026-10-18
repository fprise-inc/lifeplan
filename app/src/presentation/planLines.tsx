// 全部の案を色分けで重ねる表示（提示層の部品）: 案ごとの線の見た目（色・線の種類・線の端の印）と、凡例。
// 色の見分けにくい人にも区別できるよう、色の見分け方の違いに配慮した配色（白地で 3:1 以上）に、線の種類と印の形を必ず組み合わせる（色だけに頼らない）。
// 基準の案は今の決まりのまま、落ち着いた灰の破線と白抜きの丸。ほかの案は帯の順に、下の並びの見た目を割り当てる
// （帯のカードの小さな印・グラフの線・凡例・年の表示で同じ見た目を使う）。
// 受け取るのは案の名前と数字だけ（PlanLineModel。0016 の2）
import type { PlanLineModel } from "./model.ts";
import type { ChartMode } from "./MainChart.tsx";

export type MarkerShape = "circle" | "square" | "triangle" | "diamond" | "triangleDown" | "ring";

export interface PlanStyle {
  /** 線の色 */
  color: string;
  /** 線の種類（stroke-dasharray。実線は空） */
  dash: string;
  /** 読み上げ・説明用の線の種類の名前 */
  dashName: string;
  marker: MarkerShape;
  base: boolean;
}

/** 基準の案: 落ち着いた灰の破線と白抜きの丸（重ねる表示の基準の案と同じ） */
export const BASE_STYLE: PlanStyle = { color: "#8c96a3", dash: "9 6", dashName: "破線", marker: "ring", base: true };

/** 基準でない案に帯の順で割り当てる見た目（最大5つ）。色・線の種類・印の形をすべて変える */
export const PLAN_STYLES: readonly PlanStyle[] = [
  { color: "#0072B2", dash: "", dashName: "実線", marker: "circle", base: false },
  { color: "#D55E00", dash: "14 5", dashName: "長い破線", marker: "square", base: false },
  { color: "#009E73", dash: "1 6", dashName: "点線", marker: "triangle", base: false },
  { color: "#CC79A7", dash: "12 4 2 4", dashName: "一点鎖線", marker: "diamond", base: false },
  { color: "#1a1d21", dash: "5 4", dashName: "短い破線", marker: "triangleDown", base: false },
];

/** 案（帯の順）ごとの見た目。基準の案は灰の破線、ほかは帯の順に PLAN_STYLES を割り当てる */
export function planStyles(list: readonly { key: string; base: boolean }[]): Map<string, PlanStyle> {
  const out = new Map<string, PlanStyle>();
  let k = 0;
  for (const p of list) {
    if (p.base) out.set(p.key, BASE_STYLE);
    else {
      out.set(p.key, PLAN_STYLES[k % PLAN_STYLES.length] as PlanStyle);
      k++;
    }
  }
  return out;
}

/** 線の端の印（中心 x・y、大きさ r）。白い縁取りで、線が重なっても形が読める */
export function PlanMarker({ shape, x, y, r, color, cls }: { shape: MarkerShape; x: number; y: number; r: number; color: string; cls?: string }) {
  const common = { class: `pl-mk${shape === "ring" ? " ring" : ""}${cls !== undefined ? ` ${cls}` : ""}`, fill: shape === "ring" ? "#fff" : color, stroke: shape === "ring" ? color : "#fff" };
  const f = (n: number) => n.toFixed(1);
  switch (shape) {
    case "square":
      return <rect {...common} x={f(x - r * 0.85)} y={f(y - r * 0.85)} width={f(r * 1.7)} height={f(r * 1.7)} />;
    case "triangle":
      return <path {...common} d={`M${f(x)} ${f(y - r * 1.15)} L${f(x + r * 1.1)} ${f(y + r * 0.8)} L${f(x - r * 1.1)} ${f(y + r * 0.8)} Z`} />;
    case "triangleDown":
      return <path {...common} d={`M${f(x)} ${f(y + r * 1.15)} L${f(x + r * 1.1)} ${f(y - r * 0.8)} L${f(x - r * 1.1)} ${f(y - r * 0.8)} Z`} />;
    case "diamond":
      return <path {...common} d={`M${f(x)} ${f(y - r * 1.25)} L${f(x + r * 1.1)} ${f(y)} L${f(x)} ${f(y + r * 1.25)} L${f(x - r * 1.1)} ${f(y)} Z`} />;
    default:
      return <circle {...common} cx={f(x)} cy={f(y)} r={f(shape === "ring" ? r * 0.85 : r)} />;
  }
}

/** 小さな見本（線の種類＋真ん中に印）。凡例・帯のカード・年の表示で使う */
export function PlanSwatch({ style, w = 34, h = 14 }: { style: PlanStyle; w?: number; h?: number }) {
  return (
    <svg class="pl-sw" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <line x1="1" x2={w - 1} y1={h / 2} y2={h / 2} stroke={style.color} stroke-width="3" stroke-dasharray={style.dash || undefined} stroke-linecap={style.dash.startsWith("1 ") ? "round" : "butt"} />
      <PlanMarker shape={style.marker} x={w / 2} y={h / 2} r={4.2} color={style.color} />
    </svg>
  );
}

/** グラフの種類ごとに、各案の何の線を描くか（見出し・凡例・年の表示に出す） */
export const MULTI_WHAT: Record<ChartMode, { lead: string; caption: string; zone: string }> = {
  assets: { lead: "金融資産", caption: "全部の案の金融資産の推移（色と線の種類で描き分け）", zone: "0未満は不足" },
  flows: { lead: "年間収支", caption: "全部の案の年間収支（収入−支出）の線（積み上げの棒は出しません）", zone: "0未満は赤字" },
  balance: { lead: "純資産", caption: "全部の案の純資産（資産−負債）の線（積み上げの棒は出しません）", zone: "0未満は負債が上回る" },
};

/** その案のその種類の線（計算中は null） */
export function lineOf(p: PlanLineModel, mode: ChartMode): readonly number[] | null {
  return mode === "flows" ? p.net : mode === "balance" ? p.netWorth : p.financial;
}

export interface MultiLegendProps {
  plans: PlanLineModel[];
  mode: ChartMode;
  /** カーソルを合わせて強調している案（無ければ null） */
  focus: string | null;
  onFocus: (key: string | null) => void;
  /** 一時的に隠している案 */
  hidden: readonly string[];
  onToggle: (key: string) => void;
}

/** 全部の案を重ねる表示の凡例: 何の線か（見出し）と、案ごとの見本・名前。合わせると強調、クリックで一時的に隠す・戻す */
export function MultiLegend({ plans, mode, focus, onFocus, hidden, onToggle }: MultiLegendProps) {
  const styles = planStyles(plans);
  const what = MULTI_WHAT[mode];
  return (
    <div class="legend main-legend multi-legend" data-multi-legend={mode}>
      <b class="ml-cap" data-multi-caption>
        {what.caption}
      </b>
      <span class="ml-items" role="group" aria-label="案の線（クリックで一時的に隠す・戻す）">
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
              title={`${p.name} ${p.title}（${st.dashName}）${off ? "。クリックで戻す" : "。クリックで一時的に隠す"}`}
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
      <span class="hint">名前に合わせるとその線を強調、クリックで一時的に隠す・戻す。グラフに合わせるとその年の全部の案の数字（クリックで固定）。{what.zone}</span>
    </div>
  );
}
