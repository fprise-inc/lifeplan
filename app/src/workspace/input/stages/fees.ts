// FP顧問料（入力の項目「FP顧問料」）: 契約ごとに、払う人・単発（相談料・プラン作成料の額と年月）・継続（月額か年額・始まりと終わり・値上げの率）・
// 万一のときの扱い。エンジンの advisoryFees（0008 の追記）をそのまま読み書きする。
// 既定では提案の側にだけ入れる（契約は enabled: false で現状に入れ、見通しの対策「FP顧問料」で提案の側を ON にする）。
// 顧客に見せる画面にも出してよい項目だが、事務所の内部の情報（料金表の写しの印など）は画面に出さない
import type { AdvisoryFee, Household } from "../../../engine/types.ts";
import { addMonths } from "../../levers.ts";
import { byId, field, getPath, plain, timepointField, type FieldDef, type Finder, type GroupDef, type StageDef } from "../form.ts";
import { mutate, newId, type WorkingHousehold } from "../household.ts";
import { memberLabel, memberOptions } from "../labels.ts";
import { onContingencyDetailFields, onContingencyFields } from "./onContingency.ts";

const fees = (h: Household) => h.advisoryFees;

/** 単発の料金の欄（額と年月） */
function oneTimeFields(k: string, find: Finder, i: number): FieldDef[] {
  const findOne: Finder = (h, w) => (getPath(find(h, w), ["terms", "oneTime", String(i)]) as Record<string, unknown> | undefined) ?? undefined;
  return [
    plain({ key: `${k}/one/${i}/amount`, item: "advisoryFee.terms", label: `単発の料金 ${i + 1}（相談料・プラン作成料。税込）`, level: "simple", kind: "yen", basis: "once", find: findOne, path: ["amount"] }),
    timepointField({ key: `${k}/one/${i}/at`, item: "advisoryFee.terms", label: "払う年月", level: "simple", find: findOne, path: ["at"] }),
  ];
}

