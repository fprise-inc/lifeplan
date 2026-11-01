// 1. 家族: 続柄・呼び名（任意）・生年月（生年月＋1日生まれか。0012）・性別。子の独立の時期は子ども・教育のカード（0078）。家計を1つにする人だけを出す。
// 世帯の外の家族（親・祖父母など）は介護・親の項目（care.ts）、贈与する人は相続・贈与のカード（inheritance.ts）に出し、ここは読むだけの1行
import type { Household, IncomeFlowKind, Member, MoneyOutKind, Relation, Timepoint } from "../../../engine/types.ts";
import { addMonths, ageAt } from "../../levers.ts";
import { roles } from "../../roles.ts";
import { resolveTimepoint } from "../../timepoint.ts";
import { byId, field, plain, removeAction, timepointField, type ActionDef, type Val, type FieldDef, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { followStandards, LEAVES_BASIS, mutate, newId, standardLeavesPoint, type WorkingHousehold } from "../household.ts";
import { addExpense, addIncome, defaultSupportChild, moneySections, setSupportChild } from "../moneyRows.ts";
import { NONE_CLAIMED } from "./events.ts";
import { creditKey } from "../housingCredit.ts";
import { alignEducationToAge, fillEducation } from "../fill.ts";
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
    // お金の行の相手がこの人なら、相手を空にする（外した人を指したままにしない）
    for (const r of [...(h.incomeFlows ?? []), ...(h.periodicExpenses ?? [])]) if (r.counterparty === id) delete r.counterparty;
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
  const sex = kind === "spouse" ? oppositeSex(self?.sex) : "male";
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

/** 子の生年月を直したときの進路の段の合わせ（前の生年月は書く前の世帯から読む） */
function alignChild(h: Household, id: string, wh: WorkingHousehold): void {
  const before = wh.request.input.household.members.find((x) => x.id === id);
  if (before !== undefined) alignEducationToAge(h, id, wh.request.input.baseMonth, before);
}

const SPOUSE_SEX_HELP = "足したときにご本人と逆の性別を入れています。同性のご夫婦は選び直してください。遺族年金・寡婦控除・年収の目安・平均余命の計算に使います";

const oppositeSex = (sex: unknown): "male" | "female" => (sex === "female" ? "male" : "female");

/** 構成員1人のまとまり（家計を1つにする人。世帯の外の家族は介護・親の項目の形で出す。care.ts の outsideGroup） */
export function memberGroup(wh: WorkingHousehold, m: Member): GroupDef {
  const find = byId(members, m.id);
  // まだ生まれていない（生年月が計算の基準の月より後）なら、マイナスの年齢ではなく生まれる予定の欄と同じ読み（今から○年後・本人の年齢）を出す
  const ageNow = (ym: string) => {
    const age = ageAt({ ...m, birth: { ...m.birth, birthYearMonth: ym } }, wh.request.input.baseMonth);
    return age < 0 ? expectedBirthHint(wh, ym) : `${age}歳（${wareki(ym)}）`;
  };
  const fields: FieldDef[] = [
    field({
      key: `family/${m.id}/nickname`,
      item: null,
      label: "呼び名（任意）",
      // 表示だけの値（続柄から「ご本人」「第1子」などと出す）。標準には出さない
      level: "detail",
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
          help: "生まれた日は入れません（1日生まれのときだけ、「詳細」で選びます）",
          hint: (v) => (typeof v === "string" ? ageNow(v) : null),
          // 子の生年月を直したら、進路の段を新しい年齢に合わせる（終わった段を外し、前の年齢で終わっていた段を足す）
          ...(m.kind === "child" ? { after: (h: Household, _t: unknown, _v: Val, wh: WorkingHousehold) => alignChild(h, m.id, wh) } : {}),
        })),
    following(plain({ key: `family/${m.id}/bornOnFirst`, item: "member.birth", label: "1日生まれ", level: "detail", kind: "bool", find, path: ["birth", "bornOnFirst"], help: "年齢に達する月が1か月早くなります（年金・定年などの時期）。結果の差は1か月です" })),
    // 性別: 標準は本人だけ（1押し）。配偶者は足したときに本人の逆を入れ、詳細で直す（同性のご夫婦も入れられる）。性別は推定するものではないので、
    // 推定の印は付けない（初めの値を普通の値として入れる）。
    // 子の性別は計算に使わないので出さない（世帯ファイルの値は今のまま持つ。黙って書き換えない。0046 の追記 2026-10-27）
    ...(m.kind === "child"
      ? []
      : [
        plain({
          key: `family/${m.id}/sex`,
          item: "member.sex",
          label: "性別",
          level: m.kind === "self" ? "simple" : "detail",
          kind: "select",
          options: SEX_OPTIONS,
          find,
          path: ["sex"],
          help: m.kind === "spouse" ? SPOUSE_SEX_HELP : "遺族年金・寡婦控除・年収の目安・平均余命の計算に使います",
        }),
      ]),
  );
  // 子の独立は、子ども・教育のカードの詳細の「独立の時期」で入れる（education.ts の leavesField。同じ値を2か所に出さない）
  if (m.kind === "spouse") {
    const rel = relationLine(wh, m);
    if (rel !== null) fields.push(rel);
  }
  if (m.kind !== "self" && !expectedChild)
    fields.push(
      plain({ key: `family/${m.id}/expected`, item: "member.expected", label: m.kind === "spouse" ? "これから加わる（結婚の予定）" : "これから加わる", level: "detail", kind: "bool", find, path: ["expected"] }),
      timepointField({ key: `family/${m.id}/joins`, item: "member.joins", label: m.kind === "spouse" ? "結婚の予定（加わる時期）" : "加わる時期", level: "detail", find, path: ["joins"], mode: "ym", ageOf: (h) => h.members.find((x) => x.id === m.id), dateStyle: "birth", optional: true, nullText: "最初から" }),
    );
  const actions: ActionDef[] = m.kind === "self" ? [] : [{ key: `family/${m.id}/remove`, label: "この家族を外す", level: "simple", danger: true, run: (w) => removeMember(w, m.id) }];
  if (expectedChild) actions.unshift({ key: `family/${m.id}/born`, label: "生まれました（生年月を確かめて家族にする）", level: "simple", run: (w) => markBorn(w, m.id) });
  if (m.kind === "spouse") actions.push({ key: `family/${m.id}/swap`, label: "ご本人と配偶者を入れ替える", level: "detail", title: "続柄だけを入れ替えます。働き方・年金・口座・保険の名義は人に付いたままです", run: (w) => swapSelfSpouse(w) });
  return { key: `family/${m.id}`, title: memberLabel(wh, m.id), level: "simple", fields, actions };
}

