// 13. 相続・贈与: 世代をまたぐお金を1枚に集める。
// - 区画A 受け取る予定の相続・贈与（入るお金の行と、相続で受け継ぐ借金）: moneyRows.ts の区画「inherit」。見込み（確実・当てにしない）は簡易。
//   「当てにしない」の行は基本の計算に入れない（0044 の5）。行に「この行を計算に入れる」の1押し。相続の受け取る時期は、相手の亡くなる見込みの10か月後を推定で
// - 区画B あげる贈与（出るお金の行）。今ある援助の物（子への援助 goals.education.gifts・住宅資金の援助 residences.purchase.gifts）は物の形を変えず、
//   子ども・教育／住まい・ローンのカードで入れ、ここには読むだけで並べる
// - 贈与する人（親・祖父母。生年月を持たない世帯の外の家族）: 物と欄は介護・親のカードの世帯の外の家族の区画。ここは読むだけの1行と「＋ 足す」
// - 区画C 遺したい額（表示だけ。表の最後の年の金融資産と比べる。input.legacy）
// - 区画D 相続税の目安: 結果は計算の結果から読む（inheritanceLine.ts。表示だけで、お金の流れには入れない）。ここは目安の設定の欄
//   （不動産の評価の割合・名義の無い財産の分け方・葬式の費用・養子・法定相続人の数を直す口・FP が入れた額。input.inheritanceTax。0039・0060）
import type { Household, IncomeFlow, InheritanceTaxRequest, Member, Timepoint } from "../../../engine/types.ts";
import { excludedIncome } from "../../../engine/moneyRows.ts";
import { field, resolveTimepoint, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { mutate, type WorkingHousehold } from "../household.ts";
import { donorLabel, GIFT_PURPOSES, memberLabel } from "../labels.ts";
import { manYen, readGroup, readLine } from "../readLines.ts";
import type { Address } from "../../store/readings.ts";
import { formatYearMonth } from "../units.ts";
import { addInheritedDebt, addOutsideGrandchild, inheritedDebtGroups, moneySections } from "../moneyRows.ts";
import { NONE_CLAIMED } from "./events.ts";
import { addDonorActions } from "./family.ts";

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

/** 贈与する人（物と欄は介護・親のカードの世帯の外の家族。ここは読むだけの1行） */
export function donorLines(wh: WorkingHousehold): FieldDef[] {
  const h = wh.request.input.household;
  return (h.donors ?? []).map((d) => {
    let used = 0;
    for (const r of h.residences ?? []) for (const g of r.purchase?.gifts ?? []) if (g.donor === d.id) used++;
    for (const goal of h.goals ?? []) for (const g of goal.education?.gifts ?? []) if (g.donor === d.id) used++;
    return readLine(`inherit/donor/${d.id}`, `贈与する人（${donorLabel(wh, d)}）`, used > 0 ? `援助 ${String(used)} 件で選ばれています` : "まだ援助で選ばれていません", "介護・親");
  });
}

// ---- 区画A 受け取る予定 ----

/** 相続の受け取る時期の推定: 相手の亡くなる見込みの10か月後（申告と納税の期限の目安） */
export const INHERIT_AFTER_MONTHS = 10;
const INHERIT_BASIS = "推定（相手の亡くなる見込みの10か月後。相続税の申告と納税の期限の目安）";

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

/** 区画Aの「＋ 足す」: 足した後に、受け取る時期を相手の亡くなる見込みから推定する */
function receiveActions(actions: readonly ActionDef[]): ActionDef[] {
  return actions.map((a) => ({
    ...a,
    run: (w) => {
      const before = new Set((w.request.input.household.incomeFlows ?? []).map((f) => f.id));
      const next = a.run(w);
      const added = (next.request.input.household.incomeFlows ?? []).find((f) => !before.has(f.id));
      return added === undefined ? next : inheritTimingFromCounterparty(next, added.id);
    },
  }));
}

/** 見込みが「当てにしない」で基本の計算に入れていない行に「この行を計算に入れる」（プランを直しているときは、そのプランの差分になる） */
function withIncludeAction(wh: WorkingHousehold, g: GroupDef): GroupDef {
  const id = g.key.startsWith("in/") && !g.key.slice(3).includes("/") ? g.key.slice(3) : null;
  const f: IncomeFlow | undefined = id === null ? undefined : (wh.request.input.household.incomeFlows ?? []).find((x) => x.id === id);
  if (f === undefined || !excludedIncome(f)) return g;
  const include: ActionDef = {
    key: `in/${f.id}/includeInBase`,
    label: "この行を計算に入れる（見込みは「当てにしない」のまま）",
    level: "simple",
    run: (w) =>
      mutate(w, (h) => {
        const x = (h.incomeFlows ?? []).find((y) => y.id === f.id);
        if (x !== undefined) x.includeInBase = true;
      }),
  };
  return { ...g, actions: [include, ...g.actions] };
}

// ---- 区画C 遺したい額・区画D 相続税の目安の設定 ----

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
function taxField(o: { key: string; label: string; kind: "pct" | "yen" | "int"; at: string[]; help: string; get: (t: InheritanceTaxRequest) => number | string | null; set: (t: InheritanceTaxRequest, v: number | string | null) => void }): FieldDef {
  const base = { key: o.key, item: "plan.inheritanceTax", label: o.label, level: "detail" as const, optional: true, help: o.help, get: (w: WorkingHousehold) => ({ value: o.get(taxOf(w)) }), set: (w: WorkingHousehold, v: unknown) => writeTax(w, (t) => o.set(t, v === null || v === "" ? null : (v as number | string))), address: onInput("plan.inheritanceTax", o.at) };
  if (o.kind === "pct") return field({ ...base, kind: "pct" });
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
      label: "不動産の評価の割合（時価に掛ける）",
      kind: "pct",
      at: ["realEstateRatio"],
      help: "空欄は時価の80%（土地の路線価は公示価格等の8割程度を目安に定められるため。建物の固定資産税評価額も時価より低いのが普通）。路線価で分かれば直してください",
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
        help: "名義を入れていない預金・持ち家など。空欄は夫婦で半分ずつ（50%）",
        get: (t) => t.unassignedShare ?? null,
        set: (t, v) => (v === null ? delete t.unassignedShare : (t.unassignedShare = String(v))),
      }),
    );
  fields.push(
    taxField({
      key: "inherit/tax/funeral",
      label: "葬式の費用（財産から引く）",
      kind: "yen",
      at: ["funeral"],
      help: "空欄は引きません",
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
  // 法定相続人の数を直す口（亡くなる人ごと）・FP が入れた額（時点ごと）
  for (const m of couple)
    fields.push(
      taxField({
        key: `inherit/tax/heirs/${m.id}`,
        label: `法定相続人の数を直す（${memberLabel(wh, m.id)}が亡くなったとき）`,
        kind: "int",
        at: ["heirCounts"],
        help: "空欄は家族と世帯の外の家族から数えます。相続の放棄（数え方では放棄が無かったものとする）・代襲を入力で表せないときに直します",
        get: (t) => t.heirCounts?.find((x) => x.decedent === m.id)?.count ?? null,
        set: (t, v) => (t.heirCounts = [...(t.heirCounts ?? []).filter((x) => x.decedent !== m.id), ...(v === null ? [] : [{ decedent: m.id, count: Math.max(0, Math.round(Number(v))) }])]),
      }),
    );
  const points: { point: "now" | "bothAfter" | "contingency"; decedent?: string; label: string }[] = [
    ...couple.map((m) => ({ point: "now" as const, decedent: m.id, label: `いま${memberLabel(wh, m.id)}が亡くなったら` })),
    ...(couple.length > 0 ? [{ point: "bothAfter" as const, label: couple.length === 2 ? "二人とも亡くなった後" : "表の最後の年" }] : []),
    ...couple.map((m) => ({ point: "contingency" as const, decedent: m.id, label: `万一のタブの${memberLabel(wh, m.id)}の死亡の想定` })),
  ];
  for (const p of points)
    fields.push(
      taxField({
        key: `inherit/tax/override/${p.point}${p.decedent !== undefined ? `/${p.decedent}` : ""}`,
        label: `税理士などの出した額（${p.label}）`,
        kind: "yen",
        at: ["overrides"],
        help: "入れると、目安の代わりにこの額を使います（目安と内訳は横に残ります）。消せば目安に戻ります",
        get: (t) => t.overrides?.find((x) => x.point === p.point && x.decedent === p.decedent)?.amount ?? null,
        set: (t, v) =>
          (t.overrides = [...(t.overrides ?? []).filter((x) => !(x.point === p.point && x.decedent === p.decedent)), ...(v === null ? [] : [{ point: p.point, ...(p.decedent !== undefined ? { decedent: p.decedent } : {}), amount: Math.max(0, Math.round(Number(v))) }])]),
      }),
    );
  return fields;
}

/** 遺したい額の欄（表示だけ。表の最後の年の金融資産と比べる） */
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
      help: "空欄は目標を出しません。入れると、表の最後の年の金融資産と比べて、足りるかを出します（計算のお金の流れには入れません）",
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
  const lines = giftLines(wh);
  const groupsOf = (g: GroupDef | null): GroupDef[] => (g !== null ? [g] : []);
  // 受け取る予定の相続・贈与（入るお金）と、あげる贈与（出るお金）の行（moneyRows.ts の区画「inherit」。0044）。今ある援助の物は読むだけの1行を後ろに足す
  const money = moneySections(wh, "inherit", {
    claimed: NONE_CLAIMED,
    level: "simple",
    inTitle: "受け取る予定の相続・贈与（入るお金）",
    outTitle: "あげる贈与（出るお金）",
    note: "孫などへの贈与。贈与税は受け取る人が払うので、世帯からは出さず、結果の要約に出します",
  });
  const moneyIn = money.find((x) => x.key.endsWith("/in"));
  const moneyOut = money.find((x) => x.key.endsWith("/out"));
  const sections: SectionDef[] = [
    {
      key: "inherit/receive",
      title: moneyIn?.title ?? "受け取る予定の相続・贈与",
      note: "見込み（確実・当てにしない）を行ごとに選びます。「当てにしない」の受け取る相続・贈与は、基本の計算に入れません（行は残り、「この行を計算に入れる」で入れられます）。相手は世帯の外の家族（介護・親の項目）から選び、相続の受け取る時期は相手の亡くなる見込みの10か月後を推定で入れます",
      level: "simple",
      groups: [...(moneyIn?.groups ?? []).map((g) => withIncludeAction(wh, g)), ...inheritedDebtGroups(wh), ...groupsOf(readGroup("inherit/receive", undefined, lines.receive))],
      actions: [...receiveActions(moneyIn?.actions ?? []), { key: "money/inherit/addDebt", label: "＋ 相続で受け継ぐ借金", level: "detail", run: (w: WorkingHousehold) => addInheritedDebt(w) }],
    },
    {
      key: "inherit/give",
      title: moneyOut?.title ?? "あげる贈与",
      ...(moneyOut?.note !== undefined ? { note: moneyOut.note } : {}),
      level: "simple",
      groups: [...(moneyOut?.groups ?? []), ...groupsOf(readGroup("inherit/give", undefined, lines.give))],
      actions: [...(moneyOut?.actions ?? []), { key: "money/inherit/addGrandchild", label: "＋ 孫（世帯の外の家族）を足す", level: "detail", run: (w: WorkingHousehold) => addOutsideGrandchild(w) }],
    },
    {
      key: "family/donors",
      title: "贈与する人（親・祖父母）",
      note: "世帯の外の親・祖父母を贈与する人として足すと、住宅資金・教育資金などの援助で選べます。同じ人からの贈与は、贈与税の基礎控除・相続時精算課税の特別控除を合わせて数えます。足した人は、介護・親の項目の世帯の外の家族に並びます",
      level: "simple",
      groups: groupsOf(readGroup("inherit/donors", undefined, donorLines(wh))),
      actions: addDonorActions(wh),
    },
    {
      key: "inherit/legacy",
      title: "遺したい額",
      note: "表の最後の年（二人とも亡くなった後）に遺したい額。表示だけで、取り崩しの計算は変えません",
      level: "simple",
      groups: [{ key: "inherit/legacy", level: "simple", fields: [legacyCleanup(legacyField())], actions: [] }],
      actions: [],
    },
    {
      key: "inherit/tax",
      title: "相続税の目安の設定",
      note: "相続税の目安（いま亡くなったら・二人とも亡くなった後・万一の死亡の想定）は表示だけで、お金の流れには入れません。路線価・税理士の試算などで分かる値があれば、ここで直します",
      level: "detail",
      groups: [{ key: "inherit/tax", level: "detail", fields: taxSettingFields(wh), actions: [] }],
      actions: [],
    },
  ];
  return { id: "inheritance", label: "相続・贈与", lead: "世代をまたぐお金（受け取る予定の相続・贈与、あげる贈与、遺したい額）と、相続税の目安。", sections };
}
