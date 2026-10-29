// 万一の画面の要求を作る（作業の層）: 万一なし（現状）・必要保障額の推移（構成員ごと）・選んだ想定（死亡・障害）。
// どれも現状の世帯（入力の値）に「層」を重ねる形で、世帯（現状）は変えない（0008 の5・7）
import type { Contingency, EmploymentPeriod, EngineRequest, Household, Illness, Member, OldAgeChoice, ProtectionRequest, SurvivorAssumptions } from "../../engine/types.ts";
import { confirmedBox, type WorkingHousehold } from "../input/household.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { smrEstimate } from "../input/estimates.ts";
import { convertPeriod } from "../input/stages/work.ts";
import { addMonths, ageReachedMonth, derivedId, parseYm } from "../levers.ts";
import { roles } from "../roles.ts";
import type { ContingencyPlan, PartnerScene, SurvivorWork } from "./planData.ts";

export type ScenarioKind = "death" | "disability" | "illness" | "income" | "market";

/** 大きな病気のときの目安（仮の値。事務所で根拠を確かめて直す前提）。医療費は保険診療の10割で、自己負担は高額療養費で計算する */
export const ILLNESS_DEFAULT = { months: 12, medicalMonthly: 600_000, medicalMonths: 6, disease: "cancer", surgeries: 1 } as const;
/**
 * 病気の種類ごとの入院の日数の目安（0055。患者調査〔厚生労働省〕の退院患者の平均在院日数の水準を丸めた仮の値。出典の版と値を確かめて直す前提）。
 * 保険の医療・がんの給付（入院日額×日数）の見込みに使う
 */
export const HOSPITAL_DAYS_DEFAULT: Readonly<Record<"cancer" | "heartStroke" | "other", number>> = { cancer: 20, heartStroke: 30, other: 10 };

/** 大きな病気のときの病気の想定（病気の種類・入院の日数・手術の回数。省略は目安） */
export function illnessOf(plan: ContingencyPlanIllness | undefined): Illness {
  const disease = plan?.disease ?? ILLNESS_DEFAULT.disease;
  return { disease, hospitalDays: plan?.hospitalDays ?? HOSPITAL_DAYS_DEFAULT[disease], surgeries: plan?.surgeries ?? ILLNESS_DEFAULT.surgeries };
}
type ContingencyPlanIllness = NonNullable<import("./planData.ts").ContingencyPlan["illness"]>;
/** 相場が下がったときの下がる幅の既定（3割）と、下げる資産の種類（株・REIT） */
export const MARKET_DROP_DEFAULT = "0.3";
const RISKY = ["equity.domestic", "equity.global", "reit.domestic", "reit.global"];
/** 下げる資産の印: 資産の種類（器の配分のうちその割合を下げる）と、器の種類（kind:<種類>。器の全体を下げる） */
export const ESOP = "kind:esop";
export const FX_DEPOSIT = "kind:fxDeposit";
/** 下げる資産の既定（株・REIT と、配分を入れていない持株会。今までと同じ下げ方） */
export const MARKET_CLASSES_DEFAULT: readonly string[] = [...RISKY, ESOP];
/** 収入が減る場面の既定（本人・2割・3年。ストレステストの型 incomeDrop の既定と同じ） */
export const INCOME_DROP_DEFAULT = { member: "self", ratio: "0.2", years: 3 } as const;
/** 運用する器（持株会を除く。持株会は下げる資産で選ぶ） */
const INVEST_BUT_ESOP = ["taxable", "nisa", "childNisa", "juniorNisa", "legacyNisa", "ideco", "corporateDc", "pooled"];
/** 運用する器（相場が下がったときの場面を出すか） */
const INVESTED = new Set(["taxable", "nisa", "childNisa", "juniorNisa", "legacyNisa", "ideco", "corporateDc", "esop", "pooled"]);

export interface Scenario {
  /** 画面の鍵（物の ID を含まない）: death:self・disability:spouse など */
  key: string;
  kind: ScenarioKind;
  member: string;
  /** 例: 「ご主人の死亡」 */
  label: string;
  /** 対象の人の呼び方（ご主人・奥様・ご本人） */
  who: string;
}

/** 万一なしの要求（世帯に入っていた万一の想定・必要保障額の要求は外す） */
export function baseRequest(req: EngineRequest): EngineRequest {
  const out = structuredClone(req);
  delete out.input.contingencies;
  delete out.input.protection;
  delete out.input.inheritanceTax;
  out.trace = "none";
  return out;
}

