// 12. 介護・親: 親の世代と介護を1枚に集める。
// - 区画A 世帯の外の家族（親〔両家〕・祖父母・兄弟姉妹・離れて暮らす子・孫など。続柄・誰の家族か・生年月・同居・家計を1つにする期間・扶養と
//   扶養の境目の1行・亡くなる見込み・勤め先の健康保険・「介護の目安を入れる（この人）」）と、生年月を持たない贈与する人（相続・贈与のカードで選ぶ）
// - 区画B 介護の費用（親・本人・配偶者。今まではライフイベントと「＋ 項目を追加」の2か所だった）。本人・配偶者の介護は自動で入れず、
//   未入力の警告と「目安で入れる（本人・配偶者）」の1押し（事務所の設定で「最初から入れる」に変えられる形。CareDefaults）
// - 区画C 親とのお金（親からの援助・親への仕送りのお金の行。moneyRows.ts の区画「care」）
// - 区画D 親のお金（詳細。0042 の簡易の家計。「この人のお金が持つかを見る」で開く）
// - 区画E 介護で働き方が変わる（介護休業は働き方の期間の物なので、働き方と収入のカードで入れる。ここは読むだけの1行）
// 欄のキーは今のまま（family/<人>/…・ev/care/<物>/…）。仮の印・保存した差分の読み替えをそのまま使うため
import type { CareExpense, Household, Member, Timepoint } from "../../../engine/types.ts";
import { careEstimate, dependentLimits } from "../../../../../hearing/src/estimates.ts";
import { masterAmount } from "../../../../../hearing/src/statistics.ts";
import { adultsWithoutCare, careTemplate, deathEstimate, fillAdultsCare, fillCareFor, hasBirth } from "../fill.ts";
import { addMonths, ageAt } from "../../levers.ts";
import { byId, field, plain, removeAction, resolveTimepoint, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type Option, type SectionDef, type StageDef } from "../form.ts";
import { estimatedBox, mutate, newId, standardBox, type WorkingHousehold } from "../household.ts";
import { DONOR_KINDS, memberLabel, SEX_OPTIONS } from "../labels.ts";
import { manYen, readGroup, readLine } from "../readLines.ts";
import { roles } from "../../roles.ts";
import { formatYearMonth, wareki } from "../units.ts";
import { moneySections } from "../moneyRows.ts";
import { careGroup, NONE_CLAIMED } from "./events.ts";
import { addMember, donorGroups, expectedBirthHint, outsidePerson, removeMember } from "./family.ts";

const members = (h: Household) => h.members;

/** 介護・親の項目に出す人（世帯の外の家族。並びは家族の役の順） */
export function outsideMembers(wh: WorkingHousehold) {
  const h = wh.request.input.household;
  const order = roles(wh.request).map((r) => r.member);
  const rest = h.members.filter((m) => !order.includes(m));
  return [...order, ...rest].filter(outsidePerson);
}

/** 世帯の外の家族の続柄（エンジンの家族の種類） */
export const OUTSIDE_KINDS: Option[] = [
  { value: "parent", label: "親" },
  { value: "grandparent", label: "祖父母" },
  { value: "sibling", label: "兄弟姉妹" },
  { value: "child", label: "子（離れて暮らす子・前の結婚の子）" },
  { value: "grandchild", label: "孫" },
  { value: "other", label: "その他の家族" },
];

/** 見せるだけの1行（このカードの中の説明。当て先も入力項目ID も持たない） */
function infoLine(key: string, label: string, value: string, note: string): FieldDef {
  return field({ key: `ro/${key}`, item: null, label, level: "detail", kind: "text", readOnly: note, get: () => ({ value }), set: (w) => w });
}

/** 仮の印（household.assumed）を持つ時点の欄: 書いたら印を外す（出来事を動かすときも） */
export function clearsAssumed(f: FieldDef): FieldDef {
  const drop = (before: WorkingHousehold, after: WorkingHousehold): WorkingHousehold => {
    if (after === before || after.assumed[f.key] === undefined) return after;
    const { [f.key]: _gone, ...rest } = after.assumed;
    void _gone;
    return { ...after, assumed: rest };
  };
  const time = f.time;
  return {
    ...f,
    set: (w, v) => drop(w, f.set(w, v)),
    ...(time !== undefined ? { time: { ...time, setWhen: (w: WorkingHousehold, tp: Timepoint | null, how: "auto" | "this") => drop(w, time.setWhen(w, tp, how)) } } : {}),
  };
}

