// 13. 相続・贈与: 世代をまたぐお金を1枚に集める。
// - 区画A 受け取る予定の相続・贈与（入るお金の行と、相続で受け継ぐ借金）: moneyRows.ts の区画「inherit」。見込み（確実・当てにしない）は簡易。
//   「当てにしない」の行は基本の計算に入れない（0044 の5）。行に「この行を計算に入れる」の1押し。相続の受け取る時期は、相手の亡くなる見込みの10か月後を推定で
// - 区画B あげる贈与（出るお金の行）。今ある援助の物（子への援助 goals.education.gifts・住宅資金の援助 residences.purchase.gifts）は物の形を変えず、
//   子ども・教育／住まい・ローンのカードで入れ、ここには読むだけで並べる。あげる贈与の相手の孫（世帯の外の家族）はこのカードに置く（呼び名・生年月・外す）
// - 親・祖父母（相続の相手・贈与する人）: 物と欄は介護・親の項目の世帯の外の家族の区画。ここは人ごとに「使っているところ」の1行と「外す」、「＋ 足す」
// - 区画C 遺したい額（表示だけ。表の最後の年の金融資産と比較する。input.legacy）
// - 区画D 相続税の目安: 結果は計算の結果から読む（inheritanceLine.ts。表示だけで、お金の流れには入れない）。ここは目安の計算の前提の欄
//   （不動産の評価の割合・名義の無い財産の分け方・葬式の費用・養子・法定相続人の数を直す口。input.inheritanceTax。0039・0060）
// - 区画E 税理士などが出した相続税の額（目安の代わりに出す額。input.inheritanceTax.overrides）。使う世帯が少ないので、ふだんは閉じておき、
//   説明と「＋ 税理士などが出した額を入れる」だけを出す。額が入っている世帯では初めから開く（0039 の追記 2026-11-10）
import type { Household, InheritanceTaxRequest, Member, Timepoint } from "../../../engine/types.ts";
import { afterWrite, field, removeAction, resolveTimepoint, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, type WorkingHousehold } from "../household.ts";
import { bothAfterLabel, donorLabel, donorUses, GIFT_PURPOSES, memberLabel } from "../labels.ts";
import { manYen, readGroup, readLine } from "../readLines.ts";
import type { Address } from "../../store/readings.ts";
import { formatYearMonth } from "../units.ts";
import { addExpense, addInheritedDebt, addOutsideGrandchild, inheritedDebtGroups, moneySections } from "../moneyRows.ts";
import { NONE_CLAIMED } from "./events.ts";
import { addDonorActions, removeDonorIn, removeMember } from "./family.ts";
import { outsideGroup, outsideMembers, parentAddActions } from "./care.ts";
import { hasBirth } from "../fill.ts";
import { ageAt } from "../../levers.ts";
import { putRow } from "../rows.ts";
import { scenarios } from "../../contingency/requests.ts";

const purposeText = (p: string) => GIFT_PURPOSES.find((o) => o.value === p)?.label ?? "援助";
const whenText = (h: Household, at: Parameters<typeof resolveTimepoint>[1]) => {
  const ym = resolveTimepoint(h, at);
  return ym !== null ? `（${formatYearMonth(ym)}）` : "";
};

/** 今ある援助の物（子への援助・住宅資金の援助）を、受け取る側とあげる側に分けた読むだけの1行 */
export function giftLines(wh: WorkingHousehold): { receive: FieldDef[]; give: FieldDef[] } {
  const h = wh.request.input.household;
  const receive: FieldDef[] = [];
  const give: FieldDef[] = [];
  for (const goal of h.goals ?? []) {
    if (goal.kind !== "education") continue;
    (goal.education?.gifts ?? []).forEach((g, i) => {
      const who = memberLabel(wh, goal.owner);
      const line = readLine(`inherit/edu/${goal.id}/${i}`, `${who}への援助（${purposeText(g.purpose)}）${g.donor !== undefined ? "・贈与する人から" : ""}`, `${manYen(g.amount)}${whenText(h, g.at)}`, "子ども・教育");
      // 贈与する人（親・祖父母）から出す援助は受け取る側、世帯から出す援助はあげる贈与
      (g.donor !== undefined ? receive : give).push(line);
    });
  }
  for (const r of h.residences ?? [])
    (r.purchase?.gifts ?? []).forEach((g, i) => {
      receive.push(readLine(`inherit/housing/${r.id}/${i}`, `住宅資金の援助（${memberLabel(wh, g.recipient)}が受け取る）`, `${manYen(g.amount)}${r.purchase !== undefined ? whenText(h, r.purchase.at) : ""}`, "住まい・ローン"));
    });
  return { receive, give };
}

// ---- 人の並び（親・祖父母と、あげる贈与の相手の孫）: 足した人をその場で見せる ----

/** 親・祖父母の行の「使っているところ」の「?」 */
const PERSON_USE_HELP =
  "受け取る相続・贈与の行の「相手（誰から）」、相続で受け継ぐ借金の「元の借り手」、住宅資金・教育資金の援助の「贈与する人」に選ぶと、相続・贈与の計算に使います。どこにも選ばれていないうちは、相続・贈与の計算には使いません";

