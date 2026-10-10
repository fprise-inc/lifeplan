// 数の鍵の表（0005 の追記（2026-10-10 の速さの見直し））。Map<number, V> と同じ使い方で、内蔵の実行環境（quickjs-ng）では
// 整数の鍵の Map より数倍速い（整数の欄名は文字列にせずに引ける）。鍵は数を文字列にした欄名になるので、0 と -0・NaN どうしは
// Map（SameValueZero）と同じく同じ鍵になり、違う数は違う鍵になる。prototype を持たないので、欄名が組み込みの名前と重ならない
export type NumTable<V> = { [key: number]: V | undefined };

export function numTable<V>(): NumTable<V> {
  return Object.create(null) as NumTable<V>;
}
