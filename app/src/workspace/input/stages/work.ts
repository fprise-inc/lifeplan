// 2. 働き方と収入: 今の働き方と年収（簡易）、定年後の予定（再雇用の年収・何歳まで）、退職金、働き方の期間の一覧（詳細）。
// 被保険者の種別（第1〜3号）は入れない（エンジンが働き方の期間から導く。0008 の4）
import type { EmploymentPeriod, Household, Member } from "../../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth, applyLevers, readLevers } from "../../levers.ts";
import { businessEstimate, careerStartMonth, ensureResidentTax, residentTaxEstimate, residentTaxYear, salaryAge, salaryEstimate, smrEstimate, smrMonth } from "../estimates.ts";
import { healthRateEstimate } from "../../../../../hearing/src/estimates.ts";
import { byId, field, plain, rateBox, removeAction, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { estimatedBox, mutate, newId, periodsOf, reemploymentOf, type PostRetirement, type WorkingHousehold } from "../household.ts";
import { earners, EMPLOYMENT_TYPES, HEALTH_INSURANCE, KYOKAI_BRANCHES, LEAVE_KINDS, memberLabel, PENSION_CATEGORY, POST_RETIREMENT_TYPES } from "../labels.ts";

const SALARIED = new Set(["regular", "contract", "partTime", "civilServant", "executive"]);
const periods = (h: Household) => h.employmentPeriods;

/** 計算基準月にしている働き方の期間。無ければ次に始まる期間、それも無ければ最後の期間 */
export function currentPeriod(h: Household, memberId: string, baseMonth: string): EmploymentPeriod | undefined {
  const ps = periodsOf(h, memberId);
  return (
    ps.find((p) => (p.from.at ?? "") <= baseMonth && (p.to === null || (p.to.at ?? "9999-12") >= baseMonth)) ??
    ps.find((p) => (p.from.at ?? "") > baseMonth) ??
    ps.at(-1)
  );
}

/** 給与の種類ごとの初めの値（健康保険・厚生年金・勤め先）。種類を変えたとき、前の種類の初めの値のままの欄はこの値に入れ替える */
function salariedDefaults(type: string): Pick<EmploymentPeriod, "healthInsurance" | "pensionCategory" | "employer"> {
  return {
    healthInsurance: fixHealthInsurance({ kind: type === "civilServant" ? "mutualAid" : type === "partTime" ? "dependent" : "kyokaikenpo" }),
    pensionCategory: type === "civilServant" ? "employee3" : type === "partTime" ? "none" : "employee1",
    employer: { size: type === "partTime" ? 50 : 100, weeklyHours: type === "partTime" ? "20" : "40" },
  };
}

/** 自動で入れた推定の値（出どころ auto のまま。FP が入れた値・確定の値ではない） */
const isAutoBox = (b: { state?: string; origin?: { kind?: string } } | undefined): boolean => b !== undefined && b.state === "estimated" && b.origin?.kind === "auto";
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 働き方の種類を変える: その種類に要る欄を足し、要らない欄を外す（0008 の4・スキーマの条件）。
 * 給与の種類どうし（正社員→パートなど）で変えたときは、推定のままの年収・賞与・標準報酬月額を新しい種類の推定に入れ替え、
 * 前の種類の初めの値のままの健康保険・厚生年金・勤め先も新しい種類の初めの値に入れ替える。FP が入れた値は残す（0008 の追記 2026-10-11 の2・2026-10-25）
 */
export function convertPeriod(p: EmploymentPeriod, type: string, member: Member | undefined, baseMonth: string): EmploymentPeriod {
  const { salary, business, healthInsurance, pensionCategory, employer, standardMonthlyRemuneration, leaveKind, leaveChild, childcareShortHours, corporatePension, employmentInsuranceCovered, employeeInsurance, ...rest } = p;
  const out: EmploymentPeriod = { ...rest, type };
  const sex = member?.sex ?? "male";
  if (SALARIED.has(type)) {
    // 推定の年齢は、その期間の始まりと計算基準月の遅いほう（勤め先の規模は推定に使わない。規模は詳細で入れたときだけの決まり）
    const est = salaryEstimate(type, sex, member === undefined ? {} : { age: salaryAge(member, p, baseMonth) });
    const was = SALARIED.has(p.type) && p.type !== type ? salariedDefaults(p.type) : null;
    const now = salariedDefaults(type);
    const keep = <T,>(cur: T | undefined, before: T | undefined, next: T): T => (cur === undefined || (was !== null && sameJson(cur, before)) ? next : cur);
    out.healthInsurance = keep(healthInsurance, was?.healthInsurance, now.healthInsurance as NonNullable<EmploymentPeriod["healthInsurance"]>);
    out.pensionCategory = keep(pensionCategory, was?.pensionCategory, now.pensionCategory as NonNullable<EmploymentPeriod["pensionCategory"]>);
    out.employer = keep(employer, was?.employer, now.employer as NonNullable<EmploymentPeriod["employer"]>);
    const annual = est !== null ? estimatedBox(est.annual.value, est.annual.basis) : estimatedBox(0, "未入力");
    const bonus = est !== null ? estimatedBox(est.bonus.value, est.bonus.basis) : estimatedBox(0, "未入力");
    out.salary =
      salary === undefined
        ? { annual, bonus }
        : { ...salary, annual: isAutoBox(salary.annual) ? annual : salary.annual, ...(isAutoBox(salary.bonus) ? { bonus } : {}) };
    const smr = standardMonthlyRemuneration;
    out.standardMonthlyRemuneration = smr !== undefined && !(isAutoBox(smr.health) && isAutoBox(smr.pension)) ? smr : smrEstimate(out.salary.annual.value ?? 0, smrMonth(p, baseMonth));
    if (corporatePension !== undefined) out.corporatePension = corporatePension;
    if (employmentInsuranceCovered !== undefined) out.employmentInsuranceCovered = employmentInsuranceCovered;
    if (employeeInsurance !== undefined) out.employeeInsurance = employeeInsurance;
    if (childcareShortHours !== undefined) out.childcareShortHours = childcareShortHours;
  } else if (type === "selfEmployed") {
    const est = businessEstimate();
    out.business = business ?? { income: estimatedBox(est.value, est.basis) };
  } else if (type === "leave") {
    out.leaveKind = leaveKind ?? "childcare";
    if (leaveChild !== undefined) out.leaveChild = leaveChild;
  }
  return out;
}

/** 健保組合・共済の料率が分からないときの目安（被保険者の負担分。ヒアリングシートの取り込みと同じ hearing/src/estimates.ts の目安） */
const unionRate = (kind: "union" | "mutualAid", branch: string) => {
  const e = healthRateEstimate(kind, { branch });
  return { value: e.value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: e.basis } };
};

