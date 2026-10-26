// ライフイベント（一時的な収支）: 一時的支出・n年ごとの支出（旅行・家電・結婚の援助など）、介護の費用。
// 車（cars.ts）・FP顧問料（fees.ts）は別の項目。FP が別のカードに足した物（items.ts の addedItems）は、ここには出さない
import type { CareExpense, Household, PeriodicExpense } from "../../../engine/types.ts";
import { addMonths, ageReachedMonth } from "../../levers.ts";
import { byId, plain, removeAction, resolveTimepoint, timepointField, yenBox, type FieldDef, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, presetBasis, standardBox, type WorkingHousehold } from "../household.ts";
import { CARE_PLACE, memberLabel, memberOptions, PERIODIC_ROWS } from "../labels.ts";

const periodic = (h: Household) => h.periodicExpenses;
const cares = (h: Household) => h.careExpenses;

export function periodicGroup(wh: WorkingHousehold, p: PeriodicExpense): GroupDef {
  const find = byId(periodic, p.id);
  const k = `ev/${p.id}`;
  const self = wh.request.input.household.members.find((m) => m.kind === "self");
  const ageOf = self !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === self.id) } : {};
  const h0 = wh.request.input.household;
  const once = p.everyYears === 1 && p.to != null && resolveTimepoint(h0, p.to) !== null && resolveTimepoint(h0, p.to) === resolveTimepoint(h0, p.from);
  const fields: FieldDef[] = [
    plain({ key: `${k}/label`, item: "periodicExpense.label", label: "名前", level: "simple", kind: "text", find, path: ["label"], optional: true }),
    yenBox({ key: `${k}/amount`, item: "periodicExpense.amount", label: "1回の額", level: "simple", basis: "once", find, path: ["amount"] }),
    timepointField({ key: `${k}/from`, item: "periodicExpense.from", label: once ? "時期" : "初め", level: "simple", find, path: ["from"], ...ageOf }),
    plain({ key: `${k}/every`, item: "periodicExpense.everyYears", label: "何年ごと", level: "simple", kind: "int", suffix: "年ごと", min: 1, max: 50, find, path: ["everyYears"], help: "1回だけのときは、終わりを初めと同じ年月にします" }),
    timepointField({ key: `${k}/to`, item: "periodicExpense.to", label: "終わり", level: "simple", find, path: ["to"], startPath: ["from"], optional: true, nullText: "最後まで", ...ageOf }),
    plain({ key: `${k}/row`, item: "periodicExpense.row", label: "キャッシュフロー表の行", level: "detail", kind: "select", options: PERIODIC_ROWS, find, path: ["row"] }),
  ];
  return {
    key: k,
    title: `${p.label ?? (once ? "一時的支出" : "n年ごとの支出")}${once ? "（1回）" : `（${p.everyYears}年ごと）`}`,
    level: "simple",
    fields,
    actions: [removeAction(`${k}/remove`, "外す", "simple", (h) => void (h.periodicExpenses = (h.periodicExpenses ?? []).filter((x) => x.id !== p.id)))],
  };
}

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
      groups: (h.periodicExpenses ?? []).filter((p) => !claimed.has(p.id)).map((p) => periodicGroup(wh, p)),
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
  ];
  return { id: "events", label: "ライフイベント", lead: "一時的な収支（旅行・買い替え・援助など）と介護。", sections };
}
