// 1. 家族: 続柄・呼び名（任意）・生年月（生年月＋1日生まれか。0012）・性別・独立の時期。贈与する人（親・祖父母）もここでまとめて登録する
import type { Household, Member } from "../../../engine/types.ts";
import { ageAt } from "../../levers.ts";
import { roles } from "../../roles.ts";
import { byId, field, plain, removeAction, timepointField, type ActionDef, type FieldDef, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { followStandards, mutate, newId, standardLeaves, type WorkingHousehold } from "../household.ts";
import { DONOR_KINDS, KIND_OPTIONS, memberLabel, memberOptions, SEX_OPTIONS } from "../labels.ts";
import { wareki } from "../units.ts";

const members = (h: Household) => h.members;

/** 欄を書いた後に、標準のままの値（表の最後の年・子の独立の年月）を新しい標準に合わせる（household.ts の followStandards） */
const following = (f: FieldDef): FieldDef => ({ ...f, set: (w, v) => followStandards(w, f.set(w, v)) });

/** 構成員を外す: その人を指す物もいっしょに外す（名義・当事者は構成員 ID で指すため。0008 の1） */
export function removeMember(wh: WorkingHousehold, id: string): WorkingHousehold {
  return followStandards(wh, removeMemberRaw(wh, id));
}

function removeMemberRaw(wh: WorkingHousehold, id: string): WorkingHousehold {
  const next = mutate(wh, (h) => {
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

/** 家族を足す。配偶者・子は関係（0008 の3 の辺）も足す */
export function addMember(wh: WorkingHousehold, kind: "spouse" | "child" | "parent" | "grandparent", id: () => string = newId): WorkingHousehold {
  const h0 = wh.request.input.household;
  const self = h0.members.find((m) => m.kind === "self");
  const spouse = h0.members.find((m) => m.kind === "spouse");
  const base = wh.request.input.baseMonth;
  const [by] = base.split("-").map(Number) as [number];
  const selfYear = self !== undefined ? Number(self.birth.birthYearMonth.slice(0, 4)) : by - 40;
  const newMemberId = id();
  const birthYear = kind === "spouse" ? selfYear + 2 : kind === "child" ? Math.min(by, selfYear + 32) : kind === "parent" ? selfYear - 30 : selfYear - 55;
  const sex = kind === "spouse" ? (self?.sex === "female" ? "male" : "female") : "male";
  const m: Member = { id: newMemberId, kind, birth: { birthYearMonth: `${birthYear}-04`, bornOnFirst: false }, sex, joins: null, leaves: null, expected: false };
  if (kind === "child") m.leaves = { at: standardLeaves(m) };
  let next = mutate(wh, (h) => {
    h.members.push(m);
    h.relations ??= [];
    if (kind === "spouse" && self !== undefined) h.relations.push({ type: "spouse", a: self.id, b: m.id, marriage: "legal", from: null, to: null });
    if (kind === "child") for (const p of [self, spouse]) if (p !== undefined) h.relations.push({ type: "parentOf", parent: p.id, child: m.id });
  });
  // 表の最後の年は、標準のままなら配偶者を入れた標準に合わせる（人が入れた年は変えない）
  next = followStandards(wh, next);
  return { ...next, assumed: { ...next.assumed, [`family/${newMemberId}/birth`]: "仮の値", [`family/${newMemberId}/sex`]: "仮の値" } };
}

function memberGroup(wh: WorkingHousehold, m: Member): GroupDef {
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
  fields.push(
    following(plain({
      key: `family/${m.id}/birth`,
      item: "member.birth",
      label: "生年月",
      level: "simple",
      kind: "ym",
      find,
      path: ["birth", "birthYearMonth"],
      help: "日は聞きません。1日生まれだけ下で選びます",
      hint: (v) => (typeof v === "string" ? ageNow(v) : null),
    })),
    following(plain({ key: `family/${m.id}/bornOnFirst`, item: "member.birth", label: "1日生まれ", level: "simple", kind: "bool", find, path: ["birth", "bornOnFirst"], help: "年齢に達する月が1か月早くなります（年金・定年などの時期）" })),
    plain({ key: `family/${m.id}/sex`, item: "member.sex", label: "性別", level: "simple", kind: "select", options: SEX_OPTIONS, find, path: ["sex"], help: "遺族年金などの計算に使います" }),
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
        optional: true,
        nullText: "独立しない・未定",
        help: "就職などで家計から離れる年月。生活費の「末子独立後」の目安にも使います。標準（22歳になる月）のままなら、生年月を直すと合わせて変わります",
      }),
    );
  fields.push(
    plain({ key: `family/${m.id}/expected`, item: "member.expected", label: "これから加わる（出産・結婚の予定）", level: "detail", kind: "bool", find, path: ["expected"] }),
    timepointField({ key: `family/${m.id}/joins`, item: "member.joins", label: "加わる時期", level: "detail", find, path: ["joins"], optional: true, nullText: "最初から" }),
  );
  if (m.kind === "parent" || m.kind === "grandparent")
    fields.push(
      plain({ key: `family/${m.id}/dependent`, item: "member.support", label: "扶養している", level: "detail", kind: "bool", find, path: ["support", "dependent"], optional: true, fallback: false }),
      plain({ key: `family/${m.id}/cohabiting`, item: "member.support", label: "同居している", level: "detail", kind: "bool", find, path: ["support", "cohabiting"], optional: true, fallback: false }),
      plain({ key: `family/${m.id}/allowance`, item: "member.support", label: "仕送り（月額）", level: "detail", kind: "yen", basis: "monthly", find, path: ["support", "allowance"], optional: true }),
    );
  const actions: ActionDef[] = m.kind === "self" ? [] : [{ key: `family/${m.id}/remove`, label: "この家族を外す", level: "simple", danger: true, run: (w) => removeMember(w, m.id) }];
  return { key: `family/${m.id}`, title: memberLabel(wh, m.id), level: "simple", fields, actions };
}

function donorGroups(wh: WorkingHousehold): GroupDef[] {
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

export function familyStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const order = roles(wh.request).map((r) => r.member);
  const hasSpouse = h.members.some((m) => m.kind === "spouse");
  const selfId = h.members.find((m) => m.kind === "self")?.id;
  const sections: SectionDef[] = [
    {
      key: "family/members",
      title: "家族の構成",
      note: "お名前の欄はありません。続柄と、必要なら FP が付ける呼び名で表します",
      level: "simple",
      groups: order.map((m) => memberGroup(wh, m)),
      actions: [
        ...(hasSpouse ? [] : [{ key: "family/add/spouse", label: "＋ 配偶者を足す", level: "simple" as const, run: (w: WorkingHousehold) => addMember(w, "spouse") }]),
        { key: "family/add/child", label: "＋ 子を足す", level: "simple", run: (w) => addMember(w, "child") },
        { key: "family/add/parent", label: "＋ 親（同居・扶養）を足す", level: "detail", run: (w) => addMember(w, "parent") },
      ],
    },
    {
      key: "family/donors",
      title: "贈与する人（親・祖父母）",
      note: "世帯の外の親・祖父母をここでまとめて登録すると、住宅資金・教育資金などの援助で選べます。同じ人からの贈与は、贈与税の基礎控除・相続時精算課税の特別控除を合わせて数えます",
      level: "simple",
      groups: donorGroups(wh),
      actions: [
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
      ],
    },
  ];
  return { id: "family", label: "家族", lead: "家族の構成と生年月。氏名は入れません。", sections };
}