/** 健康保険の種類に要る欄をそろえる: 協会けんぽは支部、健保組合・共済は料率（スキーマの条件） */
export function fixHealthInsurance(hi: { kind: string; [key: string]: unknown }, defaultBranch = "kyokaikenpo.13"): { kind: string; [key: string]: unknown } {
  if (hi.kind === "kyokaikenpo") {
    hi.insurer ??= defaultBranch;
    delete hi.employeeRate;
    delete hi.careEmployeeRate;
    delete hi.childSupportEmployeeRate;
  } else {
    delete hi.insurer;
    if (hi.kind === "union" || hi.kind === "mutualAid") hi.employeeRate ??= unionRate(hi.kind, defaultBranch);
    else {
      delete hi.employeeRate;
      delete hi.careEmployeeRate;
      delete hi.childSupportEmployeeRate;
    }
  }
  return hi;
}

/** 定年（今の勤め先）の期間: 定年後の予定の年齢の前月に終わる期間。無ければ定年後の予定がない */
function mainPeriod(h: Household, m: Member, post: PostRetirement | undefined): EmploymentPeriod | undefined {
  if (post === undefined) return undefined;
  const end = addMonths(ageReachedMonth(m, post.fromAge), -1);
  return periodsOf(h, m.id).find((p) => p.to?.at === end);
}

function setRetireAge(wh: WorkingHousehold, m: Member, age: number): WorkingHousehold {
  const post = wh.postRetirement[m.id];
  const request = applyLevers(wh.request, m.id, { retireAge: age }, (() => {
    const r = reemploymentOf(post);
    return r !== undefined ? { reemployment: r } : {};
  })());
  return { ...wh, request };
}

