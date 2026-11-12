// 打ち手（主画面の右のスライダー）を世帯の入力に当てはめる。
// いまは「現状の世帯に打ち手を当てた要求」を直接作る。0008 の5 のプランの層（提案＝差分の列）ができたら、
// ここは「打ち手 → 差分」を作る部品に置き換える（作る差分の中身はここと同じ）。
import type { EmploymentPeriod, EngineRequest, Household, Member, Timepoint } from "../engine/types.ts";
import { group } from "../presentation/format.ts";
import { resolveTimepoint } from "./timepoint.ts";

export interface LeverValues {
  /** 働く最後の年齢（この年齢に達する月の前月まで働く） */
  retireAge: number;
  /** 公的年金の受け取りを始める年齢（基礎・厚生とも） */
  pensionAge: number;
  /** NISA の毎月の積立額（円） */
  nisaMonthly: number;
  /** 毎月の生活費（円） */
  livingMonthly: number;
}

export type LeverKey = keyof LeverValues;
export const LEVER_KEYS: readonly LeverKey[] = ["retireAge", "pensionAge", "nisaMonthly", "livingMonthly"];

/** 定年の後に働き続けるときの働き方（再雇用など）。世帯ごとに決める（入力画面ができるまでは見本の世帯の設定） */
export interface Reemployment {
  /** この年齢から（例: 60歳の誕生月から） */
  fromAge: number;
  type: string;
  annualSalary: number;
  standardMonthlyRemuneration?: number;
}

export const ym = (y: number, m: number): string => `${y}-${String(m).padStart(2, "0")}`;

export function parseYm(s: string): { y: number; m: number } {
  const [y, m] = s.split("-").map(Number) as [number, number];
  return { y, m };
}

export function addMonths(s: string, n: number): string {
  const { y, m } = parseYm(s);
  const i = y * 12 + (m - 1) + n;
  return ym(Math.floor(i / 12), (i % 12) + 1);
}

/** その年齢に達する月（法律の「年齢に達した日」は誕生日の前日なので、1日生まれは前の月） */
export function ageReachedMonth(member: Member, age: number): string {
  const { y, m } = parseYm(member.birth.birthYearMonth);
  return addMonths(ym(y + age, m), member.birth.bornOnFirst ? -1 : 0);
}

/** 月の時点の比較用（"YYYY-MM" は文字列のまま比較できる）。年齢・出来事で決めた時点も年月に解く */
function atOf(h: Household, t: Timepoint | null | undefined): string | null {
  return resolveTimepoint(h, t);
}

/** 年齢（その月の時点の満年齢） */
export function ageAt(member: Member, month: string): number {
  let age = parseYm(month).y - parseYm(member.birth.birthYearMonth).y;
  if (ageReachedMonth(member, age) > month) age--;
  else if (ageReachedMonth(member, age + 1) <= month) age++;
  return age;
}

export function memberOf(req: EngineRequest, id: string): Member {
  const m = req.input.household.members.find((x) => x.id === id);
  if (m === undefined) throw new Error("E_MEMBER_UNKNOWN");
  return m;
}

/** 世帯の今の打ち手の値（現状）。分からない打ち手は undefined */
export function readLevers(req: EngineRequest, memberId: string): Partial<LeverValues> {
  const h = req.input.household;
  const member = memberOf(req, memberId);
  const out: Partial<LeverValues> = {};
  const ends = (h.employmentPeriods ?? []).filter((e) => e.member === memberId).map((e) => atOf(h, e.to)).filter((x): x is string => x !== null).sort();
  const lastEnd = ends.at(-1);
  if (lastEnd !== undefined) out.retireAge = ageAt(member, addMonths(lastEnd, 1));
  const rec = (h.pensionRecords ?? []).find((r) => r.member === memberId);
  // 記録が無い人（推計の区分）は構成員の受け取り開始（0078）
  const claim = atOf(h, rec !== undefined ? rec.claim?.basic : member.pensionClaim?.basic);
  out.pensionAge = claim === null ? 65 : ageAt(member, addMonths(claim, -1));
  const nisa = (h.accounts ?? []).find((a) => a.kind === "nisa" && a.owner === memberId);
  if (nisa !== undefined) out.nisaMonthly = (nisa.contributions ?? []).filter((c) => c.tranche !== "growth").sort((x, y) => ((atOf(h, x.from) ?? "") < (atOf(h, y.from) ?? "") ? -1 : 1))[0]?.monthly ?? 0;
  const living = (h.livingExpenses ?? []).find((l) => l.mode === "total");
  if (living?.monthly?.value != null) out.livingMonthly = living.monthly.value;
  return out;
}

