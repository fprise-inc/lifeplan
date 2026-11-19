// 書いた名前に近い、使える名前（接続口の crates/lifeplan/src/args.rs の closest と同じ決まり: 書き方の違いだけ → 1〜2文字の違い → 名前の一部）。
// 表示の設定の案の確かめ（displayProposal.ts。0215）と Web のヒアリングの選び方の確かめ（workspace/hearing/aiSelection.ts。0222）が使う
const folded = (s: string): string => s.replace(/[_\-\s]/g, "").toLowerCase();

function distance(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_v, i) => i);
  for (let i = 0; i < x.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < y.length; j++) cur.push(Math.min((prev[j] ?? 0) + (x[i] === y[j] ? 0 : 1), (prev[j + 1] ?? 0) + 1, (cur[j] ?? 0) + 1));
    prev = cur;
  }
  return prev[y.length] ?? 0;
}

/** 書いた名前に近い、使える名前（見つからなければ null） */
export function closestOf(name: string, allowed: readonly string[]): string | null {
  const f = folded(name);
  if (f === "") return null;
  const same = allowed.find((a) => folded(a) === f);
  if (same !== undefined) return same;
  let best: { d: number; a: string } | null = null;
  for (const a of allowed) {
    const d = distance(folded(a), f);
    if (d <= 2 && d < [...f].length && (best === null || d < best.d)) best = { d, a };
  }
  if (best !== null) return best.a;
  if ([...f].length >= 4) {
    const part = allowed.filter((a) => folded(a).includes(f) || f.includes(folded(a))).sort((a, b) => a.length - b.length);
    return part[0] ?? null;
  }
  return null;
}

