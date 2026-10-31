// 住まい・ローンのカードのローンの欄（0052）: 住宅ローン（入れ方の区分「借入額から・毎月の返済額から・今の残高から」と逆算、借りる人、
// 金利・返済・団信、住宅ローン控除の条件）と、ほかのローン（カードローン・リボ・奨学金・リフォームローンなど。簡易は今の残高と毎月の返済額）。
// - 入れ方の区分は画面の側（WorkingHousehold.loanEntry）。データは同じ物で、区分を変えても値は消えない
// - 逆算した値・目安のボタンの値は推定（値の状態の行。根拠の文に値を入れて、値を変えて書き直した行が古い行として外れないようにする）
// - 逆算は最初の金利の段だけで解く（loanMath.ts）。金利の段階・繰上返済・借り換えは計算エンジンが返済の計算で見る
import type { Debt, DebtHousing, EngineRequest, Household } from "../../../engine/types.ts";
import { addMonths } from "../../levers.ts";
import type { Address } from "../../store/readings.ts";
import { byId, field, getPath, plain, resolveTimepoint, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef } from "../form.ts";
import { mutate, newId, presetBasis, standardBox, type LoanEntry, type WorkingHousehold } from "../household.ts";
import { CREDIT_DATA_FROM_YEAR, creditKey, estimatedPrincipal, fromBalance, isHomeLoan, PRINCIPAL_ESTIMATE, principalKey, principalMismatch, purchaseMonth, withoutCreditMark } from "../housingCredit.ts";
import { DEBT_KINDS, memberLabel, memberOptions, RATE_TYPES, REPAYMENT_METHODS } from "../labels.ts";
import { fittedRateText, monthlyPayment, monthsBetween, monthsFromPayment, principalFromPayment, rateText } from "../loanMath.ts";
import { putRow, rowAt, type StateRow } from "../rows.ts";
import { formatYearMonth, formatYen } from "../units.ts";
import { readYearMonth } from "../when.ts";
import { mortgageRateEstimate, RATE_ESTIMATE_HEADS, type MortgageRateType } from "../../../../../hearing/src/housingEstimates.ts";
import { scholarshipRateEstimate } from "../../../../../hearing/src/loanRates.ts";

type Obj = Record<string, unknown>;
const debts = (h: Household) => h.debts;

// ---- 当て先と値の状態の行 ----

export const at = (object: string, item: string, path: string[] = []): Address => ({ target: { object }, item, at: path });
export const estRow = (method: string, basis: string): StateRow => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method, basis } });
const withAddress = (f: FieldDef, a: (wh: WorkingHousehold) => Address | null): FieldDef => ({ ...f, address: a });
const inputOf = (req: EngineRequest): Obj => req.input as unknown as Obj;
const pct = (rate: number | string): string => `${(Math.round(Number(rate) * 100000) / 1000).toLocaleString("ja-JP", { maximumFractionDigits: 3 })}%`;
const man = (v: number): string => `${formatYen(Math.round(v / 10000) * 10000, "man")}万円`;

/** 最初の金利の段の ID（無ければ振る。値の状態の行の鍵に使う） */
function rateId(d: Debt): string {
  const s = d.rateSchedule[0];
  if (s === undefined) return "0";
  s.id ??= newId();
  return s.id;
}
const addrPrincipal = (id: string) => at(id, "debt.principal");
const addrStart = (id: string) => at(id, "debt.start");
const addrTerm = (id: string) => at(id, "debt.repayment", ["termMonths"]);
const addrRate = (d: Debt): Address | null => (d.rateSchedule[0]?.id === undefined ? null : at(d.id, "debt.rateSchedule", [d.rateSchedule[0].id, "rate"]));

/** 当て先の行（読むだけ） */
const rowOf = (wh: WorkingHousehold, a: Address | null): StateRow | undefined => (a === null ? undefined : rowAt(wh.request.input as unknown as Obj, a));
/** 逆算・目安で置いた推定（出どころ auto の推定）の行か。basis の頭で見分ける */
const isEstimate = (r: StateRow | undefined, head?: string): boolean => r?.state === "estimated" && r.origin.kind === "auto" && (head === undefined || (r.estimate?.basis ?? "").startsWith(head));

export const SOLVED = "逆算";
const UNENTERED_PAYMENT = "未入力（毎月の返済額を入れてください。今は5年で返すとみなしています）";
export const TENTATIVE = "仮（残高の時点から借りたとみなす。契約書の値があれば入れてください）";
/** 借入額の仮の行（値を根拠の文に入れる: 残高に合わせて直したときに、古い行として外れないように） */
const tentativePrincipal = (v: number): StateRow => estRow("standard", `仮（残高の時点から借りたとみなす。${formatYen(v, "yen")}円。契約書の値があれば入れてください）`);

// ---- 入れ方の区分 ----

export const ENTRY_OPTIONS = [
  { value: "principal", label: "借入額から" },
  { value: "payment", label: "毎月の返済額から" },
  { value: "balance", label: "今の残高から" },
] as const;

export const entryOf = (wh: WorkingHousehold, id: string): LoanEntry => wh.loanEntry?.[id] ?? "principal";
export const withEntry = (wh: WorkingHousehold, id: string, e: LoanEntry | undefined): WorkingHousehold => {
  const next = { ...(wh.loanEntry ?? {}) };
  if (e === undefined || e === "principal") delete next[id];
  else next[id] = e;
  const { loanEntry: _drop, ...rest } = wh;
  void _drop;
  return Object.keys(next).length === 0 ? rest : { ...rest, loanEntry: next };
};

// ---- 返済の今の形（画面の補助） ----

interface LoanNow {
  /** 返し始めの残高（残高を入れていれば残高、無ければ借入額） */
  balance: number;
  /** 残りの回数 */
  months: number;
  rate: number;
  /** 返し始めの月（残高の時点か借入の月） */
  from: string | null;
}

export function loanNow(h: Household, d: Debt): LoanNow {
  const start = resolveTimepoint(h, d.start);
  const rate = Number(d.rateSchedule[0]?.rate ?? "0");
  const given = d.balance?.value ?? (d.balance?.state === "unknown" ? ((d.balance as { substitute?: { value?: number } }).substitute?.value ?? null) : null);
  if (given != null && d.balanceAsOf !== undefined && start !== null) return { balance: given, months: d.repayment.termMonths - monthsBetween(start, d.balanceAsOf), rate, from: d.balanceAsOf };
  return { balance: d.principal, months: d.repayment.termMonths, rate, from: start };
}

const bonusOf = (d: Debt): number => Number(d.repayment.bonusShare ?? "0");
/** 毎月の返済額（返し始めの月の分の目安。ボーナス返済の分を除く） */
export const paymentOf = (h: Household, d: Debt): number => {
  const n = loanNow(h, d);
  return monthlyPayment(n.balance, n.rate, n.months, d.repayment.method, bonusOf(d));
};

/** 仮の印を外した世帯 */
const dropAssumed = (wh: WorkingHousehold, key: string): WorkingHousehold => {
  if (wh.assumed[key] === undefined) return wh;
  const assumed = { ...wh.assumed };
  delete assumed[key];
  return { ...wh, assumed };
};

/** ローン1本の値を直す（複製した要求の中で） */
function editDebt(wh: WorkingHousehold, id: string, fn: (d: Debt, req: EngineRequest) => void): WorkingHousehold {
  return mutate(wh, (h, req) => {
    const d = (h.debts ?? []).find((x) => x.id === id);
    if (d !== undefined) fn(d, req);
  });
}

/**
 * 欄を直した後に、入れ方の区分の決まりで逆算し直す（0052）。before は直す前、after は欄が書いた後の世帯。
 * - 毎月の返済額から: 借入額が逆算の推定なら、金利・期間を直したときに、前の返済額のまま借入額を解き直す
 * - 今の残高から（住宅ローン）: 金利が逆算の推定なら、残高・完済の年・借入の年月を直したときに、前の返済額のまま金利を解き直す
 * - 今の残高から（ほかのローン）: 期間が逆算の推定なら、残高・金利を直したときに、前の返済額のまま完済の年を解き直す
 * - 今の残高から: 借入の年月を直しても完済の年は変えない（期間を直す）。借入額が仮なら残高に合わせる
 */