/** 世帯に保存した相続税の目安の設定（時点・亡くなる人の選び方を除く） */
function storedSettings(req: EngineRequest): NonNullable<EngineRequest["input"]["inheritanceTax"]> {
  const { points: _p, members: _m, ...rest } = req.input.inheritanceTax ?? {};
  void _p;
  void _m;
  return rest;
}

/** 世帯の大人（本人・配偶者）と、その配偶者（いれば） */
export function adults(h: Household): { member: Member; spouse: Member | undefined }[] {
  const ms = h.members.filter((m) => m.kind === "self" || m.kind === "spouse");
  const spouseOf = (id: string) => {
    for (const r of h.relations ?? []) if (r.type === "spouse" && (r.a === id || r.b === id) && r.to == null) return h.members.find((m) => m.id === (r.a === id ? r.b : r.a));
    return undefined;
  };
  return ms.map((m) => ({ member: m, spouse: spouseOf(m.id) }));
}

/** 選べる想定: 大人ごとの死亡（遺族がいるときだけ）と、障害・就業不能 */
export function scenarios(wh: WorkingHousehold): Scenario[] {
  const req = wh.request;
  const h = req.input.household;
  const label = new Map(roles(req).map((r) => [r.member.id, r.label]));
  const hasKids = h.members.some((m) => m.kind === "child");
  const out: Scenario[] = [];
  const list = adults(h);
  for (const a of list) {
    const who = label.get(a.member.id) ?? "ご本人";
    if (a.spouse !== undefined || hasKids) out.push({ key: `death:${a.member.kind}`, kind: "death", member: a.member.id, label: `${who}の死亡`, who });
  }
  for (const a of list) {
    const who = label.get(a.member.id) ?? "ご本人";
    out.push({ key: `disability:${a.member.kind}`, kind: "disability", member: a.member.id, label: `就業不能（${who}）`, who });
  }
  // 0026: 大きな病気のとき（本人・配偶者。0071）・収入が減るとき（0071）・相場が下がったとき（運用する口座があるとき）
  for (const a of list) {
    const who = label.get(a.member.id) ?? "ご本人";
    out.push({ key: `illness:${a.member.kind}`, kind: "illness", member: a.member.id, label: `大きな病気（${who}）`, who });
  }
  const self = list.find((a) => a.member.kind === "self") ?? list[0];
  if (self !== undefined) {
    const who = label.get(self.member.id) ?? "ご本人";
    if (earnersOf(wh).length > 0) out.push({ key: "income", kind: "income", member: self.member.id, label: "収入が減る", who });
    if (hasInvested(h)) out.push({ key: "market", kind: "market", member: self.member.id, label: "相場の下落", who });
  }
  return out;
}

/** 運用する器があるか（相場の下落の場面・重ねる印を出すか） */
export const hasInvested = (h: Household): boolean => (h.accounts ?? []).some((x) => INVESTED.has(x.kind) || x.kind === "fxDeposit");

/** 収入が減る場面の対象になる大人（本人・配偶者） */
function earnersOf(wh: WorkingHousehold): Member[] {
  return adults(wh.request.input.household).map((a) => a.member);
}

/** 収入が減る人（前提の「誰の収入」。配偶者がいなければ本人） */
export function incomeMembers(wh: WorkingHousehold, plan: ContingencyPlan): Member[] {
  const ls = adults(wh.request.input.household).map((a) => a.member);
  const who = plan.incomeDrop?.member ?? INCOME_DROP_DEFAULT.member;
  const self = ls.find((m) => m.kind === "self") ?? ls[0];
  const spouse = ls.find((m) => m.kind === "spouse");
  const out = who === "both" ? ls : who === "spouse" ? (spouse !== undefined ? [spouse] : []) : self !== undefined ? [self] : [];
  return out.length > 0 ? out : self !== undefined ? [self] : [];
}

/** 想定の年の起きる月: 計算基準年は計算基準月、ほかはその年の1月（必要保障額の推移と同じ決め方） */
export function occursMonth(req: EngineRequest, year: number): string {
  const base = req.input.baseMonth;
  return year <= parseYm(base).y ? base : `${year}-01`;
}

