// 公的年金の部品で共通に使う判定（老齢年金の受給の始まり・遺族年金の受給権・障害の想定の法定免除の期間）。
// 同じ決まりを複数の部品に書き写さないため（受給権の判定が部品ごとにずれると、片方だけ直したときに結果が食い違う）。
// ここで読む制度の値は、使う部品のマニフェストの params に書く（下の *_PARAMS）
import type { MemberInput, PensionRecordInput, RelationInput } from "../engine/types.ts";
import type { Ctx, MonthCtx } from "../registry/ctx.ts";
import { addMonths, parseYm, type MonthIndex } from "../time/month.ts";
import type { ContingencyEvent, ContingencyEventOutput, RecordMonth, RecordOutput } from "./contracts.ts";
import { ageMonth, childrenOf, spousesAt } from "./helpers.ts";

/** 特別支給の老齢厚生年金の開始の判定で読む値 */
export const SPECIAL_OLD_AGE_PARAMS = {
  specialAge: "pension.specialOldAge.startAge",
  specialMonths: "pension.specialOldAge.requiredMonths",
} as const;

/** 記録の厚生年金の月数（初めの値＋記録の後の月のうち before より前）。before が null なら全部 */
export function recordEmployeeMonths(rec: RecordOutput, before: MonthIndex | null): number {
  let n = rec.employeeMonths;
  for (const x of rec.months) if (x.employee && (before === null || parseYm(x.month) < before)) n++;
  return n;
}

/**
 * 特別支給の老齢厚生年金の受給権を得て支給が始まる月（生年月日・性別の開始年齢。厚生年金の1年以上。対象でなければ null）。
 * 受給中・見込額だけの記録は求めない（記録に特別支給の額があれば65歳の12か月前とみなす）
 */
export function specialOldAgeStart(ctx: Ctx, at0: MonthCtx, rec: RecordOutput, member: string, N: MonthIndex): MonthIndex | null {
  const receiving = rec.kind === "receiving";
  let SA: MonthIndex | null = null;
  if (!receiving && rec.kind !== "projection") {
    const years = at0.paramCount(SPECIAL_OLD_AGE_PARAMS.specialAge, { member });
    const qual = (at0.paramCount(SPECIAL_OLD_AGE_PARAMS.specialMonths) ?? 12) <= recordEmployeeMonths(rec, N);
    if (years !== null && qual) {
      const sel = at0.param(SPECIAL_OLD_AGE_PARAMS.specialAge, { member });
      SA = ctx.time.ageSwitch(member, { years }, (sel.def.ageSwitch ?? "monthAfterReach") as never);
    }
  }
  if (rec.amounts.special !== null && SA === null && !receiving) SA = addMonths(N, -12);
  return SA;
}

/**
 * 老齢基礎年金・老齢厚生年金の受給を始める月（入力の claim。省略は65歳に達した月の翌月 N）。
 * 繰上げは老齢基礎年金と老齢厚生年金を同時に請求する（国民年金法附則9条の2第2項・厚生年金保険法附則7条の3第2項）ので、
 * どちらかを N より前にしたときは、早い方の月に両方をそろえる（aligned）。特別支給の老齢厚生年金を受ける世代（SA がある）の一部繰上げは扱わず、そろえない。
 * 厚生年金の加入が無い人はそろえない。繰下げは別々にできる（そろえない）。受給中の記録（すでに受け始めている）は呼ぶ側で扱う
 */
export function oldAgeClaimMonths(
  ctx: Ctx,
  rec: RecordOutput,
  input: PensionRecordInput | undefined,
  N: MonthIndex,
  SA: MonthIndex | null,
): { basic: MonthIndex; employee: MonthIndex; aligned: boolean } {
  const basic = input?.claim?.basic !== undefined ? ctx.time.resolve(input.claim.basic) : N;
  const employee = input?.claim?.employee !== undefined ? ctx.time.resolve(input.claim.employee) : N;
  const early = basic < employee ? basic : employee;
  // 厚生年金の加入が無い人は老齢基礎年金だけなので、そろえない
  const hasEmployee = rec.amounts.employee !== null || recordEmployeeMonths(rec, null) > 0;
  if (hasEmployee && SA === null && early < N && basic !== employee) return { basic: early, employee: early, aligned: true };
  return { basic, employee, aligned: false };
}

/**
 * 障害の想定で、障害基礎年金（1・2級）を受ける月の法定免除の期間（障害認定日の翌月から、働けるようになる月の前まで。国民年金法89条1項1号）。
 * 第1号被保険者の保険料を納めない月で、老齢基礎年金の額では全額免除の月として数える（27条。2009年4月以後は2分の1）
 */
