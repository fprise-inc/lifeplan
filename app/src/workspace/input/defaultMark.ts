// 既定の値で埋まる欄の推定の印（0145 の追記）。収益不動産の物件の既定（構造・建った年・土地の割合・空室率・売却の費用）と、
// 前提条件の不動産の評価の目安（土地の割合・耐用年数・建物の残りの価値の下限・売却の費用）で使う。
// - 推定に見せるのは、世帯に値が無く（既定の値で埋まっている）、仮の印も無いときだけ。既定の値と同じ値でも、世帯に値があれば確定
//   （見本の作り手・FP が入れた値。確定は明示の操作だけ〔0041〕の裏返しの誤りを作らない）
// - 「この値にする」は値の状態の行（確定）で記録する（valueState.ts の applyStateOp。行は値が変わると外れる）
// - 世帯に値がある欄で、既定の値と同じ値を打ったときは、省略に戻さずにその値を書く（plain は既定の値と同じ値を省略に戻すので、打った値が推定に
//   見えてしまう）。値の無い欄に推定と同じ値を打ったときも、打った値として確定にする（0150。推定の値を確かめずにそのまま確定にするのは「この値にする」）
import type { Household } from "../../engine/types.ts";
import { getPath, setPath, type FieldDef } from "./form.ts";
import { mutate, type WorkingHousehold } from "./household.ts";

type Obj = Record<string, unknown>;
type Val = Parameters<FieldDef["set"]>[1];

export function markDefault(f: FieldDef, basis: string, holder: (h: Household, w: WorkingHousehold) => Obj | undefined, path: readonly string[]): FieldDef {
  const raw = (w: WorkingHousehold): unknown => getPath(holder(w.request.input.household, w), path);
  const keep = (before: WorkingHousehold, next: WorkingHousehold, v: Val): WorkingHousehold => {
    if (next === before || v === null || v === "" || raw(before) === undefined || raw(next) !== undefined) return next;
    return mutate(next, (h, req) => {
      const o = holder(h, { ...next, request: req });
      if (o !== undefined) setPath(o, path, v);
    });
  };
  return {
    ...f,
    get: (w) => {
      const st = f.get(w);
      return raw(w) === undefined && st.value !== null && st.assumed == null ? { ...st, estimated: basis } : st;
    },
    set: (w, v) => keep(w, f.set(w, v), v),
    ...(f.write !== undefined ? { write: (w: WorkingHousehold, v: Val) => keep(w, f.write!(w, v), v) } : {}),
  };
}
