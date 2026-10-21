// 黒字のうち貯まる割合（ゆとりの支出）と生活防衛資金（0031）の、画面の側の読み書きと説明の材料（作業の層）。
// - 前提の読み書き（assumptions.surplusSaving・assumptions.emergencyReserve）。空にすると前提ごと外す（今まで通りの計算に戻る）
// - 根拠・説明モードの文の材料（その年の黒字・貯まる額・ゆとりの支出、生活防衛資金の目安）
// - 控えから実際の貯まり方を出す: 控えの時点の金融資産＋その間の見込みの黒字と、今の実際の金融資産を比べる（自動では入れない）
import type { EmergencyReserveSetting, EngineRequest, SurplusSavingRule, SurplusSavingSetting, TableCell, Timepoint } from "../engine/types.ts";
import { parseYm } from "./levers.ts";
import { SURPLUS_ROW } from "./present.ts";

const under = (row: string, prefix: string) => row === prefix || row.startsWith(prefix + ".");

// ---- 前提の読み書き ----

export const surplusOf = (req: EngineRequest): SurplusSavingSetting | undefined => req.input.assumptions?.surplusSaving;
export const reserveOf = (req: EngineRequest): EmergencyReserveSetting | undefined => req.input.assumptions?.emergencyReserve;

/** 前提の欄を書き換えた写し（空の前提は外す） */
function withAssumption(req: EngineRequest, name: "surplusSaving" | "emergencyReserve", v: object | undefined): EngineRequest {
  const request = structuredClone(req);
  const a = (request.input.assumptions ??= { investmentReturn: { default: "0.01" } }) as Record<string, unknown>;
  const empty = v === undefined || Object.values(v).every((x) => x === undefined || (Array.isArray(x) && x.length === 0));
  if (empty) delete a[name];
  else a[name] = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined && !(Array.isArray(x) && x.length === 0)));
  return request;
}

export function setSurplus(req: EngineRequest, next: SurplusSavingSetting | undefined): EngineRequest {
  return withAssumption(req, "surplusSaving", next);
}

export function setReserve(req: EngineRequest, next: EmergencyReserveSetting | undefined): EngineRequest {
  return withAssumption(req, "emergencyReserve", next);
}

/** 今の割合（入れていなければ null＝100%） */
export const surplusRatioOf = (req: EngineRequest): string | null => surplusOf(req)?.ratio ?? null;

/** 割合を入れる（null は外す。上限・期間の組は残す） */
export function setSurplusRatio(req: EngineRequest, ratio: string | null): EngineRequest {
  const cur = surplusOf(req) ?? {};
  const { ratio: _r, ...rest } = cur;
  void _r;
  return setSurplus(req, ratio === null ? rest : { ...rest, ratio });
}

/** 生活防衛資金の月数（金額で入れているとき・入れていないときは null） */
export const reserveMonthsOf = (req: EngineRequest): number | null => {
  const r = reserveOf(req);
  return r === undefined || r.amount !== undefined ? null : (r.months ?? null);
};

// ---- 根拠・説明の材料 ----

const sumRow = (table: readonly TableCell[], year: number, pred: (row: string) => boolean) => table.reduce((s, c) => (c.year === year && pred(c.row) ? s + c.amount : s), 0);

/** その年に当てはまる組（始まりの組の後に、期間の組を年の順に重ねる。エンジンと同じ決まり） */
export function ruleFor(s: SurplusSavingSetting, year: number, yearOf: (t: Timepoint) => number | null): SurplusSavingRule {
  let hit: SurplusSavingRule = { ...(s.ratio !== undefined ? { ratio: s.ratio } : {}), ...(s.cap !== undefined ? { cap: s.cap } : {}) };
  const changes = (s.changes ?? []).map((c, i) => ({ c, i, y: yearOf(c.from) })).filter((x): x is { c: (typeof x)["c"]; i: number; y: number } => x.y !== null);
  changes.sort((a, b) => a.y - b.y || a.i - b.i);
  for (const x of changes) if (x.y <= year) hit = { ...(x.c.ratio !== undefined ? { ratio: x.c.ratio } : {}), ...(x.c.cap !== undefined ? { cap: x.c.cap } : {}) };
  return hit;
}

