// 結果の画面の区画「夢と予定」（0044・0103 の追記 2026-11-12）: 対策のすぐ下に、ご家族の夢と支払い・受け取りの予定を
// 3つのまとまりで並べ、1件ずつのチェックで計算に入れる物を入れ外しする（見方の切り替えで保存しない。engine/moneyRows.ts の RowsView）:
// - ご家族の夢: 夢プランの夢
// - 支払いの予定: 子への援助・1回と年ごとの出るお金（確実も不確実も）・繰上返済・住まいの購入の頭金・月々の出るお金のうち不確実な物
// - 受け取りの予定: 不確実な入るお金（月々の物も）・受け取る相続・贈与と相続で受け継ぐ借金（確実も不確実も）
// どれも年の順で、中身の無いまとまりは出さない。1件1行（チェック・名前・時期・金額・見込み）。最初のチェックはふだんの計算のとおり
// （確実な物と「入れる」の夢はあり、不確実な物と「入れない」の夢はなし）。家の購入の頭金だけは外せない（チェックを置かず「確実」）
import type { EngineRequest, Household, PeriodicExpense, TableCell, Timepoint } from "../engine/types.ts";
import { BASE_EXCLUDED_KINDS, isDream, notCertainIncome, notNeededExpense, notNeededGift, viewCandidates, viewExcluded, type RowsView, type ViewCandidate } from "../engine/moneyRows.ts";
import { group } from "../presentation/format.ts";
import { dreamList, objectYears } from "../../../report/src/dreams.ts";
import { expenseName, incomeName } from "./input/moneyRows.ts";
import { DEBT_KINDS } from "./input/labels.ts";
import { resolveTimepoint } from "./timepoint.ts";
import { depletionYear, displayYears } from "./present.ts";
import { ageInYear, roles } from "./roles.ts";

/** 「夢と予定」の行の入れ外しの相手（engine/moneyRows.ts の ViewCandidate の key・off） */
export interface BigMoneyPick {
  key: string;
  off?: boolean;
}

/** 「夢と予定」の1行（1件1行。行の key は物の ID を含むので、作業の層だけで持つ〔提示層の PresentationModel には入れない。0016 の2〕） */
export interface BigMoneyRow {
  key: string;
  name: string;
  /** 「2028年」「2029〜2050年・7年ごと」「2027年〜・毎月」 */
  when: string;
  /** 「120万円」「年24万円」「月3万円」。額の無い物は「未定」 */
  amount: string;
  /** 行の右に小さく出す見込み（夢は null） */
  tag: "確実" | "不確実" | null;
  /** 今の見方で計算に入れているか（チェックあり。入れていない行は薄くする） */
  included: boolean;
  /** 入れ外しできる物（行の左のチェック）。家の購入（頭金）は null（外せない） */
  pick: BigMoneyPick | null;
}

export interface BigMoneyGroup {
  key: "dreams" | "pay" | "receive";
  /** 「ご家族の夢」「支払いの予定」「受け取りの予定」 */
  title: string;
  rows: BigMoneyRow[];
  /** 計算に入れている行の数（見出しの「4/7件」の4） */
  included: number;
}

/** 結果の画面の区画「夢と予定」（対策のすぐ下。0044・0103 の追記 2026-11-12） */
export interface BigMoneyModel {
  /** 一行の結論（「チェックした8件（15件中）を入れても102歳まで足ります」など。入れ外しできる物が無い・計算できていないときは null） */
  line: string | null;
  /** 中身のあるまとまりだけ（全部無ければ空で、区画を出さない） */
  groups: BigMoneyGroup[];
}

/** 区画の材料（App.tsx から） */
export interface BigMoneyInput {
  /** 見方を当てる前の、選んでいるプランの要求（並べる物と入れ外しの候補） */
  raw: EngineRequest;
  /** 現状の要求（選んでいるプランで外した物の入れ外しも出す）。省略は raw だけ */
  current?: EngineRequest;
  view: RowsView;
}

interface BigMoneyContext {
  years: readonly number[];
  depP: number | null;
  ageText: (year: number) => string;
  until: string;
  failed: boolean;
}

type GroupKey = BigMoneyGroup["key"];

interface Item {
  group: GroupKey;
  key: string;
  name: string;
  /** 並べる順の年月（無ければ最後） */
  sortAt: string;
  when: string;
  amount: string;
  tag: BigMoneyRow["tag"];
  pick: ViewCandidate | null;
  included: boolean;
}

