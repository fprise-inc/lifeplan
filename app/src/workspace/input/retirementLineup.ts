// 退職金・企業年金のカードの下の「受け取りの並び」（作業の層。0057）: 人ごとに、退職給付（このカード）と iDeCo・企業型DC・小規模企業共済
// （貯蓄・運用の口座。読むだけ）の受け取りを時期の順に並べ、退職所得控除の重なりの決まり（前の一時金から何年空けるか）を知らせる。
// - 時期と額は入力から。入力に額の無い物（公務員の退職手当の見込みの計算・DB の年金の年額の既定など）と税は、計算の結果から読む
//   （結果が無いときは、税の列を出さない）
// - 決まりの年数は制度データの写し（hearing/src/statistics.generated.ts）から読み、ここに数を書かない
import { useEffect, useMemo, useState } from "preact/hooks";
import type { Account, EngineRequest, Household, PreviewResult, RetirementBenefit } from "../../engine/types.ts";
import { regulationValue } from "../../../../hearing/src/statistics.ts";
import { addMonths, ageReachedMonth } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import type { WorkingHousehold } from "./household.ts";
import { ACCOUNT_KINDS } from "./labels.ts";
import { ANNUITY_ONLY, KIND_SHORT, LUMP_ONLY, periodOf } from "./retirementBenefits.ts";
import { defaultPayoutAge } from "./savings/model.ts";

/** 受け取りの並びの1行 */
export interface LineupRow {
  /** 並べる鍵（年月。年金は始まり） */
  ym: string;
  /** 例: 「2031年4月」「2031年4月から10年」 */
  when: string;
  /** 例: 「退職一時金」「iDeCo の一時金」 */
  what: string;
  /** 例: 「1,800万円」「年120万円」「見込みの計算」 */
  amount: string;
  /** 一時金の退職所得の税（所得税と住民税。結果があるときだけ） */
  tax: string | null;
  /** どのカードで直すか（貯蓄・運用の口座は「貯蓄・運用」） */
  from: "retirement" | "savings";
  /** 退職所得になる一時金か（決まりの知らせの元） */
  lump: { year: number; dc: boolean } | null;
}

export interface Lineup {
  member: string;
  rows: LineupRow[];
  /** 退職所得控除の重なりの決まりの知らせ */
  notes: string[];
}

const man = (v: number): string => `${Math.round(v / 10000).toLocaleString("ja-JP")}万円`;
const ymText = (ym: string): string => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;
const LUMP_ROWS = (row: string) => row.startsWith("cf.income.lumpSum.");
const ANNUITY_ROWS = (row: string) => row.startsWith("cf.income.corporatePension.");
const TAX_ROWS = new Set(["cf.taxSi.incomeTax.retirement", "cf.taxSi.residentTax.retirement"]);

/** 結果の表から、物の行の合計（年ごと） */
function byYear(r: PreviewResult | null, object: string, pick: (row: string) => boolean): Map<number, number> {
  const out = new Map<number, number>();
  for (const c of r?.table ?? []) if (c.object === object && pick(c.row)) out.set(c.year, (out.get(c.year) ?? 0) + c.amount);
  return out;
}

/** 一時金の税（その物の、受け取った年の所得税と住民税） */
function taxOf(r: PreviewResult | null, object: string): number | null {
  if (r === null) return null;
  let t = 0;
  for (const c of r.table) if (c.object === object && TAX_ROWS.has(c.row)) t += c.amount;
  return t;
}

/** 退職給付の支給の月（入れた月か、勤続期間の終わりの翌月） */
function paidMonth(h: Household, b: RetirementBenefit): string | null {
  const given = resolveTimepoint(h, b.paidAt ?? null);
  if (given !== null) return given;
  const m = h.members.find((x) => x.id === b.member);
  const to = resolveTimepoint(h, b.service?.to ?? periodOf(h, b)?.to ?? null) ?? (m === undefined ? null : addMonths(ageReachedMonth(m, 60), -1));
  return to === null ? null : addMonths(to, 1);
}

