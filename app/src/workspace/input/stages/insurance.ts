// 7. 保険: 保険契約の基本（種類・契約者・被保険者・契約年月・保険料と払い方・払込の終わり・死亡保険金）。保障の明細と控除の区分は詳細で
import type { Coverage, Household, InsuranceContract, Timepoint } from "../../../engine/types.ts";
import { addMonths, ageAt } from "../../levers.ts";
import { byId, field, getPath, plain, removeAction, timepointField, type FieldDef, type Finder, type GroupDef, type StageDef } from "../form.ts";
import { mutate, newId, type WorkingHousehold } from "../household.ts";
import { BENEFITS, DEDUCTION_TYPES, INSURANCE_TEMPLATES, memberLabel, memberOptions, PREMIUM_FREQUENCY } from "../labels.ts";

const contracts = (h: Household) => h.insuranceContracts;

/** 払込の終わり: 被保険者の年齢（memberAge）で見せる。null は終身払い */
function payUntilField(find: Finder, k: string): FieldDef {
  return field({
    key: `${k}/payUntil`,
    item: "insurance.premium",
    label: "払込の終わり（被保険者の年齢）",
    level: "simple",
    kind: "int",
    suffix: "歳まで",
    min: 1,
    max: 120,
    optional: true,
    help: "空欄は終身払い（一時払いは不要）",
    get: (w) => {
      const h = w.request.input.household;
      const x = find(h, w) as InsuranceContract | undefined;
      const t = x?.premium.payUntil;
      if (t == null) return { value: null, hint: x?.premium.frequency === "single" ? "一時払い" : "終身払い" };
      if (t.memberAge !== undefined) return { value: t.memberAge.years, derived: t.memberAge.months ? "か月まで指定した時点" : t.memberAge.member !== x?.insured ? "被保険者でない人の年齢" : null };
      const m = h.members.find((y) => y.id === x?.insured);
      return { value: t.at !== undefined && m !== undefined ? ageAt(m, addMonths(t.at, 1)) : null, derived: "年月で決めた時点" };
    },
    set: (w, v) =>
      mutate(w, (h) => {
        const x = find(h, w) as InsuranceContract | undefined;
        if (x === undefined) return;
        x.premium.payUntil = v === null ? null : ({ memberAge: { member: x.insured, years: Number(v), months: 0 } } as Timepoint);
      }),
  });
}