// ---- 区画A 世帯の外の家族 ----

/** 親の扶養の境目の1行（扶養の欄の下）。年金の額が分かれば、その額と比べる */
export function dependentLimitText(wh: WorkingHousehold, m: Member): string | null {
  if (!hasBirth(m)) return null;
  const base = wh.request.input.baseMonth;
  const lim = dependentLimits(ageAt(m, base), `${base}-01`);
  if (lim === null) return null;
  const pension = m.wallet?.pension?.value ?? null;
  const tax = `税の扶養は、年金だけなら年${manYen(lim.taxPension)}まで（合計所得${manYen(lim.taxIncome)}以下）`;
  const health = lim.health === null ? `健康保険の扶養には入れません（${String(lim.lateElderlyAge)}歳からは後期高齢者医療）` : `健康保険の扶養は年収${manYen(lim.health)}未満で、同居なら扶養する人の年収の半分未満、別居なら仕送りの額より少ないこと`;
  const cmp = pension === null ? "" : `。この人の年金 年${manYen(pension)}は、税の扶養の${pension <= lim.taxPension ? "範囲です" : "範囲を超えます"}`;
  return `${tax}。${health}${cmp}`;
}

/** 世帯の外の家族の説明 */
const OUTSIDE_NOTE = "世帯の外の家族（家計が別）です。年金・給与などの収入と、その人の税・社会保険料は世帯に入りません。家計を1つにする期間を入れると、その間は印に従って生活費の人数・収入を世帯として扱います";

/** 仕送りの額の欄の説明（扶養の判定にだけ使う） */
const ALLOWANCE_HELP = "健康保険の扶養の判定（別居の親・祖父母）にだけ使い、支出には入りません。仕送りの支出は「親への仕送り」の行で入れてください（行と両方に入れても二重にはなりません）";

/** 仕送りの額の欄の値で、この人を相手にした仕送りの出るお金の行（毎月）を作る（額は欄から写した推定） */
function allowanceRow(wh: WorkingHousehold, member: string, monthly: number): WorkingHousehold {
  return mutate(wh, (h) => {
    const at = wh.request.input.baseMonth;
    (h.periodicExpenses ??= []).push({ id: newId(), label: "仕送り", kind: "allowance", counterparty: member, row: "cf.expense.other", from: { at }, to: null, everyYears: 1, monthly: true, amount: standardBox(monthly, "仕送りの額（扶養の判定に使う）の欄から") });
  });
}

/** 扶養と同居の欄（support）の片方だけを書いた後、もう片方を既定（false）で埋める（エンジンの形は2つとも要る。片方だけだと計算できない） */
const fillSupport = (_h: Household, target: Record<string, unknown>) => {
  const s = target.support as { dependent?: boolean; cohabiting?: boolean } | undefined;
  if (s === undefined) return;
  s.dependent ??= false;
  s.cohabiting ??= false;
};

/** 扶養と同居の欄（support）が無ければ作る（エンジンの形は2つとも要る） */
const ensureSupport =
  (id: string) =>
  (h: Household): Record<string, unknown> => {
    const x = h.members.find((y) => y.id === id) as Member;
    x.support ??= { dependent: false, cohabiting: false };
    return x as unknown as Record<string, unknown>;
  };

/** 見出し: 「母（78歳・同居）」 */
function outsideTitle(wh: WorkingHousehold, m: Member): string {
  const parts: string[] = [];
  if (hasBirth(m)) parts.push(`${String(ageAt(m, wh.request.input.baseMonth))}歳`);
  if (m.support?.cohabiting === true) parts.push("同居");
  return `${memberLabel(wh, m.id)}${parts.length > 0 ? `（${parts.join("・")}）` : ""}`;
}

/** 構成員の欄に当て先（向き先は構成員・入力項目ID・場所。0036 の2）を付ける */
const onMember = (id: string, f: FieldDef, at: string[] = []): FieldDef => (f.item === null ? f : { ...f, address: () => ({ target: { member: id }, item: f.item as string, at }) });

