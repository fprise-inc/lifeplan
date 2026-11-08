// 0008 の7: 上書きの決まり方の順番の最後「万一の重ね」と、型の決まったストレステスト（0006 の6）を、計算の前に入力に重ねる。
// どちらもエンジンの1か所（ここ）だけで行い、部品は重ねた後の入力を読む（部品が独自に万一・ストレスを探さない）。
// 万一の重ね（0008 の追記 2026-10-09）:
// - 死亡（death）: 構成員はその月の翌月に世帯から離れる（leaves）。その人の働き方の期間はその月で終わり、配偶者の関係もその月で終わる。
//   その人の器への積立もその月で止まる。遺族年金・団信・保険金・遺族の生活費などは、判定の部品 contingency.event を読む部品が計算する
// - 障害（disability）・就業不能（incapacity）: その月で働けなくなる（働き方の期間を区切る）。勤め先の健康保険に入っていた人は、翌月から
//   休業（病気。leave/sick）の期間を最長18か月置く（傷病手当金は benefit.health がその期間に出す。保険料は休業中も続く）。
//   働けるようになる月（recovery）があれば、その月から元の働き方の期間に戻る（休職。その期間に結び付いた退職給付は、戻った期間の終わりに
//   もとの勤続期間で支給する。0026）
// - 遺族・家族の働き方の変化（survivor.spouseWork）: その期間の始まりから、その人のそれまでの働き方の期間を置き換える
// 働き方の置き換え（workChanges。0085）: 万一の想定の有無によらず、survivor.spouseWork と同じ当て方で置き換える（万一の重ねの後）
// ストレステスト（0005・0006 の追記 2026-10-09）: 型（template）と値から、前提の年ごとの列（物価・賃金）・資産の時価の下落（marketShocks）・
// 変動金利の上乗せ（loanRateShifts）・収入の減少（incomeShocks）に書き換える
import { EngineError } from "../errors.ts";
import { addMonths, formatYm, monthIndex, parseYm, yearOf, type MonthIndex } from "../time/month.ts";
import type { Timepoint, TimeResolver } from "../time/timepoint.ts";
import { enginePresetValue } from "../sdk/estimates.ts";
import type { ContingencyInput, EmploymentPeriodInput, EngineInput, StressTemplate } from "./types.ts";

/** 勤め先の健康保険（休業の期間を置く） */
const EMPLOYER_HEALTH: ReadonlySet<string> = new Set(["kyokaikenpo", "union", "mutualAid"]);
/** 給与・事業の出る働き方 */
const WORKING: ReadonlySet<string> = new Set(["regular", "contract", "partTime", "civilServant", "executive", "selfEmployed"]);
/** 休業（病気）の期間の長さ（傷病手当金の支給の期間の通算1年6か月） */
export const SICK_LEAVE_MONTHS = 18;

/** 重ねた万一の見出し（解決した月） */
export interface ContingencyHeader {
  readonly id: string;
  readonly kind: ContingencyInput["kind"];
  readonly member: string;
  readonly occurs: string;
  readonly grade?: number;
  readonly recovery?: string;
}

/** 目安の値（sdk/estimates.ts の公式の値。事務所の推定の値は計算のときに applyStress の est で引く） */
const pv = (id: string): string => String(enginePresetValue(id));
const pn = (id: string): number => Number(enginePresetValue(id));

/** ストレステストの型の一覧と既定の値（画面が並べて、FP が値を変えられる。値は sdk/estimates.ts の目安） */
export const STRESS_TEMPLATES: readonly {
  readonly template: StressTemplate;
  readonly title: string;
  readonly params: Readonly<Record<string, string | number | boolean | null>>;
}[] = [
  { template: "marketDropAtRetirement", title: "退職した年に資産の時価が下がる", params: { member: null, year: null, drop: pv("preset.stress.marketDrop") } },
  { template: "inflationSpike", title: "インフレが一定期間だけ上振れする", params: { year: null, years: pn("preset.stress.inflationSpike.years"), rate: pv("preset.stress.inflationSpike.rate"), alsoWages: false } },
  { template: "rateRise", title: "変動金利が上がる", params: { from: null, add: pv("preset.stress.rateRise.add") } },
  { template: "incomeDrop", title: "収入が一定期間減る", params: { member: null, from: null, years: pn("preset.stress.incomeDrop.years"), ratio: pv("preset.stress.incomeDrop.ratio") } },
  { template: "lowReturnPeriod", title: "退職から一定期間、運用の利回りが低いまま", params: { member: null, year: null, years: pn("preset.stress.lowReturn.years"), cap: pv("preset.stress.lowReturn.cap") } },
  { template: "returnShortfall", title: "運用の利回りが想定よりずっと低い", params: { year: null, add: pv("preset.stress.returnShortfall.add") } },
];