/** この人（世帯の外の家族か、生年月を入れない贈与する人）を相手・贈与する人に選んでいる物の言葉（「受け取る相続・贈与の相手 1件」など） */
export function personUses(h: Household, id: string): string[] {
  const n = (k: number, text: string): string[] => (k > 0 ? [`${text} ${String(k)}件`] : []);
  const flows = h.incomeFlows ?? [];
  const inherit = (k: string) => k === "inheritance" || k === "giftReceived";
  return [
    ...n(flows.filter((f) => f.counterparty === id && inherit(f.kind)).length, "受け取る相続・贈与の相手"),
    ...n((h.debts ?? []).filter((d) => d.inheritedFrom === id).length, "受け継ぐ借金の元の借り手"),
    ...n(donorUses(h, id), "援助の贈与する人"),
    ...n(flows.filter((f) => f.counterparty === id && !inherit(f.kind)).length + (h.periodicExpenses ?? []).filter((p) => p.counterparty === id).length, "援助・仕送りの行の相手"),
  ];
}

/** 「使っているところ」の1行（見せるだけ。何に選ばれているか。選ばれていなければ、選ぶまで計算に使わないこと） */
function useLine(key: string, h: Household, id: string, help: string): FieldDef {
  const uses = personUses(h, id);
  const value = uses.length > 0 ? uses.join("・") : "まだ選ばれていません";
  return field({ key: `ro/${key}`, item: null, label: "使っているところ", level: "simple", kind: "text", readOnly: help, get: () => ({ value }), set: (w) => w });
}

/** 年齢の言葉（これから生まれる人はマイナスの年齢にしない）と、生年月が仮の値かの添え書き */
function ageText(wh: WorkingHousehold, m: Member): string {
  const parts: string[] = [];
  if (hasBirth(m)) {
    const age = ageAt(m, wh.request.input.baseMonth);
    parts.push(age < 0 ? "これから生まれる" : `${String(age)}歳`);
    if (wh.assumed[`family/${m.id}/birth`] !== undefined) parts.push("生年月は仮の値");
  }
  return parts.length > 0 ? `（${parts.join("・")}）` : "";
}

/**
 * 区画「親・祖父母（相続の相手・贈与する人）」に並べる人: 介護・親の親・祖父母（世帯の外の家族。ここの「＋ ご本人の親を足す」で足した人も）と、
 * 前に援助で選んだほかの世帯の外の家族、生年月を入れない贈与する人。物と欄は介護・親の項目のまま（1つの物は1つの入力項目。0045）で、
 * ここは人ごとに「使っているところ」の1行と「外す」（足した人がその場で見え、要らなければここで外せるように）
 */
export function personGroups(wh: WorkingHousehold): GroupDef[] {
  const h = wh.request.input.household;
  const elder = (m: Member) => m.kind === "parent" || m.kind === "grandparent";
  const people = outsideMembers(wh).filter((m) => elder(m) || (m.kind !== "grandchild" && donorUses(h, m.id) > 0));
  const members = people.map(
    (m): GroupDef => ({
      key: `inherit/person/${m.id}`,
      title: `${memberLabel(wh, m.id)}${ageText(wh, m)}`,
      level: "simple",
      note: "生年月・亡くなる見込み・扶養などは「介護・親」の項目で直します（同じ人です）",
      fields: [useLine(`inherit/person/${m.id}/uses`, h, m.id, `${PERSON_USE_HELP}（介護の費用・相続人の数え方などには、選ばなくても使います）`)],
      actions: [{ key: `inherit/person/${m.id}/remove`, label: "外す", help: "この人を外します。介護・親の項目からも消え、相手・贈与する人に選んでいた行は相手なしになります", level: "simple", danger: true, run: (w) => removeMember(w, m.id) }],
    }),
  );
  const titles = donorTitles(wh);
  const donorRows = (h.donors ?? []).map((d): GroupDef => {
    return {
      key: `inherit/donor/${d.id}`,
      title: titles.get(d.id) ?? "贈与する人（生年月なし）",
      level: "simple",
      note: "生年月を入れずに置いた贈与する人です。援助の「贈与する人」と、受け取る贈与の「相手」に選べます。続柄・誰の親か祖父母かは「介護・親」の項目で直します",
      fields: [useLine(`inherit/donor/${d.id}/uses`, h, d.id, PERSON_USE_HELP)],
      actions: [{ ...removeAction(`inherit/donor/${d.id}/remove`, "外す", "simple", (hh) => removeDonorIn(hh, d.id)), help: "この贈与する人を外します。介護・親の項目からも消え、援助の贈与する人・相手に選んでいた行は選ばない形になります" }],
    };
  });
  return [...members, ...donorRows];
}

/**
 * 生年月を入れない贈与する人の見出し（「ご本人の祖父母（生年月なし）」。同じ呼び方の人が2人以上なら、足した順に「… 1」「… 2」）。
 * 相続・贈与と介護・親で同じ見出しにする
 */
export function donorTitles(wh: WorkingHousehold): Map<string, string> {
  const donors = wh.request.input.household.donors ?? [];
  const label = (d: (typeof donors)[number]) => donorLabel(wh, d);
  return new Map(
    donors.map((d) => {
      const same = donors.filter((x) => label(x) === label(d));
      const no = same.length > 1 ? ` ${String(same.indexOf(d) + 1)}` : "";
      return [d.id, `${label(d)}${no}（生年月なし）`];
    }),
  );
}

/** この孫を相手にしたあげる贈与の行を足す（相手は押した孫。選んだ相手なので、既定の相手の推定の印は付けない） */
export function addGiftTo(wh: WorkingHousehold, member: string, id: string = newId()): WorkingHousehold {
  return mutate(addExpense(wh, "gift", id), (h, req) => {
    const p = (h.periodicExpenses ?? []).find((x) => x.id === id);
    if (p === undefined) return;
    p.counterparty = member;
    putRow(req.input as unknown as Record<string, unknown>, { target: { object: id }, item: "periodicExpense.counterparty", at: [] }, undefined);
  });
}