function setMainEnd(wh: WorkingHousehold, m: Member, age: number): WorkingHousehold {
  const post = wh.postRetirement[m.id];
  const main = mainPeriod(wh.request.input.household, m, post);
  if (post === undefined || main === undefined) return wh;
  const oldEnd = main.to?.at as string;
  const newEnd = addMonths(ageReachedMonth(m, age), -1);
  const next = mutate(wh, (h) => {
    const ps = periodsOf(h, m.id);
    const mp = ps.find((p) => p.id === main.id) as EmploymentPeriod;
    mp.to = { at: newEnd };
    // 定年の後の期間: 新しい定年の翌月から始める。新しい定年より前に終わる期間は外す
    const after = ps.filter((p) => (p.from.at ?? "") > oldEnd);
    const drop = new Set<string>();
    after.forEach((p, i) => {
      const end = p.to?.at ?? "9999-12";
      if (end <= newEnd) drop.add(p.id);
      else if (i === after.findIndex((x) => !drop.has(x.id) && (x.to?.at ?? "9999-12") > newEnd)) p.from = { at: addMonths(newEnd, 1) };
    });
    h.employmentPeriods = (h.employmentPeriods ?? []).filter((p) => !drop.has(p.id));
  });
  return { ...next, postRetirement: { ...next.postRetirement, [m.id]: { ...post, fromAge: age } } };
}

/** 定年の後の最初の期間 */
function postPeriod(h: Household, m: Member, post: PostRetirement | undefined): EmploymentPeriod | undefined {
  const main = mainPeriod(h, m, post);
  if (main?.to?.at === undefined) return undefined;
  const start = addMonths(main.to.at, 1);
  return periodsOf(h, m.id).find((p) => p.from.at === start);
}

function retirementGroup(wh: WorkingHousehold, m: Member): GroupDef | null {
  const h = wh.request.input.household;
  const ps = periodsOf(h, m.id);
  if (ps.length === 0) return null;
  const post = wh.postRetirement[m.id];
  const main = mainPeriod(h, m, post);
  const who = memberLabel(wh, m.id);
  const fields: FieldDef[] = [];
  if (post !== undefined && main !== undefined) {
    fields.push(
      field({
        key: `work/${m.id}/mainEnd`,
        item: "employment.to",
        label: "定年（今の勤め先を辞める年齢）",
        level: "simple",
        kind: "int",
        suffix: "歳",
        min: 40,
        max: 80,
        help: "この年齢になる月の前月まで今の勤め先で働きます",
        get: (w) => ({ value: w.postRetirement[m.id]?.fromAge ?? null }),
        set: (w, v) => (v === null ? w : setMainEnd(w, m, Number(v))),
      }),
      field({
        key: `work/${m.id}/postType`,
        item: "employment.type",
        label: "定年後の働き方",
        level: "simple",
        kind: "select",
        options: POST_RETIREMENT_TYPES,
        get: (w) => ({ value: w.postRetirement[m.id]?.type ?? "" }),
        set: (w, v) => {
          const cur = w.postRetirement[m.id];
          if (cur === undefined) return w;
          const type = (v === "" || v === null ? null : v) as PostRetirement["type"];
          const est = type === null ? null : type === "selfEmployed" ? businessEstimate().value : (salaryEstimate(type, m.sex, { age: cur.fromAge })?.annual.value ?? null);
          const nextPost: PostRetirement = { ...cur, type, annualSalary: type === null ? null : (cur.annualSalary ?? est) };
          let next: WorkingHousehold = { ...w, postRetirement: { ...w.postRetirement, [m.id]: nextPost } };
          const pp = postPeriod(next.request.input.household, m, nextPost);
          if (pp !== undefined) {
            if (type === null) {
              // 定年後は働かない: 定年の後の期間を外す（働く最後の年齢は定年になる）
              next = setRetireAge(next, m, nextPost.fromAge);
            } else
              next = mutate(next, (hh) => {
                const list = hh.employmentPeriods ?? [];
                const i = list.findIndex((p) => p.id === pp.id);
                const conv = convertPeriod(list[i] as EmploymentPeriod, type, m, next.request.input.baseMonth);
                if (nextPost.annualSalary !== null) {
                  if (conv.salary !== undefined) conv.salary = { ...conv.salary, annual: { value: nextPost.annualSalary, state: "confirmed", origin: { kind: "manual" } } };
                  if (conv.business !== undefined) conv.business = { income: { value: nextPost.annualSalary, state: "confirmed", origin: { kind: "manual" } } };
                }
                list[i] = conv;
              });
          }
          return next;
        },
      }),
    );
    if (post.type !== null)
      fields.push(
        field({
          key: `work/${m.id}/postSalary`,
          item: post.type === "selfEmployed" ? "employment.business.income" : "employment.salary.annual",
          label: post.type === "selfEmployed" ? "定年後の事業所得（年額）" : "定年後の年収（年額・賞与を除く）",
          level: "simple",
          kind: "yen",
          basis: "annual",
          get: (w) => ({ value: w.postRetirement[m.id]?.annualSalary ?? null }),
          set: (w, v) => {
            const cur = w.postRetirement[m.id];
            if (cur === undefined || v === null) return w;
            const amount = Number(v);
            const next: WorkingHousehold = { ...w, postRetirement: { ...w.postRetirement, [m.id]: { ...cur, annualSalary: amount } } };
            const pp = postPeriod(next.request.input.household, m, cur);
            if (pp === undefined) return next;
            return mutate(next, (hh) => {
              const p = (hh.employmentPeriods ?? []).find((x) => x.id === pp.id) as EmploymentPeriod;
              const box = { value: amount, state: "confirmed", origin: { kind: "manual" } };
              if (p.salary !== undefined) p.salary.annual = box;
              if (p.business !== undefined) p.business.income = box;
            });
          },
        }),
      );
  }
  fields.push(
    field({
      key: `work/${m.id}/retireAge`,
      item: "employment.to",
      label: "働く最後の年齢（現状の予定）",
      level: "simple",
      kind: "int",
      suffix: "歳まで",
      min: 40,
      max: 90,
      sideEffects: "退職後の生活費の節目と NISA の積立の終わりも、この年齢に合わせます",
      help: post?.type != null ? "定年より後の年齢にすると、定年後の働き方で働く期間を足します" : "この年齢になる月の前月まで働きます",
      get: (w) => {
        const v = readLevers(w.request, m.id).retireAge ?? null;
        return { value: v, hint: v === null ? "終わりを決めていない（最後まで）" : null };
      },
      set: (w, v) => (v === null ? w : setRetireAge(w, m, Number(v))),
    }),
  );
  return {
    key: `work/${m.id}/retirement`,
    title: `${who}の定年後の予定`,
    note: "結果の対策「働く最後の年齢」でも動かせます。結果で動かした値は提案として持ち、ここ（現状）は変わりません",
    level: "simple",
    fields,
    actions:
      post === undefined && ps.some((p) => p.to?.at !== undefined)
        ? [
            {
              key: `work/${m.id}/addPost`,
              label: "定年後の予定を入れる",
              level: "simple",
              run: (w) => {
                const last = periodsOf(w.request.input.household, m.id).filter((p) => p.to?.at !== undefined).at(-1) as EmploymentPeriod;
                const age = ageAt(m, addMonths(last.to?.at as string, 1));
                return { ...w, postRetirement: { ...w.postRetirement, [m.id]: { fromAge: age, type: null, annualSalary: null } } };
              },
            },
          ]
        : [],
  };
}

