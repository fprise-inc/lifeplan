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

/** FP顧問料（初回＋継続の年額。0008 の FP顧問料）を足す */
function addAdvisoryFee(req: EngineRequest, id: string, oneTime: { at: string; amount: number }, annual: number, from: string): EngineRequest {
  const out = clone(req);
  const fees: unknown[] = [...(out.input.household.advisoryFees ?? [])];
  fees.push({
    id,
    payer: self(out).id,
    enabled: true,
    menu: { id: "office.standard", label: "初回のプラン作成＋年間の顧問" },
    terms: { oneTime: [{ at: { at: oneTime.at }, amount: oneTime.amount }], recurring: { from: { at: from }, annual, revision: { rate: "0.02" }, onContingency: { mode: "stop" } } },
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
      { label: "FP顧問料", current: "なし", proposal: "初回30万円＋年12万円（毎年2%の改定）" },
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
      { label: "FP顧問料", current: "なし", proposal: "初回30万円＋年12万円（毎年2%の改定）、3年ごとの見直し料5万円" },
      { label: "運用利回りの前提", current: "年2%", proposal: "年3%" },
    ],
  };
}

export const SAMPLES: { id: string; title: string; bundle: () => ProposalBundle }[] = [
  { id: "salariedCoupleTwoKids", title: "会社員の夫婦と子2人（生活費・NISA・FP顧問料、万一、年金の繰下げ）", bundle: salariedCoupleBundle },
  { id: "advisoryFeeProposal", title: "FP顧問料つきの提案（打ち手ごとの効果と、運用の前提の変更を除いた効果）", bundle: advisoryFeeBundle },
];
