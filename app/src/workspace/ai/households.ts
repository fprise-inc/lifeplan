// AIが組み立てた新しい世帯の候補（接続口の道具 propose_household）の読み口と、確かめの画面に出す中身・作るときの形。
// - 届いた候補は信用しない（0015・0016）: 読むのは種類・題・推定したこと・計算の入力だけ。文字（題・推定したこと・入力の名前やメモの欄）は、
//   書類の候補と同じ決まり（documents/privacy.ts）で番号らしい所を消す。名前の欄でない所の番号らしい値（12桁の数・区切りの無い10桁以上の数字）は
//   値ごと落とす。消した・落とした数を確かめの画面に出す
// - 入力の形と範囲は、本体が受け取るときに計算エンジンで確かめている。消した後の入力も、作る前に画面がもう一度計算して確かめる
// - 作るときは、入力の値の出どころを AI（候補の ID と AI のアプリの名乗り）にし、FP の承認の記録を付ける（値の箱の origin・approval。0008 の2）。
//   世帯の一覧の「架空」の印・出どころの記録（meta.origin）は本体が付ける（画面からは付けられない）
import type { AiHouseholdCandidate } from "../../engine/host.ts";
import type { EngineRequest, Member } from "../../engine/types.ts";
import { group, monthlyMan } from "../../presentation/format.ts";
import { cleanText, hasPersonalNumber, isPersonalNumberValue } from "../documents/privacy.ts";
import { ACCOUNT_KINDS, DEBT_KINDS, EMPLOYMENT_TYPES, RESIDENCE_KINDS } from "../input/labels.ts";
import { ageAt } from "../levers.ts";
import { roles } from "../roles.ts";

export type HouseholdKind = "fictional" | "client";

/** 種類の言葉（確かめの画面・一覧の印） */
export const KIND_TEXT: Readonly<Record<HouseholdKind, { label: string; long: string; share: string }>> = {
  fictional: {
    label: "架空",
    long: "架空の世帯（セミナー・研修・ブログに使う、実在しない世帯）",
    share: "お客さまの情報を含まないので、同意の記録が無くても AI に渡せます（期限・取り消し・記録は同じ）。一覧と開いた世帯に「架空」の印が付きます。",
  },
  client: {
    label: "お客さま",
    long: "お客さまの世帯",
    share: "外部AIへの提供の同意を記録するまで、AI には渡せません（今までのお客さまの世帯と同じ）。",
  },
};

/** 文字の長さの上限（本体の ai-share/households.rs と同じ） */
export const LIMITS = { title: 60, note: 1000, text: 400 } as const;

/** 入力の中の、名前・メモ・見出しの文字の欄の鍵（計算には使わない。番号らしい所を消す） */
const TEXT_KEYS = new Set(["label", "name", "memo", "note", "dreamNote", "title", "description", "text"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
/** 計算の入力の決まった形の文字（年月・日・10進の数・選べる値）。番号らしい所を探さない */
const PLAIN = /^(-?[0-9]{1,9}(\.[0-9]{1,10})?|[0-9]{4}-[0-9]{2}(-[0-9]{2})?(T[0-9:.]+(Z|[+-][0-9]{2}:[0-9]{2})?)?|[A-Za-z][A-Za-z0-9_.:-]{0,79})$/u;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** 読んだ候補（番号らしい所を消した後） */
export interface ReadHousehold {
  candidateId: string;
  receivedAt: string;
  connector: string | null;
  kind: HouseholdKind;
  title: string;
  note: string | null;
  input: EngineRequest["input"];
  /** 番号らしい所を消した文字の数 */
  masked: number;
  /** 番号らしい値で落とした所の数 */
  dropped: number;
}

/** 決まった形でない文字の値に、番号らしい所（12桁の数・区切りの無い10桁以上の数字）があるか */
const numberLike = (s: string): boolean => !UUID.test(s) && !PLAIN.test(s) && (hasPersonalNumber(s) || /[0-9０-９]{10,}/u.test(s.normalize("NFKC")));

function scrub(v: unknown, count: { masked: number; dropped: number }): unknown {
  if (Array.isArray(v)) {
    const out: unknown[] = [];
    for (const x of v) {
      if ((typeof x === "string" && numberLike(x)) || isPersonalNumberValue(x)) {
        count.dropped++;
        continue;
      }
      out.push(scrub(x, count));
    }
    return out;
  }
  if (isObj(v)) {
    const out: Obj = {};
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string" && TEXT_KEYS.has(k)) {
        const c = cleanText(x, LIMITS.text);
        if (c.masked) count.masked++;
        if (c.text !== "") out[k] = c.text;
        continue;
      }
      if ((typeof x === "string" && numberLike(x)) || (typeof x === "number" && isPersonalNumberValue(x))) {
        count.dropped++;
        continue;
      }
      out[k] = scrub(x, count);
    }
    return out;
  }
  return v;
}