/**
 * あげる贈与の相手の孫（世帯の外の家族）のまとまり。孫は、あげる贈与の相手としてだけ使うので、この入力項目に置く（介護・親には読むだけの1行）。
 * 欄は呼び名（相手の選択肢で見分ける）・生年月（贈与税の特例の税率・相続時精算課税は18歳以上）と、詳細の続柄・性別。
 * 前に介護・親で同居・家計を1つにする期間を入れた孫は、その欄も残す（値を見えなくしない）
 */
export function grandchildGroup(wh: WorkingHousehold, m: Member): GroupDef {
  const h = wh.request.input.household;
  const g = outsideGroup(wh, m);
  const k = `family/${m.id}`;
  const keepAll = m.support?.cohabiting === true || (m.outside?.periods.length ?? 0) > 0;
  const pick = new Set([`${k}/nickname`, `${k}/kind`, `${k}/birth`, `${k}/sex`]);
  const fields = (keepAll ? g.fields : g.fields.filter((f) => pick.has(f.key))).map((f): FieldDef => (f.key === `${k}/nickname` ? { ...f, level: "simple" } : f));
  const drop = new Set([`${k}/care/estimate`, `${k}/leaves/estimate`]);
  const actions = (keepAll ? g.actions : g.actions.filter((a) => a.key === `${k}/remove`)).filter((a) => !drop.has(a.key));
  const gifts = (h.periodicExpenses ?? []).filter((p) => p.kind === "gift" && p.counterparty === m.id).length;
  const note = [
    "あげる贈与の相手にする孫（世帯の外の家族）です。生年月は贈与税の計算（特例の税率・相続時精算課税は18歳以上）に使います。呼び名を付けると、あげる贈与の「相手（誰へ）」で見分けられます",
    gifts > 0 ? `あげる贈与 ${String(gifts)} 件の相手です` : "まだあげる贈与の相手に選ばれていません。「＋ この孫へのあげる贈与」で行を足せます",
  ].join("。");
  return {
    key: k,
    title: `${memberLabel(wh, m.id)}${ageText(wh, m)}`,
    level: "simple",
    moreLabel: keepAll ? "続柄・性別・同居などを入れる" : "続柄・性別を入れる",
    note,
    fields,
    actions: [...actions, { key: `inherit/grandchild/${m.id}/gift`, label: "＋ この孫へのあげる贈与", help: "この孫を相手にした、あげる贈与の行を足します（額は暦年贈与の基礎控除の額の推定）", level: "simple", run: (w) => addGiftTo(w, m.id) }],
  };
}

/** あげる贈与の相手の孫（世帯の外の家族。足した順） */
export const outsideGrandchildren = (h: Household): Member[] => h.members.filter((m) => m.kind === "grandchild" && m.outside !== undefined);

// ---- 区画A 受け取る予定 ----

/** 相続の受け取る時期の推定: 相手の亡くなる見込みの10か月後（申告と納税の期限の目安） */
export const INHERIT_AFTER_MONTHS = 10;
const INHERIT_BASIS = "推定（相手の亡くなる見込みの10か月後。相続税の申告と納税の期限の目安）";
/**
 * 相手を「なし」のまま足した受け取る相続の行の時期の仮の印: 足したときの仮の時期（今から1年後）。印がある間は推定のままとして、後から相手を選ぶと
 * 相手の亡くなる見込みの10か月後で入れ直す（FP が時期を入れたら印を外し、その後は動かさない）
 */
export const INHERIT_PENDING_BASIS = "仮の時期（亡くなる見込みのある相手を選ぶと、その10か月後にします）";

/** 亡くなる見込みからずらした時点（年齢の時点ならその形のまま・年月なら年月） */
function after(t: Timepoint, months: number, h: Household): Timepoint | null {
  if (t.memberAge !== undefined) {
    const total = t.memberAge.years * 12 + (t.memberAge.months ?? 0) + months;
    return { memberAge: { ...t.memberAge, years: Math.floor(total / 12), months: total % 12 } };
  }
  if (t.event !== undefined) return { event: t.event, offset: { months: (t.offset?.years ?? 0) * 12 + (t.offset?.months ?? 0) + months } };
  const ym = resolveTimepoint(h, t);
  if (ym === null) return null;
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const i = y * 12 + (m - 1) + months;
  return { at: `${String(Math.floor(i / 12))}-${String((i % 12) + 1).padStart(2, "0")}` };
}

/** 受け取る相続の行の時期を、相手の亡くなる見込みの10か月後にする（相手が亡くなる見込みを持つ世帯の外の家族のときだけ。仮の印つき） */
export function inheritTimingFromCounterparty(wh: WorkingHousehold, flowId: string): WorkingHousehold {
  const h = wh.request.input.household;
  const f = (h.incomeFlows ?? []).find((x) => x.id === flowId);
  const cp = f?.counterparty === undefined ? undefined : h.members.find((m) => m.id === f.counterparty);
  if (f === undefined || f.kind !== "inheritance" || cp?.leaves === undefined || cp.leaves === null) return wh;
  const at = after(cp.leaves, INHERIT_AFTER_MONTHS, h);
  if (at === null) return wh;
  const next = mutate(wh, (hh) => {
    const x = (hh.incomeFlows ?? []).find((y) => y.id === flowId);
    if (x === undefined) return;
    x.from = structuredClone(at);
    x.to = structuredClone(at);
  });
  return { ...next, assumed: { ...next.assumed, [`in/${flowId}/from`]: INHERIT_BASIS } };
}

