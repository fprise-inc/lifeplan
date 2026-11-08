// 資産運用の配分（株式・債券・預金などの割合）から、期待の利回りを決める。
// 計算エンジンの決まり（engine/src/sdk/helpers.ts の accountReturnRate）と同じ:
// - 器の利回り＝Σ（配分の割合 × 前提の資産クラスごとの利回り assumptions.assetReturns）
// - 前提に無い資産クラスは運用利回り（assumptions.investmentReturn）、ただし不動産は0、預金・外貨預金は預金の利回り（assumptions.depositReturn。
//   省略は運用利回り。0137）
// - 配分を持たない器は、預金・外貨預金・不動産はその資産クラス、ほかは運用利回り
// 配分の入力（account.assetMix）は計算エンジンにもともとある省略できる項目で、入れなければ今の結果は変わらない
import type { Account, EngineRequest, YearSeries } from "../../engine/types.ts";
import { addRate, cmpRate, divRate, mulRate } from "./decimal.ts";

export interface MixPart {
  assetClass: string;
  share: string;
}

/** 配分のつまみ（株式・債券・預金）。ほかの資産クラス（バランス型など）は、今の割合のまま残す */
export type Bucket = "equity" | "bond" | "cash";
export const BUCKETS: readonly { key: Bucket; label: string; fallbackClass: string }[] = [
  { key: "equity", label: "株式", fallbackClass: "equity.global" },
  { key: "bond", label: "債券", fallbackClass: "bond.global" },
  { key: "cash", label: "預金", fallbackClass: "cash.deposit" },
];

export function bucketOf(assetClass: string): Bucket | null {
  if (assetClass.startsWith("equity.")) return "equity";
  if (assetClass.startsWith("bond.")) return "bond";
  if (assetClass.startsWith("cash.")) return "cash";
  return null;
}

const CASH_KINDS: Readonly<Record<string, string>> = { deposit: "cash.deposit", fxDeposit: "cash.foreign", realEstate: "realEstate" };
/** 預金の利回り（assumptions.depositReturn）を代わりに使う資産クラス（エンジンの DEPOSIT_CLASSES と同じ。0137） */
export const DEPOSIT_CLASSES: ReadonlySet<string> = new Set(["cash.deposit", "cash.foreign"]);

function seriesAt(s: YearSeries | undefined, year: number): string | undefined {
  if (s === undefined) return undefined;
  return s.byYear?.[String(year)] ?? s.default;
}

/** その年の資産クラスの利回り（エンジンと同じ決まり） */
export function classRate(req: EngineRequest, assetClass: string, year: number): { rate: string; fromAssumption: boolean } {
  const a = req.input.assumptions;
  const own = seriesAt(a?.assetReturns?.[assetClass], year);
  if (own !== undefined) return { rate: own, fromAssumption: true };
  const invest = seriesAt(a?.investmentReturn, year) ?? "0";
  return { rate: assetClass === "realEstate" ? "0" : DEPOSIT_CLASSES.has(assetClass) ? (seriesAt(a?.depositReturn, year) ?? invest) : invest, fromAssumption: false };
}

/** 器のその年の利回り（配分×資産クラスの利回り）。10進の文字列のまま */
export function expectedReturn(req: EngineRequest, account: Pick<Account, "kind" | "assetMix">, year: number): string {
  const mix = account.assetMix;
  if (mix === undefined || mix.length === 0) {
    // 暗号資産は、器の利回りも資産の配分も無ければ0（エンジンと同じ。0122）
    if (account.kind === "cryptoAsset") return "0";
    const cls = CASH_KINDS[account.kind];
    return cls === undefined ? (seriesAt(req.input.assumptions?.investmentReturn, year) ?? "0") : classRate(req, cls, year).rate;
  }
  if (mix.length === 1) return classRate(req, (mix[0] as MixPart).assetClass, year).rate;
  // 割合の合計が100%でなくても、合計で割って按分する（エンジンと同じ。合計が0なら資産の配分が無いのと同じ。0177）
  let total = "0";
  for (const m of mix) total = addRate(total, m.share);
  if (cmpRate(total, "0") <= 0) return expectedReturn(req, { kind: account.kind }, year);
  let r = "0";
  for (const m of mix) r = addRate(r, mulRate(classRate(req, m.assetClass, year).rate, m.share));
  return cmpRate(total, "1") === 0 ? r : divRate(r, total);
}

/** 配分を株式・債券・預金・そのほかに分けた割合（百分率の整数。端数は四捨五入） */
export function bucketShares(mix: readonly MixPart[] | undefined, kind: string): Record<Bucket | "other", number> {
  const out: Record<Bucket | "other", number> = { equity: 0, bond: 0, cash: 0, other: 0 };
  if (mix === undefined || mix.length === 0) {
    // 配分を持たない器: 預金の器は預金100%。ほかは「運用利回り」で、つまみの上では株式・債券・預金のどれでもない
    if (kind === "deposit") out.cash = 100;
    else out.other = 100;
    return out;
  }
  for (const m of mix) out[bucketOf(m.assetClass) ?? "other"] += Math.round(Number(m.share) * 100);
  return out;
}

/** 株式・債券の割合（百分率の整数）から配分を作る。預金は残り。ほかの資産クラス（バランス型など）は今の割合のまま残す */
export function mixFromBuckets(current: readonly MixPart[] | undefined, equityPct: number, bondPct: number): MixPart[] {
  const others = (current ?? []).filter((m) => bucketOf(m.assetClass) === null);
  const otherPct = others.reduce((s, m) => s + Math.round(Number(m.share) * 100), 0);
  const room = Math.max(0, 100 - otherPct);
  const eq = Math.max(0, Math.min(room, equityPct));
  const bd = Math.max(0, Math.min(room - eq, bondPct));
  const cash = room - eq - bd;
  const pick = (b: Bucket) => (current ?? []).find((m) => bucketOf(m.assetClass) === b)?.assetClass ?? (BUCKETS.find((x) => x.key === b) as { fallbackClass: string }).fallbackClass;
  const share = (pct: number) => (pct === 100 ? "1" : pct % 10 === 0 ? `0.${pct / 10}` : `0.${String(pct).padStart(2, "0")}`);
  const out: MixPart[] = [];
  if (eq > 0) out.push({ assetClass: pick("equity"), share: share(eq) });
  if (bd > 0) out.push({ assetClass: pick("bond"), share: share(bd) });
  if (cash > 0) out.push({ assetClass: pick("cash"), share: share(cash) });
  return [...out, ...others];
}
