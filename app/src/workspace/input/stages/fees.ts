// FP顧問料（入力の項目「前提条件」の中の欄のまとまり「FP顧問料（単発・継続）」）: 契約ごとに、単発（相談料・プラン作成料の額と年月）・継続（月額か年額・始まりと終わり）・
// 料金の段階（その月からの額。0070）・万一のときの扱い。エンジンの advisoryFees（0008 の追記）をそのまま読み書きする。
// 既定では提案の側にだけ入れる（契約は enabled: false で現状に入れ、見通しの対策「FP顧問料」で提案の側を ON にする）。
// 標準の欄は単発の料金・継続の顧問料の額・終わり（と現状にも入れるか）だけ。払う人（本人）・払い方・始まり（単発の料金の12か月後）・料金の段階・
// 万一のときの扱いは、契約を足すときに事務所の料金表（office/current.ts の FeeTable。0073 の追記）から写し、詳細で直す。
// 値上げの率は入れる欄を出さない（以前に入れた率は計算に使い続け、詳細で見る・外す。顧客の画面には率を出さない）。
// 顧客に見せる画面にも出してよい項目だが、事務所の内部の情報（料金表の写しの印など）は画面に出さない
import type { AdvisoryFee, Household, Timepoint } from "../../../engine/types.ts";
import { addMonths } from "../../levers.ts";
import { officeNow, type FeeTable } from "../../office/current.ts";
import { resolveTimepoint } from "../../timepoint.ts";
import { byId, field, getPath, plain, timepointField, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, type WorkingHousehold } from "../household.ts";
import { memberLabel, memberOptions } from "../labels.ts";
import { monthsBetween } from "../loanMath.ts";
import { onContingencyDetailFields, onContingencyFields } from "./onContingency.ts";
import { GROWTH_RANGE } from "../rateRanges.ts";

const fees = (h: Household) => h.advisoryFees;

type Recurring = NonNullable<NonNullable<AdvisoryFee["terms"]>["recurring"]>;

/** 単発の料金の欄（額と年月） */
function oneTimeFields(k: string, find: Finder, i: number): FieldDef[] {
  const findOne: Finder = (h, w) => (getPath(find(h, w), ["terms", "oneTime", String(i)]) as Record<string, unknown> | undefined) ?? undefined;
  return [
    plain({ key: `${k}/one/${i}/amount`, item: "advisoryFee.terms", label: `単発の料金 ${i + 1}（税込み）`, help: "相談料・プラン作成料など、1回の料金", level: "simple", kind: "yen", basis: "once", find: findOne, path: ["amount"] }),
    timepointField({ key: `${k}/one/${i}/at`, item: "advisoryFee.terms", label: "払う年月", level: "detail", find: findOne, path: ["at"] }),
  ];
}