/**
 * 受け取る相続の時期が推定のまま（仮の印がある）なら、相手の亡くなる見込みについてこさせる: 相手の亡くなる見込みを直したとき（介護・親の
 * 亡くなる見込みの欄・平均余命で入れる）と、行の相手を変えたときに、新しい亡くなる見込みの10か月後で入れ直す。FP が入れた時期（印の無い時期）は変えない
 */
export function followInheritTiming(wh: WorkingHousehold, counterparty: string): WorkingHousehold {
  let w = wh;
  for (const f of wh.request.input.household.incomeFlows ?? []) {
    if (f.kind !== "inheritance" || f.counterparty !== counterparty || wh.assumed[`in/${f.id}/from`] === undefined) continue;
    w = inheritTimingFromCounterparty(w, f.id);
  }
  return w;
}

// 欄の書き込みの後に世帯を整える関数を通す afterWrite は、欄の部品（form.ts）へ移した（住まい・ローンの時点の欄でも使う）
export { afterWrite } from "../form.ts";

/**
 * 受け取る相続の行の相手と時期の欄: 相手を変えたら、推定のままの受け取る時期を新しい相手の亡くなる見込みから入れ直す。
 * 時期を FP が入れたら（相手の亡くなる見込みからの推定の）仮の印を外す（その後は亡くなる見込みを直しても動かさない）
 */
function withCounterpartyFollow(g: GroupDef): GroupDef {
  const id = g.key.startsWith("in/") && !g.key.slice(3).includes("/") ? g.key.slice(3) : null;
  if (id === null) return g;
  const mark = `in/${id}/from`;
  return {
    ...g,
    fields: g.fields.map((f) => {
      if (f.key === `in/${id}/counterparty`)
        return afterWrite(f, (_before, after) => {
          const x = (after.request.input.household.incomeFlows ?? []).find((y) => y.id === id);
          return x === undefined || x.counterparty === undefined || after.assumed[mark] === undefined ? after : inheritTimingFromCounterparty(after, id);
        });
      if (f.key === mark)
        return afterWrite(f, (_before, after) => {
          if (after.assumed[mark] === undefined) return after;
          const { [mark]: _gone, ...rest } = after.assumed;
          void _gone;
          return { ...after, assumed: rest };
        });
      return f;
    }),
  };
}

/** 区画Aの「＋ 足す」: 足した後に、受け取る時期を相手の亡くなる見込みから推定する */
function receiveActions(actions: readonly ActionDef[]): ActionDef[] {
  return actions.map((a) => ({
    ...a,
    run: (w) => {
      const before = new Set((w.request.input.household.incomeFlows ?? []).map((f) => f.id));
      const next = a.run(w);
      const added = (next.request.input.household.incomeFlows ?? []).find((f) => !before.has(f.id));
      if (added === undefined) return next;
      const w2 = inheritTimingFromCounterparty(next, added.id);
      // 相手の亡くなる見込みから推定できなかった受け取る相続の行（相手が「なし」など）は、時期に仮の印を付けて、後から選んだ相手についてこさせる
      const mark = `in/${added.id}/from`;
      return added.kind !== "inheritance" || w2.assumed[mark] !== undefined ? w2 : { ...w2, assumed: { ...w2.assumed, [mark]: INHERIT_PENDING_BASIS } };
    },
  }));
}

/** 前の言い方（チェックの欄「基本の計算に入れる」を指す説明）を、1押しの言い方に */
const INCLUDE_NOTE_OLD = "「詳細」の「基本の計算に入れる」で入れられます";
const INCLUDE_NOTE_DEBT_OLD = "「基本の計算に入れる」で入れられます";
const INCLUDE_NOTE = "「この行を計算に入れる」で入れられます";

/**
 * 見込みと「基本の計算に入れる」を1つの考え方にする（受け取る相続・贈与の行と、相続で受け継ぐ借金）: 見込みが「確実」なら計算に入る（チェックの欄は出さない。
 * 前は「確実」でも空のチェックが並び、外れているように見えた）。「当てにしない」のときだけ「この行を計算に入れる」の1押し、入れた後は「計算から外す」の1押し
 * （どちらも見込みは「当てにしない」のまま。プランを直しているときは、そのプランの差分になる）
 */
function withIncludeAction(wh: WorkingHousehold, g: GroupDef): GroupDef {
  const income = g.key.startsWith("in/") && !g.key.slice(3).includes("/") ? g.key.slice(3) : null;
  const debt = g.key.startsWith("inherit/debt/") ? g.key.slice("inherit/debt/".length) : null;
  const h = wh.request.input.household;
  const row: { likelihood?: string; includeInBase?: boolean } | undefined =
    income !== null ? (h.incomeFlows ?? []).find((x) => x.id === income) : debt !== null ? (h.debts ?? []).find((x) => x.id === debt) : undefined;
  if (row === undefined) return g;
  const id = (income ?? debt) as string;
  const prefix = income !== null ? `in/${id}` : `inherit/debt/${id}`;
  const note = g.note?.replace(INCLUDE_NOTE_OLD, INCLUDE_NOTE).replace(INCLUDE_NOTE_DEBT_OLD, INCLUDE_NOTE);
  const set = (on: boolean) => (w: WorkingHousehold) =>
    mutate(w, (hh) => {
      const x: { includeInBase?: boolean } | undefined = income !== null ? (hh.incomeFlows ?? []).find((y) => y.id === id) : (hh.debts ?? []).find((y) => y.id === id);
      if (x === undefined) return;
      if (on) x.includeInBase = true;
      else delete x.includeInBase;
    });
  const uncertain = row.likelihood === "uncertain";
  const actions: ActionDef[] = !uncertain
    ? []
    : row.includeInBase === true
      ? [{ key: `${prefix}/excludeFromBase`, label: "計算から外す（見込みは「当てにしない」のまま）", level: "simple", run: set(false) }]
      : [{ key: `${prefix}/includeInBase`, label: "この行を計算に入れる（見込みは「当てにしない」のまま）", level: "simple", run: set(true) }];
  return { ...g, ...(note !== undefined ? { note } : {}), actions: [...actions, ...g.actions] };
}