function benefitRows(h: Household, b: RetirementBenefit, r: PreviewResult | null): LineupRow[] {
  const out: LineupRow[] = [];
  const paid = paidMonth(h, b);
  const name = b.label ?? KIND_SHORT[b.kind] ?? "退職給付";
  const method = ANNUITY_ONLY.has(b.kind) ? "annuity" : LUMP_ONLY.has(b.kind) ? "lumpSum" : (b.receipt?.method ?? "lumpSum");
  if (method !== "annuity" && paid !== null) {
    const fromResult = byYear(r, b.id, LUMP_ROWS).get(Number(paid.slice(0, 4)));
    const share = method === "mixed" ? Number(b.receipt?.lumpShare ?? "0") : 1;
    const input = typeof b.amount?.value === "number" && b.amount.state !== "notApplicable" ? Math.round(b.amount.value * share) : null;
    const v = fromResult ?? input;
    const tax = taxOf(r, b.id);
    out.push({
      ym: paid,
      when: ymText(paid),
      what: method === "mixed" ? `${name}（一時金の分）` : name,
      amount: v !== null ? `${man(v)}${b.amount?.state === "estimated" ? "（推定）" : ""}` : b.amount === undefined && (b.kind === "civilServantAllowance" || b.kind === "officerAllowance") ? "見込みの計算" : "未入力",
      tax: tax === null ? null : tax > 0 ? man(tax) : "0円",
      from: "retirement",
      lump: { year: Number(paid.slice(0, 4)), dc: false },
    });
  }
  if (method !== "lumpSum") {
    const start = resolveTimepoint(h, b.receipt?.start ?? null) ?? paid;
    if (start !== null) {
      const years = b.receipt?.years;
      const annual = b.receipt?.annualAmount ?? [...byYear(r, b.id, ANNUITY_ROWS).entries()].find(([y]) => y > Number(start.slice(0, 4)))?.[1] ?? null;
      out.push({
        ym: start,
        when: `${ymText(start)}から${years === null || years === undefined ? "終身" : `${years}年`}`,
        what: method === "mixed" ? `${name}（年金の分）` : name,
        amount: annual !== null ? `年${man(annual)}` : "未入力（0円で計算中）",
        tax: null,
        from: "retirement",
        lump: null,
      });
    }
  }
  return out;
}

const DC_KINDS = new Set(["ideco", "corporateDc"]);

function accountRows(wh: WorkingHousehold, a: Account, r: PreviewResult | null): LineupRow[] {
  const h = wh.request.input.household;
  const owner = h.members.find((x) => x.id === a.owner);
  if (owner === undefined) return [];
  const label = a.kind === "ideco" ? "iDeCo" : a.kind === "corporateDc" ? "企業型DC" : (ACCOUNT_KINDS.find((o) => o.value === a.kind)?.label ?? a.kind);
  const lumps = byYear(r, a.id, LUMP_ROWS);
  const tax = taxOf(r, a.id);
  if (DC_KINDS.has(a.kind)) {
    const start = resolveTimepoint(h, a.payout?.start ?? null) ?? ageReachedMonth(owner, defaultPayoutAge(wh.request, a));
    const method = a.payout?.method ?? "lumpSum";
    const out: LineupRow[] = [];
    if (method !== "annuity") {
      const v = lumps.get(Number(start.slice(0, 4))) ?? [...lumps.values()][0] ?? null;
      out.push({ ym: start, when: ymText(start), what: `${label}の一時金`, amount: v !== null ? man(v) : "（貯蓄・運用の残高から）", tax: tax === null ? null : tax > 0 ? man(tax) : "0円", from: "savings", lump: { year: Number(start.slice(0, 4)), dc: true } });
    }
    if (method !== "lumpSum") out.push({ ym: start, when: `${ymText(start)}から`, what: `${label}の年金`, amount: "（貯蓄・運用の残高から）", tax: null, from: "savings", lump: null });
    return out;
  }
  // 小規模企業共済: 結果の受け取りの年（共済金は退職所得。退職手当等と同じ決まり）
  const first = [...lumps.entries()].sort((x, y) => x[0] - y[0])[0];
  if (first === undefined) return [];
  return [{ ym: `${first[0]}-01`, when: `${first[0]}年`, what: `${label}の共済金`, amount: man(first[1]), tax: tax === null ? null : tax > 0 ? man(tax) : "0円", from: "savings", lump: { year: first[0], dc: false } }];
}

/** 制度データの年数（その年の1月1日の値） */
const yearsAt = (id: string, year: number, fallback: number): number => {
  const v = regulationValue(id, `${year}-01-01`);
  return typeof v === "number" ? v : fallback;
};

