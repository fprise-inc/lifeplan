// ありえない結果の見張りの決まり（同じ種類の誤りを二度と気づかれずに入れないための点検）。
// 1つの世帯（作業の層の世帯と、その計算の結果）を受け取り、決まりごとに「おかしい所」の文を返す（無ければ空）。
// 見本の棚・モデル世帯（result-watch.test.ts）と、画面のキー入力で入れた世帯（通しの入力のテスト）の両方に同じ決まりを当てる。
// 決まりは入力の形と計算の結果だけを見る（画面は描かない）。画面に出る文字の決まりは、画面を描かずに文を作る関数を呼んで集める
import type { EngineRequest, Household, Member, PreviewResult, TableCell } from "../../src/engine/types.ts";
import { checkList } from "../../src/workspace/input/checkRows.ts";
import { allFields, type FieldDef, type StageDef } from "../../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../../src/workspace/input/household.ts";
import { isAutoStage, retireMonth } from "../../src/workspace/input/livingStages.ts";
import { pctFromRate } from "../../src/workspace/input/units.ts";
import { buildStage, STAGE_ORDER } from "../../src/workspace/input/stages/index.ts";
import { currentPeriod } from "../../src/workspace/input/stages/work.ts";
import { addMonths, ageAt, parseYm } from "../../src/workspace/levers.ts";
import { buildCatalog } from "../../src/workspace/plans/items.ts";
import { diffRows, objectCards } from "../../src/workspace/plans/planEdit.ts";
import { changesOf } from "../../src/workspace/plans/plans.ts";
import { flowChart, rowDefs } from "../../src/workspace/present.ts";
import { roles } from "../../src/workspace/roles.ts";
import { monthsBetween, resolveTimepoint } from "../../src/workspace/timepoint.ts";
import { bsHouseholdOf, bsSeries } from "../../../report/src/bsGroups.ts";
import { preview } from "../helpers.ts";

/** 見張る世帯: 作業の層の世帯と、その要求の計算の結果（先出しの形） */
export interface WatchSubject {
  /** 見分ける名前（見本の番号・モデル世帯の名前・通しの入力の世帯の名前） */
  name: string;
  wh: WorkingHousehold;
  result: PreviewResult;
  /** ヒアリングシートから取り込んだ世帯（取り込みの形だけで見る決まりがある） */
  imported?: boolean;
}

export interface WatchRule {
  /** 決まりの鍵（直す待ちの一覧で使う。英字の短い名前） */
  id: string;
  /** 何を見張るか（テストの名前に出す） */
  title: string;
  /** おかしい所の文（無ければ空） */
  check: (s: WatchSubject) => string[];
}

const isWorking = (x: WorkingHousehold | EngineRequest): x is WorkingHousehold => "request" in x && "proposals" in x;

/** 世帯を計算して見張る形にする（要求から作るときは作業の層の世帯に読み直す。通しの入力のテストは保存した世帯をそのまま渡す） */
export function subjectOf(name: string, from: WorkingHousehold | EngineRequest, o: { imported?: boolean } = {}): WatchSubject {
  const wh = isWorking(from) ? from : fromRequest(from);
  return { name, wh, result: preview(wh.request), ...(o.imported === true ? { imported: true } : {}) };
}

/** 見張る（決まりごとのおかしい所。おかしい所の無い決まりは出さない） */
export function watch(s: WatchSubject, rules: readonly WatchRule[] = WATCH_RULES): { rule: string; problems: string[] }[] {
  return rules.map((r) => ({ rule: r.id, problems: r.check(s) })).filter((x) => x.problems.length > 0);
}

// ---- 共通の道具 ----

const hh = (s: WatchSubject): Household => s.wh.request.input.household;
const baseMonth = (s: WatchSubject): string => s.wh.request.input.baseMonth;
const endYear = (s: WatchSubject): number => s.wh.request.input.endYear;
const yearOf = (ym: string): number => parseYm(ym).y;
const under = (row: string, prefix: string): boolean => row === prefix || row.startsWith(`${prefix}.`);
const memberOf = (h: Household, id: string | undefined): Member | undefined => h.members.find((m) => m.id === id);
/** 人の呼び方（文に出す。名前を持たない見本もあるので、続柄と生年月） */
const who = (m: Member | undefined): string => (m === undefined ? "（不明の人）" : `${m.kind}(${m.birth.birthYearMonth})`);
/** その人が亡くなる（世帯を離れる）見込みの月。入っていなければ null */
const leavesMonth = (h: Household, m: Member | undefined): string | null => (m?.leaves == null ? null : resolveTimepoint(h, m.leaves));
const sumWhere = (table: readonly TableCell[], pred: (c: TableCell) => boolean): number => table.reduce((a, c) => (pred(c) ? a + c.amount : a), 0);
const yen = (v: number): string => `${Math.round(v / 10_000).toLocaleString("ja-JP")}万円`;

