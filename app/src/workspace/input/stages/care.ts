// 12. 介護・親: 親の世代と介護を1枚に集める。
// - 区画A 世帯の外の家族（親〔両家〕・祖父母・兄弟姉妹・離れて暮らす子など。孫〔あげる贈与の相手〕は相続・贈与のカードに置き、ここは読むだけの1行。続柄・誰の家族か・生年月・同居・家計を1つにする期間・扶養と
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
import { addCareTemplate, adultsCareDeclined, adultsWithoutCare, careStartKey, careTemplateStart, deathEstimate, fillAdultsCare, fillCareFor, hasBirth } from "../fill.ts";
import { sameWhen } from "../when.ts";
import { addMonths, ageAt } from "../../levers.ts";
import { byId, field, plain, removeAction, resolveTimepoint, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type Option, type SectionDef, type StageDef } from "../form.ts";
import { estimatedBox, mutate, newId, standardBox, type WorkingHousehold } from "../household.ts";
import { DONOR_KINDS, donorUses, memberLabel, SEX_OPTIONS, WORDS } from "../labels.ts";
import { manYen, readGroup, readLine } from "../readLines.ts";
import { roles } from "../../roles.ts";
import { formatYearMonth, wareki } from "../units.ts";
import { addExpense, moneySections } from "../moneyRows.ts";
import { careGroup, carePayerLine, NONE_CLAIMED } from "./events.ts";
import { addMember, donorGroups, expectedBirthHint, outsidePerson, removeMember } from "./family.ts";
import { afterWrite, donorTitles, followInheritTiming } from "./inheritance.ts";

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