function nowGroup(wh: WorkingHousehold, m: Member): GroupDef {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const cur = currentPeriod(h, m.id, base);
  const who = memberLabel(wh, m.id);
  if (cur === undefined)
    return {
      key: `work/${m.id}/now`,
      title: `${who}の働き方`,
      note: "働き方が入っていません（収入なしで計算しています）",
      level: "simple",
      fields: [],
      actions: [
        {
          key: `work/${m.id}/start`,
          label: "会社員として入れる",
          level: "simple",
          run: (w) => {
            const from = careerStartMonth(m.birth.birthYearMonth);
            const to = addMonths(ageReachedMonth(m, 60), -1);
            const p = convertPeriod({ id: newId(), member: m.id, from: { at: from < base ? from : base }, to: { at: to }, type: "regular" }, "regular", m, base);
            const next = mutate(w, (hh) => {
              (hh.employmentPeriods ??= []).push(p);
              ensureResidentTax(hh, m.id, base, newId);
            });
            return { ...next, postRetirement: { ...next.postRetirement, [m.id]: { fromAge: 60, type: null, annualSalary: null } } };
          },
        },
        {
          key: `work/${m.id}/startSelf`,
          label: "自営業として入れる",
          level: "simple",
          run: (w) => {
            const from = careerStartMonth(m.birth.birthYearMonth);
            const p = convertPeriod({ id: newId(), member: m.id, from: { at: from < base ? from : base }, to: null, type: "selfEmployed" }, "selfEmployed", m, base);
            return mutate(w, (hh) => {
              (hh.employmentPeriods ??= []).push(p);
              ensureResidentTax(hh, m.id, base, newId);
            });
          },
        },
      ],
    };
  const find = byId(periods, cur.id);
  // 詳しい欄は「働き方の期間（詳しく）」に出す（同じ期間を2か所に出さない）
  const fields = periodFields(wh, m, cur, find, "simple", `work/${m.id}/now`).filter((f) => f.level === "simple");
  const fy = residentTaxYear(base);
  const findTax: Finder = (hh) => ((hh.residentTaxAssessments ?? []) as { member: string; fiscalYear: number }[]).find((a) => a.member === m.id && a.fiscalYear === fy) as Record<string, unknown> | undefined;
  fields.push(
    yenBox({
      key: `work/${m.id}/residentTax`,
      item: "residentTaxAssessment.amount",
      label: `住民税（${fy}年度の年税額）`,
      level: "simple",
      basis: "annual",
      find: findTax,
      path: ["amount"],
      optional: true,
      ensure: (hh) => {
        const a = { id: newId(), member: m.id, fiscalYear: fy, amount: { value: 0, state: "confirmed", origin: { kind: "manual" } } };
        ((hh.residentTaxAssessments ??= []) as unknown[]).push(a);
        return a as unknown as Record<string, unknown>;
      },
      estimate: (hh) => {
        const p = currentPeriod(hh, m.id, base);
        return residentTaxEstimate((p?.salary?.annual.value ?? 0) + (p?.salary?.bonus?.value ?? 0), p?.business?.income.value ?? 0, fy - 1);
      },
      help: "住民税の決定通知書（給与明細の住民税×12）の額。空欄なら前の年の所得から概算します",
    }),
  );
  const past = cur.from.at !== undefined && cur.from.at > base;
  return { key: `work/${m.id}/now`, title: `${who}の今の働き方`, ...(past ? { note: "今は働いていません。次に始まる働き方を出しています" } : {}), level: "simple", fields, actions: [] };
}

