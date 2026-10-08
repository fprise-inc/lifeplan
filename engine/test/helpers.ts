// テストの共通部分
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPack, REGULATION_DIR } from "../scripts/regulation.ts";
import { ENGINE_DIR } from "../scripts/lib.ts";
import type { EngineRequest } from "../src/engine/types.ts";

export const samplePack = () => buildPack(join(REGULATION_DIR, "sample"));

export function fixture(name: string): EngineRequest {
  return JSON.parse(readFileSync(join(ENGINE_DIR, "test", "fixtures", "households", `${name}.json`), "utf8")) as EngineRequest;
}

/** 書き換えて使うための深い写し */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 決まった種から作る疑似乱数（テストの再現のため。xorshift32） */
export function prng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
}

/** 出力に整数でない数・-0 が混じっていないか（0005 の6） */
export function nonIntegerPaths(v: unknown, path = ""): string[] {
  if (typeof v === "number") return Number.isSafeInteger(v) && !Object.is(v, -0) ? [] : [path];
  if (Array.isArray(v)) return v.flatMap((x, i) => nonIntegerPaths(x, `${path}/${i}`));
  if (v !== null && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => nonIntegerPaths(x, `${path}/${k}`));
  return [];
}
