// 結果の表の行の足し（0075）: 計算の結果を読むだけで、お金の流れは変えない。
// - 世帯の外の家族の呼び方（表の行・できごとの文。顧客の名前は出さない）
// - 年間収支の赤字の出どころ（行を開くと出る子の行）: 口座から取り崩して払った分（口座ごと）と、残り（決済口座の預金から＝家計の赤字）
// - 扶養の境目の参考の行: 扶養していると入れた世帯の外の親・祖父母の年金（扶養の判定に使う額）と、税の扶養の境目までの差。
//   その人の年金は世帯の表に出ない（家計が別）ので、写しの要求（その人の収入を全部の期間で世帯に入れた形）で求める
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, Member, PreviewResult, TableCell } from "../engine/types.ts";
import type { TableChildRow, TableRowModel } from "../presentation/model.ts";
import { dependentLimits } from "../../../hearing/src/estimates.ts";
import { ACCOUNT_KINDS } from "./input/labels.ts";
import { ageInYear, roles } from "./roles.ts";
import { resolveTimepoint } from "./timepoint.ts";

const under = (row: string, prefix: string) => row === prefix || row.startsWith(prefix + ".");
/** 取り崩しの譲渡益の税の行（課税口座の上場株式等・暗号資産の申告分離課税。0124） */
const GAINS_TAX_ROWS: ReadonlySet<string> = new Set(["cf.taxSi.incomeTax.capitalGains", "cf.taxSi.residentTax.capitalGains", "cf.taxSi.incomeTax.cryptoAsset", "cf.taxSi.residentTax.cryptoAsset"]);
const birthOf = (m: Member): string | undefined => (m.birth as Member["birth"] | undefined)?.birthYearMonth;

// ---- 世帯の外の家族の呼び方 ----

function outsideBase(m: Member): string {
  if (m.kind === "parent") return m.sex === "female" ? "お母さま" : m.sex === "male" ? "お父さま" : "親御さま";
  if (m.kind === "grandparent") return m.sex === "female" ? "おばあさま" : m.sex === "male" ? "おじいさま" : "祖父母さま";
  return "ご家族";
}

/** 世帯の外の家族の呼び方（例: お母さま）。同じ呼び方の世帯の外の家族が2人以上いれば、誰の家族かを前に付ける（例: 配偶者のお母さま） */
export function outsideName(req: EngineRequest, m: Member): string {
  // 世帯の外の子は呼び方（離れて暮らす子・離れて暮らす子1 …。roles.ts）のまま
  if (m.kind === "child") return roles(req).find((r) => r.member.id === m.id)?.label ?? "離れて暮らす子";
  const base = outsideBase(m);
  const same = req.input.household.members.filter((x) => x.outside !== undefined && outsideBase(x) === base);
  if (same.length < 2) return base;
  const of = roles(req).find((r) => r.member.id === m.outside?.of);
  return of !== undefined && (of.key === "self" || of.key === "spouse") ? `${of.label}の${base}` : base;
}

/** 世帯の外の家族の収入の行の説明 */
export const OUTSIDE_INCOME_NOTE = "世帯の外の家族（家計が別）の収入は、家計を1つにする期間のうち「収入を世帯に入れる」月の分だけ、世帯の収入に入れています";

// ---- 年間収支の赤字の出どころ ----

/** 口座の呼び名（FP が付けた名前か、名義人と種類。例: ご本人のNISA） */
function accountName(req: EngineRequest, id: string): string {
  const a = (req.input.household.accounts ?? []).find((x) => x.id === id);
  if (a === undefined) return "口座";
  if (typeof a.label === "string" && a.label !== "") return a.label;
  const kind = ACCOUNT_KINDS.find((o) => o.value === a.kind)?.label ?? "口座";
  const owner = roles(req).find((r) => r.member.id === a.owner);
  return owner !== undefined ? `${owner.label}の${kind}` : kind;
}

