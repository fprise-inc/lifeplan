// 部品は純粋な関数。入力や他の部品の出力（使い回す結果）を書き換えられないように凍結する
export function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === "object" && !Object.isFrozen(v)) {
    Object.freeze(v);
    // 数・文字列などの中身には関数を呼ばない（0005 の追記（2026-10-10））
    for (const x of Object.values(v)) if (x !== null && typeof x === "object") deepFreeze(x);
  }
  return v;
}