// ---- 決まり ----

/** 学校・進路を選んだのに、その段の学費が0円（統計の目安の無い学校で、学費を入れていない） */
const schoolFeeZero: WatchRule = {
  id: "schoolFeeZero",
  title: "学校・進路を選んだ段の学費が0円になっていない",
  check: (s) => {
    const out: string[] = [];
    const goals = new Map((hh(s).goals ?? []).map((g) => [g.id, g]));
    for (const n of s.result.header.notices ?? []) {
      if (n.code !== "N_INPUT_REQUIRED" || n.ids[0] !== "education.cost") continue;
      const g = goals.get(n.ids[1] ?? "");
      out.push(`${who(memberOf(hh(s), g?.owner))} の学校の段の学費が入っていない（${n.ids.slice(2).join("・")}。0円で計算）`);
    }
    for (const g of hh(s).goals ?? []) for (const st of g.education?.stages ?? []) if (st.annualOverride === 0) out.push(`${who(memberOf(hh(s), g.owner))} の ${st.stage} の学費（年額）が0円`);
    return out;
  },
};

/** 受け取りが計算の基準の月より前の退職金の推定（定年が過ぎた人に目安の退職一時金を足している） */
const pastRetirementEstimate: WatchRule = {
  id: "pastRetirementEstimate",
  title: "受け取りが計算の基準の月より前の退職金を推定で足していない",
  check: (s) => {
    const h = hh(s);
    const out: string[] = [];
    for (const b of h.retirementBenefits ?? []) {
      if (b.amount?.state !== "estimated") continue;
      const p = (h.employmentPeriods ?? []).find((x) => x.id === b.employment);
      const paid = resolveTimepoint(h, b.paidAt) ?? resolveTimepoint(h, b.service?.to) ?? (p?.to != null ? resolveTimepoint(h, p.to) : null);
      if (paid !== null && paid < baseMonth(s)) out.push(`${who(memberOf(h, b.member))} の ${b.kind}（推定 ${yen(b.amount.value ?? 0)}）の受け取りが ${paid}（計算の基準の月 ${baseMonth(s)} より前）`);
    }
    return out;
  },
};

const REGULAR_TYPES = new Set(["regular", "civilServant"]);

/** 働き方の種類と推定の食い違い: 正社員・公務員でない今の働き方に定年の推定、正社員の統計の年収の推定が残る */
const workTypeEstimates: WatchRule = {
  id: "workTypeEstimates",
  title: "働き方の種類と推定（定年・定年後の予定・年収の統計）が食い違っていない",
  check: (s) => {
    const h = hh(s);
    const out: string[] = [];
    for (const m of h.members) {
      const cur = currentPeriod(h, m.id, baseMonth(s));
      if (cur === undefined) continue;
      const assumedEnd = s.wh.assumed[`work/${m.id}/mainEnd`];
      if (assumedEnd !== undefined && !REGULAR_TYPES.has(cur.type) && (cur.from.at ?? "") <= baseMonth(s)) out.push(`${who(m)} の今の働き方は ${cur.type} なのに、定年の推定（${assumedEnd}）が残っている`);
    }
    for (const p of h.employmentPeriods ?? []) {
      if (REGULAR_TYPES.has(p.type)) continue;
      for (const [k, box] of [
        ["年収", p.salary?.annual],
        ["賞与", p.salary?.bonus],
      ] as const) {
        const basis = (box as { estimate?: { method?: string; basis?: string } } | undefined)?.estimate;
        if (box?.state === "estimated" && basis?.method === "statistic" && /正社員/.test(basis.basis ?? "")) out.push(`${who(memberOf(h, p.member))} の ${p.type} の期間の${k}が、正社員の統計の推定（${yen(box.value ?? 0)}）のまま`);
      }
    }
    return out;
  },
};