/**
 * 年間収支の行を開くと出る子の行: 赤字の年の赤字を、口座から取り崩して払った分（取り崩しの手取り＝売った額−譲渡益の税。口座ごと）と、
 * 残り（決済口座の預金から払った分＝家計の赤字。払いきれない資金不足も含む）に分ける。子の行の合計は年間収支と同じ（マイナスで出す）。
 * 黒字の年は出さない（積立のための取り崩しは赤字を払った分ではない）。取り崩しで赤字を払った年が無ければ null
 */
export function deficitSources(req: EngineRequest, table: readonly TableCell[], years: readonly number[]): TableChildRow[] | null {
  const ys = new Set(years);
  const net = new Map<number, number>();
  // 年ごと・口座ごとの取り崩しの手取り（口座は表に出た順）
  const proceeds = new Map<number, Map<string, number>>();
  const order: string[] = [];
  const add = (y: number, id: string, v: number) => {
    let m = proceeds.get(y);
    if (m === undefined) proceeds.set(y, (m = new Map()));
    m.set(id, (m.get(id) ?? 0) + v);
  };
  for (const c of table) {
    if (!ys.has(c.year)) continue;
    if (c.row === "cf.net") net.set(c.year, (net.get(c.year) ?? 0) + c.amount);
    else if (c.object !== undefined && under(c.row, "cf.transfer.withdrawal")) {
      if (!order.includes(c.object)) order.push(c.object);
      add(c.year, c.object, c.amount);
    }
  }
  // 譲渡益の税（取り崩した口座の分。口座の物の ID を持つのは取り崩しの税だけ）
  for (const c of table) {
    if (!ys.has(c.year) || c.object === undefined || !GAINS_TAX_ROWS.has(c.row)) continue;
    if (proceeds.get(c.year)?.has(c.object) === true) add(c.year, c.object, -c.amount);
  }
  const cover = new Map<string, Map<number, number>>();
  const rest = new Map<number, number>();
  for (const y of years) {
    const n = net.get(y) ?? 0;
    if (n >= 0) continue;
    let left = -n;
    for (const id of order) {
      const p = Math.min(left, Math.max(0, proceeds.get(y)?.get(id) ?? 0));
      if (p <= 0) continue;
      let m = cover.get(id);
      if (m === undefined) cover.set(id, (m = new Map()));
      m.set(y, p);
      left -= p;
    }
    rest.set(y, left);
  }
  if (cover.size === 0) return null;
  const rows: TableChildRow[] = order
    .filter((id) => cover.has(id))
    .map((id, i) => ({ key: `net:from${String(i + 1)}`, label: `うち ${accountName(req, id)}から払った分（取り崩し）`, cells: years.map((y) => ({ amount: cover.get(id)?.has(y) === true ? -(cover.get(id)?.get(y) ?? 0) : null })) }));
  // 残り（家計の赤字）は、ある年があるときだけ
  if ([...rest.values()].some((v) => v > 0)) rows.push({ key: "net:rest", label: "うち 家計の赤字（決済口座の預金から）", cells: years.map((y) => ({ amount: rest.has(y) ? -(rest.get(y) ?? 0) : null })) });
  return rows;
}

/** 年間収支の行の説明（子の行があるとき） */
export const DEFICIT_NOTE = "▸ で開くと、赤字の年の赤字を、口座から取り崩して払った分（口座ごと・税を引いた手取り）と、家計の赤字（決済口座の預金から払った分。払いきれない資金不足も含む）に分けて見られます";

// ---- 扶養の境目の参考の行 ----

/** 扶養の境目の参考の行を出す人: 扶養していると入れた、生年月のある世帯の外の親・祖父母 */
function dependentElders(req: EngineRequest): Member[] {
  return req.input.household.members.filter((m) => m.outside !== undefined && (m.kind === "parent" || m.kind === "grandparent") && m.support?.dependent === true && birthOf(m) !== undefined);
}