// ---- これから生まれる子・独立の標準・本人と配偶者の入れ替え ----

/**
 * これから生まれる子の「生まれる予定」（生年月と加わる月を同じ月にする）。生年月の欄と同じ年月の欄で入れる（入れ方の選択は出さない）。
 * 読みは「今から2年後・ご本人39歳（令和10年10月）」の形。前の版で加わる月を年齢・出来事の形で持っている世帯は、
 * 開いただけでは書き換えない（FP が年月を入れ直したときに、生年月と加わる月をその年月にする）
 */
function expectedBirthField(m: Member): FieldDef {
  const f = plain({
    key: `family/${m.id}/birth`,
    item: "member.birth",
    label: "生まれる予定",
    level: "simple",
    kind: "ym",
    find: byId(members, m.id),
    path: ["birth", "birthYearMonth"],
    help: "生まれる予定の月（出産予定日の月）。その月から家族に加わります",
    hint: (v, wh) => (typeof v === "string" ? expectedBirthHint(wh, v) : null),
    // 年月を入れたら加わる月も同じ月にする
    after: (h, target, v, wh) => {
      target.joins = { at: v as string };
      alignChild(h, m.id, wh);
    },
  });
  // 空にはしない（生年月は要る値。空を入れても今の値のまま）
  const ok = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}$/.test(v);
  return { ...f, set: (wh, v) => (ok(v) ? f.set(wh, v) : wh), ...(f.write !== undefined ? { write: (wh: WorkingHousehold, v: Val) => (ok(v) ? f.write!(wh, v) : wh) } : {}) };
}

/** 生まれる予定の読み: 「今から2年後・ご本人39歳（令和10年10月）」。予定の月が今月より前なら「予定の月を過ぎています」 */
export function expectedBirthHint(wh: WorkingHousehold, ym: string): string {
  const base = wh.request.input.baseMonth;
  const idx = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
  const d = idx(ym) - idx(base);
  const y = Math.floor(Math.abs(d) / 12);
  const mo = Math.abs(d) % 12;
  const span = y > 0 && mo > 0 ? `${y}年${mo}か月` : y > 0 ? `${y}年` : `${mo}か月`;
  const parts = [d > 0 ? `今から${span}後` : d === 0 ? "今月" : "予定の月を過ぎています"];
  const self = wh.request.input.household.members.find((x) => x.kind === "self");
  if (self !== undefined) parts.push(`${memberLabel(wh, self.id)}${ageAt(self, ym)}歳`);
  return `${parts.join("・")}（${wareki(ym)}）`;
}

