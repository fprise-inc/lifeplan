// お金の行（0044）の、計算の要求を作るときの決まり（0035 の7・0036 の6。2026-11-12 に見込みの扱いをそろえた）:
// - ふだんの計算に入れない: 見込みが「不確実」の物すべて。入るお金の行（likelihood が uncertain）・出るお金の行（priority が want・wish。夢を除く）・
//   子への援助（教育の目標の gifts の priority が want）・相続で受け継ぐ借金（likelihood が uncertain）。古い値の likely は確実、wish は不確実と読む。
//   入るお金の行と借金の includeInBase（前の版の「この行を計算に入れる」）が true なら、見込みが「不確実」でも入れる（確実と同じに読む。世帯ファイルは書き換えない）。
//   世帯のデータからは消さず、エンジンへ渡す要求からだけ外す（エンジンは変えない）。前は受け取る相続・贈与と借金だけを外していた
// - 夢プラン（0103）: 種類が夢（dream）の出るお金の行は、エンジンにはふつうの一時的支出の行として渡す。「最初から計算に入れない」（dream.include が false）の夢は外す
// - 結果の見方（保存しない自動の差分。0036 の6・0044 の追記）: 結果の画面の区画「これからの大きなお金」の物ごとのチェック。確実な物は外して見られ、
//   不確実な物と入れない夢は入れて見られる（要求の写しで includeInBase・priority・dream.include を書き換える。世帯もプランも変えない）
// どちらも差分を当てた後の作業中の世帯から作る要求に当てるので、プランでの見込み（likelihood・priority）・includeInBase の set が効く
// - 世帯に保存した表示だけの設定（相続税の目安の設定・遺したい額。0060）も、エンジンへ渡すときに外す（withoutStoredSettings）
import type { Debt, EngineRequest, Household, IncomeFlow, IncomeFlowKind, PeriodicExpense } from "./types.ts";
import { officeEstimateNoFill, officeEstimateValues } from "./officeValues.ts";

/** 受け取る相続・遺贈・贈与の入るお金の種類（区画「これからの大きなお金」では、確実な物も「受け取りの予定」に並べる） */
export const BASE_EXCLUDED_KINDS: ReadonlySet<IncomeFlowKind> = new Set(["inheritance", "giftReceived"]);

/** 見込みが「不確実」か（入るお金・借金は likelihood が uncertain、出るお金は priority が want・wish、子への援助は priority が want） */
export const notCertainIncome = (f: Pick<IncomeFlow, "likelihood">): boolean => f.likelihood === "uncertain";
export const notNeededExpense = (e: Pick<PeriodicExpense, "priority">): boolean => e.priority === "want" || e.priority === "wish";
export const notNeededGift = (g: { priority?: string }): boolean => g.priority === "want";

/** この入るお金の行をふだんの計算から外すか（見込みが「不確実」で、前の版の「この行を計算に入れる」〔includeInBase〕でない） */
export function excludedIncome(f: Pick<IncomeFlow, "likelihood" | "includeInBase">): boolean {
  return notCertainIncome(f) && f.includeInBase !== true;
}

/** この負債（相続で受け継ぐ借金）をふだんの計算から外すか */
export function excludedDebt(d: Pick<Debt, "inheritedFrom" | "likelihood" | "includeInBase">): boolean {
  return d.inheritedFrom !== undefined && d.likelihood === "uncertain" && d.includeInBase !== true;
}

/** 夢プランの1件（種類が夢の出るお金の行。0103） */
export const isDream = (p: Pick<PeriodicExpense, "kind">): boolean => p.kind === "dream";

/** 計算に入れない夢か（「最初から計算に入れない」を選んだ夢。省略は入れる） */
export const dreamOff = (p: Pick<PeriodicExpense, "kind" | "dream">): boolean => isDream(p) && p.dream?.include === false;

/** この出るお金の行をふだんの計算から外すか（見込みが「不確実」のふつうの行と、入れない夢） */
export const excludedExpense = (p: Pick<PeriodicExpense, "kind" | "dream" | "priority">): boolean => (isDream(p) ? dreamOff(p) : notNeededExpense(p));

/** ふだんの計算に入れていない物の ID（入るお金の行・負債・出るお金の行〔夢を除く〕・子への援助〔ID のある物〕） */
export function excludedFromBase(h: Household): { incomes: string[]; debts: string[]; expenses: string[]; gifts: string[] } {
  return {
    incomes: (h.incomeFlows ?? []).filter(excludedIncome).map((f) => f.id),
    debts: (h.debts ?? []).filter(excludedDebt).map((d) => d.id),
    expenses: (h.periodicExpenses ?? []).filter((p) => !isDream(p) && notNeededExpense(p)).map((p) => p.id),
    gifts: (h.goals ?? []).flatMap((g) => (g.education?.gifts ?? []).filter((x) => notNeededGift(x) && typeof x.id === "string").map((x) => x.id as string)),
  };
}