/** 年金の受け取りの開始の月（その年齢に達した月の翌月。下の applyLevers と同じ決まり） */
export const pensionClaimMonth = (member: Member, age: number): string => addMonths(ageReachedMonth(member, age), 1);

/**
 * もう老齢年金を受け取り始めているか: 受給中の記録（計算エンジンは受け取りの開始を読まない）があるか、基礎・厚生のどちらかの
 * 受け取りの開始が計算基準月より前（記録・構成員の受け取り開始に無い方は、計算エンジンと同じく65歳に達した月の翌月）
 */
export function pensionStarted(req: EngineRequest, memberId: string): boolean {
  const h = req.input.household;
  const member = memberOf(req, memberId);
  const recs = (h.pensionRecords ?? []).filter((r) => r.member === memberId);
  if (recs.some((r) => r.kind === "receiving")) return true;
  const normal = pensionClaimMonth(member, 65);
  const claims = recs.length > 0 ? recs.map((r) => r.claim) : [member.pensionClaim];
  return claims.some((c) => [c?.basic, c?.employee].some((t) => (atOf(h, t) ?? normal) < req.input.baseMonth));
}

/** どの打ち手がこの世帯で使えるか（読めた打ち手だけ） */
export function availableLevers(req: EngineRequest, memberId: string): Set<LeverKey> {
  return new Set(Object.keys(readLevers(req, memberId)) as LeverKey[]);
}

const box = <T,>(v: T) => ({ value: v, state: "confirmed", origin: { kind: "manual" } });