/** その年の黒字の内訳: 年間収支（ゆとりの支出を引く前）・一時金の収入・黒字・貯まる額・ゆとりの支出 */
export function surplusBreakdown(table: readonly TableCell[], year: number): { net: number; lump: number; surplus: number; saved: number; spend: number } {
  const spend = sumRow(table, year, (r) => r === SURPLUS_ROW);
  const after = sumRow(table, year, (r) => r === "cf.net");
  const lump = sumRow(table, year, (r) => under(r, "cf.income.lumpSum"));
  const net = after + spend;
  const surplus = net - lump;
  return { net, lump, surplus, saved: surplus - spend, spend };
}

const man = (v: number) => {
  const x = Math.round(v / 1000) / 10;
  return `${Number.isInteger(x) ? x.toLocaleString("ja-JP") : x.toFixed(1)}万円`;
};
const pct = (r: string) => `${Math.round(Number(r) * 1000) / 10}%`;

/** 割合・上限の短い文（例: 「60%」「年200万円まで」「60%・年200万円まで」） */
export function ruleText(r: SurplusSavingRule): string {
  const parts = [r.ratio !== undefined ? pct(r.ratio) : "", r.cap !== undefined ? `年${man(r.cap)}まで` : ""].filter((x) => x !== "");
  return parts.length === 0 ? "100%" : parts.join("・");
}

/** 根拠の表示の一言（ゆとりの支出のマス） */
export function surplusEvidenceNote(req: EngineRequest, table: readonly TableCell[], year: number): string | null {
  const s = surplusOf(req);
  if (s === undefined) return null;
  const b = surplusBreakdown(table, year);
  const rule = ruleFor(s, year, (t) => yearOfTimepoint(req, t));
  const lump = b.lump > 0 ? `（年間収支 ${man(b.net)} − 退職金などの一時金 ${man(b.lump)}）` : "";
  if (b.surplus <= 0) return `${year}年は黒字ではないので、ゆとりの支出はありません。`;
  return `${year}年の黒字 ${man(b.surplus)}${lump}のうち、貯まる割合（${ruleText(rule)}）で貯まるのは ${man(b.saved)}。残りの ${man(b.spend)} を、実際には使ってしまう「ゆとりの支出」として支出に入れています（赤字の年は入れません）。`;
}

/** 根拠の表示の一言（生活防衛資金のマス） */
export function reserveEvidenceNote(req: EngineRequest, table: readonly TableCell[], year: number): string | null {
  const r = reserveOf(req);
  if (r === undefined) return null;
  const target = sumRow(table, year, (row) => row === "cf.balance.financial.reserveTarget");
  const how = r.amount !== undefined ? `入れた金額 ${man(r.amount)}` : `その年の基本生活費の${r.months ?? 0}か月分 ${man(target)}`;
  return `生活防衛資金の目安は${how}。運用せず預金の利回りで持ち、ほかのお金を使い切るまで取り崩しません。「金融資産は○歳まで持つ」は${r.countInLasting === true ? "生活防衛資金を含めて" : "生活防衛資金を除いて"}判定します。`;
}

/** 年月・年齢・できごとの時点の年（年月と年齢だけ。できごとは null） */
export function yearOfTimepoint(req: EngineRequest, t: Timepoint): number | null {
  if (t.at !== undefined) return Number(t.at.slice(0, 4));
  const ma = t.memberAge;
  if (ma !== undefined) {
    const m = req.input.household.members.find((x) => x.id === ma.member);
    if (m === undefined) return null;
    const { y, m: mo } = parseYm(m.birth.birthYearMonth);
    return y + ma.years + Math.floor((mo - 1 + (ma.months ?? 0)) / 12);
  }
  return null;
}

// ---- 控えから実際の貯まり方を出す ----

/** 金融資産に入れない器（不動産・その他の資産・保険） */
const NOT_FINANCIAL = new Set(["realEstate", "otherAsset", "insurance"]);

/** 入力の金融資産の合計（器の時価。不動産・その他の資産・保険を除く） */
export function financialInputs(req: EngineRequest): number {
  return (req.input.household.accounts ?? []).filter((a) => !NOT_FINANCIAL.has(a.kind)).reduce((s, a) => s + (a.marketValue?.value ?? 0), 0);
}

