// 帳票の中で時点を読む所（0168）: 年月（{at}）・構成員の年齢（{memberAge}）・名前つきの出来事（{event}）のどの形でも、同じ月なら同じ帳票になる。
// アプリが標準で書く年齢の形（子の独立・保険の払込の終わり・働き方の詳細の終わりなど）が帳票から消えないための見張り
import { describe, expect, it } from "vitest";
import { buildProposalInput, surplusText } from "../src/build.ts";
import type { EngineRequest, ProposalBundle } from "../src/bundle.ts";
import type { ProposalInput } from "../src/input.ts";
import { saleVariants } from "../src/rentalSale.ts";
import { monthOfTimepoint } from "../src/timepoint.ts";
import { modelHousehold, runAll } from "../scripts/engine.ts";

type Household = EngineRequest["input"]["household"];
type Member = Household["members"][number];
/** 見本の要求の欄を書き換える（型の readonly を外す。写しにだけ使う） */
const set = (o: object, k: string, v: unknown): void => {
  (o as Record<string, unknown>)[k] = v;
};

/** 現状と提案を同じ世帯（それぞれ req0・req1）で計算した材料から、帳票の入力を作る */
function inputOf(current: EngineRequest, proposal: EngineRequest = current): ProposalInput {
  const [c, p] = runAll([current, proposal]);
  const bundle: ProposalBundle = { document: { issuedOn: "2026-11-07", preparedBy: null }, current: c!, proposal: p!, targetAge: 95 };
  return buildProposalInput(bundle);
}

const eventsWith = (input: ProposalInput, word: string): string[] => input.events.flatMap((e) => e.items.filter((t) => t.includes(word)).map((t) => `${e.year} ${t}`));
const self = (h: Household): Member => h.members.find((m) => m.kind === "self") as Member;
/** 年月 at の月に達する年齢（年・月）の時点 */
function ageOfMonth(m: Member, at: string): { memberAge: { member: string; years: number; months: number } } {
  const [by, bm] = m.birth.birthYearMonth.split("-").map(Number) as [number, number];
  const [ty, tm] = at.split("-").map(Number) as [number, number];
  const months = ty * 12 + tm - (by * 12 + bm);
  return { memberAge: { member: m.id, years: Math.floor(months / 12), months: months % 12 } };
}

describe("時点を解く（monthOfTimepoint）", () => {
  const h = modelHousehold("salariedCoupleTwoKids").input.household;
  const kid = h.members.find((m) => m.kind === "child") as Member;
  it("年月・年齢（年齢の切り替えの規則つき）・出来事のずらしを、エンジンと同じ月に解く", () => {
    expect(monthOfTimepoint(h, { at: "2035-04" })).toBe("2035-04");
    // 2012年5月生まれの22歳の学年の始まり（schoolYear）は 2035年4月
    expect(monthOfTimepoint(h, { memberAge: { member: kid.id, years: 22, ageSwitch: "schoolYear" } })).toBe("2035-04");
    expect(monthOfTimepoint(h, { memberAge: { member: kid.id, years: 22 } })).toBe("2034-05");
    const ev = h.events?.[0] as { id: string };
    expect(monthOfTimepoint(h, { event: ev.id, offset: { years: 1, months: 2 } })).toBe("2017-06");
  });
  it("解けない時点（空・いない構成員・無い出来事）は null", () => {
    expect(monthOfTimepoint(h, null)).toBeNull();
    expect(monthOfTimepoint(h, undefined)).toBeNull();
    expect(monthOfTimepoint(h, { memberAge: { member: "00000000-0000-4000-8000-000000000000", years: 22 } })).toBeNull();
    expect(monthOfTimepoint(h, { event: "00000000-0000-4000-8000-000000000000" })).toBeNull();
  });
});

