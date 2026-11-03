// 住宅ローンの仮の値（0008 の 2026-10-25 の追記）:
// - 住宅ローン控除の条件（debt.housing）が無い住宅ローンに、仮の条件を置く（入居＝借入の年月の名前つきイベント・新築なら省エネ基準適合住宅、
//   中古なら一般の住宅・持分は省略＝主債務者が100%）。画面の側に「仮」の印（assumed）を持ち、印のある間は借入の年月・住まいに合わせて入れ直す
// - 購入の予定とつながる住宅ローン（借入の年月＝購入の月）の借入額を「物件の価格−頭金」の推定にする（印は画面の側。印のある間は入れ直す）
// 値の箱を持たない項目なので、印は WorkingHousehold.assumed に欄のキーで持つ（車の推定と同じ）
import type { Debt, DebtHousing, Household, Residence } from "../../engine/types.ts";
import { addMonths } from "../levers.ts";
import { resolveTimepoint } from "./form.ts";
import { newId, type WorkingHousehold } from "./household.ts";
import { buildingPriceOf, customOfLandLoan, isCustomBuild, landLoanCreditable, landLoansOf, landMonthOf } from "./customBuild.ts";

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
  // 注文住宅の土地の決済の月に借りるローン（土地先行融資。0115）は、その注文住宅の住まい
  const landed = own.find((r) => isCustomBuild(r) && landMonthOf(h, r) === ym);
  if (landed !== undefined) return landed;
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

/**
 * 仮の条件（入居のイベントの ID と借入の年月から）。注文住宅（0115）の取得対価は、土地の分のローン（土地先行融資）があれば
 * 土地の分のローンは土地の代金、引き渡しのローンは建物の代金（ローンごとに止めるため）、無ければ合計。土地の分のローンは、土地の決済から
 * 引き渡しまで2年を超えると控除の対象にしない（家屋の新築の日前2年以内に取得した敷地の借入金。国税庁 タックスアンサー No.1211-1）
 */
export function provisionalHousing(h: Household, moveIn: string, ym: string): DebtHousing {
  const r = ownAt(h, ym);
  const built = r?.valuation?.builtYear;
  // 住宅の購入の種類（新築か中古か）があればそれ（0052 の追記 2026-11-03）。無ければ、建った年が入居の前の年より前なら中古（既存住宅）。
  // わからなければ新築とみなす
  const newBuild = r?.purchase?.newBuild ?? (built === undefined || built >= Number(ym.slice(0, 4)) - 1);
  return {
    ...(r !== undefined ? { residence: r.id } : {}),
    moveIn,
    // 新築は省エネ基準適合住宅（2025年4月からの新築は省エネ基準に適合が要る。それより下の区分は控除が無い）、中古は一般の住宅
    propertyType: newBuild ? "energySaving" : "other",
    newBuild,
    ...(r?.purchase !== undefined ? { acquisitionCost: acquisitionOf(h, r, ym) } : {}),
    ...(r !== undefined && isCustomBuild(r) && landMonthOf(h, r) === ym && purchaseMonth(h, r) !== ym && !landLoanCreditable(h, r) ? { creditDisabled: true } : {}),
  };
}

/** 取得対価（購入の価格。注文住宅を土地と建物で分けて借りるなら、そのローンの分の代金） */
function acquisitionOf(h: Household, r: Residence, ym: string): number {
  const p = r.purchase as NonNullable<Residence["purchase"]>;
  if (!isCustomBuild(r) || landLoansOf(h, r).length === 0) return p.price;
  return landMonthOf(h, r) === ym ? (p.land?.price ?? 0) : buildingPriceOf(r);
}

/** 仮の条件の入居の年月: 土地の分のローン（土地先行融資）は注文住宅の住み始め、ほかは借入の年月 */
function moveInMonth(h: Household, d: Debt, ym: string): string {
  const r = customOfLandLoan(h, d);
  return (r === undefined ? null : resolveTimepoint(h, r.from)) ?? ym;
}

/** 購入の予定とつながる住宅ローン（借入の年月が購入の月）の、購入の予定と見合う借入額の合計。つながらなければ null */
export function purchaseLink(h: Household, d: Debt): { residence: Residence; expected: number; loans: Debt[]; land: boolean } | null {
  if (!isHomeLoan(d)) return null;
  const ym = resolveTimepoint(h, d.start);
  if (ym === null) return null;
  // 注文住宅（0115）は、土地の決済の月に借りるローン（土地先行融資）もつながる
  const r = (h.residences ?? []).find((x) => x.kind === "own" && purchaseMonth(h, x) === ym) ?? customOfLandLoan(h, d);
  if (r?.purchase === undefined) return null;
  const months = [purchaseMonth(h, r), ...(isCustomBuild(r) ? [landMonthOf(h, r)] : [])];
  const loans = (h.debts ?? []).filter((x) => isHomeLoan(x) && months.includes(resolveTimepoint(h, x.start)));
  return { residence: r, expected: r.purchase.price - (r.purchase.downPayment ?? 0), loans, land: purchaseMonth(h, r) !== ym };
}

