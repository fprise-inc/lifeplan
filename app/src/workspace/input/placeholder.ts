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