/** 新しい ID（UUID 第4版の形。0004）。打ち手で足す働き方の期間に使う。決まった値から作る（同じ打ち手なら同じ要求にする） */
export function derivedId(base: string, salt: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const ch of base + "|" + salt) {
    h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ ch.charCodeAt(0), 2246822519) >>> 0;
  }
  // h1 ^ h2 は符号つきの32ビットになるので、符号なしにしてから16進にする（負の数の「-」が ID に入らないように）
  const hex = (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + ((h1 ^ h2) >>> 0).toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** 現状の世帯に打ち手を当てた要求を作る（元の要求は変えない） */
export function applyLevers(base: EngineRequest, memberId: string, values: Partial<LeverValues>, opts: { reemployment?: Reemployment } = {}): EngineRequest {
  const req = structuredClone(base);
  const h = req.input.household;
  const member = memberOf(req, memberId);
  const current = readLevers(base, memberId);

  if (values.retireAge !== undefined && values.retireAge !== current.retireAge) {
    const lastMonth = addMonths(ageReachedMonth(member, values.retireAge), -1);
    // 積立の終わりが退職の月だった積立だけ、新しい退職の月に合わせる（空の終わりは、エンジンが退職の月まで積み立てる。0026）
    const oldEnd = current.retireAge !== undefined ? addMonths(ageReachedMonth(member, current.retireAge), -1) : null;
    retireAt(req, memberId, lastMonth, ageReachedMonth(member, values.retireAge), oldEnd, opts);
  }

  if (values.pensionAge !== undefined && values.pensionAge !== current.pensionAge) {
    // 受け取りの開始は、その年齢に達した月の翌月（0003・年金の制度の決まり）
    const claim: Timepoint = { at: addMonths(ageReachedMonth(member, values.pensionAge), 1) };
    const recs = (h.pensionRecords ?? []).filter((r) => r.member === memberId);
    for (const r of recs) r.claim = { basic: claim, employee: claim };
    // 記録が無い人（推計の区分）は構成員の受け取り開始に書く（0078）
    if (recs.length === 0) member.pensionClaim = { basic: claim, employee: structuredClone(claim) };
  }
  return applyRest(req, memberId, values, current);
}

/**
 * 働く最後の月を、年齢の整数でない月にする（入力の画面の「働く最後」を年月で入れたとき。例: 60歳の年度末まで）。
 * 打ち手の「働く最後の年齢」と同じ決まりで働き方の期間を終え・足し、退職の段階の生活費は翌月から、積立の終わりは今の働く最後の月だったものを合わせる
 */
export function applyRetireMonth(base: EngineRequest, memberId: string, lastMonth: string, opts: { reemployment?: Reemployment } = {}): EngineRequest {
  const req = structuredClone(base);
  const h = req.input.household;
  const oldEnd = (h.employmentPeriods ?? []).filter((e) => e.member === memberId).map((e) => atOf(h, e.to)).filter((x): x is string => x !== null).sort().at(-1) ?? null;
  retireAt(req, memberId, lastMonth, addMonths(lastMonth, 1), oldEnd, opts);
  return req;
}

/** 働く最後の月で、働き方の期間・退職の段階の生活費（ご本人だけ）・NISA の積立の終わりを直す（req を書き換える） */
function retireAt(req: EngineRequest, memberId: string, lastMonth: string, stageAt: string, oldEnd: string | null, opts: { reemployment?: Reemployment }): void {
  const h = req.input.household;
  const mine = (h.employmentPeriods ?? []).filter((e) => e.member === memberId);
  const others = (h.employmentPeriods ?? []).filter((e) => e.member !== memberId);
  // その月より後に始まる期間は外し、またぐ期間はその月で終える
  const kept: EmploymentPeriod[] = [];
  for (const e of mine) {
    const from = atOf(h, e.from);
    if (from !== null && from > lastMonth) continue;
    const to = atOf(h, e.to);
    kept.push(to === null || to > lastMonth ? { ...e, to: { at: lastMonth } } : e);
  }
  const lastEnd = kept.map((e) => atOf(h, e.to)).filter((x): x is string => x !== null).sort().at(-1);
  if (lastEnd !== undefined && lastEnd < lastMonth) {
    const r = opts.reemployment;
    const tail = kept.find((e) => atOf(h, e.to) === lastEnd) as EmploymentPeriod;
    if (r !== undefined && r.type === "selfEmployed") {
      // 定年の後に自営業: 事業の所得で、その年齢まで（健康保険・年金の種類はエンジンが導く）
      kept.push({ id: derivedId(tail.id, "reemployment"), member: memberId, from: { at: addMonths(lastEnd, 1) }, to: { at: lastMonth }, type: "selfEmployed", business: { income: box(r.annualSalary) } });
    } else if (r !== undefined) {
      // 定年の後: 再雇用などの働き方で、その年齢まで
      const smr = r.standardMonthlyRemuneration;
      // 今の勤め先の期間の辞め方・失業の給付の欄と値の状態の行は写さない（定年後の期間は、画面がその期間の推定を入れ直す。0037）
      const { standardMonthlyRemuneration: _smr, corporatePension: _cp, business: _b, endsWith: _e, unemploymentClaim: _u, elderlyContinuationClaim: _c, valueStates: _v, ...rest } = tail;
      void [_smr, _cp, _b, _e, _u, _c, _v];
      kept.push({
        ...rest,
        id: derivedId(tail.id, "reemployment"),
        from: { at: addMonths(lastEnd, 1) },
        to: { at: lastMonth },
        type: r.type,
        healthInsurance: rest.healthInsurance ?? { kind: "kyokaikenpo" },
        pensionCategory: rest.pensionCategory ?? "employee1",
        employer: rest.employer ?? { size: 50, weeklyHours: "30" },
        salary: { annual: box(r.annualSalary), bonus: box(0) },
        ...(smr !== undefined ? { standardMonthlyRemuneration: { health: box(smr), pension: box(smr) } } : {}),
      });
    } else {
      kept[kept.indexOf(tail)] = { ...tail, to: { at: lastMonth } };
    }
  }
  h.employmentPeriods = [...others, ...kept];
  // 退職の段階の生活費は、ご本人の退職のときだけ合わせる（世帯の「退職後」の節目は本人の退職の月。0049）。NISA の積立の終わりは持ち主の分だけ
  if (h.members.find((m) => m.id === memberId)?.kind === "self") {
    for (const l of h.livingExpenses ?? []) {
      for (const s of l.stages ?? []) if (s.label === "retirement") s.at = { at: stageAt };
    }
  }
  for (const a of h.accounts ?? []) {
    if (a.kind !== "nisa" || a.owner !== memberId) continue;
    for (const c of a.contributions ?? []) if (c.to !== null && atOf(h, c.to) === oldEnd) c.to = { at: lastMonth };
  }
}

function applyRest(req: EngineRequest, memberId: string, values: Partial<LeverValues>, current: Partial<LeverValues>): EngineRequest {
  const h = req.input.household;
  if (values.nisaMonthly !== undefined && values.nisaMonthly !== current.nisaMonthly) {
    // 期間を分けた積立は、どの期間も同じだけ増減する（0026）。積立が無ければ今から（終わりは空＝退職の年まで）
    const delta = values.nisaMonthly - (current.nisaMonthly ?? 0);
    for (const a of h.accounts ?? []) {
      if (a.kind !== "nisa" || a.owner !== memberId) continue;
      const own = (a.contributions ?? []).filter((c) => c.tranche !== "growth");
      if (own.length === 0) {
        if (values.nisaMonthly > 0) a.contributions = [...(a.contributions ?? []), { from: { at: req.input.baseMonth }, to: null, monthly: values.nisaMonthly }];
        continue;
      }
      for (const c of own) c.monthly = Math.max(0, c.monthly + delta);
    }
  }

  if (values.livingMonthly !== undefined && values.livingMonthly !== current.livingMonthly) {
    const l = (h.livingExpenses ?? []).find((x) => x.mode === "total");
    if (l !== undefined) l.monthly = box(values.livingMonthly);
  }
  return req;
}

/** FP顧問料の契約があるか（主画面の対策「FP顧問料」を出すか） */
export function hasAdvisoryFee(req: EngineRequest): boolean {
  return (req.input.household.advisoryFees ?? []).length > 0;
}

/** 顧問料を入れているか（入れる契約が1件でもあるか。持ち帰りのつまみ・提案書の顧問料なしの比較に使う） */
export function advisoryFeeInCurrent(req: EngineRequest): boolean {
  return (req.input.household.advisoryFees ?? []).some((c) => c.enabled !== false);
}

/**
 * 対策「FP顧問料」の今の値（0177）: すべての契約を入れていれば true（入れる）、どれも入れていなければ false（入れない）、
 * 一部だけ（「現状にも入れる」の契約と提案の側だけの契約がある）なら null（今の契約だけ）。null のときは「入れる」も「入れない」も
 * 現状と違う値なので、プランの差分になる（提案の側だけの契約をプランに入れられる）
 */
export function advisoryFeeState(req: EngineRequest): boolean | null {
  const list = req.input.household.advisoryFees ?? [];
  const on = list.filter((c) => c.enabled !== false).length;
  return on === list.length ? true : on === 0 ? false : null;
}

/** 対策「FP顧問料」の値の言い方 */
export const feeStateText = (v: boolean | null): string => (v === true ? "入れる" : v === false ? "入れない" : "今の契約だけ");

/**
 * FP顧問料の ON/OFF を提案の要求に当てる（0008 の追記: 既定では提案の側にだけ入れる。契約の enabled で案ごとに切り替える）。
 * ON はすべての契約を入れ、OFF はすべての契約を外す。元の要求は変えない
 */
export function applyAdvisoryFee(req: EngineRequest, on: boolean): EngineRequest {
  const list = req.input.household.advisoryFees;
  if (list === undefined || list.length === 0) return req;
  const out = structuredClone(req);
  for (const c of out.input.household.advisoryFees ?? []) {
    if (on) delete c.enabled;
    else c.enabled = false;
  }
  return out;
}

const manYen = (n: number) => (n % 10000 === 0 ? `${group(n / 10000)}万円` : `${group(n)}円`);

/** 対策「FP顧問料」の下の一文: 契約の中身の要約（例: 単発30万円＋年額12万円（2027年1月から））。料金表の写しの印（menu）は使わない */
export function feeSummary(req: EngineRequest): string {
  return (req.input.household.advisoryFees ?? [])
    .map((c) => {
      const parts: string[] = [];
      const one = (c.terms?.oneTime ?? []).reduce((s, o) => s + o.amount, 0);
      if (one > 0) parts.push(`単発${manYen(one)}`);
      const r = c.terms?.recurring;
      if (r !== undefined) {
        const at = resolveTimepoint(req.input.household, r.from);
        const from = at !== null ? `（${Number(at.slice(0, 4))}年${Number(at.slice(5))}月から）` : "";
        if (r.annual !== undefined) parts.push(`年額${manYen(r.annual)}${from}`);
        if (r.monthly !== undefined) parts.push(`月額${manYen(r.monthly)}${from}`);
      }
      return parts.join("＋");
    })
    .filter((x) => x !== "")
    .join("、");
}
