// 住宅ローンの仮の値（0008 の 2026-10-25 の追記）:
// - 住宅ローン控除の条件（debt.housing）が無い住宅ローンに、仮の条件を置く（入居＝借入の年月の名前つきイベント・新築なら省エネ基準適合住宅、
//   中古なら一般の住宅・持分は省略＝主債務者が100%）。画面の側に「仮」の印（assumed）を持ち、印のある間は借入の年月・住まいに合わせて入れ直す
// - 購入の予定とつながる住宅ローン（借入の年月＝購入の月）の借入額を「物件の価格−頭金」の推定にする（印は画面の側。印のある間は入れ直す）
// 値の箱を持たない項目なので、印は WorkingHousehold.assumed に欄のキーで持つ（車の推定と同じ）
import type { Debt, DebtHousing, Household, Residence } from "../../engine/types.ts";
import { addMonths } from "../levers.ts";
import { resolveTimepoint } from "./form.ts";
import { newId, type WorkingHousehold } from "./household.ts";

/** 住宅ローン控除の条件の欄のキー（見せるだけの欄。印の置き場） */
export const creditKey = (debtId: string): string => `housing/debt/${debtId}/credit`;
/** 借入額の欄のキー */
export const principalKey = (debtId: string): string => `housing/debt/${debtId}/principal`;

export const CREDIT_ASSUMED = "仮の条件（入居は借入の年月・新築は省エネ基準適合住宅、中古は一般の住宅・持分は債務者が100%）で住宅ローン控除を計算しています";
export const PRINCIPAL_ESTIMATE = "購入の予定の物件の価格から頭金を引いた額（価格・頭金を直すと入れ直します）";

/**
 * 控除の制度データがある最初の入居の年（平成26年。計算エンジンの tax.housingLoanCredit は、値の無い入居の年を計算しない）。
 * これより前に借りたローンには仮の条件を置かない（置いても控除は入らない）
 */
export const CREDIT_DATA_FROM_YEAR = 2014;

/** 住まいの住宅ローン（住まい以外の不動産のローン debt.property は控除の対象にしない。0028） */
export const isHomeLoan = (d: Debt): boolean => d.kind === "mortgage" && d.property === undefined;

/** 購入の月（購入の年月。省略は住み始め） */
export function purchaseMonth(h: Household, r: Residence): string | null {
  return r.purchase === undefined ? null : resolveTimepoint(h, r.purchase.at ?? r.from);
}

/** 借入の月からこの月数の間に住み始める持ち家も、そのローンの住まいとみなす（借入の翌月に入居するなど） */
const MOVE_IN_WINDOW_MONTHS = 6;

/**
 * そのローンで入居する持ち家: その月に購入する予定の持ち家、なければその月に住んでいる持ち家、なければその月から
 * MOVE_IN_WINDOW_MONTHS か月の間に住み始める持ち家
 */
export function ownAt(h: Household, ym: string): Residence | undefined {
  const own = (h.residences ?? []).filter((r) => r.kind === "own");
  const bought = own.find((r) => purchaseMonth(h, r) === ym);
  if (bought !== undefined) return bought;
  const span = (r: Residence) => ({ from: resolveTimepoint(h, r.from), to: r.to === null ? null : resolveTimepoint(h, r.to) });
  const living = own.find((r) => {
    const { from, to } = span(r);
    return from !== null && from <= ym && (to === null || ym <= to);
  });
  if (living !== undefined) return living;
  const limit = addMonths(ym, MOVE_IN_WINDOW_MONTHS);
  return own.find((r) => {
    const { from } = span(r);
    return from !== null && from > ym && from <= limit;
  });
}

/** 仮の条件（入居のイベントの ID と入居の年月から） */
export function provisionalHousing(h: Household, moveIn: string, ym: string): DebtHousing {
  const r = ownAt(h, ym);
  const built = r?.valuation?.builtYear;
  // 建った年が入居の前の年より前なら中古（既存住宅）。わからなければ新築とみなす
  const newBuild = built === undefined || built >= Number(ym.slice(0, 4)) - 1;
  return {
    ...(r !== undefined ? { residence: r.id } : {}),
    moveIn,
    // 新築は省エネ基準適合住宅（2025年4月からの新築は省エネ基準に適合が要る。それより下の区分は控除が無い）、中古は一般の住宅
    propertyType: newBuild ? "energySaving" : "other",
    newBuild,
    ...(r?.purchase !== undefined ? { acquisitionCost: r.purchase.price } : {}),
  };
}

/** 購入の予定とつながる住宅ローン（借入の年月が購入の月）の、購入の予定と見合う借入額の合計。つながらなければ null */
export function purchaseLink(h: Household, d: Debt): { residence: Residence; expected: number; loans: Debt[] } | null {
  if (!isHomeLoan(d)) return null;
  const ym = resolveTimepoint(h, d.start);
  if (ym === null) return null;
  const r = (h.residences ?? []).find((x) => x.kind === "own" && purchaseMonth(h, x) === ym);
  if (r?.purchase === undefined) return null;
  const loans = (h.debts ?? []).filter((x) => isHomeLoan(x) && resolveTimepoint(h, x.start) === ym);
  return { residence: r, expected: r.purchase.price - (r.purchase.downPayment ?? 0), loans };
}

/** 推定の借入額（購入の予定の価格−頭金から、同じ購入のほかのローンの借入額を引いた額）。0円以下・つながらなければ null */
export function estimatedPrincipal(h: Household, d: Debt): number | null {
  const link = purchaseLink(h, d);
  if (link === null) return null;
  const others = link.loans.filter((x) => x.id !== d.id).reduce((s, x) => s + x.principal, 0);
  const v = link.expected - others;
  return v > 0 ? v : null;
}

