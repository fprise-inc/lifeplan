// iDeCo・企業型DC の受け取りの始まりの月と方法（構成員ごと）。運用利回りに依らないので、受け取りの残高を計算する account.ideco と分けた
// （利回りを変えても、受け取りの無い年の税の部品は account.ideco を読まない。0006 の追記: 判定だけを返す小さな部品）。
// - 受け取りを始められる月: 60歳の時点の通算加入者等期間（enrolledSince から60歳の前の月まで。省略は最初の掛金の月）で決まる年齢
//   （10年以上なら60歳、1か月以上なら65歳）。60歳以後に加入したときは加入から5年後。withdrawalLockedUntil があればその翌月より前には受け取らない
// - 始まり: payout.start（受け取りを始められる月より前ならその月）。75歳までに始める。payout・start が空なら、計算の前に退職の年
//   （60〜65歳に収める）の一時金を入れる（0026。engine/investment.ts）
// - 改訂2（0164）: 併用（mixed）の一時金の割合（lumpShare）の省略を半分にする（画面の空欄と同じ。0050）。前は0（全額を年金）だった
// - 約束 1.1・改訂3（0003 の追記 2026-11-15）: 計算基準月より前に掛金を払っていたとみなす期間（serviceBeforeBase）を返す。一時金の退職所得の
//   勤続年数（所得税法施行令69条1項2号。掛金を納付した加入者期間）に使う（retirement.receipts）。入れた積立（掛金）の期間を正とし、最初の積立より前は
//   加入の始まり（enrolledSince）から払っていたとみなす。計算基準月より前の積立が無ければ、加入の始まり〜計算基準月の前の月。
//   加入の始まりも計算基準月より前の積立も無いときは serviceKnown を false にする（期間は計算基準月から数える）
import { addMonths, bracketFor, defineComponent, formatYm, parseYm, yen, type AccountInput, type MonthIndex } from "../../sdk/index.ts";

const P = { earliest: "ideco.payout.earliestAge", byMonths: "ideco.payout.startAgeByMonths", latest: "ideco.payout.latestAge" };
/** 60歳以後に加入したときに受け取りを始められるまでの月数（加入から5年） */
const LATE_ENTRY_MONTHS = 60;

export interface IdecoPayoutPlan {
  readonly object: string;
  readonly kind: "ideco" | "corporateDc";
  readonly start: string;
  readonly method: "lumpSum" | "annuity" | "mixed";
  /** 年金で受け取る回数（年1回。一時金だけなら0） */
  readonly annuityYears: number;
  readonly lumpShare: string | null;
  /** 60歳の前の月までの通算加入者等期間の月数 */
  readonly enrolledMonths: number;
  /** 計算基準月より前に掛金を払っていたとみなす期間（年月の範囲。両端を含む。月の昇順で重ならない） */
  readonly serviceBeforeBase: readonly { readonly from: string; readonly to: string }[];
  /** 加入の始まりか、計算基準月より前の積立が入っているか */
  readonly serviceKnown: boolean;
}

/** 月の範囲（両端を含む）を並べ、重なり・隣り合いをつなぐ */
function mergeRanges(xs: readonly (readonly [MonthIndex, MonthIndex])[]): [MonthIndex, MonthIndex][] {
  const out: [MonthIndex, MonthIndex][] = [];
  for (const [a, b] of [...xs].filter(([a, b]) => a <= b).sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last !== undefined && a <= last[1] + 1) {
      if (b > last[1]) last[1] = b;
    } else out.push([a, b]);
  }
  return out;
}