/**
 * そのローンでつながる住宅の購入（控除の条件の住まいが購入の予定の家か、借入の年月が購入の月）。つながらなければ undefined。
 * 購入の種類で新築か中古かを選んだ購入とつながるローンは、控除の「新築か中古か」を購入の種類から読む（0052 の追記 2026-11-03）
 */
export function purchaseOfLoan(h: Household, d: Debt): Residence | undefined {
  if (!isHomeLoan(d)) return undefined;
  const byId = (h.residences ?? []).find((r) => r.id === d.housing?.residence && r.kind === "own" && r.purchase !== undefined);
  return byId ?? purchaseLink(h, d)?.residence;
}

/** 購入の種類から控除の新築か中古かを読むローンか（つながる購入で新築か中古かを選んである） */
export const newBuildFromPurchase = (h: Household, d: Debt): boolean => purchaseOfLoan(h, d)?.purchase?.newBuild !== undefined;

/** 購入の種類の新築か中古かと、控除の条件の新築か中古かが食い違うローンがあるか */
const newBuildOff = (h: Household): boolean =>
  (h.debts ?? []).some((d) => {
    const nb = purchaseOfLoan(h, d)?.purchase?.newBuild;
    return d.housing !== undefined && nb !== undefined && d.housing.newBuild !== nb;
  });

/** 推定の借入額（購入の予定の価格−頭金から、同じ購入のほかのローンの借入額を引いた額）。0円以下・つながらなければ null */
export function estimatedPrincipal(h: Household, d: Debt): number | null {
  const link = purchaseLink(h, d);
  if (link === null) return null;
  // 土地の分のローン（土地先行融資。0115）は、土地の代金−土地の決済で払う頭金
  const land = link.residence.purchase?.land;
  if (link.land && land !== undefined) {
    const v = land.price - (land.downPayment ?? 0);
    return v > 0 ? v : null;
  }
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

/** これから借りるローン（借入の年月が計算の基準の月より後。今の残高は無いので、入れ方の「今の残高から」と残高の欄を出さない。0052 の追記 2026-11-02） */
export function startsLater(wh: WorkingHousehold, id: string): boolean {
  const h = wh.request.input.household;
  const d = (h.debts ?? []).find((x) => x.id === id);
  const start = d === undefined ? null : resolveTimepoint(h, d.start);
  return start !== null && start > wh.request.input.baseMonth;
}

/**
 * 「今の残高から」入れたローン（借りた年が仮なので、控除の仮の条件を置かない。0052）。これから借りるローンは、入れ方が「今の残高から」の
 * ままでも「借入額から」として読む（借入の年月を今より前に直すと、また「今の残高から」になる。0052 の追記 2026-11-02）
 */
export const fromBalance = (wh: WorkingHousehold, id: string): boolean => wh.loanEntry?.[id] === "balance" && !startsLater(wh, id);

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
  if (!marked && !newBuildOff(h0) && !(h0.debts ?? []).some((d) => isHomeLoan(d) && d.housing === undefined && needsCredit(h0, d) && !fromBalance(wh, d.id))) return wh;
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
      const ev = { id: id(), kind: "moveIn", at: { at: moveInMonth(h, d, ym) } };
      (h.events ??= []).push(ev);
      d.housing = provisionalHousing(h, ev.id, ym);
      assumed[key] = CREDIT_ASSUMED;
    } else if (ym !== null && d.housing !== undefined && assumed[key] !== undefined) {
      const ev = (h.events ?? []).find((e) => e.id === d.housing?.moveIn);
      const mv = moveInMonth(h, d, ym);
      if (ev === undefined) (h.events ??= []).push({ id: d.housing.moveIn, kind: "moveIn", at: { at: mv } });
      else ev.at = { at: mv };
      d.housing = provisionalHousing(h, d.housing.moveIn, ym);
    }
    // 購入の種類で新築か中古かを選んだ購入とつながるローンは、控除の条件の新築か中古かを種類に合わせる（FP が確定にした条件でも。欄は出さない）
    const nb = purchaseOfLoan(h, d)?.purchase?.newBuild;
    if (d.housing !== undefined && nb !== undefined && d.housing.newBuild !== nb) d.housing = { ...d.housing, newBuild: nb };
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
