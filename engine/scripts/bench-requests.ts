// 速さの計測（0005 の「速さの回帰」）に使う要求: 100年分のモデル世帯（lifetime100）から作る5案×4想定の20件（すべて架空）。
// 案は前提・働き方の違い、想定は「万一」の代わりの出来事（遺族年金などの部品はまだ無いので、構成員が世帯から抜ける・働けなくなる形で近似する）。
// 並びは「案ごとに4想定」（先頭の4件が1案×4想定）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_DIR } from "./lib.ts";

type Obj = Record<string, unknown>;
const at = (ym: string) => ({ at: ym });

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

export function benchRequests(): Obj[] {
  const base = JSON.parse(readFileSync(join(REPO_DIR, "data", "modelHouseholds", "lifetime100.json"), "utf8")) as Obj;
  const h = (r: Obj) => (r.input as Obj).household as Obj;
  const members = (r: Obj) => h(r).members as Obj[];
  const periods = (r: Obj) => h(r).employmentPeriods as Obj[];
  const assumptions = (r: Obj) => ((r.input as Obj).assumptions ??= {}) as Obj;
  const box = (v: unknown) => ({ value: v, state: "confirmed", origin: { kind: "manual" } });
  const plans: ((r: Obj) => void)[] = [
    () => {},
    (r) => {
      assumptions(r).investmentReturn = { default: "0.03" };
    },
    (r) => {
      (periods(r)[0] as Obj).to = at("2056-04");
    },
    (r) => {
      assumptions(r).wageGrowth = { default: "0.015" };
    },
    (r) => {
      ((periods(r)[1] as Obj).salary as Obj).annual = box(3000000);
    },
  ];
  // 想定: なし／本人が2036年4月に世帯から抜ける／配偶者が2046年4月に世帯から抜ける／本人が2041年4月に働けなくなる
  const leave = (i: number, ym: string) => (r: Obj) => {
    const m = members(r)[i] as Obj;
    m.leaves = at(ym);
    for (const p of periods(r)) if (p.member === m.id) p.to = at(ym);
  };
  const scenarios: ((r: Obj) => void)[] = [
    () => {},
    leave(0, "2036-04"),
    leave(1, "2046-04"),
    (r) => {
      (periods(r)[0] as Obj).to = at("2041-04");
    },
  ];
  const out: Obj[] = [];
  for (const p of plans) {
    for (const s of scenarios) {
      const r = clone(base);
      r.trace = "none";
      p(r);
      s(r);
      out.push(r);
    }
  }
  return out;
}