const GROUPS: { key: GroupKey; title: string }[] = [
  { key: "dreams", title: "ご家族の夢" },
  { key: "pay", title: "支払いの予定" },
  { key: "receive", title: "受け取りの予定" },
];

const GIFT_PURPOSE: Record<string, string> = { wedding: "結婚資金", housing: "住宅資金", other: "援助" };

/** 万円の額（1万円未満は円。小数は1桁まで）: 1200000 → 「120万円」、15000 → 「1.5万円」 */
function yenShort(v: number): string {
  if (v >= 10000) return `${(Math.round(v / 1000) / 10).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`;
  return `${group(v)}円`;
}

const yearOf = (ym: string | null): number | null => (ym === null ? null : Number(ym.slice(0, 4)));

/** 回数の言い方（毎月・毎年・7年ごと） */
const everyText = (monthly: boolean, everyYears: number) => (monthly ? "毎月" : everyYears === 1 ? "毎年" : `${String(everyYears)}年ごと`);

/** 時期の文字（「2028年」「2029〜2050年・7年ごと」「2047年〜・毎年」） */
function whenText(h: Household, r: { from: Timepoint; to?: Timepoint | null; monthly?: boolean; everyYears: number }): string {
  const from = resolveTimepoint(h, r.from);
  if (from === null) return "時期は未定";
  const y0 = Number(from.slice(0, 4));
  const to = r.to == null ? null : resolveTimepoint(h, r.to);
  if (to !== null && to === from && r.monthly !== true) return `${String(y0)}年`;
  const every = everyText(r.monthly === true, r.everyYears);
  if (to === null) return `${String(y0)}年〜・${every}`;
  const y1 = Number(to.slice(0, 4));
  return y1 === y0 ? `${String(y0)}年・${every}` : `${String(y0)}〜${String(y1)}年・${every}`;
}

/** 行の額の文字（1回・何年ごとは1回の額、毎年は「年」、毎月は「月」。額の無い物は「未定」） */
function amountText(h: Household, r: { from: Timepoint; to?: Timepoint | null; monthly?: boolean; everyYears: number; amount: { value?: number | null } }): string {
  const v = r.amount.value ?? 0;
  if (v <= 0) return "未定";
  if (r.monthly === true) return `月${yenShort(v)}`;
  const once = r.to != null && resolveTimepoint(h, r.to) === resolveTimepoint(h, r.from);
  return !once && r.everyYears === 1 ? `年${yenShort(v)}` : yenShort(v);
}

/** 行が終わった年（終わりの無い行は null）。表の最初の年より前に終わった物は並べない */
const endYear = (h: Household, r: { from: Timepoint; to?: Timepoint | null }): number | null => (r.to == null ? null : yearOf(resolveTimepoint(h, r.to)));

/** 借入の呼び方（名前、無ければ種類） */
function debtName(d: { kind: string; label?: string }): string {
  if (d.label !== undefined && d.label !== "") return d.label;
  if (d.kind === "mortgage") return "住宅ローン";
  return DEBT_KINDS.find((o) => o.value === d.kind)?.label ?? "ローン";
}

