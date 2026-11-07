// 安全な XML の読み手（0153 の1）: 決まった形の電子データ（控除証明書など）を、このパソコンの中だけで読むための小さな読み手。
// 依存を足さない・ブラウザの XML の部品にも頼らない（どこで動いても同じ決まりで読む）。
// - 文書型の宣言（DOCTYPE）・実体の宣言（ENTITY）の入った XML は読まない（外の参照・実体の膨らみを起こさない）
// - 実体の参照は決まった5つ（&lt; &gt; &amp; &quot; &apos;）と数字の参照だけ。ほかは読まない
// - 大きさ（バイト・文字）・入れ子の深さ・要素の数に上限がある
// - 名前空間の接頭辞は外して、要素の名前（ローカル名）だけで持つ。属性は確かめるが持たない
// - 読まない要素（skip）の中身は、木に入れずに捨てる（氏名・証券番号などを、読んだ時点で持たないため）
// - 電子署名は確かめない（読み手が持つのは候補だけで、FP が書類と見比べて承認する）

export interface XmlElement {
  /** 要素の名前（名前空間の接頭辞を外したもの） */
  name: string;
  children: XmlElement[];
  /** 要素のすぐ下の文字（子の要素の中の文字は含まない） */
  text: string;
}

export type XmlResult = { ok: true; root: XmlElement } | { ok: false; reason: string };

/** 上限（内部。控除証明書は数十KB までなので、十分に大きくとる） */
export const XML_LIMITS = { bytes: 2_000_000, depth: 40, elements: 50_000, text: 10_000 } as const;

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

const ENCODINGS: Readonly<Record<string, string>> = {
  "utf-8": "utf-8",
  utf8: "utf-8",
  shift_jis: "shift_jis",
  "shift-jis": "shift_jis",
  sjis: "shift_jis",
  "windows-31j": "shift_jis",
  cp932: "shift_jis",
  "euc-jp": "euc-jp",
};

/**
 * ファイルの中身を文字にする。先頭の印（BOM）か XML の宣言の文字コードで読む（無ければ UTF-8）。
 * XML でなさそうなファイル（ZIP・PDF）や、文字コードの合わないファイルは理由を返す
 */
export function decodeXml(bytes: Uint8Array): { ok: true; text: string } | { ok: false; reason: string } {
  if (bytes.length === 0) return fail("ファイルが空です");
  if (bytes.length > XML_LIMITS.bytes) return fail("ファイルが大きすぎます（控除証明書の電子データではなさそうです）");
  const head = (n: number) => [...bytes.subarray(0, n)];
  const starts = (sig: readonly number[]) => sig.every((b, i) => bytes[i] === b);
  if (starts([0x50, 0x4b, 0x03, 0x04])) return fail("ZIP のファイルです。展開して、中の XML のファイルを選んでください");
  if (starts([0x25, 0x50, 0x44, 0x46])) return fail("PDF のファイルです。電子データ（XML）のファイルを選んでください");
  let label = "utf-8";
  let body = bytes;
  if (starts([0xef, 0xbb, 0xbf])) body = bytes.subarray(3);
  else if (starts([0xff, 0xfe])) {
    label = "utf-16le";
    body = bytes.subarray(2);
  } else if (starts([0xfe, 0xff])) {
    label = "utf-16be";
    body = bytes.subarray(2);
  } else {
    const peek = String.fromCharCode(...head(Math.min(bytes.length, 200)));
    const m = /^\s*<\?xml[^>]*?encoding\s*=\s*["']([A-Za-z0-9._-]{1,40})["']/u.exec(peek);
    if (m !== null) {
      const known = ENCODINGS[(m[1] as string).toLowerCase()];
      if (known === undefined) return fail("この文字コードの XML は読めません");
      label = known;
    }
  }
  try {
    return { ok: true, text: new TextDecoder(label, { fatal: true }).decode(body) };
  } catch {
    return fail("文字を読めません（文字コードが合っていないか、XML のファイルではありません）");
  }
}

const NAME_START = /[A-Za-z_À-￯]/u;
const NAME_CHAR = /[A-Za-z0-9_.:\-·À-￯]/u;
const local = (name: string): string => name.slice(name.lastIndexOf(":") + 1);

/** 実体の参照を文字にする（決まった5つと数字の参照だけ。ほかがあれば null） */
function decodeEntities(s: string): string | null {
  if (!s.includes("&")) return s;
  let bad = false;
  const out = s.replace(/&([^;&\s]{0,12});?/gu, (m, body: string) => {
    if (!m.endsWith(";")) {
      bad = true;
      return "";
    }
    switch (body) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      case "quot":
        return '"';
      case "apos":
        return "'";
    }
    const num = /^#(?:x([0-9A-Fa-f]{1,6})|([0-9]{1,7}))$/u.exec(body);
    const cp = num === null ? NaN : num[1] !== undefined ? parseInt(num[1], 16) : parseInt(num[2] as string, 10);
    if (!Number.isFinite(cp) || cp <= 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      bad = true;
      return "";
    }
    return String.fromCodePoint(cp);
  });
  return bad ? null : out;
}