describe("子の独立・加わる時点（家族の年齢の行・ライフイベント表）", () => {
  const atReq = modelHousehold("salariedCoupleTwoKids");
  const ageReq = structuredClone(atReq);
  for (const m of ageReq.input.household.members) if (m.kind === "child") set(m, "leaves", { memberAge: { member: m.id, years: 22, ageSwitch: "schoolYear" } });
  const at = inputOf(atReq);
  const age = inputOf(ageReq);
  it("子の独立を年齢の形で持っても「第1子が独立」が独立の年に出る（年月の形と同じ）", () => {
    expect(eventsWith(at, "が独立")).toEqual(["2035 第1子が独立", "2038 第2子が独立"]);
    expect(eventsWith(age, "が独立")).toEqual(eventsWith(at, "が独立"));
  });
  it("独立した翌年から、家族の行の子の年齢は空（年月の形と同じ）", () => {
    const i = age.basis.years.indexOf(2040);
    expect(age.members.find((m) => m.key === "child1")?.ages[i]).toBeNull();
    expect(age.members).toEqual(at.members);
  });
  it("加わる時点のある配偶者（結婚の予定）は、加わる年から年齢を出す", () => {
    const req = structuredClone(atReq);
    const sp = req.input.household.members.find((m) => m.kind === "spouse") as Member;
    set(sp, "joins", { at: "2030-04" });
    const input = inputOf(req);
    const ages = input.members.find((m) => m.key === "spouse")?.ages ?? [];
    expect(ages[input.basis.years.indexOf(2029)]).toBeNull();
    expect(ages[input.basis.years.indexOf(2030)]).toBe(2030 - 1983);
    // ライフイベント表の年齢の文にも、加わる前の年は出さない
    expect(input.events.filter((e) => e.year < 2030).every((e) => !e.ages.includes("配偶者"))).toBe(true);
  });
});

describe("保険料の払込の終わり", () => {
  it("年齢の形でも「（○年○月まで）」が付く（年月の形と同じ）", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const c = req.input.household.insuranceContracts[0] as Household["insuranceContracts"][number];
    const reqAge = structuredClone(req);
    set(reqAge.input.household.insuranceContracts[0] as typeof c, "premium", { ...c.premium, payUntil: { memberAge: { member: c.insured, years: 60, months: 0 } } });
    const reqAt = structuredClone(req);
    set(reqAt.input.household.insuranceContracts[0] as typeof c, "premium", { ...c.premium, payUntil: { at: "2041-07" } });
    const a = inputOf(reqAge).insurance?.contracts[0]?.premium;
    const b = inputOf(reqAt).insurance?.contracts[0]?.premium;
    expect(b).toBe("月額15,000円（2041年7月まで）");
    expect(a).toBe(b);
  });
});

describe("働き方の期間の終わり（退職）", () => {
  it("年齢の形でも、退職の出来事・退職の年の資産・退職後の収支が年月の形と同じ", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const s = self(req.input.household);
    const reqAge = structuredClone(req);
    const p = reqAge.input.household.employmentPeriods.find((e) => e.member === s.id) as Household["employmentPeriods"][number];
    set(p, "to", ageOfMonth(s, "2041-06"));
    const at = inputOf(req);
    const age = inputOf(reqAge);
    expect(eventsWith(at, "ご本人が退職")).toEqual(["2041 ご本人が退職（60歳）"]);
    expect(eventsWith(age, "ご本人が退職")).toEqual(eventsWith(at, "ご本人が退職"));
    expect(age.retirement?.atRetirement).toEqual(at.retirement?.atRetirement);
    expect(age.retirement?.afterRetirement).toEqual(at.retirement?.afterRetirement);
  });
});

describe("年金の受け取り開始", () => {
  it("年金の記録の無い人は、構成員の受け取り開始（pensionClaim）を読む（打ち手が書く形）", () => {
    const req = modelHousehold("advisoryFeeProposal");
    const s = self(req.input.household);
    // 70歳に達した月の翌月（1983年8月生まれ → 2053年9月）
    set(s, "pensionClaim", { basic: { at: "2053-09" }, employee: { at: "2053-09" } });
    expect(eventsWith(inputOf(req), "ご本人が年金")).toEqual([]);
    // 表の期間（2045年まで）の外なので出ない。表の中に入るよう、65歳より前（繰上げ 62歳）にした年で確かめる
    set(s, "pensionClaim", { basic: { at: "2045-09" }, employee: { at: "2045-09" } });
    expect(eventsWith(inputOf(req), "ご本人が年金")).toEqual(["2045 ご本人が年金の受け取りを開始（62歳）"]);
  });
  it("受け取り開始を年齢の形で書いても同じ", () => {
    const req = modelHousehold("advisoryFeeProposal");
    const s = self(req.input.household);
    const age62 = { memberAge: { member: s.id, years: 62, ageSwitch: "monthAfterReach" } };
    set(s, "pensionClaim", { basic: age62, employee: structuredClone(age62) });
    expect(eventsWith(inputOf(req), "ご本人が年金")).toEqual(["2045 ご本人が年金の受け取りを開始（62歳）"]);
  });
});

