// 世帯の保存（0011・0012・0013・0016）: 本文の往復・持たない情報・過去の形式の見本・画面にパスを渡さないこと・自動保存
import type { CombinedBsInput } from "../../sdk/examples/extensions/combined-bs/parts/combinedBs.ts";
import { definitionOf, readExtValue } from "../src/workspace/extensions/fields.ts";
import { OFFICIAL_EXTENSIONS } from "../src/workspace/extensions/official.ts";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_DIR, REPO_DIR } from "../scripts/lib.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { CURRENT } from "../src/workspace/plans/band.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyPlan, savePlan } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { addMonths } from "../src/workspace/levers.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { Autosaver, type SaveState, type Timers } from "../src/workspace/store/autosave.ts";
import { makeSnapshot, snapshotDigest, verifySnapshot } from "../src/workspace/snapshots/snapshots.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import { BODY_FORMAT_VERSION, bodyObject, bodyOf, EMPTY_CARRY, fromBody, summaryOf, type BodyState } from "../src/workspace/store/body.ts";
import { giveElementIds } from "../src/workspace/store/format017.ts";
import { migrationId } from "../src/workspace/store/readings.ts";
import { withoutRemovedAssumptions } from "../src/workspace/surplus.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { insuranceOverlapNotices } from "../src/workspace/input/insuranceView.ts";
import { setNoticeAck } from "../src/workspace/input/noticeAck.ts";

/** 保存すると並びの要素に ID が付く（0035 の5）。読み戻した世帯と比べるときは、元の世帯にも同じ ID を付ける */
function withIds<T extends { request: { input: unknown } }>(wh: T): T {
  const r = structuredClone(wh);
  giveElementIds(r.request.input as Record<string, unknown>);
  return r;
}
import { keyLines } from "../src/workspace/store/RecoveryPanel.tsx";
import type { StatementLog } from "../../statement/src/index.ts";
import { readMigrationLog, withoutOrphanCompatibility, type MigrationLog } from "../src/workspace/store/migrations.ts";
import { scenarioRequest, scenarios } from "../src/workspace/contingency/requests.ts";
import { premiseFor } from "../src/workspace/contingency/planPremise.ts";
import { smrEstimate, smrMonth } from "../src/workspace/input/estimates.ts";
import { barNotices, householdNoticeText, type BarInputs } from "../src/workspace/header/status.ts";
import { modelHousehold, preview } from "./helpers.ts";

const NOW = "2026-10-18T10:00:00.000Z";

type EngineRequestLike = { input: { household: { members: (Record<string, unknown> & { id: string; sex: unknown })[] } } };

function sample(): BodyState {
  // 0.6 から: 住まい以外の不動産の中身（土地と建物・家賃収入・経費・取得。accounts[].property）と、その不動産のローン（debts[].property）を持つ
  // 見本の世帯（資産運用の積立の終わりが空・取り崩しの計画も持つ。0026・0028）
  const id = "dualAssetsTwoKids";
  const req = modelHousehold(id);
  // 0.9 から: 生まれる予定の子の保育所の段（保育の時間・自治体の水準の割合。月額は空＝収入から自動で計算）と、給食費の選び方（0029）
  const hh = req.input.household;
  const baby = "00000000-0000-4000-8000-0000000000b9";
  hh.members.push({ id: baby, kind: "child", birth: { birthYearMonth: "2027-06", bornOnFirst: false }, sex: "female", joins: null, leaves: null, expected: true } as (typeof hh.members)[number]);
  hh.goals = [
    ...(hh.goals ?? []).map((g, i) => (i === 0 && g.education !== undefined ? { ...g, education: { ...g.education, schoolLunch: "free" as const } } : g)),
    { id: "00000000-0000-4000-8000-0000000000ba", kind: "education", owner: baby, education: { stages: [{ stage: "nursery", hours: "short", feeRatio: "0.6" }] } },
  ];
  // 0.11 から: 黒字のうち貯まる割合（期間で変える組つき）（0031）。0.12 から: 生活防衛資金は持たない（0031 の追記）
  Object.assign(req.input.assumptions ?? {}, { surplusSaving: { ratio: "0.6", changes: [{ from: { at: "2038-04" }, ratio: "0.8" }] } });
  const self = roles(req).find((r) => r.key === "self")!.member;
  const demo = demoHousehold(id) ?? null;
  let wh: WorkingHousehold = fromRequest(req, { memo: ["架空のメモ"] });
  wh = { ...wh, labelsByMember: { [self.id]: "ご主人" }, statements: sampleStatements(self.id) };
  const cat = buildCatalog(wh, self.id, demo);
  const a = savePlan(wh, cat, { name: "プランB 生活費を28万円に", base: null, values: { "lever:livingMonthly": 280000 }, now: NOW });
  const b = savePlan(a.wh, cat, { name: "プランC プランB＋70歳まで働く", tags: ["老後"], base: a.id, values: { "lever:livingMonthly": 280000, "lever:retireAge": 70 }, now: NOW });
  return {
    wh: b.wh,
    workspace: { template: id, band: [a.id, b.id], base: CURRENT, selected: b.id, shownItems: ["rates:shift"] },
    // 0.8 から: 表示の設定はタブごとの区画（結果のタブ・資産と負債のタブ）。資産と負債のタブは、目安の幅・時点を並べるときの既定の時点と、
    // この世帯で選んだ時点（候補の鍵と決まった年）。0.13 から: お金の3つの分け方（何か月分・何年先まで・呼び方。0032）
    display: {
      result: { ...DEFAULT_DISPLAY_SETTINGS, metrics: ["takeHome"], atAge: 90, layout: "side", invBreakdown: true },
      balance: { ...DEFAULT_BALANCE_SETTINGS, guide: { months: [3, 12], risk: [10, 50], debt: 40 }, points: ["now", "loanEnd", "retire", "age80"], columns: [{ point: "now" }, { year: 2042 }, { point: "age75" }], moneyThree: { months: 3, years: 15, wording: "time" } },
    },
    carry: { extDefinitions: { "ext.exampleOffice.carCount": { type: "integer", label: "車の台数" } }, ext: { "ext.exampleOffice.carCount": 2 } },
  };
}

/** 0.14 から: 明細の取り込みの記録（架空。元のファイルは持たず、指紋と番号を消した後の行・FP が決めたこと・世帯の決まりだけ。0034） */
/**
 * 0.17 の見本の世帯（0035 の12）: sample() に、贈与者（世帯ファイルでは世帯の外の家族の構成員）・仮の印（値の状態の欄）・欄の差分
 * （当て先）・世帯の外の家族の印のある親を足す。足す・外す・置き換えの組などは、書き出した後に足す。
 * 表の最後の年の値も渡すが、どのプランにも共通の項目なので差分にならない（0043 の追記 2026-11-05。前は要求の入力の差分になっていた）
 */
function sample017(): BodyState {
  const s = sample();
  const self = roles(s.wh.request).find((r) => r.key === "self")!.member;
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  hh.donors = [{ id: "00000000-0000-4000-8000-0000000000d1", kind: "grandparent", of: self.id }];
  hh.members.push({ id: "00000000-0000-4000-8000-0000000000d2", kind: "parent", birth: { birthYearMonth: "1955-03", bornOnFirst: false }, sex: "male", joins: null, leaves: null, expected: false, support: { dependent: false, cohabiting: false }, outside: { of: self.id, periods: [] } } as (typeof hh.members)[number]);
  hh.relations = [...(hh.relations ?? []), { type: "parentOf", parent: "00000000-0000-4000-8000-0000000000d2", child: self.id } as NonNullable<typeof hh.relations>[number]];
  let wh: WorkingHousehold = { ...s.wh, request: req, assumed: { ...s.wh.assumed, "family/00000000-0000-4000-8000-0000000000b9/birth": "仮の値（予定日から）" } };
  const cat = buildCatalog(wh, self.id, null);
  const account = cat.items.find((i) => /^field:sav\/[0-9a-f-]{36}\/value$/.test(i.key));
  const values: Record<string, number> = { "field:assume/endYear": 2085, ...(account !== undefined ? { [account.key]: 5000000 } : {}) };
  wh = savePlan(wh, cat, { name: "プランD 資産を足す・表を2085年まで", base: null, values, now: NOW }).wh;
  return { ...s, wh, workspace: { ...s.workspace, shownItems: ["rates:shift", ...(account !== undefined ? [account.key] : [])] } };
}

/**
 * 0.18 の見本の世帯（0040）: sample017() に、段階と例外の年（周期的な支出・修繕費・固定資産税・不動産の家賃と経費）、器の利回りの段階と
 * 例外の年、資産配分の段階、働き方の期間ごとの伸び（給与の率）を足す。時点は年月・人の年齢・出来事からの形を混ぜる
 */
