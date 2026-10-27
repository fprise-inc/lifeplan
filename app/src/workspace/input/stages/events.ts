// ライフイベントのカード（0068）: 一時的支出・n年ごとの支出（旅行・家電・結婚・大きな買い物・予備費）と、その他の一時的収入（祝い金・お見舞い・
// 一時の給付金・動産の売却・一時所得・その他の入金）。ほかのカードに置いた予定も含めた「この世帯の予定」を読むだけで並べる。
// 車（cars.ts）・FP顧問料（fees.ts）は別の項目。介護の費用は介護・親のカード（care.ts。careGroup はここに置いたまま使う）、子の年齢で始まる支出は
// 子ども・教育のカード、介護・親と相続・贈与のお金の行はそれぞれのカードに出す。FP が「＋ 項目を追加」で足した物もここに出る（ホームのピンは見せ方だけ。items.ts）
import type { CareExpense, Household, IncomeFlow, PeriodicExpense } from "../../../engine/types.ts";
import { addMonths } from "../../levers.ts";
import { resolveTimepoint } from "../../timepoint.ts";
import { livingEstimate } from "../estimates.ts";
import { byId, plain, removeAction, timepointField, yenBox, type ActionDef, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, standardBox, type WorkingHousehold } from "../household.ts";
import { CARE_PLACE, memberLabel, memberOptions } from "../labels.ts";
import { addExpense, addIncome, cadenceOf, expenseCard, growthFields, incomeCard, moneySections, periodicGroups } from "../moneyRows.ts";
import { manYen, readGroup, readLine } from "../readLines.ts";
import { overlapYears, scheduleItems, yearLabel } from "../schedule.ts";
import { onContingencyDetailFields, onContingencyFields } from "./onContingency.ts";

// 出るお金の行のまとまり（周期的な支出）は、どのカードでも同じ形（moneyRows.ts。0044）
export { periodicGroup, periodicGroups, periodicStageGroups } from "../moneyRows.ts";

const cares = (h: Household) => h.careExpenses;

/** もう始まっている介護か（始まりが計算の基準の月より前） */
export function careStarted(wh: WorkingHousehold, c: CareExpense): boolean {
  const from = resolveTimepoint(wh.request.input.household, c.from);
  return from !== null && from < wh.request.input.baseMonth;
}

/**
 * 介護の費用の欄。始まり・期間・月々の費用は詳細（空欄の期間と額は統計の目安。見出しの1行に出る）。
 * もう始まっている介護だけ、月々の費用を標準に出す（今かかっている額は顧客が答えられ、目安より確か）
 */
