// ありえない結果の見張り（同じ種類の誤りを二度と気づかれずに入れないための点検）: 見本の棚の全部の世帯・data/modelHouseholds の世帯・
// 入力の操作で作る世帯（watch/cases.ts）を計算に通し、見張りの決まり（watch/rules.ts）を毎回当てる。
// - 今ある不具合で決まりに引っかかる物は「直す待ちの一覧」（PENDING）に入れる。一覧の行は、その行に当たるおかしい所を除いて見張り、
//   行そのものは「まだおかしい所があること」を確かめる形（test.fails）で通す
// - 直したら、その行を PENDING から消す。消し忘れると「直ったのに一覧に残っている」で、その行の test.fails が落ちる
// - 最後に、決まりがおかしい所を見つけられることを、わざと壊した世帯・結果で確かめる（直す待ちの一覧が空になっても見張りが効くように）
import { beforeAll, describe, expect, it, test } from "vitest";
import type { EngineRequest, PreviewResult, TableCell } from "../src/engine/types.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { WATCH_CASES } from "./watch/cases.ts";
import { housingConditions, rowGroupingProblems, subjectOf, textProblems, WATCH_RULES, type WatchSubject } from "./watch/rules.ts";
import { modelHousehold, preview } from "./helpers.ts";

/** 直す待ちの一覧の1行 */
interface Pending {
  /** 行の鍵（直すときにこの鍵で探して消す） */
  key: string;
  /** 何が直す待ちか（中身の言葉で） */
  what: string;
  rule: string;
  /** 当たる世帯（WatchCase の name）。"all" は全部の世帯 */
  cases: readonly string[] | "all";
  /** 当たるおかしい所の文 */
  match: RegExp;
}

const OP = (s: string) => `操作 ${s}`;