function sample018(): BodyState {
  const s = sample017();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const id = (n: number) => `00000000-0000-4000-8000-00000000e${String(n).padStart(3, "0")}`;
  const est = (value: number) => ({ value, state: "confirmed", origin: { kind: "manual" } });
  const pe = hh.periodicExpenses?.[0];
  if (pe !== undefined) Object.assign(pe, { stages: [{ id: id(1), at: { memberAge: { member: self.id, years: 65 } }, ratio: "0.5", rampYears: 5 }, { id: id(2), at: { memberAge: { member: self.id, years: 75 } }, amount: est(0) }], exceptions: [{ id: id(3), year: 2030, amount: est(0) }] });
  const home = hh.residences?.[0];
  if (home?.maintenance !== undefined) Object.assign(home.maintenance, { stages: [{ id: id(4), at: { at: "2036-04" }, amount: est(30000) }], exceptions: [{ id: id(5), year: 2041, amount: est(1500000) }] });
  if (home?.propertyTax !== undefined) Object.assign(home.propertyTax, { stages: [{ id: id(6), at: { at: "2030-01" }, ratio: "1.5" }] });
  const prop = hh.accounts?.find((a) => a.property?.rental !== undefined)?.property;
  if (prop?.rental !== undefined) Object.assign(prop.rental, { stages: [{ id: id(7), at: { at: "2035-01" }, ratio: "0.9", rampYears: 10 }, { id: id(8), at: { at: "2045-01" }, ratio: "0.8" }], exceptions: [{ id: id(9), year: 2032, amount: est(0) }] });
  if (prop?.expenses !== undefined) Object.assign(prop.expenses, { exceptions: [{ id: id(10), year: 2033, amount: est(2000000) }] });
  const nisa = hh.accounts?.find((a) => a.kind === "nisa" && a.owner === self.id);
  if (nisa !== undefined) Object.assign(nisa, { returnStages: [{ id: id(11), at: { memberAge: { member: self.id, years: 55 } }, assetMix: [{ assetClass: "equity.global", share: "0.6" }, { assetClass: "bond.global", share: "0.4" }], rampYears: 5 }, { id: id(12), at: { memberAge: { member: self.id, years: 60 } }, expectedReturn: "0.02" }], returnExceptions: [{ id: id(13), year: 2029, expectedReturn: "-0.2" }] });
  const inv = (req.input.assumptions ??= {} as NonNullable<typeof req.input.assumptions>).investment ?? {};
  req.input.assumptions!.investment = { ...inv, allocation: { mix: [{ assetClass: "equity.global", share: "0.8" }, { assetClass: "bond.global", share: "0.2" }], stages: [{ id: id(14), at: { memberAge: { member: self.id, years: 60 } }, mix: [{ assetClass: "equity.global", share: "0.4" }, { assetClass: "bond.global", share: "0.6" }] }] } };
  const job = hh.employmentPeriods?.find((p) => p.member === self.id && p.salary !== undefined);
  if (job?.salary !== undefined) job.salary.growth = { rate: "0.015" };
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.20 の見本の世帯（0044）: sample018() に、入るお金の行（相続〔不確か・基本の計算に入れる〕・副業〔必要経費・段階・例外の年〕・月額の援助）、
 * 出るお金の行に足した欄（月額・種類・相手・払う人・優先度・あげる贈与）、口座の間の移し替えの入れ物、相続で受け継ぐ借金の欄を足す
 */
function sample020(): BodyState {
  const s = sample018();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const id = (n: number) => `00000000-0000-4000-8000-00000000f${String(n).padStart(3, "0")}`;
  const est = (value: number) => ({ value, state: "confirmed" as const, origin: { kind: "manual" as const } });
  hh.incomeFlows = [
    { id: id(1), label: "父からの相続", kind: "inheritance", from: { memberAge: { member: self.id, years: 60 } }, to: { memberAge: { member: self.id, years: 60 } }, everyYears: 1, amount: est(20000000), likelihood: "uncertain", includeInBase: true },
    { id: id(2), kind: "sideJob", from: { at: "2027-04" }, to: { at: "2035-03" }, everyYears: 1, amount: est(1200000), cost: est(200000), recipient: self.id, stages: [{ id: id(3), at: { at: "2030-04" }, ratio: "0.5" }], exceptions: [{ id: id(4), year: 2029, amount: est(0) }], growth: { kind: "none" } },
    { id: id(5), kind: "support", from: { at: "2027-01" }, to: { at: "2028-12" }, everyYears: 1, monthly: true, amount: est(50000), taxTreatment: "nonTaxable", likelihood: "certain", onContingency: { mode: "stop" } },
  ];
  hh.periodicExpenses = [
    ...(hh.periodicExpenses ?? []),
    { id: id(6), label: "孫への贈与", kind: "gift", row: "cf.expense.lumpSum.gift", from: { at: "2028-04" }, to: { at: "2028-04" }, everyYears: 1, amount: est(1100000), payer: self.id, priority: "want", gift: { method: "calendar", purpose: "general" } },
    { id: id(7), label: "仕送り", kind: "allowance", row: "cf.expense.other", from: { at: "2027-01" }, to: null, everyYears: 1, monthly: true, amount: est(30000), priority: "need" },
  ];
  const accs = (hh.accounts ?? []).filter((a) => a.kind === "deposit" || a.kind === "nisa");
  if (accs.length >= 2) hh.transfers = [{ id: id(8), at: { at: "2030-01" }, from: accs[0]!.id, to: accs[1]!.id, how: { kind: "amount", amount: est(1000000) }, linked: id(2) }];
  const other = (hh.debts ?? [])[0];
  if (other !== undefined) Object.assign(other, { likelihood: "likely", includeInBase: false });
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.21 の見本の世帯（0052・0053）: sample020() に、持ち家の建て方・住み終わりの月に売る売却と譲渡所得の税の額、ほかのローンの名前と種類の細目、
 * 住宅ローンの入れ方の区分（画面の側）を足す
 */
function sample021(): BodyState {
  const s = sample020();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const est = (value: number) => ({ value, state: "confirmed" as const, origin: { kind: "manual" as const } });
  const home = (hh.residences ?? []).find((r) => r.kind === "own");
  if (home !== undefined) Object.assign(home, { style: "condo", to: { at: "2050-03" }, sale: { price: 30000000, tax: est(1500000) } });
  const other = (hh.debts ?? []).find((d) => d.kind !== "mortgage");
  if (other !== undefined) Object.assign(other, { label: "架空のカードローン", subtype: "cardLoan" });
  const loan = (hh.debts ?? []).find((d) => d.kind === "mortgage");
  return { ...s, wh: { ...s.wh, request: req, ...(loan !== undefined ? { loanEntry: { [loan.id]: "balance" as const } } : {}) } };
}

/**
 * 0.22 の見本の世帯（0057）: sample021() に、退職給付の名前と学歴（退職一時金の目安の元）を足す。名前を付けた確定給付企業年金（年金で受け取る）も1件
 */
function sample022(): BodyState {
  const s = sample021();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const list = (hh.retirementBenefits ??= []);
  const lump = list.find((b) => b.member === self.id && b.kind === "lumpSum");
  if (lump !== undefined) Object.assign(lump, { education: "highSchoolOffice" });
  list.push({ id: "00000000-0000-4000-8000-00000000a501", member: self.id, kind: "db", label: "架空の企業年金基金", ...(lump?.employment !== undefined ? { employment: lump.employment } : {}), amount: { value: 6000000, state: "confirmed", origin: { kind: "manual" } }, receipt: { method: "annuity", years: 10 } });
  return { ...s, wh: { ...s.wh, request: req } };
}

/** 0.23 の見本の世帯（0062）: sample022() に、教育の目標の学校外の費用の入れ方（行で入れる）と、塾・習い事の行の種類を足す */
function sample023(): BodyState {
  const s = sample022();
  const req = structuredClone(s.wh.request);
  const goal = (req.input.household.goals ?? []).find((g) => (g.education?.lessons ?? []).length > 0);
  if (goal?.education !== undefined) {
    goal.education.outOfSchoolMode = "rows";
    goal.education.lessons = (goal.education.lessons ?? []).map((l, i) => ({ ...l, kind: i === 0 ? "cram" : "lesson" }));
  }
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.24 の見本の世帯（0060・0061）: sample023() に、相続税の目安の設定（不動産の評価の割合・葬式の費用・法定相続人の数を直す口・FP が入れた額）と
 * 遺したい額、遺したい額を変えるプランの差分を足す
 */
function sample024(): BodyState {
  const s = sample023();
  const req = structuredClone(s.wh.request);
  const self = req.input.household.members.find((m) => m.kind === "self")!;
  req.input.inheritanceTax = { realEstateRatio: "0.7", funeral: 2000000, heirCounts: [{ decedent: self.id, count: 3 }], overrides: [{ point: "bothAfter", amount: 1200000 }] };
  req.input.legacy = { amount: { value: 10000000, state: "confirmed", origin: { kind: "manual" } } };
  const box = (value: number) => ({ value, state: "confirmed", origin: { kind: "manual" } });
  const diff = { id: "00000000-0000-4000-8000-00000000a024", op: "set" as const, target: { plan: "input" as const }, item: "plan.legacy", at: ["amount"], value: box(20000000), before: box(10000000), enabled: true, origin: { kind: "manual" as const }, note: null };
  const proposals = s.wh.proposals.map((p, i) => (i === 0 ? { ...p, diffs: [...p.diffs, diff] } : p));
  return { ...s, wh: { ...s.wh, request: req, proposals } };
}

/**
 * 0.25 の見本の世帯（0054・0055）: sample024() に、種類の細目と名前のある医療保険（三大疾病一時金・限度日数・配偶者が被保険者の
 * 入院日額の特約）、円の目安の形の変額保険（解約の月の額の数表の行）、逓減定期（保障の ID のある死亡保障の数表の行）と、
 * 万一の前提の病気の想定（病気の種類・入院の日数・手術の回数）を足す
 */
function sample025(): BodyState {
  const s = sample024();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const spouse = roles(req).find((r) => r.key === "spouse")?.member ?? self;
  const id = (n: number) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
  const base = { policyholder: self.id, insured: self.id, currency: "JPY" };
  hh.insuranceContracts = [
    ...(hh.insuranceContracts ?? []),
    {
      ...base,
      id: id(1),
      template: "insurance.medical",
      subtype: "medical",
      label: "架空の医療保険",
      contractDate: "2021-04",
      premium: { amount: 4000, frequency: "monthly", payUntil: null },
      deductionCategory: { type: "careMedical", regime: "new" },
      coverages: [
        { id: id(2), role: "main", benefit: "hospitalDaily", amount: 10000, maxDays: 60, from: { at: "2021-04" }, to: null },
        { id: id(3), role: "rider", benefit: "threeMajorLump", amount: 500000, from: { at: "2021-04" }, to: null },
        { id: id(4), role: "rider", benefit: "hospitalDaily", amount: 5000, insured: spouse.id, from: { at: "2021-04" }, to: null },
      ],
    },
    {
      ...base,
      id: id(5),
      template: "insurance.variable",
      subtype: "variable",
      contractDate: "2019-07",
      premium: { amount: 20000, frequency: "monthly", payUntil: { at: "2039-07" } },
      deductionCategory: { type: "general", regime: "new" },
      coverages: [{ id: id(6), role: "main", benefit: "death", amount: 8000000, from: { at: "2019-07" }, to: null }],
      simple: { estimate: true },
      surrender: { at: "2035-07" },
      schedule: { rows: [{ policyYear: 16, surrenderValue: 5200000 }] },
    },
    {
      ...base,
      id: id(7),
      template: "insurance.term",
      subtype: "decreasingTerm",
      contractDate: "2022-04",
      premium: { amount: 3000, frequency: "monthly", payUntil: { at: "2042-04" } },
      deductionCategory: { type: "general", regime: "new" },
      coverages: [{ id: id(8), role: "main", benefit: "death", amount: 20000000, from: { at: "2022-04" }, to: { at: "2042-03" } }],
      schedule: { rows: Array.from({ length: 20 }, (_, i) => ({ coverage: id(8), policyYear: i + 1, deathBenefit: 20000000 - 1000000 * i })) },
    },
  ] as typeof hh.insuranceContracts;
  return { ...s, wh: { ...s.wh, request: req, contingency: { ...s.wh.contingency, illness: { disease: "heartStroke", hospitalDays: 25, surgeries: 2 } } } };
}

/**
 * 0.26 の見本の世帯（0069）: sample025() に、維持費を内訳で入れる車（合計の値も残し、内訳に名前つきの行）と、
 * 合計で入れる車（内訳の値も残す）を足す
 */
function sample026(): BodyState {
  const s = sample025();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const id = (n: number) => `00000000-0000-4000-8000-0000000002${String(n).padStart(2, "0")}`;
  hh.cars = [
    ...(hh.cars ?? []),
    {
      id: id(1),
      owner: self.id,
      purchase: { first: { at: "2029-04" }, everyYears: 10, price: 3000000, tradeIn: 150000, owned: true },
      upkeepMode: "detail",
      upkeep: { annual: 400000 },
      tax: { annual: 36000 },
      insurance: { annual: 70000 },
      inspection: { amount: 100000 },
      upkeepOther: [
        { id: id(2), label: "スタッドレスタイヤ", annual: 30000 },
        { id: id(3), annual: 12000 },
      ],
    },
    { id: id(4), owner: self.id, purchase: { first: { at: "2031-04" }, everyYears: 8, price: 1800000 }, upkeepMode: "total", upkeep: { annual: 240000 }, parking: { annual: 120000 } },
  ];
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.27 の見本の世帯（0070・0071）: sample026() に、万一の前提の任意の欄（子の独立とみなす年齢・業務上の死亡・逆算方式・働き方を変える
 * 時点・復帰の後の働き方・収入が減る・下げる資産と戻り方・重ねる印）、前提の例外の年と厚生年金の調整率、表の最後の年の確定の行、
 * 前提と推定の一覧の確かめた記録、万一の前提を上書きするプランの差分を足す
 */
function sample027(): BodyState {
  const s = sample026();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const spouse = hh.members.find((m) => m.kind === "spouse")!;
  const child = hh.members.find((m) => m.kind === "child")!;
  const a = req.input.assumptions!;
  a.inflation = { default: "0.01", byYear: { "2027": "0.03", "2028": "0.03" } };
  a.pensionMacroSlideEmployee = { default: "0.006" };
  (req.input as { valueStates?: Record<string, unknown> }).valueStates = { "plan.endYear": { state: "confirmed", origin: { kind: "manual" }, estimate: { method: "standard", basis: "標準の値" } } };
  const c = structuredClone(s.wh.contingency);
  c.survivor = { ...c.survivor, independenceAge: 20, deathBenefits: { workRelated: true } };
  c.protection = { method: "reverse", reverseUntilAge: 90 };
  c.work = { ...c.work, [spouse.id]: { type: "partTime", from: { memberAge: { member: child.id, years: 7 } } } };
  c.illness = { ...c.illness, afterMonths: 12, afterRatio: "0.7" };
  c.incomeDrop = { member: "both", ratio: "0.3", years: 2 };
  c.market = { drop: "0.4", classes: ["equity.global", "kind:fxDeposit"], recoveryYears: 3, recoveryCap: "0" };
  c.stackMarket = true;
  const box = (value: unknown) => ({ value, state: "confirmed", origin: { kind: "manual" } });
  const diff = { id: "00000000-0000-4000-8000-00000000a027", op: "set" as const, target: { plan: "contingency" as const }, item: "contingencyPremise.survivor", at: ["livingRatio", "beforeIndependence"], value: box("0.6"), before: box(null), enabled: true, origin: { kind: "manual" as const }, note: null };
  const proposals = s.wh.proposals.map((p, i) => (i === 0 ? { ...p, diffs: [...p.diffs, diff] } : p));
  const agreed = { current: { "field:assume/inflation": { on: "2026-10-20", note: "面談で確かめた" } } };
  return { ...s, wh: { ...s.wh, request: req, contingency: c, proposals, agreed } };
}

/**
 * 0.28 の見本の世帯（0066・0067）: sample027() に、受給中の障害年金の行（種類）と、年金の入れ方を推計に戻したときに
 * 残した本人の定期便の記録（画面の側の pensionKept）を足す
 */
function sample028(): BodyState {
  const s = sample027();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const own = (hh.pensionRecords ?? []).find((r) => r.member === self.id);
  const kept = own ?? { id: "00000000-0000-4000-8000-00000000a261", member: self.id, kind: "statementUnder50", asOf: "2026-06", months: { basic: 180, employee: 170 }, amounts: { basic: { value: 380000, state: "confirmed", origin: { kind: "manual" } }, employee: { value: 420000, state: "confirmed", origin: { kind: "manual" } } } };
  hh.pensionRecords = (hh.pensionRecords ?? []).filter((r) => r.member !== self.id);
  if (hh.pensionRecords.length === 0) delete hh.pensionRecords;
  (hh.incomeFlows ??= []).push({
    id: "00000000-0000-4000-8000-00000000a262",
    label: "障害基礎年金",
    kind: "survivorPension",
    pensionType: "disabilityBasic",
    recipient: self.id,
    from: { at: req.input.baseMonth },
    to: null,
    everyYears: 1,
    amount: { value: 816000, state: "confirmed", origin: { kind: "manual" } },
  });
  return { ...s, wh: { ...s.wh, request: req, pensionKept: { [self.id]: [structuredClone(kept)] } } };
}

/** 0.29 の見本の世帯（0072）: sample028() に、確かめの一覧の「次回確かめる」の印を2つ足す */
function sample029(): BodyState {
  const s = sample028();
  const recheck = [
    { id: "field:living/monthly", card: "living", cardLabel: "基本生活費", label: "毎月の生活費", on: "2026-10-27" },
    { id: "gap:insurance", card: "insurance", cardLabel: "保険", label: "保険の契約", on: "2026-10-27" },
  ];
  return { ...s, wh: { ...s.wh, recheck } };
}

/** 0.30 の見本の世帯（0078）: sample029() の本人（年金の記録が無い＝推計の区分）に、受け取り開始（67歳になった翌月）を足す */
function sample030(): BodyState {
  const s = sample029();
  const req = structuredClone(s.wh.request);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const m = req.input.household.members.find((x) => x.id === self.id)!;
  const at = addMonths(`${Number(m.birth.birthYearMonth.slice(0, 4)) + 67}${m.birth.birthYearMonth.slice(4)}`, 1);
  m.pensionClaim = { basic: { at }, employee: { at } };
  return { ...s, wh: { ...s.wh, request: req } };
}

/** 0.31 の見本の世帯（0079）: sample030() の住まい以外の不動産（中身のある不動産の器）に、収益不動産の物件を見分ける欄を全部入れる */
function sample031(): BodyState {
  const s = sample030();
  const req = structuredClone(s.wh.request);
  const a = (req.input.household.accounts ?? []).find((x) => x.kind === "realEstate" && x.property !== undefined)!;
  Object.assign(a.property!, { name: "架空の駅前マンション", kind: "condo", location: "架空県架空市", share: "0.5", tenure: "ownership", units: 1, area: { land: "20.5", floor: "55.12" }, memo: "架空のメモ（管理会社と年1回打ち合わせ）" });
  return { ...s, wh: { ...s.wh, request: req } };
}

/** 0.32 の見本の世帯（0080）: sample031() の収益不動産の物件に、お金の欄（取得の内訳・諸費用・自己資金・家賃以外の月の収入・礼金と更新料・
 * 経費の費目・大きな修繕）を全部入れる。民泊・宿の欄は、2件目の物件（民泊・宿）に入れる */
function sample032(): BodyState {
  const s = sample031();
  const req = structuredClone(s.wh.request);
  const accounts = req.input.household.accounts ?? [];
  const a = accounts.find((x) => x.kind === "realEstate" && x.property !== undefined)!;
  const p = a.property!;
  p.acquisition = { price: p.acquisition?.price ?? 20000000, at: p.acquisition?.at ?? "2019-04", parts: { land: 6000000, building: 12000000, equipment: 2000000 }, equipmentLife: 15, costs: 1200000, equity: 5000000 };
  p.acquisition.price = 20000000;
  Object.assign(p.rental!, { commonFee: 5000, parking: 8000, otherMonthly: 2000, keyMoney: 120000 });
  p.expenses = { ...(p.expenses ?? {}), items: { management: 180000, propertyTax: 90000, insurance: 30000, groundRent: 0, facility: 12000, leasing: 60000, other: 50000 } };
  p.repairs = [{ id: "00000000-0000-4000-8000-0000000a0001", at: { at: "2031-06" }, amount: 3000000, label: "架空の外壁の塗り替え" }];
  accounts.push({
    id: "00000000-0000-4000-8000-0000000a0002",
    kind: "realEstate",
    owner: a.owner,
    marketValue: { value: 15000000, state: "confirmed", origin: { kind: "manual" } },
    asOf: a.asOf,
    contributions: [],
    property: {
      name: "架空の民泊",
      kind: "lodging",
      structure: "wood",
      rental: { monthly: { value: 0, state: "confirmed", origin: { kind: "manual" } } },
      expenses: { rate: "0.2", items: { cleaning: 240000, supplies: 60000, utilities: 120000 } },
      lodging: { business: "privateLodging", salesBy: "night", nightly: 18000, occupancy: "0.65", days: 180, platformRate: "0.15" },
    },
  });
  return { ...s, wh: { ...s.wh, request: req } };
}

/** 0.33 の見本の世帯（0081）: sample032() の収益不動産に売却の予定（ローンは返さない）、民泊・宿に所得の区分（事業所得）、名義の人に青色申告（55万円）を入れる */
function sample033(): BodyState {
  const s = sample032();
  const req = structuredClone(s.wh.request);
  const accounts = req.input.household.accounts ?? [];
  const a = accounts.find((x) => x.property?.repairs !== undefined)!;
  a.property!.sale = { at: { at: "2036-03" }, price: 26000000, repayLoan: false };
  const l = accounts.find((x) => x.property?.lodging !== undefined)!.property!.lodging!;
  l.incomeKind = "business";
  req.input.household.members.find((m) => m.id === a.owner)!.taxReturn = { method: "blue", blueDeduction: "doubleEntry" };
  return { ...s, wh: { ...s.wh, request: req } };
}

/** 0.34 の見本の世帯（0083）: sample033() に入力項目の選び方（車・介護・親を出さない、収益不動産と保険を詳細で開く）を入れる */
function sample034(): BodyState {
  const s = sample033();
  return { ...s, wh: { ...s.wh, itemChoice: { hidden: ["car", "care"], levels: { insurance: "detail", rental: "detail" } } } };
}

/**
 * 0.35 の見本の世帯（0041・0055 の追記）: sample034() のご主人に医療保険をもう1本足し、医療保険の重なりの注意を「確認した」にする
 */
function sample035(): BodyState {
  const s = sample034();
  const req = structuredClone(s.wh.request);
  const list = req.input.household.insuranceContracts ?? [];
  const first = list.find((c) => c.template === "insurance.medical")!;
  const id = (n: number) => `00000000-0000-4000-8000-0000000035${String(n).padStart(2, "0")}`;
  list.push({ ...structuredClone(first), id: id(1), label: "架空の医療保険（2本目）", contractDate: "2024-10", coverages: [{ id: id(2), role: "main", benefit: "hospitalDaily", amount: 5000, maxDays: 60, from: { at: "2024-10" }, to: null }] } as (typeof list)[number]);
  req.input.household.insuranceContracts = list;
  const wh: WorkingHousehold = { ...s.wh, request: req };
  const n = insuranceOverlapNotices(wh)[0]!;
  return { ...s, wh: setNoticeAck(wh, n.id, n.of, "2026-10-29") };
}

/**
 * 0.36 の見本の世帯（0085）: sample035() の万一の前提に、就業不能・収入が減るの場面の配偶者の働き方（partnerWork）を足し、
 * 最初のプランで収入が減るの場面の配偶者の年収を上書きする差分を足す
 */
function sample036(): BodyState {
  const s = sample035();
  const hh = s.wh.request.input.household;
  const spouse = hh.members.find((m) => m.kind === "spouse")!;
  const c = structuredClone(s.wh.contingency);
  c.partnerWork = { disability: { [spouse.id]: { type: "regular", annualSalary: 3000000, afterMonths: 3, untilAge: 60 } }, income: { [spouse.id]: { type: "partTime" } } };
  const box = (value: unknown) => ({ value, state: "confirmed", origin: { kind: "manual" } });
  const diff = { id: "00000000-0000-4000-8000-00000000a036", op: "set" as const, target: { plan: "contingency" as const }, item: "contingencyPremise.partnerWork", at: ["income", spouse.id, "annualSalary"], value: box(1500000), before: box(null), enabled: true, origin: { kind: "manual" as const }, note: null };
  const proposals = s.wh.proposals.map((p, i) => (i === 0 ? { ...p, diffs: [...p.diffs, diff] } : p));
  return { ...s, wh: { ...s.wh, contingency: c, proposals } };
}

/**
 * 0.37 の見本の世帯（0086）: sample036() の副業の行を表の行「雑所得」に載せ、事業所得として扱う副業の行（表の行は事業）を1つ足す
 */
function sample037(): BodyState {
  const s = sample036();
  const req = structuredClone(s.wh.request);
  const list = req.input.household.incomeFlows ?? [];
  const side = list.find((f) => f.kind === "sideJob")!;
  side.row = "cf.income.other.miscellaneous";
  const est = (value: number) => ({ value, state: "confirmed" as const, origin: { kind: "manual" as const } });
  list.push({ id: "00000000-0000-4000-8000-000000003701", label: "事業として続ける副業", kind: "sideJob", taxTreatment: "business", row: "cf.income.business", from: { at: "2028-01" }, to: { at: "2032-12" }, everyYears: 1, monthly: true, amount: est(150000), cost: est(60000), growth: { kind: "none" } });
  req.input.household.incomeFlows = list;
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.38 の見本の世帯（0047 の追記 2026-10-29 の2）: sample037() の配偶者の働き方の期間の標準報酬月額を空欄にする（画面が新しく作る期間と同じ。
 * 給与から毎年9月に決め直して計算する）
 */
function sample038(): BodyState {
  const s = sample037();
  const req = structuredClone(s.wh.request);
  const spouse = req.input.household.members.find((m) => m.kind === "spouse")!;
  for (const p of req.input.household.employmentPeriods ?? []) if (p.member === spouse.id) delete p.standardMonthlyRemuneration;
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.39 の見本の世帯（0062・0029 の追記 2026-10-30）: sample038() の教育の目標の段に、段ごとの給食費の選び方（公立小学校を自治体の無償化）・
 * 部活動などの費用（中学校）・保育料とは別にかかるお金（保育所の段）を足す
 */
function sample039(): BodyState {
  const s = sample038();
  const req = structuredClone(s.wh.request);
  for (const g of req.input.household.goals ?? []) {
    for (const st of g.education?.stages ?? []) {
      if (st.stage === "elementary") st.schoolLunch = "free";
      if (st.stage === "juniorHigh") st.clubAnnual = 84000;
      if (st.stage === "nursery") st.extraAnnual = 12000;
    }
  }
  return { ...s, wh: { ...s.wh, request: req } };
}

/** 0.40 の見本の世帯（0088）: sample039() の大学の段がある子に、単位が認められる1年の留学と休学して1年の留学（やめる）を足す */
function sample040(): BodyState {
  const s = sample039();
  const req = structuredClone(s.wh.request);
  const g = (req.input.household.goals ?? []).find((x) => (x.education?.stages ?? []).some((st) => st.stage === "university"))!;
  g.education!.abroad = [
    { id: "00000000-0000-4000-8000-000000004001", stage: "university", grade: 3, kind: "credit", amount: 2270000 },
    { id: "00000000-0000-4000-8000-000000004002", stage: "university", grade: 2, kind: "leave", amount: 2570000, onContingency: { mode: "stop" } },
  ];
  return { ...s, wh: { ...s.wh, request: req } };
}

/** 0.41 の見本の世帯（0089）: sample040() の大学の段がある子に大学院（修士・国立）を足し、高校の段がある子の高校をインターナショナルスクール（年額を入れる）にする */
function sample041(): BodyState {
  const s = sample040();
  const req = structuredClone(s.wh.request);
  const goals = req.input.household.goals ?? [];
  const uni = goals.find((x) => (x.education?.stages ?? []).some((st) => st.stage === "university"))!;
  uni.education!.stages.push({ id: "00000000-0000-4000-8000-000000004101", stage: "graduateMaster", sector: "national", living: "home" });
  const hs = goals.filter((x) => x !== uni).find((x) => (x.education?.stages ?? []).some((st) => st.stage === "highSchool"))!;
  const st = hs.education!.stages.find((x) => x.stage === "highSchool")!;
  st.sector = "international";
  st.annualOverride = 2400000;
  return { ...s, wh: { ...s.wh, request: req } };
}

/** 0.42 の見本の世帯（0090）: sample041() の大学院の段がある子に専門職大学院（法科大学院・私立）を足し、インターナショナルスクールの高校の子の高校を国立の高専にする */
function sample042(): BodyState {
  const s = sample041();
  const req = structuredClone(s.wh.request);
  const goals = req.input.household.goals ?? [];
  const grad = goals.find((x) => (x.education?.stages ?? []).some((st) => st.stage === "graduateMaster"))!;
  grad.education!.stages.push({ id: "00000000-0000-4000-8000-000000004201", stage: "graduateProfessional", sector: "private", field: "law", living: "home" });
  const hs = goals.flatMap((x) => x.education?.stages ?? []).find((st) => st.sector === "international")!;
  hs.stage = "kosen";
  hs.sector = "national";
  delete hs.annualOverride;
  return { ...s, wh: { ...s.wh, request: req } };
}

/** 0.43 の見本の世帯（0100）: sample042() の基本生活費を内訳で入れ、10費目と仕送り（通信費・交通費・こづかいと交際費・その他を含む）と、前の分け方の交通・通信を持たせる */
function sample043(): BodyState {
  const s = sample042();
  const req = structuredClone(s.wh.request);
  const l = req.input.household.livingExpenses![0]!;
  const conf = (value: number) => ({ value, state: "confirmed" as const, origin: { kind: "manual" as const } });
  l.mode = "byCategory";
  const cats: [string, number][] = [
    ["food", 120000],
    ["utilities", 30000],
    ["communication", 15000],
    ["transit", 8000],
    ["furniture", 12000],
    ["clothing", 25000],
    ["health", 20000],
    ["recreation", 40000],
    ["pocketAndSocial", 30000],
    ["other", 20000],
    ["allowance", 0],
    ["transport", 10000],
  ];
  l.categories = cats.map(([category, v], i) => ({ id: `00000000-0000-4000-8000-0000000043${String(i).padStart(2, "0")}`, category, monthly: conf(v) })) as typeof l.categories;
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.44 の見本の世帯（0041 の追記 2026-10-31）: sample043() の本人の住民税の年税額を「書類で確かめる」（書類待ち。状態 unknown・前に入っていた値を
 * 代わりに使う）にした物。書類で確かめる欄の unknown は 0.44 でも残る
 */
function sample044(): BodyState {
  const s = sample043();
  const req = structuredClone(s.wh.request);
  const t = (req.input.household.residentTaxAssessments as unknown as { amount: Record<string, unknown> }[])[0]!;
  const v = t.amount.value as number;
  t.amount = { state: "unknown", origin: { kind: "manual" }, substitute: { value: v, state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "前に入っていた値を代わりに使う" } } };
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.45 の見本の世帯（0101）: sample044() に、今の車に乗り続ける車（手放す時期は今から5年の推定）・この1台だけのこれから買う車（手放す時期は
 * 出来事「車の購入」から13年後の推定）・70歳まで買い替える車・長期レンタルの車（月額・借り始め・契約の年数・月額に含む物）を足す
 */
function sample045(): BodyState {
  const s = sample044();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const id = (n: number) => `00000000-0000-4000-8000-0000000045${String(n).padStart(2, "0")}`;
  const est = (basis: string) => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis } });
  hh.events = [...(hh.events ?? []), { id: id(10), kind: "carPurchase", member: self.id, at: { at: "2030-04" } }];
  hh.cars = [
    ...(hh.cars ?? []),
    {
      id: id(1),
      owner: self.id,
      purchase: { first: { at: "2029-04" }, everyYears: 8, price: 2500000, tradeIn: 380000, owned: true, replace: { kind: "none" } },
      until: { at: "2031-10" },
      upkeepMode: "total",
      upkeep: { annual: 300000 },
      valueStates: { "car.until": est("標準の値（今から5年。今の車を手放す時期に合わせて直してください）") },
    },
    {
      id: id(2),
      owner: self.id,
      purchase: { first: { event: id(10) }, everyYears: 8, price: 2000000, replace: { kind: "none" } },
      until: { event: id(10), offset: { years: 13 } },
      upkeepMode: "total",
      upkeep: { annual: 240000 },
      valueStates: { "car.until": est("平均使用年数の目安（買ってから13年）") },
    },
    {
      id: id(3),
      owner: self.id,
      purchase: { first: { at: "2028-04" }, everyYears: 7, price: 3000000, tradeIn: 400000, owned: true, replace: { kind: "until", until: { memberAge: { member: self.id, years: 69, months: 11 } } } },
      until: { memberAge: { member: self.id, years: 78, months: 0 } },
      upkeepMode: "total",
      upkeep: { annual: 360000 },
    },
    {
      id: id(4),
      owner: self.id,
      lease: { type: "longRental", monthly: 45000, from: { at: "2031-01" }, termYears: 5, includes: { insurance: false } },
      until: { memberAge: { member: self.id, years: 75, months: 0 } },
      upkeepMode: "total",
      upkeep: { annual: 150000 },
    },
  ];
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.46 の見本の世帯（0103）: sample045() に、夢プランの夢を3件（2件目は「計算に入れない」・順位は2→1→3の並び・ひとことメモつき）と、
 * 第1子への援助（結婚資金・優先度「できれば」）を足す
 */
function sample046(): BodyState {
  const s = sample045();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const id = (n: number) => `00000000-0000-4000-8000-0000000046${String(n).padStart(2, "0")}`;
  const box = (v: number) => ({ value: v, state: "confirmed", origin: { kind: "manual" } }) as never;
  hh.periodicExpenses = [
    ...(hh.periodicExpenses ?? []),
    { id: id(1), label: "二拠点や別荘", kind: "dream", row: "cf.expense.lumpSum.other", from: { memberAge: { member: self.id, years: 62 } }, to: { memberAge: { member: self.id, years: 62 } }, everyYears: 1, amount: box(8000000), dream: { rank: 2, include: false, note: "海の近くで暮らしたい" } },
    { id: id(2), label: "夫婦で海外旅行", kind: "dream", row: "cf.expense.lumpSum.other", from: { memberAge: { member: self.id, years: 65 } }, to: { memberAge: { member: self.id, years: 65 } }, everyYears: 1, amount: box(1200000), dream: { rank: 1, note: "結婚30周年に" } },
    { id: id(3), label: "趣味を始める", kind: "dream", row: "cf.expense.lumpSum.other", from: { at: "2028-04" }, to: { at: "2032-04" }, everyYears: 1, amount: box(200000), dream: { rank: 3 } },
  ];
  const kid = roles(req).find((r) => r.key === "child1")!.member;
  hh.goals = (hh.goals ?? []).map((g) => (g.kind === "education" && g.owner === kid.id && g.education !== undefined ? { ...g, education: { ...g.education, gifts: [...(g.education.gifts ?? []), { id: id(10), at: { memberAge: { member: kid.id, years: 30 } }, amount: 1000000, purpose: "wedding", priority: "want" as const }] } } : g));
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.47 の見本の世帯（0104）: sample046() の第1子に貸与の奨学金を2件（子が返す・世帯で返す）、第2子の成人式の行（子の年齢の時点。20歳になる年度の1月）、
 * ご本人のほかのローンに第一種（無利子）の奨学金の返済を足す
 */
function sample047(): BodyState {
  const s = sample046();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const kid1 = roles(req).find((r) => r.key === "child1")!.member;
  const kid2 = roles(req).find((r) => r.key === "child2")!.member;
  const id = (n: number) => `00000000-0000-4000-8000-0000000047${String(n).padStart(2, "0")}`;
  const box = (v: number) => ({ value: v, state: "confirmed", origin: { kind: "manual" } }) as never;
  hh.goals = (hh.goals ?? []).map((g) =>
    g.kind === "education" && g.owner === kid1.id && g.education !== undefined
      ? {
          ...g,
          education: {
            ...g.education,
            scholarships: [
              { id: id(1), monthly: 50000, from: { at: "2029-04" }, to: { at: "2033-03" }, rate: "0.03", termMonths: 180, repaidBy: "child" as const },
              { id: id(2), monthly: 20000, from: { at: "2029-04" }, to: { at: "2033-03" }, rate: "0", termMonths: 120, repaidBy: "household" as const, debtor: "parent" as const },
            ],
          },
        }
      : g,
  );
  const coming = { memberAge: { member: kid2.id, years: 20, ageSwitch: "schoolYearJanuary" } };
  hh.periodicExpenses = [...(hh.periodicExpenses ?? []), { id: id(3), label: "第2子の成人式", kind: "general", row: "cf.expense.lumpSum.other", from: coming, to: coming, everyYears: 1, amount: box(150000) } as never];
  hh.debts = [
    ...(hh.debts ?? []),
    { id: id(4), kind: "scholarship", subtype: "scholarshipFree", debtors: [{ member: self.id, role: "primary" }], principal: 2400000, start: { at: "2020-10" }, rateSchedule: [{ id: id(5), from: { at: "2020-10" }, type: "fixed", rate: "0" }], repayment: { method: "equalPayment", termMonths: 180 } },
  ];
  return { ...s, wh: { ...s.wh, request: req } };
}

function sample048(): BodyState {
  const s = sample047();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const id = (n: number) => `00000000-0000-4000-8000-0000000048${String(n).padStart(2, "0")}`;
  const box = (v: number) => ({ value: v, state: "confirmed", origin: { kind: "manual" } }) as never;
  // 本人は役員（今の勤め先の期間を役員にする）。自社株（出資額）・会社への貸付金・会社からの借入金・会社の借入の連帯保証の額（0105）
  hh.employmentPeriods = (hh.employmentPeriods ?? []).map((p) => (p.member === self.id && p.salary !== undefined ? { ...p, type: "executive" } : p));
  hh.accounts = [
    ...(hh.accounts ?? []),
    { id: id(1), kind: "otherAsset", subtype: "ownCompanyShares", owner: self.id, marketValue: box(3000000), asOf: req.input.baseMonth, contributions: [] },
    { id: id(2), kind: "otherAsset", subtype: "loanToCompany", owner: self.id, marketValue: box(5000000), asOf: req.input.baseMonth, contributions: [] },
  ];
  hh.debts = [
    ...(hh.debts ?? []),
    { id: id(3), kind: "other", subtype: "companyLoan", debtors: [{ member: self.id, role: "primary" }], principal: 2000000, start: { at: req.input.baseMonth }, balance: box(2000000), balanceAsOf: req.input.baseMonth, rateSchedule: [{ id: id(4), from: { at: req.input.baseMonth }, type: "fixed", rate: "0" }], repayment: { method: "equalPayment", termMonths: 40 } },
  ];
  hh.members = hh.members.map((m) => (m.id === self.id ? { ...m, companyGuarantee: box(30000000) } : m));
  return { ...s, wh: { ...s.wh, request: req }, display: { ...s.display, balance: { ...s.display.balance, guide: { ...s.display.balance.guide, basis: "livingLoan" } } } };
}

function sample049(): BodyState {
  const s = sample048();
  const req = structuredClone(s.wh.request);
  // 子の貸与の奨学金の種類（0104 の追記）: 1件を第一種（無利子・0%）にする。ほかは種類なし（第二種）のまま
  const sch = (req.input.household.goals ?? []).flatMap((g) => g.education?.scholarships ?? []);
  sch[0]!.type = "first";
  sch[0]!.rate = "0";
  return { ...s, wh: { ...s.wh, request: req } };
}

/** 合算BS の入力欄の値の置き場所と宣言（0114 の9） */
const CO_KEY = "ext.official.combinedBs";
const CO_DECL = OFFICIAL_EXTENSIONS.find((x) => x.manifest.id === CO_KEY)!.fields[0]!;

/** 0.50 の形（0107）: 会社と合わせたバランスシートの入力（計算の要求の外。架空の会社の数字）。0.57 から拡張領域の値（0114） */
function sample050(): BodyState {
  const s = sample049();
  const M = 10000;
  const companyBs: CombinedBsInput = {
    version: 1,
    asOf: "2026-09",
    amounts: { cash: 2000 * M, receivables: 1500 * M, inventory: 800 * M, otherCurrent: 200 * M, land: 1500 * M, buildings: 1200 * M, investments: 500 * M, otherFixed: 300 * M, shortDebt: 1000 * M, longDebt: 4000 * M, loanFromOwner: 500 * M, otherLiabilities: 1000 * M, capital: 300 * M, retained: 1200 * M, monthlyFixed: 420 * M, monthlyLoanPay: 80 * M },
    stage: "stable",
    ownerMonthly: null,
    restated: { receivables: 1200 * M },
    useRestated: false,
  };
  return { ...s, wh: { ...s.wh, extValues: { [CO_KEY]: readExtValue(CO_DECL, companyBs)! } } };
}

/** 0.51 の形（0055 の追記 2026-11-02）: 保険の種類の細目に三大疾病保険（医療保険の型。主な保障は三大疾病一時金）を足す */
function sample051(): BodyState {
  const s = sample050();
  const req = structuredClone(s.wh.request);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const id = (n: number) => `00000000-0000-4000-8000-0000000005${String(n).padStart(2, "0")}`;
  req.input.household.insuranceContracts = [
    ...(req.input.household.insuranceContracts ?? []),
    {
      id: id(1),
      policyholder: self.id,
      insured: self.id,
      currency: "JPY",
      template: "insurance.medical",
      subtype: "threeMajor",
      label: "架空の三大疾病保険",
      contractDate: "2023-04",
      premium: { amount: 5000, frequency: "monthly", payUntil: null },
      deductionCategory: { type: "careMedical", regime: "new" },
      coverages: [{ id: id(2), role: "main", benefit: "threeMajorLump", amount: 3000000, from: { at: "2023-04" }, to: null }],
    },
  ] as typeof req.input.household.insuranceContracts;
  return { ...s, wh: { ...s.wh, request: req } };
}

/** 0.52 の形（0055 の追記 2026-11-03）: 低解約返戻金型終身保険（払込中の率・年齢ごとの率の点）とアカウント型（積立の部分）を足す */
function sample052(): BodyState {
  const s = sample051();
  const req = structuredClone(s.wh.request);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const id = (n: number) => `00000000-0000-4000-8000-0000000006${String(n).padStart(2, "0")}`;
  req.input.household.insuranceContracts = [
    ...(req.input.household.insuranceContracts ?? []),
    {
      id: id(1),
      policyholder: self.id,
      insured: self.id,
      currency: "JPY",
      template: "insurance.wholeLife",
      subtype: "lowSurrender",
      label: "架空の低解約返戻金型終身保険",
      contractDate: "2022-04",
      premium: { amount: 15000, frequency: "monthly", payUntil: { memberAge: { member: self.id, years: 65, months: 0 } } },
      deductionCategory: { type: "general", regime: "new" },
      coverages: [{ id: id(2), role: "main", benefit: "death", amount: 5000000, from: { at: "2022-04" }, to: null }],
      simple: {
        returnRate: "1.05",
        returnRateDuring: "0.7",
        returnRatePoints: [
          { id: id(3), age: 70, rate: "1.12" },
          { id: id(4), age: 80, rate: "1.25" },
        ],
      },
    },
    {
      id: id(5),
      policyholder: self.id,
      insured: self.id,
      currency: "JPY",
      template: "insurance.wholeLife",
      subtype: "account",
      label: "架空のアカウント型保険",
      contractDate: "2018-04",
      premium: { amount: 18000, frequency: "monthly", payUntil: { memberAge: { member: self.id, years: 60, months: 0 } } },
      deductionCategory: { type: "general", regime: "new" },
      coverages: [{ id: id(6), role: "main", benefit: "death", amount: 20000000, from: { at: "2018-04" }, to: { memberAge: { member: self.id, years: 60, months: 0 } } }],
      renewals: [{ id: id(7), at: { at: "2028-04" }, premium: 23000 }],
      simple: { account: { value: 2500000, after: "annuity", annual: 270000, years: 10 } },
    },
  ] as typeof req.input.household.insuranceContracts;
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.53 の形（0052 の追記 2026-11-03・0112）: 今の持ち家を売った翌月に、中古の戸建て（認定長期優良住宅）を買う予定を足す。
 * 住宅の購入の種類（新築か中古か）と長期優良住宅かは、表示と推定の元だけで計算に使わない
 */
function sample053(): BodyState {
  const s = sample052();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const id = (n: number) => `00000000-0000-4000-8000-0000000007${String(n).padStart(2, "0")}`;
  const est = (value: number) => ({ value, state: "confirmed" as const, origin: { kind: "manual" as const } });
  (hh.residences ??= []).push({
    id: id(1),
    kind: "own",
    style: "house",
    from: { at: "2050-04" },
    to: null,
    purchase: { at: { at: "2050-04" }, price: 30000000, downPayment: 30000000, costs: 2400000, newBuild: false, longLife: true },
    propertyTax: { annual: est(90000) },
    maintenance: { monthly: est(15000) },
    ownership: [{ member: self.id, share: "1" }],
    valuation: { structure: "wood", builtYear: 2040 },
  });
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.54 の形（0111 の追記 2026-11-03）: 配偶者の賞与を、事務所の推定の値から作った推定にする（推定の元の印 estimate.source。値ID → 事務所の値の指紋）。
 * 印は表示と知らせだけで計算に使わない
 */
function sample054(): BodyState {
  const s = sample053();
  const req = structuredClone(s.wh.request);
  const p = (req.input.household.employmentPeriods ?? []).find((x) => x.type === "regular");
  if (p?.salary !== undefined)
    p.salary = {
      ...p.salary,
      bonus: { value: 1100000, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: "当事務所のお客さまの平均（架空）", source: { kind: "office", values: { "wageStats.annualBonus.regular.female": "1a2b3c4d" } } } } as never,
    };
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.55 の形（0115）: 注文住宅（土地を買って建てる）を1件足す。土地の決済の月・土地の代金と、その月に払う頭金と諸費用（合計の内数）、
 * 引き渡しの前に頭金から払う着工金。土地の分のローン（土地先行融資）は土地の決済の月に借りる
 */
function sample055(): BodyState {
  const s = sample054();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const id = (n: number) => `00000000-0000-4000-8000-0000000008${String(n).padStart(2, "0")}`;
  const est = (value: number) => ({ value, state: "confirmed" as const, origin: { kind: "manual" as const } });
  (hh.residences ??= []).push({
    id: id(1),
    kind: "own",
    style: "house",
    from: { at: "2060-04" },
    to: null,
    purchase: {
      at: { at: "2060-04" },
      price: 50000000,
      downPayment: 6000000,
      costs: 3000000,
      newBuild: true,
      land: { at: { at: "2059-07" }, price: 18000000, downPayment: 4000000, costs: 1100000 },
      payments: [{ id: id(2), at: { at: "2059-11" }, amount: 1000000, kind: "start" }],
    },
    propertyTax: { annual: est(150000) },
    maintenance: { monthly: est(15000) },
    ownership: [{ member: self.id, share: "1" }],
    valuation: { structure: "wood" },
  });
  (hh.debts ??= []).push({
    id: id(3),
    kind: "mortgage",
    debtors: [{ member: self.id, role: "primary" }],
    principal: 14000000,
    start: { at: "2059-07" },
    rateSchedule: [{ id: id(4), from: { at: "2059-07" }, type: "fixed", rate: "0.018" }],
    repayment: { method: "equalPayment", termMonths: 240 },
  } as never);
  return { ...s, wh: { ...s.wh, request: req } };
}

/** 0.56 の見本の移行の取り込みの記録（架空。汎用の言葉の見出し・伏せ字の後の文字・参照値・移行メモ。0113 の10） */
const MIGRATION_IMPORT = "00000000-0000-4000-8000-000000000801";
function sampleMigrations(): MigrationLog {
  return {
    version: 1,
    imports: [
      {
        id: MIGRATION_IMPORT,
        kind: "migration",
        at: "2026-11-03T10:15:00+09:00",
        approvedBy: "fp",
        file: { sha256: `sha256:${"3".repeat(64)}`, bytes: 123456 },
        reader: { id: "pdfText", version: 1 },
        rule: { id: "official.genericReport", revision: 1, contract: "migration-rule@1.0" },
        dictionaries: [{ id: "official.fpTerms", revision: 1 }],
        source: { product: null, document: "ライフプランの帳票", planBaseMonth: "2024-04" },
        extracted: [
          { block: "family", label: "本人の生年月", text: "1990年5月", to: { item: "member.birth", member: "self" }, decidedBy: "rule" },
          { block: "assets", label: "預貯金", text: "350万円", to: { item: "account.marketValue", object: "account" }, decidedBy: "fp" },
          { block: "cf", label: "年間収支", text: "（表の行）", to: { row: "cf.net" }, decidedBy: "rule" },
          { block: "notes", label: "備考", text: "（氏名）様の希望: 早めに繰上げ返済", to: { memo: true }, decidedBy: "rule" },
        ],
        referenceValues: [
          { row: "cf.net", year: 2027, amount: 1830000, label: "年間収支", basisMonth: "2024-04", precision: 10000 },
          { row: "cf.balance.financial", year: 2027, amount: 4120000, label: "貯蓄残高", basisMonth: "2024-04", precision: 10000 },
        ],
        memo: [{ label: "備考", text: "（氏名）様の希望: 早めに繰上げ返済" }],
        conventions: { tableAge: "yearStart", firstYear: "wholeYear", valueBasis: "nominal" },
        candidates: ["00000000-0000-4000-8000-000000000802"],
        ai: { headings: false },
      },
    ],
  };
}

/**
 * 0.56 の形（0113 の7・8・10）: 他のソフトから移した世帯。区画 migrations に取り込みの記録を1件置き、最初の口座の時価を、移行元のプランの時点
 * （2024年4月）と今の計算基準月が違う時点のある値として、推定の出し方 migrated の推定にする（値は前と同じ。承認の記録つき）。互換モードは null のまま
 * （互換モードは照合用のプランだけ）
 */
function sample056(): BodyState {
  const s = sample055();
  const req = structuredClone(s.wh.request);
  const acc = req.input.household.accounts![0] as unknown as { marketValue: { value: number } & Record<string, unknown> };
  acc.marketValue = {
    value: acc.marketValue.value,
    state: "estimated",
    origin: { kind: "import", ref: MIGRATION_IMPORT },
    approval: { by: "fp", at: "2026-11-03T10:20:00+09:00", candidate: "00000000-0000-4000-8000-000000000802" },
    estimate: { method: "migrated", basis: "移行元のプラン（2024年4月時点）の値" },
  };
  return { ...s, wh: { ...s.wh, request: req, migrations: sampleMigrations() } };
}

/** 0.57 の形（0114 の9）: 0.56 と同じ中身。会社の入力の置き場所が拡張領域になった（sample050 から extValues で持つ） */
function sample057(): BodyState {
  return sample056();
}

/**
 * 0.58 の見本の世帯（0118）: sample057() から退職給付の学歴を外し（人の属性で推定の数字を分けない。画面は書かない）、正社員の期間の1つに
 * 男女計・学歴計の統計の年齢カーブ（1,000人以上）を書く
 */
function sample058(): BodyState {
  const s = sample057();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  for (const b of hh.retirementBenefits ?? []) delete (b as Record<string, unknown>).education;
  const p = (hh.employmentPeriods ?? []).find((x) => x.type === "regular" && x.salary !== undefined);
  if (p?.salary !== undefined) p.salary.growth = { curve: "wageStats.curve.regular.all.all.large" };
  return { ...s, wh: { ...s.wh, request: req } };
}

const id059 = (n: number) => `00000000-0000-4000-8000-0000000059${String(n).padStart(2, "0")}`;

/**
 * 0.59 の見本の世帯（0120）: sample058() に、その他の資産の中身の細目（細目ごとに1件）と細目の無いその他の資産を足す。
 * 0.59 の見本には細目「暗号資産」（ID の 02）もあったが、0.60 で器の種類にしたので、ここでは足さない（sample060 が器として足す。0122）
 */
function sample059(): BodyState {
  const s = sample058();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const box = (v: number) => ({ value: v, state: "confirmed", origin: { kind: "manual" } }) as never;
  const subs = [
    ["preciousMetal", 1],
    ["art", 3],
    ["membership", 4],
    ["securityDeposit", 5],
    ["businessAsset", 6],
  ] as const;
  hh.accounts = [
    ...(hh.accounts ?? []),
    ...subs.map(([subtype, n]) => ({ id: id059(n), kind: "otherAsset", subtype, owner: self.id, marketValue: box(n * 1000000), asOf: req.input.baseMonth, contributions: [] })),
    { id: id059(9), kind: "otherAsset", owner: self.id, marketValue: box(700000), asOf: req.input.baseMonth, contributions: [], valueGrowth: "-0.05" },
  ];
  return { ...s, wh: { ...s.wh, request: req } };
}

/** 0.60 の見本の世帯（0122）: sample059() に、暗号資産の器（金融資産。器の利回りと積立あり）を足す（0.59 の見本の細目「暗号資産」と同じ ID） */
function sample060(): BodyState {
  const s = sample059();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const box = (v: number) => ({ value: v, state: "confirmed", origin: { kind: "manual" } }) as never;
  hh.accounts = [
    ...(hh.accounts ?? []),
    {
      id: id059(2),
      kind: "cryptoAsset",
      owner: self.id,
      marketValue: box(2000000),
      asOf: req.input.baseMonth,
      contributions: [{ id: "00000000-0000-4000-8000-000000006001", from: { at: req.input.baseMonth }, to: { at: "2030-12" }, monthly: 10000 }],
      expectedReturn: "0.02",
    },
  ];
  return { ...s, wh: { ...s.wh, request: req } };
}

function sampleStatements(owner: string): StatementLog {
  return {
    version: 1,
    accounts: [{ id: "acc-1", kind: "card", label: "ご主人のカード（架空）", owner, issuer: "smbc" }],
    imports: [
      {
        id: "imp-1",
        kind: "statement",
        at: "2026-10-20T10:00:00+09:00",
        account: "acc-1",
        file: { sha256: `sha256:${"0".repeat(64)}`, bytes: 1234 },
        reader: { id: "csv", version: 1 },
        format: { fingerprint: `sha256:${"1".repeat(64)}`, mapping: { headerRow: 0, columns: { date: 0, merchant: 1, amount: 2 }, sign: "expensePositive" }, source: "fp" },
        period: { from: "2026-09-01", to: "2026-09-30" },
        rows: [
          { id: "r2", line: 2, date: "2026-09-03", merchant: "架空スーパー", key: "架空スーパー", amount: 3200 },
          { id: "r3", line: 3, date: "2026-09-10", merchant: "架空の店 ●●●●", key: "架空ノ店", amount: 4500, category: "recreation", bucket: "household", decidedAt: "2026-10-20T10:05:00+09:00" },
          { id: "r4", line: 4, date: "2026-09-17", merchant: "架空スーパー", key: "架空スーパー", amount: 3300 },
        ],
        include: true,
      },
    ],
    rules: [{ id: "rule-1", match: { category: "communication" }, owner, bucket: "household", at: "2026-10-20T10:06:00+09:00" }],
    applied: [],
    // 0.15 から: 確認シートの依頼の記録（架空。シートの番号 → 行の対応と、書き出したファイル・返ってきたファイルの指紋だけ。0034 の9）
    requests: [
      {
        id: "M-3K7P9Q",
        at: "2026-10-21T09:00:00+09:00",
        file: { sha256: `sha256:${"2".repeat(64)}`, bytes: 9876 },
        rows: [{ no: 1, import: "imp-1", row: "r2" }],
        received: [{ at: "2026-10-22T10:00:00+09:00", file: { sha256: `sha256:${"3".repeat(64)}`, bytes: 10234 }, decided: 1 }],
      },
      // 0.16 から: 店ごとにまとめたシートの1行は、同じ番号に複数の行（架空）
      {
        id: "M-5R8T2W",
        at: "2026-10-23T09:00:00+09:00",
        file: { sha256: `sha256:${"4".repeat(64)}`, bytes: 9900 },
        rows: [
          { no: 1, import: "imp-1", row: "r2" },
          { no: 1, import: "imp-1", row: "r4" },
        ],
        received: [],
      },
    ],
  };
}

/** 見本の控え（固定の ID・日時。PDF を書き出した時点） */
async function withSnapshot(s: BodyState): Promise<BodyState> {
  const snap = await makeSnapshot({
    wh: s.wh,
    drafts: {},
    draft: { trigger: "pdf", memo: "提案書（16ページ）", plan: { id: s.workspace.selected, letter: "C", name: "プランB＋70歳まで働く" } },
    appVersion: "0.1.0",
    now: new Date(Date.UTC(2026, 9, 19, 5, 0, 0)),
    id: "00000000-0000-4000-8000-0000000000c1",
  });
  // 持ち帰り用のレポートの書き出しの記録（0030。形式の版 0.10 から）: 載せたプラン・パスワードの有無だけ（パスワード・宛名は持たない）
  const tk = await makeSnapshot({
    wh: s.wh,
    drafts: {},
    draft: { trigger: "takeaway", memo: "持ち帰り用のレポート（プラン3つ・パスワードつき）", plan: { id: s.workspace.selected, letter: "C", name: "プランB＋70歳まで働く" }, takeaway: { plans: [{ letter: "A", name: "現状" }, { letter: "C", name: "プランB＋70歳まで働く" }], proposal: "C", password: true, knobs: ["retireAge", "pensionAge", "nisaMonthly", "livingMonthly"], views: ["chart", "balance", "table"], createdOn: "2026-10-21", digest: `sha256:${"0".repeat(64)}` } },
    appVersion: "0.1.0",
    now: new Date(Date.UTC(2026, 9, 21, 5, 0, 0)),
    id: "00000000-0000-4000-8000-0000000000c2",
  });
  // 作った日時は端末の時差によらない固定の値にして、指紋を作り直す
  const fixed = { ...snap, createdAt: "2026-10-19T14:00:00+09:00" };
  const fixedTk = { ...tk, createdAt: "2026-10-21T14:00:00+09:00" };
  return { ...s, wh: { ...s.wh, snapshots: [{ ...fixed, digest: await snapshotDigest(fixed) }, { ...fixedTk, digest: await snapshotDigest(fixedTk) }] } };
}

const isLever = (t: unknown): boolean => typeof t === "object" && t !== null && typeof (t as { lever?: unknown }).lever === "string";

function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (typeof v === "object" && v !== null)
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  return out;
}

/** 0.61 の見本の世帯（0123）: sample060() に、売る予定と取得の年月のある別荘（細目 villa）とつながる毎年の費用の行、売る予定（税の扱い・費用の割合）のあるその他の資産を足す */
function sample061(): BodyState {
  const s = sample060();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const id = (n: number) => `00000000-0000-4000-8000-0000000061${String(n).padStart(2, "0")}`;
  const box = (v: number) => ({ value: v, state: "confirmed", origin: { kind: "manual" } }) as never;
  hh.accounts = [
    ...(hh.accounts ?? []),
    { id: id(1), kind: "realEstate", subtype: "villa", owner: self.id, marketValue: box(18000000), asOf: req.input.baseMonth, contributions: [], costBasis: box(15000000), acquiredAt: "2012-04", sale: { at: { at: "2034-04" }, price: 16000000 } },
    { id: id(2), kind: "otherAsset", subtype: "art", owner: self.id, marketValue: box(600000), asOf: req.input.baseMonth, contributions: [], sale: { at: { at: "2030-09" }, costRate: "0.1", taxation: "nonTaxable" } },
  ];
  hh.periodicExpenses = [
    ...(hh.periodicExpenses ?? []),
    { id: id(3), kind: "assetCost", object: id(1), label: "固定資産税・管理費など", row: "cf.expense.other.realEstate", from: { at: req.input.baseMonth }, to: null, everyYears: 1, amount: box(180000), growth: { kind: "none" } },
  ];
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.63 の見本の世帯（0125）: sample061() に、Web のヒアリングの依頼の記録（取り込みの記録の区画 hearing.web）を足す。
 * 鍵・合言葉は形だけの試験の文字（本物の鍵ではない）。受け取った答えと、受け取った書類（架空の JPEG の見出しだけ）を持つ
 */
function sample063(): BodyState {
  const s = sample061();
  const fake = (c: string, n: number) => c.repeat(n);
  const web = [
    {
      record: {
        kind: "web",
        requestId: "R-7K3P9Q",
        serverId: fake("A", 22),
        secrets: { secret: fake("B", 43), publicKey: `B${fake("C", 86)}`, privateKey: fake("D", 184), pickupToken: fake("E", 43) },
        selection: { base: { sheetId: "basic", version: 2 }, sections: [{ id: "family", items: [{ key: "hs.family.adult.birthYearMonth", mode: "ask" }] }, { id: "fp", items: [{ key: "ext.office.qabcd2345", mode: "ask" }] }], custom: [{ key: "ext.office.qabcd2345", label: "ご相談のきっかけ" }], documents: [{ id: "d1", kind: "withholding", title: "源泉徴収票（ご本人）", purpose: "年収の確かめ", where: "支払金額" }] },
        digest: "0".repeat(64),
        customerNo: "A0001",
        issuedAt: "2026-11-05T09:00:00Z",
        expiresAt: "2026-12-05T09:00:00Z",
        url: `https://relay.invalid/h/#1.${fake("B", 43)}.B${fake("C", 86)}`,
      },
      state: "received",
      received: { at: "2026-11-06T01:00:00Z", submittedAt: "2026-11-06T00:30:00.000Z", answers: [{ key: "hs.family.adult.birthYearMonth", index: 1, status: "value", raw: { kind: "text", text: "1985" }, raw2: { kind: "number", text: "6" } }], documents: [{ id: "d1", status: "attached", files: [{ fileId: fake("F", 16), mime: "image/jpeg", bytes: 4, sha256: "1".repeat(64) }] }], dropped: 0, missingFiles: 0 },
      files: [{ docId: "d1", fileId: fake("F", 16), mime: "image/jpeg", data: "_9j_4A", bytes: 4, sha256: "1".repeat(64) }],
    },
  ];
  return { ...s, wh: { ...s.wh, hearing: { requests: [], imports: [], consents: [], web } as never } };
}

/**
 * 0.65 の見本の世帯（0126）: sample063() に、0.64 の貸していない不動産の持ち始める時点（空き家）を足し、収益不動産の物件に家賃の入れ方
 * （今の実際の家賃収入）と減価償却の引き継ぎ（確定申告の数字）を入れる。空室率は前の値のまま残す（計算には使わない）
 */
function sample065(): BodyState {
  const s = sample063();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const box = (v: number) => ({ value: v, state: "confirmed", origin: { kind: "manual" } }) as never;
  hh.accounts = [
    ...(hh.accounts ?? []),
    { id: "00000000-0000-4000-8000-000000006401", kind: "realEstate", subtype: "vacantHouse", owner: self.id, marketValue: box(9000000), asOf: req.input.baseMonth, contributions: [], holdFrom: { at: "2036-04" }, builtYear: 1990, structure: "wood" } as never,
  ];
  const a = (hh.accounts ?? []).find((x) => x.property?.repairs !== undefined)!;
  a.property!.rental!.rentBy = "actual";
  a.property!.depreciationCarryover = { year: 2025, building: { book: 9800000, annual: 360000 }, equipment: { book: 1200000, annual: 150000 } };
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.66 の見本の世帯（0052・0025 の追記 2026-11-07）: sample065() に、住み終わりの月に売る持ち家（売ったときに住宅ローンを返さない）と、
 * 今の時価で入れた持ち家の評価の入れ方を足す
 */
function sample066(): BodyState {
  const s = sample065();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const box = (v: number) => ({ value: v, state: "confirmed", origin: { kind: "manual" } }) as never;
  hh.residences = [
    ...(hh.residences ?? []),
    { id: "00000000-0000-4000-8000-000000006601", kind: "own", from: { at: "2010-04" }, to: { at: "2035-03" }, ownership: [{ member: self.id, share: "1" }], valuation: { value: box(32000000), asOf: req.input.baseMonth, builtYear: 1998, basis: "market" }, sale: { repayLoan: false } },
  ];
  return { ...s, wh: { ...s.wh, request: req } };
}

/**
 * 0.67 の見本の世帯（0137）: sample066() に、前提条件の預金の利回り（0.2%）と、収益不動産の物件をもう1件（取得の年月だけの取得）足す
 */
function sample067(): BodyState {
  const s = sample066();
  const req = structuredClone(s.wh.request);
  const hh = req.input.household;
  const self = roles(req).find((r) => r.key === "self")!.member;
  const box = (v: number) => ({ value: v, state: "confirmed", origin: { kind: "manual" } }) as never;
  req.input.assumptions = { ...req.input.assumptions!, depositReturn: { default: "0.002" } };
  hh.accounts = [
    ...(hh.accounts ?? []),
    { id: "00000000-0000-4000-8000-000000006701", kind: "realEstate", owner: self.id, marketValue: box(15000000), asOf: req.input.baseMonth, contributions: [], property: { kind: "condo", acquisition: { at: "2012-04" }, rental: { monthly: box(70000) } } } as never,
  ];
  return { ...s, wh: { ...s.wh, request: req } };
}

describe("世帯ファイルの本文（0011 の2）", () => {
  it("保存→読み込みで同じ（現状・案・帯の並び・表示の設定・拡張領域）", () => {
    const s = sample();
    const back = fromBody(bodyOf(s));
    expect(back.wh).toEqual(withIds(s.wh));
    expect(back.workspace).toEqual(s.workspace);
    expect(back.display).toEqual(s.display);
    expect(back.carry).toEqual(s.carry);
    // 本体が足す meta があっても読める
    const withMeta = JSON.stringify({ ...JSON.parse(bodyOf(s)), meta: { format: "lifeplan.household", formatVersion: BODY_FORMAT_VERSION, customerNo: "A0001" } });
    expect(fromBody(withMeta).wh).toEqual(withIds(s.wh));
  });

  it("控え（0.3 から）: 区画 snapshots に置いて読み戻す。household の区画には入れない。控えが無ければ区画を作らない", async () => {
    const s = await withSnapshot(sample());
    const text = bodyOf(s);
    const b = JSON.parse(text) as { snapshots?: unknown[]; household: Record<string, unknown> };
    expect(b.snapshots).toHaveLength(2);
    expect(b.household.snapshots).toBeUndefined();
    const back = fromBody(text);
    expect(back.wh).toEqual(withIds(s.wh));
    expect(await verifySnapshot(back.wh.snapshots![0]!)).toBe(true);
    // 0.10 から: 持ち帰り用のレポートの書き出しの記録も読み戻す（パスワードの有無だけ。パスワード・宛名は持たない）
    const tk = back.wh.snapshots![1]!;
    expect(tk.trigger).toBe("takeaway");
    expect(tk.takeaway?.password).toBe(true);
    expect(Object.keys(tk.takeaway ?? {}).sort()).toEqual(["createdOn", "digest", "knobs", "password", "plans", "proposal", "views"]);
    expect(await verifySnapshot(tk)).toBe(true);
    expect(JSON.parse(bodyOf(sample())).snapshots).toBeUndefined();
  });

  it("黒字のうち貯まる割合（0.11 から。0031）を保存して読み戻す。生活防衛資金は持たない（0.12 から）", () => {
    const back = fromBody(bodyOf(sample()));
    expect(back.wh.request.input.assumptions?.surplusSaving).toEqual({ ratio: "0.6", changes: [{ id: migrationId("assumptions/surplusSaving/changes/0"), from: { at: "2038-04" }, ratio: "0.8" }] });
    expect((back.wh.request.input.assumptions as Record<string, unknown> | undefined)?.emergencyReserve).toBeUndefined();
  });

  it("明細の取り込みの記録（0.14 から。0034）と確認シートの依頼の記録（0.15 から。店ごとにまとめた行は 0.16 から）を区画 statements に保存して読み戻す。空なら区画を作らず、形の合わない行は捨てる", () => {
    expect(BODY_FORMAT_VERSION).toBe("0.67");
    const s = sample();
    const text = bodyOf(s);
    const obj = JSON.parse(text) as { statements?: StatementLog; household: Record<string, unknown> };
    expect(obj.statements).toEqual(s.wh.statements);
    expect(obj.household.statements).toBeUndefined();
    expect(fromBody(text).wh.statements).toEqual(s.wh.statements);
    const none = { ...s, wh: { ...s.wh, statements: { version: 1, accounts: [], imports: [], rules: [], applied: [] } } };
    expect((JSON.parse(bodyOf(none)) as Record<string, unknown>).statements).toBeUndefined();
    const odd = JSON.parse(text) as { statements: { imports: { rows: unknown[] }[] } };
    odd.statements.imports[0]?.rows.push({ id: "bad", line: 9, date: "2026/09/30", merchant: "x", amount: 1 });
    expect(fromBody(JSON.stringify(odd)).wh.statements?.imports[0]?.rows.map((r) => r.id)).toEqual(["r2", "r3", "r4"]);
    const { statements: _drop, ...without } = obj;
    void _drop;
    expect(fromBody(JSON.stringify(without)).wh.statements).toBeUndefined();
  });

  it("お金の3つの分け方の表示の設定（0.13 から。0032）を保存して読み戻す。無い・形が合わないときは既定", () => {
    const text = bodyOf(sample());
    expect((JSON.parse(text) as { display: { balance: { moneyThree: unknown } } }).display.balance.moneyThree).toEqual({ months: 3, years: 15, wording: "time" });
    expect(fromBody(text).display.balance.moneyThree).toEqual({ months: 3, years: 15, wording: "time" });
    const odd = JSON.parse(text) as { display: { balance: Record<string, unknown> } };
    odd.display.balance.moneyThree = { months: 0, years: 99, wording: "other" };
    expect(fromBody(JSON.stringify(odd)).display.balance.moneyThree).toEqual({ months: 6, years: 10, wording: "use" });
    delete odd.display.balance.moneyThree;
    expect(fromBody(JSON.stringify(odd)).display.balance.moneyThree).toEqual({ months: 6, years: 10, wording: "use" });
  });

  it("案の数に上限は無い", () => {
    const s = sample();
    const self = roles(s.wh.request).find((r) => r.key === "self")!.member;
    const cat = buildCatalog(s.wh, self.id, null);
    let wh = s.wh;
    for (let i = 0; i < 60; i++) wh = savePlan(wh, cat, { name: `案${i}`, base: null, values: { "lever:livingMonthly": 200000 + i * 1000 }, now: NOW }).wh;
    expect(fromBody(bodyOf({ ...s, wh })).wh.proposals).toHaveLength(62);
  });

  it("持たない情報の項目名が無い（0012 の3: name・kana・address・phone・番号類）", () => {
    const keys = keysOf(bodyObject(sample()));
    const bad = keys.filter((k) => /name|kana|address|phone|mynumber|pensionnumber|accountnumber|氏名|住所|電話|口座番号/i.test(k));
    expect(bad).toEqual([]);
  });

  it("保存しないもの: 提案書の宛名・保存していない案の変更は本文に入らない", () => {
    const text = bodyOf(sample());
    expect(text).not.toContain("addressee");
    expect(text).not.toContain("drafts");
  });

  it("一覧の構成の要約は続柄と人数だけ", () => {
    expect(summaryOf(sample().wh.request)).toBe("本人・配偶者・子3人");
  });

  it("形の合わない本文は読まない", () => {
    expect(() => fromBody("[]")).toThrow("E_BODY_SHAPE");
    expect(() => fromBody('{"household":{}}')).toThrow("E_BODY_SHAPE");
    // 足りない区画は既定で補う
    const s = fromBody(JSON.stringify({ household: { request: sample().wh.request } }));
    expect(s.wh.proposals).toEqual([]);
    expect(s.workspace.selected).toBe(CURRENT);
    expect(s.carry).toEqual(EMPTY_CARRY);
    // 表示の設定の知らない値は既定に戻す（グラフの比べ方を含む）
    const d = fromBody(JSON.stringify({ household: { request: sample().wh.request }, display: { result: { metrics: ["x", "takeHome"], atAge: "9", layout: "diagonal", dock: "large" }, balance: { points: ["now"] } } })).display;
    expect(d).toEqual({ result: { ...DEFAULT_DISPLAY_SETTINGS, metrics: ["takeHome"] }, balance: DEFAULT_BALANCE_SETTINGS });
    // 区画の無い 0.7 までの形（直下に平ら）も読む。なくした「操作中はグラフを上に表示」（dock）は持たない
    const flat = fromBody(JSON.stringify({ household: { request: sample().wh.request }, display: { metrics: ["takeHome"], layout: "side", dock: "small", bsPoints: ["now", "age90"], bsColumns: [{ point: "now" }, { year: 2040 }] } })).display;
    expect(flat).toEqual({ result: { ...DEFAULT_DISPLAY_SETTINGS, metrics: ["takeHome"], layout: "side" }, balance: { ...DEFAULT_BALANCE_SETTINGS, points: ["now", "age90"], columns: [{ point: "now" }, { year: 2040 }] } });
    expect(JSON.stringify(flat)).not.toContain("dock");
  });

  it("過去のすべての形式の版の見本を、今の画面で読める（0011 の5）", async () => {
    const base = join(REPO_DIR, "crates", "household-store", "tests", "fixtures", "household-format");
    const versions = readdirSync(base).filter((v) => /^\d+\.\d+$/.test(v));
    expect(versions).toContain(BODY_FORMAT_VERSION);
    const newest = [...versions].sort((x, y) => x.split(".").map(Number).reduce((acc, n, i) => acc || n - Number(y.split(".")[i]), 0)).at(-1);
    expect(BODY_FORMAT_VERSION, "画面の形式の版は、いちばん新しい見本の版").toBe(newest);
    for (const v of versions) {
      const body = readFileSync(join(base, v, "body.json"), "utf8");
      const s = fromBody(body);
      expect(s.wh.request.input.household.members.length).toBeGreaterThan(0);
      expect(s.wh.proposals.length).toBeGreaterThan(0);
      // 読んで書き戻しても、拡張領域を失わない
      const again = JSON.parse(bodyOf(s)) as Record<string, unknown>;
      // 0.2 から: メモの行ごとの書いた人（0023 の6）も、読んで書き戻して失わない
      const memoBy = (JSON.parse(body) as { household: { memoBy?: unknown } }).household.memoBy;
      if (memoBy !== undefined) expect((again.household as { memoBy?: unknown }).memoBy).toEqual(memoBy);
      const orig = JSON.parse(body) as Record<string, unknown>;
      // 0.56 までの見本の会社の入力（household.companyBs）は、拡張領域の同梱の束の値として書き戻す（0114 の9）。ほかの拡張項目はそのまま
      const oldCompany = (orig.household as { companyBs?: unknown }).companyBs;
      const moved = oldCompany === undefined ? null : readExtValue(CO_DECL, oldCompany);
      expect(again.ext).toEqual(moved === null ? orig.ext : { ...(orig.ext as object), [CO_KEY]: moved });
      // 0.3 から: 控えも、読んで書き戻して失わない（中身は変えない。指紋が合う）
      if (orig.snapshots !== undefined) {
        expect(again.snapshots).toEqual(orig.snapshots);
        for (const x of s.wh.snapshots ?? []) expect(await verifySnapshot(x), `${v} の控えの指紋`).toBe(true);
      }
      expect(again.extDefinitions).toEqual(moved === null ? orig.extDefinitions : { ...(orig.extDefinitions as object), [CO_KEY]: definitionOf(CO_DECL, CO_KEY) });
      // 0.56 から: 移行の取り込みの記録も、読んで書き戻して失わない（0113 の10）
      if (orig.migrations !== undefined) expect(again.migrations).toEqual(orig.migrations);
    }
    // 0.56 の見本: 推定の出し方 migrated の値を持つ世帯を本物のエンジンが受け付け、確定の値にしたときと結果が同じ（0113 の7）
    const b056 = fromBody(readFileSync(join(base, "0.56", "body.json"), "utf8"));
    expect(b056.wh.migrations?.imports).toHaveLength(1);
    const confirmed = structuredClone(b056.wh.request);
    const acc = confirmed.input.household.accounts![0] as unknown as { marketValue: Record<string, unknown> & { value: number } };
    expect((acc.marketValue.estimate as { method: string }).method).toBe("migrated");
    acc.marketValue = { value: acc.marketValue.value, state: "confirmed", origin: { kind: "manual" } };
    expect(preview(forEngine(b056.wh.request)).table).toEqual(preview(forEngine(confirmed)).table);
  });

  it("0.17 の見本を読んで書き戻しても、差分（足す・外す・置き換えの組・読み替えられなかった差分を含む）・値の状態の欄・世帯の外の家族・知らせを失わない", () => {
    const body = JSON.parse(readFileSync(join(REPO_DIR, "crates", "household-store", "tests", "fixtures", "household-format", "0.17", "body.json"), "utf8")) as Record<string, Record<string, unknown>>;
    const again = bodyObject(fromBody(JSON.stringify(body))) as unknown as Record<string, Record<string, unknown>>;
    // 表の最後の年の差分（プランD）だけは、どのプランにも共通にしたので読むときに外し、開いたときの知らせを足す（0043 の追記 2026-11-05）
    const plans = body.proposals as unknown as { title: string; diffs: { item: string | null }[] }[];
    const endYearPlans = plans.filter((p) => p.diffs.some((d) => d.item === "plan.endYear"));
    expect(endYearPlans.map((p) => p.title)).toEqual(["プランD 資産を足す・表を2085年まで"]);
    expect(again.proposals).toEqual(plans.map((p) => ({ ...p, diffs: p.diffs.filter((d) => d.item !== "plan.endYear") })));
    expect(again.workspace!.shownItems).toEqual(body.workspace!.shownItems);
    // 生年月の無い世帯の外の家族（画面の中では贈与者）は、構成員の並びの最後に書き戻す（中身は同じ）
    const byId = (r: unknown) => {
      const x = structuredClone(r) as { input: { household: { members: { id: string }[] } } };
      x.input.household.members.sort((p, q) => (p.id < q.id ? -1 : 1));
      return x;
    };
    expect(byId(again.household!.request)).toEqual(byId(body.household!.request));
    const notices = again.household!.notices as unknown as { kind: string }[];
    expect(notices.filter((n) => n.kind !== "planEndYearShared")).toEqual(body.household!.notices);
    expect(notices.find((n) => n.kind === "planEndYearShared")).toMatchObject({ plans: 1, names: ["プランD 資産を足す・表を2085年まで"], years: [2085], endYear: 2078 });
    expect(again.household!.assumed).toEqual(body.household!.assumed);
  });

  it("値の状態の欄のうち、仮の印から作り直すと同じになる推定の行だけを仮の印に戻す（ほかの出し方・確かさを持つ行はそのまま）", () => {
    const s = sample();
    const body = bodyObject(s) as unknown as { household: { request: { input: { household: { members: Record<string, unknown>[] } } } } };
    const [a, b] = body.household.request.input.household.members as Record<string, unknown>[];
    a!.valueStates = { "member.birth": { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "仮の値" } } };
    b!.valueStates = { "member.birth": { state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: "統計（架空）" }, certainty: "rough" } };
    const back = fromBody(JSON.stringify(body));
    expect(back.wh.assumed[`family/${a!.id as string}/birth`]).toBe("仮の値");
    expect(back.wh.assumed[`family/${b!.id as string}/birth`]).toBeUndefined();
    const again = bodyObject(back) as unknown as typeof body;
    const [a2, b2] = again.household.request.input.household.members;
    expect(a2!.valueStates).toEqual(a!.valueStates);
    expect(b2!.valueStates).toEqual(b!.valueStates);
  });

  it("前の版の画面で性別に付けた推定・仮の印は、読むときに外す（値・ほかの印はそのまま。形式の版は上げない）", () => {
    const s = sample();
    const body = bodyObject(s) as unknown as { household: { assumed?: Record<string, string>; request: EngineRequestLike } };
    const [a, b, c] = body.household.request.input.household.members;
    // 0.17 の形: 値の状態の欄の推定の行（仮の印から作った行と、ほかの出し方の行）
    a!.valueStates = { "member.sex": { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "仮の値" } }, "member.birth": { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "仮の値" } } };
    b!.valueStates = { "member.sex": { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "推定（本人と逆の性別。同性のご夫婦は直してください）" }, certainty: "rough" } };
    // 0.16 の形: 画面の側の仮の印のまま残っているもの
    body.household.assumed = { ...(body.household.assumed ?? {}), [`family/${c!.id}/sex`]: "わからない（男性を代わりの値にして計算）" };
    const back = fromBody(JSON.stringify(body));
    expect(Object.keys(back.wh.assumed).some((k) => k.endsWith("/sex"))).toBe(false);
    expect(back.wh.assumed[`family/${a!.id}/birth`]).toBe("仮の値");
    const members = back.wh.request.input.household.members as unknown as { id: string; sex: string; valueStates?: Record<string, unknown> }[];
    expect(members.every((m) => m.valueStates?.["member.sex"] === undefined)).toBe(true);
    // 値はそのまま
    for (const m of [a!, b!, c!]) expect(members.find((x) => x.id === m.id)!.sex).toBe(m.sex);
    // 計算の結果も変わらない（印は計算の要求に入らない）
    expect(preview(back.wh.request)).toEqual(preview(s.wh.request));
    // 書き戻しても性別の行は作らない
    const again = bodyObject(back) as unknown as typeof body;
    expect(again.household.request.input.household.members.every((m) => (m.valueStates as Record<string, unknown> | undefined)?.["member.sex"] === undefined)).toBe(true);
  });

  // 見本の本文を作り直す（手で流す: WRITE_HOUSEHOLD_FIXTURE_SOURCE=<出力先> npx vitest run test/store.test.ts）。
  // 暗号化した見本は crates/household-store の regenerate_fixture（--ignored）で作る
  it.runIf(process.env.WRITE_HOUSEHOLD_FIXTURE_SOURCE !== undefined)("見本の本文を書き出す", async () => {
    writeFileSync(process.env.WRITE_HOUSEHOLD_FIXTURE_SOURCE as string, JSON.stringify(bodyObject(await withSnapshot(sample067())), null, 2) + "\n");
  });

  it("0.67 の形（0137）: 前提条件の預金の利回りと、取得の年月だけの収益不動産の取得を保存して読み戻す。預金の利回りは計算に効く", () => {
    const s = sample067();
    const stored = bodyObject(s) as unknown as { household: { request: { input: { assumptions: { depositReturn?: unknown }; household: { accounts: { id: string; property?: { acquisition?: unknown } }[] } } } } };
    expect(stored.household.request.input.assumptions.depositReturn).toEqual({ default: "0.002" });
    expect(stored.household.request.input.household.accounts.find((x) => x.id === "00000000-0000-4000-8000-000000006701")?.property?.acquisition).toEqual({ at: "2012-04" });
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    // 資産の種類ごとの利回りの預金を外した世帯で、預金の利回りの有る無しで結果が違う（無ければ運用利回り）
    const withoutCash = (r: BodyState["wh"]["request"], keep: boolean): BodyState["wh"]["request"] => {
      const x = structuredClone(r);
      const a = x.input.assumptions as { depositReturn?: unknown; assetReturns?: Record<string, unknown> };
      if (a.assetReturns !== undefined) for (const k of Object.keys(a.assetReturns)) if (k.startsWith("cash.")) delete a.assetReturns[k];
      if (!keep) delete a.depositReturn;
      return x;
    };
    expect(preview(withoutCash(back.wh.request, true)).table).not.toEqual(preview(withoutCash(back.wh.request, false)).table);
  });

  it("0.66 の形（0052・0025 の追記）: 住まいを売ったときに住宅ローンを返すかと、持ち家の評価の入れ方を保存して読み戻す", () => {
    const s = sample066();
    const stored = bodyObject(s) as unknown as { household: { request: { input: { household: { residences: { id: string; sale?: { repayLoan?: boolean }; valuation?: { basis?: string } }[] } } } } };
    const r = stored.household.request.input.household.residences.find((x) => x.id === "00000000-0000-4000-8000-000000006601");
    expect(r?.sale?.repayLoan).toBe(false);
    expect(r?.valuation?.basis).toBe("market");
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(() => preview(back.wh.request)).not.toThrow();
  });

  it("0.65 の形（0126）: 収益不動産の家賃の入れ方と減価償却の引き継ぎを保存して読み戻す。空室率が残っていても今の実際の家賃収入なら使わない", () => {
    const s = sample065();
    const stored = bodyObject(s) as unknown as { household: { request: { input: { household: { accounts: { property?: { rental?: { rentBy?: string }; depreciationCarryover?: unknown } }[] } } } } };
    const p = stored.household.request.input.household.accounts.find((x) => x.property?.depreciationCarryover !== undefined)?.property;
    expect(p?.rental?.rentBy).toBe("actual");
    expect(p?.depreciationCarryover).toEqual({ year: 2025, building: { book: 9800000, annual: 360000 }, equipment: { book: 1200000, annual: 150000 } });
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(preview(back.wh.request).table).not.toEqual(preview(sample063().wh.request).table);
  });

  it("0.63 の形（0125）: Web のヒアリングの依頼の記録（鍵・受け取った答えと書類）を取り込みの記録の区画に保存して読み戻す。計算には使わない", () => {
    const s = sample063();
    const stored = bodyObject(s) as unknown as { hearing: { web: unknown[] } };
    expect(stored.hearing.web).toHaveLength(1);
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(preview(back.wh.request).table).toEqual(preview(sample061().wh.request).table);
  });

  it("0.22 の形（0057）: 退職給付の名前と学歴を保存して読み戻し、名前・学歴は計算に使わない", () => {
    const s = sample022();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const list = stored.household.request.input.household.retirementBenefits ?? [];
    expect(list.find((b) => b.label === "架空の企業年金基金")).toMatchObject({ kind: "db", receipt: { method: "annuity", years: 10 } });
    expect(list.some((b) => (b as Record<string, unknown>).education === "highSchoolOffice")).toBe(true);
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const plain = structuredClone(back.wh.request);
    for (const b of plain.input.household.retirementBenefits ?? []) {
      delete b.label;
      delete (b as Record<string, unknown>).education;
    }
    expect(preview(back.wh.request).table).toEqual(preview(plain).table);
  });

  it("0.26 の形（0069）: 車の維持費の入れ方と内訳の名前つきの行を保存して読み戻す。入れ方の側だけを計算に数える", () => {
    const s = sample026();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const cars = stored.household.request.input.household.cars ?? [];
    expect(cars.find((c) => c.upkeepMode === "detail")).toMatchObject({ upkeep: { annual: 400000 }, upkeepOther: [{ label: "スタッドレスタイヤ", annual: 30000 }, { annual: 12000 }] });
    expect(cars.find((c) => c.upkeepMode === "total")).toMatchObject({ parking: { annual: 120000 } });
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const r = preview(back.wh.request);
    const upkeepOf = (object: string, year: number) => r.table.filter((c) => c.object === object && c.year === year && c.row === "cf.expense.living.car").reduce((x, c) => x + c.amount, 0);
    // 内訳の車: 自動車税・名前つきの行（保険は保険の行、合計 40万円は数えない）。合計の車: 合計だけ（駐車場は数えない）
    // 2027年: 自動車税 3.6万円＋名前つきの行 4.2万円（物価で少し伸びる。車検はこの年に無い）
    expect(upkeepOf("00000000-0000-4000-8000-000000000201", 2027)).toBeGreaterThanOrEqual(78000);
    expect(upkeepOf("00000000-0000-4000-8000-000000000201", 2027)).toBeLessThan(82000);
    expect(upkeepOf("00000000-0000-4000-8000-000000000204", 2032)).toBeLessThanOrEqual(240000 * 1.2);
    expect(upkeepOf("00000000-0000-4000-8000-000000000204", 2032)).toBeGreaterThanOrEqual(240000);
  });

  it("0.25 の形（0054・0055）: 保険の種類の細目と名前・保障の行の被保険者と限度日数・円の目安の形・保障の ID のある数表の行・病気の想定を保存して読み戻す", () => {
    const s = sample025();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request; contingency?: { illness?: unknown } } };
    const list = stored.household.request.input.household.insuranceContracts ?? [];
    expect(list.find((c) => c.subtype === "medical")).toMatchObject({ label: "架空の医療保険", coverages: [{ maxDays: 60 }, { benefit: "threeMajorLump" }, { insured: expect.any(String) }] });
    expect(list.find((c) => c.subtype === "variable")?.simple).toEqual({ estimate: true });
    expect(list.find((c) => c.subtype === "decreasingTerm")?.schedule?.rows[0]).toMatchObject({ policyYear: 1, deathBenefit: 20000000 });
    expect(stored.household.contingency?.illness).toEqual({ disease: "heartStroke", hospitalDays: 25, surgeries: 2 });
    const back = fromBody(JSON.stringify(stored));
    expect(back.wh.contingency.illness).toEqual({ disease: "heartStroke", hospitalDays: 25, surgeries: 2 });
    expect(bodyObject(back)).toEqual(bodyObject(s));
    preview(back.wh.request);
  });

  it("0.27 の形（0070・0071）: 万一の前提の任意の欄・前提の例外の年・確かめた記録・万一の前提を上書きする差分を保存して読み戻し、差分はそのプランの万一の前提に当たる", () => {
    const s = sample027();
    const stored = bodyObject(s) as unknown as { household: { contingency: Record<string, unknown>; agreed?: unknown } };
    expect(stored.household.contingency).toMatchObject({ protection: { method: "reverse", reverseUntilAge: 90 }, incomeDrop: { member: "both" }, stackMarket: true });
    expect(stored.household.agreed).toEqual({ current: { "field:assume/inflation": { on: "2026-10-20", note: "面談で確かめた" } } });
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const self = roles(back.wh.request).find((r) => r.key === "self")!.member;
    const cat = buildCatalog(back.wh, self.id, null);
    const plan = back.wh.proposals[0]!;
    const applied = applyPlan(back.wh, plan.id, cat);
    expect(applied.contingency.survivor.livingRatio?.beforeIndependence).toBe("0.6");
    expect(back.wh.contingency.survivor.livingRatio?.beforeIndependence).toBeUndefined();
    preview(back.wh.request);
  });

  it("0.28 の形（0066・0067）: 受給中の年金の種類と、残した年金の記録を保存して読み戻す。種類は計算に使わず、残した記録はエンジンへ渡さない", () => {
    const s = sample028();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request; pensionKept?: Record<string, unknown[]> } };
    expect(stored.household.request.input.household.incomeFlows?.find((f) => f.pensionType === "disabilityBasic")).toMatchObject({ kind: "survivorPension", recipient: expect.any(String) });
    expect(Object.values(stored.household.pensionKept ?? {})[0]).toHaveLength(1);
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(back.wh.pensionKept).toEqual(s.wh.pensionKept);
    // 種類を外しても結果は同じ（表示と終わりの推定だけ）
    const plain = structuredClone(back.wh.request);
    for (const f of plain.input.household.incomeFlows ?? []) delete f.pensionType;
    expect(preview(back.wh.request).table).toEqual(preview(plain).table);
    expect(JSON.stringify(forEngine(back.wh.request))).not.toContain("00000000-0000-4000-8000-00000000a261");
  });

  it("0.29 の形（0072）: 次回確かめるの印を保存して読み戻す。形の合わない行は捨て、印が無ければ欄を作らない。計算の要求には入らない", () => {
    const s = sample029();
    const stored = bodyObject(s) as unknown as { household: { recheck?: unknown[]; request: typeof s.wh.request } };
    expect(stored.household.recheck).toHaveLength(2);
    const back = fromBody(JSON.stringify(stored));
    expect(back.wh.recheck).toEqual(s.wh.recheck);
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(JSON.stringify(forEngine(back.wh.request))).not.toContain("field:living/monthly");
    const broken = structuredClone(stored);
    broken.household.recheck = [{ id: "" }, 3, { ...(stored.household.recheck![0] as object), on: "2026/10/27" }];
    expect(fromBody(JSON.stringify(broken)).wh.recheck).toBeUndefined();
    const none = bodyObject(sample028()) as unknown as { household: Record<string, unknown> };
    expect("recheck" in none.household).toBe(false);
  });

  it("0.30 の形（0078）: 推計の区分の受け取り開始（構成員の pensionClaim）を保存して読み戻し、計算に使う（年金の記録が無い人だけ）", () => {
    const s = sample030();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const self = roles(s.wh.request).find((r) => r.key === "self")!.member;
    expect((stored.household.request.input.household.pensionRecords ?? []).some((r) => r.member === self.id)).toBe(false);
    expect(stored.household.request.input.household.members.find((m) => m.id === self.id)!.pensionClaim?.basic).toBeDefined();
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const plain = structuredClone(back.wh.request);
    for (const m of plain.input.household.members) delete m.pensionClaim;
    expect(preview(back.wh.request).table).not.toEqual(preview(plain).table);
    // 前の版の見本（受け取り開始が無い）は、開いても結果が変わらない
    const old = sample029();
    expect(old.wh.request.input.household.members.some((m) => m.pensionClaim !== undefined)).toBe(false);
  });

  it("0.31 の形（0079）: 収益不動産の物件を見分ける欄を保存して読み戻す。計算には使わない（外しても結果は同じ）", () => {
    const s = sample031();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const p = (stored.household.request.input.household.accounts ?? []).find((x) => x.property?.name !== undefined)!.property!;
    expect(p).toMatchObject({ name: "架空の駅前マンション", kind: "condo", location: "架空県架空市", share: "0.5", tenure: "ownership", units: 1, area: { land: "20.5", floor: "55.12" } });
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(preview(back.wh.request).table).toEqual(preview(sample030().wh.request).table);
  });

  it("0.32 の形（0080）: 収益不動産のお金の欄（取得の内訳・諸費用・自己資金・家賃以外の収入・経費の費目・大きな修繕・民泊・宿）を保存して読み戻し、計算できる", () => {
    const s = sample032();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const accounts = stored.household.request.input.household.accounts ?? [];
    const p = accounts.find((x) => x.property?.repairs !== undefined)!.property!;
    expect(p.acquisition).toMatchObject({ parts: { land: 6000000, building: 12000000, equipment: 2000000 }, costs: 1200000, equity: 5000000 });
    expect(p.rental).toMatchObject({ commonFee: 5000, parking: 8000, otherMonthly: 2000, keyMoney: 120000 });
    expect(p.expenses?.items?.management).toBe(180000);
    expect(accounts.find((x) => x.property?.lodging !== undefined)!.property!.lodging).toMatchObject({ business: "privateLodging", salesBy: "night" });
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(() => preview(back.wh.request)).not.toThrow();
    expect(preview(back.wh.request).table).not.toEqual(preview(sample031().wh.request).table);
  });

  it("0.33 の形（0081）: 売ったときにローンを返すか・民泊・宿の所得の区分・申告の仕方と青色申告特別控除を保存して読み戻し、計算に入る", () => {
    const s = sample033();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const h = stored.household.request.input.household;
    const a = (h.accounts ?? []).find((x) => x.property?.sale !== undefined)!;
    expect(a.property!.sale).toMatchObject({ repayLoan: false });
    expect((h.accounts ?? []).find((x) => x.property?.lodging !== undefined)!.property!.lodging!.incomeKind).toBe("business");
    expect(h.members.find((m) => m.id === a.owner)!.taxReturn).toEqual({ method: "blue", blueDeduction: "doubleEntry" });
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(() => preview(back.wh.request)).not.toThrow();
    expect(preview(back.wh.request).table).not.toEqual(preview(sample032().wh.request).table);
  });

  it("0.34 の形（0083）: 入力項目の選び方を保存して読み戻す。形の合わない所は捨て、決めていなければ欄を作らない。計算の要求は変えない", () => {
    const s = sample034();
    const stored = bodyObject(s) as unknown as { household: Record<string, unknown> };
    expect(stored.household.itemChoice).toEqual({ hidden: ["car", "care"], levels: { insurance: "detail", rental: "detail" } });
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(preview(back.wh.request).table).toEqual(preview(sample033().wh.request).table);
    // 知らない項目・いつも出す項目（家族・前提条件）・標準の入れ方は持たない
    const odd = fromBody(JSON.stringify({ ...stored, household: { ...stored.household, itemChoice: { hidden: ["nope", "family", "assumptions", "car", "car"], levels: { work: "simple", nope: "detail", savings: "detail" } } } }));
    expect(odd.wh.itemChoice).toEqual({ hidden: ["car"], levels: { savings: "detail" } });
    const none = fromBody(JSON.stringify({ ...stored, household: { ...stored.household, itemChoice: { hidden: [], levels: {} } } }));
    expect("itemChoice" in none.wh).toBe(false);
    expect("itemChoice" in bodyObject(sample033()).household).toBe(false);
  });

  it("0.35 の形（0041・0055 の追記）: 確かめの注意の「確認した」の印を保存して読み戻し、開き直しても注意は出ない。形の合わない印は捨て、印が無ければ欄を作らない。計算の要求は変えない", () => {
    const s = sample035();
    const stored = bodyObject(s) as unknown as { household: Record<string, unknown> };
    const n = insuranceOverlapNotices(s.wh)[0]!;
    expect(stored.household.noticeAcks).toEqual([{ id: n.id, of: [...n.of].sort(), on: "2026-10-29" }]);
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(checkList(back.wh).some((r) => r.id === `notice:${n.id}`)).toBe(false);
    const { noticeAcks: _a, ...without } = s.wh;
    void _a;
    expect(checkList(without).some((r) => r.id === `notice:${n.id}`)).toBe(true);
    expect(preview(back.wh.request).table).toEqual(preview(without.request).table);
    const odd = fromBody(JSON.stringify({ ...stored, household: { ...stored.household, noticeAcks: [{ id: "x", of: [], on: "2026-10-29" }, { id: n.id, of: n.of, on: "昨日" }, 3] } }));
    expect("noticeAcks" in odd.wh).toBe(false);
    expect("noticeAcks" in bodyObject(sample034()).household).toBe(false);
  });

  it("0.36 の形（0085）: 就業不能・収入が減るの場面の配偶者の働き方を保存して読み戻し、場面の要求の働き方の置き換えに入れる。プランの上書きも当てる", () => {
    const s = sample036();
    const stored = bodyObject(s) as unknown as { household: { contingency: Record<string, unknown> } };
    const spouse = s.wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    expect(stored.household.contingency.partnerWork).toEqual({ disability: { [spouse.id]: { type: "regular", annualSalary: 3000000, afterMonths: 3, untilAge: 60 } }, income: { [spouse.id]: { type: "partTime" } } });
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const sc = scenarios(back.wh).find((x) => x.key === "disability:self")!;
    const ch = scenarioRequest(back.wh, sc, 2030).input.workChanges![0]!;
    expect(ch).toMatchObject({ member: spouse.id, from: { at: "2030-04" }, type: "regular" });
    expect(ch.salary?.annual.value).toBe(3000000);
    expect(() => preview(scenarioRequest(back.wh, sc, 2030))).not.toThrow();
    const planId = back.wh.proposals[0]!.id;
    expect(premiseFor(back.wh, planId).partnerWork?.income?.[spouse.id]).toEqual({ type: "partTime", annualSalary: 1500000 });
    // 0.35 の見本には欄が無い
    expect("partnerWork" in (bodyObject(sample035()).household as unknown as { contingency: Record<string, unknown> }).contingency).toBe(false);
  });

  it("0.43 の形（0100）: 基本生活費の新しい内訳と前の分け方の内訳を保存して読み戻し、計算に使う（内訳の合計が基本生活費）", () => {
    const s = sample043();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const cats = stored.household.request.input.household.livingExpenses![0]!.categories!.map((c) => c.category);
    for (const c of ["communication", "transit", "pocketAndSocial", "other", "transport"]) expect(cats).toContain(c);
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(() => preview(back.wh.request)).not.toThrow();
  });

  it("0.42 → 0.43 の変換の段が基本生活費の「わからない」を推定にした世帯には、開いたときの知らせを見せる（押すと基本生活費を開く）", () => {
    const i: BarInputs = { opened: true, stored: true, save: { kind: "idle" } as never, paused: false, aiSharing: false, storage: [], showing: { recovery: false, office: false, storage: false }, presence: null, message: (c) => c, household: [{ id: "n1", kind: "livingUnknown", count: 2, plans: 1 }] };
    const [n] = barNotices(i);
    expect(n).toMatchObject({ id: "household:n1", target: "living", action: "基本生活費" });
    expect(n?.text).toContain("2か所とプランの変更 1件");
    expect(n?.text).toContain("結果は変わりません");
  });

  it("0.43 → 0.44 の変換の段が「わからない」を推定にした世帯には、開いたときの知らせを見せる（押すと入力の画面を開く）", () => {
    const i: BarInputs = { opened: true, stored: true, save: { kind: "idle" } as never, paused: false, aiSharing: false, storage: [], showing: { recovery: false, office: false, storage: false }, presence: null, message: (c) => c, household: [{ id: "n1", kind: "unknownEstimated", count: 3, plans: 1 }] };
    const [n] = barNotices(i);
    expect(n).toMatchObject({ id: "household:n1", target: "input", action: "入力" });
    expect(n?.text).toContain("3か所とプランの変更 1件");
    expect(n?.text).toContain("書類で確かめる");
    expect(n?.text).toContain("結果は変わりません");
  });

  it("0.44 の形（0041 の追記）: 書類で確かめる欄（住民税）の書類待ちを保存して読み戻し、代わりの値で計算する。確かめの一覧に書類待ちとして出る", () => {
    const s = sample044();
    const back = fromBody(JSON.stringify(bodyObject(s)));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect((back.wh.request.input.household.residentTaxAssessments as unknown as { amount: unknown }[])[0]!.amount).toMatchObject({ state: "unknown" });
    expect(() => preview(back.wh.request)).not.toThrow();
    const row = checkList(back.wh).find((r) => r.kind === "unknown");
    expect(row?.detail).toContain("住民税の決定通知書で確かめる");
  });

  it("0.45 の形（0101）: 車の買い替え（この1台だけ・○歳まで）とリース・長期レンタルを保存して読み戻し、計算に使う", () => {
    const s = sample045();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const cars = stored.household.request.input.household.cars ?? [];
    expect(cars.filter((c) => c.purchase?.replace?.kind === "none")).toHaveLength(2);
    expect(cars.find((c) => c.purchase?.replace?.kind === "until")?.purchase?.replace).toMatchObject({ until: { memberAge: { years: 69, months: 11 } } });
    expect(cars.find((c) => c.lease !== undefined)).toMatchObject({ lease: { type: "longRental", monthly: 45000, termYears: 5 } });
    expect(cars.find((c) => c.lease !== undefined)?.purchase).toBeUndefined();
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const r = preview(back.wh.request);
    const of = (object: string, f: (c: (typeof r.table)[number]) => boolean) => r.table.filter((c) => c.object === object && f(c));
    const id = (n: number) => `00000000-0000-4000-8000-0000000045${String(n).padStart(2, "0")}`;
    // 今の車に乗り続ける: 買わない。この1台だけ: 2030年に1回だけ買う
    expect(of(id(1), (c) => c.row === "cf.expense.lumpSum.car")).toHaveLength(0);
    expect(of(id(2), (c) => c.row === "cf.expense.lumpSum.car").map((c) => c.year)).toEqual([2030]);
    // 長期レンタル: 2031年から月額×12（物価で伸ばさない）が車の維持費の行に入る
    const lease2032 = of(id(4), (c) => c.row === "cf.expense.living.car" && c.year === 2032).reduce((x, c) => x + c.amount, 0);
    expect(lease2032).toBeGreaterThanOrEqual(45000 * 12 + 150000);
    expect(of(id(4), (c) => c.row === "cf.expense.lumpSum.car")).toHaveLength(0);
  });

  it("0.46 の形（0103）: 夢プランの夢（順位・計算に入れるか・ひとことメモ）と子への援助の優先度を保存して読み戻し、計算に入れない夢だけを外して計算する", () => {
    const s = sample046();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const h = stored.household.request.input.household;
    const dreams = (h.periodicExpenses ?? []).filter((p) => p.kind === "dream");
    expect(dreams.map((p) => p.dream)).toEqual([{ rank: 2, include: false, note: "海の近くで暮らしたい" }, { rank: 1, note: "結婚30周年に" }, { rank: 3 }]);
    expect((h.goals ?? []).flatMap((g) => g.education?.gifts ?? []).find((x) => x.purpose === "wedding")?.priority).toBe("want");
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const r = preview(forEngine(back.wh.request));
    const id = (n: number) => `00000000-0000-4000-8000-0000000046${String(n).padStart(2, "0")}`;
    const lump = (object: string) => r.table.filter((c) => c.object === object && c.row === "cf.expense.lumpSum.other").reduce((x, c) => x + c.amount, 0);
    // 計算に入れない夢は表に出ない。入れる夢は一時的支出の行（くり返す夢は毎年）
    expect(lump(id(1))).toBe(0);
    expect(lump(id(2))).toBeGreaterThanOrEqual(1200000);
    expect(r.table.filter((c) => c.object === id(3) && c.row === "cf.expense.lumpSum.other" && c.amount > 0).map((c) => c.year)).toEqual([2028, 2029, 2030, 2031, 2032]);
  });

  it("0.47 の形（0104）: 奨学金を返す人・第一種の奨学金の返済・子の年齢の成人式を保存して読み戻し、子が返す返済は世帯の収支に入れず要約に出す", () => {
    const s = sample047();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const h = stored.household.request.input.household;
    expect((h.goals ?? []).flatMap((g) => g.education?.scholarships ?? []).map((x) => x.repaidBy)).toEqual(["child", "household"]);
    expect((h.debts ?? []).find((d) => d.subtype === "scholarshipFree")?.kind).toBe("scholarship");
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const r = preview(forEngine(back.wh.request));
    const id = (n: number) => `00000000-0000-4000-8000-0000000047${String(n).padStart(2, "0")}`;
    const kid1 = roles(s.wh.request).find((x) => x.key === "child1")!.member;
    const kid2 = roles(s.wh.request).find((x) => x.key === "child2")!.member;
    // 第2子（2014年5月生まれ）の成人式は 20歳になる年度（2034年度）の1月
    expect(r.table.filter((c) => c.object === id(3) && c.amount > 0).map((c) => c.year)).toEqual([2035]);
    // 子が返す奨学金は要約に（世帯で返す分は出ない）
    const cs = (r.summary as { childScholarships?: { member: string; principal: number }[] }).childScholarships ?? [];
    expect(cs.map((c) => [c.member, c.principal])).toEqual([[kid1.id, 50000 * 48]]);
    // 生年月を直すと成人式の年も動く
    const moved = structuredClone(back.wh.request);
    moved.input.household.members.find((m) => m.id === kid2.id)!.birth = { birthYearMonth: "2015-05", bornOnFirst: false };
    expect(preview(forEngine(moved)).table.filter((c) => c.object === id(3) && c.amount > 0).map((c) => c.year)).toEqual([2036]);
  });

  it("0.48 の形（0105）: 自社株（出資額）・会社への貸付金・会社からの借入金・会社の借入の連帯保証の額と、体力の目安の分母を保存して読み戻し、借入金の返済だけを計算に入れる", () => {
    const s = sample048();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request }; display: { balance: { guide: { basis?: string } } } };
    const h = stored.household.request.input.household;
    expect((h.accounts ?? []).filter((a) => a.subtype !== undefined).map((a) => a.subtype)).toEqual(["ownCompanyShares", "loanToCompany"]);
    expect((h.debts ?? []).find((d) => d.subtype === "companyLoan")?.kind).toBe("other");
    expect(h.members.find((m) => m.kind === "self")?.companyGuarantee?.value).toBe(30000000);
    expect(stored.display.balance.guide.basis).toBe("livingLoan");
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(back.display.balance.guide.basis).toBe("livingLoan");
    const id = (n: number) => `00000000-0000-4000-8000-0000000048${String(n).padStart(2, "0")}`;
    const r = preview(forEngine(back.wh.request));
    // 借入金の返済はほかのローンの行に出る（40か月で200万円）。保証の額・細目は計算に使わない
    expect(r.table.filter((c) => c.object === id(3) && c.row === "cf.expense.debt.other").reduce((x, c) => x + c.amount, 0)).toBe(2000000);
    const plain = structuredClone(back.wh.request);
    for (const m of plain.input.household.members) delete m.companyGuarantee;
    for (const a of plain.input.household.accounts ?? []) delete a.subtype;
    expect(preview(forEngine(back.wh.request)).table).toEqual(preview(forEngine(plain)).table);
  });

  it("0.61 の形（0123）: 売る予定・取得の年月・貸していない不動産の細目・つながる毎年の費用の行を保存して読み戻す", () => {
    const s = sample061();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const h = stored.household.request.input.household;
    const villa = (h.accounts ?? []).find((a) => a.id === "00000000-0000-4000-8000-000000006101");
    expect(villa).toMatchObject({ subtype: "villa", acquiredAt: "2012-04", sale: { at: { at: "2034-04" }, price: 16000000 } });
    expect((h.periodicExpenses ?? []).find((p) => p.kind === "assetCost")).toMatchObject({ object: "00000000-0000-4000-8000-000000006101", row: "cf.expense.other.realEstate" });
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    preview(forEngine(back.wh.request));
  });

  it("0.59 の形（0120）: その他の資産の中身の細目を保存して読み戻し、細目は計算に使わない", () => {
    const s = sample059();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const h = stored.household.request.input.household;
    const others = (h.accounts ?? []).filter((a) => a.kind === "otherAsset" && a.id.startsWith("00000000-0000-4000-8000-0000000059"));
    expect(others.map((a) => a.subtype ?? "")).toEqual(["preciousMetal", "art", "membership", "securityDeposit", "businessAsset", ""]);
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const plain = structuredClone(back.wh.request);
    for (const a of plain.input.household.accounts ?? []) if (a.kind === "otherAsset" && a.subtype !== "ownCompanyShares" && a.subtype !== "loanToCompany") delete a.subtype;
    expect(preview(forEngine(back.wh.request)).table).toEqual(preview(forEngine(plain)).table);
  });

  it("0.60 の形（0122）: 暗号資産の器を保存して読み戻す。金融資産の合計に入り、2027年までは取り崩さない（0124）", () => {
    const s = sample060();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const crypto = (stored.household.request.input.household.accounts ?? []).filter((a) => a.kind === "cryptoAsset");
    expect(crypto.map((a) => [a.id, a.subtype, a.expectedReturn])).toEqual([[id059(2), undefined, "0.02"]]);
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const t = preview(forEngine(back.wh.request)).table;
    const y = Number(back.wh.request.input.baseMonth.slice(0, 4)) + 1;
    const cell = (row: string) => t.filter((c) => c.row === row && c.year === y).reduce((x, c) => x + c.amount, 0);
    expect(cell("cf.balance.account.cryptoAsset")).toBeGreaterThan(2000000);
    expect(t.some((c) => c.row === "cf.transfer.withdrawal" && c.object === id059(2) && c.year <= 2027)).toBe(false);
  });

  it("控えの計算の直し（0122）: なくしたその他の資産の細目「暗号資産」を外す（種類は控えのまま。結果は細目の無いその他の資産と同じ）", () => {
    const req = structuredClone(sample059().wh.request);
    const self = roles(req).find((r) => r.key === "self")!.member;
    req.input.household.accounts = [...(req.input.household.accounts ?? []), { id: id059(2), kind: "otherAsset", subtype: "cryptoAsset" as never, owner: self.id, marketValue: { value: 2000000, state: "confirmed", origin: { kind: "manual" } } as never, asOf: req.input.baseMonth, contributions: [] }];
    const fixed = withoutRemovedAssumptions(req);
    const a = (fixed.input.household.accounts ?? []).find((x) => x.id === id059(2))!;
    expect(a.kind).toBe("otherAsset");
    expect(a.subtype).toBeUndefined();
    expect((req.input.household.accounts ?? []).find((x) => x.id === id059(2))!.subtype).toBe("cryptoAsset");
    expect(preview(forEngine(fixed)).table.some((c) => c.row === "cf.balance.account.otherAsset" && c.object === id059(2))).toBe(true);
  });

  it("0.49 の形（0104 の追記）: 子の貸与の奨学金の種類（第一種）を保存して読み戻す。種類は計算に使わず、利率で計算する", () => {
    const s = sample049();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const sch = (stored.household.request.input.household.goals ?? []).flatMap((g) => g.education?.scholarships ?? []);
    expect(sch.map((x) => x.type ?? null)).toEqual(["first", ...sch.slice(1).map(() => null)]);
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const plain = structuredClone(back.wh.request);
    for (const g of plain.input.household.goals ?? []) for (const x of g.education?.scholarships ?? []) delete x.type;
    expect(preview(forEngine(back.wh.request)).table).toEqual(preview(forEngine(plain)).table);
  });

  it("0.50 の形（0107）・0.57 から拡張領域（0114）: 会社と合わせたバランスシートの入力を ext.official.combinedBs に保存して読み戻し、計算の要求には入れない（計算の結果は変わらない）", () => {
    const s = sample050();
    const stored = bodyObject(s) as unknown as { household: Record<string, unknown> & { request: typeof s.wh.request }; ext: Record<string, { amounts?: { cash?: number } } | undefined>; extDefinitions: Record<string, unknown> };
    expect(stored.ext[CO_KEY]?.amounts?.cash).toBe(20000000);
    expect(stored.extDefinitions[CO_KEY]).toEqual(definitionOf(CO_DECL, CO_KEY));
    expect("companyBs" in stored.household).toBe(false);
    expect("extValues" in stored.household).toBe(false);
    expect(JSON.stringify(stored.household.request)).not.toContain("companyBs");
    expect(JSON.stringify(stored.household.request)).not.toContain(CO_KEY);
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(back.wh.extValues).toEqual(s.wh.extValues);
    expect(back.carry.ext[CO_KEY]).toBeUndefined();
    expect(preview(forEngine(back.wh.request)).table).toEqual(preview(forEngine(sample049().wh.request)).table);
    // 形の合わない値は捨て、何も残らなければ欄を持たない
    const bad = fromBody(JSON.stringify({ ...stored, ext: { ...stored.ext, [CO_KEY]: { amounts: { cash: "x" } } } }));
    expect(bad.wh.extValues).toBeUndefined();
    expect(CO_KEY in (bodyObject(bad).ext as Record<string, unknown>)).toBe(false);
    expect(CO_KEY in (bodyObject(bad).extDefinitions as Record<string, unknown>)).toBe(false);
    // 変換の段を通らない 0.56 までの形（household.companyBs）も同じ値として読み、書くときは拡張領域だけ
    const { [CO_KEY]: _v, ...restExt } = stored.ext;
    void _v;
    const legacy: CombinedBsInput = { version: 1, asOf: "2026-09", amounts: { cash: 20000000 }, stage: null, ownerMonthly: null, restated: {}, useRestated: false };
    const old = fromBody(JSON.stringify({ ...stored, ext: restExt, household: { ...stored.household, companyBs: legacy } }));
    expect(old.wh.extValues).toEqual({ [CO_KEY]: { asOf: "2026-09", amounts: { cash: 20000000 } } });
    const again = bodyObject(old) as unknown as typeof stored;
    expect("companyBs" in again.household).toBe(false);
    expect(again.ext[CO_KEY]).toEqual({ asOf: "2026-09", amounts: { cash: 20000000 } });
    // 宣言の無い拡張項目は今までどおりそのまま書き戻す
    const unknownExt = fromBody(JSON.stringify({ ...stored, ext: { ...stored.ext, "ext.someOffice.memo": { a: 1 } }, extDefinitions: { ...stored.extDefinitions, "ext.someOffice.memo": { type: "object" } } }));
    expect((bodyObject(unknownExt).ext as Record<string, unknown>)["ext.someOffice.memo"]).toEqual({ a: 1 });
  });

  it("0.51 の形（0055 の追記 2026-11-02）: 三大疾病保険の契約（種類の細目 threeMajor）を保存して読み戻し、三大疾病一時金を計算に使う", () => {
    const s = sample051();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const c = (stored.household.request.input.household.insuranceContracts ?? []).find((x) => x.subtype === "threeMajor");
    expect(c).toMatchObject({ template: "insurance.medical", coverages: [{ benefit: "threeMajorLump", amount: 3000000 }] });
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(preview(forEngine(back.wh.request)).table).toEqual(preview(forEngine(s.wh.request)).table);
  });

  it("0.52 の形（0055 の追記 2026-11-03）: 低解約返戻金型（払込中の率・年齢ごとの率の点）とアカウント型（積立の部分）を保存して読み戻し、計算に使う", () => {
    const s = sample052();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const list = stored.household.request.input.household.insuranceContracts ?? [];
    expect(list.find((x) => x.subtype === "lowSurrender")?.simple).toMatchObject({ returnRateDuring: "0.7", returnRatePoints: [{ age: 70, rate: "1.12" }, { age: 80, rate: "1.25" }] });
    expect(list.find((x) => x.subtype === "account")?.simple?.account).toEqual({ value: 2500000, after: "annuity", annual: 270000, years: 10 });
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const r = preview(forEngine(back.wh.request));
    expect(r.table).toEqual(preview(forEngine(s.wh.request)).table);
    // アカウント型の年金を受け取る
    expect(r.table.some((t) => t.row === "cf.income.corporatePension.privateAnnuity" && t.object === list.find((x) => x.subtype === "account")?.id && t.amount > 0)).toBe(true);
  });

  it("0.54 の形（0111 の追記 2026-11-03）: 推定の元の印（事務所の推定の値から作った推定）を保存して読み戻し、計算には使わない", () => {
    const s = sample054();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const bonus = (stored.household.request.input.household.employmentPeriods ?? []).find((x) => x.type === "regular")?.salary?.bonus as unknown as { estimate?: { source?: unknown } };
    expect(bonus.estimate?.source).toEqual({ kind: "office", values: { "wageStats.annualBonus.regular.female": "1a2b3c4d" } });
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    // 計算の要求のスキーマが印を受け、計算には使わない（外しても結果は同じ）
    const strip = JSON.parse(JSON.stringify(back.wh.request).replace(/,"source":\{"kind":"office","values":\{[^}]*\}\}/g, "")) as typeof back.wh.request;
    expect(JSON.stringify(strip)).not.toContain('"source":{"kind"');
    expect(preview(forEngine(back.wh.request)).table).toEqual(preview(forEngine(strip)).table);
  });

  it("0.53 の形（0052 の追記 2026-11-03・0112）: 住宅の購入の新築か中古か・長期優良住宅かを保存して読み戻し、計算には使わない", () => {
    const s = sample053();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const r = (stored.household.request.input.household.residences ?? []).find((x) => x.purchase?.newBuild !== undefined);
    expect(r?.purchase).toMatchObject({ newBuild: false, longLife: true });
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    // 計算には使わない（外しても結果は同じ）
    const plain = structuredClone(s.wh.request);
    for (const x of plain.input.household.residences ?? []) if (x.purchase !== undefined) x.purchase = { ...x.purchase, newBuild: undefined, longLife: undefined } as never;
    const strip = JSON.parse(JSON.stringify(plain)) as typeof plain;
    expect(preview(forEngine(back.wh.request)).table).toEqual(preview(forEngine(strip)).table);
  });

  it("0.56 の形（0113 の7・10）: 移行の取り込みの記録を区画 migrations に保存して読み戻し、推定の出し方 migrated の値は計算の結果を変えない", () => {
    const s = sample056();
    const stored = bodyObject(s) as unknown as { migrations?: MigrationLog; household: Record<string, unknown> & { request: typeof s.wh.request } };
    expect(stored.migrations).toEqual(sampleMigrations());
    expect(stored.household.migrations).toBeUndefined();
    const back = fromBody(JSON.stringify(stored));
    expect(back.wh.migrations).toEqual(sampleMigrations());
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const box = (back.wh.request.input.household.accounts![0] as unknown as { marketValue: { estimate?: { method: string } } }).marketValue;
    expect(box.estimate?.method).toBe("migrated");
    // 計算は前の版の見本（確定の値）と同じ（推定の印と出どころは計算に使わない。参照値は計算に入らない）
    expect(preview(forEngine(back.wh.request)).table).toEqual(preview(forEngine(sample055().wh.request)).table);
    // 移したことの無い世帯は区画を作らない
    expect((bodyObject(sample055()) as unknown as Record<string, unknown>).migrations).toBeUndefined();
    const empty = { ...s, wh: { ...s.wh, migrations: { version: 1, imports: [] } } };
    expect((bodyObject(empty) as unknown as Record<string, unknown>).migrations).toBeUndefined();
  });

  it("移行の取り込みの記録は形を確かめて読み、形の合わない記録・行と知らない欄（ファイル名・伏せ字の前の文字など）は捨てる（0113 の10）", () => {
    const good = sampleMigrations().imports[0]!;
    const log = readMigrationLog({
      version: 1,
      imports: [
        { ...good, fileName: "（ファイル名）.pdf", original: "（伏せ字の前の文字）", extracted: [...good.extracted, { block: "x", label: "a", text: "b", to: { drop: true }, decidedBy: "rule" }, { block: "x", label: "a", text: "b", to: { item: "member.birth" }, decidedBy: "guess" }], referenceValues: [...good.referenceValues, { row: "net", year: 2027, amount: 1 }, { row: "cf.net", year: 2027, amount: 1.5 }, { row: "cf.net", year: 2027, amount: 1, precision: 100 }], conventions: { ...good.conventions, roundReturn: "floor", tableBalance: "midYear" } },
        { ...good, id: good.id },
        { ...good, id: "bad-file", file: { sha256: "sha1:x", bytes: 1 } },
        { ...good, id: "bad-rule", rule: { id: "official.genericReport", revision: 1, contract: "migration-rule@2.0" } },
        { ...good, id: "bad-kind", kind: "statement" },
        "x",
      ],
    });
    expect(log.imports.map((i) => i.id)).toEqual([good.id]);
    expect(log.imports[0]).toEqual(good);
    expect(readMigrationLog(null)).toEqual({ version: 1, imports: [] });
  });

  it("互換モード（0113 の8）: 元の取り込みの記録がある世帯では残り、表示の項目だけなら計算の結果は null と同じ。記録が無ければ読むときに null に直して知らせる", () => {
    const s = sample056();
    const compat = { source: { import: MIGRATION_IMPORT, rule: "official.genericReport@1" }, items: { tableAge: "yearStart" as const } };
    const withCompat = (wh: WorkingHousehold): WorkingHousehold => {
      const request = structuredClone(wh.request);
      (request.input as unknown as { calcConventions: Record<string, unknown> }).calcConventions.compatibility = compat;
      return { ...wh, request };
    };
    const conv = (wh: WorkingHousehold) => (wh.request.input as unknown as { calcConventions: { compatibility: unknown } }).calcConventions.compatibility;
    const kept = fromBody(bodyOf({ ...s, wh: withCompat(s.wh) }));
    expect(conv(kept.wh)).toEqual(compat);
    expect(kept.wh.notices ?? []).toEqual(s.wh.notices ?? []);
    expect(preview(forEngine(kept.wh.request)).table).toEqual(preview(forEngine(s.wh.request)).table);
    // 記録の無い世帯（区画 migrations が無い・別の記録を指す）は null に直し、開いたときの知らせを1回だけ足す
    const { migrations: _m, ...noLog } = withCompat(s.wh);
    void _m;
    const dropped = fromBody(bodyOf({ ...s, wh: noLog as WorkingHousehold }));
    expect(conv(dropped.wh)).toBeNull();
    const notices = (dropped.wh.notices ?? []).filter((n) => n.kind === "compatibilityDropped");
    expect(notices).toHaveLength(1);
    expect(householdNoticeText(notices[0]!)?.title).toBe("移行元の数え方をやめました");
    expect((fromBody(bodyOf(dropped)).wh.notices ?? []).filter((n) => n.kind === "compatibilityDropped")).toHaveLength(1);
    const other = withoutOrphanCompatibility({ ...withCompat(s.wh), migrations: { version: 1, imports: [{ ...sampleMigrations().imports[0]!, id: "other" }] } });
    expect(conv(other)).toBeNull();
    // 互換モードの無い世帯はそのまま（同じ物を返す）
    expect(withoutOrphanCompatibility(s.wh)).toBe(s.wh);
  });

  it("0.55 の形（0115）: 注文住宅の土地と引き渡しの前の支払いを保存して読み戻し、計算に使う（土地の決済の月に払い、土地を持つ）", () => {
    const s = sample055();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const r = (stored.household.request.input.household.residences ?? []).find((x) => x.purchase?.land !== undefined);
    expect(r?.purchase?.land).toMatchObject({ at: { at: "2059-07" }, price: 18000000, downPayment: 4000000, costs: 1100000 });
    expect(r?.purchase?.payments?.[0]).toMatchObject({ amount: 1000000, kind: "start" });
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const p = preview(forEngine(back.wh.request));
    const at = (row: string, year: number) => p.table.filter((c) => c.row === row && c.year === year && c.object === r?.id).reduce((x, c) => x + c.amount, 0);
    expect(at("cf.expense.housing.purchase.downPayment", 2059)).toBe(5000000);
    expect(at("cf.expense.housing.purchase.downPayment", 2060)).toBe(1000000);
    expect(at("cf.expense.housing.purchase.costs", 2059)).toBe(1100000);
  });

  it("0.42 の形（0090）: 高専と専門職大学院（法科大学院）の段を保存して読み戻し、計算に使う", () => {
    const s = sample042();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const stages = (stored.household.request.input.household.goals ?? []).flatMap((g) => g.education?.stages ?? []);
    expect(stages.some((x) => x.stage === "kosen" && x.sector === "national")).toBe(true);
    expect(stages.some((x) => x.stage === "graduateProfessional" && x.field === "law")).toBe(true);
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(() => preview(back.wh.request)).not.toThrow();
  });

  it("0.41 の形（0089）: 大学院の段とインターナショナルスクールを保存して読み戻し、計算に使う", () => {
    const s = sample041();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const stages = (stored.household.request.input.household.goals ?? []).flatMap((g) => g.education?.stages ?? []);
    expect(stages.some((x) => x.stage === "graduateMaster" && x.sector === "national")).toBe(true);
    expect(stages.some((x) => x.sector === "international" && x.annualOverride === 2400000)).toBe(true);
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(() => preview(back.wh.request)).not.toThrow();
  });

  it("0.40 の形（0088）: 教育の目標の留学を保存して読み戻し、計算に使う（休学の年は学費がかからない）", () => {
    const s = sample040();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const g = (stored.household.request.input.household.goals ?? []).find((x) => x.education?.abroad !== undefined)!;
    expect(g.education!.abroad!.map((a) => a.kind)).toEqual(["credit", "leave"]);
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const plain = structuredClone(back.wh.request);
    for (const x of plain.input.household.goals ?? []) delete x.education?.abroad;
    type Cell = { row: string; year: number; amount: number };
    const sum = (r: typeof plain, row: string) => (preview(r).table as unknown as Cell[]).filter((c) => c.row === row).reduce((a, c) => a + c.amount, 0);
    expect(sum(back.wh.request, "cf.expense.education")).toBeGreaterThan(sum(plain, "cf.expense.education"));
  });

  it("0.39 の形（0062・0029 の追記 2026-10-30）: 段の給食費の選び方・部活動などの費用・保育料とは別にかかるお金を保存して読み戻し、計算に使う", () => {
    const s = sample039();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const stages = (stored.household.request.input.household.goals ?? []).flatMap((g) => g.education?.stages ?? []);
    expect(stages.find((x) => x.stage === "elementary")?.schoolLunch).toBe("free");
    expect(stages.find((x) => x.stage === "juniorHigh")?.clubAnnual).toBe(84000);
    expect(stages.find((x) => x.stage === "nursery")?.extraAnnual).toBe(12000);
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const plain = structuredClone(back.wh.request);
    for (const g of plain.input.household.goals ?? []) for (const st of g.education?.stages ?? []) {
      delete st.schoolLunch;
      delete st.clubAnnual;
      delete st.extraAnnual;
    }
    expect(preview(back.wh.request).table).not.toEqual(preview(plain).table);
  });

  it("0.38 の形（0047 の追記 2026-10-29 の2）: 標準報酬月額が空欄の期間を空欄のまま保存して読み戻し、給与から毎年決め直して計算する（昇給が厚生年金の額に入る）", () => {
    const s = sample038();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const spouse = s.wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    const mine = (r: typeof s.wh.request) => (r.input.household.employmentPeriods ?? []).filter((p) => p.member === spouse.id);
    expect(mine(stored.household.request).length).toBeGreaterThan(0);
    expect(mine(stored.household.request).every((p) => p.standardMonthlyRemuneration === undefined)).toBe(true);
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    // 空欄なら給与から決め直すので、今の年収の推定の額で固めた世帯より、厚生年金の保険料（昇給の分）が多い
    type Cell = { row: string; year: number; amount: number };
    const pensionPremium = (r: typeof s.wh.request) => (preview(r).table as unknown as Cell[]).filter((c) => c.row === "cf.taxSi.pension").reduce((a, c) => a + c.amount, 0);
    const fixed = structuredClone(back.wh.request);
    // 前の画面が書いていた推定の額（今の年収を等級表に当てた額）
    for (const p of mine(fixed)) p.standardMonthlyRemuneration = smrEstimate(p.salary?.annual.value ?? 0, smrMonth(p, fixed.input.baseMonth));
    expect(Math.abs(pensionPremium(back.wh.request))).toBeGreaterThan(Math.abs(pensionPremium(fixed)));
    // 0.37 → 0.38 の変換の段が推定を外した世帯には、開いたときの知らせを1回だけ見せる（押すと働き方と収入を開く）
    const i: BarInputs = { opened: true, stored: true, save: { kind: "idle" } as never, paused: false, aiSharing: false, storage: [], showing: { recovery: false, office: false, storage: false }, presence: null, message: (c) => c, household: [{ id: "n1", kind: "smrBlank", count: 2, plans: 1 }] };
    const [n] = barNotices(i);
    expect(n).toMatchObject({ id: "household:n1", target: "work", action: "働き方と収入" });
    expect(n?.text).toContain("働き方の期間 2件とプランの変更 1件");
    expect(barNotices({ ...i, household: [{ id: "n2", kind: "smrBlank", count: 1, plans: 0 }] })[0]?.text).toContain("（働き方の期間 1件）");
    // 人の属性で推定の数字を分けない（0.58 の変換の段。0118）
    const neutral = barNotices({ ...i, household: [{ id: "n3", kind: "neutralEstimates", count: 2, plans: 1, estimates: 3 }] })[0];
    expect(neutral?.title).toBe("推定を性別・学歴で分けないようにしました");
    expect(neutral?.text).toContain("（2か所とプランの変更 1件）");
    expect(neutral?.text).toContain("推定のままの年収・賞与・退職一時金（3件）は、次に入力を直したときに新しい目安で入れ直します");
    expect(barNotices({ ...i, household: [{ id: "n4", kind: "neutralEstimates", count: 0, plans: 0, estimates: 1 }] })[0]?.text).not.toContain("全体の表に直しました");
  });

  it("0.37 の形（0086）: 入るお金の行の表の行「雑所得」と、事業所得として扱う副業の行を保存して読み戻す。表の行は見せ方だけで、税・社会保険料は表の行に依らない", () => {
    const s = sample037();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const flows = stored.household.request.input.household.incomeFlows ?? [];
    expect(flows.filter((f) => f.kind === "sideJob").map((f) => [f.row, f.taxTreatment ?? null])).toEqual([
      ["cf.income.other.miscellaneous", null],
      ["cf.income.business", "business"],
    ]);
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    type Cell = { row: string; year: number; amount: number };
    const table = (r: typeof s.wh.request) => preview(r).table as unknown as Cell[];
    const sumOf = (cells: Cell[], pick: (c: Cell) => boolean) => cells.filter(pick).reduce((a, c) => a + c.amount, 0);
    const now = table(back.wh.request);
    expect(sumOf(now, (c) => c.row === "cf.income.other.miscellaneous")).toBeGreaterThan(0);
    // 表の行を種類の既定（副業）に戻しても、税・社会保険料は同じ
    const plainRows = structuredClone(back.wh.request);
    for (const f of plainRows.input.household.incomeFlows ?? []) delete f.row;
    const was = table(plainRows);
    expect(sumOf(was, (c) => c.row === "cf.income.other.miscellaneous")).toBe(0);
    expect(sumOf(now, (c) => c.row.startsWith("cf.taxSi."))).toBe(sumOf(was, (c) => c.row.startsWith("cf.taxSi.")));
  });

  it("0.24 の形（0060・0061）: 相続税の目安の設定と遺したい額を要求の入力に保存して読み戻す。エンジンへ渡す要求からは外れ、結果は同じ", () => {
    const s = sample024();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    expect(stored.household.request.input.inheritanceTax).toMatchObject({ realEstateRatio: "0.7", funeral: 2000000 });
    expect(stored.household.request.input.legacy?.amount?.value).toBe(10000000);
    const back = fromBody(JSON.stringify(stored));
    expect(back.wh.request.input.inheritanceTax).toEqual(s.wh.request.input.inheritanceTax);
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect(forEngine(back.wh.request).input.inheritanceTax).toBeUndefined();
    expect(forEngine(back.wh.request).input.legacy).toBeUndefined();
    expect(preview(back.wh.request).table).toEqual(preview(sample023().wh.request).table);
    expect(back.wh.proposals[0]!.diffs.at(-1)).toMatchObject({ target: { plan: "input" }, item: "plan.legacy", at: ["amount"] });
  });

  it("0.23 の形（0062）: 学校外の費用の入れ方と塾・習い事の行の種類を保存して読み戻す。行で入れると統計の平均を足さない", () => {
    const s = sample023();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const goal = (stored.household.request.input.household.goals ?? []).find((g) => g.education?.outOfSchoolMode === "rows");
    expect(goal?.education?.lessons?.map((l) => l.kind)).toEqual(goal?.education?.lessons?.map((_, i) => (i === 0 ? "cram" : "lesson")));
    const back = fromBody(JSON.stringify(stored));
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const sum = (r: ReturnType<typeof preview>) => r.table.filter((c) => c.row === "cf.expense.education.outOfSchool").reduce((x, c) => x + c.amount, 0);
    expect(sum(preview(back.wh.request))).toBeLessThan(sum(preview(sample022().wh.request)));
  });

  it("0.21 の形（0052・0053）: 建て方・譲渡所得の税の額・ローンの名前と種類の細目・ローンの入れ方の区分を保存して読み戻す", () => {
    const s = sample021();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request; loanEntry?: Record<string, string> } };
    const h = stored.household.request.input.household;
    const home = h.residences?.find((r) => r.kind === "own");
    expect(home).toMatchObject({ style: "condo", sale: { price: 30000000, tax: { value: 1500000 } } });
    expect(h.debts?.find((d) => d.kind !== "mortgage")).toMatchObject({ label: "架空のカードローン", subtype: "cardLoan" });
    const loan = h.debts?.find((d) => d.kind === "mortgage");
    expect(loan).toBeDefined();
    expect(stored.household.loanEntry).toEqual({ [loan!.id]: "balance" });
    const back = fromBody(JSON.stringify(stored));
    expect(back.wh.loanEntry).toEqual({ [loan!.id]: "balance" });
    expect(bodyObject(back)).toEqual(bodyObject(s));
    const r = preview(back.wh.request);
    expect(r.table.filter((c) => c.row.endsWith(".realEstateSale") && c.row.startsWith("cf.taxSi.") && c.year === 2050).reduce((x, c) => x + c.amount, 0)).toBe(1500000);
  });

  it("0.20 の形（0044）: 入るお金の行・出るお金の行に足した欄・口座の間の移し替え・受け継ぐ借金の欄を保存して読み戻す（要素の ID もそのまま）", () => {
    const s = sample020();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const h = stored.household.request.input.household;
    expect(h.incomeFlows?.map((f) => f.id)).toEqual(["00000000-0000-4000-8000-00000000f001", "00000000-0000-4000-8000-00000000f002", "00000000-0000-4000-8000-00000000f005"]);
    expect(h.incomeFlows?.[1]?.stages?.[0]?.id).toBe("00000000-0000-4000-8000-00000000f003");
    expect(h.periodicExpenses?.find((p) => p.kind === "gift")?.gift).toEqual({ method: "calendar", purpose: "general" });
    const back = fromBody(JSON.stringify(stored));
    expect(back.wh.request.input.household.incomeFlows).toEqual(withIds(s.wh).request.input.household.incomeFlows);
    expect(bodyObject(back)).toEqual(bodyObject(s));
    preview(back.wh.request);
  });

  it("0.18 の形（0040）: 段階・例外の年・器の利回りの段階・資産配分の段階・期間ごとの伸びを保存して読み戻す（要素の ID もそのまま）", () => {
    const s = sample018();
    const stored = bodyObject(s) as unknown as { household: { request: typeof s.wh.request } };
    const inStored = stored.household.request.input;
    const h = inStored.household;
    expect(h.periodicExpenses?.[0]?.stages?.map((x) => x.id)).toEqual(["00000000-0000-4000-8000-00000000e001", "00000000-0000-4000-8000-00000000e002"]);
    expect(h.residences?.[0]?.maintenance?.exceptions?.[0]?.year).toBe(2041);
    expect(h.accounts?.find((a) => a.returnStages !== undefined)?.returnExceptions?.[0]?.expectedReturn).toBe("-0.2");
    expect(inStored.assumptions?.investment?.allocation?.stages?.[0]?.mix[1]?.share).toBe("0.6");
    expect(h.employmentPeriods?.some((p) => (p.salary?.growth as { rate?: string } | undefined)?.rate === "0.015")).toBe(true);
    const back = fromBody(JSON.stringify(stored));
    expect(back.wh.request.input.household.periodicExpenses).toEqual(withIds(s.wh).request.input.household.periodicExpenses);
    expect(bodyObject(back)).toEqual(bodyObject(s));
  });

  it("0.17 の形（0035・0036）: 差分は当て先で、仮の印は値の状態の欄で、贈与者は世帯の外の家族で書き、読み戻すと画面の中の形に戻る", () => {
    const s = sample017();
    const stored = bodyObject(s) as unknown as { household: { assumed?: unknown; request: { input: { household: { members: Record<string, unknown>[]; donors?: unknown } } } }; proposals: { diffs: Record<string, unknown>[] }[]; workspace: { shownItems: unknown[] } };
    const members = stored.household.request.input.household.members;
    expect(stored.household.request.input.household.donors).toBeUndefined();
    expect(members.find((m) => m.id === "00000000-0000-4000-8000-0000000000d1")).toEqual({ id: "00000000-0000-4000-8000-0000000000d1", kind: "grandparent", joins: null, leaves: null, expected: false, outside: { of: roles(s.wh.request).find((r) => r.key === "self")!.member.id, periods: [] } });
    expect(members.find((m) => m.id === "00000000-0000-4000-8000-0000000000b9")?.valueStates).toEqual({ "member.birth": { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "仮の値（予定日から）" } } });
    expect(stored.household.assumed).toBeUndefined();
    const diffs = stored.proposals.flatMap((p) => p.diffs);
    expect(diffs.every((d) => d.key === undefined && d.op === "set")).toBe(true);
    // 表の最後の年はどのプランにも共通（0043 の追記 2026-11-05）: 結果のタブの値で渡しても差分にしない
    expect(diffs.find((d) => d.item === "plan.endYear")).toBeUndefined();
    expect(diffs.find((d) => d.item === "account.marketValue")).toMatchObject({ at: [] });
    expect(diffs.filter((d) => isLever(d.target)).map((d) => (d.target as { lever: string }).lever).sort()).toEqual(["livingMonthly", "retireAge"]);
    expect(stored.workspace.shownItems[0]).toEqual({ target: { lever: "loanRateShift" }, item: null, at: [] });
    const back = fromBody(JSON.stringify(stored));
    expect(back.wh).toEqual(withIds(s.wh));
    expect(back.workspace.shownItems).toEqual(s.workspace.shownItems);
    // 読み戻して書き直しても同じ（世帯ファイルの形は失わない）
    expect(bodyObject(back)).toEqual(bodyObject(s));
  });
});

