// ヒアリングで答えた、今住んでいる持ち家の買った値段（0176 の追記 2026-11-09）を承認したときの後始末。入力の画面で標準の3欄
// （買った年月〔住み始め〕・買った値段・うち土地の値段）を書いたときと同じにする:
// - 今の世帯に評価額が無かった家（新しい住まい・評価を入れていなかった家）と、今の時価で入れていた家: 評価の入れ方を「買った値段で」にし、
//   その額の時点を住み始めにそろえて、住み始めについてくる印（ownedHomeValue.ts の AS_OF_FOLLOWS）を付ける（入力の画面で買った値段を入れたときと同じ）
// - 買った値段で入れていた家（入れ方を書いていない前の版の世帯を含む）: 入れ方は書き足さない（入力の画面で合計を直したときと同じ）。
//   時点に印があれば、住み始めにそろえる
// - お答えの無い時点で今の世帯の時点を残したとき（取り込んだ時点と違う）は、FP の値として触らない
// - 固定資産税の欄が未入力か推定のまま（目安のボタンの値を含む）なら、買った値段からの推定を入れる（ownedHomeTax.ts の applyOwnedHomeTax）。
//   お客さま・FP が入れた額はそのまま
import type { Candidate } from "../../../../hearing/src/index.ts";
import type { Household, Residence } from "../../engine/types.ts";
import { mutate, type WorkingHousehold } from "../input/household.ts";
import { applyOwnedHomeTax } from "../input/ownedHomeTax.ts";
import { AS_OF_FOLLOWS, isCurrentOwned } from "../input/ownedHomeValue.ts";
import type { StateRow } from "../input/rows.ts";
import { resolveTimepoint } from "../timepoint.ts";

type Obj = Record<string, unknown>;
const AS_OF = "residence.valuation/asOf";

/** 買った年月（住み始め。計算の基準の月より後なら計算の基準の月。ownedHomeValue.ts と同じ） */
function boughtMonth(h: Household, r: Residence, baseMonth: string): string | null {
  const from = resolveTimepoint(h, r.from);
  if (from === null) return null;
  return from > baseMonth ? baseMonth : from;
}

const rowsOf = (r: Residence): Record<string, StateRow> => ((r as unknown as Obj).valueStates as Record<string, StateRow> | undefined) ?? {};
const follows = (r: Residence): boolean => rowsOf(r)[AS_OF]?.estimate?.basis === AS_OF_FOLLOWS;

function markFollows(r: Residence): void {
  const row: StateRow = { state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: AS_OF_FOLLOWS } };
  (r as unknown as Obj).valueStates = { ...rowsOf(r), [AS_OF]: row };
}

/**
 * 承認で買った値段を入れた持ち家（今の世帯の ID → 取り込んだ側の時点）の後始末。before は承認の前の世帯（評価の入れ方を書き足すかの判断に使う）。
 * 今住んでいる持ち家だけ
 */
export function afterOwnedHomeImport(wh: WorkingHousehold, before: Household, imported: ReadonlyMap<string, string | undefined>): WorkingHousehold {
  if (imported.size === 0) return wh;
  return mutate(wh, (h, req) => {
    const base = req.input.baseMonth;
    for (const [id, asOf] of imported) {
      const r = (h.residences ?? []).find((x) => x.id === id);
      if (r?.valuation?.value === undefined || !isCurrentOwned(h, r, base)) continue;
      const prev = (before.residences ?? []).find((x) => x.id === id);
      const fresh = prev?.valuation?.value === undefined || prev.valuation.basis === "market";
      const month = boughtMonth(h, r, base);
      // 取り込んだ時点のまま（お答えの無い時点で今の時点を残していない）なら、住み始めにそろえる
      const ours = r.valuation.asOf === asOf;
      if (fresh) {
        r.valuation = { ...r.valuation, basis: "purchase", ...(ours && month !== null ? { asOf: month } : {}) };
        if (ours && month !== null) markFollows(r);
      } else if (follows(r) && month !== null) r.valuation = { ...r.valuation, asOf: month };
      applyOwnedHomeTax(h, r, base, req.input.endYear, req.input.assumptions?.realEstateValuation?.landShare, true);
    }
  });
}

/** 承認した候補のうち、買った値段を答えた住まい（今の世帯の ID → 取り込んだ側の時点） */
export function purchasedHomes(chosen: readonly Candidate[], ids: ReadonlyMap<string, string>): Map<string, string | undefined> {
  const out = new Map<string, string | undefined>();
  for (const c of chosen) {
    if (c.collection !== "residences" || !c.fields.some((f) => f.path === "/valuation/value" && f.noAnswer !== true)) continue;
    const v = c.value as Residence;
    out.set(ids.get(c.target.object) ?? c.target.object, v.valuation?.asOf);
  }
  return out;
}