describe("FP顧問料の始まり・終わり・単発・料金の段階", () => {
  it("年齢・出来事の形でも、年月の形と同じ文になる", () => {
    const req = modelHousehold("advisoryFeeProposal");
    const s = self(req.input.household);
    const f = (req.input.household.advisoryFees ?? [])[0] as NonNullable<Household["advisoryFees"]>[number];
    const rec = f.terms?.recurring as NonNullable<NonNullable<typeof f.terms>["recurring"]>;
    (rec as { to?: unknown }).to = { at: "2040-12" };
    (rec as { revision?: unknown }).revision = { steps: [{ id: `${f.id.slice(0, -4)}0001`, at: { at: "2030-01" }, annual: 150000 }] };
    const reqAge = structuredClone(req);
    const f2 = (reqAge.input.household.advisoryFees ?? [])[0] as typeof f;
    const rec2 = f2.terms?.recurring as typeof rec;
    set(rec2, "from", ageOfMonth(s, "2027-01"));
    (rec2 as { to?: unknown }).to = ageOfMonth(s, "2040-12");
    (rec2 as { revision?: { steps: { at: unknown }[] } }).revision!.steps[0]!.at = ageOfMonth(s, "2030-01");
    set((f2.terms?.oneTime ?? [])[0]!, "at", ageOfMonth(s, "2026-11"));
    const a = inputOf(req).assumptions.advisoryFee;
    const b = inputOf(reqAge).assumptions.advisoryFee;
    expect(a?.contracts[0]?.recurring).toMatchObject({ from: "2027年1月", to: "2040年12月", revision: "2030年1月から年150,000円" });
    expect(a?.contracts[0]?.oneTime).toEqual([{ month: "2026年11月", amount: 300000 }]);
    expect(b?.contracts).toEqual(a?.contracts);
  });
});

describe("黒字のうち貯まる割合の時期", () => {
  it("年月・年齢・出来事のどの形でも、解いた年で書く", () => {
    const h = modelHousehold("salariedCoupleTwoKids").input.household;
    const s = self(h);
    const ev = (h.events?.[0] as { id: string }).id;
    const text = (from: unknown) => surplusText({ ratio: "0.6", changes: [{ from, ratio: "0.8" }] } as never, h);
    expect(text({ at: "2041-07" })).toMatch(/^60%、2041年から80%/);
    expect(text(ageOfMonth(s, "2041-07"))).toMatch(/^60%、2041年から80%/);
    expect(text({ event: ev, offset: { years: 25 } })).toMatch(/^60%、2041年から80%/);
  });
});

describe("収益不動産の売る年の案", () => {
  it("今の予定の売却を年齢の形で入れても、5年前・5年後の案を作る（年月の形と同じ）", () => {
    const req = modelHousehold("rentalSample");
    const s = self(req.input.household);
    const a = (req.input.household.accounts ?? []).find((x) => x.property?.sale !== undefined && x.property.sale !== null) as NonNullable<Household["accounts"]>[number];
    const at = saleVariants(req, a.id);
    const reqAge = structuredClone(req);
    const a2 = (reqAge.input.household.accounts ?? []).find((x) => x.id === a.id) as typeof a;
    (a2.property as { sale: { at: unknown } }).sale.at = ageOfMonth(s, "2041-10");
    expect(at.map((v) => v.key)).toEqual(["earlier", "planned", "later", "hold"]);
    expect(saleVariants(reqAge, a.id)).toEqual(at);
  });
});
