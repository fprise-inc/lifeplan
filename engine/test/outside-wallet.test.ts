// 世帯の外の家族のお金（簡易の家計。0042）: 預金＋その人のお金の動き（年金など−税・社会保険料）＋一時の入金−生活費−その人が介護を受ける費用を
// 月ごとに積み、介護の費用はまずそのお金から払い、尽きた月から世帯が払う。預金の欄が空なら今と同じ（世帯が全部払う）。
// 家計を1つにする期間のうち収入を世帯に入れる月は、介護の費用も世帯が払い、その人のお金に年金を入れない。生活費の人数に入れる月は生活費を引かない
import { describe, expect, it } from "vitest";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { box, modelHousehold, realPacks, uid } from "./helpers.ts";

type Obj = Record<string, unknown>;
const PARENT = "50d3372e-bf13-4d73-8a13-617045d991c5";
const SELF = "79398e84-f736-4f5a-8324-194edbd7091e";
/** 親が施設で介護を受ける費用（2027年4月から60か月） */
const CARE = "e1169764-5414-4445-b691-9df2bf027667";
const run = (req: EngineRequest): EngineResult => runEngine(req, realPacks(), {});

/** 見本の世帯（親の介護）の親に、お金と家計を1つにする期間を入れる */
function parentCare(wallet: Obj | null, periods?: Obj[]): EngineRequest {
  const req = structuredClone(modelHousehold("parentCare")) as unknown as { input: { household: { members: Obj[] } } };
  const p = req.input.household.members.find((m) => m.id === PARENT) as Obj;
  if (wallet !== null) p.wallet = wallet;
  if (periods !== undefined) (p.outside as Obj).periods = periods;
  return req as unknown as EngineRequest;
}

/** 親の介護の費用のうち、世帯が払った月ごとの額 */
function householdCare(r: EngineResult): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of r.flows) if (f.object === CARE) out.set(f.ym, (out.get(f.ym) ?? 0) + f.amount);
  return out;
}
const depleted = (r: EngineResult): string | null => {
  const w = (r.summary as { outsideWallets?: { member: string; depleted: string | null }[] }).outsideWallets?.find((x) => x.member === PARENT);
  if (w === undefined) throw new Error("outsideWallets に親が無い");
  return w.depleted;
};
const financial2040 = (r: EngineResult) => (r.table as unknown as { row: string; year: number; amount: number }[]).find((c) => c.row === "cf.balance.financial" && c.year === 2040)?.amount ?? 0;
const months = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let [y, m] = from.split("-").map(Number) as [number, number]; `${y}-${String(m).padStart(2, "0")}` <= to; m === 12 ? ((y += 1), (m = 1)) : (m += 1)) out.push(`${y}-${String(m).padStart(2, "0")}`);
  return out;
};

describe("世帯の外の家族のお金", () => {
  const none = run(parentCare(null));
  const full = householdCare(none);

  it("預金の欄が空なら今と同じ（世帯が全部払う）。生活費だけ入れても変わらない", () => {
    const livingOnly = run(parentCare({ living: box(100000) }));
    expect(livingOnly.flows).toEqual(none.flows);
    expect(livingOnly.table).toEqual(none.table);
    expect((none.summary as Obj).outsideWallets).toBeUndefined();
    expect((livingOnly.summary as Obj).outsideWallets).toBeUndefined();
  });

  it("介護の費用はまず親のお金から払い、尽きた月から世帯が払う（尽きる月を要約に出す）", () => {
    const r = run(parentCare({ balance: box(3000000), living: box(200000) }));
    const d = depleted(r);
    expect(d).toMatch(/^2027-|^2028-/);
    const mine = householdCare(r);
    for (const ym of months("2027-04", "2032-03")) {
      const all = full.get(ym) ?? 0;
      const paid = mine.get(ym) ?? 0;
      if (ym < (d as string)) expect(paid, ym).toBe(0);
      else if (ym > (d as string)) expect(paid, ym).toBe(all);
      else {
        expect(paid).toBeGreaterThan(0);
        expect(paid).toBeLessThanOrEqual(all);
      }
    }
    // 世帯の外の家族のお金から払った分だけ、世帯の金融資産が増える
    expect(financial2040(r)).toBeGreaterThan(financial2040(none));
  });

  it("尽きなければ世帯は親の介護の費用を払わない（尽きる月は null）", () => {
    const r = run(parentCare({ balance: box(40000000), living: box(100000) }));
    expect(depleted(r)).toBeNull();
    expect([...householdCare(r).values()].reduce((s, v) => s + v, 0)).toBe(0);
  });

  it("収入を世帯に入れる期間の月は、介護の費用を世帯が払い、親のお金は使わない", () => {
    const period = { id: uid("ow-p1"), from: { at: "2027-04" }, to: { at: "2028-03" }, living: true, income: true };
    const r = run(parentCare({ balance: box(40000000), living: box(100000) }, [period]));
    const mine = householdCare(r);
    for (const ym of months("2027-04", "2032-03")) expect(mine.get(ym) ?? 0, ym).toBe(ym <= "2028-03" ? (full.get(ym) ?? 0) : 0);
    // その間の親の年金は世帯の収入に入る
    expect(r.flows.some((f) => f.member === PARENT && f.row === "cf.income.pension" && f.ym >= "2027-04" && f.ym <= "2028-03")).toBe(true);
    expect(r.flows.some((f) => f.member === PARENT && f.row === "cf.income.pension" && f.ym > "2028-03")).toBe(false);
  });

  it("生活費の人数に入れる期間（収入は別）の月は、親のお金から生活費を引かない（尽きるのが遅くなる）", () => {
    const wallet = { balance: box(3000000), living: box(200000) };
    const plain = depleted(run(parentCare(wallet))) as string;
    const living = depleted(run(parentCare(wallet, [{ id: uid("ow-p2"), from: null, to: null, living: true, income: false }])));
    expect(living === null || living > plain).toBe(true);
  });

  it("年金はエンジンの推計を使い、入れた額があればそれを使う", () => {
    const wallet = { balance: box(3000000), living: box(200000) };
    const estimated = depleted(run(parentCare(wallet))) as string;
    const more = depleted(run(parentCare({ ...wallet, pension: box(4000000) })));
    const zero = depleted(run(parentCare({ ...wallet, pension: box(0) }))) as string;
    expect(more === null || more > estimated).toBe(true);
    expect(zero < estimated).toBe(true);
  });

  it("一時の入金はその月に親のお金に入る（尽きるのが遅くなる）", () => {
    const wallet = { balance: box(3000000), living: box(200000) };
    const plain = depleted(run(parentCare(wallet))) as string;
    const lump = depleted(run(parentCare({ ...wallet, lumpSums: [{ id: uid("ow-l1"), at: { at: "2027-06" }, amount: box(5000000) }] })));
    expect(lump === null || lump > plain).toBe(true);
  });

  it("お金は世帯の外の家族で生年月のある人だけ（世帯の中の人に入れると入力の形の誤り）", () => {
    const req = structuredClone(modelHousehold("parentCare")) as unknown as { input: { household: { members: Obj[] } } };
    (req.input.household.members.find((m) => m.id === SELF) as Obj).wallet = { balance: box(1000000) };
    expect(() => run(req as unknown as EngineRequest)).toThrow("E_INPUT_SCHEMA");
  });
});
