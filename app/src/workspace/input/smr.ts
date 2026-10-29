// 標準報酬月額の置き換え口の読み方（0047 の追記 2026-10-29 の2）。ほかの部品に頼らない（世帯・推定・プランのどこからでも読む）

type SmrBox = { state?: string; origin?: { kind?: string }; substitute?: { origin?: { kind?: string }; estimate?: { method?: string } } };

/**
 * 標準報酬月額の片方の箱が、FP が入れた値でない: 推定のまま（出どころ auto）か、わからないの代わりの値が給与からの推定（出し方 derived）のまま。
 * わからないの代わりの値が FP の前の値のもの・該当なし・確定は、FP が入れた値
 */
const notEntered = (b: unknown): boolean => {
  const x = b as SmrBox | undefined | null;
  if (x === undefined || x === null) return true;
  if (x.state === "estimated") return x.origin?.kind === "auto";
  return x.state === "unknown" && x.substitute?.origin?.kind === "auto" && x.substitute.estimate?.method === "derived";
};

/**
 * 標準報酬月額の置き換え口が、給与からの推定のまま（健康保険・厚生年金の両方とも FP が入れた値でない）か。そうなら置き換え口を書かずに
 * 空欄にする（空欄ならエンジンが給与と通勤手当から毎年9月に決め直す。推定の額を書くと期間の間ずっと同じ額になり、昇給が保険料と厚生年金に
 * 入らない。0047 の追記 2026-10-29 の2）。片方を FP が入れた期間（もう片方はその額から推定）は FP の値なので残す
 */
export function isAutoSmr(smr: { health?: unknown; pension?: unknown } | undefined): boolean {
  return smr !== undefined && notEntered(smr.health) && notEntered(smr.pension);
}