/** 働く最後の年齢（期間の終わり）が無いまま、表の最後まで給与・事業所得が入る（80歳を過ぎても働いて収入がある） */
const workToTableEnd: WatchRule = {
  id: "workToTableEnd",
  title: "期間の終わりの無い働き方で、80歳を過ぎても給与・事業所得が入っていない",
  check: (s) => {
    const h = hh(s);
    const out: string[] = [];
    for (const p of h.employmentPeriods ?? []) {
      if (p.to !== null) continue;
      const m = memberOf(h, p.member);
      if (m === undefined) continue;
      const late = s.result.table.filter((c) => c.object === p.id && (under(c.row, "cf.income.salary") || under(c.row, "cf.income.business")) && c.amount > 0 && ageAt(m, `${c.year}-12`) >= 80);
      if (late.length > 0) out.push(`${who(m)} の ${p.type} の期間に終わりが無く、${Math.max(...late.map((c) => c.year))}年（${ageAt(m, `${Math.max(...late.map((c) => c.year))}-12`)}歳）まで収入が入る`);
    }
    return out;
  },
};

/** 住み終わりのある持ち家（売らない）が、住み終わりの後に資産から消える（知らせの有無は見ない） */
export function keptHomeConditions(s: WatchSubject): string[] {
  const h = hh(s);
  const out: string[] = [];
  for (const r of h.residences ?? []) {
    if (r.kind !== "own" || r.to == null || r.sale !== undefined) continue;
    const end = resolveTimepoint(h, r.to);
    if (end === null) continue;
    const y = yearOf(end) + 1;
    if (y > endYear(s)) continue;
    const held = (year: number) => sumWhere(s.result.table, (c) => c.object === r.id && c.year === year && under(c.row, "cf.balance.account.realEstate"));
    if (held(yearOf(end)) > 0 && held(y) === 0) out.push(`売らない持ち家（住み終わり ${end}）が ${y}年に資産から消える`);
  }
  return out;
}

/**
 * 住み終わりのある持ち家（売らない）が、住み終わりの後に黙って資産から消える。消えるなら、住まいの「住み終わりの後」にその旨の知らせ
 * （住み終わりの年で計算から外している・空き家として持ち続ける）が出ている（0052 の追記 2026-11-07）
 */
const keptHomeVanishes: WatchRule = {
  id: "keptHomeVanishes",
  title: "売らない持ち家が、住み終わりの後に黙って資産から消えていない",
  check: (s) => {
    const found = keptHomeConditions(s);
    if (found.length === 0) return [];
    const told = housingNotes(s.wh).some((t) => /住み終わりの年.*外しています|空き家）で持ち続けます/.test(t));
    return told ? [] : found.map((t) => `${t}のに、住まい・ローンの入力項目に知らせが無い`);
  },
};

/** 売った家の住宅ローンが、売った後も返済され続ける */
const soldHomeLoanContinues: WatchRule = {
  id: "soldHomeLoanContinues",
  title: "売った家の住宅ローンを、売った後も返し続けていない",
  check: (s) => {
    const h = hh(s);
    const out: string[] = [];
    for (const r of h.residences ?? []) {
      if (r.kind !== "own" || r.to == null || r.sale === undefined) continue;
      const end = resolveTimepoint(h, r.to);
      if (end === null) continue;
      const purchase = r.purchase !== undefined ? resolveTimepoint(h, r.purchase.at) : null;
      const loans = (h.debts ?? []).filter((d) => d.property === undefined && (d.housing?.residence === r.id || (purchase !== null && resolveTimepoint(h, d.start) === purchase)));
      for (const d of loans) {
        const after = s.result.table.filter((c) => c.object === d.id && c.row === "cf.expense.housing.loan" && c.year > yearOf(end) && c.amount > 0);
        if (after.length > 0) out.push(`住み終わりの月（${end}）に売った家の住宅ローンを、${Math.max(...after.map((c) => c.year))}年まで返している（売った後に ${yen(sumWhere(after, () => true))}）`);
      }
    }
    return out;
  },
};

/** 住まいの見出しの知らせの文（住まい・ローンの入力項目の区画の注記と、確かめの一覧の行） */
function housingNotes(wh: WorkingHousehold): string[] {
  const st = buildStage("housing", wh);
  const notes = st.sections.flatMap((x) => [x.note ?? "", ...x.groups.map((g) => g.note ?? "")]);
  const checks = checkList(wh)
    .filter((r) => r.card === "housing")
    .map((r) => `${r.label} ${r.detail ?? ""}`);
  return [...notes, ...checks].filter((t) => t !== "");
}