/** 想定の年の既定（計算基準年の翌年） */
export function defaultYear(req: EngineRequest): number {
  return parseYm(req.input.baseMonth).y + 1;
}

/** 遺族の側の前提のうち、値の入っているものだけ（空の入れ物を渡さない） */
export function survivorOf(s: SurvivorAssumptions): SurvivorAssumptions | undefined {
  const out: SurvivorAssumptions = {};
  if (s.livingRatio !== undefined && Object.keys(s.livingRatio).length > 0) out.livingRatio = { ...s.livingRatio };
  if (s.independenceAge !== undefined) out.independenceAge = s.independenceAge;
  if (s.funeral !== undefined) out.funeral = s.funeral;
  if (s.reserveMonths !== undefined) out.reserveMonths = s.reserveMonths;
  if (s.deathBenefits !== undefined && Object.keys(s.deathBenefits).length > 0) out.deathBenefits = { ...s.deathBenefits };
  return Object.keys(out).length > 0 ? out : undefined;
}

/** 必要保障額の推移の要求（構成員1人。枠を分けて本体で同時に計算する） */
export function protectionRequest(wh: WorkingHousehold, memberId: string): EngineRequest {
  const req = baseRequest(wh.request);
  const p: ProtectionRequest = { members: [memberId], method: "accumulation" };
  const s = survivorOf(wh.contingency.survivor);
  if (s !== undefined) p.survivor = s;
  if (wh.contingency.horizon !== undefined) p.horizon = { ...wh.contingency.horizon };
  const pr = wh.contingency.protection;
  if (pr?.method === "reverse") {
    p.method = "reverse";
    if (pr.reverseUntilAge !== undefined) p.reverseUntilAge = pr.reverseUntilAge;
  }
  req.input.protection = p;
  return req;
}

const SALARIED = new Set(["regular", "contract", "partTime"]);

/**
 * 残された人の働き方の変化を、働き方の期間にする（万一の想定の survivor.spouseWork）。
 * scene を渡すと、就業不能・収入が減るの場面の配偶者の働き方（入力の workChanges。0085）: いつから・いつまでの決まりは同じで、
 * 配偶者は亡くなっていないので、パートは働き方の目安のまま（扶養に入れるかは今の入力の決まりのまま）
 */
export function survivorWorkPeriod(h: Household, survivor: Member, w: SurvivorWork | undefined, deathMonth: string, scene?: PartnerScene): EmploymentPeriod | null {
  if (w === undefined || w.type === undefined || w.type === "keep") return null;
  // 変える時期: 時点（人の年齢・出来事から）があればその月（亡くなった月より前なら亡くなった月）、無ければ亡くなった月の○か月後
  const at = w.from !== undefined ? resolveTimepoint(h, w.from) : null;
  const from = at !== null ? (at < deathMonth ? deathMonth : at) : addMonths(deathMonth, w.afterMonths ?? 6);
  const id = derivedId(survivor.id, scene === undefined ? "survivorWork" : `partnerWork:${scene}`);
  if (w.type === "none") return { id, member: survivor.id, from: { at: from }, to: null, type: "unemployed" };
  const last = addMonths(ageReachedMonth(survivor, w.untilAge ?? 65), -1);
  if (last < from) return null;
  const p = convertPeriod({ id, member: survivor.id, from: { at: from }, to: { at: last }, type: "regular" }, w.type, survivor, from);
  if (SALARIED.has(w.type)) {
    // 配偶者が亡くなった後は扶養に入れないので、パートは国民健康保険・国民年金にする
    if (w.type === "partTime" && scene === undefined) {
      p.healthInsurance = { kind: "national" };
      p.pensionCategory = "none";
    }
    if (w.annualSalary !== undefined && p.salary !== undefined) {
      p.salary = { ...p.salary, annual: confirmedBox(w.annualSalary), bonus: confirmedBox(0) };
      if (w.type !== "partTime") p.standardMonthlyRemuneration = smrEstimate(w.annualSalary, from);
    }
    if (w.type === "partTime") delete p.standardMonthlyRemuneration;
  } else if (w.type === "selfEmployed" && w.annualSalary !== undefined) p.business = { income: confirmedBox(w.annualSalary) };
  return p;
}