/** 直す待ちの一覧（今ある不具合。直したまとまりがその行を消す） */
const PENDING: readonly Pending[] = [
  {
    key: "vocational-fee-in-sample",
    what: "ひとり親と子2人の見本の第2子（専門学校・私立）の学費が入っていない",
    rule: "schoolFeeZero",
    cases: ["見本 4-3-01"],
    match: /学費が入っていない/,
  },
  {
    key: "imported-work-no-end",
    what: "ヒアリングシートから取り込んだ会社員・パートの働き方に終わりが無く、100歳を過ぎても給与が入る",
    rule: "workToTableEnd",
    cases: [OP("ヒアリングシートを取り込む")],
    match: /期間に終わりが無く/,
  },
  {
    key: "kept-home-vanishes",
    what: "持ち家に住み終わりを入れると、「そのまま持つ」のまま住み終わりの年で資産から消える",
    rule: "keptHomeVanishes",
    cases: [OP("持ち家に住み終わりを入れる")],
    match: /資産から消える/,
  },
  {
    key: "sold-home-loan",
    what: "住まいを住み終わりの月に売っても、その家の住宅ローンを返し続ける",
    rule: "soldHomeLoanContinues",
    cases: [OP("住宅ローンの残る持ち家を売る")],
    match: /返している/,
  },
  {
    key: "housing-overlap-notice",
    what: "持ち家の世帯に購入の予定を足すと、今の家が終わらず住まいが2つ重なり、知らせも無い",
    rule: "housingOverlapGap",
    cases: [OP("持ち家の世帯に住宅購入の予定を足す")],
    match: /2つ重なる/,
  },
  {
    key: "housing-gap-notice",
    what: "最後の住まいの住み終わりの後に住まいが無い（住居費0円）のに、知らせが無い",
    rule: "housingOverlapGap",
    cases: [OP("持ち家に住み終わりを入れる"), OP("住宅ローンの残る持ち家を売る")],
    match: /先の住まいが入っていない/,
  },
  {
    key: "purchase-dates-follow",
    what: "購入の時期を直しても、住み始め・借入の年月・控除の入居がついてこない",
    rule: "purchaseDates",
    cases: [OP("購入の時期を1年遅らせる")],
    match: /ずれている/,
  },
  {
    key: "home-value-in-models",
    what: "持ち家の時価の元（評価額・購入の価格）が無いモデル世帯で、今の家が資産に入らず純資産が大きくマイナス",
    rule: "negativeNetWorthNow",
    cases: ["モデル pairLoan", "モデル pairLoanDeath", "モデル protectionNeed", "モデル survivorEmployeeLoan"],
    match: /純資産が|資産に入っていない/,
  },
  {
    key: "home-value-imported",
    what: "ヒアリングシートから取り込んだ持ち家に時価の元が無く、今の家が資産に入らず純資産が大きくマイナス",
    rule: "negativeNetWorthNow",
    cases: [OP("ヒアリングシートを取り込む")],
    match: /純資産が|資産に入っていない/,
  },
  {
    key: "care-after-death",
    what: "介護を受ける人の亡くなる見込みを入れても、介護の費用が亡くなった後も続く",
    rule: "careAndInheritanceAfterDeath",
    cases: [OP("介護の途中で亡くなる見込みを入れる")],
    match: /介護の費用が/,
  },
  {
    key: "inheritance-timing-counterparty",
    what: "受け取る相続の相手を変えても、受け取る時期の推定が前の相手の亡くなる見込みのまま",
    rule: "careAndInheritanceAfterDeath",
    cases: [OP("受け取る相続の相手を変える")],
    match: /受け取る相続の時期/,
  },
  {
    key: "living-stages-follow",
    what: "退職後の生活費の割合を下げても、推定の70歳・80歳の段が追いかけず、退職直後より高い",
    rule: "livingStagesRise",
    cases: [OP("退職後の生活費の割合だけを下げる")],
    match: /より高い/,
  },
  {
    key: "business-and-pension-rows",
    what: "事業所得・企業年金（iDeCo・小規模企業共済・個人年金を含む）がキャッシュフロー表の「その他の収入」に入り、事業所得はグラフでは給与に入る",
    rule: "rowGrouping",
    cases: "all",
    match: /cf\.income\.(business|corporatePension)/,
  },
  {
    key: "allocation-passed",
    what: "運用の入れ方を資産配分に切り替えても、画面に出している割合・期待リターンが計算に渡らない",
    rule: "allocationPassed",
    cases: [OP("運用の入れ方を資産配分に切り替える")],
    match: /渡っていない/,
  },
  {
    key: "zero-cost-basis",
    what: "NISA・課税口座を足すと、取得価額が0円で入る",
    rule: "zeroCostBasis",
    cases: [OP("NISA と課税口座を足して残高を入れる")],
    match: /取得価額が0円/,
  },
  {
    key: "internal-names-in-lists",
    what: "世帯の中身の一覧・違いの一覧・変えたことに、内部の名前（incomeFlow・member など）や生の値（home → facility）が出る",
    rule: "screenWords",
    cases: [OP("受け取る相続の相手を変える"), OP("相続・贈与の行とプランの違い")],
    match: /(世帯の中身の一覧|違いの一覧|変えたこと)/,
  },
];

const caseNames = WATCH_CASES.map((c) => c.name);
const appliesTo = (p: Pending, name: string): boolean => p.cases === "all" || p.cases.includes(name);
const subjects = new Map<string, WatchSubject>();
const subject = (name: string): WatchSubject => {
  const s = subjects.get(name);
  if (s === undefined) throw new Error(`世帯を作れていない: ${name}`);
  return s;
};

beforeAll(async () => {
  for (const c of WATCH_CASES) subjects.set(c.name, subjectOf(c.name, await c.build(), { imported: c.imported === true }));
}, 300_000);

describe("直す待ちの一覧の形", () => {
  it("鍵は重ならず、決まり・世帯はどれも在る物を指す", () => {
    expect(new Set(PENDING.map((p) => p.key)).size).toBe(PENDING.length);
    const rules = new Set(WATCH_RULES.map((r) => r.id));
    for (const p of PENDING) {
      expect(rules.has(p.rule), p.key).toBe(true);
      if (p.cases !== "all") for (const c of p.cases) expect(caseNames, `${p.key}: ${c}`).toContain(c);
    }
  });

  it("世帯の名前は重ならない", () => {
    expect(new Set(caseNames).size).toBe(caseNames.length);
  });
});

describe.each(WATCH_CASES.map((c) => c.name))("%s", (name) => {
  for (const rule of WATCH_RULES) {
    it(rule.title, () => {
      const pend = PENDING.filter((p) => p.rule === rule.id && appliesTo(p, name));
      const left = rule.check(subject(name)).filter((t) => !pend.some((p) => p.match.test(t)));
      expect(left).toEqual([]);
    });
  }
});

