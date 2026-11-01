// 数を「候補」にする（0034 の8）。外から来た案を候補として受け、FP が承認して取り込む仕組み（0008 の5。ヒアリングの取り込み・AIの提案と同じ形）。
// - 候補の形は差分と同じ: {id, target, item, op, value, before, enabled, origin, source, sourceRef, status, confidence?}
// - 出どころは origin.kind = "import"（明細の取り込み）、ref は取り込んだ記録（StatementApplication）の ID。値の箱は推定
//   （method: statementAverage・statementAnnual、basis: 期間と月の数）。承認するまで計算エンジンは受け付けない（承認の記録が要る）
// - 取り込む先: 基本生活費（今の欄が内訳なら内訳を、合計なら合計を置き換える。無ければ足す）、年1回の支払い（基本生活費のカードの「年払い・数年おきの
//   暮らしの支出」の行として足す。車・住まいの修繕は一時的支出の行）、家電・家具の店の3万円以上の買い物（同じ区画の「家電・家具の買い替え」の1行）。
//   住居・教育・保険・車は、それぞれの入力の欄で入れるので候補にしない（summary.reference の参考の値）
import { categoryInfo, LEGACY_LIVING_SPLIT, LIVING_LABELS, periodicRowOf, type LegacyLivingCategory, type LivingCategory } from "./classify/categories.ts";
import { monthsText, MIN_DAYS_FOR_CANDIDATE, type StatementSummary } from "./summary.ts";
import { looseKey } from "./text/normalize.ts";

/** 値の箱（engine の ValueBox と同じ形） */
export interface Box<T> {
  readonly value?: T;
  readonly state: "confirmed" | "unknown" | "notApplicable" | "estimated";
  readonly origin: { readonly kind: string; readonly ref?: string };
  readonly approval?: { readonly by: "fp"; readonly at: string; readonly candidate?: string };
  readonly estimate?: { readonly method: string; readonly basis: string };
}

export interface LivingExpenseLike {
  readonly id: string;
  readonly mode: "total" | "byCategory";
  readonly from?: unknown;
  readonly to?: unknown;
  readonly monthly?: Box<number>;
  readonly categories?: readonly { readonly category: LivingCategory; readonly monthly: Box<number> }[];
  readonly [k: string]: unknown;
}

export interface PeriodicExpenseLike {
  readonly id: string;
  readonly label?: string;
  readonly row: string;
  readonly [k: string]: unknown;
}

/** 候補を作るのに読む世帯の部分 */
export interface CandidateHousehold {
  readonly livingExpenses?: readonly LivingExpenseLike[];
  readonly periodicExpenses?: readonly PeriodicExpenseLike[];
}

export interface StatementCandidate {
  readonly id: string;
  readonly target: { readonly object: string };
  readonly collection: "livingExpenses" | "periodicExpenses";
  readonly item: string;
  readonly op: "set" | "add";
  readonly value: unknown;
  readonly before: unknown;
  readonly enabled: true;
  readonly origin: { readonly kind: "import"; readonly ref: string };
  readonly source: "import";
  readonly sourceRef: string;
  readonly status: "pending" | "needsReview";
  readonly confidence?: "high" | "medium";
  /** 画面の見出し（例: 基本生活費の内訳・自動車税） */
  readonly title: string;
  readonly note: string | null;
}

export interface CandidateOptions {
  /** 取り込んだ記録の ID（値の箱の origin.ref） */
  readonly ref: string;
  /** 計算基準日（YYYY-MM）。年1回の支払いの次の回をこの月より後に置く */
  readonly baseMonth: string;
  readonly newId: () => string;
}

/** 家電・家具の買い替えの行の名前と間隔（アプリの基本生活費の年払いのひな形「家電・家具の買い替え」と同じ。0100 の追記） */
export const DURABLE_LABEL = "家電・家具の買い替え";
export const DURABLE_EVERY_YEARS = 8;