/** 配偶者の働き方を置き換えられる場面の配偶者（就業不能は想定の人の配偶者、収入が減るは本人の配偶者。いなければ undefined。0085） */
export function partnerOf(h: Household, sc: Pick<Scenario, "member">): Member | undefined {
  return adults(h).find((a) => a.member.id === sc.member)?.spouse;
}

/** 就業不能・収入が減るの場面の配偶者の働き方を、要求の働き方の置き換え（workChanges）に足す（0085。起きた月からの決まりは死亡と同じ） */
function addPartnerWork(req: EngineRequest, plan: ContingencyPlan, sc: Scenario, scene: PartnerScene, occurs: string): void {
  const h = req.input.household;
  const p = partnerOf(h, sc);
  if (p === undefined) return;
  const period = survivorWorkPeriod(h, p, plan.partnerWork?.[scene]?.[p.id], occurs, scene);
  if (period !== null) req.input.workChanges = [...(req.input.workChanges ?? []), period];
}

/** グラフの枠の名前（見るプランごとに分ける。例: current|none・<プランの ID>|prot:0） */
export const planSlot = (plan: string, name: string): string => `${plan}|${name}`;

/** グラフの枠の要求（万一なし・必要保障額の推移（大人ごと）・選んだ想定）。wh はそのプランの要求を入れた世帯 */
export function chartRequests(wh: WorkingHousehold, plan: string, protMembers: readonly string[], sc: Scenario | undefined, year: number): Record<string, EngineRequest> {
  const r: Record<string, EngineRequest> = { [planSlot(plan, "none")]: baseRequest(wh.request) };
  protMembers.forEach((m, i) => (r[planSlot(plan, `prot:${i}`)] = protectionRequest(wh, m)));
  if (sc !== undefined) {
    const req = scenarioRequest(wh, sc, year);
    // 死亡の想定の結果に、相続税の目安を1行だけ出す（表示だけで、お金の流れには入れない。0039）
    // 世帯に保存した相続税の目安の設定（不動産の評価の割合・FP が入れた額など。0060）はそのまま使う
    if (sc.kind === "death") req.input.inheritanceTax = { ...storedSettings(wh.request), points: ["contingency"] };
    r[planSlot(plan, "sc")] = req;
  }
  return r;
}

/** 残すグラフの枠: 今のプランの枠と、最近見たプラン（recent。今のプランを含む）のすでにある枠 */
export function keptSlots(existing: readonly string[], requests: Readonly<Record<string, EngineRequest>>, recent: readonly string[]): string[] {
  const keep = new Set(recent);
  return [...Object.keys(requests), ...existing.filter((id) => !Object.hasOwn(requests, id) && keep.has(id.slice(0, id.indexOf("|"))))];
}

/**
 * 相場の下落を要求に重ねる（0026・0071）: その年の年末に、下げる資産（資産の種類は器の配分のうちその割合、配分を入れていない運用の器は
 * 全体）をその幅だけ下げる。持株会・外貨預金は器ごと下げる。下がった後の戻り方があれば、翌年から○年は運用の利回りを○%までに抑える
 */
export function addMarketDrop(req: EngineRequest, plan: ContingencyPlan, year: number): void {
  const a = (req.input.assumptions ??= { investmentReturn: { default: "0.01" } });
  const m = plan.market ?? {};
  const drop = m.drop ?? MARKET_DROP_DEFAULT;
  const picked = m.classes ?? MARKET_CLASSES_DEFAULT;
  const classes = picked.filter((c) => !c.startsWith("kind:"));
  const shocks: NonNullable<typeof a.marketShocks> = [];
  // 配分を入れた器は資産の種類の割合で、配分の無い運用の器は全体で（持株会は選んだときだけ）
  if (classes.length > 0) shocks.push({ year, drop, assetClasses: classes, ...(picked.includes(ESOP) ? {} : { kinds: INVEST_BUT_ESOP }) });
  else if (picked.includes(ESOP)) shocks.push({ year, drop, kinds: ["esop"] });
  if (picked.includes(FX_DEPOSIT)) shocks.push({ year, drop, kinds: ["fxDeposit"] });
  if (shocks.length > 0) a.marketShocks = [...(a.marketShocks ?? []), ...shocks];
  if (m.recoveryYears !== undefined && m.recoveryYears > 0 && m.recoveryCap !== undefined) a.returnShifts = [...(a.returnShifts ?? []), { from: year + 1, to: year + m.recoveryYears, cap: m.recoveryCap }];
}