describe("直す待ちの一覧（まだおかしい所があることを確かめる。直したら行を消す）", () => {
  for (const p of PENDING) {
    test.fails(`直す待ち: ${p.what}（${p.key}）`, () => {
      const rule = WATCH_RULES.find((r) => r.id === p.rule)!;
      const hits = caseNames.filter((n) => appliesTo(p, n)).flatMap((n) => rule.check(subject(n)).filter((t) => p.match.test(t)));
      expect(hits).toEqual([]);
    });
  }
});

// ---- 見張りが見張れていること（わざと壊した世帯・結果） ----

const ruleOf = (id: string) => WATCH_RULES.find((r) => r.id === id)!;
const clone = <T>(v: T): T => structuredClone(v);
/** 要求を壊して計算し直した世帯（作業の層の印も足せる） */
function brokenInput(id: string, edit: (req: EngineRequest) => void, assumed: Record<string, string> = {}, imported = false): WatchSubject {
  const req = clone(modelHousehold(id));
  edit(req);
  const wh0 = fromRequest(req);
  const wh: WorkingHousehold = { ...wh0, assumed: { ...wh0.assumed, ...assumed } };
  return subjectOf(`壊した ${id}`, wh, { imported });
}
/** 結果の表を壊した世帯（計算の結果の誤りを写す） */
function brokenResult(s: WatchSubject, edit: (table: TableCell[]) => TableCell[]): WatchSubject {
  const result: PreviewResult = { ...s.result, table: edit(clone(s.result.table)) };
  return { ...s, result };
}
const self = (req: EngineRequest) => req.input.household.members.find((m) => m.kind === "self")!;