/** 見せるだけの1行（このカードの中の説明。当て先も入力項目ID も持たない）。長い説明は help（「?」の中） */
function infoLine(key: string, label: string, value: string, note: string, help?: string): FieldDef {
  return field({ key: `ro/${key}`, item: null, label, level: "detail", kind: "text", readOnly: note, ...(help !== undefined ? { help } : {}), get: () => ({ value }), set: (w) => w });
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

/** 後期高齢者医療に入る年齢（制度の値。読めなければ75歳） */
function lateElderlyAge(wh: WorkingHousehold, m: Member): number {
  const base = wh.request.input.baseMonth;
  return dependentLimits(hasBirth(m) ? ageAt(m, base) : 0, `${base}-01`)?.lateElderlyAge ?? 75;
}

/** 後期高齢者医療の年齢（75歳）以上か（健康保険の扶養に入れない・勤め先の健康保険の欄を出さない） */
function lateElderly(wh: WorkingHousehold, m: Member): boolean {
  return hasBirth(m) && ageAt(m, wh.request.input.baseMonth) >= lateElderlyAge(wh, m);
}

/**
 * 扶養の境目の欄に出す短い値（全文は「?」の中。0077）: 年金の額が分かれば「年金 年80万円は、税の扶養の範囲です」、
 * 分からなければ「税の扶養は、年金だけなら年158万円まで」
 */
export function dependentLimitShort(wh: WorkingHousehold, m: Member): string | null {
  if (!hasBirth(m)) return null;
  const base = wh.request.input.baseMonth;
  const lim = dependentLimits(ageAt(m, base), `${base}-01`);
  if (lim === null) return null;
  const pension = m.wallet?.pension?.value ?? null;
  return pension === null ? `税の扶養は、年金だけなら年${manYen(lim.taxPension)}まで` : `年金 年${manYen(pension)}は、税の扶養の${pension <= lim.taxPension ? "範囲です" : "範囲を超えます"}`;
}

/** 呼び名の入力例（続柄と誰の家族かから。父の欄に「ご本人の母」と出さない） */
function nicknameExample(h: Household, m: Member): string {
  const spouseSide = m.outside?.of !== undefined && h.members.find((x) => x.id === m.outside?.of)?.kind === "spouse";
  switch (m.kind) {
    case "parent":
      return m.sex === "female" ? (spouseSide ? "例: 義母（遠方）" : "例: 実家の母") : spouseSide ? "例: 義父（遠方）" : "例: 実家の父";
    case "grandparent":
      return m.sex === "female" ? "例: 母方の祖母" : "例: 父方の祖父";
    case "sibling":
      return "例: 兄（大阪）";
    case "child":
      return "例: 前の結婚の子";
    case "grandchild":
      return "例: 長男の子";
    default:
      return "例: おじ";
  }
}

/** 親の扶養の境目の1行の全文（扶養の欄の「?」）。年金の額が分かれば、その額と比べる */
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

/** 仕送りの額の欄の値で、この人を相手にした仕送りの出るお金の行（毎月）を作る（額は欄から写した推定。伸び方は仕送りの既定の「変えない」。0044 の追記 2026-11-10） */
function allowanceRow(wh: WorkingHousehold, member: string, monthly: number): WorkingHousehold {
  return mutate(wh, (h) => {
    const at = wh.request.input.baseMonth;
    (h.periodicExpenses ??= []).push({ id: newId(), label: "仕送り", kind: "allowance", counterparty: member, row: "cf.expense.other", from: { at }, to: null, everyYears: 1, monthly: true, amount: standardBox(monthly, "仕送りの額（扶養の判定に使う）の欄から"), growth: { kind: "none" } });
  });
}

/** この人を相手にした仕送りの出るお金の行（毎月・額は未入力）を足す */
function addAllowanceRow(wh: WorkingHousehold, member: string): WorkingHousehold {
  const before = new Set((wh.request.input.household.periodicExpenses ?? []).map((p) => p.id));
  const next = addExpense(wh, "allowance");
  return mutate(next, (h) => {
    const p = (h.periodicExpenses ?? []).find((x) => !before.has(x.id));
    if (p !== undefined) p.counterparty = member;
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
  // 続柄・呼び名は詳細（足すボタンで続柄が決まり、見出し「父（92歳）」で分かる）。標準は誰の家族か・生年月・同居の3欄
  const fields: FieldDef[] = [
    field({
      key: `${k}/nickname`,
      item: null,
      label: "呼び名（任意）",
      level: "detail",
      kind: "text",
      example: nicknameExample(h, m),
      help: "FP が付ける呼び名です。お名前は入れないでください",
      optional: true,
      get: (w) => ({ value: w.labelsByMember[m.id] ?? null }),
      set: (w, v) => {
        const { [m.id]: _old, ...rest } = w.labelsByMember;
        void _old;
        return { ...w, labelsByMember: v === null || v === "" ? rest : { ...rest, [m.id]: String(v) } };
      },
    }),
    onMember(m.id, plain({ key: `${k}/kind`, item: "member.kind", label: "続柄", level: "detail", kind: "select", options: OUTSIDE_KINDS, structural: true, find, path: ["kind"] })),
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
          { value: self.id, label: "ご本人の" },
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
      // 生年月を直したら、推定のままの亡くなる見込み（平均余命の仮の印）を新しい年齢で入れ直す（前は前の年齢の推定のまま残り、
      // 92歳の父に「87歳（2021年）」のような過去の見込みが出た）。FP が入れた見込みは変えない
      onMember(m.id, afterWrite(plain({
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
      }), (_before, after) => (after.assumed[`${k}/leaves`] !== undefined ? withDeathEstimate(after, m.id) : after)), ["birthYearMonth"]),
      onMember(m.id, plain({ key: `${k}/sex`, item: "member.sex", label: "性別", level: "detail", kind: "select", options: SEX_OPTIONS, find, path: ["sex"], help: "亡くなる見込み（平均余命）の目安と、父・母の呼び方に使います" })),
    );
  // 同居の印は扶養の判定に使うだけで、家計は別のまま（家計を1つにするのは期間。印を付けたら欄の下に1行と「＋ 家計を1つにする」）
  const periods = m.outside?.periods ?? [];
  fields.push(
    onMember(m.id, plain({
      key: `${k}/cohabiting`,
      item: "member.support",
      label: "同居している",
      level: "simple",
      kind: "bool",
      find,
      path: ["support", "cohabiting"],
      ensure: ensureSupport(m.id),
      after: fillSupport,
      optional: true,
      fallback: false,
      hint: (v) => (v === true && m.outside !== undefined && periods.length === 0 ? "同居でも家計は別として計算します（扶養の判定に使います）。家計が1つなら「＋ 家計を1つにする」" : null),
    }), ["cohabiting"]),
  );
  const actions: ActionDef[] = [{ key: `${k}/remove`, label: WORDS.remove, level: "simple", danger: true, run: (w) => removeMember(w, m.id) }];
  if (m.outside !== undefined) periodFields(m, fields, actions, m.support?.cohabiting === true);
  // 扶養（税・健康保険。75歳からは健康保険の扶養に入れないので税だけ）と、扶養の境目の1行（全文は「?」）
  const late = lateElderly(wh, m);
  if (elder) {
    fields.push(onMember(m.id, plain({ key: `${k}/dependent`, item: "member.support", label: late ? "扶養している（税）" : "扶養している（税・健康保険）", level: "detail", kind: "bool", find, path: ["support", "dependent"], ensure: ensureSupport(m.id), after: fillSupport, optional: true, fallback: false }), ["dependent"]));
    const limit = dependentLimitText(wh, m);
    const short = dependentLimitShort(wh, m);
    if (limit !== null && short !== null) fields.push(infoLine(`care/outside/${m.id}/dependentLimit`, "扶養の境目（目安）", short, "制度の値から出した目安です。年金のほかに収入がある人は、合計所得で確かめてください", `${limit}。制度の値から出した目安です。年金のほかに収入がある人は、合計所得で確かめてください`));
    // 仕送りの行（相手がこの人）があれば、扶養の判定は行の額を使うので、仕送りの額の欄は出さない（前に入れた欄の値は残す。行が無くなれば使う）。
    // 行が無ければ欄を出し（扶養の判定にだけ使う）、「＋ 仕送り（毎月）」で行も足せる
    const rowsTo = (h.periodicExpenses ?? []).filter((p) => p.kind === "allowance" && p.counterparty === m.id);
    if (rowsTo.length > 0) fields.push(infoLine(`care/outside/${m.id}/allowanceRows`, "仕送りの額（扶養の判定）", "親への仕送りの行の額を使います", "別居の親の健康保険の扶養の判定は、この人を相手にした仕送りの行の額（月額の12か月分）と比べます"));
    else fields.push(onMember(m.id, plain({ key: `${k}/allowance`, item: "member.support", label: "仕送りの額（月額）", level: "detail", kind: "yen", basis: "monthly", find, path: ["support", "allowance"], ensure: ensureSupport(m.id), after: fillSupport, optional: true, help: ALLOWANCE_HELP }), ["allowance"]));
  }
  // この人の年金（年額）: 扶養の境目・家計を1つにする期間の収入・親のお金のどれにも使うので、人の詳細に置く（値の場所は親のお金 member.wallet.pension のまま）
  if (m.outside !== undefined && hasBirth(m)) fields.push(pensionField(m));
  // 亡くなる見込み（世帯の外の家族では leaves がその意味。親のお金を見る期間・相続人の数え方・介護の目安の始まりに使う）
  if (m.outside !== undefined && hasBirth(m)) {
    fields.push(
      onMember(m.id, afterWrite(clearsAssumed(
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
          help: "この人の家計（親のお金）を見る期間と、相続人の数え方は、この時点までです。介護の費用もこの月から出しません。推定のままの相続の受け取る時期はこの時点についてきます。「平均余命で入れる」で推定を入れられます",
        }),
      ), (_before, after) => followInheritTiming(after, m.id))),
    );
    const est = deathEstimate(m, base);
    if ((m.leaves === null || m.leaves === undefined) && est !== null) actions.push({ key: `${k}/leaves/estimate`, label: `亡くなる見込みを平均余命で入れる（${String(est.age)}歳ごろ）`, level: "detail", run: (w) => withDeathEstimate(w, m.id) });
    // 勤め先の健康保険: 75歳からは後期高齢者医療なので出さない（前に印を付けた人は残す）
    if (!late || m.outside.employeeInsurance === true)
      fields.push(onMember(m.id, plain({ key: `${k}/outside/employeeInsurance`, item: "member.outside", label: "勤め先の健康保険に入っている", level: "detail", kind: "bool", find, path: ["outside", "employeeInsurance"], optional: true, fallback: false, help: "入れると、仕事を辞めた後などに世帯の人をこの人の健康保険の扶養に入れられます" }), ["employeeInsurance"]));
  }
  // 仕送りの額の欄に値があって、この人を相手にした仕送りの出るお金の行が無ければ、押したときだけ行を作る（黙って支出にしない。0035 の11・0044）
  const allowance = elder ? (m.support?.allowance ?? 0) : 0;
  const hasRow = (h.periodicExpenses ?? []).some((p) => p.kind === "allowance" && p.counterparty === m.id);
  if (allowance > 0 && !hasRow) actions.push({ key: `${k}/allowanceRow`, label: "＋ 仕送りを出るお金の行にする", level: "simple", run: (w) => allowanceRow(w, m.id, allowance) });
  if (hasBirth(m) && !(h.careExpenses ?? []).some((c) => c.member === m.id)) actions.push({ key: `${k}/care/estimate`, label: `＋ ${memberLabel(wh, m.id)}の介護を入れる`, level: "simple", run: (w) => fillCareFor(w, m.id) });
  // 「＋ 仕送り（毎月）」は詳細だけのボタンなので、標準にも出るボタンの後ろに置く（詳細に切り替えても標準のボタンの位置が動かない）
  if (elder && !hasRow && !(allowance > 0))
    actions.push({ key: `${k}/allowanceAdd`, label: "＋ 仕送り（毎月）", help: "この人への仕送りを、親への仕送りの行（毎月）で足します。別居の親の健康保険の扶養の判定にも、この行の額を使います", level: "detail", run: (w) => addAllowanceRow(w, m.id) });
  const gifts = donorUses(h, m.id);
  const notes = [
    ...(m.outside !== undefined ? [OUTSIDE_NOTE] : []),
    ...(allowance > 0 && !hasRow ? ["仕送りの額は扶養の判定にだけ使い、支出には入っていません。支出にするなら「＋ 仕送りを出るお金の行にする」を押してください"] : []),
    ...(gifts > 0 ? [`住宅資金・教育資金などの援助 ${String(gifts)} 件で、贈与する人に選ばれています`] : []),
  ];
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
  return followInheritTiming({ ...next, assumed: { ...next.assumed, [`family/${id}/leaves`]: est.basis } }, id);
}

/** 同居の親と家計を1つにする（1押し）: 今から最後まで、生活費の人数に入れて収入（年金）も世帯に入れる期間を1つ作る */
export function joinHousehold(wh: WorkingHousehold, id: string): WorkingHousehold {
  if ((wh.request.input.household.members.find((m) => m.id === id)?.outside?.periods.length ?? 1) > 0) return wh;
  return mutate(wh, (h) => {
    const x = h.members.find((y) => y.id === id);
    if (x?.outside !== undefined && x.outside.periods.length === 0) x.outside.periods.push({ id: newId(), from: { at: wh.request.input.baseMonth }, to: null, living: true, income: true });
  });
}

/** この人の年金（年額）の欄（人の詳細。値は親のお金の member.wallet.pension） */
function pensionField(m: Member): FieldDef {
  const find = byId(members, m.id);
  return {
    ...yenBox({ key: `family/${m.id}/wallet/pension`, item: "member.wallet", label: "この人の年金（年額）", level: "detail", basis: "annual", find, path: ["wallet", "pension"], optional: true, help: "推定は年金の推計です。入れると、今から毎年この額（額面）を入れます。扶養の境目（目安）と比べるとき・家計を1つにする期間の「収入を世帯に入れる」月・親のお金が持つかを見るときに、この額を使います" }),
    address: () => ({ target: { member: m.id }, item: "member.wallet", at: ["pension"] }),
  };
}

/** 家計を1つにする期間（0035 の4。いまは1つ目の期間だけ。始まり・終わり・生活費の人数に入れる・収入を世帯に入れる） */
function periodFields(m: Member, fields: FieldDef[], actions: ActionDef[], cohabiting = false): void {
  const find = byId(members, m.id);
  const periods = m.outside?.periods ?? [];
  if (periods.length === 0) {
    // 同居の印を付けた人は、今から家計を1つにする1押し（標準）。ほかの人は詳細で期間を足す
    if (cohabiting) {
      actions.push({ key: `family/${m.id}/outside/join`, label: "＋ 家計を1つにする（今から・生活費の人数と年金を世帯に入れる）", help: "今から最後まで、この人を生活費の人数に入れ、年金などの収入も世帯のお金として扱う期間を作ります（終わり・印は詳細で直せます）。年金の額は詳細の「この人の年金（年額）」で入れます", level: "simple", run: (w) => joinHousehold(w, m.id) });
      return;
    }
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

/** その人（ご本人・配偶者）の親のうち、まだいない父・母 */
function missingParents(h: Household, side: Member): ("male" | "female")[] {
  const self = h.members.find((m) => m.kind === "self");
  const ofSide = h.members.filter((m) => m.kind === "parent" && (m.outside?.of ?? self?.id) === side.id);
  return (["male", "female"] as const).filter((sex) => !ofSide.some((m) => m.sex === sex));
}

/** ご本人・配偶者の父母（まだいない方）を足す。仮の生年月は、その人の年齢＋30歳 */
export function addParentsOf(wh: WorkingHousehold, sideId: string): WorkingHousehold {
  const h = wh.request.input.household;
  const side = h.members.find((m) => m.id === sideId);
  if (side === undefined) return wh;
  return missingParents(h, side).reduce((w, sex) => addOutside(w, "parent", { of: side.id, sex, birthYear: Number(side.birth.birthYearMonth.slice(0, 4)) - 30 }), wh);
}

/**
 * 親を足すボタン（介護・親と相続・贈与で同じ形）: 「＋ ご本人の親を足す」「＋ 配偶者の親を足す」（配偶者がいなければ「＋ 親を足す」）を押すと、
 * その場で「父」「母」「父母」から選ぶ（1つの「＋」の選択肢。0040 の追記）。いる方は選択肢に出さず、両方いればボタンを出さない。
 * 足した人は世帯の外の家族（亡くなる見込みは平均余命の推定）で、受け取る相続の相手にも、援助の贈与する人にも選べる。
 * keyHead は入力項目ごとの頭（介護・親は今までのキー〔ご本人の父・母は family/add/father・mother〕のまま）
 */
export function parentAddActions(wh: WorkingHousehold, keyHead: "care" | "inherit" = "care"): ActionDef[] {
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self");
  const spouse = h.members.find((m) => m.kind === "spouse" && m.expected !== true);
  if (self === undefined) return [];
  const help = "選んだ親を、世帯の外の家族（家計が別）として足します。亡くなる見込みは平均余命の推定です。足した親は、受け取る相続の相手にも、住宅資金・教育資金の援助の贈与する人にも選べます";
  const sideActions = (side: Member, isSelf: boolean): ActionDef[] => {
    const missing = missingParents(h, side);
    if (missing.length === 0) return [];
    const key = (what: "father" | "mother" | "both") =>
      keyHead === "care" && isSelf ? (what === "both" ? "care/add/selfParents" : `family/add/${what}`) : `${keyHead}/add/${isSelf ? "self" : "spouse"}${what === "father" ? "Father" : what === "mother" ? "Mother" : "Parents"}`;
    const choice = { key: `${keyHead}/add/parents/${isSelf ? "self" : "spouse"}`, label: spouse === undefined ? "＋ 親を足す" : `＋ ${isSelf ? "ご本人" : "配偶者"}の親を足す`, help };
    const one = (sex: "male" | "female") => (w: WorkingHousehold) => addOutside(w, "parent", { of: side.id, sex, birthYear: Number(side.birth.birthYearMonth.slice(0, 4)) - 30 });
    return [
      ...missing.map((sex): ActionDef => ({ key: key(sex === "male" ? "father" : "mother"), label: sex === "male" ? "父" : "母", level: "simple", choice, run: one(sex) })),
      ...(missing.length === 2 ? [{ key: key("both"), label: "父母", level: "simple" as const, choice, run: (w: WorkingHousehold) => addParentsOf(w, side.id) }] : []),
    ];
  };
  return [...sideActions(self, true), ...(spouse !== undefined ? sideActions(spouse, false) : [])];
}

const addOutsideActions = (wh: WorkingHousehold): ActionDef[] => {
  return [
    ...parentAddActions(wh, "care"),
    { key: "family/add/grandparent", label: "＋ 祖父母を足す", level: "detail", run: (w) => addOutside(w, "grandparent") },
    { key: "care/add/sibling", label: "＋ 兄弟姉妹を足す", level: "detail", run: (w) => addOutside(w, "sibling") },
    { key: "care/add/child", label: "＋ 離れて暮らす子・前の結婚の子を足す", level: "detail", run: (w) => addOutside(w, "child") },
    // 孫は、あげる贈与の相手として相続・贈与の項目の「＋ 孫を足す」で足す（足した孫はそこに並ぶ。ここに足すボタンを置くと、相続・贈与の側から見えない孫が増えた）
  ];
};

// ---- 区画B 介護の費用 ----

const placeOf = (c: CareExpense): "home" | "facility" => (c.place === "facility" ? "facility" : "home");

/**
 * 介護の物の見出し（「母の介護」）。在宅か施設か・期間・額は見出しの下の要約（careSpan）に分ける（左の狭い列で折り返さないように）。
 * 見出しに在宅か施設かを入れない: プランで施設に変えても、違いの一覧・要約の名前が前の値のまま残るため（通しの確かめ。0150）
 */
function careTitle(wh: WorkingHousehold, c: CareExpense): string {
  return `${memberLabel(wh, c.member)}の介護`;
}

/**
 * 介護の物の見出しの下の1行（「在宅・2031年4月から55か月（推定）・月5.2万円（推定）」）。入れていない月額・期間は統計の平均の推定で、
 * 推定の物のすぐ後ろに「（推定）」（期間と月額のどちらが推定か分かるように。0041 の追記 2026-11-10）
 */
export function careSpan(wh: WorkingHousehold, c: CareExpense): string {
  const h = wh.request.input.household;
  const from = resolveTimepoint(h, c.from);
  const est = careEstimate(placeOf(c));
  const months = c.months ?? est?.months;
  const monthsEst = c.months === undefined && est !== null ? "（推定）" : "";
  const monthly = c.otherMonthly?.value ?? null;
  const moneyEst = monthly === null && c.serviceMonthly === undefined && est !== null;
  const money = monthly !== null ? `月${manYen(monthly)}` : est !== null ? `月${manYen(est.monthly)}${moneyEst ? "（推定）" : ""}` : "";
  // 介護を受ける人の亡くなる見込みが期間の途中なら、その前の月まで（care.expense はその月から出さない）
  const gone = resolveTimepoint(h, h.members.find((m) => m.id === c.member)?.leaves ?? null);
  const last = from !== null && months !== undefined ? addMonths(from, months - 1) : null;
  const start = from !== null ? `${formatYearMonth(from)}から` : "";
  const span =
    gone !== null && from !== null && last !== null && gone <= last
      ? gone > from
        ? `${start}${formatYearMonth(addMonths(gone, -1))}まで（亡くなる見込みまで）`
        : "亡くなる見込みの後のため0円"
      : `${start}${months !== undefined ? `${String(months)}か月${monthsEst}` : ""}`;
  return [c.place === "facility" ? "施設" : "在宅", span, money].filter((x) => x !== "").join("・");
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

/**
 * 次の段（施設など）を足す: 始まりはこの段の始まりの形（年齢・出来事・年月）のまま期間だけずらす（年齢で入れた段は、生年月を直すと一緒に動く）。
 * 始まりは推定の印（前の段の終わりの翌月。前の段の期間が空なら統計の平均の期間で。0041 の追記 2026-11-11）
 */
export function addNextCareStage(wh: WorkingHousehold, id: string, newStage: string = newId()): WorkingHousehold {
  const cur = (wh.request.input.household.careExpenses ?? []).find((x) => x.id === id);
  if (cur === undefined) return wh;
  const { from, basis } = nextCareStart(wh.request.input.household, cur, wh.request.input.baseMonth);
  const next = mutate(wh, (h) => void (h.careExpenses ??= []).push({ id: newStage, member: cur.member, from, place: "facility" }));
  return { ...next, assumed: { ...next.assumed, [careStartKey(newStage)]: basis } };
}

/**
 * 「＋ 次の段階を足す」の始まりと、その推定の根拠: 前の段（cur）の始まりの形のまま、前の段の期間（空なら統計の平均の期間）だけずらす。
 * 推定のままの始まりを前の段についてこさせるときも、同じ置き方で作り直す（followCareStarts）
 */
export function nextCareStart(h: Household, cur: CareExpense, baseMonth: string): { from: Timepoint; basis: string } {
  const months = cur.months ?? careEstimate(placeOf(cur))?.months ?? masterAmount("care.statistics.months") ?? 0;
  const from: Timepoint =
    cur.from.memberAge !== undefined ? shiftAge(cur.from, months) : cur.from.event !== undefined ? { event: cur.from.event, offset: addOffset(cur.from.offset, months) } : { at: addMonths(resolveTimepoint(h, cur.from) ?? baseMonth, months) };
  const span = cur.months !== undefined ? `${String(months)}か月` : `${String(months)}か月。期間が空なので統計の平均の推定`;
  return { from, basis: `推定（前の段階の終わりの翌月。前の段階の始まりに、その期間（${span}）を足しています）` };
}

/** 推定のままの介護の始まりの作り方: 介護の目安の物（亡くなる見込みから）か、次の段階（前の段 prev の終わりの翌月から） */
type CareStartSource = { kind: "template" } | { kind: "next"; prev: string };

/**
 * 推定のままの介護の始まりを、どの値から作ったか（今の始まりと根拠が、その作り方で今の世帯から作り直した物と同じときだけ）。
 * 作り方が分からない物（ヒアリングシートの仮の値など）は null（ついてこさせない）
 */
function careStartSource(wh: WorkingHousehold, c: CareExpense, mark: string): CareStartSource | null {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const same = (e: { from: Timepoint; basis: string }) => e.basis === mark && sameWhen(e.from, c.from);
  const m = h.members.find((x) => x.id === c.member);
  if (m !== undefined && same(careTemplateStart(h, m, base))) return { kind: "template" };
  const prev = (h.careExpenses ?? []).find((p) => p.id !== c.id && p.member === c.member && same(nextCareStart(h, p, base)));
  return prev === undefined ? null : { kind: "next", prev: prev.id };
}

/**
 * 推定のままの介護の始まりを、元の値についてこさせる（0041 の追記 2026-11-11）: 欄・ボタンで亡くなる見込み（とその元の生年月・性別）・
 * 介護を受ける人・前の段階の始まりや期間などを直した後に、推定の印が残っていて、この操作で始まりそのものを書いていない介護の物の始まりを、
 * 直した後の値から同じ作り方で作り直す（定年後の年収の「定年前の年収が変わったら推定だけ作り直す」〔work.ts の followPost〕と同じ考え方）。
 * FP が入れた始まり（印が外れた物）と、作り方が分からない印の物は動かさない。次の段階は前の段階を作り直した後に作り直す（続けてついてくる）。
 * 始まりは今までと同じく、時点と仮の印で持つ（推定の値を「入れた値」として書かない）
 */
export function followCareStarts(before: WorkingHousehold, after: WorkingHousehold): WorkingHousehold {
  if (before === after) return after;
  const list = before.request.input.household.careExpenses ?? [];
  const sources = new Map<string, CareStartSource>();
  for (const c of list) {
    const key = careStartKey(c.id);
    const mark = before.assumed[key];
    if (mark === undefined || after.assumed[key] !== mark) continue;
    const now = (after.request.input.household.careExpenses ?? []).find((x) => x.id === c.id);
    // この操作で始まりそのものを書いた物（FP が直した・家族を外して年月に直したなど）は、そのまま
    if (now === undefined || !sameWhen(now.from, c.from)) continue;
    const src = careStartSource(before, c, mark);
    if (src !== null) sources.set(c.id, src);
  }
  if (sources.size === 0) return after;
  let w = after;
  const done = new Set<string>();
  const redo = (id: string): void => {
    if (done.has(id)) return;
    done.add(id);
    const src = sources.get(id);
    if (src === undefined) return;
    if (src.kind === "next") redo(src.prev);
    const h = w.request.input.household;
    const now = (h.careExpenses ?? []).find((x) => x.id === id);
    if (now === undefined) return;
    const m = h.members.find((x) => x.id === now.member);
    const prev = src.kind === "next" ? (h.careExpenses ?? []).find((x) => x.id === src.prev && x.member === now.member) : undefined;
    const base = w.request.input.baseMonth;
    const want = src.kind === "template" ? (m === undefined ? null : careTemplateStart(h, m, base)) : prev === undefined ? null : nextCareStart(h, prev, base);
    const key = careStartKey(id);
    if (want === null || (sameWhen(want.from, now.from) && want.basis === w.assumed[key])) return;
    w = mutate(w, (hh) => {
      const x = (hh.careExpenses ?? []).find((y) => y.id === id);
      if (x !== undefined) x.from = structuredClone(want.from);
    });
    w = { ...w, assumed: { ...w.assumed, [key]: want.basis } };
  };
  for (const id of sources.keys()) redo(id);
  return w;
}

/** 介護の物の下の1行（後ろに「推定」の印と、推定のままの欄の名前が並ぶ。入れた欄は名前が消える） */
export const CARE_ESTIMATE_LINE = "詳細の項目を入れない所は、この条件で推定した数字を使います。";

/** 介護の物1件（events.ts の欄に、見出しの1行・推定のままの欄の1行と「＋ 次の段階を足す」を足す） */
function careCostGroup(wh: WorkingHousehold, c: CareExpense): GroupDef {
  const g = careGroup(wh, c);
  const est = careEstimate(placeOf(c));
  const next: ActionDef = { key: `ev/care/${c.id}/nextStage`, label: "＋ 次の段階を足す", help: "在宅から施設へなど、次の段階の介護を足します", level: "simple", run: (w) => addNextCareStage(w, c.id) };
  // 推定のままの欄の1行（標準では介護を受ける人と在宅か施設かだけが見えるので、ほかの詳細の欄は推定で計算していることを欄の下に。0143 の追記 2026-11-12）
  return { ...g, title: careTitle(wh, c), summary: careSpan(wh, c), moreLabel: "期間・一時費用などを入れる", estimateLine: CARE_ESTIMATE_LINE, note: `${carePayerLine(wh, c)}。入れていない額・期間は、統計の平均で推定します（${est?.basis ?? "生命保険文化センターの調査"}）`, actions: [next, ...g.actions] };
}

/**
 * 本人・配偶者の介護が無いときの区画の1行（未入力の警告。確かめの一覧のいちばん上と、パネルの本文の頭の帯にも出る。fill.ts の gapsOf）。
 * 入れないと決めるのは帯・確かめの一覧の「該当なし（介護の費用を入れない）」か、入力項目の「当てはまらない」を押したときだけ（保存では決めない）。
 * 区画のボタン「…の介護は入れない」は置かない（入れた物を外すのはその物の「外す」。0143 の追記 2026-11-12）
 */
function adultsNote(wh: WorkingHousehold): string | null {
  const missing = adultsWithoutCare(wh.request.input.household);
  if (missing.length === 0 || adultsCareDeclined(wh)) return null;
  const est = careEstimate("home");
  const total = est === null ? "" : `推定は1人 約${manYen(est.monthly * est.months + est.initial)}（在宅の平均の月額×期間＋一時費用）。`;
  const names = missing.map((m) => memberLabel(wh, m.id)).join("・");
  return `${names}の介護の費用が入っていないので、0円で計算しています。${total}「${names}の介護を入れる」で統計の平均の推定を入れます（後から詳細の項目を入れた所は、その値で計算します）。入れないと決めたら、帯の「該当なし（介護の費用を入れない）」を押してください（項目を保存しただけでは決めません）`;
}

// ---- 区画D 親のお金（0042） ----

/** 世帯の外の家族のお金（0042）の説明 */
const WALLET_NOTE =
  "この人のお金（預金・生活費・一時の入金と、人の詳細の「この人の年金（年額）」）を入れると、介護の費用はまずこの人のお金から払い、尽きた月から世帯が払います（結果のできごとに出ます）。仕送り・援助もこの人のお金で数えます。預金を入れるまでは世帯が全部払います。税は年金の推計からの目安です";

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
  );
  // 年金（人の詳細の欄）だけが入っているときは、外すものが無い（年金は人の欄で消す）
  if (Object.keys(m.wallet ?? {}).some((x) => x !== "pension") || Object.keys(m.wallet ?? {}).length === 0)
    actions.push(
      removeAction(`family/${m.id}/wallet/remove`, "この人のお金を見るのをやめる", "detail", (h) => {
        const x = h.members.find((y) => y.id === m.id);
        if (x === undefined) return;
        // 年金は人の詳細の欄の値なので残す（扶養の境目・家計を1つにする期間でも使う）
        const pension = x.wallet?.pension;
        if (pension !== undefined) x.wallet = { pension };
        else delete x.wallet;
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

/** 相続・贈与の項目（あげる贈与）に置く孫（世帯の外の家族の孫。介護・親には読むだけの1行） */
const inheritanceGrandchild = (m: Member): boolean => m.kind === "grandchild" && m.outside !== undefined;
const groupsOf = (g: GroupDef | null): GroupDef[] => (g !== null ? [g] : []);

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
      note: "親（両家）・祖父母・兄弟姉妹・離れて暮らす子など、家計が別の家族です。年金などの収入は世帯に入れません。続柄・呼び名・家計を1つにする期間・扶養・この人の年金・亡くなる見込みは「詳細」（人ごとの「▸ 扶養・仕送りなどを入れる」）で入れます。相続・贈与の入力項目で足した親・祖父母と、贈与する人もここに並びます。孫（あげる贈与の相手）は、相続・贈与の入力項目の「あげる贈与」で入れます",
      level: "simple",
      groups: [
        ...outside.filter((m) => !inheritanceGrandchild(m)).map((m) => outsideGroup(wh, m)),
        // 見出しは相続・贈与の区画と同じ（「ご本人の祖父母（生年月なし）」）
        ...donorGroups(wh).map((g) => ({ ...g, title: donorTitles(wh).get(g.key.split("/").at(-1) ?? "") ?? `${g.title ?? "贈与する人"}（${donorKindText(wh, g.key)}・生年月なし）` })),
        ...groupsOf(readGroup("care/grandchildren", undefined, outside.filter(inheritanceGrandchild).map((m) => readLine(`care/grandchild/${m.id}`, memberLabel(wh, m.id), "あげる贈与の相手", "相続・贈与")))),
      ],
      actions: addOutsideActions(wh),
    },
    {
      key: "care/costs",
      title: "介護の費用",
      note: note ?? "親・ご本人・配偶者の介護を、介護を受ける人ごとに入れます。在宅から施設に移るなどは「＋ 次の段階を足す」で段を並べます",
      level: "simple",
      groups: (h.careExpenses ?? []).map((c) => careCostGroup(wh, c)),
      actions: [
        ...(adults.length > 0
          ? [
              // 押した後に詳細の項目を入れると推定でなくなるので、言葉は「推定で入れる」でなく「介護を入れる」（推定のままの所は物の下の1行に出る。0143 の追記 2026-11-12）。
              // 入れないと決めるのは帯・確かめの一覧の「該当なし」と入力項目の「当てはまらない」（区画には「入れない」のボタンを置かない。入れた物は「外す」で外す）
              { key: "care/fillAdults", label: `${adults.map((m) => memberLabel(wh, m.id)).join("・")}の介護を入れる`, level: "simple" as const, run: fillAdultsCare },
            ]
          : []),
        {
          key: "ev/addCare",
          label: "＋ 介護の費用",
          level: "simple",
          run: (w) => {
            const hh = w.request.input.household;
            const who = hh.members.find((m) => m.kind === "parent") ?? hh.members.find((m) => m.kind === "self");
            return who === undefined ? w : addCareTemplate(w, who.id);
          },
        },
      ],
    },
    // 親とのお金（援助・家に入れるお金＝入る、仕送り・立て替え＝出る。お金の行。0044）
    // 世帯の外の家族が1人以上いれば標準に出す（40〜60代の面談で毎回聞く。いなければ詳細だけ）
    ...moneySections(wh, "care", { claimed: NONE_CLAIMED, ...(outside.length > 0 ? { level: "simple" as const } : {}), inTitle: "親からの援助・家に入れるお金", outTitle: "親への仕送り・立て替え" }),
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
    // 介護で休む・働き方を変える（働き方の期間の物なので、働き方と収入の項目で入れる。ここは読むだけ。まだ無ければ入れ方だけを出す）
    {
      key: "care/leaves",
      title: "介護で働き方が変わる",
      note: leaves !== null ? "介護休業・時短は、働き方と収入の項目の働き方の期間で入れます（休業の種類「介護」）" : "まだありません。介護で休む・時短にするときは、働き方と収入の項目の働き方の期間で入れます（休業の種類「介護」）",
      level: "simple" as const,
      groups: leaves !== null ? [leaves] : [],
      actions: [],
    },
  ];
  return { id: "care", label: "介護・親", lead: "親の世代（世帯の外の家族）と、介護の費用・親とのお金。", sections };
}