/** これから生まれる子が生まれた: 予定の印と加わる月を外す（生年月はそのまま。子の性別は聞かない） */
export function markBorn(wh: WorkingHousehold, id: string): WorkingHousehold {
  const next = mutate(wh, (h) => {
    const x = h.members.find((y) => y.id === id);
    if (x === undefined) return;
    x.expected = false;
    x.joins = null;
  });
  const { [`family/${id}/birth`]: _b, ...assumed } = next.assumed;
  void _b;
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
  return field({ key: `family/${m.id}/relation`, item: null, label: "関係", level: "simple", kind: "text", readOnly: many ? "詳細あり（「詳細」の「夫婦の関係」で直せます）" : "詳しく入れるの「夫婦の関係」で直せます", get: (w) => ({ value: relationSummary(w.request.input.household, spouseRelations(w.request.input.household, m.id)) }), set: (w) => w });
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
const RELATION_NOTE = "事実婚から入籍・離婚のように、関係を期間で分けて入れられます。期間は重ならないように、前後の段の時点を合わせます";

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
          help: i === 0 ? "入れなければ「最初から」（今も続いている関係）" : "前の段の終わりは、この前の月に合わせます",
        }),
        address: at("relation.from"),
      },
      {
        ...timepointField({
          key: `${k}/to`,
          item: "relation.to",
          label: last ? "関係の終わり（最後の月）" : "この段の終わり（最後の月）",
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
          help: last ? `離婚・別居などで関係が終わった最後の月。入れると、${who}はその翌月に世帯を離れます（収入・年金・生活費の人数に入りません）` : "次の段の始まりは、この次の月に合わせます",
        }),
        address: at("relation.to"),
      },
    ];
    const actions: ActionDef[] = [];
    if (last) actions.push({ key: `${k}/addStage`, label: "＋ 関係の段階を足す", help: "事実婚から入籍するなど、関係が変わるときに足します", level: "detail", run: (w) => addRelationStage(w, m.id) });
    if (i > 0) actions.push(removeAction(`${k}/remove`, "この段階を外す", "detail", (hh) => removeRelationStage(hh, m.id, rid)));
    if (ended) {
      actions.push(
        { key: `${k}/division`, label: "＋ 財産分与（入るお金）を足す", level: "detail", run: (w) => afterDivorceRow(w, m.id, rid, "propertyDivision") },
        { key: `${k}/childSupportIn`, label: "＋ 養育費を受け取る", level: "detail", run: (w) => afterDivorceRow(w, m.id, rid, "childSupport") },
        { key: `${k}/childSupportOut`, label: "＋ 養育費を払う", level: "detail", run: (w) => afterDivorceRow(w, m.id, rid, "childSupportOut") },
      );
    }
    const notes = [
      ...(ended ? [`関係が終わった翌月から、${who}は世帯を離れます。${who}の名義の口座・保険・住まい・車は、各項目で外すか名義を直すまで世帯の物として計算します。分ける額は財産分与の行で入れてください`] : []),
    ];
    // 配偶者の枠の中のまとまり（partOf。1件の配偶者 = 1つの枠）。区画の説明だった文は最初の段の「?」へ
    if (i === 0) notes.unshift(RELATION_NOTE);
    return [{ key: k, title: rs.length > 1 ? `夫婦の関係 ${i + 1}（${MARRIAGE_LABEL[r.marriage] ?? r.marriage}）` : "夫婦の関係", note: notes.join("。"), level: "detail", fields, actions, partOf: `family/${m.id}` }];
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

/**
 * 離婚の後のお金の行（財産分与・養育費）を、関係が終わった翌月から足す。財産分与の相手は前の配偶者。養育費の相手は養育を受ける子
 * （受け取る: 世帯の中の下の子、払う: 世帯の外の下の子。終わりはその子の20歳）で、前の配偶者は名前に書く（計算に効かないため。0044 の追記）
 */
function afterDivorceRow(wh: WorkingHousehold, memberId: string, relId: string, kind: "propertyDivision" | "childSupport" | "childSupportOut"): WorkingHousehold {
  const h = wh.request.input.household;
  const r = spouseRelations(h, memberId).find((x) => x.id === relId);
  const start = r === undefined ? null : leavesAfter(h, r.to);
  const id = newId();
  const added = kind === "childSupportOut" ? addExpense(wh, "childSupport", id) : addIncome(wh, kind as IncomeFlowKind, id);
  return mutate(added, (hh) => {
    const row = (kind === "childSupportOut" ? hh.periodicExpenses : hh.incomeFlows)?.find((x) => x.id === id) as { from: Timepoint; to?: Timepoint | null; counterparty?: string } | undefined;
    if (row === undefined) return;
    if (start !== null) {
      row.from = start;
      if (kind === "propertyDivision") row.to = structuredClone(start);
    }
    if (kind === "propertyDivision") {
      row.counterparty = memberId;
      return;
    }
    (row as { label?: string }).label = kind === "childSupportOut" ? "養育費（前の配偶者へ）" : "養育費（前の配偶者から）";
    row.to = null;
    setSupportChild(hh, row, defaultSupportChild(hh, kind === "childSupportOut" ? "out" : "in"));
  });
}