/**
 * 本体から届いた候補を読む: 知っている欄だけを読み、文字の番号らしい所を消す。種類が分からなければお客さまの世帯として読む
 * （同意が要る側）。読めなければ candidate は null で、理由を issues に入れる（値・文字は入れない）
 */
export function readHouseholdCandidate(c: AiHouseholdCandidate): { candidate: ReadHousehold | null; issues: string[] } {
  const count = { masked: 0, dropped: 0 };
  if (typeof c.candidateId !== "string" || !UUID.test(c.candidateId)) return { candidate: null, issues: ["候補の ID の形が違います"] };
  const input = c.input;
  if (!isObj(input) || !isObj(input.household) || !Array.isArray(input.household.members) || input.household.members.length === 0) return { candidate: null, issues: ["計算の入力の形が違います（家族がいません）"] };
  const title = cleanText(typeof c.title === "string" ? c.title : "", LIMITS.title);
  if (title.masked) count.masked++;
  const note = typeof c.note === "string" ? cleanText(c.note, LIMITS.note) : null;
  if (note?.masked === true) count.masked++;
  const connector = typeof c.connector === "string" ? cleanText(c.connector, 80).text : "";
  const scrubbed = scrub(input, count) as EngineRequest["input"];
  return {
    candidate: {
      candidateId: c.candidateId,
      receivedAt: typeof c.receivedAt === "string" ? c.receivedAt : "",
      connector: connector !== "" ? connector : null,
      kind: c.kind === "fictional" ? "fictional" : "client",
      title: title.text !== "" ? title.text : "（題なし）",
      note: note !== null && note.text !== "" ? note.text : null,
      input: scrubbed,
      masked: count.masked,
      dropped: count.dropped,
    },
    issues: [],
  };
}

// ---- 確かめの画面に出す中身 ----

export interface OverviewRow {
  label: string;
  value: string;
  /** AI が推定した値（値の箱の state が estimated） */
  estimated?: boolean;
}

export interface HouseholdOverview {
  family: OverviewRow[];
  income: OverviewRow[];
  assets: OverviewRow[];
  housing: OverviewRow[];
  loans: OverviewRow[];
  living: OverviewRow[];
  /** 値の状態が「推定」の欄の数（入力の全部から数える） */
  estimatedCount: number;
  /** 計算の基準の月と表の最後の年 */
  basis: string;
}

const labelOf = (opts: readonly { value: string; label: string }[], v: string, fallback: string): string => opts.find((o) => o.value === v)?.label ?? fallback;
const yenText = (n: number | null | undefined): string => (typeof n === "number" && Number.isFinite(n) ? `${group(n)}円` : "（未入力）");
const manText = (n: number | null | undefined): string => (typeof n === "number" && Number.isFinite(n) ? (n % 10000 === 0 ? `${group(n / 10000)}万円` : `${group(n)}円`) : "（未入力）");
type BoxLike = { value?: unknown; state?: unknown } | undefined;
const boxValue = (b: BoxLike): number | null => (b !== undefined && typeof b.value === "number" ? b.value : null);
const isEstimated = (b: BoxLike): boolean => b !== undefined && b.state === "estimated";
const periodText = (from: unknown, to: unknown): string => {
  const at = (t: unknown) => (isObj(t) && typeof t.at === "string" ? t.at.replace("-", "年").replace(/^(\d{4}年)0?(\d{1,2})$/u, "$1$2月") : null);
  const a = at(from);
  const b = at(to);
  if (a === null && b === null) return "";
  return `（${a ?? ""}〜${b ?? ""}）`;
};

function countEstimated(v: unknown): number {
  if (Array.isArray(v)) return v.reduce<number>((n, x) => n + countEstimated(x), 0);
  if (!isObj(v)) return 0;
  let n = v.state === "estimated" && "origin" in v ? 1 : 0;
  for (const x of Object.values(v)) n += countEstimated(x);
  return n;
}

