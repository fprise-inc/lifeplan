// 既定の値で埋まる欄の推定の印（0145 の追記）。収益不動産の物件の既定（構造・建った年・土地の割合・空室率・売却の費用）と、
// 前提条件の不動産の評価の目安（土地の割合・耐用年数・建物の残りの価値の下限・売却の費用）で使う。
// - 推定に見せるのは、世帯に値が無く（既定の値で埋まっている）、仮の印も無いときだけ。既定の値と同じ値でも、世帯に値があれば確定
//   （見本の作り手・FP が入れた値。確定は明示の操作だけ〔0041〕の裏返しの誤りを作らない）
// - 確定にする操作（「この値にする」・推定と同じ値を打つ〔0150〕・推定の値をまとめて使う）は、見せている既定の値を世帯に書いてから確定の行を書く
//   （valueState.ts の applyStateOp は、値の無い欄を write で書いてから確定にする）。値を書かないと、既定の元（前提条件・取得の年月）を直したときに
//   確定の印のまま値がついていく（0162）
// - 世帯に値がある欄で、既定の値と同じ値を打ったときも、省略に戻さずにその値を書く（plain は既定の値と同じ値を省略に戻すので、打った値が推定に
//   見えてしまう）。欄を空にしたときだけ省略に戻す（既定の値の推定に戻る）
import type { Household } from "../../engine/types.ts";
import { getPath, setPath, type FieldDef } from "./form.ts";
import { mutate, type WorkingHousehold } from "./household.ts";

type Obj = Record<string, unknown>;
type Val = Parameters<FieldDef["set"]>[1];

export function markDefault(f: FieldDef, basis: string, holder: (h: Household, w: WorkingHousehold) => Obj | undefined, path: readonly string[]): FieldDef {
  const raw = (w: WorkingHousehold): unknown => getPath(holder(w.request.input.household, w), path);
  /** 省略に戻った値を、打った値で書き戻す */
  const put = (next: WorkingHousehold, v: Val): WorkingHousehold =>
    mutate(next, (h, req) => {
      const o = holder(h, { ...next, request: req });
      if (o !== undefined) setPath(o, path, v);
    });
  const keep = (before: WorkingHousehold, next: WorkingHousehold, v: Val): WorkingHousehold => {
    if (next === before || v === null || v === "" || raw(before) === undefined || raw(next) !== undefined) return next;
    return put(next, v);
  };
  /** 同じ値の確かめをしない書き方（値の状態の操作が使う）: 空でない値は、既定の値と同じでも書く（確定にする値を世帯に持つ） */
  const pin = (next: WorkingHousehold, v: Val): WorkingHousehold => (v === null || v === "" || raw(next) !== undefined || holder(next.request.input.household, next) === undefined ? next : put(next, v));
  return {
    ...f,
    get: (w) => {
      const st = f.get(w);
      return raw(w) === undefined && st.value !== null && st.assumed == null ? { ...st, estimated: basis } : st;
    },
    set: (w, v) => keep(w, f.set(w, v), v),
    ...(f.write !== undefined ? { write: (w: WorkingHousehold, v: Val) => pin(f.write!(w, v), v) } : {}),
  };
}