/** 「基本の計算に入れる」のチェックの欄（行の詳細のまとまりにある）を出さない。代わりに見込みが「当てにしない」の行の1押し（withIncludeAction） */
const INCLUDE_FIELD = /^(in|inherit\/debt)\/[^/]+\/includeInBase$/;
const withoutIncludeField = (g: GroupDef): GroupDef => (g.fields.some((f) => INCLUDE_FIELD.test(f.key)) ? { ...g, fields: g.fields.filter((f) => !INCLUDE_FIELD.test(f.key)) } : g);

// ---- 区画C 遺したい額・区画D 相続税の目安の設定・区画E 税理士などが出した相続税の額 ----

type Obj = Record<string, unknown>;
const inputObj = (wh: WorkingHousehold): Obj => wh.request.input as unknown as Obj;
const LEGACY_FIND: Finder = (_h, wh) => (inputObj(wh).legacy as Obj | undefined) ?? undefined;
const legacyEnsure = (_h: Household, wh: WorkingHousehold): Obj => {
  const input = inputObj(wh);
  input.legacy ??= {};
  return input.legacy as Obj;
};
const onInput = (item: string, at: string[]) => (): Address => ({ target: { plan: "input" }, item, at });

/** 相続税の目安の設定（世帯に保存する分。時点を入れないので、計算の要求からは外れる。engine/moneyRows.ts の withoutStoredSettings） */
const taxOf = (wh: WorkingHousehold): InheritanceTaxRequest => wh.request.input.inheritanceTax ?? {};

/** 相続税の目安の設定を書き換える（空になったら欄ごと消す） */
function writeTax(wh: WorkingHousehold, fn: (t: InheritanceTaxRequest) => void): WorkingHousehold {
  return mutate(wh, (_h, req) => {
    const t: InheritanceTaxRequest = structuredClone(req.input.inheritanceTax ?? {});
    fn(t);
    for (const k of Object.keys(t) as (keyof InheritanceTaxRequest)[]) {
      const v = t[k];
      if (v === undefined || (Array.isArray(v) && v.length === 0)) delete t[k];
    }
    if (Object.keys(t).length === 0) delete req.input.inheritanceTax;
    else req.input.inheritanceTax = t;
  });
}

/** 相続税の目安の設定の1つの値の欄（率・円・人数） */
function taxField(o: { key: string; label: string; kind: "pct" | "yen" | "int"; at: string[]; help: string; blankMeans?: string; get: (t: InheritanceTaxRequest) => number | string | null; set: (t: InheritanceTaxRequest, v: number | string | null) => void }): FieldDef {
  const base = { key: o.key, item: "plan.inheritanceTax", label: o.label, level: "detail" as const, optional: true, help: o.help, ...(o.blankMeans !== undefined ? { blankMeans: o.blankMeans } : {}), get: (w: WorkingHousehold) => ({ value: o.get(taxOf(w)) }), set: (w: WorkingHousehold, v: unknown) => writeTax(w, (t) => o.set(t, v === null || v === "" ? null : (v as number | string))), address: onInput("plan.inheritanceTax", o.at) };
  // 割合（不動産の評価の割合・亡くなる人の分）は 0〜100%（計算エンジンの入力で 0〜1。外の値は計算が止まる）
  if (o.kind === "pct") return field({ ...base, kind: "pct", min: 0, max: 100 });
  if (o.kind === "int") return field({ ...base, kind: "int", suffix: "人", min: 0, max: 30 });
  return field({ ...base, kind: "yen", basis: "once" });
}

/** 亡くなる人を選べる大人（本人・配偶者） */
const adults = (h: Household): Member[] => h.members.filter((m) => (m.kind === "self" || m.kind === "spouse") && m.expected !== true);

