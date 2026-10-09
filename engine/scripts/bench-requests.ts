// 速さの計測（0005 の「速さの回帰」）に使う要求: 100年分のモデル世帯（lifetime100Plan。lifetime100Assets（住まい・住宅ローン・
// NISA・iDeCo・企業型DC・課税口座）に生活費・子の教育・退職一時金・FP顧問料を足したもの。2026-10-09 に lifetime100Assets から替えた）から作る
// 5案×4想定の20件（すべて架空）。
// 案は前提・働き方の違い、想定は万一の想定（contingencies。2026-10-09 から本物の万一: 本人の死亡・配偶者の死亡・本人の障害（2級））。
// それまでは遺族年金などの部品が無かったので、構成員が世帯から抜ける・働けなくなる形で近似していた。
// 並びは「案ごとに4想定」（先頭の4件が1案×4想定）。
// スライダーの計測（0005 の追記の目標1）は、世帯の入力を変えてから（tweak）案と想定を当てる。案や想定の中で上書きされる入力は、その案・想定では変わらない
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_DIR } from "./lib.ts";

type Obj = Record<string, unknown>;
const at = (ym: string) => ({ at: ym });

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

const h = (r: Obj) => (r.input as Obj).household as Obj;
const members = (r: Obj) => h(r).members as Obj[];
const periods = (r: Obj) => h(r).employmentPeriods as Obj[];
const assumptions = (r: Obj) => ((r.input as Obj).assumptions ??= {}) as Obj;
const box = (v: unknown) => ({ value: v, state: "confirmed", origin: { kind: "manual" } });

/** スライダーで動かす入力（k は刻みの番号） */
export const SLIDERS: Readonly<Record<string, (r: Obj, k: number) => void>> = {
  // 案の前提（運用利回り）
  return: (r, k) => {
    assumptions(r).investmentReturn = { default: `0.0${100 + k}` };
  },
  // 配偶者の年収
  salary: (r, k) => {
    ((periods(r)[1] as Obj).salary as Obj).annual = box(3800000 + k * 10000);
  },
  // 本人の年収
  selfSalary: (r, k) => {
    ((periods(r)[0] as Obj).salary as Obj).annual = box(4600000 + k * 10000);
  },
  // 本人の退職の年齢（勤め先の期間の終わり。2055〜2061年）
  retire: (r, k) => {
    (periods(r)[0] as Obj).to = at(`${2055 + (k % 7)}-04`);
  },
  // 本人の NISA の積立の月額
  nisa: (r, k) => {
    const a = (h(r).accounts as Obj[]).find((x) => x.kind === "nisa") as Obj;
    ((a.contributions as Obj[])[0] as Obj).monthly = 30000 + k * 1000;
  },
  // 生活費の月額（新しい部品の入力）
  living: (r, k) => {
    const lv = h(r).livingExpenses as Obj[] | undefined;
    if (lv !== undefined) (lv[0] as Obj).monthly = box(260000 + k * 5000);
  },
};

export function benchRequests(tweak?: (r: Obj) => void): Obj[] {
  const base = JSON.parse(readFileSync(join(REPO_DIR, "data", "modelHouseholds", process.env.BENCH_HOUSEHOLD ?? "lifetime100Plan.json"), "utf8")) as Obj;
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
  // 想定: なし／本人が2036年4月に死亡／配偶者が2046年4月に死亡／本人が2041年4月に障害（2級の想定）
  const contingency = (i: number, kind: string, ym: string, extra: Obj = {}) => (r: Obj) => {
    (r.input as Obj).contingencies = [{ id: `00000000-0000-4000-8000-00000000000${i}`, kind, member: (members(r)[kind === "death" && i === 2 ? 1 : 0] as Obj).id, occurs: at(ym), ...extra }];
  };
  const scenarios: ((r: Obj) => void)[] = [() => {}, contingency(1, "death", "2036-04"), contingency(2, "death", "2046-04"), contingency(3, "disability", "2041-04", { grade: 2 })];
  const out: Obj[] = [];
  for (const p of plans) {
    for (const s of scenarios) {
      const r = clone(base);
      r.trace = "none";
      // 世帯の入力（スライダー）→ 案 → 想定の順に当てる（案や想定が同じ入力を変えるときは、そちらが勝つ）
      tweak?.(r);
      p(r);
      s(r);
      out.push(r);
    }
  }
  return out;
}

/** 必要保障額の推移（0005 の追記 2026-10-09）: 計測の世帯の万一なしの要求に、夫婦2人の推移（積み上げ方式）を求める指定を足したもの */
export function protectionRequest(): Obj {
  const r = benchRequests()[0] as Obj;
  (r.input as Obj).protection = { members: [(members(r)[0] as Obj).id, (members(r)[1] as Obj).id], method: "accumulation" };
  return r;
}
