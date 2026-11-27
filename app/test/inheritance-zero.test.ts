// 相続税の目安で、税額が0円・1万円未満のときの出し方（0039 の追記 2026-11-27。利用者の判断）:
// (a) 基礎控除以下は「かからない見込み」・(b-0) 基礎控除を超えて0円は理由と「申告は必要です」（税額控除だけなら付けない）・(b-1) 1円〜9,999円は「1万円未満」・(c) 1万円以上は「約○万円」。
// 一次（いま亡くなったら）と二次（二人とも亡くなった後）の時点・境目（課税価格がちょうど基礎控除・1,000円超）・ボタンの出る出ない・
// 相続・贈与の入力項目の目安・入力のホームの要約の1行・万一のタブ・結果のタブのポイントが同じ答えになること
import { describe, expect, it } from "vitest";
import type { EngineRequest, Household, InheritancePoint, PreviewResult } from "../src/engine/types.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import { inheritanceText } from "../src/workspace/contingency/present.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { estimateText, FILING_NEEDED, priceBeforeSpecial, taxKind, UNDER_10K } from "../src/workspace/input/inheritanceAnswer.ts";
import { setDetailed } from "../src/workspace/input/inheritanceLand.ts";
import { detailPrompt, inheritanceRequest, inheritanceTaxNote, inheritanceView, NOT_INCLUDED_LABEL, PROMPT_LIKELY } from "../src/workspace/input/inheritanceLine.ts";
import { insights } from "../src/workspace/tools/fpTools.ts";
import { inheritancePayable } from "../src/workspace/tools/Insights.tsx";
import { modelHousehold, preview } from "./helpers.ts";

const estimate = (wh: WorkingHousehold): PreviewResult => preview(forEngine(inheritanceRequest(wh.request)));
const withFuneral = (wh: WorkingHousehold, funeral: number): WorkingHousehold => {
  const req: EngineRequest = structuredClone(wh.request);
  req.input.inheritanceTax = { ...(req.input.inheritanceTax ?? {}), funeral };
  return fromRequest(req);
};

/** 時点1つ（計算した時点の形。足りない欄は 0） */
type P = Partial<InheritancePoint> & { assets?: Record<string, number>; spouseReduction?: number; minorCredit?: number; settlementCredit?: number; refund?: number };
const BASIC = 42_000_000;
const pt = (o: P): InheritancePoint & Record<string, unknown> =>
  ({
    point: "now",
    decedent: "self",
    month: "2026-04",
    valuationYear: 2026,
    status: "ok",
    heirCount: 2,
    basicDeduction: BASIC,
    totalTax: 0,
    payable: 0,
    payableHousehold: 0,
    payableOutside: 0,
    noTax: false,
    margin: 0,
    amount: 0,
    state: "estimated",
    cautions: [],
    spouseReduction: 0,
    settlementCredit: 0,
    refund: 0,
    ...o,
    assets: { financial: 0, realEstate: 0, other: 0, insurance: 0, insuranceExempt: 0, retirement: 0, retirementExempt: 0, settlementGifts: 0, debts: 0, funeral: 0, taxablePrice: 0, ...(o.assets ?? {}) },
  }) as InheritancePoint & Record<string, unknown>;
const result = (...points: ReturnType<typeof pt>[]): PreviewResult => ({ table: [], inheritanceTax: { points, notIncluded: ["twentyPercentSurcharge", "smallLandSpecial", "calendarGiftAddBack"] } }) as unknown as PreviewResult;

// 不動産（持ち家）のある夫婦の世帯（ボタンの出る出ないを見る）
const pensioners = fromRequest(modelHousehold("samplePensionerCouple"));
const h: Household = pensioners.request.input.household;