/** 働き方の期間1件の欄。簡易では種類・年収・賞与・健康保険、詳細では期間・従業員数・労働時間・標準報酬月額・厚生年金の種別も */
function periodFields(wh: WorkingHousehold, m: Member, p: EmploymentPeriod, find: Finder, level: "simple" | "detail", prefix: string): FieldDef[] {
  const fields: FieldDef[] = [];
  const d = "detail" as const;
  if (level === "detail") {
    fields.push(
      timepointField({ key: `${prefix}/from`, item: "employment.from", label: "始まり", level: "detail", find, path: ["from"], ageOf: (h) => h.members.find((x) => x.id === m.id) }),
      timepointField({ key: `${prefix}/to`, item: "employment.to", label: "終わり（最後の月）", level: "detail", find, path: ["to"], ageOf: (h) => h.members.find((x) => x.id === m.id), optional: true, nullText: "終わりを決めていない" }),
    );
  }
  fields.push(
    field({
      key: `${prefix}/type`,
      item: "employment.type",
      label: level === "simple" ? "働き方" : "種類",
      level,
      kind: "select",
      options: EMPLOYMENT_TYPES,
      structural: true,
      get: (w) => ({ value: (find(w.request.input.household, w)?.type as string | undefined) ?? null }),
      set: (w, v) =>
        mutate(w, (h, req) => {
          const list = h.employmentPeriods ?? [];
          const i = list.findIndex((x) => x.id === p.id);
          if (i >= 0 && v !== null) list[i] = convertPeriod(list[i] as EmploymentPeriod, String(v), m, req.input.baseMonth);
          ensureResidentTax(h, m.id, req.input.baseMonth, newId);
        }),
    }),
  );
  if (p.type === "leave") fields.push(plain({ key: `${prefix}/leaveKind`, item: "employment.leaveKind", label: "休業の種類", level, kind: "select", options: LEAVE_KINDS, find, path: ["leaveKind"] }));
  if (SALARIED.has(p.type)) {
    fields.push(
      yenBox({ key: `${prefix}/annual`, item: "employment.salary.annual", label: "年収（税込み・賞与を除く）", level, basis: "annual", find, path: ["salary", "annual"], estimate: () => salaryEstimate(p.type, m.sex, { age: salaryAge(m, p, wh.request.input.baseMonth) })?.annual ?? null, help: "源泉徴収票の支払金額から賞与を除いた額。空欄なら統計の目安で計算します" }),
      yenBox({ key: `${prefix}/bonus`, item: "employment.salary.bonus", label: "賞与（年間の合計）", level, basis: "annual", find, path: ["salary", "bonus"], estimate: () => salaryEstimate(p.type, m.sex, { age: salaryAge(m, p, wh.request.input.baseMonth) })?.bonus ?? null }),
      plain({
        key: `${prefix}/hi`,
        item: "employment.healthInsurance.kind",
        label: "健康保険",
        level,
        kind: "select",
        options: HEALTH_INSURANCE,
        find,
        path: ["healthInsurance", "kind"],
        structural: true,
        after: (h, t) => {
          const branch = (h.employmentPeriods ?? []).map((e) => e.healthInsurance?.insurer).find((x): x is string => typeof x === "string");
          fixHealthInsurance((t as EmploymentPeriod).healthInsurance as { kind: string }, branch);
        },
      }),
      ...(p.healthInsurance?.kind === "kyokaikenpo"
        ? [plain({ key: `${prefix}/branch`, item: "employment.healthInsurance.insurer", label: "協会けんぽの支部", level, kind: "select", options: KYOKAI_BRANCHES, find, path: ["healthInsurance", "insurer"], help: "勤め先の所在地の都道府県（保険料率が支部ごとに違います）" })]
        : []),
      ...(p.healthInsurance?.kind === "union" || p.healthInsurance?.kind === "mutualAid"
        ? [rateBox({ key: `${prefix}/hiRate`, item: "employment.healthInsurance.employeeRate", label: "健康保険料率（本人負担分）", level, find, path: ["healthInsurance", "employeeRate"], help: "給与明細の健康保険料 ÷ 標準報酬月額 でも出せます" })]
        : []),
      plain({ key: `${prefix}/pc`, item: "employment.pensionCategory", label: "厚生年金", level: d, kind: "select", options: PENSION_CATEGORY, find, path: ["pensionCategory"] }),
      plain({ key: `${prefix}/size`, item: "employment.employer.size", label: "勤め先の従業員数", level: d, kind: "int", suffix: "人", min: 1, find, path: ["employer", "size"], help: "社会保険の適用拡大の判定に使います" }),
      plain({ key: `${prefix}/hours`, item: "employment.employer.weeklyHours", label: "週の所定労働時間", level: d, kind: "decimal", suffix: "時間", find, path: ["employer", "weeklyHours"] }),
      yenBox({ key: `${prefix}/smrH`, item: "employment.standardMonthlyRemuneration", label: "標準報酬月額（健康保険）", level: d, basis: "monthly", unit: "yen", find, path: ["standardMonthlyRemuneration", "health"], optional: true, help: "空欄なら年収から計算します" }),
      yenBox({ key: `${prefix}/smrP`, item: "employment.standardMonthlyRemuneration", label: "標準報酬月額（厚生年金）", level: d, basis: "monthly", unit: "yen", find, path: ["standardMonthlyRemuneration", "pension"], optional: true }),
    );
  }
  if (p.type === "selfEmployed")
    fields.push(yenBox({ key: `${prefix}/business`, item: "employment.business.income", label: "事業所得（年額）", level, basis: "annual", find, path: ["business", "income"], estimate: () => businessEstimate(), help: "確定申告書の所得金額（青色申告特別控除の前）" }));
  return fields;
}

