// お金の行（0044）の、計算の要求を作るときの決まり（0035 の7・0036 の6）:
// - 基本の計算に入れない: 見込みが「不確実」（uncertain）で includeInBase が true でない、受け取る相続・遺贈・贈与の入るお金の行（種類が inheritance・giftReceived）と、
//   相続で受け継ぐ借金（inheritedFrom のある負債）。世帯のデータからは消さず、エンジンへ渡す要求からだけ外す（エンジンは変えない）。
//   ほかの種類の入るお金には広げない（当てにならない遺産で楽な結果を見る誤りは、相続に特有なため）
// - 結果の見方（保存しない自動の差分。0036 の6・0044 の追記）: 「すべて入れる」か「確実な分だけ」（見込みが「不確実」〔uncertain〕の入るお金の行の
//   すべてと、見込み（値は priority）が「不確実」〔want・wish〕の出るお金の行を外す）と、物ごとの入れ外し。基本の計算に入れない物も、ここで「入れて見る」ができる
//   （要求の写しで includeInBase を true にする。世帯もプランも変えない）
// どちらも差分を当てた後の作業中の世帯から作る要求に当てるので、プランでの見込み（likelihood・priority）・includeInBase の set が効く
// - 世帯に保存した表示だけの設定（相続税の目安の設定・遺したい額。0060）も、エンジンへ渡すときに外す（withoutStoredSettings）
// - 夢プラン（0103）: 種類が夢（dream）の出るお金の行は、エンジンにはふつうの一時的支出の行として渡す。「計算に入れない」（dream.include が false）の夢は
//   要求から外す。結果の見方では、夢は理由「夢」で1件ずつ入れ外しでき、「確実な分だけ」では外す。子への援助（教育の目標の gifts）の
//   見込みが「不確実」の物も、確実な分だけで外す
import type { Debt, EngineRequest, Household, IncomeFlow, IncomeFlowKind, PeriodicExpense } from "./types.ts";
import { officeEstimateNoFill, officeEstimateValues } from "./officeValues.ts";

/** 見込みが「不確実」なら基本の計算に入れない入るお金の種類（受け取る相続・遺贈・贈与） */
export const BASE_EXCLUDED_KINDS: ReadonlySet<IncomeFlowKind> = new Set(["inheritance", "giftReceived"]);

/** この入るお金の行を基本の計算から外すか */
export function excludedIncome(f: Pick<IncomeFlow, "kind" | "likelihood" | "includeInBase">): boolean {
  return BASE_EXCLUDED_KINDS.has(f.kind) && f.likelihood === "uncertain" && f.includeInBase !== true;
}

/** この負債（相続で受け継ぐ借金）を基本の計算から外すか */
export function excludedDebt(d: Pick<Debt, "inheritedFrom" | "likelihood" | "includeInBase">): boolean {
  return d.inheritedFrom !== undefined && d.likelihood === "uncertain" && d.includeInBase !== true;
}

/** 夢プランの1件（種類が夢の出るお金の行。0103） */
export const isDream = (p: Pick<PeriodicExpense, "kind">): boolean => p.kind === "dream";

/** 計算に入れない夢か（「計算に入れない」を選んだ夢。省略は入れる） */
export const dreamOff = (p: Pick<PeriodicExpense, "kind" | "dream">): boolean => isDream(p) && p.dream?.include === false;

/** 基本の計算に入れていない物の ID（入るお金の行・負債） */
export function excludedFromBase(h: Household): { incomes: string[]; debts: string[] } {
  return { incomes: (h.incomeFlows ?? []).filter(excludedIncome).map((f) => f.id), debts: (h.debts ?? []).filter(excludedDebt).map((d) => d.id) };
}

const withHousehold = (req: EngineRequest, h: Household): EngineRequest => ({ ...req, input: { ...req.input, household: h } });

/**
 * エンジンへ渡す要求（基本の計算に入れない物を外す）。外す物が無ければ同じ物を返す（要求の文字列が変わらず、計算し直さない）。
 * 外した入るお金の行・負債を指す物は無い（贈与・移し替えの結び付けは外した行を指しても計算に使わない）
 */
export function forEngine(req0: EngineRequest): EngineRequest {
  const req = withOfficeEstimateValues(withoutStoredSettings(req0));
  const h = req.input.household;
  const incomes = h.incomeFlows ?? [];
  const debts = h.debts ?? [];
  const expenses = h.periodicExpenses ?? [];
  const dropIncome = incomes.some(excludedIncome);
  const dropDebt = debts.some(excludedDebt);
  const dropDream = expenses.some(dreamOff);
  if (!dropIncome && !dropDebt && !dropDream) return req;
  return withHousehold(req, {
    ...h,
    ...(dropIncome ? { incomeFlows: incomes.filter((f) => !excludedIncome(f)) } : {}),
    ...(dropDebt ? { debts: debts.filter((d) => !excludedDebt(d)) } : {}),
    ...(dropDream ? { periodicExpenses: expenses.filter((p) => !dreamOff(p)) } : {}),
  });
}