describe("画面にファイルの道（パス）を渡さない（0016 の1）", () => {
  const tauri = join(APP_DIR, "src-tauri");
  it("画面に与える権限は、アプリが定義した命令だけ（プラグインの権限・ファイル・ダイアログは無い）", () => {
    const cap = JSON.parse(readFileSync(join(tauri, "capabilities", "main.json"), "utf8")) as { permissions: string[] };
    const build = readFileSync(join(tauri, "build.rs"), "utf8");
    const commands = [...build.slice(build.indexOf("const COMMANDS"), build.indexOf("];")).matchAll(/"([a-z_]+)"/g)].map((m) => m[1] as string);
    expect(commands).toContain("store_save");
    expect(cap.permissions.sort()).toEqual(commands.map((c) => `allow-${c.replace(/_/g, "-")}`).sort());
    const cargo = readFileSync(join(tauri, "Cargo.toml"), "utf8");
    expect(cargo).not.toMatch(/tauri-plugin-/);
    const pkg = JSON.parse(readFileSync(join(APP_DIR, "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((k) => k.startsWith("@tauri-apps/plugin-"))).toEqual([]);
  });

  it("保存・事務所の共有の命令に渡すのは、内部ID・本文・要約・顧客番号・区分・見本の指定・確認・復元キー・分岐の選び方・表示名・申請と指紋だけ", () => {
    const host = readFileSync(join(APP_DIR, "src", "engine", "host.ts"), "utf8");
    const calls = [...host.matchAll(/invoke<[^>]*>\("((?:store|recovery_key|app|office)_[a-z_]+)"(?:, \{ ([^}]*) \})?\)/g)];
    expect(calls.length).toBeGreaterThanOrEqual(23);
    // 0023: 共有フォルダは本体のダイアログで選ばせるので、パス・フォルダの引数は無い
    // 0033: 区分の記号・区分の設定・見本の指定（家族の形・年代・名前・絞り込みの項目）
    // 0073: 事務所の既定値（画面の形の JSON のオブジェクト。本体は大きさとオブジェクトかだけを確かめる）
    const allowed = new Set(["id", "body", "summary", "customerNo", "confirm", "key", "keepOurs", "adopt", "name", "request: requestId", "fingerprint", "member: memberId", "category", "category: opts?.category ?? null", "sample", "sample: opts?.sample ?? null", "traits", "edits", "value"]);
    for (const c of calls) {
      const args = (c[2] ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "");
      for (const a of args) expect(allowed.has(a), `${c[1]} の引数 ${a}`).toBe(true);
    }
  });

  it("画面の側のコードは、ファイルの道を組み立てない（世帯ファイルの拡張子・データフォルダの名前を持たない）", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(join(d, f.name));
        else if (/\.(ts|tsx)$/.test(f.name)) files.push(join(d, f.name));
      }
    };
    walk(join(APP_DIR, "src"));
    for (const f of files) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/\.lphf|\.lpkv|\.lpod|data-dev/);
    }
    expect(existsSync(join(APP_DIR, "src", "workspace", "store", "body.ts"))).toBe(true);
  });
});

