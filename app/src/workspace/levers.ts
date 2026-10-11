// 打ち手（主画面の右のスライダー）を世帯の入力に当てはめる。
// いまは「現状の世帯に打ち手を当てた要求」を直接作る。0008 の5 のプランの層（提案＝差分の列）ができたら、
// ここは「打ち手 → 差分」を作る部品に置き換える（作る差分の中身はここと同じ）。
import type { EmploymentPeriod, EngineRequest, Member, Timepoint } from "../engine/types.ts";

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

/** 月の時点の比較用（"YYYY-MM" は文字列のまま比べられる） */
function atOf(t: Timepoint | null | undefined): string | null {
  return t?.at ?? null;
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
  const ends = (h.employmentPeriods ?? []).filter((e) => e.member === memberId).map((e) => atOf(e.to)).filter((x): x is string => x !== null).sort();
  const lastEnd = ends.at(-1);
  if (lastEnd !== undefined) out.retireAge = ageAt(member, addMonths(lastEnd, 1));
  const rec = (h.pensionRecords ?? []).find((r) => r.member === memberId);
  if (rec !== undefined) {
    const claim = atOf(rec.claim?.basic);
    out.pensionAge = claim === null ? 65 : ageAt(member, addMonths(claim, -1));
  }
  const nisa = (h.accounts ?? []).find((a) => a.kind === "nisa" && a.owner === memberId);
  if (nisa !== undefined) out.nisaMonthly = nisa.contributions?.[0]?.monthly ?? 0;
  const living = (h.livingExpenses ?? []).find((l) => l.mode === "total");
  if (living?.monthly?.value != null) out.livingMonthly = living.monthly.value;
  return out;
}

/** どの打ち手がこの世帯で使えるか（読めた打ち手だけ） */
export function availableLevers(req: EngineRequest, memberId: string): Set<LeverKey> {
  return new Set(Object.keys(readLevers(req, memberId)) as LeverKey[]);
}

const box = <T,>(v: T) => ({ value: v, state: "confirmed", origin: { kind: "manual" } });

/** 新しい ID（UUID 第4版の形。0004）。打ち手で足す働き方の期間に使う。決まった値から作る（同じ打ち手なら同じ要求にする） */
function derivedId(base: string, salt: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const ch of base + "|" + salt) {
    h1 = Math.imul(h1 ^ ch.charCodeAt(0), 16777619) >>> 0;
    h2 = Math.imul(h2 ^ ch.charCodeAt(0), 2246822519) >>> 0;
  }
  const hex = (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0") + (h1 ^ h2).toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 32);
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
    const mine = (h.employmentPeriods ?? []).filter((e) => e.member === memberId);
    const others = (h.employmentPeriods ?? []).filter((e) => e.member !== memberId);
    // その月より後に始まる期間は外し、またぐ期間はその月で終える
    const kept: EmploymentPeriod[] = [];
    for (const e of mine) {
      const from = atOf(e.from);
      if (from !== null && from > lastMonth) continue;
      const to = atOf(e.to);
      kept.push(to === null || to > lastMonth ? { ...e, to: { at: lastMonth } } : e);
    }
    const lastEnd = kept.map((e) => atOf(e.to)).filter((x): x is string => x !== null).sort().at(-1);
    if (lastEnd !== undefined && lastEnd < lastMonth) {
      const r = opts.reemployment;
      const tail = kept.find((e) => atOf(e.to) === lastEnd) as EmploymentPeriod;
      if (r !== undefined && r.type === "selfEmployed") {
        // 定年の後に自営業: 事業の所得で、その年齢まで（健康保険・年金の種類はエンジンが導く）
        kept.push({ id: derivedId(tail.id, "reemployment"), member: memberId, from: { at: addMonths(lastEnd, 1) }, to: { at: lastMonth }, type: "selfEmployed", business: { income: box(r.annualSalary) } });
      } else if (r !== undefined) {
        // 定年の後: 再雇用などの働き方で、その年齢まで
        const smr = r.standardMonthlyRemuneration;
        const { standardMonthlyRemuneration: _smr, corporatePension: _cp, business: _b, ...rest } = tail;
        void _smr;
        void _cp;
        void _b;
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
    // 退職の段階の生活費・NISA の積立の終わりも、退職に合わせる
    for (const l of h.livingExpenses ?? []) {
      for (const s of l.stages ?? []) if (s.label === "retirement") s.at = { at: ageReachedMonth(member, values.retireAge) };
    }
    for (const a of h.accounts ?? []) {
      if (a.kind !== "nisa" || a.owner !== memberId) continue;
      for (const c of a.contributions ?? []) c.to = { at: lastMonth };
    }
  }

  if (values.pensionAge !== undefined && values.pensionAge !== current.pensionAge) {
    // 受け取りの開始は、その年齢に達した月の翌月（0003・年金の制度の決まり）
    const claim: Timepoint = { at: addMonths(ageReachedMonth(member, values.pensionAge), 1) };
    for (const r of h.pensionRecords ?? []) if (r.member === memberId) r.claim = { basic: claim, employee: claim };
  }

  if (values.nisaMonthly !== undefined && values.nisaMonthly !== current.nisaMonthly) {
    const retire = values.retireAge ?? current.retireAge;
    for (const a of h.accounts ?? []) {
      if (a.kind !== "nisa" || a.owner !== memberId) continue;
      const end = a.contributions?.[0]?.to ?? (retire !== undefined ? { at: addMonths(ageReachedMonth(member, retire), -1) } : null);
      a.contributions = values.nisaMonthly > 0 && end !== null ? [{ from: { at: req.input.baseMonth }, to: end, monthly: values.nisaMonthly }] : [];
    }
  }

  if (values.livingMonthly !== undefined && values.livingMonthly !== current.livingMonthly) {
    const l = (h.livingExpenses ?? []).find((x) => x.mode === "total");
    if (l !== undefined) l.monthly = box(values.livingMonthly);
  }
  return req;
}