/** 購入の予定と借入額の合計が合わないときの知らせ（合っていれば null） */
export function principalMismatch(h: Household, d: Debt): string | null {
  const link = purchaseLink(h, d);
  if (link === null) return null;
  const total = link.loans.reduce((s, x) => s + x.principal, 0);
  if (total === link.expected) return null;
  const man = (v: number) => `${(v / 10000).toLocaleString("ja-JP", { maximumFractionDigits: 4 })}万円`;
  const diff = Math.abs(link.expected - total);
  return `購入の予定の物件の価格−頭金（${man(link.expected)}）と、借入額${link.loans.length > 1 ? "の合計" : ""}（${man(total)}）が${man(diff)}ずれています。${total < link.expected ? "足りない分は預金からも払わず、計算に入りません" : "多い分は購入に使わず、返済だけが計算に入ります"}`;
}

/** 仮の条件を置くローン（平成26年以後に借りたもの） */
function needsCredit(h: Household, d: Debt): boolean {
  const ym = resolveTimepoint(h, d.start);
  return ym !== null && Number(ym.slice(0, 4)) >= CREDIT_DATA_FROM_YEAR;
}

/** 「今の残高から」入れたローン（借りた年が仮なので、控除の仮の条件を置かない。0052） */
export const fromBalance = (wh: WorkingHousehold, id: string): boolean => wh.loanEntry?.[id] === "balance";

/**
 * 仮の値を入れ直した世帯（変わらなければ同じものを返す）:
 * - 住宅ローン控除の条件が無い住まいの住宅ローン（平成26年以後に借りたもの）に仮の条件と入居のイベントを置き、印を付ける
 *   （「今の残高から」入れたローンは借りた年が仮なので置かず、置いてあった仮の条件は外す。0052）
 * - 印のある仮の条件は、借入の年月・住まい（購入の予定・建った年）に合わせて入れ直す（入居のイベントが無くなっていれば作り直す）
 * - 印のある借入額は、購入の予定の価格−頭金に合わせて入れ直す
 * - 外したローンの印を外す
 */
export function withProvisionalHousing(wh: WorkingHousehold, id: () => string = newId): WorkingHousehold {
  const h0 = wh.request.input.household;
  const marked = Object.keys(wh.assumed).some((k) => /^housing\/debt\/[^/]+\/(credit|principal)$/.test(k));
  if (!marked && !(h0.debts ?? []).some((d) => isHomeLoan(d) && d.housing === undefined && needsCredit(h0, d) && !fromBalance(wh, d.id))) return wh;
  const request = structuredClone(wh.request);
  const h = request.input.household;
  const assumed = { ...wh.assumed };
  for (const d of h.debts ?? []) {
    if (!isHomeLoan(d)) continue;
    const ym = resolveTimepoint(h, d.start);
    const key = creditKey(d.id);
    if (fromBalance(wh, d.id)) {
      if (d.housing !== undefined && assumed[key] !== undefined) {
        const ev = d.housing.moveIn;
        delete d.housing;
        delete assumed[key];
        if (!JSON.stringify({ ...h, events: [] }).includes(ev)) h.events = (h.events ?? []).filter((e) => e.id !== ev);
      }
    } else if (ym !== null && d.housing === undefined && needsCredit(h, d)) {
      const ev = { id: id(), kind: "moveIn", at: { at: ym } };
      (h.events ??= []).push(ev);
      d.housing = provisionalHousing(h, ev.id, ym);
      assumed[key] = CREDIT_ASSUMED;
    } else if (ym !== null && d.housing !== undefined && assumed[key] !== undefined) {
      const ev = (h.events ?? []).find((e) => e.id === d.housing?.moveIn);
      if (ev === undefined) (h.events ??= []).push({ id: d.housing.moveIn, kind: "moveIn", at: { at: ym } });
      else ev.at = { at: ym };
      d.housing = provisionalHousing(h, d.housing.moveIn, ym);
    }
    if (assumed[principalKey(d.id)] === PRINCIPAL_ESTIMATE) {
      const p = estimatedPrincipal(h, d);
      if (p !== null) d.principal = p;
    }
  }
  const ids = new Set((h.debts ?? []).map((d) => d.id));
  for (const k of Object.keys(assumed)) {
    const m = /^housing\/debt\/([^/]+)\/(credit|principal)$/.exec(k);
    if (m !== null && !ids.has(m[1] as string)) delete assumed[k];
  }
  if (JSON.stringify(request) === JSON.stringify(wh.request) && JSON.stringify(assumed) === JSON.stringify(wh.assumed)) return wh;
  return { ...wh, request, assumed };
}

/** ローンを外したときに、そのローンの仮の条件のために置いた入居のイベントも外す（ほかから指されていなければ） */
export function dropProvisionalEvent(h: Household, d: Debt, wh: WorkingHousehold): void {
  const ev = d.housing?.moveIn;
  if (ev === undefined || wh.assumed[creditKey(d.id)] === undefined) return;
  const rest = JSON.stringify({ ...h, events: [] });
  if (!rest.includes(ev)) h.events = (h.events ?? []).filter((e) => e.id !== ev);
}

/** 控除の条件を FP が直した世帯: 仮の印を外す（印のある間だけ借入の年月・住まいに合わせて入れ直すので、直した後は入れ直さない） */
export function withoutCreditMark(wh: WorkingHousehold, debtId: string): WorkingHousehold {
  const key = creditKey(debtId);
  if (wh.assumed[key] === undefined) return wh;
  const assumed = { ...wh.assumed };
  delete assumed[key];
  return { ...wh, assumed };
}