function benefitGroups(wh: WorkingHousehold, m: Member): GroupDef[] {
  const h = wh.request.input.household;
  const list = (h.retirementBenefits ?? []).filter((b) => b.member === m.id);
  const who = memberLabel(wh, m.id);
  return list.map((b) => {
    const find = byId((hh) => hh.retirementBenefits, b.id);
    return {
      key: `work/benefit/${b.id}`,
      title: `${who}の退職金・企業年金`,
      level: "simple",
      fields: [
        plain({
          key: `work/benefit/${b.id}/kind`,
          item: "retirementBenefit.kind",
          label: "種類",
          level: "detail",
          kind: "select",
          options: [
            { value: "lumpSum", label: "退職一時金" },
            { value: "db", label: "確定給付企業年金" },
            { value: "civilServantAllowance", label: "退職手当（公務員）" },
            { value: "civilServantPension", label: "年金払い退職給付（公務員）" },
            { value: "nationalPensionFund", label: "国民年金基金" },
            { value: "officerAllowance", label: "役員退職慰労金" },
          ],
          find,
          path: ["kind"],
        }),
        yenBox({ key: `work/benefit/${b.id}/amount`, item: "retirementBenefit.amount", label: "見込み額（一時金）", level: "simple", basis: "once", find, path: ["amount"], optional: true, help: "空欄のときは、見込みの計算（公務員の支給率など）を使います" }),
        timepointField({ key: `work/benefit/${b.id}/paidAt`, item: "retirementBenefit.paidAt", label: "受け取る年月", level: "detail", find, path: ["paidAt"], ageOf: (hh) => hh.members.find((x) => x.id === m.id), optional: true, absentWhenEmpty: true, nullText: "勤め先を辞めた翌月" }),
      ],
      actions: [removeAction(`work/benefit/${b.id}/remove`, "外す", "simple", (hh) => void (hh.retirementBenefits = (hh.retirementBenefits ?? []).filter((x) => x.id !== b.id)))],
    };
  });
}