function taxSettingFields(wh: WorkingHousehold): FieldDef[] {
  const h = wh.request.input.household;
  const couple = adults(h);
  const fields: FieldDef[] = [
    taxField({
      key: "inherit/tax/realEstateRatio",
      label: "不動産の評価の割合",
      kind: "pct",
      at: ["realEstateRatio"],
      help: "時価に掛ける割合です。入れなければ時価の80%（土地の路線価は公示価格等の8割程度を目安に定められるため。建物の固定資産税評価額も時価より低いのが普通）。路線価で分かれば直してください",
      blankMeans: "80%",
      get: (t) => t.realEstateRatio ?? null,
      set: (t, v) => (v === null ? delete t.realEstateRatio : (t.realEstateRatio = String(v))),
    }),
  ];
  if (couple.length === 2)
    fields.push(
      taxField({
        key: "inherit/tax/unassignedShare",
        label: "名義を入れていない財産のうち、亡くなる人の分",
        kind: "pct",
        at: ["unassignedShare"],
        help: "名義を入れていない預金・持ち家など。入れなければ夫婦で半分ずつ（50%）",
      blankMeans: "50%",
        get: (t) => t.unassignedShare ?? null,
        set: (t, v) => (v === null ? delete t.unassignedShare : (t.unassignedShare = String(v))),
      }),
    );
  fields.push(
    taxField({
      key: "inherit/tax/funeral",
      label: "葬式の費用",
      kind: "yen",
      at: ["funeral"],
      help: "財産から引きます。入れなければ0円",
      blankMeans: "0円",
      get: (t) => t.funeral ?? null,
      set: (t, v) => (v === null ? delete t.funeral : (t.funeral = Number(v))),
    }),
  );
  // 養子（子ごと）
  for (const c of h.members.filter((m) => m.kind === "child"))
    fields.push(
      field({
        key: `inherit/tax/adopted/${c.id}`,
        item: "plan.inheritanceTax",
        label: `${memberLabel(wh, c.id)}は養子`,
        level: "detail",
        kind: "bool",
        optional: true,
        help: "法定相続人の数には、実子がいれば1人・いなければ2人まで数えます",
        get: (w) => ({ value: (taxOf(w).adopted ?? []).includes(c.id), implicit: !(taxOf(w).adopted ?? []).includes(c.id) }),
        set: (w, v) => writeTax(w, (t) => (t.adopted = v === true ? [...new Set([...(t.adopted ?? []), c.id])] : (t.adopted ?? []).filter((x) => x !== c.id))),
        address: onInput("plan.inheritanceTax", ["adopted"]),
      }),
    );
  // 法定相続人の数を直す口（亡くなる人ごと）
  for (const m of couple)
    fields.push(
      taxField({
        key: `inherit/tax/heirs/${m.id}`,
        label: `法定相続人の数を直す（${memberLabel(wh, m.id)}が亡くなったとき）`,
        kind: "int",
        at: ["heirCounts"],
        help: "入れなければ、家族と世帯の外の家族から数えます。相続の放棄（数え方では放棄が無かったものとする）・代襲を入力で表せないときに直します",
        get: (t) => t.heirCounts?.find((x) => x.decedent === m.id)?.count ?? null,
        set: (t, v) => (t.heirCounts = [...(t.heirCounts ?? []).filter((x) => x.decedent !== m.id), ...(v === null ? [] : [{ decedent: m.id, count: Math.max(0, Math.round(Number(v))) }])]),
      }),
    );
  return fields;
}

// ---- 区画E 税理士などが出した相続税の額（ふだんは閉じておく） ----

/** 区画とまとまりのキー（欄のキーは前のまま inherit/tax/override/…） */
export const TAX_OVERRIDE_GROUP = "inherit/tax/override";
/** 区画の名前 */
export const TAX_OVERRIDE_TITLE = "税理士などが出した相続税の額";
/** 閉じている間の開くボタン（ほかの「＋ 〇〇を入れる」と同じ形） */
export const TAX_OVERRIDE_OPEN = "＋ 税理士などが出した額を入れる";
/** 各欄の説明（5つの欄で同じ文。説明の一覧の id が同じ field:plan.inheritanceTax/overrides のため） */
const OVERRIDE_HELP =
  "入れると、ソフトの目安の代わりにこの額を出します。いま亡くなったら・二人とも亡くなった後（一人の世帯は表の最後の年）の額は、この入力項目の下の「相続税の目安」に、万一のタブの死亡の想定の額は、そのタブの相続税の欄に「相続税: ○万円（FP が入れた額）」と出ます。ソフトの目安と内訳は、この入力項目の下の「相続税の目安」の「内訳」に残ります。キャッシュフロー表・金融資産の推移・必要保障額は変わりません（相続税はお金の流れに入れていないため）。消せば目安に戻ります";

/** 万一のタブに死亡の想定がある人（遺族〔配偶者・子〕がいる大人。contingency/requests.ts の scenarios と同じ） */
const deathScenarioMembers = (wh: WorkingHousehold): Set<string> => new Set(scenarios(wh).filter((s) => s.kind === "death").map((s) => s.member));

/**
 * 税理士などが出した額の欄（時点・亡くなる人ごと）。万一のタブの死亡の想定の欄は、その想定があるときだけ出す。想定が無くなった（遺族がいなくなった）のに
 * 額が残っている世帯では、欄を出したままにして、使っていないことを知らせ、消せるようにする（黙って消さない）
 */