/** 住まいが2つ重なる時期・最後の住まいの後に住まいが無い時期（知らせの有無は見ない） */
export function housingConditions(h: Household, base: string, end: number): string[] {
  const rs = (h.residences ?? [])
    .map((r) => ({ r, from: resolveTimepoint(h, r.from), to: r.to == null ? null : resolveTimepoint(h, r.to) }))
    .filter((x): x is typeof x & { from: string } => x.from !== null)
    .sort((a, b) => a.from.localeCompare(b.from));
  if (rs.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i]!;
      const b = rs[j]!;
      const from = a.from > b.from ? a.from : b.from;
      const aEnd = a.to ?? "9999-12";
      const bEnd = b.to ?? "9999-12";
      const to = aEnd < bEnd ? aEnd : bEnd;
      if (from <= to && to >= base) out.push(`住まいが ${from > base ? from : base} から2つ重なる（${a.r.kind}・${b.r.kind}）`);
    }
  const last = rs.reduce((x, y) => ((y.to ?? "9999-12") > (x.to ?? "9999-12") ? y : x));
  if (last.to !== null && yearOf(last.to) < end) out.push(`${addMonths(last.to, 1)} から先の住まいが入っていない（住居費0円）`);
  return out;
}

/** 住まいが2つ重なる・最後の住まいの後に住まいが無い期間がある。そのときは知らせが出ている（住居費を二重に払う・0円のまま黙らない） */
const housingOverlapGap: WatchRule = {
  id: "housingOverlapGap",
  title: "住まいの重なり・住まいの無い期間に知らせが出ている",
  check: (s) => {
    const problems = housingConditions(hh(s), baseMonth(s), endYear(s));
    if (problems.length === 0) return [];
    // 知らせの文の形は、知らせを作るときに決める（ここは「重な」「先の住まい」「住まいが入っていません」のどれかを含めば知らせとみなす）
    const told = housingNotes(s.wh).some((t) => /重な|住まいが入っていません|先の住まい/.test(t));
    return told ? [] : problems.map((p) => `${p}のに、住まい・ローンの入力項目に知らせが無い`);
  },
};

/** 購入の時期と、その家の住み始め・購入の住宅ローンの借入の年月・住宅ローン控除の入居がずれている */
const purchaseDates: WatchRule = {
  id: "purchaseDates",
  title: "購入の時期と、住み始め・借入の年月・控除の入居がそろっている",
  check: (s) => {
    const h = hh(s);
    const out: string[] = [];
    for (const r of h.residences ?? []) {
      if (r.purchase === undefined) continue;
      const at = resolveTimepoint(h, r.purchase.at);
      if (at === null) continue;
      const from = resolveTimepoint(h, r.from);
      if (from !== null && from !== at) out.push(`購入の時期 ${at} と住み始め ${from} がずれている`);
      for (const d of h.debts ?? []) {
        if (d.housing?.residence !== r.id) continue;
        const start = resolveTimepoint(h, d.start);
        // 注文住宅の土地の分のローン（土地の決済の月に借りる）は、土地の決済の時期とそろえば良い
        const land = r.purchase.land !== undefined ? resolveTimepoint(h, r.purchase.land.at) : null;
        if (start !== null && start !== at && start !== land) out.push(`購入の時期 ${at} と住宅ローンの借入の年月 ${start} がずれている`);
        const moveIn = (h.events ?? []).find((e) => e.id === d.housing?.moveIn);
        const mi = moveIn !== undefined ? resolveTimepoint(h, moveIn.at) : null;
        if (mi !== null && mi !== at) out.push(`購入の時期 ${at} と住宅ローン控除の入居 ${mi} がずれている`);
      }
    }
    return out;
  },
};