function periodListGroups(wh: WorkingHousehold, m: Member): GroupDef[] {
  const h = wh.request.input.household;
  const who = memberLabel(wh, m.id);
  return periodsOf(h, m.id).map((p, i) => ({
    key: `work/period/${p.id}`,
    title: `${who}の働き方 ${i + 1}`,
    level: "detail",
    fields: periodFields(wh, m, p, byId(periods, p.id), "detail", `work/period/${p.id}`),
    actions: [removeAction(`work/period/${p.id}/remove`, "この期間を外す", "detail", (hh) => void (hh.employmentPeriods = (hh.employmentPeriods ?? []).filter((x) => x.id !== p.id)))],
  }));
}

function addPeriodAction(wh: WorkingHousehold, m: Member): ActionDef {
  return {
    key: `work/${m.id}/addPeriod`,
    label: `＋ ${memberLabel(wh, m.id)}の働き方の期間を足す`,
    level: "detail",
    run: (w) => {
      const ps = periodsOf(w.request.input.household, m.id);
      const lastEnd = ps.map((p) => p.to?.at).filter((x): x is string => x !== undefined).sort().at(-1);
      const from = lastEnd !== undefined ? addMonths(lastEnd, 1) : w.request.input.baseMonth;
      const p = convertPeriod({ id: newId(), member: m.id, from: { at: from }, to: { at: addMonths(ageReachedMonth(m, 65), -1) < from ? from : addMonths(ageReachedMonth(m, 65), -1) }, type: "partTime" }, "partTime", m, w.request.input.baseMonth);
      return mutate(w, (hh, req) => {
        (hh.employmentPeriods ??= []).push(p);
        ensureResidentTax(hh, m.id, req.input.baseMonth, newId);
      });
    },
  };
}

export function workStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const people = earners(h);
  const simple: SectionDef[] = people.map((m) => {
    const groups: GroupDef[] = [nowGroup(wh, m)];
    const r = retirementGroup(wh, m);
    if (r !== null) groups.push(r);
    groups.push(...benefitGroups(wh, m));
    const hasBenefit = (h.retirementBenefits ?? []).some((b) => b.member === m.id);
    const main = currentPeriod(h, m.id, wh.request.input.baseMonth);
    return {
      key: `work/${m.id}`,
      title: memberLabel(wh, m.id),
      level: "simple",
      groups,
      actions:
        !hasBenefit && main !== undefined
          ? [
              {
                key: `work/${m.id}/addBenefit`,
                label: "＋ 退職金を入れる",
                level: "simple",
                run: (w) => mutate(w, (hh) => void (hh.retirementBenefits ??= []).push({ id: newId(), member: m.id, kind: "lumpSum", employment: main.id, amount: estimatedBox(0, "未入力（0円で計算）") })),
              },
            ]
          : [],
    };
  });
  const detail: SectionDef = {
    key: "work/periods",
    title: "働き方の期間（詳しく）",
    note: "正社員→育休→時短→退職→パート、定年→再雇用のように、期間を分けて並べます。期間は重ならないようにします",
    level: "detail",
    groups: people.flatMap((m) => periodListGroups(wh, m)),
    actions: people.map((m) => addPeriodAction(wh, m)),
  };
  return { id: "work", label: "働き方と収入", lead: "今の働き方・年収と、定年後の予定。", sections: [...simple, detail] };
}