export function followLoan(before: WorkingHousehold, after: WorkingHousehold, id: string, changed: "balance" | "rate" | "term" | "start" | "method"): WorkingHousehold {
  if (after === before) return after;
  const d0 = (before.request.input.household.debts ?? []).find((x) => x.id === id);
  const d1 = (after.request.input.household.debts ?? []).find((x) => x.id === id);
  if (d0 === undefined || d1 === undefined) return after;
  const mode = entryOf(after, id);
  const pay0 = paymentOf(before.request.input.household, d0);
  const mortgage = d1.kind === "mortgage";
  if (mode === "payment" && (changed === "rate" || changed === "term" || changed === "method") && isEstimate(rowOf(after, addrPrincipal(id)), SOLVED)) {
    return editDebt(after, id, (d, req) => {
      const p = principalFromPayment(pay0, Number(d.rateSchedule[0]?.rate ?? "0"), d.repayment.termMonths, d.repayment.method, bonusOf(d));
      if (p === null) return;
      d.principal = p;
      putRow(inputOf(req), addrPrincipal(id), estRow("derived", `${SOLVED}（毎月の返済額 ${formatYen(pay0, "yen")}円から。借入額 ${formatYen(p, "yen")}円）`));
    });
  }
  if (mode !== "balance") return after;
  let w = after;
  if (changed === "start") {
    // 完済の年はそのまま（期間を直す）
    const h0 = before.request.input.household;
    const s0 = resolveTimepoint(h0, d0.start);
    const s1 = resolveTimepoint(after.request.input.household, d1.start);
    if (s0 !== null && s1 !== null && s0 !== s1) {
      const payoff = addMonths(s0, d0.repayment.termMonths);
      w = editDebt(w, id, (d) => {
        const t = monthsBetween(s1, payoff);
        if (t >= 1 && t <= 600) d.repayment.termMonths = t;
      });
    }
    return w;
  }
  if (changed === "balance" && isEstimate(rowOf(w, addrPrincipal(id)), "仮")) {
    w = editDebt(w, id, (d, req) => {
      const b = d.balance?.value;
      if (b == null) return;
      d.principal = b;
      putRow(inputOf(req), addrPrincipal(id), tentativePrincipal(b));
    });
  }
  if (mortgage && (changed === "balance" || changed === "term") && isEstimate(rowOf(w, addrRate(d1)), SOLVED)) {
    return editDebt(w, id, (d, req) => {
      const n = loanNow(req.input.household, d);
      const r = fittedRateText(n.balance, pay0, n.months, d.repayment.method, bonusOf(d));
      const step = d.rateSchedule[0];
      if (r === null || step === undefined) return;
      step.rate = r;
      putRow(inputOf(req), at(id, "debt.rateSchedule", [rateId(d), "rate"]), estRow("derived", `${SOLVED}（残高・毎月の返済額 ${formatYen(pay0, "yen")}円・完済の年から。年${pct(step.rate)}）`));
    });
  }
  if (!mortgage && (changed === "balance" || changed === "rate" || changed === "method") && isEstimate(rowOf(w, addrTerm(id)), SOLVED)) {
    return editDebt(w, id, (d, req) => solveMonths(d, req, pay0));
  }
  if (!mortgage && changed === "term" && isEstimate(rowOf(before, addrTerm(id)), SOLVED)) {
    // 完済の年を入れた: 前の返済額のまま金利を解く
    return editDebt(w, id, (d, req) => {
      const n = loanNow(req.input.household, d);
      const r = fittedRateText(n.balance, pay0, n.months, d.repayment.method, bonusOf(d));
      const step = d.rateSchedule[0];
      if (r === null || step === undefined) return;
      step.rate = r;
      putRow(inputOf(req), at(id, "debt.rateSchedule", [rateId(d), "rate"]), estRow("derived", `${SOLVED}（残高・毎月の返済額 ${formatYen(pay0, "yen")}円・完済の年から。年${pct(step.rate)}）`));
    });
  }
  return w;
}

/** 前の返済額のまま、返しきる月数を解いて期間に書く（ほかのローンの「今の残高から」） */
function solveMonths(d: Debt, req: EngineRequest, pay: number): void {
  const n = loanNow(req.input.household, d);
  const m = monthsFromPayment(n.balance, pay, n.rate, d.repayment.method, bonusOf(d));
  if (m === null || n.from === null) return;
  const start = resolveTimepoint(req.input.household, d.start);
  const elapsed = start === null ? 0 : monthsBetween(start, n.from);
  const t = Math.min(600, Math.max(1, m + elapsed));
  d.repayment.termMonths = t;
  putRow(inputOf(req), addrTerm(d.id), estRow("derived", `${SOLVED}（残高・毎月の返済額 ${formatYen(pay, "yen")}円・金利から。${t}か月）`));
}

/** 毎月の返済額の欄（区分「毎月の返済額から」「今の残高から」で入れる。「借入額から」では計算の値を見せるだけ） */
function paymentField(wh: WorkingHousehold, d: Debt, k: string, level: "simple" | "detail"): FieldDef {
  const mode = entryOf(wh, d.id);
  const mortgage = d.kind === "mortgage";
  const find = (w: WorkingHousehold) => (w.request.input.household.debts ?? []).find((x) => x.id === d.id);
  if (mode === "principal")
    return field({
      key: `${k}/payment`,
      item: "debt.repayment",
      label: "毎月の返済額（目安）",
      level,
      kind: "text",
      readOnly: "借入額・金利・返済期間からの目安です（ボーナス返済の分を除く。元金均等は最初の月）。返済額から入れるときは「入れ方」を変えます",
      get: (w) => {
        const x = find(w);
        return { value: x === undefined ? null : `月 約${formatYen(paymentOf(w.request.input.household, x), "yen")}円` };
      },
      set: (w) => w,
    });
  return field({
    key: `${k}/payment`,
    item: "debt.repayment",
    label: "毎月の返済額",
    level,
    kind: "yen",
    basis: "monthly",
    sideEffects: "入れた返済額から、借入額・金利・完済の年のどれかを逆算します",
    help:
      mode === "payment"
        ? "通帳の引き落としの額（ボーナス返済の分を除く）。金利・返済期間から借入額を逆算します"
        : mortgage
          ? "返済予定表の毎月の額（ボーナス返済の分を除く）。今の残高・完済の年から金利を逆算します"
          : "毎月の返済額。今の残高と金利から、完済の年を逆算します",
    get: (w) => {
      const x = find(w);
      if (x === undefined) return { value: null };
      const h = w.request.input.household;
      if (mode === "balance" && x.balance?.value == null && x.balance?.state !== "unknown") return { value: null, estimated: null };
      const v = paymentOf(h, x);
      if (mode === "balance" && !mortgage && isEstimate(rowOf(w, addrTerm(x.id)), "未入力")) return { value: v, estimated: UNENTERED_PAYMENT };
      if (mode === "balance" && mortgage && isEstimate(rowOf(w, addrRate(x))) && !isEstimate(rowOf(w, addrRate(x)), SOLVED))
        return { value: v, estimated: "目安の金利・返済期間から計算した額（毎月の返済額を入れると、金利を逆算します）" };
      return { value: v };
    },
    set: (w, v) => {
      if (v === null) return w;
      const pay = Number(v);
      const w0 = mode === "payment" ? dropAssumed(w, principalKey(d.id)) : w;
      return editDebt(w0, d.id, (x, req) => {
        const bonus = bonusOf(x);
        if (mode === "payment") {
          const p = principalFromPayment(pay, Number(x.rateSchedule[0]?.rate ?? "0"), x.repayment.termMonths, x.repayment.method, bonus);
          if (p === null) return;
          x.principal = p;
          putRow(inputOf(req), addrPrincipal(x.id), estRow("derived", `${SOLVED}（毎月の返済額 ${formatYen(pay, "yen")}円から。借入額 ${formatYen(p, "yen")}円）`));
          return;
        }
        if (mortgage) {
          const n = loanNow(req.input.household, x);
          const r = fittedRateText(n.balance, pay, n.months, x.repayment.method, bonus);
          const step = x.rateSchedule[0];
          if (r === null || step === undefined) return;
          step.rate = r;
          putRow(inputOf(req), at(x.id, "debt.rateSchedule", [rateId(x), "rate"]), estRow("derived", `${SOLVED}（残高・毎月の返済額 ${formatYen(pay, "yen")}円・完済の年から。年${pct(step.rate)}）`));
        } else solveMonths(x, req, pay);
      });
    },
  });
}

/** 完済の年月（区分「今の残高から」。借入の年月＋返済期間） */
function payoffField(wh: WorkingHousehold, d: Debt, k: string, level: "simple" | "detail"): FieldDef {
  const find = (w: WorkingHousehold) => (w.request.input.household.debts ?? []).find((x) => x.id === d.id);
  return withAddress(
    field({
      key: `${k}/payoff`,
      item: "debt.repayment",
      label: "完済の年月",
      level,
      kind: "ym",
      sideEffects: "返済期間を直し、返済額を入れていれば金利を逆算し直します",
      help: d.kind === "mortgage" ? "返済予定表の最後の返済の年月" : "空欄にせず、わかれば入れてください。わからなければ毎月の返済額から逆算した年月のままにします",
      get: (w) => {
        const x = find(w);
        const s = x === undefined ? null : resolveTimepoint(w.request.input.household, x.start);
        if (x === undefined || s === null) return { value: null };
        const ym = addMonths(s, x.repayment.termMonths);
        return { value: ym, hint: readYearMonth(ym, w.request.input.baseMonth) };
      },
      set: (w, v) => {
        if (typeof v !== "string") return w;
        const next = editDebt(w, d.id, (x, req) => {
          const s = resolveTimepoint(req.input.household, x.start);
          if (s === null) return;
          const t = monthsBetween(s, v);
          if (t >= 1 && t <= 600) x.repayment.termMonths = t;
        });
        return followLoan(w, next, d.id, "term");
      },
    }),
    () => addrTerm(d.id),
  );
}

// ---- 借りる人 ----

type DebtorPick = "self" | "spouse" | "joint" | "guarantor";
const debtorPick = (wh: WorkingHousehold, d: Debt): string => {
  const h = wh.request.input.household;
  const kind = (id: string | undefined) => h.members.find((m) => m.id === id)?.kind;
  const primary = d.debtors.find((x) => x.role === "primary") ?? d.debtors[0];
  if (d.debtors.some((x) => x.role === "joint")) return "joint";
  if (d.debtors.some((x) => x.role === "guarantor")) return "guarantor";
  return kind(primary?.member) === "spouse" ? "spouse" : kind(primary?.member) === "self" ? "self" : (primary?.member ?? "");
};