describe("見張りが見張れていること（わざと壊した世帯・結果で、おかしい所を見つける）", () => {
  it("学費の無い学校の段（専門学校・私立に学費を入れない）", () => {
    const s = brokenInput("salariedCoupleTwoKids", (req) => {
      const g = (req.input.household.goals ?? []).find((x) => x.education !== undefined)!;
      g.education!.stages = [...g.education!.stages.filter((x) => x.stage !== "university"), { stage: "vocational", sector: "private", living: "home" }];
    });
    expect(ruleOf("schoolFeeZero").check(s).length).toBeGreaterThan(0);
  });

  it("受け取りが過去の退職金の推定", () => {
    const s = brokenInput("salariedCoupleTwoKids", (req) => {
      (req.input.household.retirementBenefits ??= []).push({ id: "b0000000-0000-4000-8000-000000000001", member: self(req).id, kind: "lumpSum", amount: { value: 10_000_000, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: "退職給付の統計" } } as never, paidAt: { at: "2020-03" } });
    });
    expect(ruleOf("pastRetirementEstimate").check(s).length).toBeGreaterThan(0);
  });

  it("パートの今の働き方に定年の推定・正社員の統計の年収の推定", () => {
    const me = self(modelHousehold("salariedCoupleTwoKids")).id;
    const s = brokenInput(
      "salariedCoupleTwoKids",
      (req) => {
        const p = (req.input.household.employmentPeriods ?? []).find((x) => x.member === me && (x.from.at ?? "") <= req.input.baseMonth)!;
        p.type = "partTime";
        p.salary!.annual = { value: 4_000_000, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: "賃金の統計（正社員・正職員）" } } as NonNullable<typeof p.salary>["annual"];
      },
      { [`work/${me}/mainEnd`]: "定年60歳" },
    );
    const found = ruleOf("workTypeEstimates").check(s);
    expect(found.some((t) => t.includes("定年の推定"))).toBe(true);
    expect(found.some((t) => t.includes("正社員の統計"))).toBe(true);
  });

  it("終わりの無い働き方で80歳を過ぎても給与", () => {
    const s = brokenInput("salariedCoupleTwoKids", (req) => {
      const ps = (req.input.household.employmentPeriods ?? []).filter((x) => x.member === self(req).id);
      req.input.household.employmentPeriods = (req.input.household.employmentPeriods ?? []).filter((x) => x.member !== self(req).id || x === ps[0]);
      ps[0]!.to = null;
    });
    expect(ruleOf("workToTableEnd").check(s).length).toBeGreaterThan(0);
  });

  it("売らない持ち家が住み終わりの後に資産から消える", () => {
    const s0 = brokenInput("salariedCoupleTwoKids", (req) => {
      req.input.household.residences![0]!.to = { at: "2050-03" };
    });
    const r = s0.wh.request.input.household.residences![0]!;
    const s = brokenResult(s0, (t) => {
      const keep = t.filter((c) => !(c.object === r.id && c.row.startsWith("cf.balance.account.realEstate")));
      const at2050 = t.filter((c) => c.object === r.id && c.year === 2050 && c.row.startsWith("cf.balance.account.realEstate"));
      return [...keep, ...(at2050.length > 0 ? at2050 : [{ row: "cf.balance.account.realEstate.land", year: 2050, amount: 10_000_000, object: r.id }])];
    });
    expect(ruleOf("keptHomeVanishes").check(s).length).toBeGreaterThan(0);
  });

  it("売った家の住宅ローンを売った後も返す", () => {
    const s0 = brokenInput("salariedCoupleTwoKids", (req) => {
      const r = req.input.household.residences![0]!;
      r.to = { at: "2035-03" };
      r.sale = {};
      for (const d of req.input.household.debts ?? []) if (d.kind === "mortgage") d.housing = { ...(d.housing ?? { moveIn: "", propertyType: "other", newBuild: false }), residence: r.id };
    });
    const d = (s0.wh.request.input.household.debts ?? []).find((x) => x.kind === "mortgage")!;
    const s = brokenResult(s0, (t) => [...t.filter((c) => !(c.object === d.id && c.year > 2035)), { row: "cf.expense.housing.loan", year: 2037, amount: 1_200_000, object: d.id }]);
    expect(ruleOf("soldHomeLoanContinues").check(s).length).toBeGreaterThan(0);
  });

  it("住まいの重なりと、住まいの無い時期を見分ける（知らせの有無の前）", () => {
    const req = clone(modelHousehold("salariedCoupleTwoKids"));
    const h = req.input.household;
    const own = h.residences![0]!;
    h.residences = [own, { id: "r0000000-0000-4000-8000-000000000001", kind: "rent", from: { at: "2030-01" }, to: { at: "2040-12" }, rent: { monthly: { value: 80_000, state: "confirmed", origin: { kind: "manual" } } } }];
    expect(housingConditions(h, req.input.baseMonth, req.input.endYear).some((t) => t.includes("2つ重なる"))).toBe(true);
    own.to = { at: "2029-12" };
    expect(housingConditions(h, req.input.baseMonth, req.input.endYear).some((t) => t.includes("2041-01 から先の住まいが入っていない"))).toBe(true);
    expect(housingConditions(modelHousehold("salariedCoupleTwoKids").input.household, "2026-10", 2081)).toEqual([]);
  });

  it("購入の時期と住み始め・借入の年月・控除の入居のずれ", () => {
    const s = brokenInput("housingPurchase", (req) => {
      const r = req.input.household.residences!.find((x) => x.purchase !== undefined)!;
      r.purchase!.at = { at: "2031-04" };
    });
    expect(ruleOf("purchaseDates").check(s).length).toBeGreaterThan(0);
  });

  it("今住んでいる持ち家が資産に無い・純資産が大きくマイナス", () => {
    const s0 = subjectOf("見本 3-4-01", modelHousehold("salariedCoupleTwoKids"));
    const s = brokenResult(s0, (t) => t.filter((c) => !c.row.startsWith("cf.balance.account.realEstate")).map((c) => (c.row === "cf.balance.debt.mortgage" && c.year === 2026 ? { ...c, amount: c.amount + 50_000_000 } : c)));
    const found = ruleOf("negativeNetWorthNow").check(s);
    expect(found.some((t) => t.includes("資産に入っていない"))).toBe(true);
    expect(found.some((t) => t.includes("純資産が"))).toBe(true);
  });

  it("亡くなった後の介護の費用・亡くなる見込みとずれた相続の時期（推定）", () => {
    let flow = "";
    const s0 = brokenInput("parentCare", (req) => {
      const h = req.input.household;
      const mother = h.members.find((m) => m.kind === "parent")!;
      mother.leaves = { at: "2029-03" };
      flow = "f0000000-0000-4000-8000-000000000001";
      (h.incomeFlows ??= []).push({ id: flow, kind: "inheritance", counterparty: mother.id, recipient: self(req).id, from: { at: "2040-01" }, to: { at: "2040-01" }, everyYears: 1, amount: { value: 10_000_000, state: "confirmed", origin: { kind: "manual" } } });
    });
    const care = s0.wh.request.input.household.careExpenses![0]!;
    const s = brokenResult({ ...s0, wh: { ...s0.wh, assumed: { ...s0.wh.assumed, [`in/${flow}/from`]: "亡くなる見込みの10か月後" } } }, (t) => [...t, { row: "cf.expense.care.facility", year: 2031, amount: 3_000_000, object: care.id, member: care.member }]);
    const found = ruleOf("careAndInheritanceAfterDeath").check(s);
    expect(found.some((t) => t.includes("介護の費用が"))).toBe(true);
    expect(found.some((t) => t.includes("受け取る相続の時期"))).toBe(true);
  });

  it("推定のままの70歳・80歳の段が、退職直後の段より高い", () => {
    const c = WATCH_CASES.find((x) => x.name === OP("退職後の生活費の割合だけを下げる"))!;
    const s0 = subject(c.name);
    // 欄の後追いを通さずに、退職直後の段だけを下げる（推定の段は推定のまま）
    const req = clone(s0.wh.request);
    const l = req.input.household.livingExpenses![0]!;
    (l.stages ?? []).find((x) => x.label === "retirement")!.ratio = "0.5";
    const s = subjectOf("壊した 生活費", { ...s0.wh, request: req });
    expect(ruleOf("livingStagesRise").check(s).length).toBeGreaterThan(0);
  });

  it("表の行とグラフの系列の食い違い・対応の表に無い行", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const table = preview(req).table;
    expect(rowGroupingProblems(req, table)).toEqual([]);
    expect(rowGroupingProblems(req, table, { salary: ["pension"] }).some((t) => t.includes("グラフは「salary」"))).toBe(true);
    expect(rowGroupingProblems(req, table, { salary: ["pension"] }).some((t) => t.includes("対応の表に無い"))).toBe(true);
  });

  it("資産配分の入れ方で割合・期待リターンが計算に渡っていない", () => {
    const none = brokenInput("investmentCouple", (req) => {
      req.input.assumptions = { ...req.input.assumptions!, investment: { method: "allocation" } };
    });
    expect(ruleOf("allocationPassed").check(none).length).toBeGreaterThan(0);
    const noReturn = brokenInput("investmentCouple", (req) => {
      const a = req.input.assumptions!;
      req.input.assumptions = { ...a, investment: { method: "allocation", allocation: { mix: [{ assetClass: "equity.global", share: "1" }] } }, assetReturns: {} };
    });
    expect(ruleOf("allocationPassed").check(noReturn).length).toBeGreaterThan(0);
  });

  it("残高のある NISA の取得価額が0円", () => {
    const s = brokenInput("salariedCoupleTwoKids", (req) => {
      const a = (req.input.household.accounts ?? []).find((x) => x.kind === "nisa")!;
      a.costBasis = { value: 0, state: "confirmed", origin: { kind: "manual" } };
    });
    expect(ruleOf("zeroCostBasis").check(s).length).toBeGreaterThan(0);
  });

  it("取り込んだ世帯の、亡くなる見込みの無い世帯の外の家族（画面で足した世帯は見ない）", () => {
    const edit = (req: EngineRequest) => {
      const p = req.input.household.members.find((m) => m.kind === "parent")!;
      p.outside = { of: self(req).id, periods: [] };
      p.leaves = null;
    };
    expect(ruleOf("outsideWithoutDeath").check(brokenInput("parentCare", edit, {}, true)).length).toBeGreaterThan(0);
    expect(ruleOf("outsideWithoutDeath").check(brokenInput("parentCare", edit))).toEqual([]);
  });

  it("画面の文の内部の名前・生の値・JSON・「○つ」を見つけ、画面の言葉は見逃す", () => {
    const bad = ["incomeFlow「相続・遺贈」", "home → facility", '{"cohabiting":true,"dependent":false}', "外す: member", "推定のままの値（12つ）", "前提は既定の値で計算中です（4つ）", "00000000-0000-4000-8000-000000000001", "undefined"];
    for (const t of bad) expect(textProblems([{ where: "試し", text: t }]), t).not.toEqual([]);
    const ok = ["iDeCo", "NISA の積立", "1つにまとめて見せます", "最初の1つが主契約", "住まいが2つ重なっています", "年収（税込み・賞与込み）", "2030年4月（父96歳）", "推定で入れる（3か所）"];
    for (const t of ok) expect(textProblems([{ where: "試し", text: t }]), t).toEqual([]);
  });
});