/** 控えから出す実際の割合の材料と結果 */
export interface ActualRatio {
  /** 実際に貯まった割合（0〜1。5% の刻みに切り下げ）。出せないときは null */
  ratio: number | null;
  /** 出せないときの理由 */
  reason: string | null;
  /** 控えの日付（例: 「2025年10月」） */
  from: string;
  months: number;
  /** 控えの時点の金融資産・今の実際の金融資産・その間の見込みの黒字・見込みの運用益（差し引いた） */
  start: number;
  now: number;
  expectedSurplus: number;
  expectedReturns: number;
  /** 実際に増えた分（今−控えの時点−見込みの運用益） */
  saved: number;
}

/** 控えから実際の貯まり方を出すのに要る最短の期間（か月） */
export const ACTUAL_MIN_MONTHS = 6;

/**
 * 控えの時点の金融資産＋その間の見込みの黒字と、今の実際の金融資産を比べて「この期間に実際に貯まった割合」を出す。
 * - 期間: 控えを作った月から、今の計算の基準の月まで（「前回と比べる」と同じ。6か月未満なら出さない）
 * - 見込みの黒字: 控えの入力で計算した年間収支（ゆとりの支出を引く前）から一時金の収入を除き、月の数で按分する（控えの計算の最初の年より前の月は最初の年の値）
 * - 運用益: 控えの見込みの運用益を、実際に増えた分から差し引く（相場で増えた分を「貯まった」と数えない控えめな扱い）
 * - 割合は 0〜100% に収め、5% の刻みに切り下げる
 */
export function actualSavingRatio(o: { snapshot: { createdAt: string; req: EngineRequest; table: readonly TableCell[] }; current: EngineRequest }): ActualRatio {
  const m = /^(\d{4})-(\d{2})/.exec(o.snapshot.createdAt);
  const now = parseYm(o.current.input.baseMonth);
  const fromY = m === null ? now.y : Number(m[1]);
  const fromM = m === null ? now.m : Number(m[2]);
  const months = (now.y - fromY) * 12 + (now.m - fromM);
  const start = financialInputs(o.snapshot.req);
  const actual = financialInputs(o.current);
  const base: Omit<ActualRatio, "ratio" | "reason"> = { from: `${fromY}年${fromM}月`, months, start, now: actual, expectedSurplus: 0, expectedReturns: 0, saved: 0 };
  if (months < ACTUAL_MIN_MONTHS) return { ...base, ratio: null, reason: `控えから${ACTUAL_MIN_MONTHS}か月以上たつと、実際の貯まり方を出します。` };
  const t = o.snapshot.table;
  const years = [...new Set(t.filter((c) => c.row === "cf.net").map((c) => c.year))].sort((a, b) => a - b);
  if (years.length === 0) return { ...base, ratio: null, reason: "控えの計算の結果がありません。" };
  const sb = parseYm(o.snapshot.req.input.baseMonth);
  const lenOf = (y: number) => (y === sb.y ? 13 - sb.m : 12);
  const first = years[0] as number;
  const last = years.at(-1) as number;
  let surplus = 0;
  let returns = 0;
  for (let i = 0; i < months; i++) {
    const mi = fromM - 1 + i;
    const y = Math.min(last, Math.max(first, fromY + Math.floor(mi / 12)));
    const b = surplusBreakdown(t, y);
    const len = lenOf(y);
    surplus += b.surplus / len;
    returns += sumRow(t, y, (r) => r === "cf.balance.return") / len;
  }
  const expectedSurplus = Math.round(surplus);
  const expectedReturns = Math.max(0, Math.round(returns));
  const saved = actual - start - expectedReturns;
  const out = { ...base, expectedSurplus, expectedReturns, saved };
  if (expectedSurplus <= 0) return { ...out, ratio: null, reason: "控えの見込みでは、この期間に黒字がありません。" };
  const raw = Math.min(1, Math.max(0, saved / expectedSurplus));
  return { ...out, ratio: Math.floor(raw * 20 + 1e-9) / 20, reason: null };
}

/** 割合を前提の値の文字列に（0.65 → "0.65"） */
export const ratioString = (r: number): string => String(Math.round(r * 100) / 100);
