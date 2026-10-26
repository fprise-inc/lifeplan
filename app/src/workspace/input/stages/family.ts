// 1. 家族: 続柄・呼び名（任意）・生年月（生年月＋1日生まれか。0012）・性別・独立の時期。家計を1つにする人だけを出す。
// 世帯の外の家族（親・祖父母など）は介護・親のカード（care.ts）、贈与する人は相続・贈与のカード（inheritance.ts）に出し、ここは読むだけの1行
import type { Household, IncomeFlowKind, Member, MoneyOutKind, Relation, Timepoint } from "../../../engine/types.ts";
import { addMonths, ageAt } from "../../levers.ts";
import { roles } from "../../roles.ts";
import { resolveTimepoint } from "../../timepoint.ts";
import { byId, field, plain, removeAction, timepointField, timeView, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { estimatedBox, followStandards, LEAVES_BASIS, mutate, newId, standardBox, standardLeavesPoint, type WorkingHousehold } from "../household.ts";
import { addExpense, addIncome, moneySections } from "../moneyRows.ts";
import { NONE_CLAIMED } from "./events.ts";
import { creditKey } from "../housingCredit.ts";
import { fillEducation } from "../fill.ts";
import { DONOR_KINDS, KIND_OPTIONS, memberLabel, memberOptions, SEX_OPTIONS } from "../labels.ts";
import { EVENT_KIND_LABEL, eventName, FP_EVENT_KINDS, freezeTimepoints, refsTo, whenPeople } from "../namedEvents.ts";
import { wareki } from "../units.ts";
import { readGroup, readLine } from "../readLines.ts";

const members = (h: Household) => h.members;

/** 欄を書いた後に、標準のままの値（表の最後の年・子の独立の年月）を新しい標準に合わせる（household.ts の followStandards） */
const following = (f: FieldDef): FieldDef => ({ ...f, set: (w, v) => followStandards(w, f.set(w, v)) });

/** 構成員を外す: その人を指す物もいっしょに外す（名義・当事者は構成員 ID で指すため。0008 の1） */
export function removeMember(wh: WorkingHousehold, id: string): WorkingHousehold {
  return followStandards(wh, removeMemberRaw(wh, id));
}

function removeMemberRaw(wh: WorkingHousehold, id: string): WorkingHousehold {
  const next = mutate(wh, (h) => {
    // その人の年齢・その人の出来事で決めた時点は、外す前の年月に直す（外した後に解けない時点を残さない。0038）
    const gone = new Set((h.events ?? []).filter((e) => e.member === id).map((e) => e.id));
    freezeTimepoints(h, (t) => t.memberAge?.member === id || (t.event !== undefined && gone.has(t.event)));
    h.events = (h.events ?? []).filter((e) => !gone.has(e.id));
    h.members = h.members.filter((m) => m.id !== id);
    h.relations = (h.relations ?? []).filter((r) => (r.type === "spouse" ? r.a !== id && r.b !== id : r.parent !== id && r.child !== id));
    h.employmentPeriods = (h.employmentPeriods ?? []).filter((e) => e.member !== id);
    h.accounts = (h.accounts ?? []).filter((a) => a.owner !== id);
    h.insuranceContracts = (h.insuranceContracts ?? []).filter((c) => c.policyholder !== id && c.insured !== id);
    for (const key of ["pensionRecords", "retirementBenefits", "careExpenses", "residentTaxAssessments", "premiumAssessments"] as const) {
      const list = h[key] as { member?: string }[] | undefined;
      if (list !== undefined) (h as Record<string, unknown>)[key] = list.filter((x) => x.member !== id);
    }
    if (h.goals !== undefined) h.goals = h.goals.filter((g) => g.owner !== id);
    if (h.debts !== undefined) {
      for (const d of h.debts) d.debtors = d.debtors.filter((x) => x.member !== id);
      h.debts = h.debts.filter((d) => d.debtors.length > 0);
    }
    if (h.donors !== undefined) for (const d of h.donors) if (d.of === id) delete d.of;
    for (const key of ["cars", "advisoryFees"] as const) {
      const list = h[key] as { owner?: string; payer?: string }[] | undefined;
      if (list !== undefined) (h as Record<string, unknown>)[key] = list.filter((x) => x.owner !== id && x.payer !== id);
    }
  });
  const { [id]: _n, ...labelsByMember } = next.labelsByMember;
  const { [id]: _p, ...postRetirement } = next.postRetirement;
  void _n;
  void _p;
  const assumed = Object.fromEntries(Object.entries(next.assumed).filter(([k]) => !k.includes(id)));
  const contingency = structuredClone(next.contingency);
  delete contingency.work[id];
  delete contingency.oldAgeChoice[id];
  return { ...next, labelsByMember, postRetirement, assumed, contingency };
}

/** 家族を足すときの選び方: 配偶者の関係の形（法律婚・事実婚）、これから生まれる子 */
export interface AddMemberOptions {
  marriage?: "legal" | "deFacto";
  expected?: boolean;
}

/** これから生まれる子を足したときの、生まれる予定の時期（今から2年後。すぐ直してもらう推定） */
export const EXPECTED_CHILD_MONTHS = 24;

/** 家族を足す。配偶者・子は関係（0008 の3 の辺）も足す */
export function addMember(wh: WorkingHousehold, kind: "spouse" | "child" | "parent" | "grandparent", id: () => string = newId, o: AddMemberOptions = {}): WorkingHousehold {
  const h0 = wh.request.input.household;
  const self = h0.members.find((m) => m.kind === "self");
  const spouse = h0.members.find((m) => m.kind === "spouse");
  const base = wh.request.input.baseMonth;
  const [by] = base.split("-").map(Number) as [number];
  const selfYear = self !== undefined ? Number(self.birth.birthYearMonth.slice(0, 4)) : by - 40;
  const newMemberId = id();
  const birthYear = kind === "spouse" ? selfYear + 2 : kind === "child" ? Math.min(by, selfYear + 32) : kind === "parent" ? selfYear - 30 : selfYear - 55;
  const sex = kind === "spouse" ? (self?.sex === "female" ? "male" : "female") : "male";
  const expected = kind === "child" && o.expected === true;
  // これから生まれる子: 生まれる予定の月（今から2年後の推定）を生年月にし、その月に加わる
  const born = expected ? addMonths(base, EXPECTED_CHILD_MONTHS) : `${birthYear}-04`;
  const m: Member = { id: newMemberId, kind, birth: { birthYearMonth: born, bornOnFirst: false }, sex, joins: expected ? { at: born } : null, leaves: null, expected };
  // 子の独立の標準: 22歳になった後の最初の3月末の翌月（年齢の時点で持つので、生年月を直すと合わせて動く）
  if (kind === "child") m.leaves = standardLeavesPoint(newMemberId);
  // 親・祖父母は世帯の外の家族（家計が別。0035 の4）。家計を1つにする期間は FP が入れる。お金（0042）の欄も出す（推定は入れず、未入力のまま。
  // 預金を入れるまでは計算に入れない）
  if ((kind === "parent" || kind === "grandparent") && self !== undefined) {
    m.outside = { of: self.id, periods: [] };
    m.wallet = {};
  }
  let next = mutate(wh, (h) => {
    h.members.push(m);
    h.relations ??= [];
    if (kind === "spouse" && self !== undefined) h.relations.push({ id: newId(), type: "spouse", a: self.id, b: m.id, marriage: o.marriage ?? "legal", from: null, to: null });
    if (kind === "child") for (const p of [self, spouse]) if (p !== undefined) h.relations.push({ id: newId(), type: "parentOf", parent: p.id, child: m.id });
  });
  // 表の最後の年は、標準のままなら配偶者を入れた標準に合わせる（人が入れた年は変えない）
  next = followStandards(wh, next);
  const marks: Record<string, string> = {
    [`family/${newMemberId}/birth`]: expected ? "推定（今から2年後。生まれる予定の月を入れてください）" : "仮の値",
    [`family/${newMemberId}/sex`]: expected ? "わからない（男性を代わりの値にして計算）" : "仮の値",
    ...(kind === "child" ? { [`family/${newMemberId}/leaves`]: LEAVES_BASIS } : {}),
  };
  return { ...next, assumed: { ...next.assumed, ...marks } };
}

/** 子を足し、その子の進路を推定（標準の進路の型）で入れる。expected はこれから生まれる子 */
export function addChildWithEducation(wh: WorkingHousehold, id: () => string = newId, expected = false): WorkingHousehold {
  const before = new Set(wh.request.input.household.members.map((m) => m.id));
  const next = addMember(wh, "child", id, { expected });
  const child = next.request.input.household.members.find((m) => !before.has(m.id));
  return child === undefined ? next : fillEducation(next, child.id);
}

/** 家族の「仕送り（月額）」は健康保険の扶養の判定（別居の親・祖父母）にだけ使い、支出の行にはしない（同じ仕送りを支出でも入れた世帯が二重にならないように） */
const ALLOWANCE_HELP = "支出には入りません（健康保険の扶養の判定に使います）。仕送りの支出は「基本生活費」の内訳の「仕送り」か、「ライフイベント」の支出で入れてください";
const ALLOWANCE_NOTE = "仕送り（月額）は健康保険の扶養の判定にだけ使い、支出には入っていません。仕送りを支出に入れるなら、「＋ 仕送りを出るお金の行にする」を押すか、「基本生活費」の内訳の「仕送り」で入れてください";

/** 仕送りの欄の額で、この人を相手にした仕送りの出るお金の行（毎月）を作る（額は欄から写した推定） */
function allowanceRow(wh: WorkingHousehold, member: string, monthly: number): WorkingHousehold {
  return mutate(wh, (h) => {
    const at = wh.request.input.baseMonth;
    (h.periodicExpenses ??= []).push({ id: newId(), label: "仕送り", kind: "allowance", counterparty: member, row: "cf.expense.other", from: { at }, to: null, everyYears: 1, monthly: true, amount: standardBox(monthly, "家族のカードの仕送り（月額）の欄から") });
  });
}

/** 構成員1人のまとまり（世帯の外の家族は介護・親のカードに出す。care.ts） */
export function memberGroup(wh: WorkingHousehold, m: Member): GroupDef {
  const find = byId(members, m.id);
  // まだ生まれていない（生年月が計算の基準の月より後）なら、マイナスの年齢ではなく「生まれる予定」と出す
  const ageNow = (ym: string) => {
    const age = ageAt({ ...m, birth: { ...m.birth, birthYearMonth: ym } }, wh.request.input.baseMonth);
    return age < 0 ? `これから生まれる予定（${wareki(ym)}）` : `${age}歳（${wareki(ym)}）`;
  };
  const fields: FieldDef[] = [
    field({
      key: `family/${m.id}/nickname`,
      item: null,
      label: "呼び名（任意）",
      level: "simple",
      kind: "text",
      placeholder: "例: 上のお子さん",
      help: "FP が付ける呼び名です。お名前は入れないでください",
      optional: true,
      get: (w) => ({ value: w.labelsByMember[m.id] ?? null }),
      set: (w, v) => {
        const { [m.id]: _old, ...rest } = w.labelsByMember;
        void _old;
        return { ...w, labelsByMember: v === null || v === "" ? rest : { ...rest, [m.id]: String(v) } };
      },
    }),
  ];
  if (m.kind !== "self")
    fields.push(
      following(plain({
        key: `family/${m.id}/kind`,
        item: "member.kind",
        label: "続柄",
        level: "simple",
        kind: "select",
        options: KIND_OPTIONS,
        structural: true,
        find,
        path: ["kind"],
      })),
    );
  const expectedChild = m.kind === "child" && m.expected === true;
  fields.push(
    expectedChild
      ? following(expectedBirthField(m))
      : following(plain({
          key: `family/${m.id}/birth`,
          item: "member.birth",
          label: "生年月",
          level: "simple",
          kind: "ym",
          find,
          path: ["birth", "birthYearMonth"],
          help: "日は聞きません（1日生まれは詳細で選びます）",
          hint: (v) => (typeof v === "string" ? ageNow(v) : null),
        })),
    following(plain({ key: `family/${m.id}/bornOnFirst`, item: "member.birth", label: "1日生まれ", level: "detail", kind: "bool", find, path: ["birth", "bornOnFirst"], help: "年齢に達する月が1か月早くなります（年金・定年などの時期）。結果の差は1か月です" })),
    plain({ key: `family/${m.id}/sex`, item: "member.sex", label: "性別", level: "simple", kind: "select", options: SEX_OPTIONS, find, path: ["sex"], help: expectedChild ? "わからないときは男性で計算します（生まれたら直してください）" : "遺族年金・年収の目安の計算に使います" }),
  );
  if (m.kind === "child")
    fields.push(
      timepointField({
        key: `family/${m.id}/leaves`,
        item: "member.leaves",
        label: "独立（世帯を離れる）",
        level: "simple",
        find,
        path: ["leaves"],
        ageOf: (h) => h.members.find((x) => x.id === m.id),
        anchor: "independence",
        optional: true,
        nullText: "独立しない・未定",
        help: "就職などで家計から離れる時点（例: 22歳・22歳の年度末・2048年4月）。標準は22歳になった後の最初の3月末の翌月（大学を出る年度末）。生活費の「末子独立後」の目安にも使います。年齢で入れると、生年月を直したとき合わせて動きます",
      }),
    );
  if (m.kind === "spouse") {
    const rel = relationLine(wh, m);
    if (rel !== null) fields.push(rel);
  }
  if (m.kind !== "self" && !expectedChild)
    fields.push(
      plain({ key: `family/${m.id}/expected`, item: "member.expected", label: m.kind === "spouse" ? "これから加わる（結婚の予定）" : "これから加わる", level: "detail", kind: "bool", find, path: ["expected"] }),
      timepointField({ key: `family/${m.id}/joins`, item: "member.joins", label: m.kind === "spouse" ? "結婚の予定（加わる時期）" : "加わる時期", level: "detail", find, path: ["joins"], mode: "ym", optional: true, nullText: "最初から" }),
    );
  if (m.kind === "parent" || m.kind === "grandparent")
    fields.push(
      plain({ key: `family/${m.id}/dependent`, item: "member.support", label: "扶養している", level: "detail", kind: "bool", find, path: ["support", "dependent"], optional: true, fallback: false }),
      plain({ key: `family/${m.id}/cohabiting`, item: "member.support", label: "同居している", level: "detail", kind: "bool", find, path: ["support", "cohabiting"], optional: true, fallback: false }),
      plain({
        key: `family/${m.id}/allowance`,
        item: "member.support",
        label: "仕送り（月額）",
        level: "detail",
        kind: "yen",
        basis: "monthly",
        find,
        path: ["support", "allowance"],
        optional: true,
        help: ALLOWANCE_HELP,
      }),
    );
  const actions: ActionDef[] = m.kind === "self" ? [] : [{ key: `family/${m.id}/remove`, label: "この家族を外す", level: "simple", danger: true, run: (w) => removeMember(w, m.id) }];
  if (expectedChild) actions.unshift({ key: `family/${m.id}/born`, label: "生まれました（生年月を確かめて家族にする）", level: "simple", run: (w) => markBorn(w, m.id) });
  // 子の独立を年月などで入れた子は、標準（22歳の年度末の翌月・年齢の時点）に戻せる
  if (m.kind === "child" && JSON.stringify(m.leaves ?? null) !== JSON.stringify(standardLeavesPoint(m.id)))
    actions.push({ key: `family/${m.id}/leavesStandard`, label: "独立を標準に戻す（22歳の年度末の翌月）", level: "detail", run: (w) => leavesToStandard(w, m.id) });
  if (m.kind === "spouse") actions.push({ key: `family/${m.id}/swap`, label: "本人と配偶者を入れ替える", level: "detail", title: "続柄だけを入れ替えます。働き方・年金・口座・保険の名義は人に付いたままです", run: (w) => swapSelfSpouse(w) });
  if (m.outside !== undefined) {
    outsideFields(m, fields, actions);
    walletFields(wh, m, fields, actions);
  }
  const allowance = m.kind === "parent" || m.kind === "grandparent" ? (m.support?.allowance ?? 0) : 0;
  // 仕送りの欄に値があって、この人を相手にした仕送りの出るお金の行が無ければ、押したときだけ行を作る（黙って支出にしない。0035 の11・0044）
  const hasRow = (wh.request.input.household.periodicExpenses ?? []).some((p) => p.kind === "allowance" && p.counterparty === m.id);
  if (allowance > 0 && !hasRow) actions.push({ key: `family/${m.id}/allowanceRow`, label: "＋ 仕送りを出るお金の行にする", level: "detail", run: (w) => allowanceRow(w, m.id, allowance) });
  const notes = [...(m.outside !== undefined ? [OUTSIDE_NOTE] : []), ...(m.outside !== undefined && m.wallet !== undefined ? [WALLET_NOTE] : []), ...(allowance > 0 && !hasRow ? [ALLOWANCE_NOTE] : [])];
  return { key: `family/${m.id}`, title: memberLabel(wh, m.id), level: "simple", ...(notes.length > 0 ? { note: notes.join("。") } : {}), fields, actions };
}

// ---- これから生まれる子・独立の標準・本人と配偶者の入れ替え ----

/**
 * これから生まれる子の「生まれる予定」（生年月と加わる月を同じ月にする）。年月・今から○年後・本人が○歳のときで入れられる。
 * 入れた時点は年月にして持つ（生年月は年月の値のため）
 */
function expectedBirthField(m: Member): FieldDef {
  const key = `family/${m.id}/birth`;
  const self = (h: Household) => h.members.find((x) => x.kind === "self");
  const read = (wh: WorkingHousehold): Timepoint | null => {
    const x = wh.request.input.household.members.find((y) => y.id === m.id);
    return x === undefined ? null : { at: x.birth.birthYearMonth };
  };
  const time = timeView({
    ageOf: self,
    mode: "ym",
    modes: ["ym", "now", "age"],
    monthOnly: "生まれる予定は年月で持ちます（今から・本人の年齢で入れても、その年月にします）",
    check: (w, tp) => (tp === null ? "空にはできません。生まれる予定の月を入れてください" : null),
    read,
    write: (w, tp) => {
      const ym = tp === null ? null : resolveTimepoint(w.request.input.household, tp);
      if (ym === null) return w;
      return mutate(w, (h) => {
        const x = h.members.find((y) => y.id === m.id);
        if (x === undefined) return;
        x.birth = { ...x.birth, birthYearMonth: ym };
        x.joins = { at: ym };
      });
    },
  });
  return field({
    key,
    item: "member.birth",
    label: "生まれる予定",
    level: "simple",
    kind: "when",
    time,
    help: "生まれる予定の月（出産予定日の月）。その月から家族に加わります",
    get: (wh) => {
      const t = read(wh);
      return { value: t?.at ?? null, hint: t?.at !== undefined ? `これから生まれる予定（${wareki(t.at)}）` : null, when: time.state(wh), assumed: wh.assumed[key] ?? null };
    },
    set: (wh, v) => {
      const tp = typeof v === "object" && v !== null ? v : typeof v === "string" && /^\d{4}-\d{2}$/.test(v) ? { at: v } : null;
      return tp === null ? wh : time.setWhen(wh, tp, "auto");
    },
  });
}

/** これから生まれる子が生まれた: 予定の印と加わる月を外す（生年月はそのまま。性別を確かめてもらう） */
export function markBorn(wh: WorkingHousehold, id: string): WorkingHousehold {
  const next = mutate(wh, (h) => {
    const x = h.members.find((y) => y.id === id);
    if (x === undefined) return;
    x.expected = false;
    x.joins = null;
  });
  const { [`family/${id}/birth`]: _b, ...assumed } = next.assumed;
  void _b;
  if (assumed[`family/${id}/sex`] !== undefined) assumed[`family/${id}/sex`] = "仮の値（生まれたら確かめてください）";
  return { ...next, assumed };
}

/** 子の独立を標準（22歳の年度末の翌月・年齢の時点）に戻す。出来事を指していれば、出来事はそのまま残し、子の独立だけを標準にする */
export function leavesToStandard(wh: WorkingHousehold, id: string): WorkingHousehold {
  const next = mutate(wh, (h) => {
    const x = h.members.find((y) => y.id === id);
    if (x !== undefined) x.leaves = standardLeavesPoint(id);
  });
  return { ...next, assumed: { ...next.assumed, [`family/${id}/leaves`]: LEAVES_BASIS } };
}

/**
 * 本人と配偶者の入れ替え: 続柄の self と spouse だけを入れ替える。物は構成員の ID で指しているので、働き方・年金・口座・保険の名義は
 * そのまま付いてくる。呼び名・定年後の予定も人に付いたまま
 */
export function swapSelfSpouse(wh: WorkingHousehold): WorkingHousehold {
  return mutate(wh, (h) => {
    for (const x of h.members) {
      if (x.kind === "self") x.kind = "spouse";
      else if (x.kind === "spouse") x.kind = "self";
    }
  });
}

// ---- 夫婦の関係（法律婚・事実婚と始まり・終わり。同じ2人の関係を期間で分けて持つ。0035 の5）----

type SpouseRelation = Extract<Relation, { type: "spouse" }>;

const MARRIAGE_OPTIONS = [
  { value: "legal", label: "法律婚（入籍している）" },
  { value: "deFacto", label: "事実婚（入籍していない）" },
];
const MARRIAGE_LABEL: Record<string, string> = { legal: "法律婚", deFacto: "事実婚" };

/** 関係の形の説明（税は事実婚を配偶者として扱わない。遺族年金は事実婚でも対象） */
const MARRIAGE_HELP = "事実婚は、配偶者控除・配偶者特別控除・住民税の非課税の判定・相続の配偶者では、配偶者として扱いません（遺族年金は事実婚でも対象です）";

/** 本人とこの人の配偶者の関係（始まりの順） */
export function spouseRelations(h: Household, memberId: string): SpouseRelation[] {
  const self = h.members.find((x) => x.kind === "self");
  if (self === undefined) return [];
  const order = (r: SpouseRelation) => (r.from === null ? "" : (resolveTimepoint(h, r.from) ?? ""));
  return (h.relations ?? [])
    .filter((r): r is SpouseRelation => r.type === "spouse" && ((r.a === self.id && r.b === memberId) || (r.b === self.id && r.a === memberId)))
    .sort((a, b) => order(a).localeCompare(order(b)));
}

const ymText = (ym: string | null) => (ym === null ? "" : `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`);

/** 関係の要約（「法律婚」「事実婚 → 2028年4月から法律婚」「法律婚（2040年3月まで）」） */
export function relationSummary(h: Household, rs: readonly SpouseRelation[]): string {
  return rs
    .map((r, i) => {
      const from = r.from === null ? null : resolveTimepoint(h, r.from);
      const to = r.to === null ? null : resolveTimepoint(h, r.to);
      const head = i > 0 && from !== null ? `${ymText(from)}から` : from !== null ? `${ymText(from)}から` : "";
      return `${head}${MARRIAGE_LABEL[r.marriage] ?? r.marriage}${to !== null ? `（${ymText(to)}まで）` : ""}`;
    })
    .join(" → ");
}

/** 配偶者のまとまりに出す、関係の読むだけの1行（直すのは詳細の「夫婦の関係」） */
function relationLine(wh: WorkingHousehold, m: Member): FieldDef | null {
  const h = wh.request.input.household;
  const rs = spouseRelations(h, m.id);
  if (rs.length === 0) return null;
  const many = rs.length > 1 || rs.some((r) => r.from !== null || r.to !== null);
  return field({ key: `family/${m.id}/relation`, item: null, label: "関係", level: "simple", kind: "text", readOnly: many ? "詳細あり（詳しく入れるの「夫婦の関係」で直せます）" : "詳しく入れるの「夫婦の関係」で直せます", get: (w) => ({ value: relationSummary(w.request.input.household, spouseRelations(w.request.input.household, m.id)) }), set: (w) => w });
}

/**
 * 配偶者が世帯を離れる月（関係の終わりの翌月）。終わりが出来事（離婚）から決めた時点なら、同じ出来事の1か月後にする（出来事を動かすと両方動く）。
 * 年月に解けなければ null
 */
const leavesAfter = (h: Household, to: Timepoint | null): Timepoint | null => {
  if (to?.event !== undefined) {
    const months = (to.offset?.years ?? 0) * 12 + (to.offset?.months ?? 0) + 1;
    return { event: to.event, ...(months !== 0 ? { offset: { months } } : {}) };
  }
  const ym = to === null ? null : resolveTimepoint(h, to);
  return ym === null ? null : { at: addMonths(ym, 1) };
};

/** 関係の時点を書いた後: 前後の段の時点を合わせ（重ならないように）、最後の段の終わりなら配偶者が世帯を離れる月も合わせる */
function fixRelations(h: Household, before: Household, memberId: string, relId: string, which: "from" | "to"): void {
  const rs = spouseRelations(h, memberId);
  const i = rs.findIndex((r) => r.id === relId);
  const r = rs[i];
  if (r === undefined) return;
  if (which === "from" && i > 0) {
    const prev = rs[i - 1] as SpouseRelation;
    const ym = r.from === null ? null : resolveTimepoint(h, r.from);
    if (ym !== null) prev.to = { at: addMonths(ym, -1) };
  }
  if (which === "to" && i < rs.length - 1) {
    const next = rs[i + 1] as SpouseRelation;
    const ym = r.to === null ? null : resolveTimepoint(h, r.to);
    if (ym !== null) next.from = { at: addMonths(ym, 1) };
  }
  if (which === "to" && i === rs.length - 1) {
    const sp = h.members.find((x) => x.id === memberId);
    if (sp === undefined) return;
    const old = spouseRelations(before, memberId).find((x) => x.id === relId);
    // 前の関係の終わりに合っていた（同じ月に解ける）なら、関係の終わりで決めた離れる月とみなす
    const was = old === undefined ? null : resolveTimepoint(before, leavesAfter(before, old.to));
    const synced = was !== null && resolveTimepoint(before, sp.leaves ?? null) === was;
    // 終わりを入れたら、配偶者はその翌月に世帯を離れる（人が入れた離れる月があれば、それが前の関係の終わりに合っていたときだけ直す）
    if (r.to !== null && (sp.leaves == null || synced)) sp.leaves = leavesAfter(h, r.to);
    else if (r.to === null && synced) sp.leaves = null;
  }
}

/** 詳細の「夫婦の関係」のまとまり（段ごと）。関係の形・始まり・終わり。離婚した後の注意と、財産分与・養育費の行を足すボタン */
function relationGroups(wh: WorkingHousehold, m: Member): GroupDef[] {
  const h = wh.request.input.household;
  const rs = spouseRelations(h, m.id);
  const who = memberLabel(wh, m.id);
  return rs.flatMap((r, i): GroupDef[] => {
    if (r.id === undefined) return [];
    const rid = r.id;
    const find = byId((hh) => hh.relations, rid);
    const k = `family/relation/${rid}`;
    const at = (item: string) => () => ({ target: { object: rid }, item, at: [] as string[] });
    const last = i === rs.length - 1;
    const ended = last && r.to !== null;
    const fields: FieldDef[] = [
      { ...plain({ key: `${k}/marriage`, item: "relation.marriage", label: "関係の形", level: "detail", kind: "select", options: MARRIAGE_OPTIONS, find, path: ["marriage"], help: MARRIAGE_HELP }), address: at("relation.marriage") },
      {
        ...timepointField({
          key: `${k}/from`,
          item: "relation.from",
          label: i === 0 ? "関係の始まり（入籍・結婚）" : "この段の始まり（入籍など）",
          level: "detail",
          find,
          path: ["from"],
          ageOf: (hh) => hh.members.find((x) => x.kind === "self"),
          mode: "ym",
          anchor: "marriage",
          optional: true,
          nullText: "最初から",
          after: (hh, _t, _v, w0) => fixRelations(hh, w0.request.input.household, m.id, rid, "from"),
          help: i === 0 ? "空欄は「最初から」（今も続いている関係）" : "前の段の終わりは、この前の月に合わせます",
        }),
        address: at("relation.from"),
      },
      {
        ...timepointField({
          key: `${k}/to`,
          item: "relation.to",
          label: last ? "関係の終わり（離婚・別居。最後の月）" : "この段の終わり（最後の月）",
          level: "detail",
          find,
          path: ["to"],
          ageOf: (hh) => hh.members.find((x) => x.kind === "self"),
          mode: "ym",
          ...(last ? { anchor: "divorce" } : {}),
          optional: true,
          nullText: last ? "今も続いている（最後まで）" : "次の段の前の月まで",
          startPath: ["from"],
          after: (hh, _t, _v, w0) => fixRelations(hh, w0.request.input.household, m.id, rid, "to"),
          help: last ? `入れると、${who}はその翌月に世帯を離れます（収入・年金・生活費の人数に入りません）` : "次の段の始まりは、この次の月に合わせます",
        }),
        address: at("relation.to"),
      },
    ];
    const actions: ActionDef[] = [];
    if (last) actions.push({ key: `${k}/addStage`, label: "＋ 関係の段階を足す（事実婚 → 入籍など）", level: "detail", run: (w) => addRelationStage(w, m.id) });
    if (i > 0) actions.push(removeAction(`${k}/remove`, "この段階を外す", "detail", (hh) => removeRelationStage(hh, m.id, rid)));
    if (ended) {
      actions.push(
        { key: `${k}/division`, label: "＋ 財産分与（入るお金）を足す", level: "detail", run: (w) => afterDivorceRow(w, m.id, rid, "propertyDivision") },
        { key: `${k}/childSupportIn`, label: "＋ 養育費を受け取る", level: "detail", run: (w) => afterDivorceRow(w, m.id, rid, "childSupport") },
        { key: `${k}/childSupportOut`, label: "＋ 養育費を払う", level: "detail", run: (w) => afterDivorceRow(w, m.id, rid, "childSupportOut") },
      );
    }
    const notes = [
      ...(ended ? [`関係が終わった翌月から、${who}は世帯を離れます。${who}の名義の口座・保険・住まい・車は、各カードで外すか名義を直すまで世帯の物として計算します。分ける額は財産分与の行で入れてください`] : []),
    ];
    return [{ key: k, title: rs.length > 1 ? `夫婦の関係 ${i + 1}（${MARRIAGE_LABEL[r.marriage] ?? r.marriage}）` : "夫婦の関係", ...(notes.length > 0 ? { note: notes.join("。") } : {}), level: "detail", fields, actions }];
  });
}

/** 関係の段階を足す: 最後の段を今から1年後の前の月で終え、翌月から別の形（事実婚なら法律婚）の段を始める。終わりがある段なら、その翌月から */
export function addRelationStage(wh: WorkingHousehold, memberId: string): WorkingHousehold {
  return mutate(wh, (h, req) => {
    const rs = spouseRelations(h, memberId);
    const last = rs.at(-1);
    if (last === undefined) return;
    const fromYm = last.from === null ? null : resolveTimepoint(h, last.from);
    const toYm = last.to === null ? null : resolveTimepoint(h, last.to);
    let start = addMonths(req.input.baseMonth, 12);
    if (fromYm !== null && start <= fromYm) start = addMonths(fromYm, 12);
    if (toYm !== null) start = addMonths(toYm, 1);
    else last.to = { at: addMonths(start, -1) };
    (h.relations ??= []).push({ id: newId(), type: "spouse", a: last.a, b: last.b, marriage: last.marriage === "deFacto" ? "legal" : "deFacto", from: { at: start }, to: null });
  });
}

/** 関係の段階を外す: 前の段の終わりを、外す段の終わりにする（つながったまま） */
function removeRelationStage(h: Household, memberId: string, relId: string): void {
  const rs = spouseRelations(h, memberId);
  const i = rs.findIndex((r) => r.id === relId);
  if (i <= 0) return;
  (rs[i - 1] as SpouseRelation).to = structuredClone((rs[i] as SpouseRelation).to);
  h.relations = (h.relations ?? []).filter((r) => r.id !== relId);
}

/** 離婚の後のお金の行（財産分与・養育費）を、関係が終わった翌月から足す。相手は前の配偶者 */
function afterDivorceRow(wh: WorkingHousehold, memberId: string, relId: string, kind: "propertyDivision" | "childSupport" | "childSupportOut"): WorkingHousehold {
  const h = wh.request.input.household;
  const r = spouseRelations(h, memberId).find((x) => x.id === relId);
  const start = r === undefined ? null : leavesAfter(h, r.to);
  const id = newId();
  const added = kind === "childSupportOut" ? addExpense(wh, "childSupport", id) : addIncome(wh, kind as IncomeFlowKind, id);
  return mutate(added, (hh) => {
    const row = (kind === "childSupportOut" ? hh.periodicExpenses : hh.incomeFlows)?.find((x) => x.id === id) as { from: Timepoint; to?: Timepoint | null; counterparty?: string } | undefined;
    if (row === undefined) return;
    row.counterparty = memberId;
    if (start !== null) {
      row.from = start;
      if (kind === "propertyDivision") row.to = structuredClone(start);
    }
    if (kind !== "propertyDivision") row.to = childEndPoint(hh) ?? row.to ?? null;
  });
}

// ---- 家族のお金の行（養育費・手当・財産分与・同居の家族から・子への仕送り。0044）----

/** 養育費・手当の終わりの既定: いちばん下の子の18歳の年度末（児童扶養手当の決まりの年齢）。子がいなければ null */
function childEndPoint(h: Household): Timepoint | null {
  const kids = h.members.filter((x) => x.kind === "child" && x.outside === undefined).sort((a, b) => b.birth.birthYearMonth.localeCompare(a.birth.birthYearMonth));
  const youngest = kids[0];
  return youngest === undefined ? null : { memberAge: { member: youngest.id, years: 18, ageSwitch: "firstMarch31AfterReach" } };
}

/** 仕送りの相手にする子（離れて暮らす子）: 世帯の外の子、無ければ独立の早い子 */
function allowanceChild(h: Household): string | undefined {
  const kids = h.members.filter((x) => x.kind === "child");
  const out = kids.find((x) => x.outside !== undefined);
  if (out !== undefined) return out.id;
  const leaves = (x: Member) => resolveTimepoint(h, x.leaves) ?? "9999-12";
  return [...kids].sort((a, b) => leaves(a).localeCompare(leaves(b)))[0]?.id;
}

/** 家族のカードの「入るお金」「出るお金」の区画（簡易の1行。足すときの既定を家族の形に合わせる） */
function familyMoney(wh: WorkingHousehold): SectionDef[] {
  const h = wh.request.input.household;
  const kid = allowanceChild(h);
  return moneySections(wh, "family", {
    claimed: NONE_CLAIMED,
    level: "simple",
    inTitle: "入るお金（養育費・手当・財産分与・同居の家族から）",
    outTitle: "出るお金（養育費・離れて暮らす子への仕送り）",
  }).map((sec) => ({
    ...sec,
    actions: sec.actions.flatMap((a): ActionDef[] => {
      const kind = a.key.split("/").at(-1) as string;
      const dir = sec.key.endsWith("/out") ? "out" : "in";
      // 仕送りは相手の子がいるときだけ（相手のいない仕送りは介護・親のカードの行になるため）
      if (dir === "out" && kind === "allowance") return kid === undefined ? [] : [{ ...a, label: "＋ 離れて暮らす子への仕送り", run: (w) => familyRow(w, "out", "allowance") }];
      return [{ ...a, run: (w) => familyRow(w, dir, kind) }];
    }),
  }));
}

/** 家族の行を足す（種類のひな形に、家族の既定: 養育費・手当の終わりは下の子の18歳の年度末、仕送りの相手は離れて暮らす子） */
function familyRow(wh: WorkingHousehold, dir: "in" | "out", kind: string): WorkingHousehold {
  const id = newId();
  const added = dir === "out" ? addExpense(wh, kind as MoneyOutKind, id) : addIncome(wh, kind as IncomeFlowKind, id);
  return mutate(added, (h) => {
    const row = (dir === "out" ? h.periodicExpenses : h.incomeFlows)?.find((x) => x.id === id) as { to?: Timepoint | null; counterparty?: string } | undefined;
    if (row === undefined) return;
    if (kind === "childSupport" || kind === "benefit") row.to = childEndPoint(h) ?? row.to ?? null;
    if (kind === "allowance") {
      const kid = allowanceChild(h);
      if (kid !== undefined) row.counterparty = kid;
    }
  });
}

/** 世帯の外の家族（0035 の4）の説明 */
const OUTSIDE_NOTE = "世帯の外の家族（家計が別）です。年金・給与などの収入と、その人の税・社会保険料は世帯に入りません。家計を1つにする期間を入れると、その間は印に従って生活費の人数・収入を世帯として扱います";

/**
 * 世帯の外の家族の欄（0035 の4）: 家計を1つにする期間（いまは1つ目の期間だけ。始まり・終わり・生活費の人数に入れる・収入を世帯に入れる）と、
 * 勤め先の健康保険に入っている（世帯の人をこの人の扶養に入れられる）。介護・親のカードを組み直すときに作り直す小さな形
 */
function outsideFields(m: Member, fields: FieldDef[], actions: ActionDef[]): void {
  const find = byId(members, m.id);
  const periods = m.outside?.periods ?? [];
  fields.push(
    plain({ key: `family/${m.id}/outside/employeeInsurance`, item: "member.outside", label: "勤め先の健康保険に入っている", level: "detail", kind: "bool", find, path: ["outside", "employeeInsurance"], optional: true, fallback: false, help: "入れると、仕事を辞めた後などに世帯の人をこの人の健康保険の扶養に入れられます" }),
  );
  if (periods.length === 0) {
    actions.push({
      key: `family/${m.id}/outside/addPeriod`,
      label: "＋ 家計を1つにする期間を足す",
      level: "detail",
      run: (w) =>
        mutate(w, (h) => {
          const x = h.members.find((y) => y.id === m.id);
          if (x?.outside !== undefined) x.outside.periods.push({ id: newId(), from: { at: w.request.input.baseMonth }, to: null, living: true, income: false });
        }),
    });
    return;
  }
  const at = ["outside", "periods", "0"];
  fields.push(
    timepointField({ key: `family/${m.id}/outside/from`, item: "member.outside", label: "家計を1つにする期間の始まり", level: "detail", find, path: [...at, "from"], optional: true, nullText: "最初から" }),
    timepointField({ key: `family/${m.id}/outside/to`, item: "member.outside", label: "家計を1つにする期間の終わり", level: "detail", find, path: [...at, "to"], optional: true, nullText: "最後まで" }),
    plain({ key: `family/${m.id}/outside/living`, item: "member.outside", label: "生活費の人数に入れる", level: "detail", kind: "bool", find, path: [...at, "living"], optional: true, fallback: true, help: "生活費の目安（世帯の人数ごと）の人数に入れます" }),
    plain({ key: `family/${m.id}/outside/income`, item: "member.outside", label: "収入を世帯に入れる", level: "detail", kind: "bool", find, path: [...at, "income"], optional: true, fallback: false, help: "その期間、この人の年金・給与などと、その人の税・社会保険料を世帯のお金として扱います" }),
  );
  if (periods.length > 1) fields.push(field({ key: `family/${m.id}/outside/more`, item: null, label: "ほかの期間", level: "detail", kind: "text", readOnly: `ほかに ${periods.length - 1} つの期間があります（この画面では1つ目だけを直せます）`, get: () => ({ value: null }), set: (w) => w }));
  actions.push({
    key: `family/${m.id}/outside/removePeriod`,
    label: "家計を1つにする期間を外す",
    level: "detail",
    run: (w) =>
      mutate(w, (h) => {
        const x = h.members.find((y) => y.id === m.id);
        if (x?.outside !== undefined) x.outside.periods.splice(0, 1);
      }),
  });
}

/** 世帯の外の家族のお金（0042）の説明 */
const WALLET_NOTE = "この人のお金（預金・生活費・年金・一時の入金）を入れると、この人が介護を受ける費用は、まずこの人のお金から払い、尽きた月から世帯が払います（尽きる見込みは結果のできごとに出ます）。預金が空欄のあいだは、介護の費用を世帯が全部払います。所得税などは年金の推計から出した目安です";

/** 一時の入金の「未入力」の印（0円で計算。0041） */
const LUMP_UNENTERED = "未入力（0円で計算。入金の額を入れてください）";

/**
 * 世帯の外の家族のお金（0042。簡易の家計）: 預金（今の残高）・生活費（月額）・年金（年額。空欄はエンジンの推計）・一時の入金。
 * 介護・親のカードを組み直す回に作り直す小さな形。お金の欄が無い人（前からの世帯）は「＋ この人のお金を入れる」で欄を出す
 */
function walletFields(wh: WorkingHousehold, m: Member, fields: FieldDef[], actions: ActionDef[]): void {
  const find = byId(members, m.id);
  const walletOf = (h: Household): NonNullable<Member["wallet"]> | undefined => {
    const x = h.members.find((y) => y.id === m.id);
    if (x === undefined) return undefined;
    x.wallet ??= {};
    return x.wallet;
  };
  if (m.wallet === undefined) {
    actions.push({ key: `family/${m.id}/wallet/add`, label: "＋ この人のお金を入れる（預金・生活費・年金）", level: "detail", run: (w) => mutate(w, (h) => void walletOf(h)) });
    return;
  }
  const at = (...path: string[]) => () => ({ target: { member: m.id }, item: "member.wallet", at: path });
  fields.push(
    {
      ...yenBox({ key: `family/${m.id}/wallet/balance`, item: "member.wallet", label: "この人の預金など（今の残高）", level: "detail", basis: "once", find, path: ["wallet", "balance"], help: "空欄のあいだは、この人のお金を見ません（介護の費用は世帯が全部払います）" }),
      address: at("balance"),
    },
    {
      ...yenBox({ key: `family/${m.id}/wallet/living`, item: "member.wallet", label: "この人の生活費（月額）", level: "detail", basis: "monthly", find, path: ["wallet", "living"], help: "物価上昇率で伸ばします。家計を1つにする期間で「生活費の人数に入れる」月は引きません" }),
      address: at("living"),
    },
    {
      ...yenBox({ key: `family/${m.id}/wallet/pension`, item: "member.wallet", label: "この人の年金（年額）", level: "detail", basis: "annual", find, path: ["wallet", "pension"], optional: true, help: "空欄は年金の推計を使います。入れると、今から毎年この額（額面）を入れます。「収入を世帯に入れる」月は世帯の収入に入ります" }),
      address: at("pension"),
    },
  );
  for (const l of m.wallet.lumpSums ?? []) {
    const lf: Finder = byId((h) => h.members.find((y) => y.id === m.id)?.wallet?.lumpSums, l.id);
    fields.push(
      { ...timepointField({ key: `family/${m.id}/wallet/lump/${l.id}/at`, item: "member.wallet", label: "一時の入金の時期", level: "detail", find: lf, path: ["at"], ageOf: (h) => h.members.find((y) => y.id === m.id), help: "家を売る・保険金など。その月にこの人のお金に入ります" }), address: at("lumpSums", l.id, "at") },
      { ...yenBox({ key: `family/${m.id}/wallet/lump/${l.id}/amount`, item: "member.wallet", label: "一時の入金の額", level: "detail", basis: "once", find: lf, path: ["amount"] }), address: at("lumpSums", l.id, "amount") },
    );
    actions.push(
      removeAction(`family/${m.id}/wallet/lump/${l.id}/remove`, "この一時の入金を外す", "detail", (h) => {
        const x = h.members.find((y) => y.id === m.id);
        if (x?.wallet?.lumpSums === undefined) return;
        x.wallet.lumpSums = x.wallet.lumpSums.filter((y) => y.id !== l.id);
        if (x.wallet.lumpSums.length === 0) delete x.wallet.lumpSums;
      }),
    );
  }
  actions.push(
    {
      key: `family/${m.id}/wallet/addLump`,
      label: "＋ 一時の入金を足す",
      level: "detail",
      run: (w) =>
        mutate(w, (h, req) => {
          const x = walletOf(h);
          if (x !== undefined) (x.lumpSums ??= []).push({ id: newId(), at: { at: addMonths(req.input.baseMonth, 12) }, amount: estimatedBox(0, LUMP_UNENTERED) });
        }),
    },
    removeAction(`family/${m.id}/wallet/remove`, "この人のお金を外す（介護の費用は世帯が払う）", "detail", (h) => {
      const x = h.members.find((y) => y.id === m.id);
      if (x !== undefined) delete x.wallet;
    }),
  );
}

// ---- 出来事（0003 の6・0038）----

/** 住宅ローン控除の仮の条件のために置いた入居（借入の年月に合わせて入れ直すので、ここでは直さない） */
const provisional = (wh: WorkingHousehold, id: string) => (wh.request.input.household.debts ?? []).some((d) => d.housing?.moveIn === id && wh.assumed[creditKey(d.id)] !== undefined);

/** 出来事ごとのまとまり: 種類・誰の・時点。時点を直すと、この出来事を指す物（独立・入居・受け取り開始など）が全部動く */
function eventGroups(wh: WorkingHousehold): GroupDef[] {
  const h = wh.request.input.household;
  const people = whenPeople(wh);
  return (h.events ?? []).map((e) => {
    const find = byId((hh) => hh.events, e.id);
    const k = `family/event/${e.id}`;
    const refs = refsTo(h, e.id);
    const fp = FP_EVENT_KINDS.includes(e.kind);
    const fields: FieldDef[] = [];
    if (fp)
      fields.push(plain({ key: `${k}/kind`, item: "event.kind", label: "出来事", level: "simple", kind: "select", options: FP_EVENT_KINDS.map((x) => ({ value: x, label: EVENT_KIND_LABEL[x] ?? x })), find, path: ["kind"] }));
    if (fp) fields.push(plain({ key: `${k}/member`, item: "event.member", label: "誰の", level: "simple", kind: "select", options: [{ value: "", label: "（世帯の）" }, ...memberOptions(wh)], find, path: ["member"], optional: true, fallback: "" }));
    const atField = timepointField({
      key: `${k}/at`,
      item: "event.at",
      label: "時点",
      level: "simple",
      find,
      path: ["at"],
      ageOf: (hh) => hh.members.find((x) => x.id === (hh.events ?? []).find((y) => y.id === e.id)?.member) ?? hh.members.find((x) => x.kind === "self"),
      mode: e.member !== undefined ? "age" : "ym",
      modes: ["age", "ym", "now"],
      help: "出来事の時点は年月か人の年齢で入れます（出来事から出来事は作りません）",
    });
    fields.push(provisional(wh, e.id) ? { ...atField, time: undefined, readOnly: "住宅ローン控除の仮の条件の入居です。借入の年月に合わせます" } : atField);
    return {
      key: k,
      title: eventName(wh, e, people),
      note: refs > 0 ? `この出来事を指している物が ${refs} 件あります。時点を直すと、全部いっしょに動きます` : "まだどの物からも指されていません。時点の欄の「出来事から」で選べます",
      level: "simple",
      fields,
      actions: refs > 0 ? [] : [removeAction(`${k}/remove`, "外す", "simple", (hh) => void (hh.events = (hh.events ?? []).filter((x) => x.id !== e.id)))],
    };
  });
}

/** 贈与する人（親・祖父母）のまとまり（相続・贈与のカードに出す。inheritance.ts） */
export function donorGroups(wh: WorkingHousehold): GroupDef[] {
  return (wh.request.input.household.donors ?? []).map((d, i) => {
    const find = byId((h) => h.donors, d.id);
    const used = usesOfDonor(wh.request.input.household, d.id);
    return {
      key: `family/donor/${d.id}`,
      title: `贈与する人 ${i + 1}`,
      level: "simple",
      ...(used > 0 ? { note: `援助 ${used} 件で選ばれています` } : {}),
      fields: [
        plain({ key: `family/donor/${d.id}/kind`, item: "donor.kind", label: "続柄", level: "simple", kind: "select", options: DONOR_KINDS, find, path: ["kind"] }),
        plain({
          key: `family/donor/${d.id}/of`,
          item: "donor.of",
          label: "誰の親・祖父母か",
          level: "simple",
          kind: "select",
          options: [{ value: "", label: "受け取る人の" }, ...memberOptions(wh, (m) => m.kind === "self" || m.kind === "spouse")],
          find,
          path: ["of"],
          fallback: "",
          optional: true,
          help: "受け取る人がこの家族なら親、その子なら祖父母（直系尊属）として贈与税を計算します",
        }),
      ],
      actions: [
        removeAction(`family/donor/${d.id}/remove`, "外す", "simple", (h) => {
          h.donors = (h.donors ?? []).filter((x) => x.id !== d.id);
          for (const r of h.residences ?? []) for (const g of r.purchase?.gifts ?? []) if (g.donor === d.id) delete g.donor;
          for (const goal of h.goals ?? []) for (const g of goal.education?.gifts ?? []) if (g.donor === d.id) delete g.donor;
          if (h.donors.length === 0) delete h.donors;
        }),
      ],
    };
  });
}

function usesOfDonor(h: Household, id: string): number {
  let n = 0;
  for (const r of h.residences ?? []) for (const g of r.purchase?.gifts ?? []) if (g.donor === id) n++;
  for (const goal of h.goals ?? []) for (const g of goal.education?.gifts ?? []) if (g.donor === id) n++;
  return n;
}

/**
 * 世帯の外の家族（親・祖父母と、世帯の外の印のある人）。家族のカードは「家計を1つにする人」だけにし、この人たちは介護・親のカードに出す
 * （家計を1つにする期間を入れた人も、物は介護・親のカードに属する）
 */
export const outsidePerson = (m: Member): boolean => m.outside !== undefined || m.kind === "parent" || m.kind === "grandparent";

/** 世帯の外の家族を足す（介護・親のカードの「＋ 親を足す」） */
export const addOutsideActions = (): ActionDef[] => [
  { key: "family/add/parent", label: "＋ 親を足す", level: "simple", run: (w) => addMember(w, "parent") },
  { key: "family/add/grandparent", label: "＋ 祖父母を足す", level: "detail", run: (w) => addMember(w, "grandparent") },
];

/** 贈与する人を足す（相続・贈与のカード） */
export function addDonorActions(wh: WorkingHousehold): ActionDef[] {
  const selfId = wh.request.input.household.members.find((m) => m.kind === "self")?.id;
  return [
    {
      key: "family/add/donor-parent",
      label: "＋ 親を足す",
      level: "simple",
      run: (w) => mutate(w, (hh) => void (hh.donors ??= []).push({ id: newId(), kind: "parent", ...(selfId !== undefined ? { of: selfId } : {}) })),
    },
    {
      key: "family/add/donor-grandparent",
      label: "＋ 祖父母を足す",
      level: "simple",
      run: (w) => mutate(w, (hh) => void (hh.donors ??= []).push({ id: newId(), kind: "grandparent", ...(selfId !== undefined ? { of: selfId } : {}) })),
    },
  ];
}

export function familyStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const order = roles(wh.request).map((r) => r.member);
  const hasSpouse = h.members.some((m) => m.kind === "spouse");
  const outside = h.members.filter(outsidePerson);
  const donors = h.donors ?? [];
  // 世帯の外の家族・贈与する人は、介護・親／相続・贈与のカードで入れる（ここは読むだけの1行）
  const ro = readGroup("family/elsewhere", undefined, [
    ...(outside.length > 0 ? [readLine("family/outside", "世帯の外の家族", outside.map((m) => memberLabel(wh, m.id)).join("・"), "介護・親")] : []),
    ...(donors.length > 0 ? [readLine("family/donors", "贈与する人（親・祖父母）", `${donors.length}人`, "相続・贈与")] : []),
  ]);
  const spouse = h.members.find((m) => m.kind === "spouse");
  const relations = spouse === undefined ? [] : relationGroups(wh, spouse);
  const sections: SectionDef[] = [
    {
      key: "family/members",
      title: "家族の構成",
      note: "お名前の欄はありません。続柄と、必要なら FP が付ける呼び名で表します",
      level: "simple",
      groups: [...order.filter((m) => !outsidePerson(m)).map((m) => memberGroup(wh, m)), ...(ro !== null ? [ro] : [])],
      actions: [
        ...(hasSpouse
          ? []
          : [
              { key: "family/add/spouse", label: "＋ 配偶者（法律婚）", level: "simple" as const, run: (w: WorkingHousehold) => addMember(w, "spouse") },
              { key: "family/add/partner", label: "＋ パートナー（事実婚）", level: "simple" as const, run: (w: WorkingHousehold) => addMember(w, "spouse", newId, { marriage: "deFacto" }) },
            ]),
        // 新しく足す子は、進路を最初から推定（標準の進路の型）で入れる（古い世帯の子に黙って入れることはしない。fill.ts）
        { key: "family/add/child", label: "＋ 子", level: "simple", run: (w) => addChildWithEducation(w) },
        { key: "family/add/expectedChild", label: "＋ これから生まれる子", level: "simple", run: (w) => addChildWithEducation(w, newId, true) },
      ],
    },
    ...(relations.length > 0
      ? [
          {
            key: "family/relations",
            title: "夫婦の関係（法律婚・事実婚と始まり・終わり）",
            note: "事実婚から入籍・離婚のように、関係を期間で分けて入れられます。期間は重ならないように、前後の段の時点を合わせます",
            level: "detail" as const,
            groups: relations,
            actions: [],
          },
        ]
      : []),
    {
      key: "family/events",
      title: "出来事",
      note: "子の独立・入居・年金の受け取り開始・介護の始まりは、時点の欄の「出来事から」で選ぶと、ここに出来事として並びます。出来事の時点を直すと、指している物が全部いっしょに動きます。結婚・転職などは ＋ で足せます",
      level: "detail",
      groups: eventGroups(wh),
      actions: [
        {
          key: "family/add/event",
          label: "＋ 出来事を足す",
          level: "detail",
          run: (w) => mutate(w, (hh, req) => void (hh.events ??= []).push({ id: newId(), kind: "other", at: { at: addMonths(req.input.baseMonth, 12) } })),
        },
      ],
    },
  ];
  return { id: "family", label: "家族", lead: "家族の構成と生年月。氏名は入れません。", sections: [...sections, ...familyMoney(wh)] };
}