/**
 * XML の文字を読んで木にする。skip に入れた名前（ローカル名）の要素は、中身ごと木に入れない（中の形は確かめる）
 */
export function parseXml(src: string, opts: { skip?: ReadonlySet<string> } = {}): XmlResult {
  if (src.length > XML_LIMITS.bytes) return fail("ファイルが大きすぎます");
  const skip = opts.skip ?? new Set<string>();
  // 開いている要素（el が null なら読まない要素の中）
  const stack: { raw: string; el: XmlElement | null }[] = [];
  let root: XmlElement | null = null;
  let closedRoot = false;
  let count = 0;
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const top = () => stack[stack.length - 1];
  const addText = (t: string): string | null => {
    const s = top();
    if (s === undefined) return t.trim() === "" ? null : "要素の外に文字があります";
    if (s.el === null) return null;
    if (s.el.text.length + t.length > XML_LIMITS.text) return "要素の文字が長すぎます";
    s.el.text += t;
    return null;
  };
  while (i < src.length) {
    const lt = src.indexOf("<", i);
    const end = lt < 0 ? src.length : lt;
    if (end > i) {
      const chunk = src.slice(i, end);
      const t = decodeEntities(chunk);
      if (t === null) return fail("知らない実体の参照があります（決まった形の XML ではありません）");
      if (closedRoot && t.trim() !== "") return fail("一番外の要素の後に文字があります");
      const e = addText(t);
      if (e !== null) return fail(e);
    }
    if (lt < 0) break;
    if (src.startsWith("<!--", lt)) {
      const e = src.indexOf("-->", lt + 4);
      if (e < 0) return fail("注釈が閉じていません");
      i = e + 3;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const e = src.indexOf("]]>", lt + 9);
      if (e < 0) return fail("文字の区切り（CDATA）が閉じていません");
      if (stack.length === 0) return fail("要素の外に文字があります");
      const err = addText(src.slice(lt + 9, e));
      if (err !== null) return fail(err);
      i = e + 3;
      continue;
    }
    if (src.startsWith("<!", lt)) return fail("文書型の宣言（DOCTYPE）や実体の宣言のある XML は読みません");
    if (src.startsWith("<?", lt)) {
      const e = src.indexOf("?>", lt + 2);
      if (e < 0) return fail("処理の指示が閉じていません");
      i = e + 2;
      continue;
    }
    if (src.startsWith("</", lt)) {
      let j = lt + 2;
      while (j < src.length && NAME_CHAR.test(src[j] as string)) j++;
      const raw = src.slice(lt + 2, j);
      while (j < src.length && /\s/u.test(src[j] as string)) j++;
      if (src[j] !== ">") return fail("閉じる札の形が違います");
      const s = stack.pop();
      if (s === undefined || s.raw !== raw) return fail("要素の開きと閉じが合っていません");
      if (stack.length === 0) closedRoot = true;
      i = j + 1;
      continue;
    }
    // 開く札
    let j = lt + 1;
    if (!NAME_START.test(src[j] ?? "")) return fail("札の名前の形が違います");
    while (j < src.length && NAME_CHAR.test(src[j] as string)) j++;
    const raw = src.slice(lt + 1, j);
    let selfClose = false;
    for (;;) {
      const ws = j;
      while (j < src.length && /\s/u.test(src[j] as string)) j++;
      if (src.startsWith("/>", j)) {
        selfClose = true;
        j += 2;
        break;
      }
      if (src[j] === ">") {
        j++;
        break;
      }
      if (j === ws || !NAME_START.test(src[j] ?? "")) return fail("属性の形が違います");
      while (j < src.length && NAME_CHAR.test(src[j] as string)) j++;
      while (j < src.length && /\s/u.test(src[j] as string)) j++;
      if (src[j] !== "=") return fail("属性の形が違います");
      j++;
      while (j < src.length && /\s/u.test(src[j] as string)) j++;
      const q = src[j];
      if (q !== '"' && q !== "'") return fail("属性の値の形が違います");
      const e = src.indexOf(q, j + 1);
      if (e < 0) return fail("属性の値が閉じていません");
      const v = src.slice(j + 1, e);
      if (v.includes("<") || decodeEntities(v) === null) return fail("属性の値の形が違います");
      j = e + 1;
    }
    if (closedRoot) return fail("一番外の要素が2つ以上あります");
    if (++count > XML_LIMITS.elements) return fail("要素が多すぎます");
    if (stack.length + 1 > XML_LIMITS.depth) return fail("入れ子が深すぎます");
    const parent = top();
    const name = local(raw);
    const inSkip = parent !== undefined && parent.el === null;
    const el: XmlElement | null = inSkip || skip.has(name) ? null : { name, children: [], text: "" };
    if (parent === undefined) {
      if (el === null) return fail("一番外の要素を読めません");
      root = el;
    } else if (el !== null) parent.el?.children.push(el);
    if (selfClose) {
      if (parent === undefined) closedRoot = true;
    } else stack.push({ raw, el });
    i = j;
  }
  if (stack.length > 0) return fail("要素が閉じていません（途中で切れたファイルかもしれません）");
  if (root === null) return fail("XML の要素がありません");
  return { ok: true, root };
}