describe("自動保存", () => {
  function fakeTimers() {
    const q: { fn: () => void; ms: number; live: boolean }[] = [];
    const t: Timers = {
      set: (fn, ms) => {
        q.push({ fn, ms, live: true });
        return q.length - 1;
      },
      clear: (h) => {
        const x = q[h as number];
        if (x !== undefined) x.live = false;
      },
    };
    const fire = () => {
      for (const x of q.splice(0)) if (x.live) x.fn();
    };
    return { t, q, fire };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("変更から待って、最後の本文だけを保存する。同じ本文は保存しない", async () => {
    const saved: string[] = [];
    const states: SaveState[] = [];
    const { t, fire } = fakeTimers();
    const a = new Autosaver(async (b) => (saved.push(b), NOW), (s) => states.push(s), 1500, t);
    a.reset("A");
    a.change("A");
    fire();
    await tick();
    expect(saved).toEqual([]);
    a.change("B");
    a.change("C");
    expect(a.dirty).toBe(true);
    fire();
    await tick();
    expect(saved).toEqual(["C"]);
    expect(states.at(-1)).toEqual({ kind: "saved", at: NOW });
    expect(a.dirty).toBe(false);
  });

  it("flush は待たずに保存する。保存していない世帯（見本）では何もしない", async () => {
    const saved: string[] = [];
    const { t } = fakeTimers();
    const a = new Autosaver(async (b) => (saved.push(b), NOW), () => undefined, 1500, t);
    a.reset(null);
    a.change("X");
    await a.flush();
    expect(saved).toEqual([]);
    a.reset("A");
    a.change("B");
    await a.flush();
    expect(saved).toEqual(["B"]);
  });

  it("分岐が見つかったら自動保存を止める（上書きを続けない）", async () => {
    let n = 0;
    const states: SaveState[] = [];
    const { t, fire } = fakeTimers();
    const a = new Autosaver(async () => (n++, Promise.reject("E_STORE_CONFLICT")), (s) => states.push(s), 1500, t);
    a.reset("A");
    a.change("B");
    fire();
    await tick();
    a.change("C");
    fire();
    await a.flush();
    expect(n).toBe(1);
    expect(states.at(-1)).toEqual({ kind: "error", code: "E_STORE_CONFLICT" });
  });

  it("保存中に変わったら、終わってからもう一度保存する", async () => {
    const saved: string[] = [];
    let release: () => void = () => undefined;
    const { t, fire } = fakeTimers();
    const a = new Autosaver(
      (b) =>
        new Promise<string>((ok) => {
          release = () => (saved.push(b), ok(NOW));
        }),
      () => undefined,
      1500,
      t,
    );
    a.reset("A");
    a.change("B");
    fire();
    await tick();
    a.change("C");
    release();
    await tick();
    await tick();
    fire();
    await tick();
    release();
    await tick();
    expect(saved).toEqual(["B", "C"]);
  });
});

describe("復元キーの表示", () => {
  it("5組ずつ3行に分ける", () => {
    const key = Array.from({ length: 15 }, (_, i) => `A${String(i).padStart(3, "0")}`).join("-");
    const lines = keyLines(key);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("A000-A001-A002-A003-A004");
  });
});