export function feeGroups(wh: WorkingHousehold, c: AdvisoryFee, n: number): GroupDef[] {
  const find = byId(fees, c.id);
  const k = `ev/fee/${c.id}`;
  const fee = (h: Household, w: WorkingHousehold) => find(h, w) as AdvisoryFee | undefined;
  const r = c.terms?.recurring;
  // 払う人は本人（本人の支出として計算する）。本人のほかの人が払う契約（以前に入れた物）だけ、詳細に払う人の欄を出す
  const self = wh.request.input.household.members.find((m) => m.kind === "self");
  const byOther = self === undefined || c.payer !== self.id;
  const main: FieldDef[] = [
    ...(byOther ? [plain({ key: `${k}/payer`, item: "advisoryFee.payer", label: "払う人", level: "detail", kind: "select", options: memberOptions(wh), find, path: ["payer"], help: "顧問料はご本人の支出として計算するのが標準です" })] : []),
    plain({
      key: `${k}/inCurrent`,
      item: "advisoryFee.enabled",
      label: "現状にも入れる",
      level: "simple",
      kind: "bool",
      find,
      path: ["enabled"],
      optional: true,
      fallback: true,
      help: "すでに契約しているときに入れます。まだのときは入れなくて構いません（結果の画面で、入れた場合と比べられます）",
    }),
    ...(c.terms?.oneTime ?? []).flatMap((_, i) => oneTimeFields(k, find, i)),
  ];
  const groups: GroupDef[] = [
    {
      key: k,
      title: `FP顧問料 ${n + 1}${byOther ? `（${memberLabel(wh, c.payer)}が払う）` : ""}`,
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
              const one = officeNow().fee.oneTime;
              ((x.terms ??= {}).oneTime ??= []).push({ at: { at: addMonths(w.request.input.baseMonth, 1) }, amount: one > 0 ? one : 300000 });
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
          label: "＋ 継続の顧問料",
          level: "simple",
          run: (w) =>
            mutate(w, (h) => {
              const t = ((fee(h, w) as AdvisoryFee).terms ??= {});
              const firstOne = (t.oneTime ?? []).map((o) => resolveTimepoint(h, o.at)).find((x) => x !== null) ?? null;
              t.recurring = recurringFrom(officeNow().fee, firstOne !== null ? addMonths(firstOne, 12) : addMonths(w.request.input.baseMonth, 1), newId);
            }),
        },
      ],
    });
    return groups;
  }
  const monthly = r.monthly !== undefined;
  const hasRate = r.revision?.rate !== undefined;
  const recFields: FieldDef[] = [
    field({
      key: `${k}/rec/basis`,
      item: "advisoryFee.terms",
      label: "払い方",
      level: "detail",
      kind: "select",
      structural: true,
      options: [
        { value: "annual", label: "年額" },
        { value: "monthly", label: "月額" },
      ],
      help: "新しい契約は事務所の料金表の払い方で入ります",
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
    timepointField({
      key: `${k}/rec/from`,
      item: "advisoryFee.terms",
      label: "始まり",
      level: "detail",
      find: findRec,
      path: ["from"],
      help: "新しい契約は単発の料金の12か月後（翌年の同じ月）から。料金の段階も一緒にずらします",
      after: (h, target, _v, w) => shiftSteps(h, target, getPath(fee(w.request.input.household, w), ["terms", "recurring", "from"]) as Timepoint | undefined),
    }),
    timepointField({ key: `${k}/rec/to`, item: "advisoryFee.terms", label: "終わり", level: "simple", find: findRec, path: ["to"], startPath: ["from"], optional: true, absentWhenEmpty: true, nullText: "最後まで" }),
    ...(hasRate
      ? [
          plain({
            key: `${k}/rec/rate`,
            item: "advisoryFee.terms",
            label: "値上げの率（年）",
            level: "detail",
            kind: "pct",
            ...GROWTH_RANGE,
            find: findRec,
            path: ["revision", "rate"],
            optional: true,
            help: "以前に入れた値です。この率で毎年上げて計算しています（顧客の画面には率を出しません）。料金を変える予定は「料金の段階」で額として入れます。空にすると上げません",
          }),
        ]
      : []),
    ...onContingencyFields({ key: `${k}/rec/on`, item: "advisoryFee.terms", find: findRec, path: ["onContingency"], level: "detail", help: "払う人などの万一の月の翌月から、この扱いにします（単発の料金は変わりません）。新しい契約は事務所の料金表の扱い（標準は止める）で入ります" }),
    ...onContingencyDetailFields({ key: `${k}/rec/on`, item: "advisoryFee.terms", find: findRec, path: ["onContingency"], on: r.onContingency, level: "detail" }),
  ];
  groups.push({
    key: `${k}/rec`,
    title: "継続の顧問料",
    level: "simple",
    fields: recFields,
    actions: [
      {
        key: `${k}/addStep`,
        label: "＋ 料金の段階", help: "その月から変わる料金の額を入れます",
        level: "detail",
        run: (w) =>
          mutate(w, (h) => {
            const x = fee(h, w)?.terms?.recurring;
            if (x === undefined) return;
            const steps = ((x.revision ??= {}).steps ??= []);
            const lastAt = steps.at(-1)?.at ?? x.from;
            const at = resolveTimepoint(h, lastAt) ?? w.request.input.baseMonth;
            steps.push({ id: newId(), at: { at: addMonths(at, 12) }, ...(x.monthly !== undefined ? { monthly: x.monthly } : { annual: x.annual ?? 0 }) });
          }),
      },
      ...(hasRate
        ? [
            {
              key: `${k}/removeRate`,
              label: "値上げの率を外す", help: "外すと、料金を上げずに計算します",
              level: "detail" as const,
              run: (w: WorkingHousehold) =>
                mutate(w, (h) => {
                  const rev = fee(h, w)?.terms?.recurring?.revision;
                  if (rev === undefined) return;
                  delete rev.rate;
                  if (rev.steps === undefined) delete (fee(h, w)?.terms?.recurring as { revision?: unknown }).revision;
                }),
            },
          ]
        : []),
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
  // 料金の段階（その月からの年額・月額。0070。計算は今ある）
  (r.revision?.steps ?? []).forEach((st, i) => {
    const sid = typeof st.id === "string" ? st.id : String(i);
    const findStep: Finder = (h, w) => (((getPath(find(h, w), ["terms", "recurring", "revision", "steps"]) as Record<string, unknown>[] | undefined) ?? []).find((x, j) => (typeof x.id === "string" ? x.id === sid : String(j) === sid)) ?? undefined);
    groups.push({
      key: `${k}/rec/step/${sid}`,
      title: `料金の段階 ${i + 1}`,
      note: hasRate ? "この月から、継続の顧問料をこの額にします（値上げの率は、この額から伸ばします）" : "この月から、継続の顧問料をこの額にします",
      level: "detail",
      fields: [
        timepointField({ key: `${k}/rec/step/${sid}/at`, item: "advisoryFee.terms", label: "いつから", level: "detail", find: findStep, path: ["at"] }),
        monthly
          ? plain({ key: `${k}/rec/step/${sid}/monthly`, item: "advisoryFee.terms", label: "その月からの額（月額・税込）", level: "detail", kind: "yen", basis: "monthly", find: findStep, path: ["monthly"] })
          : plain({ key: `${k}/rec/step/${sid}/annual`, item: "advisoryFee.terms", label: "その月からの額（年額・税込）", level: "detail", kind: "yen", basis: "annual", find: findStep, path: ["annual"] }),
      ],
      actions: [
        {
          key: `${k}/rec/step/${sid}/remove`,
          label: "この段階を外す",
          level: "detail",
          danger: true,
          run: (w) =>
            mutate(w, (h) => {
              const rev = fee(h, w)?.terms?.recurring?.revision;
              if (rev?.steps === undefined) return;
              rev.steps = rev.steps.filter((x, j) => (typeof x.id === "string" ? x.id !== sid : String(j) !== sid));
              if (rev.steps.length === 0) delete rev.steps;
            }),
        },
      ],
    });
  });
  return groups;
}

/** 継続の顧問料を料金表から作る（始まりの月・1回の額・払い方・料金の段階〔○年目から〕・万一のときの扱い） */
export function recurringFrom(t: FeeTable, from: string, id: () => string = newId): Recurring {
  const amount = (a: number) => (t.per === "month" ? { monthly: a } : { annual: a });
  return {
    from: { at: from },
    ...amount(t.amount),
    ...(t.steps.length > 0 ? { revision: { steps: t.steps.map((st) => ({ id: id(), at: { at: addMonths(from, (st.year - 1) * 12) }, ...amount(st.amount) })) } } : {}),
    onContingency: { mode: t.onContingency },
  };
}

/** 継続の始まりを動かしたら、年月で入れた料金の段階も同じ月数だけずらす（「○年目から」の形を保つ） */
function shiftSteps(h: Household, rec: Record<string, unknown>, before: Timepoint | undefined): void {
  const steps = (rec.revision as { steps?: { at: { at?: string } }[] } | undefined)?.steps;
  if (steps === undefined || before === undefined) return;
  const a = resolveTimepoint(h, before);
  const b = resolveTimepoint(h, rec.from as Timepoint | undefined);
  if (a === null || b === null || a === b) return;
  const d = monthsBetween(a, b);
  for (const st of steps) if (typeof st.at.at === "string" && Object.keys(st.at).length === 1) st.at = { at: addMonths(st.at.at, d) };
}

/**
 * 新しい契約（提案の側だけ）。事務所の料金表（既定: 単発30万円・継続は月1万円）から写す。払う人は本人、
 * 継続の始まりは単発の料金の12か月後、万一のときは料金表の扱い（標準は止める）。後で料金表を変えても、足した契約は変わらない
 */
export function addAdvisoryFee(wh: WorkingHousehold, id: () => string = newId, table: FeeTable = officeNow().fee): WorkingHousehold {
  const h = wh.request.input.household;
  const payer = h.members.find((m) => m.kind === "self") ?? h.members[0];
  if (payer === undefined) return wh;
  const oneAt = addMonths(wh.request.input.baseMonth, 1);
  const contract = id();
  return mutate(wh, (hh) => {
    (hh.advisoryFees ??= []).push({
      id: contract,
      payer: payer.id,
      enabled: false,
      terms: {
        ...(table.oneTime > 0 ? { oneTime: [{ at: { at: oneAt }, amount: table.oneTime }] } : {}),
        recurring: recurringFrom(table, table.oneTime > 0 ? addMonths(oneAt, 12) : oneAt, id),
      },
    });
  });
}

/** 前提条件のパネルの中の「FP顧問料（単発・継続）」の欄のまとまり（契約ごと。欄のキーは以前のカード「FP顧問料」と同じ） */
export function feeSections(wh: WorkingHousehold): SectionDef[] {
  const list = wh.request.input.household.advisoryFees ?? [];
  return [
    {
      key: "ev/fees",
      title: "FP顧問料",
      note: "FP への相談料・顧問料です。生活費とは別に計算します。まだ契約していなければ、結果の画面で、顧問料を入れた場合と比べられます",
      level: "simple",
      groups: list.flatMap((c, i) => feeGroups(wh, c, i)),
      actions: [{ key: "ev/addFee", label: "＋ FP顧問料の契約", level: "simple", run: (w) => addAdvisoryFee(w) }],
    },
  ];
}

/** FP顧問料の欄だけの区画（入力のホームのカードにはしない。前提条件のパネルの中に入れる。stages/assumptions.ts） */
export function feeStage(wh: WorkingHousehold): StageDef {
  return { id: "fee", label: "FP顧問料", lead: "FP への相談料・顧問料（単発と継続）。", sections: feeSections(wh) };
}
