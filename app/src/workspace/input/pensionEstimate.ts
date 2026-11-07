// 年金のカードの「年金の見込み」（作業の層。0067。計算の結果を読むだけ）: 人ごとに「65歳から 年○万円」（これからの加入を含む）と、
// 受け取り開始を変えていればその時点からの額、夫婦の合計の月額を出す。推計（書類が無い）の人は推定の額、書類からの人は書類の額に
// これからの加入を足した額。
// - 今の水準で見せる: 写しの要求で、賃金上昇率・物価上昇率・マクロ経済スライドを外す（0。定期便の額と同じ物差し）。
//   万一の想定・必要保障額の推移も外す。世帯の物は変えない（求めるのは画面の側の写しの要求）
// - 65歳からの額は、受け取り開始を外した写しの要求で求める（受け取り開始を変えている人がいれば、変えたままの写しの要求も求める）
// - 額は、受け取り開始の年の次の年（今受け取っていれば計算の基準の年の次の年）の、その人の老齢年金の行の合計（加給年金・振替加算・
//   在職中の停止を含む結果の額）。計算の道が無い所（画面の確かめなど）では出さない
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, PensionRecord, PreviewResult } from "../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import type { WorkingHousehold } from "./household.ts";
import { manText, type Summary } from "./items.ts";
import { memberLabel } from "./labels.ts";
import { claimMonth, modeOf, pensionMembers, statementMonthsMissing } from "./stages/pension.ts";

/** 年金の見込みの写しの要求（keepClaims が false なら受け取り開始を外して65歳からにする） */
export function pensionEstimateRequest(req: EngineRequest, keepClaims: boolean): EngineRequest {
  const out = structuredClone(req);
  delete out.input.contingencies;
  delete out.input.protection;
  delete out.input.inheritanceTax;
  const a = out.input.assumptions as Record<string, unknown> | undefined;
  if (a !== undefined) for (const k of ["wageGrowth", "inflation", "pensionMacroSlide", "pensionMacroSlideEmployee"]) delete a[k];
  if (!keepClaims) for (const r of out.input.household.pensionRecords ?? []) delete r.claim;
  out.trace = "none";
  return out;
}

/** 見込みの1行（人ごと） */
export interface PensionLine {
  member: string;
  /** 例: 「65歳から」「基礎70歳・厚生65歳から」「今」 */
  from: string;
  /** 年額（円）。結果に無ければ null */
  annual: number | null;
  /** もう受け取っている（受け取り開始が計算の基準の月より前） */
  receiving: boolean;
}

const year = (ym: string) => Number(ym.slice(0, 4));

/** 結果から、人ごとの老齢年金の年額（受け取り開始の年の次の年）。wh は要求だけを読む（プランの比較の表はプランの要求を渡す） */
export function pensionLines(wh: Pick<WorkingHousehold, "request">, r: PreviewResult | null, keepClaims: boolean): PensionLine[] {
  const req = wh.request.input;
  const h = req.household;
  const base = req.baseMonth;
  const out: PensionLine[] = [];
  for (const m of pensionMembers(h)) {
    const rec = (h.pensionRecords ?? []).find((x) => x.member === m.id);
    const std = claimMonth(m, 65);
    const claimOf = (part: "basic" | "employee") => (keepClaims ? (resolveTimepoint(h, rec?.claim?.[part] ?? null) ?? std) : std);
    const b = claimOf("basic");
    const e = claimOf("employee");
    const last = b > e ? b : e;
    const receiving = last <= base;
    const y = Math.max(year(last), year(base)) + 1;
    // 受け取り開始の月（その年齢に達した月の翌月）→「65歳」「66歳3か月」
    const age = (ym: string) => {
      const reach = addMonths(ym, -1);
      const yrs = ageAt(m, reach);
      const [ry, rm] = ageReachedMonth(m, yrs).split("-").map(Number) as [number, number];
      const mo = (year(reach) - ry) * 12 + (Number(reach.slice(5, 7)) - rm);
      return mo === 0 ? `${String(yrs)}歳` : `${String(yrs)}歳${String(mo)}か月`;
    };
    const from = receiving ? "今" : b === e ? `${age(b)}から` : `基礎${age(b)}・厚生${age(e)}から`;
    let annual: number | null = null;
    if (r !== null && y <= (req.endYear ?? 9999)) {
      annual = 0;
      for (const c of r.table) if (c.row === "cf.income.pension" && c.member === m.id && c.object === undefined && c.year === y) annual += c.amount;
    }
    out.push({ member: m.id, from, annual, receiving });
  }
  return out;
}

