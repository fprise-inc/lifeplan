// 入力のホームの小さな結果（0072）: 金融資産の残高の線と、足りなくなる年（金融資産がはじめてマイナスになる年）。
// 入力を直すと、親が計算し直した現状の結果で描き直す。プランの編集中は、そのプランの線を重ねる（そのプランの結果があるときだけ）。
// 読むだけ。押すと結果のタブへ（onResults）
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import { depletionYear, displayYears, financialOf } from "../present.ts";
import { ageAt } from "../levers.ts";
import { roles } from "../roles.ts";
import { man } from "../../presentation/format.ts";

export interface MiniLine {
  years: number[];
  values: number[];
  /** 足りなくなる年（無ければ null） */
  short: number | null;
}

/** 表から線（表示する年の金融資産の残高） */
export function miniLine(req: EngineRequest, r: PreviewResult | null): MiniLine | null {
  if (r === null) return null;
  const years = displayYears(req);
  if (years.length < 2) return null;
  const fin = financialOf(r.table);
  return { years, values: years.map((y) => fin.get(y) ?? 0), short: depletionYear(r.table, years) };
}

/** 本人がその年に何歳か（12月の年齢） */
function selfAge(req: EngineRequest, year: number): number | null {
  const self = roles(req).find((x) => x.key === "self")?.member;
  return self === undefined ? null : ageAt(self, `${year}-12`);
}

const W = 260;
const H = 64;

function path(l: MiniLine, lo: number, hi: number): string {
  const n = l.years.length;
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => H - 4 - ((v - lo) / (hi - lo || 1)) * (H - 8);
  return l.values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
}

export function MiniResult({ req, current, plan, onResults }: { req: EngineRequest; current: PreviewResult | null; plan?: { label: string; color: string; result: PreviewResult | null } | undefined; onResults?: (() => void) | undefined }) {
  const cur = miniLine(req, current);
  const pl = plan !== undefined ? miniLine(req, plan.result) : null;
  if (cur === null) return null;
  const all = [...cur.values, ...(pl?.values ?? [])];
  const lo = Math.min(0, ...all);
  const hi = Math.max(1, ...all);
  const zeroY = H - 4 - ((0 - lo) / (hi - lo || 1)) * (H - 8);
  const shortText = (l: MiniLine) => {
    if (l.short === null) return `${l.years.at(-1) ?? ""}年まで足ります`;
    const age = selfAge(req, l.short);
    return `${l.short}年${age !== null ? `（本人${age}歳）` : ""}に足りなくなります`;
  };
  const last = cur.values.at(-1) ?? 0;
  return (
    <div class="ih-mini" data-mini-result>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`金融資産の残高の見込み。現状: ${shortText(cur)}${pl !== null && plan !== undefined ? `。${plan.label}: ${shortText(pl)}` : ""}`}>
        <line x1="0" x2={W} y1={zeroY} y2={zeroY} class="ih-mini-zero" />
        <path d={path(cur, lo, hi)} class={`ih-mini-cur${pl !== null ? " dim" : ""}`} />
        {pl !== null && plan !== undefined ? <path d={path(pl, lo, hi)} class="ih-mini-plan" style={{ stroke: plan.color }} /> : null}
      </svg>
      <div class="ih-mini-text">
        <span class="ih-mini-h">金融資産の見込み</span>
        <span class={cur.short !== null ? "short" : ""} data-mini-short={cur.short ?? ""}>
          現状: {shortText(cur)}
          {cur.short === null ? `（${cur.years.at(-1)}年 ${man(last)}万円）` : ""}
        </span>
        {pl !== null && plan !== undefined ? (
          <span class={pl.short !== null ? "short" : ""} data-mini-plan-short={pl.short ?? ""}>
            {plan.label}: {shortText(pl)}
          </span>
        ) : null}
        {onResults !== undefined ? (
          <button type="button" class="link-btn" onClick={onResults} data-mini-results>
            結果を見る
          </button>
        ) : null}
      </div>
    </div>
  );
}