function debtorFields(wh: WorkingHousehold, d: Debt, k: string): FieldDef[] {
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self");
  const spouse = h.members.find((m) => m.kind === "spouse" && m.outside === undefined);
  const options = [
    { value: "self", label: "ご本人" },
    ...(spouse !== undefined ? [{ value: "spouse", label: "配偶者" }] : []),
    ...(spouse !== undefined && d.pairWith === undefined && d.kind === "mortgage"
      ? [
          { value: "joint", label: "夫婦で連帯債務（1本を2人で）" },
          { value: "guarantor", label: "収入合算（配偶者が連帯保証人）" },
        ]
      : []),
  ];
  const cur = debtorPick(wh, d);
  if (!options.some((o) => o.value === cur) && cur !== "") options.push({ value: cur, label: memberLabel(wh, cur) });
  const fields: FieldDef[] = [
    withAddress(
      field({
        key: `${k}/debtors`,
        item: "debt.debtors",
        label: "借りる人",
        // 既定は本人。ペアローンは「＋ ペアローン」のボタンで足すので、借りる人は詳細（0078）
        level: "detail",
        kind: "select",
        structural: true,
        options,
        help: d.kind === "mortgage" ? "夫婦それぞれが1本ずつ借りるペアローンは「＋ ペアローン」で2本目を足します" : undefined,
        get: (w) => ({ value: debtorPick(w, (w.request.input.household.debts ?? []).find((x) => x.id === d.id) ?? d) }),
        set: (w, v) =>
          editDebt(w, d.id, (x) => {
            if (self === undefined) return;
            const pick = v as DebtorPick;
            const before = (x.debtors.find((y) => y.role === "primary") ?? x.debtors[0])?.member;
            if (pick === "self") x.debtors = [{ member: self.id, role: "primary" }];
            else if (pick === "spouse" && spouse !== undefined) x.debtors = [{ member: spouse.id, role: "primary" }];
            else if (pick === "joint" && spouse !== undefined) x.debtors = [{ member: self.id, role: "primary", share: "0.5" }, { member: spouse.id, role: "joint", share: "0.5" }];
            else if (pick === "guarantor" && spouse !== undefined) x.debtors = [{ member: self.id, role: "primary" }, { member: spouse.id, role: "guarantor" }];
            else if (typeof v === "string" && v !== "") x.debtors = [{ member: v, role: "primary" }];
            // 団信の対象が前の主債務者だけなら、新しい主債務者にする
            const after = (x.debtors.find((y) => y.role === "primary") ?? x.debtors[0])?.member;
            if (x.creditLife !== undefined && after !== undefined && x.creditLife.covered.length === 1 && x.creditLife.covered[0] === before) x.creditLife.covered = [after];
          }),
      }),
      () => at(d.id, "debt.debtors"),
    ),
  ];
  if (cur === "joint") {
    fields.push(
      withAddress(
        field({
          key: `${k}/share`,
          item: "debt.debtors",
          label: "本人の負担割合（連帯債務）",
          level: "detail",
          kind: "pct",
          help: "残りが配偶者の負担。住宅ローン控除は負担割合で分けます",
          get: (w) => ({ value: (w.request.input.household.debts ?? []).find((x) => x.id === d.id)?.debtors.find((x) => x.role === "primary")?.share ?? "0.5" }),
          set: (w, v) =>
            editDebt(w, d.id, (x) => {
              const s = Math.min(1, Math.max(0, Number(v ?? "0.5")));
              for (const y of x.debtors) if (y.role === "primary") y.share = rateText(s);
              for (const y of x.debtors) if (y.role === "joint") y.share = rateText(1 - s);
            }),
        }),
        () => at(d.id, "debt.debtors"),
      ),
    );
  }
  return fields;
}

// ---- 団信 ----

/** 団信の事由（スキーマの並び） */
const CL_EVENTS = ["death", "highDisability", "cancer", "threeMajor", "eightMajor", "incapacity"] as const;
const DISEASE_RIDERS = [
  { value: "", label: "なし" },
  { value: "cancer", label: "がんの特約" },
  { value: "threeMajor", label: "3大疾病の特約" },
  { value: "eightMajor", label: "8大疾病の特約" },
];

/**
 * 住宅ローンの団信の欄（対象・事由（特約）・保障割合・夫婦連生・就業不能の特約の月数）。住まい・ローンのカードと、万一の画面の「団信」で同じ欄を使う
 * （欄のキーが同じなので、どちらで直しても同じ世帯データが変わる）
 */
export function creditLifeFields(wh: WorkingHousehold, d: Debt, level: "simple" | "detail" = "simple"): FieldDef[] {
  const find = byId(debts, d.id);
  const k = `housing/debt/${d.id}`;
  const cl = (h: Household, w: WorkingHousehold) => (find(h, w) as Debt | undefined)?.creditLife;
  const events = (h: Household, w: WorkingHousehold): string[] => (cl(h, w)?.events as string[] | undefined) ?? ["death"];
  const setEvent = (w: WorkingHousehold, ev: string, on: boolean) =>
    mutate(w, (h) => {
      const c = cl(h, w);
      if (c === undefined) return;
      const cur = new Set((c.events as string[] | undefined) ?? ["death"]);
      if (on) cur.add(ev);
      else cur.delete(ev);
      c.events = CL_EVENTS.filter((e) => cur.has(e));
    });
  const fields: FieldDef[] = [
    field({
      key: `${k}/creditLife`,
      item: "debt.creditLife",
      label: "団体信用生命保険（団信）の対象",
      level,
      kind: "select",
      options: [{ value: "", label: "入っていない・未確認" }, ...memberOptions(wh, (m) => d.debtors.some((x) => x.member === m.id))],
      help: "亡くなったとき・高度障害のとき、この人の負担分の残高が消えます。民間の住宅ローンの多くは加入が条件です（フラット35 は加入が任意です）",
      get: (w) => ({ value: (find(w.request.input.household, w) as Debt | undefined)?.creditLife?.covered[0] ?? "", ...(((find(w.request.input.household, w) as Debt | undefined)?.creditLife?.covered.length ?? 0) > 1 ? { derived: "夫婦連生（2人とも対象）" } : {}) }),
      set: (w, v) =>
        mutate(w, (h) => {
          const x = find(h, w) as Debt | undefined;
          if (x === undefined) return;
          if (v === "" || v === null) delete x.creditLife;
          else x.creditLife = { ...(x.creditLife ?? { events: ["death", "highDisability"] }), covered: [String(v)] };
        }),
    }),
  ];
  if (d.creditLife === undefined) return fields;
  const implicitEvents = (w: WorkingHousehold) => cl(w.request.input.household, w)?.events === undefined;
  fields.push(
    field({
      key: `${k}/clHigh`,
      item: "debt.creditLife",
      label: "高度障害も対象",
      level: "detail",
      kind: "bool",
      get: (w) => ({ value: events(w.request.input.household, w).includes("highDisability"), ...(implicitEvents(w) ? { implicit: true } : {}) }),
      set: (w, v) => setEvent(w, "highDisability", v === true),
    }),
    field({
      key: `${k}/clIncapacity`,
      item: "debt.creditLife",
      label: "就業不能の特約",
      level: "detail",
      kind: "bool",
      help: "働けない状態が決まった月数続くと残高が消えます（障害・就業不能の想定で使います）",
      get: (w) => ({ value: events(w.request.input.household, w).includes("incapacity"), ...(implicitEvents(w) ? { implicit: true } : {}) }),
      set: (w, v) => setEvent(w, "incapacity", v === true),
    }),
    field({
      key: `${k}/clDisease`,
      item: "debt.creditLife",
      label: "疾病の特約",
      level: "detail",
      kind: "select",
      options: DISEASE_RIDERS,
      help: "記録として残します（病気の特約は、計算には使いません）",
      get: (w) => ({ value: events(w.request.input.household, w).find((e) => e === "cancer" || e === "threeMajor" || e === "eightMajor") ?? "", ...(implicitEvents(w) ? { implicit: true } : {}) }),
      set: (w, v) =>
        mutate(w, (h) => {
          const c = cl(h, w);
          if (c === undefined) return;
          const cur = new Set(((c.events as string[] | undefined) ?? ["death"]).filter((e) => e !== "cancer" && e !== "threeMajor" && e !== "eightMajor"));
          if (v !== "" && v !== null) cur.add(String(v));
          c.events = CL_EVENTS.filter((e) => cur.has(e));
        }),
    }),
  );
  if (events(wh.request.input.household, wh).includes("incapacity"))
    fields.push(plain({ key: `${k}/clMonths`, item: "debt.creditLife", label: "就業不能の特約: 残高が消えるまでの月数", level: "detail", kind: "int", suffix: "か月", min: 0, max: 120, find, path: ["creditLife", "incapacityMonths"], optional: true, fallback: 12 }));
  fields.push(
    plain({ key: `${k}/clRatio`, item: "debt.creditLife", label: "保障割合", level: "detail", kind: "pct", find, path: ["creditLife", "ratio"], optional: true, fallback: "1", help: "連帯債務などで、残高のうち保障される割合" }),
    plain({ key: `${k}/clJoint`, item: "debt.creditLife", label: "夫婦連生", help: "どちらかの万一で、残りの全額がなくなります", level: "detail", kind: "bool", find, path: ["creditLife", "spouseJoint"], optional: true, fallback: false }),
  );
  return fields;
}