/** 世帯の外の家族1人のまとまり（区画A） */
export function outsideGroup(wh: WorkingHousehold, m: Member): GroupDef {
  const h = wh.request.input.household;
  const find = byId(members, m.id);
  const k = `family/${m.id}`;
  const base = wh.request.input.baseMonth;
  const self = h.members.find((x) => x.kind === "self");
  const spouse = h.members.find((x) => x.kind === "spouse");
  const elder = m.kind === "parent" || m.kind === "grandparent";
  const fields: FieldDef[] = [
    field({
      key: `${k}/nickname`,
      item: null,
      label: "呼び名（任意）",
      level: "simple",
      kind: "text",
      placeholder: "例: ご本人の母",
      help: "FP が付ける呼び名です。お名前は入れないでください",
      optional: true,
      get: (w) => ({ value: w.labelsByMember[m.id] ?? null }),
      set: (w, v) => {
        const { [m.id]: _old, ...rest } = w.labelsByMember;
        void _old;
        return { ...w, labelsByMember: v === null || v === "" ? rest : { ...rest, [m.id]: String(v) } };
      },
    }),
    onMember(m.id, plain({ key: `${k}/kind`, item: "member.kind", label: "続柄", level: "simple", kind: "select", options: OUTSIDE_KINDS, structural: true, find, path: ["kind"] })),
  ];
  if (m.outside !== undefined && self !== undefined && spouse !== undefined)
    fields.push(
      onMember(m.id, plain({
        key: `${k}/outside/of`,
        item: "member.outside",
        label: "誰の家族か",
        level: "simple",
        kind: "select",
        options: [
          { value: self.id, label: "本人の" },
          { value: spouse.id, label: "配偶者の" },
        ],
        find,
        path: ["outside", "of"],
        optional: true,
        fallback: self.id,
        help: "配偶者の親（義父・義母）なら「配偶者の」。相続人の数え方と贈与税の特例に使います",
      }), ["of"]),
    );
  if (hasBirth(m))
    fields.push(
      onMember(m.id, plain({
        key: `${k}/birth`,
        item: "member.birth",
        label: "生年月",
        level: "simple",
        kind: "ym",
        find,
        path: ["birth", "birthYearMonth"],
        help: "分からなければ、年齢の目安のままで計算できます",
        // 生年月が今より後（これから生まれる孫など）なら、マイナスの年齢ではなく家族のカードと同じ読み（今から○年後・本人の年齢）
        hint: (v, w) => {
          if (typeof v !== "string") return null;
          const age = ageAt({ ...m, birth: { ...m.birth, birthYearMonth: v } }, base);
          return age < 0 ? expectedBirthHint(w, v) : `${String(age)}歳（${wareki(v)}）`;
        },
      }), ["birthYearMonth"]),
      onMember(m.id, plain({ key: `${k}/sex`, item: "member.sex", label: "性別", level: "detail", kind: "select", options: SEX_OPTIONS, find, path: ["sex"], help: "亡くなる見込み（平均余命）の目安と、父・母の呼び方に使います" })),
    );
  fields.push(onMember(m.id, plain({ key: `${k}/cohabiting`, item: "member.support", label: "同居している", level: "simple", kind: "bool", find, path: ["support", "cohabiting"], ensure: ensureSupport(m.id), after: fillSupport, optional: true, fallback: false }), ["cohabiting"]));
  const actions: ActionDef[] = [{ key: `${k}/remove`, label: "この家族を外す", level: "simple", danger: true, run: (w) => removeMember(w, m.id) }];
  if (m.outside !== undefined) periodFields(m, fields, actions);
  // 扶養（税・健康保険）と、扶養の境目の1行
  if (elder) {
    fields.push(onMember(m.id, plain({ key: `${k}/dependent`, item: "member.support", label: "扶養している（税・健康保険）", level: "detail", kind: "bool", find, path: ["support", "dependent"], ensure: ensureSupport(m.id), after: fillSupport, optional: true, fallback: false }), ["dependent"]));
    const limit = dependentLimitText(wh, m);
    if (limit !== null) fields.push(infoLine(`care/outside/${m.id}/dependentLimit`, "扶養の境目（目安）", limit, "制度の値から出した目安です。年金のほかに収入がある人は、合計所得で確かめてください"));
    fields.push(onMember(m.id, plain({ key: `${k}/allowance`, item: "member.support", label: "仕送りの額（月額）", level: "detail", kind: "yen", basis: "monthly", find, path: ["support", "allowance"], ensure: ensureSupport(m.id), after: fillSupport, optional: true, help: ALLOWANCE_HELP }), ["allowance"]));
  }
  // 亡くなる見込み（世帯の外の家族では leaves がその意味。親のお金を見る期間・相続人の数え方・介護の目安の始まりに使う）
  if (m.outside !== undefined && hasBirth(m)) {
    fields.push(
      onMember(m.id, clearsAssumed(
        timepointField({
          key: `${k}/leaves`,
          item: "member.leaves",
          label: "亡くなる見込み",
          level: "detail",
          find,
          path: ["leaves"],
          ageOf: (hh) => hh.members.find((x) => x.id === m.id),
          optional: true,
          nullText: "入れない（表の最後まで）",
          help: "この人の家計（親のお金）を見る期間と、相続人の数え方は、この時点までです。「平均余命で入れる」で推定を入れられます",
        }),
      )),
    );
    const est = deathEstimate(m, base);
    if ((m.leaves === null || m.leaves === undefined) && est !== null) actions.push({ key: `${k}/leaves/estimate`, label: `亡くなる見込みを平均余命で入れる（${String(est.age)}歳ごろ）`, level: "detail", run: (w) => withDeathEstimate(w, m.id) });
    fields.push(onMember(m.id, plain({ key: `${k}/outside/employeeInsurance`, item: "member.outside", label: "勤め先の健康保険に入っている", level: "detail", kind: "bool", find, path: ["outside", "employeeInsurance"], optional: true, fallback: false, help: "入れると、仕事を辞めた後などに世帯の人をこの人の健康保険の扶養に入れられます" }), ["employeeInsurance"]));
  }
  // 仕送りの額の欄に値があって、この人を相手にした仕送りの出るお金の行が無ければ、押したときだけ行を作る（黙って支出にしない。0035 の11・0044）
  const allowance = elder ? (m.support?.allowance ?? 0) : 0;
  const hasRow = (h.periodicExpenses ?? []).some((p) => p.kind === "allowance" && p.counterparty === m.id);
  if (allowance > 0 && !hasRow) actions.push({ key: `${k}/allowanceRow`, label: "＋ 仕送りを出るお金の行にする", level: "simple", run: (w) => allowanceRow(w, m.id, allowance) });
  if (hasBirth(m) && !(h.careExpenses ?? []).some((c) => c.member === m.id)) actions.push({ key: `${k}/care/estimate`, label: "＋ 介護を推定で入れる（この人）", level: "simple", run: (w) => fillCareFor(w, m.id) });
  const notes = [...(m.outside !== undefined ? [OUTSIDE_NOTE] : []), ...(allowance > 0 && !hasRow ? ["仕送りの額は扶養の判定にだけ使い、支出には入っていません。支出にするなら「＋ 仕送りを出るお金の行にする」を押してください"] : [])];
  return { key: k, title: outsideTitle(wh, m), level: "simple", moreLabel: "扶養・仕送りなどを入れる", ...(notes.length > 0 ? { note: notes.join("。") } : {}), fields, actions };
}