const at = (m: MonthIndex): Timepoint => ({ at: formatYm(m) });

/** 物の ID（UUID 第4版）から、決まった別の ID を作る（重ねる物の ID。salt ごとに違う） */
export function derivedId(id: string, salt: number): string {
  const hex = "0123456789abcdef";
  const head = id.slice(0, 24);
  let tail = "";
  for (let i = 0; i < 12; i++) {
    const d = hex.indexOf(id.charAt(24 + i));
    tail += hex.charAt((d + salt * 7 + i + 1) % 16);
  }
  return head + tail;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * 万一の重ね: contingencies の1件を入力に重ねた入力（重ねるものが無ければそのまま）と、見出し。
 * 入力は凍結されているので写して書き換える（重ねない部分は同じ物を指す）
 */
export function applyContingency(input: EngineInput, time: TimeResolver): { input: EngineInput; header: ContingencyHeader | null } {
  const c = input.contingencies?.[0];
  if (c === undefined) return { input, header: null };
  const h = input.household;
  if (!h.members.some((m) => m.id === c.member)) throw new EngineError("E_ARGUMENT", ["contingency.member"]);
  const D = time.resolve(c.occurs);
  const R = c.recovery === undefined ? null : time.resolve(c.recovery);
  if (R !== null && R <= D) throw new EngineError("E_ARGUMENT", ["contingency.recovery"]);
  const header: ContingencyHeader = {
    id: c.id,
    kind: c.kind,
    member: c.member,
    occurs: formatYm(D),
    ...(c.grade !== undefined ? { grade: c.grade } : {}),
    ...(R !== null ? { recovery: formatYm(R) } : {}),
  };
  const end = (tp: Timepoint | null): number => (tp === null ? Infinity : time.resolve(tp));
  let periods: EmploymentPeriodInput[] = [...h.employmentPeriods];
  let members = h.members;
  let relations = h.relations;
  let accounts = h.accounts;
  let benefits = h.retirementBenefits;

  if (c.kind === "death") {
    // 死亡退職金は見込み額を勤続の月数（死亡の月まで÷予定の終わりまで）で按分する（retirement.benefit）。働き方の期間にひもづく退職給付は、
    // 期間を死亡の月で終える前の勤続期間（予定の終わり）を書いておく（見込み額を入れた物だけ。見込みの計算は死亡の月までの期間で計算する。0170）
    if (benefits !== undefined) {
      benefits = benefits.map((b) => {
        if (b.service !== undefined || b.employment === undefined || b.amount?.value === undefined || b.amount.value === null) return b;
        const p = periods.find((x) => x.id === b.employment);
        if (p === undefined || p.member !== c.member || p.to === null) return b;
        return { ...b, service: { from: p.from, to: p.to } };
      });
    }
    // 働き方の期間はその月まで
    periods = periods.flatMap((p) => {
      if (p.member !== c.member) return [p];
      if (time.resolve(p.from) > D) return [];
      return end(p.to) <= D ? [p] : [{ ...p, to: at(D) }];
    });
    members = members.map((m) => (m.id === c.member && end(m.leaves) > D + 1 ? { ...m, leaves: at(addMonths(D, 1)) } : m));
    relations = relations.map((r) =>
      r.type === "spouse" && (r.a === c.member || r.b === c.member) && end(r.to) > D ? { ...r, to: at(D) } : r,
    );
    accounts = accounts.map((a) => {
      if (a.owner !== c.member || a.contributions.length === 0) return a;
      const contributions = a.contributions.flatMap((x) => {
        if (time.resolve(x.from) > D) return [];
        return end(x.to) <= D ? [x] : [{ ...x, to: at(D) }];
      });
      return { ...a, contributions };
    });
  } else {
    // 障害・就業不能: その月で働けなくなる。働けるようになる月から元の働き方に戻る
    const active = periods.find((p) => p.member === c.member && time.resolve(p.from) <= D && end(p.to) >= D && WORKING.has(p.type));
    const out: EmploymentPeriodInput[] = [];
    for (const p of periods) {
      if (p.member !== c.member) {
        out.push(p);
        continue;
      }
      const pf = time.resolve(p.from);
      const pt = end(p.to);
      if (pt <= D) {
        out.push(p);
        continue;
      }
      if (pf <= D) out.push({ ...p, to: at(D) });
      if (R !== null && pt >= R) {
        const from = pf > R ? pf : R;
        out.push(pf > D ? p : { ...p, id: derivedId(p.id, 1), from: at(from as MonthIndex) });
        // 働けるようになって同じ勤め先に戻る（休職）: その期間に結び付いた退職給付は、休職で退職したことにせず、
        // 戻った期間の終わりに、もとの勤続期間で支給する（0026）
        if (pf <= D && benefits !== undefined) {
          const resumed = derivedId(p.id, 1);
          benefits = benefits.map((b) =>
            b.employment !== p.id ? b : { ...b, employment: resumed, ...(b.service === undefined && p.to !== null ? { service: { from: p.from, to: p.to } } : {}) },
          );
        }
      }
    }
    periods = out;
    if (active !== undefined && active.type !== "selfEmployed" && active.healthInsurance !== undefined && EMPLOYER_HEALTH.has(active.healthInsurance.kind)) {
      // 勤め先の期間が先に終わる予定でも、傷病手当金は資格を失った後も続けて受けられる（継続給付）ので、休業の期間として置く
      const last = Math.min(D + SICK_LEAVE_MONTHS, R === null ? Infinity : R - 1);
      if (last > D) {
        const leave: Mutable<EmploymentPeriodInput> = {
          id: derivedId(active.id, 2),
          member: c.member,
          from: at(addMonths(D, 1)),
          to: at(last as MonthIndex),
          type: "leave",
          leaveKind: "sick",
        };
        if (active.healthInsurance !== undefined) leave.healthInsurance = active.healthInsurance;
        if (active.pensionCategory !== undefined) leave.pensionCategory = active.pensionCategory;
        if (active.employer !== undefined) leave.employer = active.employer;
        if (active.salary !== undefined) leave.salary = active.salary;
        if (active.standardMonthlyRemuneration !== undefined) leave.standardMonthlyRemuneration = active.standardMonthlyRemuneration;
        if (active.employeeInsurance !== undefined) leave.employeeInsurance = active.employeeInsurance;
        if (active.employmentInsuranceCovered !== undefined) leave.employmentInsuranceCovered = active.employmentInsuranceCovered;
        periods.push(leave);
      }
    }
  }

  // 家族の働き方の変化（その期間の始まりから置き換える）
  for (const q of c.survivor?.spouseWork ?? []) {
    if (!members.some((m) => m.id === q.member)) throw new EngineError("E_ARGUMENT", ["contingency.survivor.spouseWork.member"]);
    periods = replaceFrom(periods, q, time);
  }

  const household = { ...h, members, relations, employmentPeriods: periods, accounts, ...(benefits !== undefined ? { retirementBenefits: benefits } : {}) };
  return { input: { ...input, household }, header };
}

/** 働き方の期間 q の始まりから、その人のそれまでの働き方の期間を置き換える（始まりより後の期間は外し、またぐ期間は前の月で終える） */
function replaceFrom(periods: readonly EmploymentPeriodInput[], q: EmploymentPeriodInput, time: TimeResolver): EmploymentPeriodInput[] {
  const qf = time.resolve(q.from);
  const out = periods.flatMap((p) => {
    if (p.member !== q.member) return [p];
    if (time.resolve(p.from) >= qf) return [];
    return p.to !== null && time.resolve(p.to) < qf ? [p] : [{ ...p, to: at(addMonths(qf, -1)) }];
  });
  out.push(q);
  return out;
}

/**
 * 働き方の置き換え（入力の workChanges。0085）: 期間ごとに、その始まりから、その人のそれまでの働き方の期間を置き換える
 * （万一の想定の survivor.spouseWork と同じ当て方）。万一の想定の有無によらず当てる（就業不能・収入が減るの場面で、配偶者の働き方を変えて見る）。
 * 万一の重ねの後に当てる（万一の想定が区切る人の期間には使わない）
 */
export function applyWorkChanges(input: EngineInput, time: TimeResolver): EngineInput {
  const qs = input.workChanges ?? [];
  if (qs.length === 0) return input;
  const h = input.household;
  let periods: EmploymentPeriodInput[] = [...h.employmentPeriods];
  for (const q of qs) {
    if (!h.members.some((m) => m.id === q.member)) throw new EngineError("E_ARGUMENT", ["workChanges.member"]);
    periods = replaceFrom(periods, q, time);
  }
  return { ...input, household: { ...h, employmentPeriods: periods } };
}

/** ストレステストの見出し（展開した型と値） */
export interface StressHeader {
  readonly template: StressTemplate;
  readonly params: Readonly<Record<string, unknown>>;
}

/** 本人（kind self）の構成員の ID（無ければ最初の構成員） */
function selfOf(input: EngineInput): string {
  const m = input.household.members.find((x) => x.kind === "self") ?? input.household.members[0];
  if (m === undefined) throw new EngineError("E_ARGUMENT", ["stressTest.member"]);
  return m.id;
}

/** その構成員の退職の月: 退職のイベント（kind retirement）か、最後の働き方の期間の終わり */
function retirementOf(input: EngineInput, member: string, time: TimeResolver): MonthIndex | null {
  const ev = input.household.events.find((e) => e.kind === "retirement" && e.member === member);
  if (ev !== undefined) return time.resolveEvent(ev.id, []);
  let last: MonthIndex | null = null;
  for (const p of input.household.employmentPeriods) {
    if (p.member !== member || !WORKING.has(p.type) || p.to === null) continue;
    const t = time.resolve(p.to);
    if (last === null || t > last) last = t;
  }
  return last;
}

/** ストレステストを前提に書き換えた入力と見出し（指定が無ければそのまま）。空欄の値は目安（est。事務所の推定の値があればその値） */
export function applyStress(input: EngineInput, time: TimeResolver, est: (id: string) => number | string = enginePresetValue): { input: EngineInput; header: StressHeader | null } {
  const st = input.stressTest;
  if (st === undefined) return { input, header: null };
  const p = st.params ?? {};
  const base = parseYm(input.baseMonth);
  const baseYear = yearOf(base);
  const a = { ...input.assumptions } as Mutable<EngineInput["assumptions"]>;
  let params: Record<string, unknown>;
  switch (st.template) {
    case "marketDropAtRetirement": {
      const member = p.member ?? selfOf(input);
      const ret = retirementOf(input, member, time);
      const year = p.year ?? (ret === null ? baseYear + 1 : yearOf(ret));
      const drop = p.drop ?? String(est("preset.stress.marketDrop"));
      const extra = { ...(p.kinds !== undefined ? { kinds: p.kinds } : {}), ...(p.assetClasses !== undefined ? { assetClasses: p.assetClasses } : {}) };
      a.marketShocks = [...(a.marketShocks ?? []), { year, drop, ...extra }];
      params = { member, year, drop, ...extra };
      break;
    }
    case "lowReturnPeriod": {
      // 0026: 退職の年（year があればその年）から years 年のあいだ、運用の利回りを cap までに抑える
      const member = p.member ?? selfOf(input);
      const ret = retirementOf(input, member, time);
      const year = p.year ?? (ret === null ? baseYear + 1 : yearOf(ret));
      const years = p.years ?? Number(est("preset.stress.lowReturn.years"));
      const cap = p.cap ?? String(est("preset.stress.lowReturn.cap"));
      a.returnShifts = [...(a.returnShifts ?? []), { from: year, to: year + years - 1, cap }];
      params = { member, year, years, cap };
      break;
    }
    case "returnShortfall": {
      // 0026: 運用の利回りがずっと想定より低い（add は負の率。省略は -0.01）
      const add = p.add ?? String(est("preset.stress.returnShortfall.add"));
      const from = p.year ?? baseYear;
      a.returnShifts = [...(a.returnShifts ?? []), { from, add }];
      params = { year: from, add };
      break;
    }
    case "inflationSpike": {
      const from = p.year ?? baseYear + 1;
      const years = p.years ?? Number(est("preset.stress.inflationSpike.years"));
      const rate = p.rate ?? String(est("preset.stress.inflationSpike.rate"));
      const over = (s: { default: string; byYear?: Readonly<Record<string, string>> } | undefined) => {
        const byYear: Record<string, string> = { ...(s?.byYear ?? {}) };
        for (let y = from; y < from + years; y++) byYear[String(y)] = rate;
        return { default: s?.default ?? "0", byYear };
      };
      a.inflation = over(a.inflation);
      if (p.alsoWages === true) a.wageGrowth = over(a.wageGrowth);
      params = { year: from, years, rate, alsoWages: p.alsoWages === true };
      break;
    }
    case "rateRise": {
      const from = p.from ?? formatYm(monthIndex(baseYear + 1, 1));
      const add = p.add ?? String(est("preset.stress.rateRise.add"));
      a.loanRateShifts = [...(a.loanRateShifts ?? []), { from, add }];
      params = { from, add };
      break;
    }
    case "incomeDrop": {
      const member = p.member ?? selfOf(input);
      const from = p.from ?? formatYm(monthIndex(baseYear + 1, 1));
      const years = p.years ?? Number(est("preset.stress.incomeDrop.years"));
      const ratio = p.ratio ?? String(est("preset.stress.incomeDrop.ratio"));
      const to = formatYm(addMonths(parseYm(from), years * 12 - 1));
      a.incomeShocks = [...(a.incomeShocks ?? []), { member, from, to, ratio }];
      params = { member, from, to, ratio };
      break;
    }
  }
  return { input: { ...input, assumptions: a }, header: { template: st.template, params } };
}