/** 万一の画面に出す団信のまとまり（住宅ローンごと。欄は住まい・ローンのカードと同じ） */
export function creditLifeGroups(wh: WorkingHousehold): GroupDef[] {
  const list = (wh.request.input.household.debts ?? []).filter((d) => d.kind === "mortgage");
  return list.map((d, i) => {
    const debtor = d.debtors.find((x) => x.role === "primary") ?? d.debtors[0];
    return { key: `cg/creditLife/${d.id}`, title: `住宅ローン ${i + 1}（${memberLabel(wh, debtor?.member)}）の団信`, level: "simple", fields: creditLifeFields(wh, d), actions: [] };
  });
}

// ---- 借入額 ----

/**
 * 住宅ローンの借入額。購入の予定とつながるローン（借入の年月＝購入の月）は、空欄で「物件の価格−頭金」の推定に戻り、推定の間は価格・頭金に合わせて
 * 入れ直す（housingCredit.ts）。購入の予定と合わないときは知らせる
 */
function principalField(wh: WorkingHousehold, d: Debt, k: string, level: "simple" | "detail"): FieldDef {
  const key = `${k}/principal`;
  const linked = estimatedPrincipal(wh.request.input.household, d) !== null;
  const def = field({
    key,
    item: "debt.principal",
    label: "借入額",
    level,
    kind: "yen",
    basis: "once",
    ...(linked ? { optional: true, blankIsEstimate: true } : {}),
    get: (w) => {
      const h = w.request.input.household;
      const x = (h.debts ?? []).find((y) => y.id === d.id);
      return { value: x?.principal ?? null, estimated: w.assumed[key] ?? null, warn: x === undefined ? null : principalMismatch(h, x) };
    },
    set: (w, v) => {
      let est = false;
      const next = editDebt(w, d.id, (x) => {
        if (v === null) {
          const e = estimatedPrincipal(w.request.input.household, x);
          if (e === null) return;
          x.principal = e;
          est = true;
        } else x.principal = Number(v);
      });
      if (v === null && !est) return w;
      const assumed = { ...next.assumed };
      if (est) assumed[key] = PRINCIPAL_ESTIMATE;
      else delete assumed[key];
      return { ...next, assumed };
    },
  });
  return def;
}

// ---- 住宅ローン控除の条件 ----

const PROPERTY_TYPES = [
  { value: "certified", label: "長期優良住宅・低炭素住宅（認定住宅）" },
  { value: "zeh", label: "ZEH水準省エネ住宅" },
  { value: "energySaving", label: "省エネ基準適合住宅" },
  { value: "other", label: "その他の住宅（一般の住宅）" },
];
const PROPERTY_SHORT: Record<string, string> = { certified: "認定住宅", zeh: "ZEH水準省エネ住宅", energySaving: "省エネ基準適合住宅", other: "一般の住宅" };

const memberLabelOf = (h: Household, id: string): string => {
  const m = h.members.find((x) => x.id === id);
  return m?.kind === "self" ? "ご本人" : m?.kind === "spouse" ? "配偶者" : "家族";
};

const moveInOf = (h: Household, hs: DebtHousing | undefined): string | null => resolveTimepoint(h, (h.events ?? []).find((e) => e.id === hs?.moveIn)?.at);

/** 2028年以後に入居する新築の、省エネ基準適合住宅・一般の住宅は控除の対象にならない（制度データの借入限度額が0） */
function creditWarn(h: Household, hs: DebtHousing | undefined): string | null {
  if (hs === undefined || hs.creditDisabled === true || !hs.newBuild) return null;
  const ym = moveInOf(h, hs);
  if (ym === null || Number(ym.slice(0, 4)) < 2028 || (hs.propertyType !== "energySaving" && hs.propertyType !== "other")) return null;
  return "2028年以後に入居する新築は、省エネ基準適合住宅・一般の住宅だと控除の対象になりません。ZEH水準・認定住宅なら住宅の種類を選んでください";
}

/** 住宅ローン控除が効く期間の目安（入居から13年。新築の控除の期間の長い方） */
const CREDIT_YEARS = 13;

/** 入居から13年以内か、これから入居する（購入の予定）ローンか。住宅の種類を標準に出すかの決め（0078） */
export function creditActive(h: Household, hs: DebtHousing | undefined, baseMonth: string): boolean {
  if (hs === undefined || hs.creditDisabled === true) return false;
  const ym = moveInOf(h, hs);
  return ym !== null && monthsBetween(ym, baseMonth) < CREDIT_YEARS * 12;
}

/** 住宅ローン控除の条件（要約の1行は標準、住宅の種類は控除が効く間だけ標準、ほかは詳細。0052・0078） */
function creditFields(wh: WorkingHousehold, d: Debt, k: string): FieldDef[] {
  const key = creditKey(d.id);
  const balanceMode = fromBalance(wh, d.id);
  const hsOf = (w: WorkingHousehold) => (w.request.input.household.debts ?? []).find((y) => y.id === d.id)?.housing;
  const mark = (w: WorkingHousehold) => w.assumed[key] ?? null;
  const edit = (w: WorkingHousehold, fn: (hs: DebtHousing, x: Debt, h: Household) => void): WorkingHousehold =>
    withoutCreditMark(
      mutate(w, (h) => {
        const x = (h.debts ?? []).find((y) => y.id === d.id);
        if (x?.housing !== undefined) fn(x.housing, x, h);
      }),
      d.id,
    );
  const addr = (path: string[]) => () => at(d.id, "debt.housing", path);
  const fields: FieldDef[] = [
    field({
      key: `${k}/creditSummary`,
      item: "debt.housing",
      label: "住宅ローン控除",
      level: "simple",
      kind: "text",
      readOnly: "控除の額・期間は入居の年と住宅の種類から、制度で決まります。条件は「詳細」で直せます",
      get: (w) => {
        const h = w.request.input.household;
        const x = (h.debts ?? []).find((y) => y.id === d.id);
        const hs = x?.housing;
        if (x === undefined || hs === undefined) {
          if (balanceMode) return { value: creditNotApplicable(w, d.id) ? "控除は当てはまらない（該当なし）" : "今の残高から入れたローンは借りた年が分からないので、入居の年月を入れるまで控除を計算しません" };
          const ym = x === undefined ? null : resolveTimepoint(h, x.start);
          return { value: ym !== null && Number(ym.slice(0, 4)) < CREDIT_DATA_FROM_YEAR ? `${CREDIT_DATA_FROM_YEAR - 1}年以前に借りたローンの控除は計算しません` : "控除は計算しません" };
        }
        if (hs.creditDisabled === true) return { value: "控除を受けない" };
        const moveIn = moveInOf(h, hs);
        const own = hs.ownership === undefined || hs.ownership.length === 0 ? "持分は債務者が100%" : `持分 ${hs.ownership.map((o) => `${memberLabelOf(h, o.member)} ${Math.round(Number(o.share) * 1000) / 10}%`).join("・")}`;
        const early = moveIn !== null && Number(moveIn.slice(0, 4)) < CREDIT_DATA_FROM_YEAR ? `（${CREDIT_DATA_FROM_YEAR - 1}年以前の入居の控除は計算しません）` : "";
        const value = ["受ける", moveIn === null ? null : `入居 ${formatYearMonth(moveIn)}`, hs.newBuild ? "新築" : "中古", PROPERTY_SHORT[hs.propertyType] ?? hs.propertyType, own].filter((s) => s !== null).join("・") + early;
        return { value, assumed: mark(w), warn: creditWarn(h, hs) };
      },
      set: (w) => w,
    }),
  ];
  const hs = d.housing;
  // 入居の年月（無ければ「受ける」を始める入口）
  fields.push(
    withAddress(
      field({
        key: `${k}/credit/moveIn`,
        item: "debt.housing",
        ...(hs === undefined ? { sideEffects: "入れると住宅ローン控除の条件（控えめの既定）を置きます" } : {}),
        label: "入居の年月（控除）",
        // 控除の条件は詳細（入居から13年を過ぎたローンは効かない。今の残高から入れたローンの未入力の知らせは、要約の1行と確かめの一覧に出る。0078）
        level: "detail",
        kind: "ym",
        help: `住み始めた年月。控除の期間と借入限度額は入居の年で決まります（${CREDIT_DATA_FROM_YEAR}年より前の入居は計算しません）`,
        get: (w) => {
          const h = w.request.input.household;
          const v = moveInOf(h, hsOf(w));
          // 今の残高から入れた住まいの住宅ローンで控除の条件が無ければ、未入力の警告（黙って控除を0円にしない）。当てはまらないなら「該当なし」
          const unentered = v === null && hsOf(w) === undefined && fromBalance(w, d.id) && !creditNotApplicable(w, d.id);
          return { value: v, ...(v !== null ? { hint: readYearMonth(v, w.request.input.baseMonth) } : {}), ...(unentered ? { estimated: CREDIT_UNENTERED } : {}) };
        },
        set: (w, v) => {
          if (typeof v !== "string") return w;
          const cur = hsOf(w);
          if (cur === undefined) {
            // 控除の条件を新しく置く（FP が入れた入居の年月。住宅の種類は控えめの既定）。「該当なし」の印は外す
            const next = mutate(w, (h, req) => {
              const x = (h.debts ?? []).find((y) => y.id === d.id);
              if (x === undefined) return;
              const ev = { id: newId(), kind: "moveIn", at: { at: v } };
              (h.events ??= []).push(ev);
              x.housing = { moveIn: ev.id, propertyType: "other", newBuild: false };
              putRow(inputOf(req), addrCredit(d.id), undefined);
            });
            return next;
          }
          return withoutCreditMark(
            mutate(w, (h) => {
              const e = (h.events ?? []).find((x) => x.id === cur.moveIn);
              if (e !== undefined) e.at = { at: v };
              else (h.events ??= []).push({ id: cur.moveIn, kind: "moveIn", at: { at: v } });
            }),
            d.id,
          );
        },
      }),
      // 控除の条件が無い間は、条件の全体（debt.housing）を指す（「該当なし」の行の置き場所）
      hs === undefined ? addr([]) : addr(["moveIn"]),
    ),
  );
  if (hs === undefined) return fields;
  fields.push(
    withAddress(
      field({
        key: `${k}/credit/on`,
        item: "debt.housing",
        label: "住宅ローン控除を受ける",
        level: "detail",
        kind: "bool",
        help: "床面積・所得などの要件を満たさないときは外します",
        get: (w) => ({ value: hsOf(w)?.creditDisabled !== true }),
        set: (w, v) =>
          edit(w, (x) => {
            if (v === true) delete x.creditDisabled;
            else x.creditDisabled = true;
          }),
      }),
      addr(["creditDisabled"]),
    ),
    withAddress(
      field({
        // 仮の条件の印（欄のキー＝印の置き場）はこの欄が持つ。「この値にする」で条件の全部を確定にする
        key,
        item: "debt.housing",
        label: "住宅の種類（控除）",
        // 入居から13年以内のローン・購入の予定のローンだけ標準（控除の額に効く間だけ。0078）
        level: creditActive(wh.request.input.household, hs, wh.request.input.baseMonth) ? "simple" : "detail",
        kind: "select",
        options: PROPERTY_TYPES,
        help: "分からなければ、そのままで構いません（控除が少なめに出る種類〔新築は省エネ基準適合住宅、中古はその他の住宅〕で計算します）",
        get: (w) => ({ value: hsOf(w)?.propertyType ?? null, assumed: mark(w), warn: creditWarn(w.request.input.household, hsOf(w)) }),
        set: (w, v) => edit(w, (x) => void (x.propertyType = v as DebtHousing["propertyType"])),
      }),
      addr(["propertyType"]),
    ),
    withAddress(
      field({
        key: `${k}/credit/newBuild`,
        item: "debt.housing",
        label: "新築か中古か（控除）",
        level: "detail",
        kind: "select",
        options: [
          { value: "new", label: "新築・買取再販" },
          { value: "used", label: "中古" },
        ],
        get: (w) => ({ value: hsOf(w)?.newBuild === false ? "used" : "new" }),
        set: (w, v) => edit(w, (x) => void (x.newBuild = v === "new")),
      }),
      addr(["newBuild"]),
    ),
    withAddress(
      field({
        key: `${k}/credit/cost`,
        item: "debt.housing",
        label: "取得対価（控除）",
        level: "detail",
        kind: "yen",
        basis: "once",
        optional: true,
        help: "家を買った値段です。空欄なら借入額の上限を置きません。年末残高が取得対価より多いときは、取得対価までで控除します",
        get: (w) => ({ value: hsOf(w)?.acquisitionCost ?? null }),
        set: (w, v) =>
          edit(w, (x) => {
            if (v === null) delete x.acquisitionCost;
            else x.acquisitionCost = Number(v);
          }),
      }),
      addr(["acquisitionCost"]),
    ),
    withAddress(
      field({
        key: `${k}/credit/child`,
        item: "debt.housing",
        label: "子育て世帯・若者夫婦世帯の上乗せ（控除）",
        level: "detail",
        kind: "select",
        options: [
          { value: "auto", label: "自動（家族から判定）" },
          { value: "yes", label: "対象" },
          { value: "no", label: "対象外" },
        ],
        get: (w) => {
          const c = hsOf(w)?.childRearing;
          return { value: c === undefined ? "auto" : c ? "yes" : "no" };
        },
        set: (w, v) =>
          edit(w, (x) => {
            if (v === "auto") delete x.childRearing;
            else x.childRearing = v === "yes";
          }),
      }),
      addr(["childRearing"]),
    ),
  );
  return fields;
}