export function legalExemptionWindow(ev: ContingencyEvent | null): { from: MonthIndex; to: MonthIndex | null } | null {
  if (ev === null || ev.kind !== "disability" || ev.grade === undefined || ev.grade > 2 || ev.recognition === undefined) return null;
  return { from: addMonths(parseYm(ev.recognition), 1), to: ev.recovery === undefined ? null : parseYm(ev.recovery) };
}

/** 遺族年金の受給権の判定で読む値 */
export const SURVIVOR_BASIS_PARAMS = {
  childAge: "pension.childSupplement.childUntilAge",
  start: "pension.normalStartAge",
  qual: "pension.survivor.longTermMonths",
  youngAge: "pension.survivor.youngWidowAge",
  youngMonths: "pension.survivor.youngWidowMonths",
  husbandAge: "pension.survivor.husbandMinAge",
  husbandFrom: "pension.survivor.husbandPayFromAge",
} as const;

/**
 * 遺族年金の基になる死亡: 亡くなった構成員（Y の配偶者か親）と死亡の月。万一の想定（contingency.event）か、入力の death（必要保障額の推移で
 * 「この月に亡くなったら」を試すとき）で決める。無ければ null
 */
export function survivorDeath(
  ctx: Ctx,
  Y: string,
  members: readonly MemberInput[],
  relations: readonly RelationInput[],
  death?: { readonly member: string; readonly month: string },
): { deceased: string; death: MonthIndex } | null {
  if (death !== undefined) return { deceased: death.member, death: parseYm(death.month) };
  const candidates = [
    ...relations.flatMap((r) => (r.type === "spouse" && (r.a === Y || r.b === Y) ? [(r.a === Y ? r.b : r.a) as string] : [])),
    ...relations.flatMap((r) => (r.type === "parentOf" && r.child === Y ? [r.parent as string] : [])),
  ];
  // 関係に親が無いときは、子（kind child）から見た本人・配偶者
  const me0 = members.find((m) => m.id === Y);
  if (me0?.kind === "child" && !relations.some((r) => r.type === "parentOf")) for (const m of members) if (m.kind === "self" || m.kind === "spouse") candidates.push(m.id);
  for (const c of [...new Set(candidates)]) {
    const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: c }).event;
    if (ev !== null && ev.kind === "death") return { deceased: c, death: parseYm(ev.month) };
  }
  return null;
}

/** 遺族年金を受ける人（Y）・亡くなった人の記録から決まる、受給権の要件と期間 */
export interface SurvivorBasis {
  readonly deceased: string;
  readonly death: MonthIndex;
  readonly me: MemberInput;
  readonly isSpouse: boolean;
  readonly isChild: boolean;
  /** 亡くなった人の子（死亡の当時の胎児を含む） */
  readonly kidsAll: readonly MemberInput[];
  /** 子ごとの、18歳に達した後の最初の3月31日の月 */
  readonly childUntil: ReadonlyMap<string, MonthIndex>;
  /** 年齢の判定の基準の月（死亡の月。計算基準月より前なら計算基準月） */
  readonly m0: MonthIndex;
  readonly rec: RecordOutput;
  /** 亡くなった人の記録の後の月のうち、死亡の月まで */
  readonly recMonths: readonly RecordMonth[];
  readonly empMonths: number;
  /** 短期要件（死亡の月に厚生年金に入っていた） */
  readonly shortTerm: boolean;
  /** 受給資格期間25年以上 */
  readonly longOk: boolean;
  /** 遺族厚生年金の、亡くなった人の側の要件 */
  readonly employeeOk: boolean;
  /** 遺族基礎年金の、亡くなった人の側の要件 */
  readonly basicOk: boolean;
  /** 死亡の月の翌月に対象の子がいるか */
  readonly kidsAtDeath: boolean;
  /** 最後の子が対象でなくなる月（子が無ければ死亡の月） */
  readonly lastKid: MonthIndex;
  /** 配偶者に遺族厚生年金を払い始める月と、終わる月（30歳未満で子の無い妻の5年。無ければ null） */
  readonly empFrom: MonthIndex;
  readonly empUntil: MonthIndex | null;
  /** 配偶者が遺族厚生年金の受給権を得るか（夫は死亡の当時55歳以上） */
  readonly spouseEmployeeRight: boolean;
}

