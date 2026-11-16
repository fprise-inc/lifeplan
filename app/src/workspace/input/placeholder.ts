// 欄の灰色の入力例（placeholder）の長さの目安（0077）。欄の幅で途切れないように、欄の種類ごとに入る文字の幅（em）を決め、
// 収まらない例は使わない（収まらない説明は「?」の中へ）。幅は app.css・invest.css の欄の幅から、内側の余白と枠を引いた値。
// 文字の幅は目安: 全角は 1em、半角の英数字・記号は 0.65em、空白は 0.3em（BIZ UDPGothic の数字の幅を、見えない Chrome で測って合わせた）

/** 欄の class → 入力例に使える幅（em） */
export const PLACEHOLDER_ROOM: Readonly<Record<string, number>> = {
  /** 数の欄（.fld-c input.num の 9.5em） */
  num: 8.3,
  /** 時点の欄（.fld-c input.when-in の 10.5em） */
  "when-in": 9.3,
  /** 年月の欄（.fld-c input.ym の 8em） */
  ym: 6.8,
  /** 文字の欄（.fld-c input.txt。狭いまとまりの幅で見る） */
  txt: 15,
  /** 貯蓄・運用の表の数の欄（.sv-n の 6.2em・.s の 4.6em・.xs の 3.2em） */
  "sv-n": 5,
  "sv-n s": 3.4,
  "sv-n xs": 2,
};

/** 文字の幅の目安（em） */
export function textEm(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (ch === " ") w += 0.3;
    else if (/[\x21-\x7e]/.test(ch)) w += 0.65;
    else w += 1;
  }
  return w;
}

/** 欄の class（例: "num"・"sv-n s"）の入力例に使える幅。決まっていない欄は null */
export function roomOf(cls: string): number | null {
  const parts = cls.split(/\s+/).filter((c) => c !== "");
  if (parts.includes("sv-n")) return PLACEHOLDER_ROOM[parts.includes("xs") ? "sv-n xs" : parts.includes("s") ? "sv-n s" : "sv-n"] ?? null;
  for (const k of ["num", "when-in", "ym", "txt"]) if (parts.includes(k)) return PLACEHOLDER_ROOM[k] ?? null;
  return null;
}

/** 入力例が欄に収まるか */
export const fitsIn = (cls: string, text: string): boolean => {
  const room = roomOf(cls);
  return room === null || textEm(text) <= room;
};

/** 候補を順に見て、欄に収まる最初の入力例（どれも収まらなければ空） */
export function fittingPlaceholder(cls: string, ...candidates: readonly (string | null | undefined)[]): string {
  for (const c of candidates) if (c !== null && c !== undefined && c !== "" && fitsIn(cls, c)) return c;
  return "";
}

/**
 * 空欄の意味（「最初から」など）が欄の中の「空欄＝○○」に収まらないとき、欄の下に出す1行（「空欄なら: ○○」）。収まるなら null
 * （欄の中に出すので要らない）
 */
export function blankLineFor(cls: string, blankMeans: string): string | null {
  return fitsIn(cls, `空欄＝${blankMeans}`) ? null : `空欄なら: ${blankMeans}`;
}

/** 推定の根拠の短い文を、そのまま欄の横に出せる長さ（em） */
const SHORT_BASIS_ROOM = 12;

/**
 * 空欄の推定の値を欄の中に灰色で見せるときの、欄の横の根拠の短い文（0041 の追記 2026-11-10）。全部の根拠は「推定」の印を押すと開く。
 * - 調査の名前（「…」）のある根拠は「統計の平均（○○の調査）」（○○は調査をした所。例: 生命保険文化センター・文部科学省）
 * - 「統計の平均」で始まる根拠は「統計の平均」
 * - 短い根拠（12em まで。「退職の年（60歳）」など）はそのまま
 * - ほかは出さない（null）
 */
export function shortBasis(basis: string | null | undefined): string | null {
  if (basis === null || basis === undefined || basis === "") return null;
  const org = /([^\s「」（）()。、，,:：]+)「[^」]*」/.exec(basis)?.[1];
  if (org !== undefined) return `統計の平均（${org}の調査）`;
  if (basis.startsWith("統計の平均")) return "統計の平均";
  return textEm(basis) <= SHORT_BASIS_ROOM ? basis : null;
}

/** 欄の横の1行のうち、推定の出どころの頭（「統計の平均（○○の調査）」「事務所の推定の値」）。後ろの「・」「。」の後は欄の横に残す一言 */
const SOURCE_HEAD = /^(?:統計の平均(?:（[^）]*）)?|事務所の推定の値)(?:[・。]|$)/;

/**
 * 推定の欄の横の1行（FieldState.blankHint）を、推定の出どころと、欄の横に残す一言に分ける。出どころは欄の横に出さず、
 * 「推定」の印の吹き出しの頭（「推定のもと: …」）に置く。残す一言（入れ方・計算の中身。例:「学校の費用に含まれます」「亡くなる見込みで止まり、…」）は欄の横のまま。
 * - 「統計の平均（○○の調査）」「事務所の推定の値」で始まる1行は、そこまでが出どころ、続く「・」「。」の後ろが残す一言
 * - ほかの1行は、全部が出どころ（blankHint は推定の根拠の短い文。例:「今の年収から等級表で（毎年9月に決め直す）」）
 */
export function splitEstimateHint(text: string | null | undefined): { source: string | null; rest: string | null } {
  if (text === null || text === undefined || text === "") return { source: null, rest: null };
  const m = SOURCE_HEAD.exec(text);
  if (m === null) return { source: text, rest: null };
  const source = m[0].replace(/[・。]$/, "");
  const rest = text.slice(m[0].length).trim();
  return { source, rest: rest === "" ? null : rest };
}

/** 「推定（…）」と全体を括弧で包んだ根拠の、中身（包んでいなければそのまま。括弧の対応を見て、「推定（A）。B（C）」は包んでいないと読む） */
function unwrapEstimate(basis: string): string {
  if (!basis.startsWith("推定（") || !basis.endsWith("）")) return basis;
  const inner = basis.slice(3, -1);
  let depth = 0;
  for (const ch of inner) {
    if (ch === "（") depth++;
    else if (ch === "）" && --depth < 0) return basis;
  }
  return depth === 0 ? inner : basis;
}

/**
 * 「推定」の印の吹き出しの文（行の並び）。頭の行は「推定のもと: 出どころ」で、出どころが一目でわかるように先に置く。
 * 出どころは、欄の横から移した短い文（source）か、根拠から作る短い文（shortBasis）。根拠がその短い文で始まる（同じ中身）なら重ねずに1行、
 * 違えば2行目に根拠の全部
 */
export function estimateBasisLines(basis: string, source?: string | null): [string] | [string, string] {
  const full = unwrapEstimate(basis);
  const head = source !== undefined && source !== null && source !== "" ? source : shortBasis(full);
  if (head === null || full.startsWith(head)) return [`推定のもと: ${full}`];
  return [`推定のもと: ${head}`, full];
}