/** 今の残高から入れた住宅ローンで、入居の年月が空のときの未入力の警告の文（値の状態の読み方で「未入力」になる） */
export const CREDIT_UNENTERED = "未入力（入居の年月を入れると住宅ローン控除を計算します。当てはまらなければ「該当なし」）";
const addrCredit = (id: string) => at(id, "debt.housing");
/** 住宅ローン控除が当てはまらない（FP が「該当なし」にした。控除の条件の全体の行） */
export const creditNotApplicable = (wh: WorkingHousehold, id: string): boolean => rowOf(wh, addrCredit(id))?.state === "notApplicable";

/** 控除の条件の「該当なし」を置く・外す（今の残高から入れた住宅ローンで、控除の条件が無いとき） */
export function setCreditNotApplicable(wh: WorkingHousehold, id: string, on: boolean): WorkingHousehold {
  return mutate(wh, (_h, req) => void putRow(inputOf(req), addrCredit(id), on ? { state: "notApplicable", origin: { kind: "manual" } } : undefined));
}

// ---- ローンの欄 ----

/** 金利の欄（最初の段） */
function rateField(wh: WorkingHousehold, d: Debt, k: string, level: "simple" | "detail"): FieldDef {
  const firstRate: Finder = (h, w) => (getPath(byId(debts, d.id)(h, w), ["rateSchedule", "0"]) as Record<string, unknown> | undefined) ?? undefined;
  const inner = plain({ key: `${k}/rate`, item: "debt.rateSchedule", label: "金利（当初・年）", level, kind: "pct", find: firstRate, path: ["rate"] });
  return field({ ...inner, ...followNote(wh, d), set: (w, v) => followLoan(w, inner.write?.(w, v) ?? inner.set(w, v), d.id, "rate") });
}

/** 金利の種類ごとの当初の金利の目安（住宅ローン。マスタデータ master.housing.statistics の写しから。hearing/src/housingEstimates.ts） */
export function rateEstimateOf(type: string | undefined): { rate: string; basis: string } {
  const t: MortgageRateType = type === "fixed" || type === "fixedPeriod" ? type : "variable";
  const e = mortgageRateEstimate(t);
  return { rate: e.rate, basis: presetBasis(e.basis) };
}

/** 金利の値の状態の行が、種類ごとの目安の金利（推定）のままか（種類を変えたら目安を入れ直してよい値か） */
const isRateEstimate = (r: StateRow | undefined): boolean => r?.state === "estimated" && r.origin.kind === "auto" && RATE_ESTIMATE_HEADS.some((head) => (r.estimate?.basis ?? "").includes(`（${head}`));

/**
 * 変動金利の見込みの欄（rateOutlookField）で置いた段（5年後・10年後）を持つか。見込みの欄は、今の金利の段が最初の段で変動金利のときだけ出るので、
 * 最初の段の種類を変えると欄が隠れる。隠れた見込みの段が計算に残らないように、種類を変動金利から変えたときに外す
 */
function hasOutlookSteps(h: Household, d: Debt, baseMonth: string): boolean {
  if (outlookBase(h, d, baseMonth).index !== 0 || !isVariableNow(h, d, baseMonth)) return false;
  const o = rateOutlookOf(h, d, baseMonth);
  return RATE_OUTLOOKS.some((x) => x.adds.length > 0 && x.value === o);
}

/**
 * 金利の種類の欄（最初の段）。住宅ローンは金利の欄の前に置き、種類を変えたときに金利が種類の目安（推定）のままなら、新しい種類の目安に入れ直す
 * （変動・固定期間選択型・全期間固定で当初の金利の水準が違うため）。変動金利から変えるときは、変動金利の見込みの段も外す
 */
function rateTypeField(wh: WorkingHousehold, d: Debt, k: string, level: "simple" | "detail"): FieldDef {
  const firstRate: Finder = (h, w) => (getPath(byId(debts, d.id)(h, w), ["rateSchedule", "0"]) as Record<string, unknown> | undefined) ?? undefined;
  const inner = plain({ key: `${k}/rateType`, item: "debt.rateSchedule", label: "金利の種類", level, kind: "select", options: RATE_TYPES, find: firstRate, path: ["type"] });
  if (d.kind !== "mortgage") return inner;
  const notes = [
    ...(isRateEstimate(rowOf(wh, addrRate(d))) ? ["金利が目安のままなら、選んだ種類の目安の金利に入れ直します"] : []),
    ...(hasOutlookSteps(wh.request.input.household, d, wh.request.input.baseMonth) ? ["変動金利以外にすると、変動金利の見込みの段（5年後・10年後）を外します"] : []),
  ];
  return field({
    ...inner,
    ...(notes.length > 0 ? { sideEffects: notes.join("。") } : {}),
    help: "変動・固定期間選択型・全期間固定で、金利の目安が変わります（金利を入れていれば変えません）",
    set: (w, v) => {
      const h0 = w.request.input.household;
      const d0 = (h0.debts ?? []).find((x) => x.id === d.id);
      const dropOutlook = v !== "variable" && d0 !== undefined && hasOutlookSteps(h0, d0, w.request.input.baseMonth);
      const typed = inner.write?.(w, v) ?? inner.set(w, v);
      if (typed === w) return typed;
      // 見込みの段（変動金利の5年後・10年後）は全期間固定・固定期間選択型に残さない（見込みの欄は隠れるのに、隠れた段で金利が変わってしまう）
      const next = dropOutlook ? editDebt(typed, d.id, (x) => void (x.rateSchedule = x.rateSchedule.slice(0, 1))) : typed;
      if (!isRateEstimate(rowOf(w, addrRate(d)))) return next;
      const e = rateEstimateOf(typeof v === "string" ? v : undefined);
      const w2 = editDebt(next, d.id, (x, req) => {
        const step = x.rateSchedule[0];
        if (step === undefined) return;
        step.rate = e.rate;
        putRow(inputOf(req), at(x.id, "debt.rateSchedule", [rateId(x), "rate"]), estRow("standard", e.basis));
      });
      return followLoan(next, w2, d.id, "rate");
    },
  });
}

