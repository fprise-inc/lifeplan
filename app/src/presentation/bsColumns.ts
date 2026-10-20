// 資産と負債のタブの「時点を並べる」の時点を、プランの年に解く（提示層の純粋な計算。画面と提案書の図で同じ時点にするため、
// 作業の層の提案書の材料づくり（workspace/report/assemble.ts）からも使う）
import type { BsColumn, BsPlanModel, BsPointKey, BsYearModel } from "./model.ts";

/** 候補が世帯に無い時点（例: ローンの無い世帯の「ローン完済」）の代わり */
export const FALLBACK: BsPointKey[] = ["y10", "y20", "y5", "retire", "age65", "age75", "age85"];

export interface ResolvedColumn {
  /** 並べる時点の配列の中の番号（見出しから変えるときに使う） */
  pos: number;
  label: string;
  /** 見せている候補の鍵（代わりの時点ならその鍵）。決まった年なら null */
  point: BsPointKey | null;
  index: number;
  /** 候補がこの世帯に無いため、代わりの時点で見せている（例: 「ローン完済が無いため10年後」） */
  note: string | null;
}

const yearLabel = (y: BsYearModel) => (y.age !== null ? `${y.age}歳` : `${y.year}年`);
export const colsOf = (columns: readonly BsColumn[] | null, defaults: readonly BsPointKey[]): BsColumn[] => (columns !== null ? [...columns] : defaults.map((k) => ({ point: k })));

/**
 * 並べる時点を、このプランの年に解く（年の順に並べる）。
 * 候補の鍵はプランごとの年（退職の年を動かすと付いてくる）。決まった年は表の範囲に収める。候補が世帯に無ければ代わりの時点
 */
export function resolveColumns(plan: BsPlanModel, columns: readonly BsColumn[] | null, defaults: readonly BsPointKey[]): ResolvedColumn[] {
  const n = plan.years.length;
  const first = plan.years[0]?.year ?? 0;
  const out: (ResolvedColumn & { missing: boolean })[] = colsOf(columns, defaults).map((c, pos) => {
    if ("point" in c) {
      const p = plan.points.find((x) => x.key === c.point);
      return p !== undefined ? { pos, label: p.label, point: p.key, index: p.index, note: null, missing: false } : { pos, label: c.point, point: c.point, index: -1, note: null, missing: true };
    }
    const i = Math.max(0, Math.min(n - 1, c.year - first));
    return { pos, label: yearLabel(plan.years[i] as BsYearModel), point: null, index: i, note: null, missing: false };
  });
  for (const o of out) {
    if (!o.missing) continue;
    const f = FALLBACK.map((k) => plan.points.find((x) => x.key === k)).find((p) => p !== undefined && !out.some((q) => !q.missing && q.index === p.index));
    const missing = o.label;
    const name = plan.points.find((x) => x.key === missing)?.label ?? POINT_NAME[missing as BsPointKey] ?? "";
    o.missing = false;
    if (f !== undefined) Object.assign(o, { label: f.label, point: f.key, index: f.index, note: `この世帯には「${name}」が無いため${f.label}` });
    else Object.assign(o, { label: "今", point: "now", index: 0, note: `この世帯には「${name}」が無いため今` });
  }
  return out.map(({ missing: _m, ...r }) => r).sort((x, y) => x.index - y.index || x.pos - y.pos);
}

/** 候補の名前（世帯に無い候補の注記に使う） */
const POINT_NAME: Record<BsPointKey, string> = { now: "今", y5: "5年後", y10: "10年後", y20: "20年後", childIndep: "子の独立", loanEnd: "ローン完済", retire: "退職の年", pension: "年金の始まり", age65: "65歳", age70: "70歳", age75: "75歳", age80: "80歳", age85: "85歳", age90: "90歳" };

/** 並べる時点を変えたあとの値（既定と同じ並びになったら null＝既定のまま） */
export function nextColumns(cur: readonly BsColumn[], defaults: readonly BsPointKey[]): BsColumn[] | null {
  const same = cur.length === defaults.length && cur.every((c, i) => "point" in c && c.point === defaults[i]);
  return same ? null : [...cur];
}
