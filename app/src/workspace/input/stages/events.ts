// ライフイベント（一時的な収支）: 一時的支出・n年ごとの支出（旅行・家電・結婚の援助など）と、入るお金（祝い金・一時の入金など）。
// 車（cars.ts）・FP顧問料（fees.ts）は別の項目。介護の費用は介護・親のカード（care.ts。careGroup はここに置いたまま使う）、子の年齢で始まる支出は
// 子ども・教育のカード、介護・親と相続・贈与のお金の行はそれぞれのカードに出す（ここは読むだけの1行）。FP が「＋ 項目を追加」で足した物もここに出る（ホームのピンは見せ方だけ。items.ts）
import type { CareExpense, Household, PeriodicExpense } from "../../../engine/types.ts";
import { addMonths } from "../../levers.ts";
import { byId, plain, removeAction, timepointField, yenBox, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, presetBasis, standardBox, type WorkingHousehold } from "../household.ts";
import { CARE_PLACE, memberLabel, memberOptions } from "../labels.ts";
import { expenseCard, growthFields, moneySections, periodicGroups } from "../moneyRows.ts";
import { onContingencyDetailFields, onContingencyFields } from "./onContingency.ts";
import { readGroup, readLine } from "../readLines.ts";

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
      yenBox({ key: `${k}/other`, item: "care.otherMonthly", label: "月々の費用（自己負担の合計）", level: "simple", basis: "monthly", find, path: ["otherMonthly"], optional: true, help: "空欄は統計の目安（在宅・施設の平均の月額）で計算します。施設の請求書の額などで入れてください。介護保険の1割負担の前の額が分かれば、詳細の「介護保険の対象の費用」に分けて入れます" }),
      yenBox({ key: `${k}/service`, item: "care.serviceMonthly", label: "介護保険の対象の費用（月額・1割負担の前の10割）", level: "detail", basis: "monthly", find, path: ["serviceMonthly"], optional: true, help: "入れると、所得に応じた自己負担の割合（1〜3割）と高額介護サービス費の上限を当てます。空欄は上の月々の費用だけで計算します" }),
      yenBox({ key: `${k}/initial`, item: "care.initial", label: "一時費用（住宅の改修・入居金など）", level: "detail", basis: "once", find, path: ["initial"], optional: true, help: "空欄は統計の目安（一時費用の平均）で計算します" }),
      plain({ key: `${k}/payer`, item: "care.payer", label: "払う人", level: "detail", kind: "select", options: [{ value: "", label: "介護を受ける人" }, ...memberOptions(wh)], find, path: ["payer"], optional: true, fallback: "", help: "介護を受ける人が世帯の外の家族で、その人のお金を見ているときは、まずその人のお金から払い、尽きた月からここで選んだ人が払います" }),
      ...growthFields(k, "care.growth", find, c.id, c.growth),
      ...onContingencyFields({ key: `${k}/on`, item: "care.onContingency", find, path: ["onContingency"], level: "detail", help: "払う人の万一（死亡など）が起きた月の翌月から当てます" }).map((x) => ({ ...x, address: () => ({ target: { object: c.id }, item: "care.onContingency", at: [] }) })),
      ...onContingencyDetailFields({ key: `${k}/on`, item: "care.onContingency", find, path: ["onContingency"], on: c.onContingency, level: "detail" }).map((x) => ({ ...x, address: () => ({ target: { object: c.id }, item: "care.onContingency", at: [] }) })),
    ],
    actions: [removeAction(`${k}/remove`, "外す", "simple", (h) => void (h.careExpenses = (h.careExpenses ?? []).filter((x) => x.id !== c.id)))],
  };
}

/**
 * 周期的な支出のうち、子の年齢で始まる物の子（その物は子ども・教育のカードの、その子の所に出す。留学など）。無ければ null
 */
export function childOfPeriodic(h: Household, p: PeriodicExpense): string | null {
  // ほかのカードに属する種類のお金の行（仕送り・贈与など）は、その種類のカードのまま
  if (expenseCard(h, p) !== "events") return null;
  const id = p.from.memberAge?.member;
  return id !== undefined && h.members.some((m) => m.id === id && m.kind === "child") ? id : null;
}

/** ライフイベントのカードに出す出るお金の行（種類がライフイベントの行。子の年齢で始まる行は除く） */
export const eventExpenses = (h: Household): PeriodicExpense[] => (h.periodicExpenses ?? []).filter((p) => expenseCard(h, p) === "events" && childOfPeriodic(h, p) === null);

/** ピンにした物も、属するカードに出す（ピンは見せ方だけ。0045） */
export const NONE_CLAIMED: ReadonlySet<string> = new Set();

export function eventsStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const cares = h.careExpenses ?? [];
  // 介護の費用は介護・親のカードで入れる（ここは読むだけの1行）
  const careLine = readGroup("ev/care", undefined, cares.length > 0 ? [readLine("ev/care", "介護の費用", `${cares.length}件（${[...new Set(cares.map((c) => memberLabel(wh, c.member)))].join("・")}）`, "介護・親")] : []);
  const sections: SectionDef[] = [
    {
      key: "ev/periodic",
      title: "一時的支出・n年ごとの支出",
      note: "旅行・家電の買い替え・リフォーム・結婚の援助など。毎月の基本生活費とは別に入れます",
      level: "simple",
      groups: [...eventExpenses(h).flatMap((p) => periodicGroups(wh, p)), ...(careLine !== null ? [careLine] : [])],
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
    ...moneySections(wh, "events", { claimed: NONE_CLAIMED, level: "simple", inTitle: "入るお金（祝い金・一時の入金など）" }).filter((x) => x.key.endsWith("/in")),
  ];
  return { id: "events", label: "ライフイベント", lead: "一時的な収支（旅行・買い替え・援助など）。", sections };
}