function overrideFields(wh: WorkingHousehold): FieldDef[] {
  const h = wh.request.input.household;
  const couple = adults(h);
  const deaths = deathScenarioMembers(wh);
  const stored = taxOf(wh).overrides ?? [];
  const has = (point: string, decedent: string | undefined) => stored.some((x) => x.point === point && x.decedent === decedent);
  const points: { point: "now" | "bothAfter" | "contingency"; decedent?: string; label: string; orphan?: boolean }[] = [
    ...couple.map((m) => ({ point: "now" as const, decedent: m.id, label: `いま${memberLabel(wh, m.id)}が亡くなったら` })),
    ...(couple.length > 0 ? [{ point: "bothAfter" as const, label: bothAfterLabel(h) }] : []),
    ...couple
      .filter((m) => deaths.has(m.id) || has("contingency", m.id))
      .map((m) => ({ point: "contingency" as const, decedent: m.id, label: `万一のタブの${memberLabel(wh, m.id)}の死亡の想定`, orphan: !deaths.has(m.id) })),
  ];
  return points.map((p) => {
    const set = (t: InheritanceTaxRequest, v: number | string | null) =>
      (t.overrides = [...(t.overrides ?? []).filter((x) => !(x.point === p.point && x.decedent === p.decedent)), ...(v === null ? [] : [{ point: p.point, ...(p.decedent !== undefined ? { decedent: p.decedent } : {}), amount: Math.max(0, Math.round(Number(v))) }])]);
    const f = taxField({
      key: `inherit/tax/override/${p.point}${p.decedent !== undefined ? `/${p.decedent}` : ""}`,
      label: `税理士などが出した額（${p.label}）`,
      kind: "yen",
      at: ["overrides"],
      help: OVERRIDE_HELP,
      get: (t) => t.overrides?.find((x) => x.point === p.point && x.decedent === p.decedent)?.amount ?? null,
      set,
    });
    if (p.orphan !== true) return f;
    // 想定が無い（遺族がいない）のに額が残っている: 使っていないことを知らせ、消す1押しを添える
    const warn = `万一のタブに、${memberLabel(wh, p.decedent)}の死亡の想定が今はありません（遺族〔配偶者・子〕がいないため）。この額は使っていないので、消してください`;
    return { ...f, get: (w: WorkingHousehold) => ({ ...f.get(w), warn, warnFix: { label: "この額を消す", run: (x: WorkingHousehold) => f.set(x, null) } }) };
  });
}

/** 閉じている間に出す説明（1つが1段落。「・」で始まる物は続けて箇条書き）。万一のタブの死亡の想定が無い世帯では、万一のタブのことは書かない */
export function overrideLead(wh: WorkingHousehold, fields: readonly FieldDef[]): string[] {
  const couple = adults(wh.request.input.household);
  const who = couple[0] !== undefined ? memberLabel(wh, couple[0].id) : "ご本人";
  const contingency = fields.some((f) => f.key.startsWith("inherit/tax/override/contingency/"));
  return [
    "税理士などから相続税の額の試算をもらっているときは、ここに入れてください。入れなければ、ソフトの目安のままです。",
    "入れた額は、ソフトの目安の代わりに次の所に出ます。",
    `・いま亡くなったら・${bothAfterLabel(wh.request.input.household)}: この入力項目の下の「相続税の目安」に「いま${who}が亡くなったら: 1,000万円（FP が入れた額）」のように出ます。ソフトの目安と内訳は「内訳」に残ります`,
    ...(contingency ? ["・万一のときのタブの死亡の想定: そのタブの相続税の欄に「相続税: 1,000万円（FP が入れた額）」と出ます"] : []),
    "キャッシュフロー表・金融資産の推移は変わりません（相続税はお金の流れに入れていないため）。",
  ];
}

/** 税理士などが出した額のまとまり: ふだんは閉じておき、どれかの欄に額が入っている世帯では初めから開く（入れた額を隠さない） */
function overrideGroup(wh: WorkingHousehold): GroupDef | null {
  const fields = overrideFields(wh);
  if (fields.length === 0) return null;
  const lead = overrideLead(wh, fields);
  const startOpen = fields.some((f) => f.get(wh).value !== null);
  return { key: TAX_OVERRIDE_GROUP, level: "detail", note: lead.join("\n"), fields, actions: [], folded: { name: TAX_OVERRIDE_TITLE, lead, open: TAX_OVERRIDE_OPEN, startOpen } };
}

/** 遺したい額の欄（表示だけ。表の最後の年の金融資産と比較する） */
function legacyField(): FieldDef {
  return {
    ...yenBox({
      key: "inherit/legacy/amount",
      item: "plan.legacy",
      label: "遺したい額（今の値段）",
      level: "simple",
      basis: "once",
      find: LEGACY_FIND,
      ensure: legacyEnsure,
      path: ["amount"],
      optional: true,
      help: "入れると、表の最後の年の金融資産と比較して、足りるかを出します（計算のお金の流れには入れません）",
    }),
    address: onInput("plan.legacy", ["amount"]),
  };
}

/** 遺したい額の欄は、値を消したら入れ物ごと消す（空の legacy を残さない） */
function legacyCleanup(f: FieldDef): FieldDef {
  const tidy = (w: WorkingHousehold): WorkingHousehold => {
    const l = inputObj(w).legacy as Obj | undefined;
    if (l === undefined || Object.values(l).some((v) => v !== undefined)) return w;
    return mutate(w, (_h, req) => void delete (req.input as Obj).legacy);
  };
  return { ...f, set: (w, v) => tidy(f.set(w, v)), ...(f.write !== undefined ? { write: (w: WorkingHousehold, v: Parameters<NonNullable<FieldDef["write"]>>[1]) => tidy((f.write as NonNullable<FieldDef["write"]>)(w, v)) } : {}), ...(f.boxed !== undefined ? { boxed: { ...f.boxed, write: (w: WorkingHousehold, b: Record<string, unknown> | undefined) => tidy((f.boxed as NonNullable<FieldDef["boxed"]>).write(w, b)) } } : {}) };
}