/** 確かめの画面に出す中身（家族・収入・資産・住まい・ローン・生活費）。名前は持たないので、続柄で呼ぶ */
export function householdOverview(input: EngineRequest["input"]): HouseholdOverview {
  const req: EngineRequest = { trace: "none", input };
  const h = input.household;
  const rs = roles(req);
  const nameOf = (id: string | undefined) => rs.find((r) => r.member.id === id)?.label ?? "ご家族";
  const base = typeof input.baseMonth === "string" ? input.baseMonth : "";
  const family: OverviewRow[] = rs.map((r) => {
    const m: Member = r.member;
    const age = base !== "" && typeof m.birth?.birthYearMonth === "string" ? `${ageAt(m, base)}歳` : "年齢（未入力）";
    const sex = m.sex === "male" ? "男性" : m.sex === "female" ? "女性" : "";
    const extra = [m.expected === true ? "これから生まれる予定" : "", m.outside !== undefined ? "離れて暮らす" : ""].filter((x) => x !== "").join("・");
    return { label: r.label, value: [age, sex, extra].filter((x) => x !== "").join("・") };
  });
  const income: OverviewRow[] = (h.employmentPeriods ?? []).map((p) => {
    const kind = labelOf(EMPLOYMENT_TYPES, p.type, p.type);
    const annual = p.salary?.annual ?? p.business?.income;
    const bonus = p.salary?.bonus;
    const money = annual !== undefined ? `年収 ${manText(boxValue(annual))}${bonus !== undefined && (boxValue(bonus) ?? 0) > 0 ? `（うち賞与 ${manText(boxValue(bonus))}）` : ""}` : "収入なし";
    return { label: `${nameOf(p.member)}の${kind}`, value: `${money}${periodText(p.from, p.to)}`, ...(isEstimated(annual) ? { estimated: true } : {}) };
  });
  const assets: OverviewRow[] = (h.accounts ?? []).map((a) => ({
    label: `${labelOf(ACCOUNT_KINDS, a.kind, "資産")}（${nameOf(a.owner)}）`,
    value: manText(boxValue(a.marketValue)),
    ...(isEstimated(a.marketValue) ? { estimated: true } : {}),
  }));
  const housing: OverviewRow[] = (h.residences ?? []).map((r) => {
    const kind = labelOf(RESIDENCE_KINDS, r.kind, "住まい");
    if (r.kind === "rent") return { label: kind, value: `家賃 月${monthlyMan(boxValue(r.rent?.monthly) ?? 0)}${periodText(r.from, r.to)}`, ...(isEstimated(r.rent?.monthly) ? { estimated: true } : {}) };
    if (r.purchase !== undefined) return { label: `${kind}（購入の予定）`, value: `価格 ${manText(r.purchase.price)}・頭金 ${manText(r.purchase.downPayment ?? 0)}${periodText(r.purchase.at, null)}` };
    return { label: kind, value: periodText(r.from, r.to) !== "" ? periodText(r.from, r.to).replace(/^（|）$/gu, "") : "住んでいる" };
  });
  const loans: OverviewRow[] = (h.debts ?? []).map((d) => {
    const kind = d.kind === "mortgage" ? "住宅ローン" : labelOf(DEBT_KINDS, d.kind, "ローン");
    const rate = d.rateSchedule[0]?.rate;
    const balance = boxValue(d.balance);
    return {
      label: kind,
      value: `${balance !== null ? `残高 ${manText(balance)}` : `借入 ${manText(d.principal)}`}${rate !== undefined ? `・金利 ${(Number(rate) * 100).toFixed(2).replace(/\.?0+$/u, "")}%` : ""}・${Math.round(d.repayment.termMonths / 12)}年`,
      ...(isEstimated(d.balance) ? { estimated: true } : {}),
    };
  });
  const living: OverviewRow[] = (h.livingExpenses ?? []).map((l) => ({
    label: "毎月の生活費",
    value: l.monthly !== undefined ? `月${monthlyMan(boxValue(l.monthly) ?? 0)}` : yenText(null),
    ...(isEstimated(l.monthly) ? { estimated: true } : {}),
  }));
  return {
    family,
    income,
    assets,
    housing,
    loans,
    living,
    estimatedCount: countEstimated(h),
    basis: `${base.replace(/^(\d{4})-0?(\d{1,2})$/u, "$1年$2月")}時点の計算・表は${String(input.endYear)}年まで`,
  };
}

// ---- 作るとき ----

/** 承認の日時（スキーマの形: 秒まで・Z） */
export const approvalAt = (d: Date = new Date()): string => d.toISOString().replace(/\.\d{3}Z$/u, "Z");

/** 出どころを変えない値（アプリが自動で決める値・FP が上書きした値の印） */
const KEEP_ORIGINS = new Set(["auto", "override"]);

/**
 * 入力の値の出どころを AI にし、FP の承認の記録を付ける（値の箱と値の状態の行。0008 の2）。元の入力は変えない
 */
export function withAiOrigin<T>(v: T, candidateId: string, connector: string | null, at: string): T {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk);
    if (!isObj(x)) return x;
    const out: Obj = {};
    for (const [k, y] of Object.entries(x)) out[k] = walk(y);
    if (typeof out.state === "string" && isObj(out.origin) && typeof out.origin.kind === "string" && !KEEP_ORIGINS.has(out.origin.kind)) {
      out.origin = { kind: "ai", ref: candidateId, ...(connector !== null && connector !== "" ? { connector } : {}) };
      out.approval = { by: "fp", at, candidate: candidateId };
    }
    return out;
  };
  return walk(v) as T;
}

/** 推定したことを、世帯の FP のメモの1行にする（AI の文。指示ではない） */
export const noteMemo = (c: ReadHousehold): string[] => [`AIの候補「${c.title}」から作った世帯${c.note !== null ? `。推定したこと: ${c.note}` : ""}`];