describe("答えの文（時点1つ）", () => {
  it("(a) 基礎控除以下は「かからない見込み」。ちょうど基礎控除も (a)（申告は要らない）", () => {
    expect(estimateText(pt({ noTax: true, margin: 1_000_000, assets: { taxablePrice: BASIC - 1_000_000 } }))).toBe("かからない見込み");
    const just = pt({ noTax: true, margin: 0, assets: { taxablePrice: BASIC } });
    expect(taxKind(just)).toBe("none");
    expect(estimateText(just)).toBe("かからない見込み");
    expect(estimateText(just)).not.toContain("0円");
  });

  it("(b-0) 配偶者の税額軽減で0円: 何によってかからないかと「申告は必要です」", () => {
    const p = pt({ assets: { taxablePrice: 40_480_000 }, basicDeduction: 36_000_000, totalTax: 448_000, spouseReduction: 448_000 });
    expect(taxKind(p)).toBe("zero");
    expect(estimateText(p)).toBe("配偶者の税額軽減で、相続税はかからない見込みです。申告は必要です");
    expect(estimateText(p)).not.toContain("要ります");
  });

  it("(b-0) 小規模宅地等の特例で基礎控除以下になった時点は、かからない見込みでなく、特例で0円・申告は必要です（特例の前の課税価格で見る）", () => {
    const p = pt({ noTax: true, assets: { financial: 20_000_000, realEstate: 40_000_000, smallLandReduction: 32_000_000, taxablePrice: 28_000_000 } });
    expect(priceBeforeSpecial(p)).toBe(60_000_000);
    expect(estimateText(p)).toBe(`小規模宅地等の特例で、相続税はかからない見込みです。${FILING_NEEDED}`);
    // 特例の前でも基礎控除以下なら (a)
    const under = pt({ noTax: true, assets: { financial: 10_000_000, realEstate: 30_000_000, smallLandReduction: 20_000_000, taxablePrice: 20_000_000 } });
    expect(estimateText(under)).toBe("かからない見込み");
    // 特例の前の課税価格がちょうど基礎控除（1,000円未満の切り捨てで基礎控除）も (a)
    const edge = pt({ noTax: true, assets: { financial: BASIC - 10_000_000 + 999, realEstate: 10_000_000, smallLandReduction: 8_000_000, taxablePrice: BASIC - 8_000_000 } });
    expect(priceBeforeSpecial(edge)).toBe(BASIC);
    expect(taxKind(edge)).toBe("none");
  });

  it("(b-0) 税額控除だけ（未成年者控除・相続時精算課税分の贈与税額控除）で0円なら、申告の一言は付けない（相続税法27条1項）", () => {
    const minor = pt({ assets: { taxablePrice: 43_000_000 }, totalTax: 100_000, minorCredit: 100_000 });
    expect(estimateText(minor)).toBe("未成年者控除で、相続税はかからない見込みです");
    const settle = pt({ assets: { taxablePrice: 43_000_000 }, totalTax: 100_000, settlementCredit: 300_000, refund: 200_000 });
    expect(estimateText(settle)).toBe("相続時精算課税分の贈与税額控除で、相続税はかからない見込みです。引ききれない贈与税は、申告すると戻ります");
    // 配偶者の税額軽減と一緒なら申告は必要
    const both = pt({ assets: { taxablePrice: 50_000_000 }, totalTax: 800_000, spouseReduction: 400_000, minorCredit: 400_000 });
    expect(estimateText(both)).toBe("配偶者の税額軽減と未成年者控除で、相続税はかからない見込みです。申告は必要です");
  });

  it("(b-1) 1円〜9,999円は「1万円未満」、(c) 1万円からは「約○万円」", () => {
    for (const payable of [1, 100, 400, 2_400, 9_999]) expect(estimateText(pt({ assets: { taxablePrice: 43_000_000 }, totalTax: payable, payable }))).toBe(UNDER_10K);
    expect(estimateText(pt({ assets: { taxablePrice: 43_000_000 }, totalTax: 10_000, payable: 10_000 }))).toBe("約1万円");
    expect(estimateText(pt({ assets: { taxablePrice: 80_000_000 }, totalTax: 797_000, payable: 797_000 }))).toBe("約79.7万円");
    // 端数の切り捨てで0円（控除で0円になったのではない）は、納める税も申告の義務も無いので「かからない見込み」
    expect(estimateText(pt({ assets: { taxablePrice: 42_001_000 }, totalTax: 0, payable: 0 }))).toBe("かからない見込み");
  });
});

