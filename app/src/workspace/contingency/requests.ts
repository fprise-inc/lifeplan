// 万一の画面の要求を作る（作業の層）: 万一なし（現状）・必要保障額の推移（構成員ごと）・選んだ想定（死亡・障害）。
// どれも現状の世帯（入力の値）に「層」を重ねる形で、世帯（現状）は変えない（0008 の5・7）
import type { Contingency, EmploymentPeriod, EngineRequest, Household, Illness, Member, OldAgeChoice, ProtectionRequest, SurvivorAssumptions } from "../../engine/types.ts";
import { confirmedBox, type WorkingHousehold } from "../input/household.ts";
import { smrEstimate } from "../input/estimates.ts";
import { convertPeriod } from "../input/stages/work.ts";
import { addMonths, ageReachedMonth, derivedId, parseYm } from "../levers.ts";
import { roles } from "../roles.ts";
import type { SurvivorWork } from "./planData.ts";

export type ScenarioKind = "death" | "disability" | "illness" | "market";

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
  // 0026: 大きな病気のとき（本人）・相場が下がったとき（運用する口座があるとき）
  const self = list.find((a) => a.member.kind === "self") ?? list[0];
  if (self !== undefined) {
    const who = label.get(self.member.id) ?? "ご本人";
    out.push({ key: "illness:self", kind: "illness", member: self.member.id, label: `大きな病気（${who}）`, who });
    if ((h.accounts ?? []).some((x) => INVESTED.has(x.kind))) out.push({ key: "market", kind: "market", member: self.member.id, label: "相場の下落", who });
  }
  return out;
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
  req.input.protection = p;
  return req;
}

const SALARIED = new Set(["regular", "contract", "partTime"]);

/** 残された人の働き方の変化を、働き方の期間にする（万一の想定の survivor.spouseWork） */
export function survivorWorkPeriod(h: Household, survivor: Member, w: SurvivorWork | undefined, deathMonth: string): EmploymentPeriod | null {
  if (w === undefined || w.type === undefined || w.type === "keep") return null;
  const from = addMonths(deathMonth, w.afterMonths ?? 6);
  const id = derivedId(survivor.id, "survivorWork");
  if (w.type === "none") return { id, member: survivor.id, from: { at: from }, to: null, type: "unemployed" };
  const last = addMonths(ageReachedMonth(survivor, w.untilAge ?? 65), -1);
  if (last < from) return null;
  const p = convertPeriod({ id, member: survivor.id, from: { at: from }, to: { at: last }, type: "regular" }, w.type, survivor, from);
  if (SALARIED.has(w.type)) {
    // 配偶者が亡くなった後は扶養に入れないので、パートは国民健康保険・国民年金にする
    if (w.type === "partTime") {
      p.healthInsurance = { kind: "national" };
      p.pensionCategory = "none";
    }
    if (w.annualSalary !== undefined && p.salary !== undefined) {
      p.salary = { ...p.salary, annual: confirmedBox(w.annualSalary), bonus: confirmedBox(0) };
      if (w.type !== "partTime") p.standardMonthlyRemuneration = smrEstimate(w.annualSalary, from);
    }
    if (w.type === "partTime") delete p.standardMonthlyRemuneration;
  } else if (w.type === "selfEmployed" && w.annualSalary !== undefined) p.business = { income: confirmedBox(w.annualSalary) };
  void h;
  return p;
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

/** 選んだ想定の要求（現状に万一の想定を重ねる） */
export function scenarioRequest(wh: WorkingHousehold, sc: Scenario, year: number): EngineRequest {
  const req = baseRequest(wh.request);
  const h = req.input.household;
  const plan = wh.contingency;
  const occurs = occursMonth(req, year);
  if (sc.kind === "market") {
    // 相場が下がったとき: その年の年末に、株・REIT の部分をその幅だけ下げる（ストレステストの型。0026）
    req.input.stressTest = { template: "marketDropAtRetirement", params: { year, drop: plan.market?.drop ?? MARKET_DROP_DEFAULT, assetClasses: [...RISKY] } };
    return req;
  }
  if (sc.kind === "illness") {
    // 大きな病気のとき: その月から働けない（会社員は休業して傷病手当金）、決めた月数の後に元の働き方に戻る。医療費は高額療養費で止める。
    // 病気の想定（病気の種類・入院の日数・手術の回数）で、保険の医療・がんの給付を受け取る（0054・0055）
    const il = { ...ILLNESS_DEFAULT, ...(plan.illness ?? {}) };
    req.input.contingencies = [
      {
        id: derivedId(sc.member, "contingency:illness"),
        kind: "incapacity",
        member: sc.member,
        occurs: { at: occurs },
        recovery: { at: addMonths(occurs, il.months) },
        medical: { monthly: il.medicalMonthly, months: il.medicalMonths },
        illness: illnessOf(plan.illness),
      },
    ];
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
  }
  req.input.contingencies = [c];
  return req;
}