/** 今の年の純資産が大きくマイナス（持ち家の時価が入っていない・桁の誤りなど）。今住んでいる持ち家が資産に無いのも見る */
const NET_WORTH_FLOOR = -10_000_000;
const negativeNetWorthNow: WatchRule = {
  id: "negativeNetWorthNow",
  title: "今の年の純資産が大きくマイナスでなく、今住んでいる持ち家が資産に入っている",
  check: (s) => {
    const h = hh(s);
    const y = yearOf(baseMonth(s));
    const out: string[] = [];
    const at = bsSeries(s.result.table, [y], bsHouseholdOf(h))[0];
    if (at !== undefined && at.netWorth < NET_WORTH_FLOOR) out.push(`${y}年の純資産が ${yen(at.netWorth)}`);
    for (const r of h.residences ?? []) {
      if (r.kind !== "own") continue;
      const from = resolveTimepoint(h, r.from);
      const to = r.to == null ? null : resolveTimepoint(h, r.to);
      if (from === null || from > baseMonth(s) || (to !== null && to < baseMonth(s))) continue;
      const v = sumWhere(s.result.table, (c) => c.object === r.id && c.year === y && under(c.row, "cf.balance.account.realEstate"));
      if (v <= 0) out.push(`今住んでいる持ち家が ${y}年の資産に入っていない（時価の元が無い）`);
    }
    return out;
  },
};

/** 介護を受ける人が亡くなった後も介護の費用が続く・受け取る相続の時期（推定）が相手の亡くなる見込みとずれる */
const careAndInheritanceAfterDeath: WatchRule = {
  id: "careAndInheritanceAfterDeath",
  title: "介護の費用・受け取る相続の時期が、亡くなる見込みについてきている",
  check: (s) => {
    const h = hh(s);
    const out: string[] = [];
    for (const c of h.careExpenses ?? []) {
      const m = memberOf(h, c.member);
      const gone = leavesMonth(h, m);
      if (gone === null) continue;
      const after = s.result.table.filter((x) => x.object === c.id && under(x.row, "cf.expense") && x.year > yearOf(gone) && x.amount > 0);
      if (after.length > 0) out.push(`${who(m)} は ${gone} に亡くなる見込みなのに、介護の費用が ${Math.max(...after.map((x) => x.year))}年まで続く`);
    }
    for (const f of h.incomeFlows ?? []) {
      if (f.kind !== "inheritance" || f.counterparty === undefined) continue;
      // 受け取る時期が推定のまま（仮の印）か。FP が入れた時期は、亡くなる見込みとずれていても FP の判断として見張らない
      const estimatedAt = s.wh.assumed[`in/${f.id}/from`] !== undefined;
      const m = memberOf(h, f.counterparty);
      const gone = leavesMonth(h, m);
      const at = resolveTimepoint(h, f.from);
      if (at === null) continue;
      if (gone === null) continue;
      const lag = monthsBetween(at, gone);
      if (estimatedAt && (lag < 0 || lag > 24)) out.push(`${who(m)} から受け取る相続の時期 ${at} が、亡くなる見込み ${gone} と ${lag}か月ずれている`);
    }
    return out;
  },
};

/** 70歳・80歳の段（推定のまま）の生活費の割合が、退職直後の段より高い */
const livingStagesRise: WatchRule = {
  id: "livingStagesRise",
  title: "推定のままの70歳・80歳の段の生活費が、退職直後の段より高くない",
  check: (s) => {
    const h = hh(s);
    const retire = retireMonth(h);
    if (retire === null) return [];
    const out: string[] = [];
    for (const l of h.livingExpenses ?? []) {
      const stages = (l.stages ?? [])
        .map((x) => ({ x, at: resolveTimepoint(h, x.at) }))
        .filter((x): x is typeof x & { at: string } => x.at !== null && x.x.ratio !== undefined && x.at >= retire)
        .sort((a, b) => a.at.localeCompare(b.at));
      const first = stages[0];
      if (first === undefined) continue;
      for (const later of stages.slice(1)) {
        if (later.x.id === undefined || !isAutoStage(l, later.x.id)) continue;
        if (Number(later.x.ratio) > Number(first.x.ratio)) out.push(`${later.at} からの段（推定 ${pctFromRate(later.x.ratio!)}%）が、退職直後の段（${first.at}・${pctFromRate(first.x.ratio!)}%）より高い`);
      }
    }
    return out;
  },
};

/**
 * キャッシュフロー表とグラフで、同じお金の行き先がそろっている。表の行（rowDefs）とグラフの系列（flowChart）の組で、許した組だけにする。
 * 事業所得・企業年金を表の「その他の収入」にしない（給与・年金と並ぶ収入の行にする）
 */