describe("入力項目の目安・入力のホームの要約の1行・万一のタブが同じ答え（一次と二次の時点）", () => {
  const cases: { name: string; p: P; answer: string }[] = [
    { name: "(a)", p: { noTax: true, margin: 5_000_000, assets: { taxablePrice: BASIC - 5_000_000 } }, answer: "かからない見込み" },
    { name: "(a) ちょうど基礎控除", p: { noTax: true, margin: 0, assets: { taxablePrice: BASIC } }, answer: "かからない見込み" },
    { name: "(b-0)", p: { assets: { taxablePrice: 43_000_000 }, totalTax: 100_000, spouseReduction: 100_000 }, answer: "配偶者の税額軽減で、相続税はかからない見込みです。申告は必要です" },
    { name: "(b-0) 税額控除だけ", p: { assets: { taxablePrice: 43_000_000 }, totalTax: 100_000, minorCredit: 100_000, lands: [] }, answer: "未成年者控除で、相続税はかからない見込みです" },
    { name: "(b-1) 1,000円超", p: { assets: { taxablePrice: BASIC + 1_000 }, totalTax: 100, payable: 100 }, answer: "1万円未満" },
    { name: "(c)", p: { assets: { taxablePrice: 60_000_000 }, totalTax: 1_800_000, payable: 1_800_000 }, answer: "約180万円" },
  ];
  for (const c of cases)
    for (const point of ["now", "bothAfter"] as const)
      it(`${c.name}・${point === "now" ? "一次（いま亡くなったら）" : "二次（二人とも亡くなった後）"}`, () => {
        const r = result(pt({ ...c.p, point }));
        const view = inheritanceView(pensioners, r);
        expect(view.points[0]?.answer).toBe(c.answer);
        expect(inheritanceTaxNote(r, h)).toBe(`相続税（${point === "now" ? "いま亡くなったら" : "二人とも亡くなった後"}）: ${c.answer}`);
        const sc = result(pt({ ...c.p, point: "contingency" }));
        expect(inheritanceText(sc)).toMatch(new RegExp(`^相続税の目安: ${c.answer.replace(/[()（）。]/g, ".")}（`));
      });

  it("万一のタブの (a) は特例の前の課税価格と基礎控除を並べ、(b-0) は財産と基礎控除を添える。相続税も試算する世帯には「特例は含めていません」と書かない", () => {
    expect(inheritanceText(result(pt({ point: "contingency", noTax: true, margin: 0, assets: { taxablePrice: BASIC } })))).toBe("相続税の目安: かからない見込み（基礎控除 4,200万円 ＝ 財産 4,200万円）（目安。お金の流れには入れていません。小規模宅地等の特例・2割加算などは含めていません）");
    const land = pt({ point: "contingency", noTax: true, lands: [], assets: { financial: 20_000_000, realEstate: 40_000_000, smallLandReduction: 32_000_000, taxablePrice: 28_000_000 } });
    expect(inheritanceText(result(land))).toBe("相続税の目安: 小規模宅地等の特例で、相続税はかからない見込みです。申告は必要です（財産 2,800万円、基礎控除 4,200万円）（目安。お金の流れには入れていません）");
  });

  it("結果のタブのポイント「相続税がかかる見込み」も、1万円未満は「0万円」でなく「1万円未満」", () => {
    const r = result(pt({ assets: { taxablePrice: 43_000_000 }, totalTax: 400, payable: 400 }));
    const req = modelHousehold("samplePensionerCouple");
    const base = preview(forEngine(req));
    const pts = insights(req, base, { inheritanceTax: inheritancePayable(r) }).filter((x) => x.key === "inheritanceTax");
    expect(pts.map((x) => x.text)).toEqual(["いま亡くなったときの相続税の目安は1万円未満です（相続・贈与の項目）"]);
  });
});