/** 年金の見込みの計算（65歳からの写しと、受け取り開始を変えている人がいれば変えたままの写し）。計算の道が無ければ null のまま */
export function usePensionEstimate(
  wh: WorkingHousehold,
  active: boolean,
  computeOne: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined,
): { std: PreviewResult | null; claimed: PreviewResult | null } {
  const anyClaim = (wh.request.input.household.pensionRecords ?? []).some((r) => r.claim !== undefined);
  const reqs = useMemo(
    () => (active && computeOne !== undefined ? { std: pensionEstimateRequest(wh.request, false), claimed: anyClaim ? pensionEstimateRequest(wh.request, true) : null } : null),
    [active, computeOne, wh.request, anyClaim],
  );
  const [res, setRes] = useState<{ std: PreviewResult | null; claimed: PreviewResult | null }>({ std: null, claimed: null });
  useEffect(() => {
    if (reqs === null || computeOne === undefined) return;
    let alive = true;
    void Promise.all([computeOne(reqs.std), reqs.claimed === null ? Promise.resolve(null) : computeOne(reqs.claimed)]).then(
      ([std, claimed]) => alive && setRes({ std, claimed }),
      () => alive && setRes({ std: null, claimed: null }),
    );
    return () => {
      alive = false;
    };
  }, [reqs, computeOne]);
  // 計算し直している間は、前の結果を見せておく（数字が消えてちらつかないように）
  return reqs === null ? { std: null, claimed: null } : res;
}

/** 円を「年170万円（月14.2万円）」に */
export const annualText = (v: number): string => `年${manText(v)}万円（月${manText(Math.round(v / 12))}万円）`;

/** カードの要約（夫婦の合計の月額。65歳から・推定）。加入月数が0か月のままの人がいれば出さない（カードの要約は「加入月数が未入力」） */
export function pensionEstimateSummary(wh: WorkingHousehold, r: PreviewResult | null): Summary | null {
  if (r === null) return null;
  const h = wh.request.input.household;
  if ((h.pensionRecords ?? []).some(statementMonthsMissing)) return null;
  const lines = pensionLines(wh, r, false).filter((l) => l.annual !== null);
  if (lines.length === 0) return null;
  const total = lines.reduce((s, l) => s + (l.annual ?? 0), 0);
  const all = lines.every((l) => l.receiving);
  // 「推定」は推計（書類が無い）の人がいるときだけ（書類から入れた人だけなら付けない）
  const est = anyEstimated(wh, lines) ? "・推定" : "";
  return { pre: lines.length > 1 ? "夫婦で月" : "月", main: manText(Math.round(total / 12)), unit: all ? `万円（今${est}）` : `万円（65歳から${est}）` };
}

/** 推計（書類が無い）の人が見込みの行にいるか */
function anyEstimated(wh: Pick<WorkingHousehold, "request">, lines: readonly PensionLine[]): boolean {
  const recs = wh.request.input.household.pensionRecords ?? [];
  return lines.some((l) => modeOf(recs.find((x) => x.member === l.member)) === "");
}

/**
 * 書類の額（見込額・今の年額。老齢基礎・老齢厚生・経過的加算の合計）。加入月数から計算する50歳未満の定期便と、額を入れていない記録は null
 * （見込みとの差を「これからの加入・加給年金など」として見せる。0141）
 */
export function documentAmount(rec: PensionRecord | undefined): number | null {
  if (rec === undefined || !(rec.kind === "statementOver50" || rec.kind === "projection" || rec.kind === "receiving")) return null;
  const a = rec.amounts;
  const sum = (a?.basic?.value ?? 0) + (a?.employee?.value ?? 0) + (a?.transitional?.value ?? 0);
  return sum > 0 ? sum : null;
}

