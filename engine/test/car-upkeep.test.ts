// 車の維持費の入れ方と内訳の名前つきの行（expense.car 改訂3・0069）のテスト（L1）。
// 入れ方が合計なら内訳を数えず、内訳なら合計を数えない。省略は前の形（入っている物を全部数える）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import { box, fictionalPacks, household, member, uid } from "./helpers.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
type Flow = { row: string; ym: string; amount: number; member?: string; object?: string; formula: string };
const A = uid("a");
const at = (ym: string) => ({ at: ym });
const withCar = (car: Obj): Req => {
  const r = JSON.parse(JSON.stringify(household({ members: [member("a", "self", "1980-01")], endYear: 2032, baseMonth: "2027-01" }))) as Req;
  const h = (r.input as unknown as Obj).household as Obj;
  h.accounts = [{ id: uid("dep"), kind: "deposit", owner: A, marketValue: box(10000000), asOf: "2027-01", contributions: [] }];
  h.cars = [{ id: uid("car"), owner: A, purchase: { first: at("2027-04"), everyYears: 10, price: 2000000 }, growth: { kind: "none" }, ...car }];
  return r;
};
const flows = (req: Req) => (runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component: "expense.car", input: { member: A } } }).entryOutput as { flows: Flow[] }).flows;
const yearOf = (fs: readonly Flow[], y: number, f: (x: Flow) => boolean = () => true) => fs.filter((x) => x.ym.startsWith(`${y}-`) && x.formula !== "expense.car.purchase" && f(x)).reduce((s, x) => s + x.amount, 0);

const both = { upkeep: { annual: 360000 }, tax: { annual: 36000 }, insurance: { annual: 70000 }, inspection: { amount: 100000 }, parking: { annual: 120000 }, fuel: { annual: 60000 } };

describe("車の維持費の入れ方（expense.car 改訂3）", () => {
  it("合計（total）: 合計だけを数え、残してある内訳は数えない", () => {
    const fs = flows(withCar({ ...both, upkeepMode: "total", upkeepOther: [{ id: uid("o1"), label: "タイヤ", annual: 24000 }] }));
    expect(yearOf(fs, 2028)).toBe(360000);
    expect(fs.some((x) => ["expense.car.tax", "expense.car.insurance", "expense.car.inspection", "expense.car.parking", "expense.car.fuel", "expense.car.other"].includes(x.formula))).toBe(false);
  });

  it("内訳（detail）: 内訳と名前つきの行だけを数え、残してある合計は数えない。名前つきの行は年額の12分の1を毎月（車の維持費の行）", () => {
    const fs = flows(withCar({ ...both, upkeepMode: "detail", upkeepOther: [{ id: uid("o1"), label: "タイヤ", annual: 24000 }, { id: uid("o2"), annual: 12005 }] }));
    expect(fs.some((x) => x.formula === "expense.car.upkeep")).toBe(false);
    // 2028年: 税 36,000・保険 70,000・駐車場 120,000・燃料 60,000・名前つきの行 24,000＋12,005（車検は購入から3年後の2030年）
    expect(yearOf(fs, 2028)).toBe(36000 + 70000 + 120000 + 60000 + 24000 + 12005);
    const other = fs.filter((x) => x.formula === "expense.car.other");
    expect(other.every((x) => x.row === "cf.expense.living.car")).toBe(true);
    expect(yearOf(fs, 2028, (x) => x.formula === "expense.car.other")).toBe(36005);
    expect(other.filter((x) => x.ym === "2028-01").map((x) => x.amount).sort((a, b) => a - b)).toEqual([1005, 2000]);
    expect(yearOf(fs, 2030, (x) => x.formula === "expense.car.inspection")).toBe(100000);
  });

  it("省略は前の形: 入っている物を全部数える（古い世帯の結果は変わらない）。名前つきの行も数える", () => {
    const fs = flows(withCar({ ...both, upkeepOther: [{ id: uid("o1"), annual: 24000 }] }));
    expect(yearOf(fs, 2028)).toBe(360000 + 36000 + 70000 + 120000 + 60000 + 24000);
  });

  it("名前つきの行も、手放した月の後は数えない", () => {
    const fs = flows(withCar({ upkeepMode: "detail", upkeepOther: [{ id: uid("o1"), annual: 12000 }], until: at("2029-06") }));
    expect(fs.filter((x) => x.formula === "expense.car.other").map((x) => x.ym).at(-1)).toBe("2029-06");
  });
});