/**
 * 事務所の推定の値（0111。事務所の既定値の画面で変えたマスタデータの値とエンジンが引く目安）と、推定で埋めない目安（0111 の2回目）を
 * 計算の要求に足す。要求がもう estimateValues・estimateNoFill を持っていればそのまま（事務所の既定値の画面の「代表の世帯で差を見る」は、
 * 比較する値を自分で入れる）。事務所の値が無ければ同じ物を返す
 */
export function withOfficeEstimateValues(req: EngineRequest): EngineRequest {
  const v = officeEstimateValues();
  const n = officeEstimateNoFill();
  const addV = v !== null && req.input.estimateValues === undefined;
  const addN = n !== null && req.input.estimateNoFill === undefined;
  if (!addV && !addN) return req;
  return { ...req, input: { ...req.input, ...(addV ? { estimateValues: { ...v } } : {}), ...(addN ? { estimateNoFill: [...n] } : {}) } };
}

/**
 * 世帯に保存した表示だけの設定を外す（0060）: 相続税の目安の設定（時点 points の無い inheritanceTax。目安を求める要求は時点を入れる。
 * inheritanceLine.ts・万一の死亡の想定）と、遺したい額（legacy）。どちらも計算のお金の流れに効かないので、外しても結果は同じで、
 * 設定を直しても計算し直さない。外す物が無ければ同じ物を返す
 */
export function withoutStoredSettings(req: EngineRequest): EngineRequest {
  const dropTax = req.input.inheritanceTax !== undefined && req.input.inheritanceTax.points === undefined;
  const dropLegacy = req.input.legacy !== undefined;
  if (!dropTax && !dropLegacy) return req;
  const { inheritanceTax, legacy: _legacy, ...rest } = req.input;
  void _legacy;
  return { ...req, input: { ...rest, ...(dropTax || inheritanceTax === undefined ? {} : { inheritanceTax }) } as EngineRequest["input"] };
}

/** 確実な分だけで外す行か（入るお金は見込みが「不確実」、出るお金は見込み〔priority〕が「不確実」。古い値の likely は確実、wish は不確実と同じ扱い） */
export const notCertainIncome = (f: Pick<IncomeFlow, "likelihood">): boolean => f.likelihood === "uncertain";
export const notNeededExpense = (e: Pick<PeriodicExpense, "priority">): boolean => e.priority === "want" || e.priority === "wish";
/** 確実な分だけで外す子への援助か（見込み〔priority〕が「不確実」。0103） */
export const notNeededGift = (g: { priority?: string }): boolean => g.priority === "want";

/** 結果の見方（保存しない）: 確実な分だけか（false は「すべて入れる」）と、物ごとの入れ外し（候補のキー → 入れるなら true。決まりのとおりの物は持たない） */
export interface RowsView {
  certainOnly: boolean;
  pick: Readonly<Record<string, boolean>>;
}

/** すべて入れる（いつもの計算。基本の計算に入れない物は外れたまま） */
export const ALL_ROWS: RowsView = { certainOnly: false, pick: {} };

/** 見方で入れ外しできる物 */
export interface ViewCandidate {
  /** 入れ外しのキー（「in:」「out:」「debt:」「gift:」＋ ID） */
  key: string;
  /** gift は子への援助（教育の目標の gifts の1件。0103） */
  side: "in" | "out" | "debt" | "gift";
  id: string;
  /**
   * 外れる理由: base＝基本の計算に入れない決まり（不確実な受け取る相続・贈与・受け継ぐ借金）、uncertain＝見込みが不確実、priority＝出るお金・子への援助の見込み（priority）が不確実、
   * dream＝夢プランの1件（0103。「計算に入れない」を選んだ夢は off）
   */
  reason: "base" | "uncertain" | "priority" | "dream";
  /** 夢で「計算に入れない」を選んでいる（ふだんも外れている。ここで入れて見られる） */
  off?: boolean;
}

/** 世帯の中の、見方で入れ外しできる物（入るお金・出るお金・受け継ぐ借金の並びの順） */
export function viewCandidates(h: Household): ViewCandidate[] {
  const out: ViewCandidate[] = [];
  for (const f of h.incomeFlows ?? []) {
    if (excludedIncome(f)) out.push({ key: `in:${f.id}`, side: "in", id: f.id, reason: "base" });
    else if (notCertainIncome(f)) out.push({ key: `in:${f.id}`, side: "in", id: f.id, reason: "uncertain" });
  }
  for (const e of h.periodicExpenses ?? []) {
    if (isDream(e)) out.push({ key: `out:${e.id}`, side: "out", id: e.id, reason: "dream", ...(dreamOff(e) ? { off: true } : {}) });
    else if (notNeededExpense(e)) out.push({ key: `out:${e.id}`, side: "out", id: e.id, reason: "priority" });
  }
  for (const g of h.goals ?? []) for (const x of g.education?.gifts ?? []) if (notNeededGift(x) && typeof x.id === "string") out.push({ key: `gift:${x.id}`, side: "gift", id: x.id, reason: "priority" });
  for (const d of h.debts ?? []) if (excludedDebt(d)) out.push({ key: `debt:${d.id}`, side: "debt", id: d.id, reason: "base" });
  return out;
}