const withHousehold = (req: EngineRequest, h: Household): EngineRequest => ({ ...req, input: { ...req.input, household: h } });

/**
 * エンジンへ渡す要求（ふだんの計算に入れない物を外す）。外す物が無ければ同じ物を返す（要求の文字列が変わらず、計算し直さない）。
 * 外した入るお金の行・負債を指す物は無い（贈与・移し替えの結び付けは外した行を指しても計算に使わない）
 */
export function forEngine(req0: EngineRequest): EngineRequest {
  const req = withOfficeEstimateValues(withoutStoredSettings(req0));
  const h = req.input.household;
  const incomes = h.incomeFlows ?? [];
  const debts = h.debts ?? [];
  const expenses = h.periodicExpenses ?? [];
  const goals = h.goals ?? [];
  const dropIncome = incomes.some(excludedIncome);
  const dropDebt = debts.some(excludedDebt);
  const dropExpense = expenses.some(excludedExpense);
  const dropGift = goals.some((g) => (g.education?.gifts ?? []).some(notNeededGift));
  if (!dropIncome && !dropDebt && !dropExpense && !dropGift) return req;
  return withHousehold(req, {
    ...h,
    ...(dropIncome ? { incomeFlows: incomes.filter((f) => !excludedIncome(f)) } : {}),
    ...(dropDebt ? { debts: debts.filter((d) => !excludedDebt(d)) } : {}),
    ...(dropExpense ? { periodicExpenses: expenses.filter((p) => !excludedExpense(p)) } : {}),
    ...(dropGift ? { goals: goals.map((g) => (g.education?.gifts === undefined || !g.education.gifts.some(notNeededGift) ? g : { ...g, education: { ...g.education, gifts: g.education.gifts.filter((x) => !notNeededGift(x)) } })) } : {}),
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

/** 結果の見方（保存しない）: 物ごとの入れ外し（候補のキー → 入れるなら true。最初のとおりの物は持たない） */
export interface RowsView {
  pick: Readonly<Record<string, boolean>>;
}

/** いつもの計算（物ごとの入れ外しなし） */
export const ALL_ROWS: RowsView = { pick: {} };

/** 見方で入れ外しできる物（区画「これからの大きなお金」のチェックのある行） */
export interface ViewCandidate {
  /** 入れ外しのキー（「in:」「out:」「debt:」「gift:」＋ ID、繰上返済は「prepay:」＋借入の ID・「:」・何番目か） */
  key: string;
  /** gift は子への援助（教育の目標の gifts の1件。0103）、prepay は借入の繰上返済の1件 */
  side: "in" | "out" | "debt" | "gift" | "prepay";
  id: string;
  /** certain＝確実な物、uncertain＝見込みが不確実な物、dream＝夢プランの1件（0103） */
  reason: "certain" | "uncertain" | "dream";
  /** ふだんの計算に入れていない（見込みが不確実〔前の版の「この行を計算に入れる」を除く〕・「最初から計算に入れない」夢）。最初はチェックなし */
  off?: boolean;
}

/**
 * 世帯の中の、見方で入れ外しできる物: 入るお金は見込みが不確実な物と受け取る相続・贈与、出るお金は夢と、月々でない物（見込みが不確実なら月々の物も）、
 * 子への援助（ID のある物）、繰上返済、相続で受け継ぐ借金。家の購入（頭金）は入れ外ししない
 */
export function viewCandidates(h: Household): ViewCandidate[] {
  const out: ViewCandidate[] = [];
  const add = (side: ViewCandidate["side"], id: string, reason: ViewCandidate["reason"], off: boolean) => out.push({ key: `${side}:${id}`, side, id, reason, ...(off ? { off: true } : {}) });
  for (const f of h.incomeFlows ?? []) {
    const unc = notCertainIncome(f) && f.includeInBase !== true;
    if (unc || BASE_EXCLUDED_KINDS.has(f.kind)) add("in", f.id, unc ? "uncertain" : "certain", unc);
  }
  for (const e of h.periodicExpenses ?? []) {
    if (isDream(e)) add("out", e.id, "dream", dreamOff(e));
    else if (notNeededExpense(e)) add("out", e.id, "uncertain", true);
    else if (e.monthly !== true) add("out", e.id, "certain", false);
  }
  for (const g of h.goals ?? []) for (const x of g.education?.gifts ?? []) if (typeof x.id === "string") add("gift", x.id, notNeededGift(x) ? "uncertain" : "certain", notNeededGift(x));
  for (const d of h.debts ?? []) {
    (d.prepayments ?? []).forEach((_p, i) => add("prepay", `${d.id}:${String(i)}`, "certain", false));
    if (d.inheritedFrom !== undefined) add("debt", d.id, excludedDebt(d) ? "uncertain" : "certain", excludedDebt(d));
  }
  return out;
}

/** 物ごとの入れ外しが無いときに外すか（ふだんの計算に入れていない物） */
export const ruleExcluded = (c: Pick<ViewCandidate, "off">): boolean => c.off === true;

/** この見方で外すか（物ごとの入れ外しがあればそれ、無ければふだんの計算のとおり） */
export function viewExcluded(c: Pick<ViewCandidate, "key" | "off">, v: RowsView): boolean {
  const p = v.pick[c.key];
  return p !== undefined ? !p : ruleExcluded(c);
}

/** 物ごとの入れ外しを置く（ふだんの計算のとおりに戻すなら持たない） */
export function pickRow(v: RowsView, c: Pick<ViewCandidate, "key" | "off">, include: boolean): RowsView {
  const { [c.key]: _old, ...rest } = v.pick;
  void _old;
  return { pick: include === !ruleExcluded(c) ? rest : { ...rest, [c.key]: include } };
}

/** いつもの計算と同じ見方か（物ごとの入れ外しなし） */
export const isAllRows = (v: RowsView): boolean => Object.keys(v.pick).length === 0;

/**
 * 見方を当てた要求（保存しない自動の差分）: 外す物を要求から外し、ふだんは入れていない物を入れるときは要求の写しで入れる
 * （入るお金・借金は includeInBase を true、不確実な出るお金・子への援助は priority を need、夢は dream.include を true）。
 * 変える物が無ければ同じ物を返す（計算し直さない）
 */
export function applyRowsView(req: EngineRequest, v: RowsView): EngineRequest {
  if (isAllRows(v)) return req;
  const h = req.input.household;
  const drop = new Set<string>();
  const include = new Set<string>();
  for (const c of viewCandidates(h)) {
    const ex = viewExcluded(c, v);
    if (ex && c.off !== true) drop.add(c.key);
    else if (!ex && c.off === true) include.add(c.key);
  }
  if (drop.size === 0 && include.size === 0) return req;
  const has = (k: string) => drop.has(k) || include.has(k);
  const incomes = h.incomeFlows ?? [];
  const expenses = h.periodicExpenses ?? [];
  const debts = h.debts ?? [];
  const goals = h.goals ?? [];
  const gift = (x: Record<string, unknown>) => `gift:${String(x.id)}`;
  return withHousehold(req, {
    ...h,
    ...(incomes.some((f) => has(`in:${f.id}`)) ? { incomeFlows: incomes.filter((f) => !drop.has(`in:${f.id}`)).map((f) => (include.has(`in:${f.id}`) ? { ...f, includeInBase: true } : f)) } : {}),
    ...(expenses.some((e) => has(`out:${e.id}`))
      ? { periodicExpenses: expenses.filter((e) => !drop.has(`out:${e.id}`)).map((e) => (!include.has(`out:${e.id}`) ? e : isDream(e) ? { ...e, dream: { ...e.dream, include: true } } : { ...e, priority: "need" as const })) }
      : {}),
    ...(debts.some((d) => has(`debt:${d.id}`) || (d.prepayments ?? []).some((_p, i) => drop.has(`prepay:${d.id}:${String(i)}`)))
      ? {
          debts: debts
            .filter((d) => !drop.has(`debt:${d.id}`))
            .map((d) => {
              const pre = d.prepayments?.filter((_p, i) => !drop.has(`prepay:${d.id}:${String(i)}`));
              const d2 = pre !== undefined && pre.length !== d.prepayments?.length ? { ...d, prepayments: pre } : d;
              return include.has(`debt:${d.id}`) ? { ...d2, includeInBase: true } : d2;
            }),
        }
      : {}),
    ...(goals.some((g) => (g.education?.gifts ?? []).some((x) => has(gift(x))))
      ? { goals: goals.map((g) => (g.education?.gifts === undefined ? g : { ...g, education: { ...g.education, gifts: g.education.gifts.filter((x) => !drop.has(gift(x))).map((x) => (include.has(gift(x)) ? { ...x, priority: "need" as const } : x)) } })) }
      : {}),
  });
}

/** 夢を全部外した要求（提案書の「ご家族の夢」の要約の1回の計算。0103）。計算に入る夢が無ければ同じ物を返す */
export function withoutDreams(req: EngineRequest): EngineRequest {
  const h = req.input.household;
  const expenses = h.periodicExpenses ?? [];
  if (!expenses.some((p) => isDream(p) && !dreamOff(p))) return req;
  return withHousehold(req, { ...h, periodicExpenses: expenses.filter((p) => !isDream(p)) });
}
