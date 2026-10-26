// 1. 家族: 続柄・呼び名（任意）・生年月（生年月＋1日生まれか。0012）・性別・独立の時期。贈与する人（親・祖父母）もここでまとめて登録する
import type { Household, Member } from "../../../engine/types.ts";
import { addMonths, ageAt } from "../../levers.ts";
import { roles } from "../../roles.ts";
import { byId, field, plain, removeAction, timepointField, type ActionDef, type FieldDef, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { followStandards, mutate, newId, standardLeaves, type WorkingHousehold } from "../household.ts";
import { creditKey } from "../housingCredit.ts";
import { fillEducation } from "../fill.ts";
import { DONOR_KINDS, KIND_OPTIONS, memberLabel, memberOptions, SEX_OPTIONS } from "../labels.ts";
import { EVENT_KIND_LABEL, eventName, FP_EVENT_KINDS, freezeTimepoints, refsTo, whenPeople } from "../namedEvents.ts";
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
  // 親・祖父母は世帯の外の家族（家計が別。0035 の4）。家計を1つにする期間は FP が入れる
  if ((kind === "parent" || kind === "grandparent") && self !== undefined) m.outside = { of: self.id, periods: [] };
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

/** 子を足し、その子の進路を推定（標準の進路の型）で入れる */
export function addChildWithEducation(wh: WorkingHousehold, id: () => string = newId): WorkingHousehold {
  const before = new Set(wh.request.input.household.members.map((m) => m.id));
  const next = addMember(wh, "child", id);
  const child = next.request.input.household.members.find((m) => !before.has(m.id));
  return child === undefined ? next : fillEducation(next, child.id);
}

/** 家族の「仕送り（月額）」は健康保険の扶養の判定（別居の親・祖父母）にだけ使い、支出の行にはしない（同じ仕送りを支出でも入れた世帯が二重にならないように） */
const ALLOWANCE_HELP = "支出には入りません（健康保険の扶養の判定に使います）。仕送りの支出は「基本生活費」の内訳の「仕送り」か、「ライフイベント」の支出で入れてください";
const ALLOWANCE_NOTE = "仕送り（月額）は健康保険の扶養の判定にだけ使い、支出には入っていません。仕送りを支出に入れるなら、「基本生活費」の内訳の「仕送り」か、「ライフイベント」の支出で入れてください";

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
        anchor: "independence",
        optional: true,
        nullText: "独立しない・未定",
        help: "就職などで家計から離れる時点（例: 22歳・22歳の年度末・2048年4月）。生活費の「末子独立後」の目安にも使います。年齢で入れると、生年月を直したとき合わせて動きます",
      }),
    );
  fields.push(
    plain({ key: `family/${m.id}/expected`, item: "member.expected", label: "これから加わる（出産・結婚の予定）", level: "detail", kind: "bool", find, path: ["expected"] }),
    timepointField({ key: `family/${m.id}/joins`, item: "member.joins", label: "加わる時期", level: "detail", find, path: ["joins"], mode: "ym", optional: true, nullText: "最初から" }),
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
  if (m.outside !== undefined) outsideFields(m, fields, actions);
  const allowance = m.kind === "parent" || m.kind === "grandparent" ? (m.support?.allowance ?? 0) : 0;
  const notes = [...(m.outside !== undefined ? [OUTSIDE_NOTE] : []), ...(allowance > 0 ? [ALLOWANCE_NOTE] : [])];
  return { key: `family/${m.id}`, title: memberLabel(wh, m.id), level: "simple", ...(notes.length > 0 ? { note: notes.join("。") } : {}), fields, actions };
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
        // 新しく足す子は、進路を最初から推定（標準の進路の型）で入れる（古い世帯の子に黙って入れることはしない。fill.ts）
        { key: "family/add/child", label: "＋ 子を足す", level: "simple", run: (w) => addChildWithEducation(w) },
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
  return { id: "family", label: "家族", lead: "家族の構成と生年月。氏名は入れません。", sections };
}