const TABLE_TO_CHART: Readonly<Record<string, readonly string[]>> = {
  salary: ["salary"],
  pension: ["pension"],
  retirement: ["incomeOther"],
  benefit: ["incomeOther"],
  rent: ["realEstateIn"],
  realEstateSale: ["realEstateIn"],
  incomeOther: ["incomeOther"],
  living: ["living"],
  surplusSpend: ["living"],
  housing: ["housing"],
  education: ["education"],
  insurance: ["insurance"],
  lumpSum: ["expenseOther"],
  car: ["expenseOther", "insurance", "living", "housing"],
  realEstateExpense: ["realEstateOut"],
  realEstateLoan: ["realEstateOut"],
  expenseOther: ["expenseOther"],
  taxSi: ["expenseOther"],
};
/** 表の行とグラフの系列の食い違い（mapping は表の行の鍵 → 入れてよいグラフの系列の鍵） */
export function rowGroupingProblems(req: EngineRequest, table: readonly TableCell[], mapping: Readonly<Record<string, readonly string[]>> = TABLE_TO_CHART): string[] {
  const defs = rowDefs(req).filter((d) => d.kind === "value");
  const series = (c: TableCell): string | null => {
    // flowChart の系列の決まりを1マスずつ当てる（同じ関数を1マスの表で呼ぶ）
    const one = flowChart(req, [c], [c.year], "");
    const hit = [...one.income, ...one.expense].find((x) => x.values[0] !== 0);
    return hit?.key ?? null;
  };
  const out = new Set<string>();
  for (const c of table) {
    if (c.amount === 0 || !(under(c.row, "cf.income") || under(c.row, "cf.expense") || under(c.row, "cf.taxSi"))) continue;
    const d = defs.find((x) => x.match(c));
    if (d === undefined) {
      out.add(`${c.row} が表のどの行にも入らない`);
      continue;
    }
    const key = d.key.split(":")[0]!;
    if (key === "incomeOther" && (under(c.row, "cf.income.business") || under(c.row, "cf.income.corporatePension"))) out.add(`${c.row} が表の「その他の収入」に入る`);
    const allowed = mapping[key];
    const g = series(c);
    // 表に新しい行を足したら、グラフのどの系列に入れるかを TABLE_TO_CHART に書く（書き忘れもここで見つける）
    if (allowed === undefined) out.add(`表の行「${d.label}」（${key}）がグラフの系列との対応の表に無い`);
    else if (g !== null && !allowed.includes(g)) out.add(`${c.row} が表は「${d.label}」、グラフは「${g}」`);
  }
  return [...out];
}

const rowGrouping: WatchRule = {
  id: "rowGrouping",
  title: "キャッシュフロー表とグラフで、同じお金の行き先がそろっている（事業所得・企業年金を「その他の収入」にしない）",
  check: (s) => rowGroupingProblems(s.wh.request, s.result.table),
};

/** 資産配分の入れ方で、画面に出している割合・期待リターンと、計算に渡している値が違う */
const allocationPassed: WatchRule = {
  id: "allocationPassed",
  title: "資産配分の入れ方で、出している割合・期待リターンが計算に渡っている",
  check: (s) => {
    const a = s.wh.request.input.assumptions;
    const inv = a?.investment;
    if (inv?.method !== "allocation") return [];
    if (inv.allocation === undefined || inv.allocation.mix.length === 0) return ["資産配分の入れ方なのに、計算に資産の種類ごとの割合が渡っていない（運用利回りの1つの値で計算）"];
    // 預金の種類（現金・外貨預金）は、前提条件の預金の利回りがあればそれで計算する（運用利回りにならない。0137）
    const missing = inv.allocation.mix.filter((x) => Number(x.share) > 0 && a?.assetReturns?.[x.assetClass] === undefined && !(x.assetClass.startsWith("cash.") && a?.depositReturn !== undefined)).map((x) => x.assetClass);
    return missing.length > 0 ? [`資産配分の ${missing.join("・")} の期待リターンが計算に渡っていない（運用利回りで計算）`] : [];
  },
};