/** 決まりのとおりなら外すか（基本の計算に入れない物と「計算に入れない」夢はいつも外す。ほかは確実な分だけのときに外す） */
export const ruleExcluded = (c: Pick<ViewCandidate, "reason" | "off">, certainOnly: boolean): boolean => c.reason === "base" || c.off === true || certainOnly;

/** この見方で外すか（物ごとの入れ外しがあればそれ、無ければ決まりのとおり） */
export function viewExcluded(c: Pick<ViewCandidate, "key" | "reason" | "off">, v: RowsView): boolean {
  const p = v.pick[c.key];
  return p !== undefined ? !p : ruleExcluded(c, v.certainOnly);
}

/** 物ごとの入れ外しを置く（決まりのとおりに戻すなら持たない） */
export function pickRow(v: RowsView, c: Pick<ViewCandidate, "key" | "reason" | "off">, include: boolean): RowsView {
  const { [c.key]: _old, ...rest } = v.pick;
  void _old;
  return { ...v, pick: include === !ruleExcluded(c, v.certainOnly) ? rest : { ...rest, [c.key]: include } };
}

/** 「すべて入れる｜確実な分だけ」を切り替える（物ごとの入れ外しは決まりのとおりに戻す） */
export const viewMode = (certainOnly: boolean): RowsView => ({ certainOnly, pick: {} });

/** いつもの計算と同じ見方か（すべて入れる・物ごとの入れ外しなし） */
export const isAllRows = (v: RowsView): boolean => !v.certainOnly && Object.keys(v.pick).length === 0;

/**
 * 見方を当てた要求（保存しない自動の差分）: 外す入るお金・出るお金の行を要求から外し、入れる基本の計算に入れない物は includeInBase を true にする。
 * 外す受け継ぐ借金は、エンジンへ渡すときにいつものとおり外れる（forEngine）。変える物が無ければ同じ物を返す（計算し直さない）
 */
export function applyRowsView(req: EngineRequest, v: RowsView): EngineRequest {
  if (isAllRows(v)) return req;
  const h = req.input.household;
  const cs = viewCandidates(h);
  if (cs.length === 0) return req;
  const drop = new Set<string>();
  const include = new Set<string>();
  for (const c of cs) {
    const ex = viewExcluded(c, v);
    if (ex && c.side !== "debt") drop.add(c.key);
    else if (!ex && (c.reason === "base" || c.off === true)) include.add(c.key);
  }
  if (drop.size === 0 && include.size === 0) return req;
  const incomes = h.incomeFlows ?? [];
  const expenses = h.periodicExpenses ?? [];
  const debts = h.debts ?? [];
  const goals = h.goals ?? [];
  const touch = (side: string, ids: readonly { id: string }[]) => ids.some((x) => drop.has(`${side}:${x.id}`) || include.has(`${side}:${x.id}`));
  const gifts = goals.flatMap((g) => (g.education?.gifts ?? []).flatMap((x) => (typeof x.id === "string" ? [{ id: x.id }] : [])));
  return withHousehold(req, {
    ...h,
    ...(touch("in", incomes) ? { incomeFlows: incomes.filter((f) => !drop.has(`in:${f.id}`)).map((f) => (include.has(`in:${f.id}`) ? { ...f, includeInBase: true } : f)) } : {}),
    // 「計算に入れない」夢を入れて見るときは、要求の写しで入れる（世帯もプランも変えない）
    ...(touch("out", expenses) ? { periodicExpenses: expenses.filter((e) => !drop.has(`out:${e.id}`)).map((e) => (include.has(`out:${e.id}`) ? { ...e, dream: { ...e.dream, include: true } } : e)) } : {}),
    ...(touch("debt", debts) ? { debts: debts.map((d) => (include.has(`debt:${d.id}`) ? { ...d, includeInBase: true } : d)) } : {}),
    ...(touch("gift", gifts)
      ? { goals: goals.map((g) => (g.education?.gifts === undefined || !g.education.gifts.some((x) => drop.has(`gift:${String(x.id)}`)) ? g : { ...g, education: { ...g.education, gifts: g.education.gifts.filter((x) => !drop.has(`gift:${String(x.id)}`)) } })) }
      : {}),
  });
}

/** 夢を全部外した要求（夢の無い場合と比較する1回の計算。0103）。計算に入る夢が無ければ同じ物を返す */
export function withoutDreams(req: EngineRequest): EngineRequest {
  const h = req.input.household;
  const expenses = h.periodicExpenses ?? [];
  if (!expenses.some((p) => isDream(p) && !dreamOff(p))) return req;
  return withHousehold(req, { ...h, periodicExpenses: expenses.filter((p) => !isDream(p)) });
}

/** 確実な分だけの要求（物ごとの入れ外しなし） */
export const certainOnly = (req: EngineRequest): EngineRequest => applyRowsView(req, viewMode(true));
