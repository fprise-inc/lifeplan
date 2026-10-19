// 提示層の部品: 資産の内訳のドーナツ型のグラフ（0026）。区切りは6つまで（それより細かいものは「その他（○つ）」にまとめる）。
// 並べるとき（現状とプラン）は、同じ大きさのものを左右に置く。色だけに頼らないよう、凡例に名前・金額・割合を書く
import type { Yen } from "./model.ts";
import { man } from "./format.ts";

export interface DonutItem {
  label: string;
  amount: Yen;
  color: string;
}

export interface DonutPane {
  /** 例: 「現状（プランA）」 */
  title: string;
  /** 例: 「2046年（ご主人65歳）」 */
  sub: string;
  items: DonutItem[];
}

/** 区切りの最大の数 */
export const DONUT_MAX = 6;
const OTHER_COLOR = "#d9dde3";

/** 区切りを6つまでにする（金額の大きい順。7つ目からは「その他（○つ）」） */
export function donutSlices(items: readonly DonutItem[]): DonutItem[] {
  const pos = items.filter((x) => x.amount > 0).sort((a, b) => b.amount - a.amount);
  if (pos.length <= DONUT_MAX) return pos;
  const head = pos.slice(0, DONUT_MAX - 1);
  const rest = pos.slice(DONUT_MAX - 1);
  return [...head, { label: `その他（${rest.length}つ）`, amount: rest.reduce((s, x) => s + x.amount, 0), color: OTHER_COLOR }];
}

function Ring({ items, size }: { items: DonutItem[]; size: number }) {
  const total = items.reduce((s, x) => s + x.amount, 0);
  const r = size / 2 - 4;
  const r0 = r * 0.58;
  const c = size / 2;
  const p = (ang: number, rr: number) => `${(c + rr * Math.cos(ang)).toFixed(2)},${(c + rr * Math.sin(ang)).toFixed(2)}`;
  let a0 = -Math.PI / 2;
  const paths = items.map((x, i) => {
    const frac = total > 0 ? x.amount / total : 0;
    const a1 = a0 + frac * Math.PI * 2 - (frac >= 1 ? 1e-4 : 0);
    const lg = a1 - a0 > Math.PI ? 1 : 0;
    const d = `M${p(a0, r)} A${r},${r} 0 ${lg} 1 ${p(a1, r)} L${p(a1, r0)} A${r0},${r0} 0 ${lg} 0 ${p(a0, r0)} Z`;
    a0 = a1;
    return <path key={i} d={d} fill={x.color} stroke="#fff" stroke-width="1.5" />;
  });
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} aria-hidden="true" class="donut-svg">
      {total > 0 ? paths : <circle cx={c} cy={c} r={(r + r0) / 2} fill="none" stroke="#e3e6ea" stroke-width={r - r0} />}
      <text x={c} y={c - 2} text-anchor="middle" class="donut-total">
        {man(total)}
      </text>
      <text x={c} y={c + 14} text-anchor="middle" class="donut-unit">
        万円
      </text>
    </svg>
  );
}

/** 1つの内訳（ドーナツと凡例） */
export function DonutView({ pane, size = 132 }: { pane: DonutPane; size?: number }) {
  const items = donutSlices(pane.items);
  const total = items.reduce((s, x) => s + x.amount, 0);
  return (
    <figure class="donut" data-donut>
      <figcaption>
        <b>{pane.title}</b>
        <span>{pane.sub}</span>
      </figcaption>
      <div class="donut-body">
        <Ring items={items} size={size} />
        <ul class="donut-legend">
          {items.length === 0 ? <li class="none">金融資産はありません</li> : null}
          {items.map((x) => (
            <li key={x.label}>
              <i style={{ background: x.color }} />
              <span class="nm">{x.label}</span>
              <span class="v num">{man(x.amount)}万円</span>
              <span class="pc num">{total > 0 ? `${Math.round((x.amount / total) * 100)}%` : ""}</span>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  );
}

/** 並べた内訳（現状とプラン。1つでもよい） */
export function DonutPair({ panes, size }: { panes: DonutPane[]; size?: number }) {
  return (
    <div class={`donut-pair${panes.length > 1 ? " two" : ""}`}>
      {panes.map((p) => (
        <DonutView key={p.title} pane={p} {...(size !== undefined ? { size } : {})} />
      ))}
    </div>
  );
}
