// 部品は純粋な関数。入力や他の部品の出力（使い回す結果）を書き換えられないように凍結する
export function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}