function contractGroups(wh: WorkingHousehold, c: InsuranceContract, i: number): GroupDef[] {
  const find = byId(contracts, c.id);
  const k = `ins/${c.id}`;
  const deathIdx = (c.coverages ?? []).findIndex((x) => x.role === "main" && x.benefit === "death");
  const fields: FieldDef[] = [
    plain({ key: `${k}/template`, item: "insurance.template", label: "種類", level: "simple", kind: "select", options: INSURANCE_TEMPLATES, find, path: ["template"] }),
    plain({ key: `${k}/holder`, item: "insurance.policyholder", label: "契約者（保険料を払う人）", level: "simple", kind: "select", options: memberOptions(wh), find, path: ["policyholder"] }),
    plain({ key: `${k}/insured`, item: "insurance.insured", label: "被保険者", level: "simple", kind: "select", options: memberOptions(wh), find, path: ["insured"] }),
    plain({ key: `${k}/date`, item: "insurance.contractDate", label: "契約年月", level: "simple", kind: "ym", find, path: ["contractDate"] }),
    plain({ key: `${k}/premium`, item: "insurance.premium", label: "保険料（1回の額）", level: "simple", kind: "yen", basis: "once", find, path: ["premium", "amount"] }),
    plain({ key: `${k}/freq`, item: "insurance.premium", label: "払い方", level: "simple", kind: "select", options: PREMIUM_FREQUENCY, find, path: ["premium", "frequency"] }),
    payUntilField(find, k),
  ];
  if (deathIdx >= 0) {
    const findCov: Finder = (h, w) => (getPath(find(h, w), ["coverages", String(deathIdx)]) as Record<string, unknown> | undefined) ?? undefined;
    fields.push(plain({ key: `${k}/death`, item: "insurance.coverages", label: "死亡保険金", level: "simple", kind: "yen", basis: "once", find: findCov, path: ["amount"] }));
  }
  fields.push(
    plain({ key: `${k}/deduction`, item: "insurance.deductionCategory", label: "保険料控除の区分", level: "detail", kind: "select", options: DEDUCTION_TYPES, find, path: ["deductionCategory", "type"] }),
    plain({
      key: `${k}/regime`,
      item: "insurance.deductionCategory",
      label: "新旧の制度",
      level: "detail",
      kind: "select",
      options: [
        { value: "new", label: "新制度（2012年以後の契約）" },
        { value: "old", label: "旧制度" },
      ],
      find,
      path: ["deductionCategory", "regime"],
    }),
    plain({ key: `${k}/waiver`, item: "insurance.waiver", label: "払込免除の特約がある", level: "detail", kind: "bool", find, path: ["waiver"], optional: true, fallback: false }),
  );
  const groups: GroupDef[] = [
    {
      key: k,
      title: `${INSURANCE_TEMPLATES.find((o) => o.value === c.template)?.label ?? "保険"} ${i + 1}（被保険者: ${memberLabel(wh, c.insured)}）`,
      level: "simple",
      fields,
      actions: [removeAction(`${k}/remove`, "この契約を外す", "simple", (h) => void (h.insuranceContracts = (h.insuranceContracts ?? []).filter((x) => x.id !== c.id)))],
    },
  ];
  (c.coverages ?? []).forEach((cov: Coverage, j) => {
    const findCov: Finder = (h, w) => (getPath(find(h, w), ["coverages", String(j)]) as Record<string, unknown> | undefined) ?? undefined;
    const kc = `${k}/cov/${cov.id}`;
    groups.push({
      key: kc,
      title: `保障 ${j + 1}（${cov.role === "main" ? "主契約" : "特約"}）`,
      level: "detail",
      fields: [
        plain({ key: `${kc}/benefit`, item: "insurance.coverages", label: "給付の種類", level: "detail", kind: "select", options: BENEFITS, find: findCov, path: ["benefit"] }),
        plain({ key: `${kc}/amount`, item: "insurance.coverages", label: "金額", level: "detail", kind: "yen", basis: "once", find: findCov, path: ["amount"] }),
        timepointField({ key: `${kc}/from`, item: "insurance.coverages", label: "保障の始まり", level: "detail", find: findCov, path: ["from"] }),
        timepointField({ key: `${kc}/to`, item: "insurance.coverages", label: "保障の終わり", level: "detail", find: findCov, path: ["to"], optional: true, nullText: "終身" }),
      ],
      actions: [
        removeAction(`${kc}/remove`, "外す", "detail", (h, w) => {
          const x = find(h, w) as InsuranceContract | undefined;
          if (x?.coverages === undefined) return;
          x.coverages = x.coverages.filter((y) => y.id !== cov.id);
          if (x.coverages.length === 0) delete x.coverages;
        }),
      ],
    });
  });
  groups.push({
    key: `${k}/addCov`,
    level: "detail",
    fields: [],
    actions: [
      {
        key: `${k}/addCoverage`,
        label: "＋ 保障（主契約・特約）",
        level: "detail",
        run: (w) =>
          mutate(w, (h) => {
            const x = find(h, w) as InsuranceContract | undefined;
            if (x === undefined) return;
            const role = (x.coverages ?? []).some((y) => y.role === "main") ? "rider" : "main";
            (x.coverages ??= []).push({ id: newId(), role, benefit: role === "main" ? "death" : "hospitalDaily", amount: role === "main" ? 10000000 : 5000, from: { at: x.contractDate }, to: null });
          }),
      },
    ],
  });
  return groups;
}

export function insuranceStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self");
  return {
    id: "insurance",
    label: "保険",
    lead: "加入中の保険契約。保険証券の契約者・被保険者・保険料・保障額を写します。",
    sections: [
      {
        key: "ins/contracts",
        title: "保険契約",
        level: "simple",
        groups: (h.insuranceContracts ?? []).flatMap((c, i) => contractGroups(wh, c, i)),
        actions: [
          {
            key: "ins/add",
            label: "＋ 保険契約",
            level: "simple",
            run: (w) =>
              mutate(w, (hh) => {
                if (self === undefined) return;
                const date = addMonths(w.request.input.baseMonth, -12);
                (hh.insuranceContracts ??= []).push({
                  id: newId(),
                  template: "insurance.term",
                  policyholder: self.id,
                  insured: self.id,
                  contractDate: date,
                  currency: "JPY",
                  premium: { amount: 5000, frequency: "monthly", payUntil: { memberAge: { member: self.id, years: 65, months: 0 } } },
                  coverages: [{ id: newId(), role: "main", benefit: "death", amount: 10000000, from: { at: date }, to: { memberAge: { member: self.id, years: 65, months: 0 } } }],
                  deductionCategory: { type: "general", regime: "new" },
                });
              }),
          },
        ],
      },
    ],
  };
}
