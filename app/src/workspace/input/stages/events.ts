// ライフイベント（一時的な収支）: 一時的支出・n年ごとの支出（旅行・家電・結婚の援助など）、介護の費用。
// 車（cars.ts）・FP顧問料（fees.ts）は別の項目。FP が別のカードに足した物（items.ts の addedItems）は、ここには出さない
import type { CareExpense, Household } from "../../../engine/types.ts";
import { addMonths, ageReachedMonth } from "../../levers.ts";
import { byId, plain, removeAction, timepointField, yenBox, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, presetBasis, standardBox, type WorkingHousehold } from "../household.ts";
import { CARE_PLACE, memberLabel, memberOptions } from "../labels.ts";
import { addInheritedDebt, addOutsideGrandchild, expenseCard, inheritedDebtGroups, moneySections, periodicGroups } from "../moneyRows.ts";

// 出るお金の行のまとまり（周期的な支出）は、どのカードでも同じ形（moneyRows.ts。0044）
export { periodicGroup, periodicGroups, periodicStageGroups } from "../moneyRows.ts";

const cares = (h: Household) => h.careExpenses;

export function careGroup(wh: WorkingHousehold, c: CareExpense): GroupDef {
  const find = byId(cares, c.id);
  const k = `ev/care/${c.id}`;
  return {
    key: k,
    title: `介護の費用（${memberLabel(wh, c.member)}）`,
    note: "空欄の額は統計の目安（生命保険文化センターの調査など）で計算します",
    level: "simple",
    fields: [
      plain({ key: `${k}/member`, item: "care.member", label: "介護を受ける人", level: "simple", kind: "select", options: memberOptions(wh), find, path: ["member"] }),
      timepointField({ key: `${k}/from`, item: "care.from", label: "始まり", level: "simple", find, path: ["from"], ageOf: (h) => h.members.find((m) => m.id === (h.careExpenses ?? []).find((x) => x.id === c.id)?.member), anchor: "careStart" }),
      plain({ key: `${k}/months`, item: "care.months", label: "期間", level: "simple", kind: "int", suffix: "か月", min: 1, max: 600, find, path: ["months"], optional: true }),
      plain({ key: `${k}/place`, item: "care.place", label: "在宅か施設か", level: "simple", kind: "select", options: CARE_PLACE, find, path: ["place"], optional: true, fallback: "home" }),
      yenBox({ key: `${k}/service`, item: "care.serviceMonthly", label: "介護保険の対象の費用（月額・1割負担の前）", level: "detail", basis: "monthly", find, path: ["serviceMonthly"], optional: true }),
      yenBox({ key: `${k}/other`, item: "care.otherMonthly", label: "対象外の費用（月額）", level: "detail", basis: "monthly", find, path: ["otherMonthly"], optional: true }),
      yenBox({ key: `${k}/initial`, item: "care.initial", label: "一時費用（住宅改修・介護用品など）", level: "detail", basis: "once", find, path: ["initial"], optional: true }),
      plain({ key: `${k}/payer`, item: "care.payer", label: "払う人", level: "detail", kind: "select", options: [{ value: "", label: "介護を受ける人" }, ...memberOptions(wh)], find, path: ["payer"], optional: true, fallback: "" }),
    ],
    actions: [removeAction(`${k}/remove`, "外す", "simple", (h) => void (h.careExpenses = (h.careExpenses ?? []).filter((x) => x.id !== c.id)))],
  };
}

export function eventsStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const self = h.members.find((m) => m.kind === "self");
  const claimed = new Set(wh.addedItems.map((a) => a.ref));
  const sections: SectionDef[] = [
    {
      key: "ev/periodic",
      title: "一時的支出・n年ごとの支出",
      note: "旅行・家電の買い替え・リフォーム・結婚の援助など。毎月の基本生活費とは別に入れます",
      level: "simple",
      groups: (h.periodicExpenses ?? []).filter((p) => !claimed.has(p.id) && expenseCard(h, p) === "events").flatMap((p) => periodicGroups(wh, p)),
      actions: [
        {
          key: "ev/addOnce",
          label: "＋ 一時的支出（1回）",
          level: "simple",
          run: (w) => {
            const at = addMonths(base, 12);
            return mutate(w, (hh) => void (hh.periodicExpenses ??= []).push({ id: newId(), label: "一時的支出", row: "cf.expense.lumpSum.other", from: { at }, to: { at }, everyYears: 1, amount: standardBox(500000, presetBasis("一時的支出 50万円")) }));
          },
        },
        {
          key: "ev/addEvery",
          label: "＋ n年ごとの支出",
          level: "simple",
          run: (w) => mutate(w, (hh) => void (hh.periodicExpenses ??= []).push({ id: newId(), label: "家電の買い替え", row: "cf.expense.lumpSum.other", from: { at: addMonths(base, 12) }, to: null, everyYears: 5, amount: standardBox(300000, presetBasis("家電の買い替え 5年ごとに30万円")) })),
        },
      ],
    },
    // 入るお金（祝い金・一時所得・動産の売却・その他の入金。0044）
    ...moneySections(wh, "events", { claimed, level: "simple", inTitle: "入るお金（祝い金・一時の入金など）" }).filter((x) => x.key.endsWith("/in")),
    {
      key: "ev/care",
      title: "介護",
      level: "simple",
      groups: (h.careExpenses ?? []).filter((c) => !claimed.has(c.id)).map((c) => careGroup(wh, c)),
      actions: [
        {
          key: "ev/addCare",
          label: "＋ 介護の費用",
          level: "simple",
          run: (w) =>
            mutate(w, (hh) => {
              const who = hh.members.find((m) => m.kind === "parent") ?? self;
              if (who === undefined) return;
              const at = who.kind === "self" ? ageReachedMonth(who, 80) : addMonths(base, 60);
              (hh.careExpenses ??= []).push({ id: newId(), member: who.id, from: { at }, months: 61, place: "home" });
            }),
        },
      ],
    },
    // 介護・親（親からの援助・親への仕送り）と、相続・贈与（受け取る予定・あげる贈与・受け継ぐ借金）。カードを組み直すまでここに置く（0044）
    ...moneySections(wh, "care", { claimed, inTitle: "親からの援助・仕送り（入るお金）", outTitle: "親への仕送り（出るお金）" }),
    ...moneySections(wh, "inherit", {
      claimed,
      level: "simple",
      inTitle: "相続・贈与で受け取る予定（入るお金）",
      outTitle: "あげる贈与（出るお金）",
      note: "孫などへの贈与。贈与税は受け取る人が払うので、世帯からは出さず、結果の要約に出します",
    }).map((sec) =>
      sec.key.endsWith("/in")
        ? {
            ...sec,
            note: "見込みが「不確か」の受け取る相続・贈与は、基本の計算に入れません（行は残ります）。相手は世帯の外の家族（家族のカード）から選びます",
            groups: [...sec.groups, ...inheritedDebtGroups(wh)],
            actions: [...sec.actions, { key: "money/inherit/addDebt", label: "＋ 相続で受け継ぐ借金", level: "detail" as const, run: (w: WorkingHousehold) => addInheritedDebt(w) }],
          }
        : { ...sec, actions: [...sec.actions, { key: "money/inherit/addGrandchild", label: "＋ 孫（世帯の外の家族）を足す", level: "detail" as const, run: (w: WorkingHousehold) => addOutsideGrandchild(w) }] },
    ),
  ];
  return { id: "events", label: "ライフイベント", lead: "一時的な収支（旅行・買い替え・援助など）と介護。介護・親と相続・贈与のお金の行もここで入れます。", sections };
}