describe("ボタン「土地の評価を入れて試算する」と一言: 基礎控除を超えたら0円でも出す", () => {
  it("どの時点も (a) なら出さない。1行目は「「相続税も試算する」（詳細）にすると入るもの」", () => {
    const r = result(pt({ noTax: true, margin: 0, assets: { taxablePrice: BASIC } }), pt({ point: "bothAfter", noTax: true, margin: 1, assets: { taxablePrice: 1 } }));
    expect(detailPrompt(pensioners, r)).toBeNull();
    expect(inheritanceView(pensioners, r).notIncluded.map((l) => l.label)).toEqual([NOT_INCLUDED_LABEL.addsNoButton, NOT_INCLUDED_LABEL.others]);
  });

  it("(b-0) 配偶者の税額軽減で0円なら出し、一言は申告が要る見込みの形。1行目は「土地の評価を入れて試算すると入るもの」", () => {
    const r = result(pt({ assets: { taxablePrice: 43_000_000 }, totalTax: 100_000, spouseReduction: 100_000 }), pt({ point: "bothAfter", noTax: true, assets: { taxablePrice: 1 } }));
    expect(detailPrompt(pensioners, r)).toBe("基礎控除を超えるので、相続税の申告が要る見込みです（配偶者の税額軽減で税額は0円）。土地の評価や小規模宅地等の特例、一次と二次の相続の分け方を入れると、目安をもう一歩くわしく試算できます。");
    expect(inheritanceView(pensioners, r).notIncluded[0]?.label).toBe(NOT_INCLUDED_LABEL.addsWithButton);
  });

  it("(b-0) 税額控除だけで0円なら、出すが申告の一言は付けない", () => {
    const r = result(pt({ assets: { taxablePrice: 43_000_000 }, totalTax: 100_000, settlementCredit: 100_000 }));
    expect(detailPrompt(pensioners, r)).toBe("基礎控除を超えますが、相続時精算課税分の贈与税額控除で税額は0円の見込みです。土地の評価や小規模宅地等の特例を入れると、目安をもう一歩くわしく試算できます。");
  });

  it("(b-1)・(c) の時点があれば「相続税がかかりそうです」（0円の時点と混じっても）", () => {
    expect(detailPrompt(pensioners, result(pt({ assets: { taxablePrice: BASIC + 1_000 }, totalTax: 100, payable: 100 })))).toBe(PROMPT_LIKELY);
    expect(detailPrompt(pensioners, result(pt({ assets: { taxablePrice: 43_000_000 }, totalTax: 100_000, spouseReduction: 100_000 }), pt({ point: "bothAfter", assets: { taxablePrice: 60_000_000 }, totalTax: 1_800_000, payable: 1_800_000 })))).toBe(PROMPT_LIKELY);
  });

  it("FP が入れた額の時点・相続税も試算する世帯には出さない（今までどおり）", () => {
    const zero = pt({ assets: { taxablePrice: 43_000_000 }, totalTax: 100_000, spouseReduction: 100_000 });
    expect(detailPrompt(pensioners, result({ ...zero, state: "confirmed" }))).toBeNull();
    expect(detailPrompt(setDetailed(pensioners, true), result(zero))).toBeNull();
  });
});