export function careGroup(wh: WorkingHousehold, c: CareExpense): GroupDef {
  const find = byId(cares, c.id);
  const k = `ev/care/${c.id}`;
  const started = careStarted(wh, c);
  return {
    key: k,
    title: `介護の費用（${memberLabel(wh, c.member)}）`,
    note: "空欄の額は統計の目安（生命保険文化センターの調査など）で計算します",
    level: "simple",
    fields: [
      plain({ key: `${k}/member`, item: "care.member", label: "介護を受ける人", level: "simple", kind: "select", options: memberOptions(wh), find, path: ["member"] }),
      timepointField({ key: `${k}/from`, item: "care.from", label: "始まり", level: "detail", find, path: ["from"], ageOf: (h) => h.members.find((m) => m.id === (h.careExpenses ?? []).find((x) => x.id === c.id)?.member), anchor: "careStart" }),
      plain({ key: `${k}/months`, item: "care.months", label: "期間", level: "detail", kind: "int", suffix: "か月", min: 1, max: 600, find, path: ["months"], optional: true }),
      plain({ key: `${k}/place`, item: "care.place", label: "在宅か施設か", level: "simple", kind: "select", options: CARE_PLACE, find, path: ["place"], optional: true, fallback: "home" }),
      yenBox({ key: `${k}/other`, item: "care.otherMonthly", label: "月々の費用（自己負担の合計）", level: started ? "simple" : "detail", basis: "monthly", find, path: ["otherMonthly"], optional: true, help: "空欄は統計の目安（在宅・施設の平均の月額）で計算します。施設の請求書の額などで入れてください。介護保険の1割負担の前の額が分かれば、詳細の「介護保険の対象の費用」に分けて入れます" }),
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

// ---- ひな形（0068。額・時期は推定〔目安のボタンの値〕。入るお金の額は未入力の警告） ----

/** 出るお金のひな形: 名前・額（1回の額）・何年ごと（1回は null）・表の行 */
export interface EventTemplate {
  key: string;
  label: string;
  amount: number | null;
  everyYears: number | null;
  row: string;
}

export const OUT_TEMPLATES: readonly EventTemplate[] = [
  { key: "travel", label: "家族旅行", amount: 300000, everyYears: 1, row: "cf.expense.lumpSum.other" },
  { key: "appliances", label: "家電の買い替え", amount: 250000, everyYears: 8, row: "cf.expense.lumpSum.other" },
  { key: "wedding", label: "結婚の費用", amount: null, everyYears: null, row: "cf.expense.lumpSum.wedding" },
  { key: "purchase", label: "リフォーム以外の大きな買い物", amount: 500000, everyYears: null, row: "cf.expense.lumpSum.other" },
];

const templateText = (t: EventTemplate) => (t.amount === null ? `${t.label}（額は入れてください）` : `${t.label}（${t.everyYears === null ? "1回" : t.everyYears === 1 ? "毎年" : `${t.everyYears}年ごとに`}${manYen(t.amount)}）`);
const UNENTERED = "未入力（額を入れてください。0円で計算中）";

/** ひな形の出るお金の行を足す（時期は1年後。額は目安のボタンの値＝推定。額の無いひな形は未入力の警告） */
export function addEventTemplate(wh: WorkingHousehold, t: EventTemplate, id: string = newId()): WorkingHousehold {
  const w = addExpense(wh, "general", id);
  return mutate(w, (h) => {
    const p = (h.periodicExpenses ?? []).find((x) => x.id === id);
    if (p === undefined) return;
    p.label = t.label;
    p.row = t.row;
    p.everyYears = t.everyYears ?? 1;
    if (t.everyYears !== null) p.to = null;
    p.amount = (t.amount === null ? standardBox(0, UNENTERED) : standardBox(t.amount, `ひな形の目安（${templateText(t)}。この世帯に合わせて直してください）`)) as PeriodicExpense["amount"];
  });
}

/** 予備費の月額の元: 今の基本生活費の月額（総額か費目の合計）。生活費が無ければ人数の目安 */
export function livingMonthlyNow(wh: WorkingHousehold): number {
  const h = wh.request.input.household;
  const l = (h.livingExpenses ?? [])[0];
  const v = l === undefined ? null : l.mode === "total" ? (l.monthly?.value ?? null) : (l.categories ?? []).reduce((s, c) => s + (c.monthly.value ?? 0), 0);
  return v !== null && v > 0 ? v : livingEstimate(h, wh.request.input.baseMonth).value;
}

/** 予備費を足す: 毎年、足したときの生活費の1か月分（写す。生活費の割合として持ち続けない） */
export function addReserve(wh: WorkingHousehold, id: string = newId()): WorkingHousehold {
  const monthly = Math.round(livingMonthlyNow(wh) / 10000) * 10000;
  const w = addExpense(wh, "general", id);
  return mutate(w, (h) => {
    const p = (h.periodicExpenses ?? []).find((x) => x.id === id);
    if (p === undefined) return;
    p.label = "予備費";
    p.everyYears = 1;
    p.to = null;
    p.amount = standardBox(monthly, `ひな形の目安（生活費の1か月分〔月${manYen(monthly)}〕を毎年。この世帯に合わせて直してください）`) as PeriodicExpense["amount"];
  });
}

/** 入るお金のひな形（祝い金・一時の給付金。額は未入力の警告） */
export const IN_TEMPLATES: readonly { key: string; label: string }[] = [
  { key: "weddingGift", label: "結婚のお祝い" },
  { key: "birthGift", label: "出産のお祝い" },
  { key: "benefit", label: "一時の給付金" },
];

export function addIncomeTemplate(wh: WorkingHousehold, label: string, id: string = newId()): WorkingHousehold {
  const w = addIncome(wh, "celebration", id);
  return mutate(w, (h) => {
    const f = (h.incomeFlows ?? []).find((x) => x.id === id);
    if (f !== undefined) f.label = label;
  });
}

// ---- 入る⇄出るの付け替え・基本生活費へ移す（0068） ----

/** 出るお金の行を入るお金の行にする（同じ名前・額・時期。種類は「その他の入金」。行を外して足す） */
export function expenseToIncome(wh: WorkingHousehold, id: string, newRowId: string = newId()): WorkingHousehold {
  return mutate(wh, (h) => {
    const p = (h.periodicExpenses ?? []).find((x) => x.id === id);
    if (p === undefined) return;
    const f: IncomeFlow = {
      id: newRowId,
      ...(p.label !== undefined ? { label: p.label } : {}),
      kind: "other",
      from: structuredClone(p.from),
      to: p.to === undefined ? null : structuredClone(p.to),
      everyYears: p.everyYears,
      ...(p.monthly === true ? { monthly: true } : {}),
      amount: structuredClone(p.amount),
      ...(p.growth !== undefined ? { growth: structuredClone(p.growth) } : {}),
    };
    h.periodicExpenses = (h.periodicExpenses ?? []).filter((x) => x.id !== id);
    (h.incomeFlows ??= []).push(f);
  });
}

/** 入るお金の行を出るお金の行にする（同じ名前・額・時期。種類は「一時的支出・n年ごとの支出」） */
export function incomeToExpense(wh: WorkingHousehold, id: string, newRowId: string = newId()): WorkingHousehold {
  return mutate(wh, (h) => {
    const f = (h.incomeFlows ?? []).find((x) => x.id === id);
    if (f === undefined) return;
    const once = cadenceOf(h, f) === "once";
    const p: PeriodicExpense = {
      id: newRowId,
      ...(f.label !== undefined ? { label: f.label } : {}),
      kind: "general",
      row: once ? "cf.expense.lumpSum.other" : "cf.expense.other",
      from: structuredClone(f.from),
      to: f.to === undefined ? null : structuredClone(f.to),
      everyYears: f.everyYears,
      ...(f.monthly === true ? { monthly: true } : {}),
      amount: structuredClone(f.amount),
      ...(f.growth !== undefined ? { growth: structuredClone(f.growth) } : {}),
    };
    h.incomeFlows = (h.incomeFlows ?? []).filter((x) => x.id !== id);
    (h.periodicExpenses ??= []).push(p);
  });
}

/** 古い世帯の周期的な支出（年払いの暮らしの支出に当たる物）を、基本生活費のカードの行にする（種類だけを変える。表の行・額はそのまま） */
export function moveToLiving(wh: WorkingHousehold, id: string): WorkingHousehold {
  return mutate(wh, (h) => {
    const p = (h.periodicExpenses ?? []).find((x) => x.id === id);
    if (p !== undefined) p.kind = "livingAnnual";
  });
}

/** 出るお金の行のまとまり（1行目に付け替えのボタンを足す） */
function eventRowGroups(wh: WorkingHousehold, p: PeriodicExpense): GroupDef[] {
  const h = wh.request.input.household;
  const [head, ...rest] = periodicGroups(wh, p);
  if (head === undefined) return rest;
  const more: ActionDef[] = [{ key: `ev/${p.id}/toIncome`, label: "入るお金にする", level: "detail", run: (w) => expenseToIncome(w, p.id) }];
  if (cadenceOf(h, p) !== "once") more.push({ key: `ev/${p.id}/toLiving`, label: "基本生活費のカードへ移す（年払いの暮らしの支出）", level: "detail", run: (w) => moveToLiving(w, p.id) });
  return [{ ...head, actions: [...more, ...head.actions] }, ...rest];
}

/** この世帯の予定（ほかのカードを含む。読むだけ） */
function scheduleSection(wh: WorkingHousehold): SectionDef {
  const items = scheduleItems(wh);
  const lines = items.map((x, i) => readLine(`events/schedule/${i}`, yearLabel(wh, x.year), `${x.dir === "—" ? "" : `${x.dir}｜`}${x.name}${x.amount !== "" ? `（${x.amount}）` : ""}`, x.card));
  const overlap = overlapYears(items);
  const note = [
    "ほかのカードに入れた予定も含めて、年の順に並べます（額は今の値段。くり返しは最初の年）。直すときは、それぞれのカードで",
    ...(overlap.length > 0 ? [`1回の出るお金が重なる年: ${overlap.map((o) => `${o.year}年（${o.names.join("・")}）`).join("、")}`] : []),
  ].join("。");
  const g = readGroup("events/schedule", undefined, lines, note);
  return { key: "events/schedule", title: "この世帯の予定（ほかのカードを含む）", ...(g === null ? { note: "まだ予定がありません" } : {}), level: "detail", groups: g === null ? [] : [g], actions: [] };
}

export function eventsStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const rows = eventExpenses(h);
  const empty = rows.length === 0;
  const tmplLevel = empty ? ("simple" as const) : ("detail" as const);
  const has = (label: string) => rows.some((p) => p.label === label);
  const templates: ActionDef[] = [
    ...OUT_TEMPLATES.filter((t) => !has(t.label)).map((t): ActionDef => ({ key: `ev/template/${t.key}`, label: `＋ ${templateText(t)}`, level: tmplLevel, run: (w) => addEventTemplate(w, t) })),
    ...(has("予備費") ? [] : [{ key: "ev/template/reserve", label: `＋ 予備費（毎年、生活費の1か月分 ${manYen(Math.round(livingMonthlyNow(wh) / 10000) * 10000)}）`, level: tmplLevel, run: (w: WorkingHousehold) => addReserve(w) }]),
  ];
  const outSection: SectionDef = {
    key: "ev/periodic",
    title: "出るお金（一時的支出・n年ごと）",
    note: `${empty ? "まだありません。" : ""}旅行・家電の買い替え・結婚・大きな買い物・予備費など。毎月の基本生活費とは別に入れます。行の右の札（必要・希望・夢）で、結果の「確実な分だけで見る」から外す物を決められます`,
    level: "simple",
    groups: rows.flatMap((p) => eventRowGroups(wh, p)),
    actions: [
      ...templates,
      {
        key: "ev/addOnce",
        label: "＋ 一時的支出（1回）",
        level: "simple",
        run: (w) => addExpense(w, "general"),
      },
      {
        key: "ev/addEvery",
        label: "＋ n年ごとの支出",
        level: "simple",
        run: (w) => {
          const id = newId();
          return mutate(addExpense(w, "general", id), (hh) => {
            const p = (hh.periodicExpenses ?? []).find((x) => x.id === id);
            if (p === undefined) return;
            p.label = "n年ごとの支出";
            p.to = null;
            p.everyYears = 5;
            p.from = { at: addMonths(base, 12) };
          });
        },
      },
      { key: "ev/addOther", label: "＋ その他の支出", level: "detail", run: (w) => addExpense(w, "other") },
    ],
  };
  // 入るお金（祝い金・一時所得・動産の売却・その他の入金。0044）。行に「出るお金にする」
  const inSec = moneySections(wh, "events", { claimed: NONE_CLAIMED, level: "simple", inTitle: "入るお金（その他の一時的収入）" }).find((x) => x.key.endsWith("/in"));
  const inRows = (h.incomeFlows ?? []).filter((f) => incomeCard(f) === "events");
  const inSection: SectionDef | null =
    inSec === undefined
      ? null
      : {
          ...inSec,
          note: `${inRows.length === 0 ? "まだありません。" : ""}祝い金・お見舞い・一時の給付金・動産の売却（車以外）・一時所得・その他の入金。額は入れるまで「未入力（0円で計算中）」です。相続・贈与は相続・贈与、援助・仕送りは介護・親、養育費・手当は家族、副業・売却代金（事業）は働き方と収入のカードで入れます`,
          groups: inSec.groups.map((g) => {
            const m = /^in\/([^/]+)$/.exec(g.key);
            const id = m?.[1];
            return id === undefined ? g : { ...g, actions: [{ key: `in/${id}/toExpense`, label: "出るお金にする", level: "detail" as const, run: (w: WorkingHousehold) => incomeToExpense(w, id) }, ...g.actions] };
          }),
          actions: [...(inRows.length === 0 ? IN_TEMPLATES.map((t): ActionDef => ({ key: `in/template/${t.key}`, label: `＋ ${t.label}（額は入れてください）`, level: "simple", run: (w) => addIncomeTemplate(w, t.label) })) : []), ...inSec.actions],
        };
  const sections: SectionDef[] = [outSection, ...(inSection !== null ? [inSection] : []), scheduleSection(wh)];
  return { id: "events", label: "ライフイベント", lead: "一時的な収支（旅行・買い替え・結婚・祝い金など）と、世帯の予定の一覧。", sections };
}
