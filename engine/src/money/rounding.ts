// 0002: 金額を丸められるのはこのファイルの関数だけ。規則（方式と単位）は規則IDから解決して渡す
import { EngineError } from "../errors.ts";
import { divRound, divRoundPosNumber, mulInt, toSafeNumber, pow10, type Int, type RoundingMode } from "./integer.ts";
import type { Rate } from "./rate.ts";
import { minorUnit, yen, type Money, type Yen } from "./yen.ts";

export interface RoundingRule {
  readonly mode: RoundingMode;
  /** 丸めの単位（1円、100円など）。正の整数 */
  readonly unit: number;
}

/** 丸めの1回分。根拠の記録に「丸める前（分数）と後」を残すため分子・分母も返す */
export interface Rounded {
  readonly value: Yen;
  readonly num: Int;
  readonly den: Int;
}

function apply(num: Int, den: Int, rule: RoundingRule): Rounded {
  const unit = rule.unit;
  if (!Number.isSafeInteger(unit) || unit <= 0) throw new EngineError("E_ARGUMENT", ["rounding.unit"]);
  // 0005 の追記（2026-10-10 の速さの見直し）: 分子と分母×単位が安全な整数のときは、下の divRound・mulInt・toSafeNumber と同じ計算を
  // 関数を重ねずに行う（内蔵の実行環境では関数の呼び出しが重い。丸めは1回の計算で3万回ほど）。結果と誤りは同じ
  if (typeof num === "number" && typeof den === "number") {
    const d = den * unit;
    if (d !== 0 && Number.isSafeInteger(d) && Number.isSafeInteger(num)) {
      const n = num < 0 ? -num : num;
      const dd = d < 0 ? -d : d;
      if (n + dd <= Number.MAX_SAFE_INTEGER) {
        const q0 = divRoundPosNumber(n, dd, rule.mode);
        const q = q0 === 0 ? 0 : (num < 0) !== (d < 0) && num !== 0 ? -q0 : q0;
        const p = q * unit;
        if (!Number.isSafeInteger(p)) throw new EngineError("E_UNSAFE_INTEGER");
        return { value: (p === 0 ? 0 : p) as Yen, num, den };
      }
    }
  }
  const q = divRound(num, mulInt(den, rule.unit), rule.mode);
  return { value: yen(toSafeNumber(mulInt(q, rule.unit))), num, den };
}

/** 金額×率 */
export function mulRate(amount: Yen, r: Rate, rule: RoundingRule): Rounded {
  return apply(mulInt(amount, r.n ?? r.units), pow10(r.scale), rule);
}

/** 金額×num÷den（按分・日割り・持分） */
export function mulRatio(amount: Yen, num: Int, den: Int, rule: RoundingRule): Rounded {
  return apply(mulInt(amount, num), den, rule);
}

/** 金額÷整数（月割りなど） */
export function divInt(amount: Yen, k: number, rule: RoundingRule): Rounded {
  if (!Number.isSafeInteger(k) || k === 0) throw new EngineError("E_ARGUMENT", ["divInt"]);
  return apply(amount, k, rule);
}

/** 金額を指定の単位に丸める（100円未満切り捨てなど） */
export function round(amount: Yen, rule: RoundingRule): Rounded {
  return apply(amount, 1, rule);
}

/** 外貨を円に換える。fxRate は「外貨1単位あたりの円」 */
export function convert(m: Money, fxRate: Rate, rule: RoundingRule): Rounded {
  // 円 = amount ÷ 10^minor × fx = amount × fx.units ÷ (10^minor × 10^fx.scale)
  return apply(mulInt(m.amount, fxRate.n ?? fxRate.units), mulInt(pow10(minorUnit(m.currency)), pow10(fxRate.scale)), rule);
}

export type RemainderTo = "first" | "last" | number;

/**
 * 合計を保ったまま重みで分ける。各取り分を丸めた後、合計との差を remainderTo の位置に寄せる
 */
export function allocate(total: Yen, weights: readonly number[], rule: RoundingRule, remainderTo: RemainderTo): Yen[] {
  if (weights.length === 0) throw new EngineError("E_ARGUMENT", ["allocate.empty"]);
  let wsum = 0;
  for (const w of weights) {
    if (!Number.isSafeInteger(w) || w < 0) throw new EngineError("E_ARGUMENT", ["allocate.weight"]);
    wsum += w;
  }
  if (wsum <= 0 || !Number.isSafeInteger(wsum)) throw new EngineError("E_ARGUMENT", ["allocate.weight"]);
  const target = remainderTo === "first" ? 0 : remainderTo === "last" ? weights.length - 1 : remainderTo;
  if (!Number.isInteger(target) || target < 0 || target >= weights.length) {
    throw new EngineError("E_ARGUMENT", ["allocate.remainderTo"]);
  }
  const shares: number[] = [];
  let used = 0;
  for (const w of weights) {
    const s = mulRatio(total, w, wsum, rule).value;
    shares.push(s);
    used += s;
  }
  shares[target] = (shares[target] as number) + (total - used);
  return shares.map((s) => yen(s));
}