/** パネルの「年金の見込み」の行（人ごとの文と、夫婦の合計の文） */
export function estimateView(wh: WorkingHousehold, est: { std: PreviewResult | null; claimed: PreviewResult | null }): { people: { member: string; who: string; text: string; breakdown: string | null; sub: string[] }[]; total: string | null } | null {
  if (est.std === null) return null;
  const h = wh.request.input.household;
  const std = pensionLines(wh, est.std, false);
  const claimed = est.claimed === null ? null : pensionLines(wh, est.claimed, true);
  const people = std.map((l) => {
    const rec = (h.pensionRecords ?? []).find((x) => x.member === l.member);
    const mode = modeOf(rec);
    const c = claimed?.find((x) => x.member === l.member);
    const sub: string[] = [];
    // 受け取り開始を変えている人は、見込みの行を受け取り開始からの額にし、65歳からの額は「?」の中に
    const moved = c !== undefined && rec?.claim !== undefined && c.from !== l.from && c.annual !== null;
    if (moved && l.annual !== null) sub.push(`65歳から受け取った場合 ${annualText(l.annual)}`);
    if (statementMonthsMissing(rec)) sub.push("加入月数が0か月のままなので、少なく（50歳以上の定期便は0円で）出ています");
    // 書類からの人は、書類の額と、見込みとの差（これからの加入・加給年金・振替加算など）の内訳。見込みの行のすぐ下に出す（「?」の中に
    // しまうと、書類の額と見込みの差に気づいても理由が見えない。通しの確かめ。0150）
    const doc = documentAmount(rec);
    const breakdown = doc !== null && l.annual !== null && !moved && l.annual !== doc ? `内訳: 書類の額 年${manText(doc)}万円＋これからの加入・加給年金など ${l.annual - doc >= 0 ? "" : "▲"}年${manText(Math.abs(l.annual - doc))}万円` : null;
    sub.push(mode === "" ? "推定（書類が無いので、働き方の期間から推計した額）。定期便があれば「書類の額で置き換える」で写せます" : mode === "history" ? "加入歴に、これからの加入（働き方の期間）を足した額" : rec?.kind === "receiving" ? "改定通知書の額に、加給年金・振替加算・これからの加入を足した額" : "書類の額に、これからの加入（働き方の期間）と加給年金を足した額");
    const shown = moved ? (c as PensionLine) : l;
    const mark = mode === "" ? "（推定）" : "";
    return { member: l.member, who: memberLabel(wh, l.member), text: shown.annual === null ? "計算の期間の外です" : `${shown.from} ${annualText(shown.annual)}${mark}`, breakdown, sub };
  });
  const sum = std.filter((l) => l.annual !== null);
  const estMark = anyEstimated(wh, sum) ? "・推定" : "";
  const total = sum.length > 1 ? `夫婦で月${manText(Math.round(sum.reduce((s, l) => s + (l.annual ?? 0), 0) / 12))}万円（${sum.every((l) => l.receiving) ? "今" : "65歳から"}${estMark}）` : null;
  return { people, total };
}

/** プランの比較の表の年金の行の1列（そのプランの要求の写しから。月額は世帯の合計・今の水準） */
export interface PlanPension {
  /** 65歳からの月額（受け取り開始を外した写し）。結果に無ければ null */
  std: number | null;
  /** 受け取り開始からの月額（受け取り開始を変えたままの写し。変えた人がいないプランは std と同じ）。結果に無ければ null */
  claimed: number | null;
  /** 全員もう受け取っている */
  receiving: boolean;
  /** 受け取り開始を変えた人がいる */
  anyClaim: boolean;
}

/** 写しの結果から、世帯の合計の月額（年額の合計÷12。年額が出ない人は数えない。誰も出なければ null） */
function monthlyOf(lines: readonly PensionLine[]): number | null {
  const got = lines.filter((l) => l.annual !== null);
  return got.length === 0 ? null : Math.round(got.reduce((s, l) => s + (l.annual ?? 0), 0) / 12);
}

/**
 * プランの比較の表の年金の見込み（0075）: 帯のプランごとに、年金のカードの「年金の見込み」と同じ写しの要求（今の水準・65歳から、と、
 * 受け取り開始を変えたまま）で求める。比較の表を開いている間だけ。計算の道が無ければ null のまま
 */
export function usePlanPensions(reqs: readonly EngineRequest[] | null, computeOne: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined): (PlanPension | null)[] | null {
  const jobs = useMemo(
    () =>
      reqs === null || computeOne === undefined
        ? null
        : reqs.map((req) => {
            const anyClaim = (req.input.household.pensionRecords ?? []).some((r) => r.claim !== undefined);
            return { req, anyClaim, std: pensionEstimateRequest(req, false), claimed: anyClaim ? pensionEstimateRequest(req, true) : null };
          }),
    [reqs, computeOne],
  );
  const [res, setRes] = useState<PlanPension[] | null>(null);
  useEffect(() => {
    if (jobs === null || computeOne === undefined) return;
    let alive = true;
    void Promise.all(
      jobs.map(async (j): Promise<PlanPension> => {
        const std = await computeOne(j.std);
        if (std === null) return { std: null, claimed: null, receiving: false, anyClaim: j.anyClaim };
        const claimed = j.claimed === null ? null : await computeOne(j.claimed);
        const sl = pensionLines({ request: j.req }, std, false);
        const cl = j.claimed === null ? sl : claimed === null ? null : pensionLines({ request: j.req }, claimed, true);
        return { std: monthlyOf(sl), claimed: cl === null ? null : monthlyOf(cl), receiving: sl.length > 0 && sl.every((l) => l.receiving), anyClaim: j.anyClaim };
      }),
    ).then(
      (out) => alive && setRes(out),
      () => alive && setRes(null),
    );
    return () => {
      alive = false;
    };
  }, [jobs, computeOne]);
  // 求めている間（列の数が変わった直後を含む）は、その列を null にする
  return jobs === null ? null : res !== null && res.length === jobs.length ? res : jobs.map(() => null);
}