// ---- 家族のお金の行（養育費・手当・財産分与・同居の家族から・子への仕送り。0044）----

/** 手当の終わりの既定: いちばん下の子の18歳の年度末（児童扶養手当の決まりの年齢）。子がいなければ null。養育費は相手の子の20歳（moneyRows.ts） */
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
    inTitle: "入るお金",
    outTitle: "出るお金",
    note: "離れて暮らす子への仕送りを基本生活費の内訳の「仕送り」に入れているときは、ここには入れないでください（両方に入れると二重になります）。親への仕送りは介護・親の項目で入れます",
  }).map((sec) => ({
    ...sec,
    actions: sec.actions.flatMap((a): ActionDef[] => {
      const kind = a.key.split("/").at(-1) as string;
      const dir = sec.key.endsWith("/out") ? "out" : "in";
      // 仕送りは相手の子がいるときだけ（相手のいない仕送りは介護・親の項目の行になるため）
      if (dir === "out" && kind === "allowance") return kid === undefined ? [] : [{ ...a, label: "＋ 離れて暮らす子への仕送り", run: (w) => familyRow(w, "out", "allowance") }];
      return [{ ...a, run: (w) => familyRow(w, dir, kind) }];
    }),
  }));
}

/**
 * 家族の行を足す（種類のひな形に、家族の既定: 手当の終わりは下の子の18歳の年度末、養育費の相手は養育を受ける下の子〔受け取る: 世帯の中、
 * 払う: 世帯の外〕で終わりはその子の20歳、仕送りの相手は離れて暮らす子）
 */
function familyRow(wh: WorkingHousehold, dir: "in" | "out", kind: string): WorkingHousehold {
  const id = newId();
  const added = dir === "out" ? addExpense(wh, kind as MoneyOutKind, id) : addIncome(wh, kind as IncomeFlowKind, id);
  return mutate(added, (h) => {
    const row = (dir === "out" ? h.periodicExpenses : h.incomeFlows)?.find((x) => x.id === id) as { to?: Timepoint | null; counterparty?: string } | undefined;
    if (row === undefined) return;
    if (kind === "benefit") row.to = childEndPoint(h) ?? row.to ?? null;
    if (kind === "childSupport") setSupportChild(h, row, defaultSupportChild(h, dir));
    if (kind === "allowance") {
      const kid = allowanceChild(h);
      if (kid !== undefined) row.counterparty = kid;
    }
  });
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
      help: "出来事の時点は、年月か人の年齢で入れます",
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

/** 贈与する人（親・祖父母。生年月を持たない世帯の外の家族）のまとまり（介護・親の項目の世帯の外の家族に並べる。care.ts） */
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
 * 世帯の外の家族（親・祖父母と、世帯の外の印のある人）。家族のカードは「家計を1つにする人」だけにし、この人たちは介護・親の項目に出す
 * （家計を1つにする期間を入れた人も、物は介護・親の項目に属する）
 */
export const outsidePerson = (m: Member): boolean => m.outside !== undefined || m.kind === "parent" || m.kind === "grandparent";

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
      // 配偶者の「夫婦の関係」は、配偶者のまとまりの直後（配偶者の枠の中に描く。partOf）
      groups: [...order.filter((m) => !outsidePerson(m)).flatMap((m) => [memberGroup(wh, m), ...(m.id === spouse?.id ? relations : [])]), ...(ro !== null ? [ro] : [])],
      actions: [
        ...(hasSpouse
          ? []
          : [
              { key: "family/add/spouse", label: "＋ 配偶者", level: "simple" as const, run: (w: WorkingHousehold) => addMember(w, "spouse") },
              { key: "family/add/partner", label: "＋ パートナー（事実婚）", level: "simple" as const, run: (w: WorkingHousehold) => addMember(w, "spouse", newId, { marriage: "deFacto" }) },
            ]),
        // 新しく足す子は、進路を最初から推定（標準の進路の型）で入れる（古い世帯の子に黙って入れることはしない。fill.ts）
        { key: "family/add/child", label: "＋ 子", level: "simple", run: (w) => addChildWithEducation(w) },
        { key: "family/add/expectedChild", label: "＋ これから生まれる子", level: "simple", run: (w) => addChildWithEducation(w, newId, true) },
      ],
    },
    {
      key: "family/events",
      title: "出来事",
      note: "子の独立・入居・年金の受け取り開始・介護の始まりは、時点の欄の「出来事から」で選ぶと、ここに出来事として並びます。出来事の時点を直すと、その出来事に合わせた支出や予定も一緒に動きます。結婚・転職などは ＋ で足せます",
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