export function inheritanceStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const lines = giftLines(wh);
  const groupsOf = (g: GroupDef | null): GroupDef[] => (g !== null ? [g] : []);
  // 受け取る予定の相続・贈与（入るお金）と、あげる贈与（出るお金）の行（moneyRows.ts の区画「inherit」。0044）。今ある援助の物は読むだけの1行を後ろに足す
  const money = moneySections(wh, "inherit", {
    claimed: NONE_CLAIMED,
    level: "simple",
    inTitle: "受け取る予定の相続・贈与",
    outTitle: "あげる贈与",
    note: "孫などへの贈与。贈与税は受け取る人が払うので、世帯からは出さず、結果の要約に出します",
  });
  const moneyIn = money.find((x) => x.key.endsWith("/in"));
  const override = overrideGroup(wh);
  const moneyOut = money.find((x) => x.key.endsWith("/out"));
  const sections: SectionDef[] = [
    {
      key: "inherit/receive",
      title: moneyIn?.title ?? "受け取る予定の相続・贈与",
      note: "受け取れるかどうかの見込み（確実・当てにしない）を行ごとに選びます。「確実」の行は計算に入れ、「当てにしない」にした行は除いて計算します（「この行を計算に入れる」で入れられます）。相続で受け取る時期は、相手の亡くなる見込みの10か月後を推定で入れます。相手の親がまだいなければ、区画「親・祖父母（相続の相手・贈与する人）」の「＋ 親を足す」で足してから相手に選びます",
      level: "simple",
      groups: [...(moneyIn?.groups ?? []).map((g) => withIncludeAction(wh, withCounterpartyFollow(withoutIncludeField(g)))), ...inheritedDebtGroups(wh).map((g) => withIncludeAction(wh, withoutIncludeField(g))), ...groupsOf(readGroup("inherit/receive", undefined, lines.receive))],
      actions: [
        ...receiveActions(moneyIn?.actions ?? []),
        { key: "money/inherit/addDebt", label: "＋ 相続で受け継ぐ借金", level: "detail", run: (w: WorkingHousehold) => addInheritedDebt(w) },
      ],
    },
    {
      key: "inherit/give",
      title: moneyOut?.title ?? "あげる贈与",
      ...(moneyOut?.note !== undefined ? { note: moneyOut.note } : {}),
      level: "simple",
      // 足した孫は、あげる贈与の行の後ろに並べる（「＋ 孫を足す」を押すと、その場に出て呼び名の欄に移る）
      groups: [...(moneyOut?.groups ?? []), ...groupsOf(readGroup("inherit/give", undefined, lines.give)), ...outsideGrandchildren(wh.request.input.household).map((m) => grandchildGroup(wh, m))],
      actions: [...(moneyOut?.actions ?? []), { key: "money/inherit/addGrandchild", label: "＋ 孫を足す", help: "あげる贈与の相手にする孫を、世帯の外の家族（家計が別）として足します。足した孫はこの区画に並び、呼び名と生年月を入れます", level: "detail", run: (w: WorkingHousehold) => addOutsideGrandchild(w) }],
    },
    {
      key: "family/donors",
      title: "親・祖父母（相続の相手・贈与する人）",
      note: [
        "相続で財産を受け取る相手や、住宅資金・教育資金を援助してくれる人（親・祖父母）です。ここで足した人も、介護・親の項目で足した人も、ここに並びます。",
        "・「＋ ご本人の親を足す」などで足した親は、亡くなる見込みを平均余命で推定します。生年月・亡くなる見込みは「介護・親」の項目で直します（同じ人です）",
        "・並んだ人は、受け取る相続・贈与の行の「相手（誰から）」や、援助の「贈与する人」に選んで使います。行ごとの「使っているところ」に、何に選ばれているかが出ます",
        "・生年月が分からず、贈与する人としてだけ置くときは、「詳細」の「＋ 生年月を入れない贈与する人」で足します（祖父母が何人もいれば、その数だけ足せます）",
        "・同じ人からの贈与は、贈与税の基礎控除・相続時精算課税の特別控除を合わせて数えます",
      ].join("\n"),
      level: "simple",
      groups: personGroups(wh),
      // 標準は介護・親の家族として足す「＋ 親を足す」（父・母・父母から選ぶ）だけ。生年月を入れない贈与する人は詳細（同じ親が2人並ぶのを防ぐ）
      actions: [
        ...parentAddActions(wh, "inherit"),
        ...addDonorActions(wh).map((a): ActionDef => ({ ...a, level: "detail", label: a.key === "family/add/donor-parent" ? "＋ 生年月を入れない贈与する人（親）" : a.key === "family/add/donor-grandparent" ? "＋ 生年月を入れない贈与する人（祖父母）" : a.label })),
      ],
    },
    {
      key: "inherit/legacy",
      title: "遺したい額",
      note: `${bothAfterLabel(h) === "表の最後の年" ? "表の最後の年" : "表の最後の年（二人とも亡くなった後）"}に遺したい額。表示だけで、取り崩しの計算は変えません`,
      level: "simple",
      groups: [{ key: "inherit/legacy", level: "simple", fields: [legacyCleanup(legacyField())], actions: [] }],
      actions: [],
    },
    {
      key: "inherit/tax",
      title: "相続税の目安の設定",
      note: `相続税の目安（いま亡くなったら・${bothAfterLabel(h)}・万一の死亡の想定）の計算の前提です。目安は表示だけで、お金の流れには入れません。路線価などで分かる値があれば、ここで直します。税理士などが出した相続税の額は、下の「税理士などが出した相続税の額」に入れます`,
      level: "detail",
      groups: [{ key: "inherit/tax", level: "detail", fields: taxSettingFields(wh), actions: [] }],
      actions: [],
    },
    ...(override !== null ? [{ key: TAX_OVERRIDE_GROUP, title: TAX_OVERRIDE_TITLE, level: "detail" as const, groups: [override], actions: [] }] : []),
  ];
  return { id: "inheritance", label: "相続・贈与", lead: "世代をまたぐお金（受け取る予定の相続・贈与、あげる贈与、遺したい額）と、相続税の目安。", sections };
}