/** 逆算し直す欄の説明（逆算の推定があるローンだけ。往復の確かめで別に扱う） */
function followNote(wh: WorkingHousehold, d: Debt): { sideEffects?: string } {
  const solved = [rowOf(wh, addrPrincipal(d.id)), rowOf(wh, addrRate(d)), rowOf(wh, addrTerm(d.id))].some((r) => isEstimate(r, SOLVED) || isEstimate(r, "仮"));
  return solved || entryOf(wh, d.id) === "balance" ? { sideEffects: "入れ方の決まりで、逆算した値（借入額・金利・完済の年）を解き直します" } : {};
}

function termField(wh: WorkingHousehold, d: Debt, k: string, level: "simple" | "detail"): FieldDef {
  const find = byId(debts, d.id);
  return withAddress(
    field({
      key: `${k}/term`,
      item: "debt.repayment",
      ...followNote(wh, d),
      label: "返済期間",
      level,
      kind: "int",
      suffix: "年",
      min: 1,
      max: 50,
      get: (w) => {
        const t = (find(w.request.input.household, w) as Debt | undefined)?.repayment.termMonths;
        return t === undefined ? { value: null } : { value: Math.round(t / 12), derived: t % 12 !== 0 ? `${t}か月（年に直すとずれる）` : null };
      },
      set: (w, v) => {
        const next = mutate(w, (h) => {
          const x = find(h, w) as Debt | undefined;
          if (x !== undefined && v !== null) x.repayment.termMonths = Number(v) * 12;
        });
        return followLoan(w, next, d.id, "term");
      },
    }),
    () => addrTerm(d.id),
  );
}

function startField(wh: WorkingHousehold, d: Debt, k: string, level: "simple" | "detail"): FieldDef {
  const find = byId(debts, d.id);
  const self = wh.request.input.household.members.find((m) => m.kind === "self");
  const ageOf = self !== undefined ? { ageOf: (h: Household) => h.members.find((m) => m.id === self.id) } : {};
  const inner = timepointField({ key: `${k}/start`, item: "debt.start", label: "借入の年月", level, find, path: ["start"], mode: "ym", ...ageOf });
  return withAddress(field({ ...inner, ...followNote(wh, d), set: (w, v) => followLoan(w, inner.set(w, v), d.id, "start") }), () => addrStart(d.id));
}

function balanceField(wh: WorkingHousehold, d: Debt, k: string, level: "simple" | "detail"): FieldDef {
  const find = byId(debts, d.id);
  const mode = entryOf(wh, d.id);
  const inner = yenBox({
    key: `${k}/balance`,
    item: "debt.balance",
    label: "今の残高",
    level,
    basis: "once",
    find,
    path: ["balance"],
    optional: mode !== "balance",
    help: mode === "balance" ? "年末残高証明書・返済予定表の残高。時点は「残高の時点」（空欄なら今月）" : "返済予定表の残高。空欄なら借入額と金利から計算します",
  });
  if (mode !== "balance") return inner;
  return field({
    ...inner,
    sideEffects: "残高の時点が空なら計算の基準の月にし、入れ方の決まりで金利・完済の年を逆算し直します",
    set: (w, v) => {
      const next = mutate(inner.write?.(w, v) ?? inner.set(w, v), (h, req) => {
        const x = (h.debts ?? []).find((y) => y.id === d.id);
        if (x !== undefined && v !== null && x.balanceAsOf === undefined) x.balanceAsOf = req.input.baseMonth;
      });
      return followLoan(w, next, d.id, "balance");
    },
  });
}

const methodField = (wh: WorkingHousehold, d: Debt, k: string): FieldDef => {
  const inner = plain({ key: `${k}/method`, item: "debt.repayment", label: "返済方法", level: "detail", kind: "select", options: REPAYMENT_METHODS, find: byId(debts, d.id), path: ["repayment", "method"] });
  return field({ ...inner, ...followNote(wh, d), set: (w, v) => followLoan(w, inner.write?.(w, v) ?? inner.set(w, v), d.id, "method") });
};

function entryField(d: Debt, k: string, level: "simple" | "detail"): FieldDef {
  return field({
    key: `${k}/entry`,
    item: null,
    label: "入れ方",
    level,
    kind: "select",
    options: d.kind === "mortgage" ? [...ENTRY_OPTIONS] : ENTRY_OPTIONS.filter((o) => o.value !== "payment"),
    help: "手元の書類に合わせて選びます。入れ方を変えても、入っている値は消えません",
    get: (w) => ({ value: entryOf(w, d.id) }),
    set: (w, v) => switchEntry(w, d.id, v as LoanEntry),
  });
}

/**
 * 入れ方を変える（0052 の4）。データは同じ物: 「今の残高から」にしたら、残高が無ければ借入額と金利から計算した今の残高を推定で置く
 * （時点は計算の基準の月）。ほかの区分に戻しても値は消さない
 */
export function switchEntry(wh: WorkingHousehold, id: string, e: LoanEntry): WorkingHousehold {
  let w = withEntry(wh, id, e);
  if (e === "balance") {
    w = mutate(w, (h, req) => {
      const d = (h.debts ?? []).find((x) => x.id === id);
      if (d === undefined || d.balance !== undefined) return;
      const base = req.input.baseMonth;
      const start = resolveTimepoint(h, d.start);
      if (start === null || start >= base) return;
      const k = monthsBetween(start, base);
      const r = Number(d.rateSchedule[0]?.rate ?? "0") / 12;
      const n = d.repayment.termMonths;
      if (k >= n) return;
      const p = d.principal;
      const b = d.repayment.method === "equalPrincipal" ? p * (1 - k / n) : r === 0 ? p * (1 - k / n) : (p * (Math.pow(1 + r, n) - Math.pow(1 + r, k))) / (Math.pow(1 + r, n) - 1);
      d.balance = { value: Math.max(0, Math.round(b)), state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: "借入額・金利・返済期間から計算した今の残高（年末残高証明書・返済予定表の額に直してください）" } } as never;
      d.balanceAsOf = base;
    });
  }
  return w;
}

// ---- 変動金利の見込み（標準の1欄。0078） ----

/** 金利の見込みの型: 今の金利からの上乗せ（5年後・10年後）。「今の金利のまま」は今より後の段を持たない */
const RATE_OUTLOOKS: readonly { value: string; label: string; adds: readonly number[] }[] = [
  { value: "flat", label: "今の金利のまま", adds: [] },
  { value: "up1", label: "10年で1%上がる（5年後に＋0.5%・10年後に＋1%）", adds: [0.005, 0.01] },
  { value: "up2", label: "10年で2%上がる（5年後に＋1%・10年後に＋2%）", adds: [0.01, 0.02] },
];
const OUTLOOK_CUSTOM = { value: "custom", label: "金利の段階で入れている（詳細で直す）" };
/** 見込みの段の間隔（月） */
const OUTLOOK_STEP_MONTHS = 60;

/** 見込みの起点（今か、これから借りるなら借入の月）と、その時点の金利の段の番号 */
function outlookBase(h: Household, d: Debt, baseMonth: string): { ref: string; index: number } {
  const start = resolveTimepoint(h, d.start);
  const ref = start !== null && start > baseMonth ? start : baseMonth;
  let index = 0;
  d.rateSchedule.forEach((s, i) => {
    const ym = resolveTimepoint(h, s.from);
    if (ym !== null && ym <= ref) index = i;
  });
  return { ref, index };
}

/** 変動金利のローンか（今か借入の月の金利の段が変動金利） */
export function isVariableNow(h: Household, d: Debt, baseMonth: string): boolean {
  return d.rateSchedule[outlookBase(h, d, baseMonth).index]?.type === "variable";
}

/** 今の金利の段より後の段から、見込みの型を読む（間隔5年・上乗せが型どおりなら、その型。段が無ければ「今の金利のまま」） */
export function rateOutlookOf(h: Household, d: Debt, baseMonth: string): string {
  const { ref, index } = outlookBase(h, d, baseMonth);
  const cur = Number(d.rateSchedule[index]?.rate ?? "0");
  const later = d.rateSchedule.slice(index + 1).map((s) => ({ ym: resolveTimepoint(h, s.from), rate: Number(s.rate), type: s.type }));
  if (later.length === 0) return "flat";
  const hit = RATE_OUTLOOKS.find(
    (o) =>
      o.adds.length === later.length &&
      later.every((x, j) => x.ym !== null && x.ym > ref && x.type === "variable" && Math.abs(x.rate - (cur + (o.adds[j] as number))) < 1e-9 && (j === 0 || monthsBetween(later[j - 1]?.ym as string, x.ym) === OUTLOOK_STEP_MONTHS)),
  );
  return hit?.value ?? OUTLOOK_CUSTOM.value;
}