const box = (value: number, ref: string, method: string, basis: string): Box<number> => ({ value, state: "estimated", origin: { kind: "import", ref }, estimate: { method, basis } });

/** 次の回の年月（最後に使った月を、計算基準日より後になるまで1年ずつ進める） */
function nextOccurrence(lastDate: string, everyYears: number, baseMonth: string): string {
  let y = Number(lastDate.slice(0, 4));
  const m = lastDate.slice(5, 7);
  while (`${y}-${m}` <= baseMonth) y += everyYears;
  return `${y}-${m}`;
}

/** 数から候補を作る */
export function buildCandidates(summary: StatementSummary, household: CandidateHousehold, o: CandidateOptions): StatementCandidate[] {
  const out: StatementCandidate[] = [];
  if (summary.days <= 0 || summary.from === null || summary.to === null) return out;
  const basis = `明細の取り込み（${summary.from}〜${summary.to}、${summary.months}か月）の使った日での月平均`;
  const short = summary.days < MIN_DAYS_FOR_CANDIDATE;
  const notes: string[] = [];
  if (short) notes.push(`期間が ${monthsText(summary.days)} か月と短いため、参考の値です`);
  if (summary.review > 0) notes.push(`迷う行が ${summary.review} 行残っています`);
  const status: StatementCandidate["status"] = short || summary.review > 0 ? "needsReview" : "pending";
  const base = { enabled: true as const, origin: { kind: "import" as const, ref: o.ref }, source: "import" as const, sourceRef: o.ref };

  // 基本生活費
  const cats = summary.living.filter((l) => l.monthly > 0).map((l) => ({ category: l.category, monthly: box(l.monthly, o.ref, "statementAverage", basis) }));
  if (cats.length > 0) {
    const cur = (household.livingExpenses ?? [])[0];
    const note = [`合計 月${summary.livingTotal.toLocaleString("ja-JP")}円（${summary.living.map((l) => `${LIVING_LABELS[l.category]} ${l.monthly.toLocaleString("ja-JP")}円`).join("・")}）`, ...notes].join("。");
    if (cur === undefined) {
      const id = o.newId();
      out.push({ ...base, id: o.newId(), target: { object: id }, collection: "livingExpenses", item: "livingExpense.mode", op: "add", value: { id, mode: "byCategory", categories: cats, growth: { kind: "inflation" } }, before: null, status, title: "基本生活費（内訳）", note });
    } else if (cur.mode === "byCategory") {
      // 明細に出てこない内訳（仕送りなど）は今の値を残す。前の分け方の内訳（交通・通信費、その他の消費）は、それを分けた今の内訳のどれかが
      // 明細に出てくれば残さない（明細の値で置き換える。残すと同じ支出を二重に数える。0100）
      const has = (c: LivingCategory) => cats.some((x) => x.category === c);
      const replaced = (c: LivingCategory) => has(c) || (c in LEGACY_LIVING_SPLIT && LEGACY_LIVING_SPLIT[c as LegacyLivingCategory].some(has));
      const kept = (cur.categories ?? []).filter((c) => !replaced(c.category));
      const legacy = (cur.categories ?? []).filter((c) => !has(c.category) && replaced(c.category));
      const notesHere = [
        ...(kept.length > 0 ? [`明細に出てこない内訳（${kept.map((k) => LIVING_LABELS[k.category]).join("・")}）は今の値を残します`] : []),
        ...legacy.map((k) => `前の分け方の${LIVING_LABELS[k.category]}は、明細の${LEGACY_LIVING_SPLIT[k.category as LegacyLivingCategory].filter(has).map((c) => LIVING_LABELS[c]).join("・")}で置き換えます`),
      ];
      out.push({ ...base, id: o.newId(), target: { object: cur.id }, collection: "livingExpenses", item: "livingExpense.categories", op: "set", value: [...cats, ...kept], before: cur.categories ?? null, status, title: "基本生活費の内訳", note: [note, ...notesHere].join("。") });
    } else {
      out.push({ ...base, id: o.newId(), target: { object: cur.id }, collection: "livingExpenses", item: "livingExpense.monthly", op: "set", value: box(summary.livingTotal, o.ref, "statementAverage", basis), before: cur.monthly ?? null, status, title: "基本生活費（月の合計）", note });
    }
  }

  // 年1回の支払い（保険・教育・税は、それぞれの欄で入れるので候補にしない。家電・家具の買い替えは下でまとめる）
  const existing = new Set((household.periodicExpenses ?? []).map((p) => looseKey(p.label ?? "")));
  for (const it of summary.oneOffs) {
    if (it.durable === true || it.annual === undefined || it.annual.confidence === "low") continue;
    const g = it.category === null ? null : categoryInfo(it.category).group;
    if (g === "insurance" || g === "education" || g === "tax" || g === "transfer" || g === "income") continue;
    const id = o.newId();
    const last = it.occurrences[it.occurrences.length - 1] as { date: string; amount: number };
    const at = nextOccurrence(last.date, it.annual.everyYears, o.baseMonth);
    const dupName = existing.has(looseKey(it.label));
    const n = [`${it.occurrences.map((x) => `${x.date} ${x.amount.toLocaleString("ja-JP")}円`).join("・")}`, it.annual.everyYears === 2 ? "2年に1回" : "年1回", ...(dupName ? ["同じ名前の支出がすでにあります"] : [])].join("。");
    // 車・住まいの修繕は今までどおり一時的支出の行（それぞれのカードの物と見比べる）。ほかは基本生活費のカードの「年払い・数年おきの暮らしの支出」（表の行は基本生活費に含める。医療は医療・介護）
    const row = it.category === null ? "cf.expense.lumpSum.other" : periodicRowOf(it.category, it.label);
    const annual = row !== "cf.expense.lumpSum.car" && row !== "cf.expense.housing.maintenance";
    out.push({
      ...base,
      id: o.newId(),
      target: { object: id },
      collection: "periodicExpenses",
      item: "periodicExpense.amount",
      op: "add",
      value: {
        id,
        label: it.label.slice(0, 40),
        ...(annual ? { kind: "livingAnnual" } : {}),
        row: annual ? (row === "cf.expense.care.medical" ? row : "cf.expense.living") : row,
        from: { at },
        to: null,
        everyYears: it.annual.everyYears,
        amount: box(it.amount, o.ref, "statementAnnual", `明細の取り込み（${it.occurrences.map((x) => x.date).join("・")}）`),
      },
      before: null,
      status: dupName || it.annual.confidence !== "high" || short ? "needsReview" : "pending",
      confidence: it.annual.confidence,
      title: `${annual ? "年払いの暮らしの支出" : "一時的支出"}: ${it.label.slice(0, 40)}`,
      note: n,
    });
  }
  // 家電・家具の買い替え（家電・家具の店の3万円以上の買い物。月平均の日用品から外した分）: 基本生活費のカードの年払いの「家電・家具の買い替え」の
  // 1行にまとめる。額は期間の買い物の合計、間隔はよくある目安（アプリのひな形と同じ8年ごと）。年に何回あるかは明細から分からないので、
  // いつも要確認にして、FP がその場で額・間隔・入れるかを決める
  const durables = summary.oneOffs.filter((it) => it.durable === true);
  const occ = durables.flatMap((it) => it.occurrences.map((x) => ({ ...x, label: it.label }))).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  // 一部の返品（負の行）は合計から差し引く。件数と次の回は買い物の行で数える
  const buys = occ.filter((x) => x.amount > 0);
  const total = occ.reduce((n, x) => n + x.amount, 0);
  if (buys.length > 0 && total > 0) {
    const last = buys[buys.length - 1] as { date: string };
    const id = o.newId();
    const dup = (household.periodicExpenses ?? []).some((p) => /家電|家具/u.test(p.label ?? ""));
    const list = occ.map((x) => `${x.date} ${x.label.slice(0, 20)} ${x.amount.toLocaleString("ja-JP")}円`).join("・");
    out.push({
      ...base,
      id: o.newId(),
      target: { object: id },
      collection: "periodicExpenses",
      item: "periodicExpense.amount",
      op: "add",
      value: {
        id,
        label: DURABLE_LABEL,
        kind: "livingAnnual",
        row: "cf.expense.living",
        from: { at: nextOccurrence(last.date, DURABLE_EVERY_YEARS, o.baseMonth) },
        to: null,
        everyYears: DURABLE_EVERY_YEARS,
        amount: box(total, o.ref, "statementAnnual", `明細の取り込み（家電・家具の店の3万円以上の買い物 ${buys.length}件の合計${occ.length > buys.length ? "（返品を差し引く）" : ""}。${occ.map((x) => x.date).join("・")}）。間隔はよくある目安の${DURABLE_EVERY_YEARS}年ごと`),
      },
      before: null,
      status: "needsReview",
      title: `年払いの暮らしの支出: ${DURABLE_LABEL}`,
      note: [
        list,
        `合計 ${total.toLocaleString("ja-JP")}円を月平均の日用品から外し、${DURABLE_EVERY_YEARS}年ごと（よくある間隔の目安）の買い替えとして入れます。額と間隔はこの世帯に合わせて直してください（3万円未満の買い物は日用品のまま）`,
        ...(dup ? ["家電・家具の支出がすでにあります"] : []),
      ].join("。"),
    });
  }
  return out;
}