/** 区画に並べる物（households は見せる順。前の世帯にある物を優先する。確実な物は前の世帯の物だけ） */
function itemsOf(households: readonly Household[], view: RowsView, table: readonly TableCell[], firstYear: number): Item[] {
  const cands = new Map<string, ViewCandidate>();
  for (const h of households) for (const c of viewCandidates(h)) if (!cands.has(c.key)) cands.set(c.key, c);
  const seen = new Set<string>();
  const out: Item[] = [];
  const status = (key: string): { pick: ViewCandidate | null; included: boolean } => {
    const c = cands.get(key);
    return c === undefined ? { pick: null, included: true } : { pick: c, included: !viewExcluded(c, view) };
  };
  const push = (main: boolean, it: Omit<Item, "pick" | "included" | "tag"> & { certain: boolean }) => {
    if (seen.has(it.key)) return;
    const st = status(it.key);
    // 入れ外しできない物（家の購入の頭金など）は、選んでいるプランの世帯の物だけ
    if (st.pick === null && !main) return;
    seen.add(it.key);
    const { certain, ...rest } = it;
    // 見込みは入れ外しの候補の見方で（前の版の「この行を計算に入れる」の行は確実と読む）。候補でない物（家の購入の頭金など）は行の値で
    const sure = st.pick !== null ? st.pick.reason !== "uncertain" : certain;
    out.push({ ...rest, tag: rest.group === "dreams" ? null : sure ? "確実" : "不確実", pick: st.pick, included: st.included });
  };
  households.forEach((h, i) => {
    const main = i === 0;
    const at = (t: Timepoint | null | undefined) => resolveTimepoint(h, t) ?? "9999-12";
    // ご家族の夢（夢プランの夢。並べる順は払い始める年。同じ年は順位の順）
    for (const p of dreamList(h.periodicExpenses)) {
      if ((endYear(h, p) ?? Infinity) < firstYear) continue;
      push(main, { group: "dreams", key: `out:${p.id}`, name: p.label !== undefined && p.label !== "" ? p.label : "夢", sortAt: at(p.from), when: whenText(h, p), amount: amountText(h, p), certain: false });
    }
    // 支払いの予定: 出るお金の行（夢を除く。月々の物は不確実な物だけ）
    for (const p of (h.periodicExpenses ?? []) as PeriodicExpense[]) {
      if (isDream(p)) continue;
      const uncertain = notNeededExpense(p);
      if (p.monthly === true && !uncertain) continue;
      if ((endYear(h, p) ?? Infinity) < firstYear) continue;
      push(main, { group: "pay", key: `out:${p.id}`, name: expenseName(h, p), sortAt: at(p.from), when: whenText(h, p), amount: amountText(h, p), certain: !uncertain });
    }
    // 子への援助（教育の目標の gifts。贈与する人から出す援助は世帯のお金から出さないので並べない）
    const kids = h.members.filter((m) => m.kind === "child" && m.outside === undefined).sort((a, b) => a.birth.birthYearMonth.localeCompare(b.birth.birthYearMonth));
    for (const g of h.goals ?? []) {
      (g.education?.gifts ?? []).forEach((x, n) => {
        if (x.donor !== undefined && x.donor !== "") return;
        const ym = resolveTimepoint(h, x.at);
        const y = yearOf(ym);
        if (y !== null && y < firstYear) return;
        const k = kids.findIndex((m) => m.id === g.owner);
        push(main, {
          group: "pay",
          key: typeof x.id === "string" ? `gift:${x.id}` : `gift:${g.id}:${String(n)}`,
          name: `${k >= 0 ? `第${String(k + 1)}子` : "子"}への援助（${GIFT_PURPOSE[x.purpose] ?? "援助"}）`,
          sortAt: ym ?? "9999-12",
          when: y === null ? "時期は未定" : `${String(y)}年`,
          amount: x.amount > 0 ? yenShort(x.amount) : "未定",
          certain: !notNeededGift(x),
        });
      });
    }
    // 繰上返済（借入の prepayments）
    for (const d of h.debts ?? []) {
      (d.prepayments ?? []).forEach((pp, n) => {
        const ym = resolveTimepoint(h, pp.at);
        const y = yearOf(ym);
        if (y === null || y < firstYear) return;
        push(main, { group: "pay", key: `prepay:${d.id}:${String(n)}`, name: `繰上返済（${debtName(d)}）`, sortAt: ym ?? "9999-12", when: `${String(y)}年`, amount: pp.amount > 0 ? yenShort(pp.amount) : "未定", certain: true });
      });
    }
    // 家の購入・住み替えの頭金（住まいの purchase。頭金を払う年は表の頭金の行から読む。注文住宅は引き渡しの前に払う年もある）
    for (const r of h.residences ?? []) {
      const down = r.purchase?.downPayment ?? 0;
      if (r.purchase === undefined || down <= 0) continue;
      const ym = resolveTimepoint(h, r.purchase.at);
      const paid = objectYears(table, r.id, "cf.expense.housing.purchase.downPayment");
      const y = paid[0] ?? yearOf(ym);
      if (y === null || (paid.at(-1) ?? y) < firstYear) continue;
      // 前に持ち家があれば住み替え（賃貸からの購入は家の購入）
      const before = (h.residences ?? []).some((o) => o.id !== r.id && o.kind === "own" && (resolveTimepoint(h, o.from) ?? "9999-12") < (resolveTimepoint(h, r.from) ?? "9999-12"));
      push(main, { group: "pay", key: `purchase:${r.id}`, name: before ? "住み替えの頭金" : "家の購入の頭金", sortAt: ym ?? `${String(y)}-01`, when: `${String(y)}年`, amount: yenShort(down), certain: true });
    }
    // 受け取りの予定: 不確実な入るお金（月々の物も）と、受け取る相続・贈与（確実も不確実も）
    for (const f of h.incomeFlows ?? []) {
      const base = BASE_EXCLUDED_KINDS.has(f.kind);
      const uncertain = notCertainIncome(f);
      if (!base && !uncertain) continue;
      if ((endYear(h, f) ?? Infinity) < firstYear) continue;
      push(main, { group: "receive", key: `in:${f.id}`, name: incomeName(f), sortAt: at(f.from), when: whenText(h, f), amount: amountText(h, f), certain: !uncertain });
    }
    // 相続で受け継ぐ借金（確実も不確実も。数字は受け継ぐ年の終わり）
    for (const d of h.debts ?? []) {
      if (d.inheritedFrom === undefined) continue;
      const ym = resolveTimepoint(h, d.start);
      const y = yearOf(ym);
      if (y !== null && y < firstYear) continue;
      const v = d.balance?.value ?? d.principal;
      push(main, {
        group: "receive",
        key: `debt:${d.id}`,
        name: d.label !== undefined && d.label !== "" ? d.label : "相続で受け継ぐ借金",
        sortAt: ym ?? "9999-12",
        when: y === null ? "時期は未定" : `${String(y)}年`,
        amount: v > 0 ? yenShort(v) : "未定",
        certain: d.likelihood !== "uncertain",
      });
    }
  });
  return out;
}