/** すぐ下の子（名前で） */
export const childOf = (e: XmlElement, name: string): XmlElement | undefined => e.children.find((c) => c.name === name);

/** 下の要素を探す（最初の1つ。深さの上限つき） */
export function findFirst(e: XmlElement, name: string, depth: number = XML_LIMITS.depth): XmlElement | undefined {
  for (const c of e.children) {
    if (c.name === name) return c;
    if (depth > 1) {
      const f = findFirst(c, name, depth - 1);
      if (f !== undefined) return f;
    }
  }
  return undefined;
}

/** 下の要素を探す（全部。見つけた要素の中は探さない） */
export function findAll(e: XmlElement, names: ReadonlySet<string>, depth: number = XML_LIMITS.depth): XmlElement[] {
  const out: XmlElement[] = [];
  const walk = (x: XmlElement, d: number) => {
    for (const c of x.children) {
      if (names.has(c.name)) out.push(c);
      else if (d > 1) walk(c, d - 1);
    }
  };
  if (names.has(e.name)) return [e];
  walk(e, depth);
  return out;
}

/** 要素の中の文字（子の要素があれば、その文字もつなげる。前後の空白を外す） */
export function textOf(e: XmlElement | undefined): string {
  if (e === undefined) return "";
  const parts: string[] = [e.text];
  for (const c of e.children) parts.push(textOf(c));
  return parts.join("").replace(/\s+/gu, " ").trim();
}