/** 承認した候補を計算の要求の世帯に入れる（承認の記録を値の箱に付ける）。世帯は写して返す */
export function applyCandidates<H extends CandidateHousehold>(household: H, candidates: readonly StatementCandidate[], selected: ReadonlySet<string>, at: string): H {
  const h = structuredClone(household) as H & { livingExpenses?: LivingExpenseLike[]; periodicExpenses?: PeriodicExpenseLike[] };
  // 承認の記録は、この候補が作った値の箱（出どころがこの取り込みの記録 ref のもの）にだけ付ける。内訳を置き換える候補が残す今の内訳
  // （前の明細の取り込みで承認した仕送りなど）は、今回承認したものではないので、前の承認の記録のまま写す
  const stamp = (v: unknown, c: StatementCandidate): unknown => {
    if (Array.isArray(v)) return v.map((x) => stamp(x, c));
    if (v === null || typeof v !== "object") return v;
    const o = { ...(v as Record<string, unknown>) };
    for (const k of Object.keys(o)) o[k] = stamp(o[k], c);
    const origin = o.origin as { kind?: string; ref?: string } | undefined;
    if (typeof o.state === "string" && origin?.kind === "import" && origin.ref === c.origin.ref) o.approval = { by: "fp", at, candidate: c.id };
    return o;
  };
  for (const c of candidates) {
    if (!selected.has(c.id)) continue;
    const value = stamp(c.value, c);
    if (c.collection === "livingExpenses") {
      const list = (h.livingExpenses = [...(h.livingExpenses ?? [])]);
      if (c.op === "add") list.push(value as LivingExpenseLike);
      else {
        const i = list.findIndex((x) => x.id === c.target.object);
        if (i < 0) continue;
        const cur = list[i] as LivingExpenseLike;
        list[i] = c.item === "livingExpense.categories" ? { ...cur, mode: "byCategory", categories: value as LivingExpenseLike["categories"] } : { ...cur, monthly: value as Box<number> };
      }
    } else if (c.op === "add") {
      h.periodicExpenses = [...(h.periodicExpenses ?? []), value as PeriodicExpenseLike];
    }
  }
  return h;
}