export function feeGroups(wh: WorkingHousehold, c: AdvisoryFee, n: number): GroupDef[] {
  const find = byId(fees, c.id);
  const k = `ev/fee/${c.id}`;
  const fee = (h: Household, w: WorkingHousehold) => find(h, w) as AdvisoryFee | undefined;
  const r = c.terms?.recurring;
  const main: FieldDef[] = [
    plain({ key: `${k}/payer`, item: "advisoryFee.payer", label: "払う人", level: "simple", kind: "select", options: memberOptions(wh), find, path: ["payer"] }),
    plain({
      key: `${k}/inCurrent`,
      item: "advisoryFee.enabled",
      label: "現状にも入れる（すでに契約している）",
      level: "simple",
      kind: "bool",
      find,
      path: ["enabled"],
      optional: true,
      fallback: true,
      help: "入れないときは、見通しの対策「FP顧問料」で提案の側にだけ入れます（既定）",
    }),
    ...(c.terms?.oneTime ?? []).flatMap((_, i) => oneTimeFields(k, find, i)),
  ];
  const groups: GroupDef[] = [
    {
      key: k,
      title: `FP顧問料 ${n + 1}（${memberLabel(wh, c.payer)}が払う）`,
      note: "金額は税込。個人が払う顧問料は所得から差し引かずに計算します",
      level: "simple",
      fields: main,
      actions: [
        {
          key: `${k}/addOne`,
          label: "＋ 単発の料金",
          level: "simple",
          run: (w) =>
            mutate(w, (h) => {
              const x = fee(h, w);
              if (x === undefined) return;
              ((x.terms ??= {}).oneTime ??= []).push({ at: { at: addMonths(w.request.input.baseMonth, 1) }, amount: 300000 });
            }),
        },
        ...(c.terms?.oneTime ?? []).map((_, i) => ({
          key: `${k}/removeOne/${i}`,
          label: `単発の料金 ${i + 1} を外す`,
          level: "simple" as const,
          danger: true,
          run: (w: WorkingHousehold) =>
            mutate(w, (h) => {
              const t = (fee(h, w) as AdvisoryFee).terms as NonNullable<AdvisoryFee["terms"]>;
              t.oneTime = (t.oneTime ?? []).filter((_x, j) => j !== i);
              if (t.oneTime.length === 0) delete t.oneTime;
            }),
        })),
        {
          key: `${k}/remove`,
          label: "この契約を外す",
          level: "simple",
          danger: true,
          run: (w) =>
            mutate(w, (h) => {
              h.advisoryFees = (h.advisoryFees ?? []).filter((x) => x.id !== c.id);
              if (h.advisoryFees.length === 0) delete h.advisoryFees;
            }),
        },
      ],
    },
  ];
  // 継続
  const findRec: Finder = (h, w) => (getPath(find(h, w), ["terms", "recurring"]) as Record<string, unknown> | undefined) ?? undefined;
  if (r === undefined) {
    groups.push({
      key: `${k}/rec/none`,
      level: "simple",
      fields: [],
      actions: [
        {
          key: `${k}/addRec`,
          label: "＋ 継続の顧問料（年額・月額）",
          level: "simple",
          run: (w) => mutate(w, (h) => void (((fee(h, w) as AdvisoryFee).terms ??= {}).recurring = { from: { at: addMonths(w.request.input.baseMonth, 3) }, annual: 120000 })),
        },
      ],
    });
    return groups;
  }
  const monthly = r.monthly !== undefined;
  const recFields: FieldDef[] = [
    field({
      key: `${k}/rec/basis`,
      item: "advisoryFee.terms",
      label: "払い方",
      level: "simple",
      kind: "select",
      structural: true,
      options: [
        { value: "annual", label: "年額（毎年、始まりの月に）" },
        { value: "monthly", label: "月額（毎月）" },
      ],
      get: (w) => ({ value: (getPath(fee(w.request.input.household, w), ["terms", "recurring", "monthly"]) as number | undefined) !== undefined ? "monthly" : "annual" }),
      set: (w, v) =>
        mutate(w, (h) => {
          const x = fee(h, w)?.terms?.recurring;
          if (x === undefined) return;
          if (v === "monthly" && x.monthly === undefined) {
            x.monthly = Math.round((x.annual ?? 0) / 12);
            delete x.annual;
          } else if (v === "annual" && x.annual === undefined) {
            x.annual = (x.monthly ?? 0) * 12;
            delete x.monthly;
          }
        }),
    }),
    monthly
      ? plain({ key: `${k}/rec/monthly`, item: "advisoryFee.terms", label: "継続の顧問料（月額・税込）", level: "simple", kind: "yen", basis: "monthly", find: findRec, path: ["monthly"] })
      : plain({ key: `${k}/rec/annual`, item: "advisoryFee.terms", label: "継続の顧問料（年額・税込）", level: "simple", kind: "yen", basis: "annual", find: findRec, path: ["annual"] }),
    timepointField({ key: `${k}/rec/from`, item: "advisoryFee.terms", label: "始まり", level: "simple", find: findRec, path: ["from"] }),
    timepointField({ key: `${k}/rec/to`, item: "advisoryFee.terms", label: "終わり", level: "simple", find: findRec, path: ["to"], optional: true, absentWhenEmpty: true, nullText: "最後まで" }),
    plain({ key: `${k}/rec/rate`, item: "advisoryFee.terms", label: "値上げの率（年）", level: "simple", kind: "pct", find: findRec, path: ["revision", "rate"], optional: true, help: "毎年、始まりの月からこの率で上げます（空欄は上げない）" }),
    ...onContingencyFields({ key: `${k}/rec/on`, item: "advisoryFee.terms", find: findRec, path: ["onContingency"], help: "払う人などの万一の月の翌月から当てます（単発の料金には当てません）" }),
    ...onContingencyDetailFields({ key: `${k}/rec/on`, item: "advisoryFee.terms", find: findRec, path: ["onContingency"], on: r.onContingency }),
  ];
  const steps = r.revision?.steps?.length ?? 0;
  groups.push({
    key: `${k}/rec`,
    title: "継続の顧問料",
    ...(steps > 0 ? { note: `料金の段階が ${steps} 件入っています（段階の入力の欄は次の版です。計算には入っています）` } : {}),
    level: "simple",
    fields: recFields,
    actions: [
      {
        key: `${k}/removeRec`,
        label: "継続の顧問料を外す",
        level: "simple",
        danger: true,
        run: (w) =>
          mutate(w, (h) => {
            const t = fee(h, w)?.terms;
            if (t !== undefined) delete t.recurring;
          }),
      },
    ],
  });
  return groups;
}

/** 新しい契約（提案の側だけ。例: 初回のプラン作成料と年額の顧問料） */
export function addAdvisoryFee(wh: WorkingHousehold, id: () => string = newId): WorkingHousehold {
  const h = wh.request.input.household;
  const payer = h.members.find((m) => m.kind === "self") ?? h.members[0];
  if (payer === undefined) return wh;
  const base = wh.request.input.baseMonth;
  return mutate(wh, (hh) => {
    (hh.advisoryFees ??= []).push({
      id: id(),
      payer: payer.id,
      enabled: false,
      terms: { oneTime: [{ at: { at: addMonths(base, 1) }, amount: 300000 }], recurring: { from: { at: addMonths(base, 3) }, annual: 120000, onContingency: { mode: "stop" } } },
    });
  });
}

export function feeStage(wh: WorkingHousehold): StageDef {
  const claimed = new Set(wh.addedItems.map((a) => a.ref));
  const list = (wh.request.input.household.advisoryFees ?? []).filter((c) => !claimed.has(c.id));
  return {
    id: "fee",
    label: "FP顧問料",
    lead: "FP への相談料・顧問料（単発と継続）。",
    sections: [
      {
        key: "ev/fees",
        title: "FP顧問料",
        note: "生活費とは別の行で計算します。既定では提案の側にだけ入れ、見通しの対策「FP顧問料」で入れる・入れないを切り替えます",
        level: "simple",
        groups: list.flatMap((c, i) => feeGroups(wh, c, i)),
        actions: [{ key: "ev/addFee", label: "＋ FP顧問料の契約", level: "simple", run: (w) => addAdvisoryFee(w) }],
      },
    ],
  };
}