/** 退職所得控除の重なりの決まりの知らせ（前の一時金から何年空けるか。所得税法施行令70条1項2号） */
export function overlapNotes(rows: readonly LineupRow[]): string[] {
  const lumps = rows.filter((x) => x.lump !== null).sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));
  const notes: string[] = [];
  for (let i = 1; i < lumps.length; i++) {
    const a = lumps[i - 1] as LineupRow;
    const b = lumps[i] as LineupRow;
    const ya = a.lump!.year;
    const yb = b.lump!.year;
    const gap = yb - ya;
    if (gap === 0) {
      notes.push(`${a.what}と${b.what}は同じ年（${yb}年）です。勤続期間を合わせて、退職所得控除を1回で計算します（重なる期間は1回だけ数えます）`);
      continue;
    }
    if (b.lump!.dc) {
      // DC の一時金を受ける年は、前の退職手当等を前年以前19年内で見る
      const lb = yearsAt("incomeTax.retirementIncome.overlap.lookbackYearsForDc", yb, 19);
      if (gap <= lb) notes.push(`${a.what}（${ya}年）の${gap}年後に${b.what}（${yb}年）: DC の一時金は、前の退職金から${lb + 1}年空けないと、勤続の重なる分の控除が引かれます`);
      continue;
    }
    if (a.lump!.dc) {
      // 前に DC の一時金を受けたときは前年以前9年内（令和8年以後に受けた一時金。前の年と今の年の値の小さい方）
      const lb = Math.min(yearsAt("incomeTax.retirementIncome.overlap.lookbackYearsAfterDc", ya, 4), yearsAt("incomeTax.retirementIncome.overlap.lookbackYearsAfterDc", yb, 4));
      if (gap <= lb) notes.push(`${a.what}（${ya}年）の${gap}年後に${b.what}（${yb}年）: ${lb > 4 ? "2026年以後は、" : ""}DC の一時金の後は${lb + 1}年空けないと、勤続の重なる分の控除が引かれます`);
      continue;
    }
    const lb = yearsAt("incomeTax.retirementIncome.overlap.lookbackYears", yb, 4);
    if (gap <= lb) notes.push(`${a.what}（${ya}年）の${gap}年後に${b.what}（${yb}年）: 前の退職金から${lb + 1}年空けないと、勤続の重なる分の控除が引かれます`);
  }
  return notes;
}

/** 人ごとの受け取りの並び（退職給付・DC・小規模企業共済のどれかがある人だけ） */
export function lineups(wh: WorkingHousehold, r: PreviewResult | null): Lineup[] {
  const h = wh.request.input.household;
  const out: Lineup[] = [];
  for (const m of h.members) {
    const rows = [
      ...(h.retirementBenefits ?? []).filter((b) => b.member === m.id).flatMap((b) => benefitRows(h, b, r)),
      ...(h.accounts ?? []).filter((a) => a.owner === m.id && (DC_KINDS.has(a.kind) || a.kind === "smallBusinessMutualAid")).flatMap((a) => accountRows(wh, a, r)),
    ].sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));
    if (rows.length === 0) continue;
    out.push({ member: m.id, rows, notes: overlapNotes(rows) });
  }
  return out;
}

/** 受け取りの並びのための計算の要求（今の世帯の写し。万一の想定・必要保障額の推移は外す） */
export function lineupRequest(req: EngineRequest): EngineRequest {
  const out = structuredClone(req);
  delete out.input.contingencies;
  delete out.input.protection;
  out.trace = "none";
  return out;
}

/** 受け取りの並びの計算（今の世帯が変わったら計算し直す）。計算の道が無ければ null のまま */
export function useLineupResult(wh: WorkingHousehold, active: boolean, computeOne: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined): PreviewResult | null {
  const req = useMemo(() => (active && computeOne !== undefined ? lineupRequest(wh.request) : null), [active, computeOne, wh.request]);
  const [res, setRes] = useState<PreviewResult | null>(null);
  useEffect(() => {
    if (req === null || computeOne === undefined) return;
    let alive = true;
    void computeOne(req).then(
      (r) => alive && setRes(r),
      () => alive && setRes(null),
    );
    return () => {
      alive = false;
    };
  }, [req, computeOne]);
  return req === null ? null : res;
}
