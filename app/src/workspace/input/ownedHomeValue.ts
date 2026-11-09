// 今住んでいる持ち家の評価を、買った値段（土地と建物の合計・うち土地・うち建物）と買った年月から推計する（0176）。
// - 世帯ファイルの形は変えない: 買った値段は valuation.value、買った年月は valuation.asOf、土地の値段は valuation.landShare（＝土地÷合計）に書く。
//   計算エンジンの housing.valuation は、その時点の額を土地と建物に分け、土地は上昇率で動かし、建物は耐用年数で減らす（購入の予定の家と同じ推計）
// - 土地の値段から割合を作るときは、小数12桁で切り上げる（計算エンジンは合計×割合の円未満を切り捨てるので、入れた土地の値段がそのまま出る）
// - 買った年月は住み始めについてくる（値の状態の行に印。FP が「その額の時点」を直したら印が外れて、ついてこない）
import type { Household, Residence } from "../../engine/types.ts";
import { resolveTimepoint } from "../timepoint.ts";
import type { StateRow } from "./rows.ts";

type Obj = Record<string, unknown>;

/** 割合の文字の最大の桁（計算エンジンの率の上限 RATE_MAX_SCALE と同じ） */
const SCALE = 12;
const POW = 10n ** BigInt(SCALE);

/** 土地の値段から土地の割合（合計に対する）の文字を作る。合計×割合の円未満を切り捨てると、ちょうど土地の値段になる */
export function shareOfLand(land: number, total: number): string {
  if (!(total > 0) || !(land > 0)) return "0";
  if (land >= total) return "1";
  const t = BigInt(Math.round(total));
  const units = (BigInt(Math.round(land)) * POW + t - 1n) / t;
  const s = units.toString().padStart(SCALE, "0");
  const frac = s.slice(-SCALE).replace(/0+$/u, "");
  const int = s.length > SCALE ? s.slice(0, -SCALE) : "0";
  return frac === "" ? int : `${int}.${frac}`;
}

/** 合計×割合の土地の値段（計算エンジンと同じく円未満を切り捨て） */
export function landOfShare(total: number, share: string): number {
  if (!/^\d+(\.\d+)?$/u.test(share)) return Math.floor(total * Number(share));
  const [i = "0", f = ""] = share.split(".");
  const frac = f.slice(0, SCALE).padEnd(SCALE, "0");
  const units = BigInt(i) * POW + BigInt(frac);
  return Number((BigInt(Math.round(total)) * units) / POW);
}

const rowsOf = (r: Residence): Record<string, StateRow> => ((r as unknown as Obj).valueStates as Record<string, StateRow> | undefined) ?? {};
function putRow(r: Residence, key: string, row: StateRow | undefined): void {
  const o = r as unknown as Obj;
  const rows = { ...rowsOf(r) };
  if (row === undefined) delete rows[key];
  else rows[key] = row;
  if (Object.keys(rows).length === 0) delete o.valueStates;
  else o.valueStates = rows;
}

const AS_OF = "residence.valuation/asOf";
const LAND = "residence.valuation/landShare";
/** 買った年月が住み始めについてくる印の根拠 */
export const AS_OF_FOLLOWS = "住み始めと同じ（買った年月）";
const followRow = (): StateRow => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: AS_OF_FOLLOWS } });

/** 今住んでいる持ち家（購入の予定でも、これから持ち始める相続する家でもない） */
export function isCurrentOwned(h: Household, r: Residence, baseMonth: string): boolean {
  if (r.kind !== "own" || r.purchase !== undefined) return false;
  const from = resolveTimepoint(h, r.from);
  return from === null || from <= baseMonth;
}

/**
 * 評価の入れ方: 買った値段から推計する（purchase）か、今の時価を入れる（market）。入れていなければ、評価額が無いか、その額の時点が
 * 計算の基準の月より前なら買った値段。評価額があって時点が今（前の版の標準の「評価額」）なら今の時価
 */
export function ownedValueMode(r: Residence, baseMonth: string): "purchase" | "market" {
  const v = r.valuation;
  if (v?.basis !== undefined) return v.basis;
  if (v?.value === undefined) return "purchase";
  return v.asOf !== undefined && v.asOf < baseMonth ? "purchase" : "market";
}

/** 土地の値段を FP が入れたか（土地の割合が入っていて、建った年からの目安などの推定でない） */
export function landEntered(r: Residence): boolean {
  if (r.valuation?.landShare === undefined) return false;
  const row = rowsOf(r)[LAND];
  return !(row?.state === "estimated" && row.origin.kind === "auto");
}

/** 買った値段（合計）。無ければ null */
export function totalOf(r: Residence): number | null {
  const b = r.valuation?.value as { value?: number | null; state?: string; substitute?: { value?: number | null } } | undefined;
  if (b === undefined || b.state === "notApplicable") return null;
  const v = b.value ?? (b.state === "unknown" ? (b.substitute?.value ?? null) : null);
  return typeof v === "number" ? v : null;
}