describe("計算エンジンの答えで見る", () => {
  it("見本「年金生活の夫婦」: いまご本人が亡くなったら (b-0)（配偶者の税額軽減）、いま配偶者が亡くなったら (a)。ボタンと申告の一言が出る", () => {
    const r = estimate(pensioners);
    const v = inheritanceView(pensioners, r);
    expect(v.points.map((p) => `${p.title}: ${p.answer}`)).toEqual([
      "いまご本人が亡くなったら: 配偶者の税額軽減で、相続税はかからない見込みです。申告は必要です",
      "いま配偶者が亡くなったら: かからない見込み",
      `${v.points[2]?.title ?? ""}: 相続人がいないので出していません`,
    ]);
    expect(detailPrompt(pensioners, r)).toContain("相続税の申告が要る見込みです（配偶者の税額軽減で税額は0円）");
    expect(v.notIncluded.map((l) => l.label)).toEqual([NOT_INCLUDED_LABEL.addsWithButton, NOT_INCLUDED_LABEL.others]);
    expect(inheritanceTaxNote(r, h)).toBe("相続税（いま亡くなったら）: 配偶者の税額軽減で、相続税はかからない見込みです。申告は必要です");
    // 内訳の納める額は「0万円」でなく「0円」
    expect(v.points[0]?.details.join("\n")).toContain("→ 納める額 0円");
  });

  // ひとり親（子2人・未成年）の世帯の預金を6,000万円にして、葬式の費用で課税価格を動かす（いまご本人が亡くなったら）
  const singleReq = modelHousehold("sampleSingleParent");
  const dep = singleReq.input.household.accounts!.find((x) => x.kind === "deposit")!;
  dep.marketValue = { ...dep.marketValue!, value: 60_000_000 };
  const single = fromRequest(singleReq);
  const nowOf = (wh: WorkingHousehold) => {
    const r = estimate(wh);
    const p = r.inheritanceTax!.points.find((x) => x.point === "now")!;
    return { r, p, answer: inheritanceView(wh, r).points.find((x) => x.title.startsWith("いま"))!.answer };
  };
  const base = nowOf(single).p;
  const a = base.assets as Record<string, number>;
  const net = (a.financial ?? 0) + (a.realEstate ?? 0) + (a.other ?? 0) + (a.insurance ?? 0) - (a.insuranceExempt ?? 0) + (a.retirement ?? 0) - (a.retirementExempt ?? 0) + (a.settlementGifts ?? 0) - (a.debts ?? 0);
  const at = (over: number) => withFuneral(single, net - base.basicDeduction - over);

  it("前提: 葬式の費用なしでは基礎控除を超える", () => {
    expect(net).toBeGreaterThan(base.basicDeduction + 1_000_000);
  });

  it("課税価格がちょうど基礎控除・1円超なら (a)。1万円超なら (b-1)「1万円未満」。100万円超なら (c)", () => {
    const just = nowOf(at(0));
    expect(just.p.assets.taxablePrice).toBe(just.p.basicDeduction);
    expect(just.answer).toBe("かからない見込み");
    // 1円超: 課税価格は1,000円未満を切り捨てるので、ちょうど基礎控除と同じ (a)
    const one = nowOf(at(1));
    expect(one.p.assets.taxablePrice).toBe(one.p.basicDeduction);
    expect(one.answer).toBe("かからない見込み");
    // 1,000円超: 子2人の1人あたりの取得金額 500円は1,000円未満の切り捨てで0円になり、税は出ない。控除で0円になったのではないので (a) と同じに出す
    const over = nowOf(at(1_000));
    expect(over.p.assets.taxablePrice).toBe(over.p.basicDeduction + 1_000);
    expect(over.p.payable).toBe(0);
    expect(over.answer).toBe("かからない見込み");
    const small = nowOf(at(10_000));
    expect(small.p.payable).toBeGreaterThan(0);
    expect(small.p.payable).toBeLessThan(10_000);
    expect(small.answer).toBe("1万円未満");
    const big = nowOf(at(1_000_000));
    expect(big.p.payable).toBeGreaterThanOrEqual(10_000);
    expect(big.answer).toMatch(/^約[\d.,]+万円$/);
  });

  it("相続税も試算する世帯で、未成年者控除だけで0円なら (b-0) で申告の一言なし", () => {
    const on = setDetailed(at(1_000_000), true);
    const t = nowOf(on);
    expect(t.p.payable).toBe(0);
    expect(t.answer).toBe("未成年者控除で、相続税はかからない見込みです");
    expect(t.answer).not.toContain("申告");
  });
});