/** 残高のある課税口座・NISA の取得価額が0円（残高全部を利益として税を計算する・NISA の枠を使っていないとみなす） */
const COST_BASIS_KINDS = new Set(["taxable", "nisa", "juniorNisa", "kodomoNisa", "childNisa"]);
const zeroCostBasis: WatchRule = {
  id: "zeroCostBasis",
  title: "残高のある課税口座・NISA の取得価額が0円になっていない",
  check: (s) =>
    (hh(s).accounts ?? [])
      .filter((a) => COST_BASIS_KINDS.has(a.kind) && (a.marketValue?.value ?? 0) > 0 && a.costBasis?.value === 0)
      .map((a) => `${a.kind} の口座（時価 ${yen(a.marketValue?.value ?? 0)}）の取得価額が0円`),
};

/**
 * 取り込んだ世帯で、世帯の外の家族（親など）に亡くなる見込みが無い（相続の時期・相続人の数え方・親のお金を見る期間がずれる）。
 * 入力の画面では「入れない（表の最後まで）」を FP が選べるので、取り込んだ世帯だけを見る（画面で足した親には平均余命の推定が入る）
 */
const outsideWithoutDeath: WatchRule = {
  id: "outsideWithoutDeath",
  title: "取り込んだ世帯の、世帯の外の家族に亡くなる見込みが入っている",
  check: (s) =>
    s.imported !== true
      ? []
      : hh(s)
      .members.filter((m) => m.outside !== undefined && m.leaves == null)
      .map((m) => `世帯の外の家族 ${who(m)} に亡くなる見込みが無い（表の最後まで生きる）`),
};

// ---- 画面に出る文字 ----

/** 画面に出る文の1つ（どこの文か・文） */
export interface ScreenText {
  where: string;
  text: string;
}

const STAGE_IDS = [...STAGE_ORDER.map((x) => x.id), "assumptions" as const];

/** 入力項目の欄・まとまり・ボタンの文（画面を描かずに、欄の定義と今の値の状態から作る） */
function stageTexts(stage: StageDef, wh: WorkingHousehold): ScreenText[] {
  const out: ScreenText[] = [];
  const put = (where: string, t: string | null | undefined) => {
    if (typeof t === "string" && t.trim() !== "") out.push({ where: `${stage.id}: ${where}`, text: t });
  };
  put("見出し", stage.label);
  put("説明", stage.lead);
  for (const sec of stage.sections) {
    put(`区画 ${sec.key}`, sec.title);
    put(`区画 ${sec.key} の注記`, sec.note);
    for (const a of sec.actions) {
      put(`ボタン ${a.key}`, a.label);
      put(`ボタン ${a.key} の?`, a.help);
      put(`ボタン ${a.key} の補足`, a.title);
      put(`ボタン ${a.key} の選択肢`, a.choice?.label);
    }
    for (const g of sec.groups) {
      put(`まとまり ${g.key}`, g.title);
      put(`まとまり ${g.key} の注記`, g.note);
      put(`まとまり ${g.key} の続き`, g.moreLabel);
      put(`まとまり ${g.key} の説明`, g.info?.text);
      for (const a of g.actions) {
        put(`ボタン ${a.key}`, a.label);
        put(`ボタン ${a.key} の?`, a.help);
        put(`ボタン ${a.key} の補足`, a.title);
        put(`ボタン ${a.key} の横`, a.chip?.added);
      }
    }
  }
  for (const f of allFields(stage)) out.push(...fieldTexts(stage.id, f, wh));
  return out;
}

function fieldTexts(stageId: string, f: FieldDef, wh: WorkingHousehold): ScreenText[] {
  const out: ScreenText[] = [];
  const put = (where: string, t: string | null | undefined) => {
    if (typeof t === "string" && t.trim() !== "") out.push({ where: `${stageId}: 欄 ${f.key} の${where}`, text: t });
  };
  put("名前", f.label);
  put("?", f.help);
  if (f.kind === "select") for (const o of f.options) put("選択肢", o.label);
  let st;
  try {
    st = f.get(wh);
  } catch {
    return out;
  }
  put("推定の根拠", st.estimated);
  put("仮の値の理由", st.assumed);
  put("内訳の推定", st.partEstimated);
  put("読み", st.derived);
  put("補助", st.hint);
  put("知らせ", st.warn);
  put("知らせのボタン", st.warnFix?.label);
  put("時点の読み", st.when?.read);
  return out;
}