/** 買った年月（住み始め。計算の基準の月より後なら計算の基準の月） */
const boughtMonth = (h: Household, r: Residence, baseMonth: string): string => {
  const from = resolveTimepoint(h, r.from);
  return from === null || from > baseMonth ? baseMonth : from;
};

/** 買った値段で入れたことにする（評価の入れ方を買った値段に、その額の時点を住み始めにして印を付ける。FP が入れた時点は変えない） */
export function markPurchaseBasis(h: Household, r: Residence, baseMonth: string): void {
  // 入れ方を書いていない前の版の世帯で、時点が前の月（＝買った値段の読み）なら、そのまま（書き足さない）
  if (r.valuation?.basis === undefined && r.valuation?.asOf !== undefined && r.valuation.asOf < baseMonth) return;
  const v = (r.valuation ??= {});
  v.basis = "purchase";
  const row = rowsOf(r)[AS_OF];
  const follows = row?.estimate?.basis === AS_OF_FOLLOWS;
  if (v.asOf === undefined || follows || v.asOf >= baseMonth) {
    v.asOf = boughtMonth(h, r, baseMonth);
    putRow(r, AS_OF, followRow());
  }
}

/** その額の時点の印を外す（FP が時点を直した・今の時価にした） */
export function dropAsOfFollow(r: Residence): void {
  if (rowsOf(r)[AS_OF]?.estimate?.basis === AS_OF_FOLLOWS) putRow(r, AS_OF, undefined);
}

/**
 * 住み始めを直したときに、前の住み始めと同じだった買った年月（印の無い前の版の世帯も）を一緒に動かす。印のある物は refreshOwnedHomeAsOf でもついてくる
 */
export function followFromMonth(h: Household, rid: string, oldFrom: string | null, baseMonth: string): void {
  const r = (h.residences ?? []).find((x) => x.id === rid);
  if (r === undefined || !isCurrentOwned(h, r, baseMonth) || ownedValueMode(r, baseMonth) !== "purchase" || r.valuation?.value === undefined) return;
  const follows = rowsOf(r)[AS_OF]?.estimate?.basis === AS_OF_FOLLOWS;
  if (follows) {
    r.valuation = { ...r.valuation, asOf: boughtMonth(h, r, baseMonth) };
    return;
  }
  // 印の無い前の版の世帯: 前の住み始めと同じだった時点だけを、新しい住み始め（計算の基準の月より前のとき）に動かす（ほかは書き足さない）
  const now = resolveTimepoint(h, r.from);
  if (oldFrom !== null && r.valuation.asOf === oldFrom && now !== null && now < baseMonth) r.valuation = { ...r.valuation, asOf: now };
}

/** 印のある買った年月を住み始めに合わせる（refreshEstimates から。住宅ローンの借りた年月で住み始めが動いたときも） */
export function refreshOwnedHomeAsOf(h: Household, baseMonth: string): void {
  for (const r of h.residences ?? []) {
    if (r.valuation?.asOf === undefined || rowsOf(r)[AS_OF]?.estimate?.basis !== AS_OF_FOLLOWS) continue;
    if (!isCurrentOwned(h, r, baseMonth) || r.valuation.basis === "market") {
      putRow(r, AS_OF, undefined);
      continue;
    }
    const now = boughtMonth(h, r, baseMonth);
    if (r.valuation.asOf !== now) r.valuation = { ...r.valuation, asOf: now };
  }
}

/** 土地の値段（FP が入れていなければ、合計×割合の目安。合計が無ければ null） */
export function landAmount(r: Residence, fallbackShare: string): number | null {
  const t = totalOf(r);
  if (t === null) return null;
  return landOfShare(t, r.valuation?.landShare ?? fallbackShare);
}

/** 土地の割合を土地の値段から入れる（合計が無ければ書かない）。FP の値として、推定の印は外す */
export function putLand(r: Residence, land: number): void {
  const t = totalOf(r);
  if (t === null || r.valuation === undefined) return;
  r.valuation = { ...r.valuation, landShare: shareOfLand(Math.min(Math.max(0, land), t), t) };
  putRow(r, LAND, undefined);
}

/** 土地の値段を空にする（目安の割合に戻す） */
export function clearLand(r: Residence): void {
  if (r.valuation === undefined) return;
  const { landShare: _drop, ...rest } = r.valuation;
  void _drop;
  if (Object.keys(rest).length === 0) delete r.valuation;
  else r.valuation = rest;
  putRow(r, LAND, undefined);
}

/** 買った値段を空にしたとき: 印のある時点と、足した入れ方を外す（評価の欄が空なら評価ごと外す） */
export function clearPurchaseBasis(r: Residence): void {
  const v = r.valuation;
  if (v === undefined) return;
  if (rowsOf(r)[AS_OF]?.estimate?.basis === AS_OF_FOLLOWS) {
    const { asOf: _a, basis: _b, ...rest } = v;
    void _a;
    void _b;
    putRow(r, AS_OF, undefined);
    if (Object.keys(rest).length === 0) delete r.valuation;
    else r.valuation = rest;
  }
}
