// ひとり親控除・寡婦控除の判定（tax.survivorStatus 改訂4。0156）: 離婚・未婚・死別のひとり親（男女とも）、婚姻の状態の欄（maritalStatus）と
// 世帯の関係の終わり方、事実婚、要件の境目（本人の合計所得金額500万円・子の総所得金額等62万円〔令和8年分〕）、寡婦（死別・離婚で扶養親族）
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import type { DeductionsOutput } from "../src/sdk/index.ts";
import { household, member, period, realPacks, uid } from "./helpers.ts";

type Obj = Record<string, unknown>;
const call = <T>(req: EngineRequest, component: string, input: unknown): T => runEngine(req, realPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const S = uid("sp-self");
const C = uid("sp-child");
const X = uid("sp-ex");
const at = (ym: string) => ({ at: ym });

/** ひとり親（本人。既定は女性・年収400万円）と子1人（2015年生まれ）。o.child の年収があれば子もパートで働く */
function parent(o: { sex?: "female" | "male"; annual?: number; child?: number | null; marital?: string; members?: Obj[]; relations?: Obj[]; contingencies?: Obj[] } = {}): EngineRequest {
  const req = household({
    baseMonth: "2026-01",
    endYear: 2028,
    members: [
      member("sp-self", "self", "1988-05", { sex: o.sex ?? "female", ...(o.marital !== undefined ? { maritalStatus: o.marital } : {}) }),
      ...(o.child === null ? [] : [member("sp-child", "child", o.child !== undefined ? "2006-05" : "2015-05")]),
      ...(o.members ?? []),
    ],
    relations: [...(o.child === null ? [] : [{ type: "parentOf", parent: S, child: C }]), ...(o.relations ?? [])],
    periods: [
      period("sp-job", { member: "sp-self", from: "2010-04", annual: o.annual ?? 4000000 }),
      ...(o.child !== undefined && o.child !== null ? [period("sp-kid", { member: "sp-child", from: "2025-04", annual: o.child, type: "partTime" })] : []),
    ],
  });
  if (o.contingencies !== undefined) (req.input as unknown as Obj).contingencies = o.contingencies;
  return req;
}
const ded = (req: EngineRequest, year = 2026, regime: "incomeTax" | "residentTax" = "incomeTax") => call<DeductionsOutput>(req, "tax.deductions", { member: S, year, regime });
const status = (req: EngineRequest, year = 2026) => call<{ widow: boolean; singleParent: boolean }>(req, "tax.survivorStatus", { member: S, year });
const total = (req: EngineRequest, who: string, year = 2026) => call<{ total: number }>(req, "tax.totalIncome", { member: who, year }).total;
/** 元の配偶者（世帯の関係の終わりと、翌月に世帯を離れる。0046） */
const ex = (to: string, marriage = "legal") => ({
  members: [member("sp-ex", "spouse", "1986-03", { sex: "male", leaves: at(nextMonth(to)) })],
  relations: [{ type: "spouse", a: S, b: X, marriage, from: null, to: at(to) }],
});
function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

describe("ひとり親控除（離婚・未婚のひとり親も。0156）", () => {
  it("配偶者のいない世帯で生計を一にする子がいれば、婚姻の状態を入れなくても（婚姻していないとみなす）ひとり親控除。所得税35万円・住民税30万円", () => {
    const req = parent();
    expect(status(req)).toEqual({ widow: false, singleParent: true });
    expect(ded(req).singleParent).toBe(350000);
    // 住民税（2026年の所得 → 令和9年度）は30万円
    expect(ded(req, 2026, "residentTax").singleParent).toBe(300000);
    expect(ded(req).widow).toBeUndefined();
  });

  it("未婚・離婚・死別（欄で入れた）のどれでも同じ。婚姻している（別居などで配偶者を世帯に入れていない）は受けない", () => {
    for (const m of ["unmarried", "divorced", "bereaved"]) expect(ded(parent({ marital: m })).singleParent).toBe(350000);
    const married = parent({ marital: "married" });
    expect(status(married)).toEqual({ widow: false, singleParent: false });
    expect(ded(married).singleParent).toBeUndefined();
  });

  it("男性のひとり親も同じ額。住民税の調整控除の人的控除額の差は母5万円・父1万円", () => {
    const mother = ded(parent(), 2026, "residentTax");
    const father = ded(parent({ sex: "male" }), 2026, "residentTax");
    expect(father.singleParent).toBe(300000);
    expect(mother.personalDiff - father.personalDiff).toBe(40000);
  });

  it("令和9年分から所得税は38万円（制度データの年ごとの値）", () => {
    expect(ded(parent(), 2027).singleParent).toBe(380000);
  });

  it("境目: 本人の合計所得金額500万円以下なら受け、1円でも超えたら受けない", () => {
    // 給与所得＝収入×90%−110万円の1円未満を切り捨て（所得税法別表第五の備考。0167）: 6,777,778円 → 5,000,000.2 → 5,000,000円
    const at500 = parent({ annual: 6777778 });
    const over = parent({ annual: 6777779 });
    expect(total(at500, S)).toBe(5000000);
    expect(total(over, S)).toBe(5000001);
    expect(ded(at500).singleParent).toBe(350000);
    expect(ded(at500, 2026, "residentTax").singleParent).toBe(300000);
    expect(status(over)).toEqual({ widow: false, singleParent: false });
    expect(ded(over, 2026, "residentTax").singleParent).toBeUndefined();
  });

  it("境目: 子の総所得金額等が62万円以下（令和8年分）なら生計を一にする子、超えたら子がいないのと同じ", () => {
    const at62 = parent({ child: 1360000 });
    const over = parent({ child: 1360001 });
    expect(total(at62, C)).toBe(620000);
    expect(total(over, C)).toBe(620001);
    expect(ded(at62).singleParent).toBe(350000);
    expect(status(over).singleParent).toBe(false);
  });

  it("子が世帯を離れた年の末からは受けない。世帯の外の子（離れて暮らす子）は生計を一にする子にしない", () => {
    const left = parent({ members: [] });
    (left.input.household.members[1] as unknown as Obj).leaves = at("2027-04");
    expect(status(left, 2026).singleParent).toBe(true);
    expect(status(left, 2027).singleParent).toBe(false);
    const outside = parent();
    (outside.input.household.members[1] as unknown as Obj).outside = { of: S, periods: [] };
    expect(status(outside).singleParent).toBe(false);
  });

  it("世帯の関係: 法律婚・事実婚の配偶者がいる年は受けない。離婚（関係の終わり）の後の年は受ける", () => {
    const divorce = parent(ex("2026-06"));
    expect(status(divorce, 2026).singleParent).toBe(true);
    const later = parent(ex("2027-06"));
    expect(status(later, 2026).singleParent).toBe(false);
    expect(status(later, 2027).singleParent).toBe(true);
    // 12月に終わる関係は、12月31日にはまだ配偶者（その年は受けない）
    expect(status(parent(ex("2026-12")), 2026).singleParent).toBe(false);
    // 事実婚のパートナーがいる間は受けない（住民票の「未届の夫・妻」）。関係が終われば受ける
    const partner = parent({ members: [member("sp-ex", "spouse", "1986-03", { sex: "male" })], relations: [{ type: "spouse", a: S, b: X, marriage: "deFacto", from: null, to: null }] });
    expect(status(partner)).toEqual({ widow: false, singleParent: false });
    expect(status(parent(ex("2026-03", "deFacto")), 2026).singleParent).toBe(true);
    // 婚姻の状態の欄が「婚姻している」でも、世帯の関係で離婚した後は離婚（関係が先）
    expect(status(parent({ ...ex("2026-03"), marital: "married" }), 2026).singleParent).toBe(true);
  });

  it("万一の想定で配偶者が亡くなった年の末からは、死別のひとり親（今までどおり）", () => {
    const req = parent({
      members: [member("sp-ex", "spouse", "1986-03", { sex: "male" })],
      relations: [{ type: "spouse", a: S, b: X, marriage: "legal", from: null, to: null }],
      contingencies: [{ id: uid("sp-cg"), kind: "death", member: X, occurs: at("2026-06") }],
    });
    expect(status(req, 2026).singleParent).toBe(true);
    expect(ded(req).singleParent).toBe(350000);
  });
});

describe("寡婦控除（ひとり親でない女性。0156）", () => {
  it("死別は扶養親族がいなくても寡婦（所得税27万円・住民税26万円）。未婚・省略・婚姻しているは寡婦にしない", () => {
    const bereaved = parent({ child: null, marital: "bereaved" });
    expect(status(bereaved)).toEqual({ widow: true, singleParent: false });
    expect(ded(bereaved).widow).toBe(270000);
    expect(ded(bereaved, 2026, "residentTax").widow).toBe(260000);
    for (const m of [undefined, "unmarried", "married"]) expect(status(parent({ child: null, ...(m !== undefined ? { marital: m } : {}) })).widow).toBe(false);
    // 男性は寡婦にしない（ひとり親でない男性の控除は無い）
    expect(status(parent({ child: null, marital: "bereaved", sex: "male" })).widow).toBe(false);
  });

  it("離婚は扶養親族がいるときだけ寡婦（扶養している同居の親）。合計所得金額500万円を超えれば受けない", () => {
    expect(status(parent({ child: null, marital: "divorced" })).widow).toBe(false);
    const mother = member("sp-mother", "parent", "1960-04", { support: { dependent: true, cohabiting: true } });
    const rel = [{ type: "parentOf", parent: uid("sp-mother"), child: S }];
    const withParent = parent({ child: null, marital: "divorced", members: [mother], relations: rel });
    expect(status(withParent)).toEqual({ widow: true, singleParent: false });
    expect(ded(withParent).widow).toBe(270000);
    expect(status(parent({ child: null, marital: "divorced", members: [mother], relations: rel, annual: 6777779 })).widow).toBe(false);
    // 世帯の関係の離婚でも同じ（扶養親族がいなければ受けない）
    expect(status(parent({ child: null, ...ex("2025-06") })).widow).toBe(false);
    expect(status(parent({ child: null, ...ex("2025-06"), members: [...ex("2025-06").members, mother], relations: [...ex("2025-06").relations, ...rel] })).widow).toBe(true);
  });

  it("子の所得が上限を超えてひとり親でなくなった死別の女性は寡婦。ひとり親に当たる年はひとり親控除だけ", () => {
    expect(status(parent({ child: 1360001, marital: "bereaved" }))).toEqual({ widow: true, singleParent: false });
    expect(status(parent({ child: 1360000, marital: "bereaved" }))).toEqual({ widow: false, singleParent: true });
  });
});
