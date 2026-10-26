// テストの共通部分
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { inject } from "vitest";
import type { PackJson } from "../scripts/regulation.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import type { EngineRequest } from "../src/engine/types.ts";

let real: PackJson[] | undefined;
let fictional: PackJson[] | undefined;

/** 製品の制度データ（data/regulation。原本での確認待ちの値を含む）。組み立ては流す前に1回だけ（test/global-setup.ts） */
export const realPacks = (): PackJson[] => (real ??= inject("realPacks"));

/** 【架空の見本】テスト用の制度データ（値ID の test. を外して製品のパックの代わりに引く。test/global-setup.ts） */
export const fictionalPacks = (): PackJson[] => (fictional ??= inject("fictionalPacks"));

/** 架空のモデル世帯（data/modelHouseholds。CC0） */
export function modelHousehold(name: string): EngineRequest {
  return JSON.parse(readFileSync(join(REPO_DIR, "data", "modelHouseholds", `${name}.json`), "utf8")) as EngineRequest;
}

/** 書き換えて使うための深い写し */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 決まった文字列から作る UUID 第4版の形の ID（テストの世帯の物の ID） */
export function uid(name: string): string {
  const h = createHash("sha256").update(`financia-test:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${"89ab"[Number.parseInt(h[16] as string, 16) % 4]}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** 値の箱（手入力・確定） */
export const box = <T>(value: T) => ({ value, state: "confirmed" as const, origin: { kind: "manual" as const } });

interface PeriodOptions {
  readonly member: string;
  readonly from: string;
  readonly to?: string | null;
  readonly type?: string;
  readonly annual: number;
  readonly bonus?: number;
  readonly insurer?: string;
  readonly healthInsurance?: Record<string, unknown>;
  readonly pensionCategory?: string;
  readonly std?: readonly [number, number];
  readonly extra?: Record<string, unknown>;
}

export function period(name: string, o: PeriodOptions): Record<string, unknown> {
  return {
    id: uid(name),
    member: uid(o.member),
    from: { at: o.from },
    to: o.to === undefined || o.to === null ? null : { at: o.to },
    type: o.type ?? "regular",
    healthInsurance: o.healthInsurance ?? { kind: "kyokaikenpo", insurer: `kyokaikenpo.${o.insurer ?? "13"}` },
    pensionCategory: o.pensionCategory ?? "employee1",
    employer: { size: 300, weeklyHours: "40" },
    salary: { annual: box(o.annual), bonus: box(o.bonus ?? 0) },
    ...(o.std !== undefined ? { standardMonthlyRemuneration: { health: box(o.std[0]), pension: box(o.std[1]) } } : {}),
    ...(o.extra ?? {}),
  };
}

export function member(name: string, kind: string, birthYearMonth: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: uid(name), kind, birth: { birthYearMonth, bornOnFirst: false }, sex: "female", joins: null, leaves: null, expected: false, ...extra };
}

/** テスト用の世帯の要求 */
export function household(h: {
  baseMonth?: string;
  endYear?: number;
  members: Record<string, unknown>[];
  relations?: Record<string, unknown>[];
  periods?: Record<string, unknown>[];
  accounts?: Record<string, unknown>[];
  insuranceContracts?: Record<string, unknown>[];
  residentTaxAssessments?: Record<string, unknown>[];
  events?: Record<string, unknown>[];
  trace?: EngineRequest["trace"];
  wageGrowth?: string;
}): EngineRequest {
  return {
    trace: h.trace ?? "none",
    input: {
      baseMonth: h.baseMonth ?? "2026-01",
      endYear: h.endYear ?? 2030,
      calcConventions: { aggregation: "cash", investmentTiming: "midYear", compatibility: null },
      household: {
        members: h.members,
        relations: h.relations ?? [],
        events: h.events ?? [],
        employmentPeriods: h.periods ?? [],
        accounts: h.accounts ?? [],
        insuranceContracts: h.insuranceContracts ?? [],
        ...(h.residentTaxAssessments !== undefined ? { residentTaxAssessments: h.residentTaxAssessments } : {}),
      },
      assumptions: { investmentReturn: { default: "0.01" }, ...(h.wageGrowth !== undefined ? { wageGrowth: { default: h.wageGrowth } } : {}) },
    },
  } as unknown as EngineRequest;
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
