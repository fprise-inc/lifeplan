// 年金額の改定率（平成16年改正法の基準額に掛ける率。年度ごと）。制度データにある年度はその値（生年月日の区分で新規裁定者・既裁定者）、
// 無い年度は前提で延ばす（0007 の7: 改定率の将来の値は持たず、物価・賃金・スライド調整の前提から計算する）。
// 年度 Y の改定は、前の年の物価上昇率と賃金上昇率（名目手取り賃金変動率の近似）による。68歳に達した年度からは既裁定者として
// 物価（賃金が物価より低いときは賃金）、それより前は賃金。マクロ経済スライドの調整率を引き、名目で下がらない（引き切れない分は翌年度以後に
// 繰り越す）。延ばした年度は見出しの notices（N_PARAM_PROJECTED）に出す。
// 報酬比例（厚生年金）は、基礎年金とスライド調整の率が別になりうる（令和8年度は基礎 1.9%・厚生 2.0%）ので、年度ごとの改定の比
// （pension.employee.revisionFactor。その年度の報酬比例の改定の比）で別の系列（employee）を持つ。最初の年度は基礎年金の改定率と同じ値から始め、
// 比の値が無い年度は基礎年金と同じ比で動かす。
// 新規裁定者の改定率（newAward）も持つ: 加給年金額・配偶者の特別加算は、受給者本人の年齢によらず「27条の3・27条の5の適用がないものとした改定率」
// （厚生年金保険法44条2項・昭和60年改正法附則60条2項）を掛ける。制度データにある年度は、その年度に65歳になる生年月日の行、無い年度は賃金で延ばす
import {
  ageMonth,
  defineComponent,
  fiscalYearOf,
  fiscalYearStart,
  rate,
  RATE_ONE,
  type Birth,
  RATE_ZERO,
  yearOf,
  type Ctx,
  type Rate,
} from "../../sdk/index.ts";

const RATE_ID = "pension.revisionRate";
const EXISTING_AGE = "pension.revision.existingFromAge";
const EMP_FACTOR = "pension.employee.revisionFactor";

interface Step {
  readonly idx: Rate;
  readonly slide: Rate;
}

/** 前提による1年度の改定の比。名目で下がらず、引き切れない調整は繰り越す */
function step(ctx: Ctx, s: Step, carry: Rate): { factor: Rate; carry: Rate } {
  const slide = ctx.rate.add(s.slide, carry);
  if (ctx.rate.compare(s.idx, RATE_ZERO) <= 0) return { factor: ctx.rate.add(RATE_ONE, s.idx), carry: slide };
  const adj = ctx.rate.sub(s.idx, slide);
  if (ctx.rate.compare(adj, RATE_ZERO) >= 0) return { factor: ctx.rate.add(RATE_ONE, adj), carry: RATE_ZERO };
  return { factor: RATE_ONE, carry: ctx.rate.sub(RATE_ZERO, adj) };
}

type Row = { fiscalYear: number; rate: string; employee: string; newAward: string; projected: boolean };

/** その年度に新規裁定者（65歳になる年度）である生年月日 */
const newAwardBirth = (fy: number): Birth => ({ birthYearMonth: `${fy - 65}-06`, bornOnFirst: false });