/** 世帯ごとに画面に出る文を集める: 入力項目（全部）・確かめの一覧・世帯の中身の一覧・プランの違いの一覧と「変えたこと」 */
export function screenTexts(wh: WorkingHousehold): ScreenText[] {
  const out: ScreenText[] = [];
  for (const id of STAGE_IDS) out.push(...stageTexts(buildStage(id, wh), wh));
  for (const r of checkList(wh)) {
    out.push({ where: `確かめの一覧 ${r.card}`, text: r.label });
    if (r.detail !== null) out.push({ where: `確かめの一覧 ${r.card} の根拠`, text: r.detail });
    if (r.value != null) out.push({ where: `確かめの一覧 ${r.card} の値`, text: r.value });
    for (const a of r.actions) out.push({ where: `確かめの一覧 ${r.card} のボタン`, text: a.label });
  }
  for (const o of objectCards(wh)) out.push({ where: `世帯の中身の一覧 ${o.collection}`, text: o.label });
  if (wh.proposals.length > 0) {
    const self = roles(wh.request).find((r) => r.key === "self");
    const cat = buildCatalog(wh, self?.member.id ?? wh.request.input.household.members[0]!.id, null);
    for (const p of wh.proposals) {
      for (const r of diffRows(wh, cat, p.id)) {
        out.push({ where: `違いの一覧 ${p.name}`, text: r.label });
        out.push({ where: `違いの一覧 ${p.name} の前`, text: r.from });
        out.push({ where: `違いの一覧 ${p.name} の後`, text: r.to });
      }
      for (const c of changesOf(wh.proposals, p.id, wh, cat)) {
        out.push({ where: `変えたこと ${p.name}`, text: c.label });
        out.push({ where: `変えたこと ${p.name} の前`, text: c.from });
        out.push({ where: `変えたこと ${p.name} の後`, text: c.to });
        if (c.reviewNote !== null) out.push({ where: `変えたこと ${p.name} の要確認`, text: c.reviewNote });
      }
    }
  }
  return out.filter((x) => x.text.trim() !== "");
}

/** 画面の文に出てはいけない形（内部の名前・生の値・JSON・数え方「○つ」） */
const INTERNAL: readonly { what: string; re: RegExp }[] = [
  { what: "JSON", re: /\{"/ },
  { what: "内部の ID", re: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/ },
  { what: "英字のキー（小文字始まりの続き書き）", re: /(?<![A-Za-z])[a-z]+[A-Z][A-Za-z]*(?![A-Za-z])/ },
  { what: "生の値（小文字の英単語）", re: /(?<![A-Za-z.\-/@:])[a-z]{3,}(?![A-Za-z])/ },
  { what: "値の無い印", re: /\b(undefined|null|NaN)\b/ },
  // 欄・値・物の数を見せる形（「（4つ）」「12つ」）。文の中の「1つにまとめる」「最初の1つ」は数え方の表示でないので見ない
  { what: "「○つ」の数え方", re: /[（(][0-9０-９]+つ[）)]|[0-9０-９]{2,}つ/ },
];
/** 生の英字に見えても、画面の言葉として使う物（制度・商品の名前など） */
const ALLOWED_WORDS: ReadonlySet<string> = new Set(["iDeCo"]);

export function textProblems(texts: readonly ScreenText[]): string[] {
  const out = new Set<string>();
  for (const t of texts) {
    for (const p of INTERNAL) {
      const m = p.re.exec(t.text);
      if (m === null || ALLOWED_WORDS.has(m[0])) continue;
      out.add(`${t.where}: 「${t.text.length > 80 ? `${t.text.slice(0, 80)}…` : t.text}」に${p.what}「${m[0]}」`);
    }
  }
  return [...out];
}

const screenWords: WatchRule = {
  id: "screenWords",
  title: "画面に出る文字に、内部の名前・生の値・JSON・「○つ」が無い",
  check: (s) => textProblems(screenTexts(s.wh)),
};

/** 全部の決まり（並びはテストの並び） */
export const WATCH_RULES: readonly WatchRule[] = [
  schoolFeeZero,
  pastRetirementEstimate,
  workTypeEstimates,
  workToTableEnd,
  keptHomeVanishes,
  soldHomeLoanContinues,
  housingOverlapGap,
  purchaseDates,
  negativeNetWorthNow,
  careAndInheritanceAfterDeath,
  livingStagesRise,
  rowGrouping,
  allocationPassed,
  zeroCostBasis,
  outsideWithoutDeath,
  screenWords,
];