/**
 * 扶養の境目の参考の行を求める写しの要求: 扶養していると入れた世帯の外の親・祖父母の家計を1つにする期間を、全部の期間で「収入を世帯に入れる」
 * 1つの期間にする（その人の年金が表に出る。年金の額は家計の扱いで変わらない）。万一の想定・必要保障額の推移・相続税の目安は外す。
 * 当たる人がいなければ null
 */
export function dependentRefRequest(req: EngineRequest): EngineRequest | null {
  const ids = new Set(dependentElders(req).map((m) => m.id));
  if (ids.size === 0) return null;
  const out = structuredClone(req);
  delete out.input.contingencies;
  delete out.input.protection;
  delete out.input.inheritanceTax;
  let n = 0;
  for (const m of out.input.household.members) {
    if (!ids.has(m.id) || m.outside === undefined) continue;
    n += 1;
    const id = m.outside.periods[0]?.id ?? `6d0e5a3c-0000-4000-8000-${String(n).padStart(12, "0")}`;
    m.outside = { ...m.outside, periods: [{ id, from: null, to: null, living: false, income: true }] };
  }
  out.trace = "none";
  return out;
}

/** 参考の行の説明 */
export const DEPENDENT_NOTE =
  "扶養していると入れた親・祖父母の年金（計算が扶養の判定に使う額。家計が別の年も含む）と、税の扶養の境目（年金だけなら、合計所得の上限＋公的年金等控除の最低額）までの差です。▲の年は境目を超えるので、扶養控除を入れていません。年金のほかに収入がある人は、合計所得で確かめてください";

/**
 * 扶養の境目の参考の行（表の最後に、世帯のお金の流れに入らない参考のまとまり）: 人ごとに「○○の年金（扶養の判定に使う額）」と
 * 「税の扶養の境目まで」（境目−年金。超える年は▲）。ref は dependentRefRequest の写しの要求の結果の表。いる年（生まれていて、亡くなる見込みの年まで）だけ
 */
export function dependentRefRows(req: EngineRequest, ref: readonly TableCell[], years: readonly number[]): TableRowModel[] {
  const elders = dependentElders(req);
  if (elders.length === 0) return [];
  const h = req.input.household;
  const rows: TableRowModel[] = [{ kind: "group", key: "group:ref", label: "参考（世帯のお金の流れに入らない）" }];
  elders.forEach((m, i) => {
    const leaves = resolveTimepoint(h, m.leaves ?? null);
    const last = leaves === null ? null : Number(leaves.slice(0, 4));
    const alive = (y: number) => ageInYear(m, y) >= 0 && (last === null || y <= last);
    const pension = new Map<number, number>();
    for (const c of ref) if (c.member === m.id && under(c.row, "cf.income.pension")) pension.set(c.year, (pension.get(c.year) ?? 0) + c.amount);
    const name = outsideName(req, m);
    const gap = years.map((y) => {
      if (!alive(y)) return null;
      const lim = dependentLimits(ageInYear(m, y), `${String(y)}-12-01`);
      return lim === null ? null : lim.taxPension - (pension.get(y) ?? 0);
    });
    rows.push(
      { kind: "value", key: `depRef${String(i + 1)}`, label: `${name}の年金（扶養の判定に使う額）`, cells: years.map((y) => ({ amount: alive(y) ? (pension.get(y) ?? 0) : null })), evidence: false, note: DEPENDENT_NOTE },
      { kind: "diff", key: `depGap${String(i + 1)}`, label: "税の扶養の境目まで", cells: gap, note: DEPENDENT_NOTE },
    );
  });
  return rows;
}

/**
 * 写しの要求の結果（扶養の境目の参考の行）。要求が null なら null。計算し直している間は前の結果を見せておく（ちらつかないように）。
 * 計算の道が無ければ null のまま
 */
export function useRefResult(req: EngineRequest | null, computeOne: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined): PreviewResult | null {
  const [res, setRes] = useState<PreviewResult | null>(null);
  const key = useMemo(() => (req === null ? null : JSON.stringify(req)), [req]);
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
  }, [key, computeOne]);
  return req === null ? null : res;
}