export default defineComponent<{ member: string }, { accounts: IdecoPayoutPlan[] }>({
  id: "account.idecoPayout",
  title: "iDeCo・企業型DCの受け取りの始まり",
  contract: "1.1",
  revision: 3,
  requires: { "account.dcList": ">=1 <2" },
  params: Object.values(P),
  reads: ["account.kind", "account.owner", "account.contributions", "account.enrolledSince", "account.withdrawalLockedUntil", "account.payout"],
  memberScope: ["account"],
  input: "member.input",
  output: "account.idecoPayout.output",
  compute(input, ctx) {
    const member = input.member;
    const { base } = ctx.time;
    const ids = ctx.call<{ ids: string[] }>("account.dcList", { member }).ids;
    if (ids.length === 0) return { accounts: [] };
    const at = ctx.at(base);
    const age60 = ctx.time.ageSwitch(member, { years: at.paramCount(P.earliest) ?? 60 }, "reachMonth");
    const latest = ctx.time.ageSwitch(member, { years: at.paramCount(P.latest) ?? 75 }, "reachMonth");
    const out: IdecoPayoutPlan[] = [];
    for (const id of ids) {
      const a = ctx.get<AccountInput>("account", id);
      let since: MonthIndex = a.enrolledSince !== undefined ? parseYm(a.enrolledSince) : base;
      if (a.enrolledSince === undefined) for (const c of a.contributions) if (ctx.time.resolve(c.from) < since) since = ctx.time.resolve(c.from);
      let earliest: MonthIndex;
      let enrolledMonths: number;
      if (since >= age60) {
        enrolledMonths = 0;
        earliest = addMonths(since, LATE_ENTRY_MONTHS);
      } else {
        enrolledMonths = age60 - since;
        const startAge = bracketFor(ctx.at(age60).paramBrackets(P.byMonths) ?? [], yen(enrolledMonths)).amount ?? yen(65);
        earliest = ctx.time.ageSwitch(member, { years: startAge }, "reachMonth");
      }
      // 計算基準月より前に掛金を払っていたとみなす期間（入れた積立の期間を正とし、最初の積立より前は加入の始まりから）
      const past = a.contributions.filter((c) => c.monthly > 0 && ctx.time.resolve(c.from) < base);
      const ranges: (readonly [MonthIndex, MonthIndex])[] = [];
      if (past.length === 0) ranges.push([since, addMonths(base, -1)]);
      else {
        let firstFrom = base;
        for (const c of past) {
          const f = ctx.time.resolve(c.from);
          if (f < firstFrom) firstFrom = f;
          const t = c.to === null ? base : ctx.time.resolve(c.to);
          ranges.push([f, t < base ? t : addMonths(base, -1)]);
        }
        if (since < firstFrom) ranges.push([since, addMonths(firstFrom, -1)]);
      }
      const serviceBeforeBase = mergeRanges(ranges).map(([f, t]) => ({ from: formatYm(f), to: formatYm(t) }));
      if (a.withdrawalLockedUntil !== undefined && a.withdrawalLockedUntil !== null) {
        const lock = addMonths(ctx.time.resolve(a.withdrawalLockedUntil), 1);
        if (lock > earliest) earliest = lock;
      }
      // 始まりが空のときは、エンジンが計算の前に退職の年（60〜65歳）を入れる（0026。engine/investment.ts）
      const wanted = a.payout?.start === undefined ? latest : ctx.time.resolve(a.payout.start);
      let start = wanted < earliest ? earliest : wanted;
      if (start > latest) start = latest;
      const method = a.payout?.method ?? "lumpSum";
      out.push({
        object: a.id,
        kind: a.kind as "ideco" | "corporateDc",
        start: formatYm(start),
        method,
        annuityYears: method === "lumpSum" ? 0 : (a.payout?.annuityYears ?? 10),
        // 併用の一時金の割合の省略は半分（画面の空欄と同じ。0050・改訂2）
        lumpShare: method === "mixed" ? (a.payout?.lumpShare ?? "0.5") : null,
        enrolledMonths,
        serviceBeforeBase,
        serviceKnown: a.enrolledSince !== undefined || past.length > 0,
      });
    }
    return { accounts: out };
  },
});