/** 変動金利の見込みの欄: 今の金利の段より後の段を、選んだ型の段（今から5年ごと）に置き換える。「金利の段階で入れている」は詳細の段のまま */
function rateOutlookField(d: Debt, k: string): FieldDef {
  return withAddress(
    field({
      key: `${k}/rateOutlook`,
      item: "debt.rateSchedule",
      label: "金利の見込み（変動金利）",
      level: "simple",
      kind: "select",
      structural: true,
      options: [...RATE_OUTLOOKS.map((o) => ({ value: o.value, label: o.label })), OUTLOOK_CUSTOM],
      help: "変動金利は、今の金利のままだと楽観の見込みになります。上がる見込みを選ぶと、今（これから借りるなら借入の月）から5年ごとに金利の段を置きます。細かい段は詳細の「金利の段階」で直せます",
      get: (w) => {
        const x = (w.request.input.household.debts ?? []).find((y) => y.id === d.id);
        return { value: x === undefined ? null : rateOutlookOf(w.request.input.household, x, w.request.input.baseMonth) };
      },
      set: (w, v) => {
        const o = RATE_OUTLOOKS.find((x) => x.value === v);
        if (o === undefined) return w;
        return mutate(w, (h, req) => {
          const x = (h.debts ?? []).find((y) => y.id === d.id);
          if (x === undefined) return;
          const { ref, index } = outlookBase(h, x, req.input.baseMonth);
          const cur = Number(x.rateSchedule[index]?.rate ?? "0");
          x.rateSchedule = [
            ...x.rateSchedule.slice(0, index + 1),
            ...o.adds.map((add, j) => ({ id: newId(), from: { at: addMonths(ref, OUTLOOK_STEP_MONTHS * (j + 1)) }, type: "variable", rate: rateText(cur + add) })),
          ];
        });
      },
    }),
    () => at(d.id, "debt.rateSchedule"),
  );
}

/** ローン1本の欄（入れ方の区分ごとに簡易に出す欄を変える） */
export function loanFields(wh: WorkingHousehold, d: Debt, k: string): FieldDef[] {
  const mode = entryOf(wh, d.id);
  const mortgage = d.kind === "mortgage";
  const find = byId(debts, d.id);
  const S = "simple" as const;
  const D = "detail" as const;
  const fields: FieldDef[] = [];
  if (d.property === undefined) fields.push(entryField(d, k, mortgage ? S : D));
  // 金利の種類は金利の欄のすぐ前（住宅ローンは種類で金利の目安が変わるので、金利の欄が標準なら種類も標準）
  const rate = (level: "simple" | "detail"): FieldDef[] => [rateTypeField(wh, d, k, mortgage ? level : D), rateField(wh, d, k, level)];
  if (mode === "principal") fields.push(principalField(wh, d, k, S), startField(wh, d, k, S), ...rate(S), termField(wh, d, k, S), paymentField(wh, d, k, S), balanceField(wh, d, k, D));
  else if (mode === "payment") fields.push(paymentField(wh, d, k, S), ...rate(S), startField(wh, d, k, S), termField(wh, d, k, S), principalField(wh, d, k, D), balanceField(wh, d, k, D));
  else fields.push(balanceField(wh, d, k, S), paymentField(wh, d, k, S), payoffField(wh, d, k, mortgage ? S : D), ...rate(D), startField(wh, d, k, D), principalField(wh, d, k, D));
  // 変動金利の住宅ローンは、金利の見込みを標準に1欄（今の金利のままは楽観。0078）
  if (mortgage && isVariableNow(wh.request.input.household, d, wh.request.input.baseMonth)) fields.push(rateOutlookField(d, k));
  fields.push(
    plain({ key: `${k}/balanceAsOf`, item: "debt.balanceAsOf", label: "残高の時点", level: D, kind: "ym", find, path: ["balanceAsOf"], optional: true, help: "年末残高証明書なら前の年の12月" }),
    methodField(wh, d, k),
    plain({ key: `${k}/bonus`, item: "debt.repayment", label: "ボーナス返済の割合", level: D, kind: "pct", min: 0, max: 100, find, path: ["repayment", "bonusShare"], optional: true, fallback: "0" }),
  );
  if (mortgage) {
    fields.push(
      withAddress(plain({ key: `${k}/product`, item: "debt.product", label: "商品", level: D, kind: "select", options: [{ value: "bank", label: "銀行などの住宅ローン" }, { value: "flat35", label: "フラット35（全期間固定）" }], find, path: ["product"], optional: true, fallback: "bank" }), () => at(d.id, "debt.product")),
      plain({ key: `${k}/fiveYear`, item: "debt.repayment", label: "5年ルール", help: "返済額を5年ごとに見直します（その間に金利が変わっても返済額は同じ）", level: D, kind: "bool", find, path: ["repayment", "variableRules", "fiveYear"], optional: true, fallback: false }),
      plain({ key: `${k}/cap125`, item: "debt.repayment", label: "125%ルール", help: "5年ごとの見直しで、新しい返済額を前の1.25倍までにします", level: D, kind: "bool", find, path: ["repayment", "variableRules", "cap125"], optional: true, fallback: false }),
      // 団信は住まい・ローンのカードでは詳細（既定の「あり」で多くは当たり、今の結果には効かない。万一の画面では標準のまま。0078）
      ...creditLifeFields(wh, d, D),
    );
    if (isHomeLoan(d)) fields.push(...creditFields(wh, d, k));
  }
  if (d.property === undefined) fields.push(...debtorFields(wh, d, k));
  if (d.pairWith !== undefined) fields.push(field({ key: `${k}/pair`, item: "debt.pairWith", label: "ペアローン", level: S, kind: "text", readOnly: "もう1本のローンは、そのローンの欄で入れます", get: () => ({ value: "もう1本のローンと組（ペアローン）" }), set: (w) => w }));
  return fields;
}

// ---- ほかのローンの種類 ----

export const LOAN_SUBTYPES = [
  { value: "cardLoan", label: "カードローン・リボ", kind: "other", rate: "0.15", rateBasis: "カードローン・リボの金利の目安 年15%" },
  // 奨学金は子ども・教育の入力項目の貸与の奨学金と同じ目安（マスタデータ master.loanRates）
  { value: "scholarship", label: "奨学金の返済", kind: "scholarship", rate: scholarshipRateEstimate().rate, rateBasis: `貸与の奨学金の利率の目安 ${scholarshipRateEstimate().basis}` },
  { value: "renovation", label: "リフォームローン", kind: "other", rate: "0.025", rateBasis: "リフォームローンの金利の目安 年2.5%" },
  { value: "policyLoan", label: "契約者貸付（保険）", kind: "other", rate: "0.03", rateBasis: "契約者貸付の金利の目安 年3%" },
  { value: "personal", label: "親・知人からの借入", kind: "other", rate: "0", rateBasis: "親・知人からの借入は利息なし" },
  { value: "other", label: "その他のローン", kind: "other", rate: "0.03", rateBasis: "その他のローンの金利の目安 年3%" },
] as const;
type SubtypeDef = (typeof LOAN_SUBTYPES)[number];
const subtypeDef = (v: string | undefined): SubtypeDef | undefined => LOAN_SUBTYPES.find((s) => s.value === v);

/** ローンの名前（名前 → 種類の細目 → 計算の種類） */
export function loanTitle(d: Debt): string {
  if (typeof d.label === "string" && d.label !== "") return d.label;
  const sub = subtypeDef(d.subtype);
  if (sub !== undefined) return sub.label;
  return DEBT_KINDS.find((o) => o.value === d.kind)?.label ?? "ローン";
}

/** ほかのローンの種類・名前の欄（表示と推定の元だけ。0052） */
export function otherLoanHeadFields(wh: WorkingHousehold, d: Debt, k: string): FieldDef[] {
  if (d.kind === "car" || d.kind === "mortgage") return [];
  const find = byId(debts, d.id);
  return [
    withAddress(
      field({
        key: `${k}/subtype`,
        item: "debt.subtype",
        label: "種類",
        level: "simple",
        kind: "select",
        structural: true,
        options: LOAN_SUBTYPES.map((s) => ({ value: s.value, label: s.label })),
        help: "種類で金利の目安が決まります（金利を入れていれば変えません）",
        get: (w) => ({ value: (find(w.request.input.household, w) as Debt | undefined)?.subtype ?? (d.kind === "scholarship" ? "scholarship" : "other") }),
        set: (w, v) =>
          editDebt(w, d.id, (x, req) => {
            const sub = subtypeDef(String(v));
            if (sub === undefined) return;
            x.subtype = sub.value;
            x.kind = sub.kind;
            // 金利が種類の目安のまま（推定）なら、新しい種類の目安に入れ直す
            const a = addrRate(x);
            const step = x.rateSchedule[0];
            if (a !== null && step !== undefined && isEstimate(rowAt(inputOf(req), a), "標準の値")) {
              step.rate = sub.rate;
              putRow(inputOf(req), a, estRow("standard", `標準の値（${sub.rateBasis}。わかれば直してください）`));
            }
          }),
      }),
      () => at(d.id, "debt.subtype"),
    ),
    withAddress(plain({ key: `${k}/label`, item: "debt.label", label: "名前", level: "detail", kind: "text", find, path: ["label"], optional: true }), () => at(d.id, "debt.label")),
  ];
}