export interface BigMoneySummaryInput {
  /** チェックのある物（入れ外しできる物）の数と、そのうちチェックの入っている数 */
  total: number;
  included: number;
  /** 今の見方で資産が尽きる年（尽きなければ null） */
  withYear: number | null;
  ageText: (year: number) => string;
  until: string;
}

/**
 * 一行の結論（チェックのある物が無ければ null）。チェックの状態をそのまま言う:
 * - 「チェックした8件（15件中）を入れても102歳まで足ります」「すべて（7件）を入れても95歳まで足ります」
 * - 「チェックした8件（15件中）を入れると82歳で不足します」
 * - どれもチェックしていなければ「どれも入れずに95歳まで足ります」「どれも入れずに82歳で不足します」
 */
export function bigMoneySummary(x: BigMoneySummaryInput): string | null {
  if (x.total === 0) return null;
  const end = x.withYear === null ? `${x.until}足ります` : `${x.ageText(x.withYear)}で不足します`;
  if (x.included === 0) return `どれも入れずに${end}`;
  const which = x.included === x.total ? `すべて（${String(x.total)}件）を` : `チェックした${String(x.included)}件（${String(x.total)}件中）を`;
  return `${which}${x.withYear === null ? "入れても" : "入れると"}${end}`;
}

/**
 * 区画の値（App.tsx が作る。proposal は今の見方を当てた選んでいるプランの要求、table はその答えの表。failed は選んだプランか基準のプランが
 * 計算できなかった〔一行の結論を出さない。0169〕）
 */
export function bigMoneyOf(proposal: EngineRequest, table: readonly TableCell[], input: BigMoneyInput, failed = false): BigMoneyModel {
  const years = displayYears(proposal);
  const self = roles(proposal).find((r) => r.key === "self");
  const last = years.at(-1) ?? proposal.input.endYear;
  const ctx: BigMoneyContext = {
    years,
    depP: depletionYear(table, years),
    ageText: (y) => (self !== undefined ? `${String(ageInYear(self.member, y))}歳` : `${String(y)}年`),
    until: self !== undefined ? `${String(ageInYear(self.member, last))}歳まで` : "最後まで",
    failed,
  };
  const hs = [input.raw.input.household, ...(input.current !== undefined ? [input.current.input.household] : [])];
  const items = itemsOf(hs, input.view, table, ctx.years[0] ?? 0);
  const groups: BigMoneyGroup[] = [];
  for (const g of GROUPS) {
    const rows = items
      .map((it, i) => ({ it, i }))
      .filter((x) => x.it.group === g.key)
      .sort((a, b) => a.it.sortAt.localeCompare(b.it.sortAt) || a.i - b.i)
      .map(({ it }): BigMoneyRow => ({ key: it.key, name: it.name, when: it.when, amount: it.amount, tag: it.tag, included: it.included, pick: it.pick === null ? null : { key: it.pick.key, ...(it.pick.off === true ? { off: true } : {}) } }));
    if (rows.length > 0) groups.push({ ...g, rows, included: rows.filter((r) => r.included).length });
  }
  const picks = groups.flatMap((g) => g.rows).filter((r) => r.pick !== null);
  const line = ctx.failed ? null : bigMoneySummary({ total: picks.length, included: picks.filter((r) => r.included).length, withYear: ctx.depP, ageText: ctx.ageText, until: ctx.until });
  return { line, groups };
}
