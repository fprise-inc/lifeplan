// 見本の提案書の材料（架空のモデル世帯 data/modelHouseholds から作る。CC0）。見本の PDF とテストで使う。
// 打ち手の当て方はアプリの打ち手（app/src/workspace/levers.ts）と同じ形で、要求の JSON を直接書き換える
// （0008 の5 のプランの層ができたら、そちらで作った「提案」をそのまま渡す）。
import type { EngineRequest, ProposalBundle, Run } from "../src/bundle.ts";
import { modelHousehold, runAll } from "./engine.ts";

type Household = EngineRequest["input"]["household"];
type Member = Household["members"][number];

const clone = <T>(v: T): T => structuredClone(v);

function addMonths(s: string, n: number): string {
  const [y, m] = s.split("-").map(Number) as [number, number];
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

function ageReachedMonth(member: Member, age: number): string {
  const [y, m] = member.birth.birthYearMonth.split("-").map(Number) as [number, number];
  return addMonths(`${y + age}-${String(m).padStart(2, "0")}`, member.birth.bornOnFirst ? -1 : 0);
}

const self = (req: EngineRequest): Member => req.input.household.members.find((m) => m.kind === "self") as Member;
const spouse = (req: EngineRequest): Member | undefined => req.input.household.members.find((m) => m.kind === "spouse");

/** 毎月の生活費（総額の入力）を変える */
function setLivingMonthly(req: EngineRequest, monthly: number): EngineRequest {
  const out = clone(req);
  const living = (out.input.household.livingExpenses ?? []).find((l) => l.mode === "total");
  if (living?.monthly !== undefined) (living as { monthly: { value?: number } }).monthly = { ...living.monthly, value: monthly };
  return out;
}

/** 本人の NISA の毎月の積立額を変える（期間は今の積立のまま） */
function setNisaMonthly(req: EngineRequest, monthly: number): EngineRequest {
  const out = clone(req);
  const me = self(out);
  for (const a of out.input.household.accounts) {
    if (a.kind !== "nisa" || a.owner !== me.id) continue;
    const first = a.contributions[0];
    (a as unknown as { contributions: unknown[] }).contributions = first === undefined ? [] : [{ ...first, monthly }];
  }
  return out;
}

/** 年金の受け取りの開始（基礎・厚生とも）を、その年齢に達した月の翌月にする */
function setPensionAge(req: EngineRequest, member: Member, age: number): EngineRequest {
  const out = clone(req);
  const claim = { at: addMonths(ageReachedMonth(member, age), 1) };
  for (const r of out.input.household.pensionRecords ?? []) if (r.member === member.id) (r as { claim?: unknown }).claim = { basic: claim, employee: claim };
  return out;
}

/** FP顧問料（初回＋継続の年額。4年目から料金の段階。0008 の FP顧問料・0073 の料金表）を足す */
function addAdvisoryFee(req: EngineRequest, id: string, oneTime: { at: string; amount: number }, annual: number, from: string): EngineRequest {
  const out = clone(req);
  const fees: unknown[] = [...(out.input.household.advisoryFees ?? [])];
  fees.push({
    id,
    payer: self(out).id,
    enabled: true,
    menu: { id: "office.standard", label: "初回のプラン作成＋年間の顧問" },
    terms: { oneTime: [{ at: { at: oneTime.at }, amount: oneTime.amount }], recurring: { from: { at: from }, annual, revision: { steps: [{ id: `${id.slice(0, -4)}0001`, at: { at: `${Number(from.slice(0, 4)) + 3}${from.slice(4)}` }, annual: 150000 }] }, onContingency: { mode: "stop" } } },
  });
  (out.input.household as { advisoryFees?: unknown }).advisoryFees = fees;
  return out;
}

const runOf = (runs: Run[], i: number): Run => runs[i] as Run;

/**
 * 見本1: 会社員の夫婦と子2人（salariedCoupleTwoKids）。生活費の見直し・NISA の積立の増額・FP顧問料の3つの打ち手、
 * ご主人の死亡の想定、夫婦の必要保障額の推移、ご主人の年金の受け取り開始（65歳と70歳）の比較
 */
export function salariedCoupleBundle(): ProposalBundle {
  const current = modelHousehold("salariedCoupleTwoKids");
  const me = self(current);
  const wife = spouse(current) as Member;
  const s1 = setLivingMonthly(current, 280000);
  const s2 = setNisaMonthly(s1, 30000);
  const s3 = addAdvisoryFee(s2, "5b0f3f3e-8a1c-4c7e-9d2a-1f6b2c3d4e5f", { at: "2026-11", amount: 300000 }, 120000, "2027-01");
  const proposal = s3;
  const death = clone(proposal);
  (death.input as { contingencies?: unknown }).contingencies = [
    { id: "7e1d2c3b-4a5f-4e6d-8c7b-9a0b1c2d3e4f", kind: "death", member: me.id, occurs: { at: "2031-04" }, survivor: { funeral: 2000000 } },
  ];
  const protection = clone(proposal);
  (protection.input as { protection?: unknown }).protection = { members: [me.id, wife.id], method: "accumulation", survivor: { funeral: 2000000, reserveMonths: 6 }, toYear: 2050 };
  const defer70 = setPensionAge(proposal, me, 70);
  const runs = runAll([current, s1, s2, s3, death, protection, defer70]);
  return {
    document: { issuedOn: "2026-10-17", preparedBy: "見本FP事務所（架空）" },
    current: runOf(runs, 0),
    proposal: runOf(runs, 3),
    targetAge: 95,
    proposalWithoutFee: runOf(runs, 2),
    steps: [
      { label: "生活費の見直し（月30万円→28万円）", run: runOf(runs, 1) },
      { label: "NISAの積立を増やす（月1万円→3万円）", run: runOf(runs, 2) },
      { label: "FP顧問料（初回30万円＋年12万円）", run: runOf(runs, 3) },
    ],
    changes: [
      { label: "毎月の生活費", current: "30万円", proposal: "28万円" },
      { label: "NISAの毎月の積立", current: "1万円", proposal: "3万円（2041年6月まで）" },
      { label: "FP顧問料", current: "なし", proposal: "初回30万円＋年12万円（2030年1月から年15万円）" },
    ],
    contingencies: [{ title: "ご主人が2031年4月に亡くなった場合", run: runOf(runs, 4) }],
    protection: runOf(runs, 5),
    deferral: { memberKey: "self", options: [{ startAge: 65, run: runOf(runs, 3) }, { startAge: 70, run: runOf(runs, 6) }] },
    // 案の比較（主画面の帯に並べた案の見本）: 現状・生活費だけ見直す案・提案
    comparison: {
      base: 0,
      plans: [
        { letter: "A", name: "現状", run: runOf(runs, 0) },
        { letter: "B", name: "生活費の見直し", run: runOf(runs, 1) },
        { letter: "C", name: "生活費・NISA・FP顧問料", run: runOf(runs, 3) },
      ],
    },
  };
}

/**
 * 見本2: FP顧問料つきの提案（advisoryFeeProposal）。現状は顧問料の無い世帯（NISA の積立は現状から続ける）。
 * 打ち手を FP顧問料 → 運用の前提の見直し（年2%→年3%。運用の前提の変更）の順に足し、
 * 「運用の前提の変更を除いた効果」（運用の利回りの仮定だけで顧問料を上回って見せない）を示す
 */
export function advisoryFeeBundle(): ProposalBundle {
  const withFee = modelHousehold("advisoryFeeProposal");
  // 料金の改定は額の段階で見せる（値上げの率は顧客に見せない。0073 の追記）。見本の世帯の率（年2%）を、4年目から年15万円の段階に置き換える
  for (const f of withFee.input.household.advisoryFees ?? []) {
    const rec = f.terms?.recurring;
    if (rec?.revision?.rate !== undefined) (rec as { revision?: unknown }).revision = { steps: [{ id: `${f.id.slice(0, -4)}0001`, at: { at: "2030-01" }, annual: 150000 }] };
  }
  const current = clone(withFee);
  delete (current.input.household as { advisoryFees?: unknown }).advisoryFees;
  const s2 = clone(withFee);
  (s2.input.assumptions as { investmentReturn: unknown }).investmentReturn = { default: "0.03" };
  const runs = runAll([current, withFee, s2]);
  return {
    document: { issuedOn: "2026-10-17", preparedBy: null },
    current: runOf(runs, 0),
    proposal: runOf(runs, 2),
    steps: [
      { label: "FP顧問料（初回30万円＋年12万円・3年ごとの見直し料）", run: runOf(runs, 1) },
      { label: "運用利回りの前提を見直す（年2%→年3%）", investment: true, run: runOf(runs, 2) },
    ],
    changes: [
      { label: "FP顧問料", current: "なし", proposal: "初回30万円＋年12万円（2030年1月から年15万円）、3年ごとの見直し料5万円" },
      { label: "運用利回りの前提", current: "年2%", proposal: "年3%" },
    ],
  };
}

/**
 * 見本3: 資産運用（investmentCouple。0026）。NISA の積立を年齢で増やし、65歳から毎月17万円を取り崩す現状に、取り崩しを毎月13万円にする提案。
 * 資産運用の計画（運用の期間・口座ごとの推移・資産の内訳）と、相場が下がった場合の3つの型
 */
export function investmentBundle(): ProposalBundle {
  const current = modelHousehold("investmentCouple");
  const me = self(current);
  const proposal = clone(current);
  const inv = (proposal.input.assumptions as { investment?: { drawdown?: { monthly?: number } } }).investment;
  if (inv?.drawdown !== undefined) inv.drawdown.monthly = 130000;
  const retireYear = Number(addMonths(ageReachedMonth(me, 60), -1).slice(0, 4));
  const wdYear = Number(ageReachedMonth(me, 65).slice(0, 4));
  const withTest = (stressTest: Record<string, unknown>): EngineRequest => ({ ...clone(proposal), input: { ...clone(proposal).input, stressTest } }) as unknown as EngineRequest;
  const risky = ["equity.domestic", "equity.global", "reit.domestic", "reit.global"];
  const runs = runAll([
    current,
    proposal,
    withTest({ template: "marketDropAtRetirement", params: { year: retireYear, drop: "0.3", assetClasses: risky } }),
    withTest({ template: "lowReturnPeriod", params: { year: wdYear, years: 10, cap: "0.005" } }),
    withTest({ template: "returnShortfall", params: { add: "-0.01" } }),
  ]);
  return {
    document: { issuedOn: "2026-10-19", preparedBy: "見本FP事務所（架空）" },
    current: runOf(runs, 0),
    proposal: runOf(runs, 1),
    targetAge: 95,
    changes: [{ label: "毎月の取り崩し額", current: "17万円", proposal: "13万円" }],
    investment: {
      method: "口座",
      condition: "65歳から毎月13万円ずつ取り崩す場合",
      periods: {
        accumText: "積み立てる 45〜59歳",
        holdText: "据え置く",
        holdSub: "60〜64歳",
        wdText: "取り崩す",
        wdSub: "65歳〜 月13万円",
        accumEnd: retireYear + 1,
        wdStart: wdYear,
        steps: [
          { year: 2027, label: "月5.7万" },
          { year: 2031, label: "月7.7万" },
          { year: 2036, label: "月9.7万" },
        ],
        estimated: true,
      },
      donutYear: wdYear,
      stress: [
        { label: "退職の直後に株などが3割下がる", run: runOf(runs, 2) },
        { label: "取り崩しを始めてから10年間、利回りが低いまま（年0.5%）", run: runOf(runs, 3) },
        { label: "利回りがずっと想定より1%低い", run: runOf(runs, 4) },
      ],
    },
  };
}

/**
 * 見本4: 共働きの夫婦と子2人・資産が多め（dualAssetsTwoKids）。持ち家（土地と建物）と、賃貸に出しているマンション1室（家賃収入・経費・ローン）。
 * 提案は、ご主人の退職の後（60歳の年の6月）にマンションを売り、残っているマンションのローンを売ったお金で返す。
 * 資産運用の計画の運用の期間は、積立額が3段階（狭い「積み立てる」の帯に段の額が入りきらない形）
 */
export function rentalPropertyBundle(): ProposalBundle {
  const current = modelHousehold("dualAssetsTwoKids");
  const me = self(current);
  const proposal = clone(current);
  const condo = proposal.input.household.accounts.find((a) => a.kind === "realEstate" && a.property !== undefined);
  const saleAt = `${Number(ageReachedMonth(me, 60).slice(0, 4))}-06`;
  if (condo?.property !== undefined) (condo as unknown as { property: Record<string, unknown> }).property = { ...condo.property, sale: { at: { at: saleAt } } };
  for (const d of proposal.input.household.debts ?? []) if (condo !== undefined && d.property === condo.id) (d as { prepayments?: unknown }).prepayments = [{ at: { at: saleAt }, amount: 50000000, mode: "shortenTerm" }];
  const retireYear = Number(addMonths(ageReachedMonth(me, 60), -1).slice(0, 4));
  const wdYear = Number(ageReachedMonth(me, 65).slice(0, 4));
  const runs = runAll([current, proposal]);
  return {
    document: { issuedOn: "2026-10-20", preparedBy: "見本FP事務所（架空）" },
    current: runOf(runs, 0),
    proposal: runOf(runs, 1),
    targetAge: 95,
    changes: [{ label: "賃貸に出しているマンション", current: "持ち続ける（家賃収入）", proposal: "60歳の年に売り、ローンを返す" }],
    investment: {
      method: "口座",
      condition: "65歳から毎月35万円ずつ取り崩す場合",
      periods: {
        accumText: "積み立てる 49〜59歳",
        holdText: "据え置く",
        holdSub: "60〜64歳",
        wdText: "取り崩す",
        wdSub: "65歳〜 月35万円",
        accumEnd: retireYear + 1,
        wdStart: wdYear,
        steps: [
          { year: 2027, label: "月19.3万" },
          { year: 2031, label: "月22.3万" },
          { year: 2034, label: "月19.3万" },
        ],
        estimated: true,
      },
      donutYear: wdYear,
      stress: [],
    },
  };
}

export const SAMPLES: { id: string; title: string; bundle: () => ProposalBundle }[] = [
  { id: "salariedCoupleTwoKids", title: "会社員の夫婦と子2人（生活費・NISA・FP顧問料、万一、年金の繰下げ）", bundle: salariedCoupleBundle },
  { id: "advisoryFeeProposal", title: "FP顧問料つきの提案（打ち手ごとの効果と、運用の前提の変更を除いた効果）", bundle: advisoryFeeBundle },
  { id: "investmentCouple", title: "資産運用（期間を分けた積立・取り崩しの計画、資産運用の計画と相場が下がった場合）", bundle: investmentBundle },
  { id: "dualAssetsTwoKids", title: "資産が多めの共働き（持ち家の土地と建物、賃貸に出しているマンションの家賃収入・経費・ローンと売却、積立が3段階の運用の期間）", bundle: rentalPropertyBundle },
];
