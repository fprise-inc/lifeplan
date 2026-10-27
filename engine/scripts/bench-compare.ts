// 速さの計測の「前の値」との比べ方（0005 の追記 2026-10-28: 警告の決まりの見直し）。scripts/bench.ts と scripts/bench-check-os.ts から使う。
// - 物差しは3つ: 時間（最小値。ミリ秒）、部品の呼び出しの回数（決まった値。OS によらない）、実行した命令の数（百万。測る道具ごと）
// - 前の値は、直近の毎晩の計測（CI の成果物。最大5晩）の中央値。bench/baseline.json を書き換えた時刻（updatedAt）より前の晩は使わず、
//   使える晩が3つに満たない物差しは bench/baseline.json の値を前の値にする
// - 線: 呼び出しの回数は +5% で警告・+10% で失敗。命令の数は道具が決まった値を出す物（cachegrind）は回数と同じ、揺れのある物（time -l）は警告だけ。
//   時間は1つの OS の中では知らせず、ubuntu と macOS の両方が 1.5倍を超えたら警告・3倍を超えたら失敗（scripts/bench-check-os.ts）

export type Stat = { median: number; min: number };

/** 1回の計測の結果（dist/bench/result.json の形のうち、比べるのに使う所） */
export type BenchResult = {
  node?: Record<string, Stat>;
  jsc?: Record<string, Stat>;
  quickjs?: Record<string, Stat | number | null>;
  counts?: Record<string, number>;
  instructions?: { tool: string; values: Record<string, number> };
  machine?: { platform?: string; arch?: string; measuredAt?: string };
};

/** 前の値の1つ分（毎晩の計測1回）。at は計測した時刻（ISO 8601） */
export type HistoryEntry = { at: string; result: BenchResult };

export const NIGHTS = 5;
export const MIN_NIGHTS = 3;
export const COUNT_WARN = 1.05;
export const COUNT_FAIL = 1.1;
export const TIME_WARN = 1.5;
export const TIME_FAIL = 3;
/** 命令の数を決まった値で数える道具か（cachegrind。CI の ubuntu の3つの実行環境で2回ずつ数えて同じ値。失敗の線まで使う）。
 *  time -l の V8 は JIT の動きで書き方の小さな変更でも数%動くので警告だけ。道具の名前には CPU の型を含める（glibc が CPU の型で
 *  関数の作りを選ぶので、型が違うと値が変わる。違う型の晩とは比べない） */
export const exactInstructions = (tool: string): boolean => tool.startsWith("cachegrind");

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) throw new Error("median of empty");
  return n % 2 === 1 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

/** 結果から「エンジン.計測 → 最小値（ミリ秒）」を取り出す */
export function timesOf(r: BenchResult): Record<string, number> {
  const out: Record<string, number> = {};
  for (const eng of ["node", "jsc", "quickjs"] as const) {
    for (const [k, v] of Object.entries(r[eng] ?? {})) if (v !== null && typeof v === "object") out[`${eng}.${k}`] = v.min;
  }
  return out;
}

/** 使う晩: 新しい順に、updatedAt より後の物を最大 NIGHTS 件 */
export function usableNights(history: readonly HistoryEntry[], updatedAt: string | undefined): HistoryEntry[] {
  return [...history]
    .filter((h) => updatedAt === undefined || h.at > updatedAt)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, NIGHTS);
}

/**
 * 前の値: 晩ごとの値（pick で取り出す）が MIN_NIGHTS 以上あれば中央値、無ければ fallback（bench/baseline.json の値）。
 * from は値の出どころ（表に出す）
 */
export function previousValue(
  nights: readonly HistoryEntry[],
  pick: (r: BenchResult) => number | undefined,
  fallback: number | undefined,
): { value: number; from: string } | undefined {
  const xs = nights.map((h) => pick(h.result)).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (xs.length >= MIN_NIGHTS) return { value: median(xs), from: `毎晩${xs.length}回の中央値` };
  if (fallback !== undefined) return { value: fallback, from: "bench/baseline.json" };
  return undefined;
}

export type Level = "ok" | "warning" | "error";

export function levelOf(ratio: number, warn: number, fail: number | undefined): Level {
  if (fail !== undefined && ratio > fail) return "error";
  return ratio > warn ? "warning" : "ok";
}

/** 1つの物差しの比べた結果 */
export type Compared = { kind: "time" | "count" | "instructions"; key: string; now: number; prev: number; from: string; ratio: number; level: Level };

/** 時間は1つの OS の中では知らせない（level は ok のまま。両方の OS をそろえて scripts/bench-check-os.ts が決める） */
export function compareAll(
  now: BenchResult,
  nightsAll: readonly HistoryEntry[],
  base: {
    time?: { updatedAt?: string; min: Readonly<Record<string, number>> };
    counts?: { updatedAt?: string; values: Readonly<Record<string, number>> };
    instructions?: { updatedAt?: string; tool: string; values: Readonly<Record<string, number>> };
  },
): Compared[] {
  const out: Compared[] = [];
  const push = (kind: Compared["kind"], key: string, v: number, prev: { value: number; from: string } | undefined, warn: number, fail: number | undefined) => {
    if (prev === undefined || prev.value <= 0) return;
    const ratio = v / prev.value;
    out.push({ kind, key, now: v, prev: Math.round(prev.value * 10) / 10, from: prev.from, ratio, level: kind === "time" ? "ok" : levelOf(ratio, warn, fail) });
  };
  const timeNights = usableNights(nightsAll, base.time?.updatedAt);
  for (const [k, v] of Object.entries(timesOf(now))) push("time", k, v, previousValue(timeNights, (r) => timesOf(r)[k], base.time?.min[k]), TIME_WARN, TIME_FAIL);
  const countNights = usableNights(nightsAll, base.counts?.updatedAt);
  for (const [k, v] of Object.entries(now.counts ?? {})) push("count", k, v, previousValue(countNights, (r) => r.counts?.[k], base.counts?.values[k]), COUNT_WARN, COUNT_FAIL);
  const ins = now.instructions;
  if (ins !== undefined) {
    const sameTool = usableNights(nightsAll, base.instructions?.updatedAt).filter((h) => h.result.instructions?.tool === ins.tool);
    const fb = base.instructions?.tool === ins.tool ? base.instructions.values : {};
    const fail = exactInstructions(ins.tool) ? COUNT_FAIL : undefined;
    for (const [k, v] of Object.entries(ins.values)) push("instructions", k, v, previousValue(sameTool, (r) => r.instructions?.values[k], fb[k]), COUNT_WARN, fail);
  }
  return out;
}

/** 両方の OS の時間の比（同じ計測）から、警告・失敗を決める。片方だけの遅れは実行環境の揺れが多いので知らせない */
export function crossOsTime(a: readonly Compared[], b: readonly Compared[]): { key: string; ratios: [number, number]; level: Level }[] {
  const bt = new Map(b.filter((c) => c.kind === "time").map((c) => [c.key, c.ratio]));
  const out: { key: string; ratios: [number, number]; level: Level }[] = [];
  for (const c of a) {
    if (c.kind !== "time") continue;
    const r2 = bt.get(c.key);
    if (r2 === undefined) continue;
    const both = Math.min(c.ratio, r2);
    out.push({ key: c.key, ratios: [c.ratio, r2], level: levelOf(both, TIME_WARN, TIME_FAIL) });
  }
  return out;
}

/** 負荷の平均が論理コア数の半分を超えていたら、時間の揺れが大きい */
export function noisyLoad(load1: number, cores: number): boolean {
  return load1 > cores / 2;
}