/**
 * 遺族年金の受給権の判定（pension.survivor と pension.survivorRight で共通）。Y が受け取る人でなければ null。
 * - 子だけが受け取るのは、死亡の当時に配偶者がいないとき。受け取る子は、受けられる子のうち最も年上の子
 * - 遺族厚生年金: 短期要件（死亡の月に厚生年金に入っていた）か長期要件（受給資格期間25年以上）。妻は年齢を問わない（死亡の当時30歳未満で子が無ければ5年）。
 *   夫は死亡の当時55歳以上で、60歳から
 * - 遺族基礎年金: 65歳になる前の死亡か、受給資格期間25年以上
 */
export function survivorBasis(
  ctx: Ctx,
  Y: string,
  d: { readonly deceased: string; readonly death: MonthIndex },
  members: readonly MemberInput[],
  relations: readonly RelationInput[],
): SurvivorBasis | null {
  const P = SURVIVOR_BASIS_PARAMS;
  const { base, end } = ctx.time;
  const { deceased, death } = d;
  const me = members.find((m) => m.id === Y);
  const dm = members.find((m) => m.id === deceased);
  if (me === undefined || dm === undefined) return null;
  const isSpouse = spousesAt(ctx, relations, deceased, death).includes(Y);
  const kidsAll = childrenOf(members, relations, deceased).filter((c) => parseYm(c.birth.birthYearMonth) <= addMonths(death, 10));
  const isChild = kidsAll.some((c) => c.id === Y);
  if (!isSpouse && !isChild) return null;
  const hasSpouse = spousesAt(ctx, relations, deceased, death).length > 0;
  if (isChild && hasSpouse) return null;
  const m0 = death < base ? base : death;
  const at0 = ctx.at(m0);
  const childUntil = new Map(kidsAll.map((c) => [c.id, ageMonth(ctx, m0, P.childAge, c.id)]));
  if (isChild) {
    const eldest = [...kidsAll].filter((c) => (childUntil.get(c.id) as MonthIndex) > death).sort((a, b) => (a.birth.birthYearMonth < b.birth.birthYearMonth ? -1 : 1))[0];
    if (eldest === undefined || eldest.id !== Y) return null;
  }
  const rec = ctx.call<RecordOutput>("pension.record", { member: deceased });
  const recMonths = rec.months.filter((x) => parseYm(x.month) <= death);
  const futureCount = rec.months.filter((x) => x.basic || x.employee).length;
  const qualifying = rec.qualifyingMonths - futureCount + recMonths.filter((x) => x.basic || x.employee).length;
  const empMonths = rec.employeeMonths + recMonths.filter((x) => x.employee).length;
  const shortTerm = recMonths.some((x) => parseYm(x.month) === death && x.employee);
  const longOk = qualifying >= (at0.paramCount(P.qual) ?? 300);
  const employeeOk = empMonths > 0 && (shortTerm || longOk);
  const basicOk = longOk || death < ageMonth(ctx, m0, P.start, deceased);
  const kidsAt = (m: MonthIndex) => kidsAll.filter((c) => parseYm(c.birth.birthYearMonth) <= m && m <= (childUntil.get(c.id) as MonthIndex));
  const kidsAtDeath = kidsAt(addMonths(death, 1)).length > 0;
  const lastKid = kidsAll.length === 0 ? death : kidsAll.reduce((mx, c) => ((childUntil.get(c.id) as MonthIndex) > mx ? (childUntil.get(c.id) as MonthIndex) : mx), death);
  const ageAt = (id: string, years: string) => ageMonth(ctx, m0, years, id);
  const female = me.sex === "female";
  let empFrom: MonthIndex = addMonths(death, 1);
  let empUntil: MonthIndex | null = null;
  let spouseEmployeeRight = isSpouse && employeeOk;
  if (isSpouse && employeeOk) {
    if (female) {
      if (!kidsAtDeath && death < ageAt(Y, P.youngAge)) empUntil = addMonths(death, at0.paramCount(P.youngMonths) ?? 60);
    } else if (death < ageAt(Y, P.husbandAge)) {
      empFrom = addMonths(end, 1);
      spouseEmployeeRight = false;
    } else {
      const from60 = ageAt(Y, P.husbandFrom);
      if (from60 > empFrom) empFrom = from60;
    }
  }
  return {
    deceased,
    death,
    me,
    isSpouse,
    isChild,
    kidsAll,
    childUntil,
    m0,
    rec,
    recMonths,
    empMonths,
    shortTerm,
    longOk,
    employeeOk,
    basicOk,
    kidsAtDeath,
    lastKid,
    empFrom,
    empUntil,
    spouseEmployeeRight,
  };
}