/** 新しいほかのローン（種類の細目）。簡易は「今の残高から」: 残高・毎月の返済額は未入力、金利は種類の目安（推定） */
export function newOtherLoan(wh: WorkingHousehold, subtype: SubtypeDef["value"]): WorkingHousehold {
  const sub = subtypeDef(subtype) as SubtypeDef;
  const id = newId();
  const rid = newId();
  const base = wh.request.input.baseMonth;
  const next = mutate(wh, (h, req) => {
    const self = h.members.find((m) => m.kind === "self");
    if (self === undefined) return;
    const d: Debt = {
      id,
      kind: sub.kind,
      subtype: sub.value,
      debtors: [{ member: self.id, role: "primary" }],
      principal: 0,
      start: { at: base },
      balance: { value: 0, state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "未入力（今の残高を入れてください）" } } as never,
      balanceAsOf: base,
      rateSchedule: [{ id: rid, from: { at: base }, type: "fixed", rate: sub.rate }],
      repayment: { method: "equalPayment", termMonths: 60 },
    };
    (h.debts ??= []).push(d);
    const input = inputOf(req);
    putRow(input, addrPrincipal(id), tentativePrincipal(0));
    putRow(input, addrStart(id), estRow("standard", TENTATIVE));
    putRow(input, at(id, "debt.rateSchedule", [rid, "rate"]), estRow("standard", `標準の値（${sub.rateBasis}。わかれば直してください）`));
    putRow(input, addrTerm(id), estRow("standard", UNENTERED_PAYMENT));
  });
  return withEntry(next, id, "balance");
}

/** 返済期間の標準の値: 35年。完済が80歳を超えるなら80歳まで（借りる人の生年月から） */
export function standardTermMonths(h: Household, memberId: string, start: string): number {
  const m = h.members.find((x) => x.id === memberId);
  if (m === undefined) return 420;
  const [by, bm] = m.birth.birthYearMonth.split("-").map(Number) as [number, number];
  const at80 = `${by + 80}-${String(bm).padStart(2, "0")}`;
  const limit = monthsBetween(start, at80);
  return Math.max(12, Math.min(420, Math.floor(limit / 12) * 12));
}

/**
 * 新しい住宅ローン（目安のボタンの値は推定。0041）: 購入の予定とつながるなら「借入額から」（借入額は物件の価格−頭金の推定）、
 * 今住んでいる家のローンは「今の残高から」（今の残高 3,000万円の目安。借りた年と借入額は仮）。金利は変動金利の目安（マスタデータ）、期間は35年（80歳まで）の標準の値
 */
export function newMortgage(wh: WorkingHousehold, pairOf?: string): WorkingHousehold {
  const id = newId();
  const rid = newId();
  const base = wh.request.input.baseMonth;
  let estimated = false;
  let linked = false;
  const next = mutate(wh, (hh, req) => {
    const self = hh.members.find((m) => m.kind === "self");
    const spouse = hh.members.find((m) => m.kind === "spouse" && m.outside === undefined);
    if (self === undefined) return;
    const partner = pairOf === undefined ? undefined : (hh.debts ?? []).find((x) => x.id === pairOf);
    const debtor = partner !== undefined ? ((partner.debtors[0]?.member === self.id ? spouse?.id : self.id) ?? self.id) : self.id;
    const own = (hh.residences ?? []).find((r) => r.kind === "own");
    const bought = (hh.residences ?? []).filter((r) => r.kind === "own" && r.purchase !== undefined).at(-1);
    const partnerStart = partner === undefined ? null : resolveTimepoint(hh, partner.start);
    const start = partnerStart ?? (bought !== undefined ? purchaseMonth(hh, bought) : null) ?? (own?.purchase !== undefined ? resolveTimepoint(hh, own.purchase.at) : null) ?? base;
    linked = partner !== undefined ? wh.loanEntry?.[partner.id] !== "balance" : bought !== undefined;
    const term = standardTermMonths(hh, debtor, start);
    const d: Debt = {
      id,
      kind: "mortgage",
      debtors: [{ member: debtor, role: "primary" }],
      principal: 30000000,
      start: { at: start },
      rateSchedule: [{ id: rid, from: { at: start }, type: partner?.rateSchedule[0]?.type ?? "variable", rate: partner?.rateSchedule[0]?.rate ?? rateEstimateOf("variable").rate }],
      repayment: { method: "equalPayment", termMonths: partner?.repayment.termMonths ?? term, variableRules: { fiveYear: true, cap125: true } },
      creditLife: { covered: [debtor], events: ["death", "highDisability"] },
      ...(partner !== undefined ? { pairWith: partner.id } : {}),
    };
    (hh.debts ??= []).push(d);
    const input = inputOf(req);
    if (partner !== undefined) {
      partner.pairWith ??= id;
      // ペアローン: 借入額を2本に分ける（推定。半分ずつ）
      const half = Math.round(partner.principal / 2 / 10000) * 10000;
      d.principal = half;
      putRow(input, addrPrincipal(id), estRow("standard", `ペアローンの2本目（1本目の借入額の半分。${man(half)}。直してください）`));
      if (wh.assumed[principalKey(partner.id)] === undefined) {
        partner.principal -= half;
        putRow(input, addrPrincipal(partner.id), estRow("standard", `ペアローンで2本に分けた額（${man(partner.principal)}。直してください）`));
      }
      if (partner.balance !== undefined) {
        d.balance = structuredClone(partner.balance);
        d.balanceAsOf = partner.balanceAsOf ?? base;
      }
      if (!linked) {
        putRow(input, addrStart(id), estRow("standard", TENTATIVE));
      }
    } else if (!linked) {
      d.balance = standardBox(30000000, presetBasis("今の残高 3,000万円")) as never;
      d.balanceAsOf = base;
      putRow(input, addrPrincipal(id), tentativePrincipal(d.principal));
      putRow(input, addrStart(id), estRow("standard", TENTATIVE));
    }
    if (partner === undefined) putRow(input, at(id, "debt.rateSchedule", [rid, "rate"]), estRow("standard", rateEstimateOf("variable").basis));
    putRow(input, addrTerm(id), estRow("standard", `標準の値（返済期間${Math.round(d.repayment.termMonths / 12)}年。完済が80歳を超えないように）`));
    // 購入の予定とつながるなら、借入額は物件の価格−頭金（推定）
    const e = linked && partner === undefined ? estimatedPrincipal(hh, d) : null;
    if (e !== null) {
      d.principal = e;
      estimated = true;
    }
  });
  let w = estimated ? { ...next, assumed: { ...next.assumed, [principalKey(id)]: PRINCIPAL_ESTIMATE } } : next;
  if (!linked) w = withEntry(w, id, "balance");
  return w;
}

/** ローンのまとまりのボタン（金利の段階・繰上返済。住宅ローンはペアローン） */
export function loanMoreActions(wh: WorkingHousehold, d: Debt, k: string): ActionDef[] {
  const h = wh.request.input.household;
  const spouse = h.members.find((m) => m.kind === "spouse" && m.outside === undefined);
  const out: ActionDef[] = [
    {
      key: `${k}/addRate`,
      label: "＋ 金利の段階",
      level: "detail",
      run: (w) =>
        mutate(w, (hh) => {
          const x = (hh.debts ?? []).find((y) => y.id === d.id) as Debt;
          const last = x.rateSchedule.at(-1);
          const from = addMonths(w.request.input.baseMonth, 60);
          x.rateSchedule.push({ id: newId(), from: { at: from }, type: last?.type ?? "variable", rate: last?.rate ?? "0.01" });
        }),
    },
    {
      key: `${k}/addPrepay`,
      label: "＋ 繰上返済",
      level: "detail",
      run: (w) => mutate(w, (hh) => void (((hh.debts ?? []).find((y) => y.id === d.id) as Debt).prepayments ??= []).push({ id: newId(), at: { at: addMonths(w.request.input.baseMonth, 60) }, amount: 1000000, mode: "shortenTerm" } as never)),
    },
  ];
  if (d.kind === "mortgage" && d.property === undefined && d.pairWith === undefined && spouse !== undefined && d.debtors.length === 1)
    out.unshift({ key: `${k}/addPair`, label: "＋ ペアローン（配偶者の2本目）", level: "simple", run: (w) => newMortgage(w, d.id) });
  // 今の残高から入れた住宅ローンで控除の条件が無い: 当てはまらない（入居から13年を過ぎた・要件を満たさないなど）なら「該当なし」で警告を消す
  if (isHomeLoan(d) && d.housing === undefined && fromBalance(wh, d.id))
    out.unshift(
      creditNotApplicable(wh, d.id)
        ? { key: `${k}/creditNa`, label: "住宅ローン控除の「該当なし」を外す", level: "simple", run: (w) => setCreditNotApplicable(w, d.id, false) }
        : { key: `${k}/creditNa`, label: "住宅ローン控除は当てはまらない", level: "simple", title: "入居から13年を過ぎた・要件を満たさないなどで控除を受けないとき", run: (w) => setCreditNotApplicable(w, d.id, true) },
    );
  return out;
}

/** 区分「今の残高から」のローンで、借入額の欄が逆算・仮の推定かを見る（テスト用） */
export const principalRow = (wh: WorkingHousehold, id: string): StateRow | undefined => rowOf(wh, addrPrincipal(id));
export const rateRow = (wh: WorkingHousehold, d: Debt): StateRow | undefined => rowOf(wh, addrRate(d));
export const termRow = (wh: WorkingHousehold, id: string): StateRow | undefined => rowOf(wh, addrTerm(id));