/** 収入の減少を要求に重ねる（構成員の給与・事業所得を from から months か月、ratio の割合だけ減らす） */
function addIncomeShock(req: EngineRequest, member: string, from: string, months: number, ratio: string): void {
  if (months <= 0) return;
  const a = (req.input.assumptions ??= { investmentReturn: { default: "0.01" } });
  a.incomeShocks = [...(a.incomeShocks ?? []), { member, from, to: addMonths(from, months - 1), ratio }];
}

/** 割合の引き算（"1" − "0.7" → "0.3"。千分の一で丸める） */
const restOf = (r: string): string => String(Math.round((1 - Number(r)) * 1000) / 1000);

/** 選んだ想定の要求（現状に万一の想定を重ねる） */
export function scenarioRequest(wh: WorkingHousehold, sc: Scenario, year: number): EngineRequest {
  const req = baseRequest(wh.request);
  const h = req.input.household;
  const plan = wh.contingency;
  const occurs = occursMonth(req, year);
  if (sc.kind === "market") {
    // 相場が下がったとき: その年の年末に、下げる資産をその幅だけ下げる（0026・0071）
    addMarketDrop(req, plan, year);
    return req;
  }
  // 相場の下落も重ねる（死亡・就業不能・大きな病気・収入が減る。ストレスの層の後に万一の層。0071）
  if (plan.stackMarket === true && hasInvested(h)) addMarketDrop(req, plan, year);
  if (sc.kind === "income") {
    // 収入が減るとき: 起きた月から○年、その人の給与・事業所得を○割減らす（決まった休業とは別の、試しに見る悪い場合。0071）
    const d = { ...INCOME_DROP_DEFAULT, ...(plan.incomeDrop ?? {}) };
    for (const m of incomeMembers(wh, plan)) addIncomeShock(req, m.id, occurs, d.years * 12, d.ratio);
    addPartnerWork(req, plan, sc, "income", occurs);
    return req;
  }
  if (sc.kind === "illness") {
    // 大きな病気のとき: その月から働けない（会社員は休業して傷病手当金）、決めた月数の後に元の働き方に戻る。医療費は高額療養費で止める。
    // 病気の想定（病気の種類・入院の日数・手術の回数）で、保険の医療・がんの給付を受け取る（0054・0055）
    // 復帰の後の働き方（○か月は収入を○割に）があれば、戻った月から収入を減らす（0071）
    const il = { ...ILLNESS_DEFAULT, ...(plan.illness ?? {}) };
    const back = addMonths(occurs, il.months);
    req.input.contingencies = [
      {
        id: derivedId(sc.member, "contingency:illness"),
        kind: "incapacity",
        member: sc.member,
        occurs: { at: occurs },
        recovery: { at: back },
        medical: { monthly: il.medicalMonthly, months: il.medicalMonths },
        illness: illnessOf(plan.illness),
      },
    ];
    if (il.afterMonths !== undefined && il.afterRatio !== undefined && Number(il.afterRatio) < 1) addIncomeShock(req, sc.member, back, il.afterMonths, restOf(il.afterRatio));
    return req;
  }
  const c: Contingency = { id: derivedId(sc.member, `contingency:${sc.kind}`), kind: sc.kind, member: sc.member, occurs: { at: occurs } };
  if (sc.kind === "death") {
    const s = survivorOf(plan.survivor) ?? {};
    const spouse = adults(h).find((a) => a.member.id === sc.member)?.spouse;
    const work = spouse !== undefined ? survivorWorkPeriod(h, spouse, plan.work[spouse.id], occurs) : null;
    const survivor = { ...s, ...(work !== null ? { spouseWork: [work] } : {}) };
    if (Object.keys(survivor).length > 0) c.survivor = survivor;
  } else {
    const grade = plan.grade ?? 2;
    if (grade === 0) c.kind = "incapacity";
    else c.grade = grade;
    const choice: OldAgeChoice | undefined = plan.oldAgeChoice[sc.member];
    if (choice !== undefined && grade !== 0) c.oldAgeChoice = choice;
    const md = plan.medical;
    if (md?.monthly !== undefined && md.monthly > 0) c.medical = { monthly: md.monthly, months: md.months ?? 12 };
    addPartnerWork(req, plan, sc, "disability", occurs);
  }
  req.input.contingencies = [c];
  return req;
}