export default defineComponent<{ member: string }, { byFiscalYear: Row[] }>({
  id: "pension.revision",
  title: "年金額の改定率",
  contract: "1.1",
  revision: 2,
  requires: {},
  params: [RATE_ID, EXISTING_AGE, EMP_FACTOR],
  reads: ["assumptions.inflation", "assumptions.wageGrowth", "assumptions.pensionMacroSlide", "assumptions.pensionMacroSlideEmployee"],
  input: "member.input",
  output: "pension.revision.output",
  compute(input, ctx) {
    const { base, end } = ctx.time;
    const member = input.member;
    const firstFy = fiscalYearOf(base) - 3;
    const lastFy = fiscalYearOf(end);
    const existingFrom = fiscalYearOf(ageMonth(ctx, base, EXISTING_AGE, member));
    const out: Row[] = [];
    let prev: Rate | null = null;
    let prevE: Rate | null = null;
    let carry = RATE_ZERO;
    let carryE = RATE_ZERO;
    let prevN: Rate | null = null;
    let carryN = RATE_ZERO;
    let firstProjected: number | null = null;
    let lastKnownRef = "";
    // 制度データの最初の年度より前は、最初の年度の値とみなす（計算基準月より前の年金額の推計のため）
    const known: { fy: number; r: Rate; e: Rate | null; n: Rate }[] = [];
    for (let fy = firstFy; fy <= lastFy; fy++) {
      const at = ctx.at(fiscalYearStart(fy));
      if (at.has(RATE_ID, { member }) && at.param(RATE_ID, { member }).entry.value !== "notApplicable") {
        const sel = at.param(RATE_ID, { member });
        const e = at.has(EMP_FACTOR, { member }) ? at.paramRate(EMP_FACTOR, { member }) : null;
        const birth = newAwardBirth(fy);
        const nsel = at.has(RATE_ID, { birth }) ? at.param(RATE_ID, { birth }) : sel;
        const nv = nsel.entry.value === "notApplicable" ? sel.entry.value : nsel.entry.value;
        known.push({ fy, r: rate(sel.entry.value as string), e, n: rate(nv as string) });
        lastKnownRef = `${RATE_ID}@${sel.entry.rev}`;
      }
    }
    if (known.length === 0) {
      // 値が1つも無いときは延長の仮定のとおり読む（E_PARAM_NO_VALUE で止まる）
      ctx.at(fiscalYearStart(firstFy)).paramRate(RATE_ID, { member });
    }
    const firstKnown = known[0] as { fy: number; r: Rate; n: Rate };
    for (let fy = firstFy; fy <= lastFy; fy++) {
      const k = known.find((x) => x.fy === fy);
      let r: Rate;
      let e: Rate;
      let n: Rate;
      let projected = false;
      if (k !== undefined) {
        r = k.r;
        n = k.n;
        // 報酬比例の系列＝基礎年金の改定率×（報酬比例の改定の比÷基礎年金の改定の比）の累積。比の値が無い年度は基礎年金と同じ動き
        if (prevE === null || prev === null || fy <= firstKnown.fy) e = r;
        else e = k.e === null ? ctx.rate.mul(prevE, ctx.rate.div(r, prev)) : ctx.rate.mul(prevE, k.e);
      } else if (fy < firstKnown.fy) {
        r = firstKnown.r;
        e = r;
        n = firstKnown.n;
      } else {
        projected = true;
        firstProjected ??= fy;
        const y = yearOf(fiscalYearStart(fy)) - 1;
        const p = ctx.assumption("inflation", y, RATE_ZERO);
        const w = ctx.assumption("wageGrowth", y, RATE_ZERO);
        const existing = fy >= existingFrom;
        const idx = existing && ctx.rate.compare(p, w) < 0 ? p : w;
        const slideB = ctx.assumption("pensionMacroSlide", fy, RATE_ZERO);
        const slideE = ctx.assumption("pensionMacroSlideEmployee", fy, slideB);
        const b = step(ctx, { idx, slide: slideB }, carry);
        const em = step(ctx, { idx, slide: slideE }, carryE);
        // 新規裁定者は賃金で改定する
        const nw = step(ctx, { idx: w, slide: slideB }, carryN);
        carry = b.carry;
        carryE = em.carry;
        carryN = nw.carry;
        r = ctx.rate.mul(prev as Rate, b.factor);
        e = ctx.rate.mul(prevE as Rate, em.factor);
        n = ctx.rate.mul(prevN as Rate, nw.factor);
      }
      prev = r;
      prevE = e;
      prevN = n;
      out.push({ fiscalYear: fy, rate: ctx.rate.toString(r), employee: ctx.rate.toString(e), newAward: ctx.rate.toString(n), projected });
    }
    if (firstProjected !== null) ctx.notice("N_PARAM_PROJECTED", [lastKnownRef, String(firstProjected), String(lastFy)]);
    return { byFiscalYear: out };
  },
});