/** 亡くなる見込みを平均余命で入れる（仮の印つき） */
export function withDeathEstimate(wh: WorkingHousehold, id: string): WorkingHousehold {
  const m = wh.request.input.household.members.find((x) => x.id === id);
  const est = m === undefined ? null : deathEstimate(m, wh.request.input.baseMonth);
  if (est === null) return wh;
  const next = mutate(wh, (h) => {
    const x = h.members.find((y) => y.id === id);
    if (x !== undefined) x.leaves = structuredClone(est.point);
  });
  return { ...next, assumed: { ...next.assumed, [`family/${id}/leaves`]: est.basis } };
}

/** 家計を1つにする期間（0035 の4。いまは1つ目の期間だけ。始まり・終わり・生活費の人数に入れる・収入を世帯に入れる） */
function periodFields(m: Member, fields: FieldDef[], actions: ActionDef[]): void {
  const find = byId(members, m.id);
  const periods = m.outside?.periods ?? [];
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
  const pid = periods[0]?.id;
  const on = (f: FieldDef, name: string): FieldDef => (pid === undefined ? f : onMember(m.id, f, ["periods", pid, name]));
  fields.push(
    on(timepointField({ key: `family/${m.id}/outside/from`, item: "member.outside", label: "家計を1つにする期間の始まり", level: "detail", find, path: [...at, "from"], optional: true, nullText: "最初から" }), "from"),
    on(timepointField({ key: `family/${m.id}/outside/to`, item: "member.outside", label: "家計を1つにする期間の終わり", level: "detail", find, path: [...at, "to"], optional: true, nullText: "最後まで" }), "to"),
    on(plain({ key: `family/${m.id}/outside/living`, item: "member.outside", label: "生活費の人数に入れる", level: "detail", kind: "bool", find, path: [...at, "living"], optional: true, fallback: true, help: "生活費の目安（世帯の人数ごと）の人数に入れます" }), "living"),
    on(plain({ key: `family/${m.id}/outside/income`, item: "member.outside", label: "収入を世帯に入れる", level: "detail", kind: "bool", find, path: [...at, "income"], optional: true, fallback: false, help: "その期間、この人の年金・給与などと、その人の税・社会保険料を世帯のお金として扱います" }), "income"),
  );
  if (periods.length > 1) fields.push(field({ key: `family/${m.id}/outside/more`, item: null, label: "ほかの期間", level: "detail", kind: "text", readOnly: `ほかに ${String(periods.length - 1)} つの期間があります（この画面では1つ目だけを直せます）`, get: () => ({ value: null }), set: (w) => w }));
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

/**
 * 世帯の外の家族を足す: 親・祖父母は家族のカードと同じ足し方（世帯の外の印・仮の生年月）で、亡くなる見込みは平均余命の推定。
 * 親のお金の欄は作らない（区画Dの「この人のお金が持つかを見る」で開く。空の欄があると未入力の警告が出るため）
 */
export function addOutside(wh: WorkingHousehold, kind: "parent" | "grandparent" | "sibling" | "child" | "grandchild", o: { of?: string; sex?: "male" | "female"; birthYear?: number; id?: () => string } = {}): WorkingHousehold {
  const h0 = wh.request.input.household;
  const before = new Set(h0.members.map((m) => m.id));
  const self = h0.members.find((m) => m.kind === "self");
  let next: WorkingHousehold;
  if (kind === "parent" || kind === "grandparent") next = addMember(wh, kind, o.id ?? newId);
  else {
    const id = (o.id ?? newId)();
    const [by] = wh.request.input.baseMonth.split("-").map(Number) as [number];
    const selfYear = self !== undefined ? Number(self.birth.birthYearMonth.slice(0, 4)) : by - 40;
    const year = kind === "sibling" ? selfYear : kind === "child" ? Math.min(by, selfYear + 30) : Math.min(by, selfYear + 60);
    const m: Member = { id, kind, birth: { birthYearMonth: `${String(year)}-04`, bornOnFirst: false }, sex: "male", joins: null, leaves: null, expected: false, outside: { ...(self !== undefined ? { of: self.id } : {}), periods: [] } };
    next = mutate(wh, (h) => {
      h.members.push(m);
      if (kind === "child" && self !== undefined) (h.relations ??= []).push({ type: "parentOf", parent: self.id, child: id });
    });
    next = { ...next, assumed: { ...next.assumed, [`family/${id}/birth`]: "仮の値" } };
  }
  const added = next.request.input.household.members.find((m) => !before.has(m.id));
  if (added === undefined) return next;
  next = mutate(next, (h) => {
    const x = h.members.find((y) => y.id === added.id);
    if (x === undefined) return;
    if (x.wallet !== undefined && Object.keys(x.wallet).length === 0) delete x.wallet;
    if (o.sex !== undefined) x.sex = o.sex;
    if (o.of !== undefined && x.outside !== undefined) x.outside.of = o.of;
    if (o.birthYear !== undefined) x.birth.birthYearMonth = `${String(o.birthYear)}-04`;
  });
  return kind === "parent" || kind === "grandparent" ? withDeathEstimate(next, added.id) : next;
}

/** 両家の親を一度に足す（父・母 × 本人・配偶者。仮の生年月は、それぞれの子の年齢＋30歳） */
export function addBothParents(wh: WorkingHousehold): WorkingHousehold {
  const h = wh.request.input.household;
  const sides = [h.members.find((m) => m.kind === "self"), h.members.find((m) => m.kind === "spouse")].filter((m): m is Member => m !== undefined);
  let w = wh;
  for (const side of sides) for (const sex of ["male", "female"] as const) w = addOutside(w, "parent", { of: side.id, sex, birthYear: Number(side.birth.birthYearMonth.slice(0, 4)) - 30 });
  return w;
}

const addOutsideActions = (wh: WorkingHousehold): ActionDef[] => {
  const hasParents = wh.request.input.household.members.some((m) => m.kind === "parent");
  return [
    { key: "family/add/father", label: "＋ 父を足す", level: "simple", run: (w) => addOutside(w, "parent", { sex: "male" }) },
    { key: "family/add/mother", label: "＋ 母を足す", level: "simple", run: (w) => addOutside(w, "parent", { sex: "female" }) },
    ...(hasParents ? [] : [{ key: "care/add/bothParents", label: "＋ 両家の親を足す（4人）", level: "simple" as const, run: addBothParents }]),
    { key: "family/add/grandparent", label: "＋ 祖父母を足す", level: "detail", run: (w) => addOutside(w, "grandparent") },
    { key: "care/add/sibling", label: "＋ 兄弟姉妹を足す", level: "detail", run: (w) => addOutside(w, "sibling") },
    { key: "care/add/child", label: "＋ 離れて暮らす子・前の結婚の子を足す", level: "detail", run: (w) => addOutside(w, "child") },
    { key: "care/add/grandchild", label: "＋ 孫を足す", level: "detail", run: (w) => addOutside(w, "grandchild") },
  ];
};

// ---- 区画B 介護の費用 ----

const placeOf = (c: CareExpense): "home" | "facility" => (c.place === "facility" ? "facility" : "home");

/** 介護の物の見出しの1行（「母の介護（在宅）: 2031年4月〜55か月・月5.2万円（目安）」） */
function careTitle(wh: WorkingHousehold, c: CareExpense): string {
  const h = wh.request.input.household;
  const from = resolveTimepoint(h, c.from);
  const est = careEstimate(placeOf(c));
  const months = c.months ?? est?.months;
  const monthly = c.otherMonthly?.value ?? null;
  const money = monthly !== null ? `月${manYen(monthly)}` : est !== null ? `月${manYen(est.monthly)}（目安）` : "";
  return `${memberLabel(wh, c.member)}の介護（${c.place === "facility" ? "施設" : "在宅"}）: ${from !== null ? formatYearMonth(from) : "—"}〜${months !== undefined ? `${String(months)}か月` : ""}${money !== "" ? `・${money}` : ""}`;
}

function shiftAge(t: Timepoint, months: number): Timepoint {
  const a = t.memberAge as NonNullable<Timepoint["memberAge"]>;
  const total = a.years * 12 + (a.months ?? 0) + months;
  return { memberAge: { member: a.member, years: Math.floor(total / 12), months: total % 12, ...(a.ageSwitch !== undefined ? { ageSwitch: a.ageSwitch } : {}) } };
}

function addOffset(o: Timepoint["offset"], months: number): NonNullable<Timepoint["offset"]> {
  const total = (o?.years ?? 0) * 12 + (o?.months ?? 0) + months;
  return { years: Math.trunc(total / 12), months: total % 12 };
}

/** 次の段（施設など）を足す: 始まりはこの段の始まりの形（年齢・出来事・年月）のまま期間だけずらす（年齢で入れた段は、生年月を直すと一緒に動く） */
export function addNextCareStage(wh: WorkingHousehold, id: string, newStage: string = newId()): WorkingHousehold {
  return mutate(wh, (h, req) => {
    const cur = (h.careExpenses ?? []).find((x) => x.id === id);
    if (cur === undefined) return;
    const months = cur.months ?? careEstimate(placeOf(cur))?.months ?? masterAmount("care.statistics.months") ?? 0;
    const from: Timepoint =
      cur.from.memberAge !== undefined ? shiftAge(cur.from, months) : cur.from.event !== undefined ? { event: cur.from.event, offset: addOffset(cur.from.offset, months) } : { at: addMonths(resolveTimepoint(h, cur.from) ?? req.input.baseMonth, months) };
    (h.careExpenses ??= []).push({ id: newStage, member: cur.member, from, place: "facility" });
  });
}

/** 介護の物1件（events.ts の欄に、見出しの1行と「＋ 次の段階を足す」を足す） */
function careCostGroup(wh: WorkingHousehold, c: CareExpense): GroupDef {
  const g = careGroup(wh, c);
  const est = careEstimate(placeOf(c));
  const next: ActionDef = { key: `ev/care/${c.id}/nextStage`, label: "＋ 次の段階を足す", help: "在宅から施設へなど、次の段階の介護を足します", level: "simple", run: (w) => addNextCareStage(w, c.id) };
  return { ...g, title: careTitle(wh, c), moreLabel: "期間・一時費用などを入れる", note: `入れていない額・期間は、統計の平均で推定します（${est?.basis ?? "生命保険文化センターの調査"}）`, actions: [next, ...g.actions] };
}

/** 本人・配偶者の介護が無いときの説明（未入力の警告。確かめの一覧のいちばん上にも出る。fill.ts の gapsOf） */
function adultsNote(wh: WorkingHousehold): string | null {
  const missing = adultsWithoutCare(wh.request.input.household);
  if (missing.length === 0 || wh.confirmed.includes("care")) return null;
  const est = careEstimate("home");
  const total = est === null ? "" : `（目安は1人 約${manYen(est.monthly * est.months + est.initial)}。在宅の平均の月額×期間＋一時費用）`;
  return `${missing.map((m) => memberLabel(wh, m.id)).join("・")}の介護の費用が入っていないので、0円で計算しています${total}。「推定で入れる」で統計の平均を入れるか、入れないと決めたら項目を保存してください`;
}

// ---- 区画D 親のお金（0042） ----

/** 世帯の外の家族のお金（0042）の説明 */
const WALLET_NOTE =
  "この人のお金（預金・生活費・年金・一時の入金）を入れると、介護の費用はまずこの人のお金から払い、尽きた月から世帯が払います（結果のできごとに出ます）。仕送り・援助もこの人のお金で数えます。預金を入れるまでは世帯が全部払います。税は年金の推計からの目安です";

/** 一時の入金の「未入力」の印（0円で計算。0041） */
const LUMP_UNENTERED = "未入力（0円で計算。入金の額を入れてください）";

/** 親のお金のまとまり（お金を見ている人だけ。見ていない人は区画の「＋ この人のお金が持つかを見る」） */
function walletGroup(wh: WorkingHousehold, m: Member): GroupDef {
  const find = byId(members, m.id);
  const walletOf = (h: Household): NonNullable<Member["wallet"]> | undefined => {
    const x = h.members.find((y) => y.id === m.id);
    if (x === undefined) return undefined;
    x.wallet ??= {};
    return x.wallet;
  };
  const at = (...path: string[]) => () => ({ target: { member: m.id }, item: "member.wallet", at: path });
  const fields: FieldDef[] = [
    { ...yenBox({ key: `family/${m.id}/wallet/balance`, item: "member.wallet", label: "預金など（今の残高）", level: "detail", basis: "once", find, path: ["wallet", "balance"], help: "入れるまでは、この人のお金を見ません（介護の費用は世帯が全部払います）" }), address: at("balance") },
    { ...yenBox({ key: `family/${m.id}/wallet/living`, item: "member.wallet", label: "この人の生活費（月額）", level: "detail", basis: "monthly", find, path: ["wallet", "living"], help: "物価上昇率で伸ばします。家計を1つにする期間で「生活費の人数に入れる」月は引きません" }), address: at("living") },
    {
      ...yenBox({ key: `family/${m.id}/wallet/pension`, item: "member.wallet", label: "この人の年金（年額）", level: "detail", basis: "annual", find, path: ["wallet", "pension"], optional: true, help: "推定は年金の推計です。入れると、今から毎年この額（額面）を入れます。「収入を世帯に入れる」月は世帯の収入に入ります。扶養の境目（目安）と比べるときも、この額を使います" }),
      address: at("pension"),
    },
  ];
  const actions: ActionDef[] = [];
  for (const l of m.wallet?.lumpSums ?? []) {
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
    removeAction(`family/${m.id}/wallet/remove`, "この人のお金を見るのをやめる", "detail", (h) => {
      const x = h.members.find((y) => y.id === m.id);
      if (x !== undefined) delete x.wallet;
    }),
  );
  return { key: `care/wallet/${m.id}`, title: `${memberLabel(wh, m.id)}のお金`, level: "detail", fields, actions };
}

// ---- 区画E 介護で働き方が変わる ----

/** 介護休業の働き方の期間（読むだけの1行） */
function careLeaves(wh: WorkingHousehold, h: Household) {
  return (h.employmentPeriods ?? [])
    .filter((p) => p.type === "leave" && p.leaveKind === "care")
    .map((p) => {
      const from = resolveTimepoint(h, p.from);
      const to = p.to !== null ? resolveTimepoint(h, p.to) : null;
      return readLine(`care/leave/${p.id}`, `${memberLabel(wh, p.member)}の介護休業`, `${from !== null ? formatYearMonth(from) : "—"}〜${to !== null ? formatYearMonth(to) : ""}`, "働き方と収入");
    });
}

/** 贈与する人のまとまりの見出しに添える続柄 */
function donorKindText(wh: WorkingHousehold, groupKey: string): string {
  const id = groupKey.split("/").at(-1);
  const d = (wh.request.input.household.donors ?? []).find((x) => x.id === id);
  return DONOR_KINDS.find((o) => o.value === d?.kind)?.label ?? "親族";
}

export function careStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const outside = outsideMembers(wh);
  const leaves = readGroup("care/leaves", undefined, careLeaves(wh, h));
  const adults = adultsWithoutCare(h);
  const note = adultsNote(wh);
  // 親のお金は、生年月のある世帯の外の家族だけが持てる（0042）
  const walletable = outside.filter((m) => m.outside !== undefined && hasBirth(m));
  const sections: SectionDef[] = [
    {
      key: "care/outside",
      title: "世帯の外の家族",
      note: "親（両家）・祖父母・兄弟姉妹・離れて暮らす子など、家計が別の家族です。年金などの収入は世帯に入れません。家計を1つにする期間・扶養・亡くなる見込みは「詳細」で入れます。相続・贈与の入力項目で足した、贈与する人もここに並びます",
      level: "simple",
      groups: [...outside.map((m) => outsideGroup(wh, m)), ...donorGroups(wh).map((g) => ({ ...g, title: `${g.title ?? "贈与する人"}（${donorKindText(wh, g.key)}・生年月なし）` }))],
      actions: addOutsideActions(wh),
    },
    {
      key: "care/costs",
      title: "介護の費用",
      note: note ?? "親・ご本人・配偶者の介護を、介護を受ける人ごとに入れます。在宅から施設に移るなどは「＋ 次の段階を足す」で段を並べます",
      level: "simple",
      groups: (h.careExpenses ?? []).map((c) => careCostGroup(wh, c)),
      actions: [
        ...(adults.length > 0 ? [{ key: "care/fillAdults", label: `推定で入れる（${adults.map((m) => memberLabel(wh, m.id)).join("・")}）`, level: "simple" as const, run: fillAdultsCare }] : []),
        {
          key: "ev/addCare",
          label: "＋ 介護の費用",
          level: "simple",
          run: (w) =>
            mutate(w, (hh, req) => {
              const self = hh.members.find((m) => m.kind === "self");
              const who = hh.members.find((m) => m.kind === "parent") ?? self;
              if (who === undefined) return;
              (hh.careExpenses ??= []).push(careTemplate(hh, who, req.input.baseMonth));
            }),
        },
      ],
    },
    // 親とのお金（援助・家に入れるお金＝入る、仕送り・立て替え＝出る。お金の行。0044）
    ...moneySections(wh, "care", { claimed: NONE_CLAIMED, inTitle: "親からの援助・家に入れるお金", outTitle: "親への仕送り・立て替え" }),
    {
      key: "care/wallet",
      title: "親のお金が持つか",
      note: WALLET_NOTE,
      level: "detail",
      groups: walletable.filter((m) => m.wallet !== undefined).map((m) => walletGroup(wh, m)),
      actions: walletable
        .filter((m) => m.wallet === undefined)
        .map((m) => ({ key: `family/${m.id}/wallet/add`, label: `＋ ${memberLabel(wh, m.id)}のお金が持つかを見る`, help: "この人の預金・生活費・年金を入れて、介護の費用をまずこの人のお金から払う計算にします", level: "detail" as const, run: (w: WorkingHousehold) => mutate(w, (hh) => void ((hh.members.find((y) => y.id === m.id) as Member).wallet ??= {})) })),
    },
    ...(leaves !== null ? [{ key: "care/leaves", title: "介護で働き方が変わる", note: "介護休業・時短は、働き方と収入の項目の働き方の期間で入れます（休業の種類「介護」）", level: "simple" as const, groups: [leaves], actions: [] }] : []),
  ];
  return { id: "care", label: "介護・親", lead: "親の世代（世帯の外の家族）と、介護の費用・親とのお金。", sections };
}
