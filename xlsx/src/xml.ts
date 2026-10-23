// 最小限の XML の読み書き（.xlsx の中の決まった形の文書だけを読む）。
// 返ってきたファイルは信用しない: DOCTYPE（実体の定義）は読まずに止める（実体の展開で膨らませる攻撃・外部の実体の読み込みを防ぐ）。
// 定義済みの5つの実体と文字参照だけを戻す

export interface XmlElement {
  /** 接頭辞を除いた名前（x:row → row） */
  readonly name: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
}
export type XmlNode = XmlElement | string;

export class XmlError extends Error {}

const ENTITIES: Readonly<Record<string, string>> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e] ?? m;
  });
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const localName = (n: string) => {
  const i = n.indexOf(":");
  return i < 0 ? n : n.slice(i + 1);
};

/** XML の文字を木にする */
export function parseXml(text: string): XmlElement {
  let p = 0;
  const n = text.length;
  const stack: { name: string; attrs: Record<string, string>; children: XmlNode[] }[] = [{ name: "#root", attrs: {}, children: [] }];
  while (p < n) {
    const lt = text.indexOf("<", p);
    if (lt < 0) {
      pushText(text.slice(p));
      break;
    }
    if (lt > p) pushText(text.slice(p, lt));
    if (text.startsWith("<?", lt)) {
      const e = text.indexOf("?>", lt);
      if (e < 0) throw new XmlError("XML が壊れています");
      p = e + 2;
    } else if (text.startsWith("<!--", lt)) {
      const e = text.indexOf("-->", lt);
      if (e < 0) throw new XmlError("XML が壊れています");
      p = e + 3;
    } else if (text.startsWith("<![CDATA[", lt)) {
      const e = text.indexOf("]]>", lt);
      if (e < 0) throw new XmlError("XML が壊れています");
      top().children.push(text.slice(lt + 9, e));
      p = e + 3;
    } else if (text.startsWith("<!", lt)) {
      throw new XmlError("DOCTYPE などの定義を含む XML は読みません");
    } else if (text.startsWith("</", lt)) {
      const e = text.indexOf(">", lt);
      if (e < 0) throw new XmlError("XML が壊れています");
      const name = localName(text.slice(lt + 2, e).trim());
      const cur = stack.pop();
      if (cur === undefined || cur.name !== name || stack.length === 0) throw new XmlError("XML のタグの対応が壊れています");
      top().children.push({ name: cur.name, attrs: cur.attrs, children: cur.children });
      p = e + 1;
    } else {
      // 開始タグ: 属性の値の中の > に気をつけて終わりを探す
      let q = lt + 1;
      let quote = "";
      while (q < n) {
        const ch = text[q];
        if (quote !== "") {
          if (ch === quote) quote = "";
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === ">") break;
        q++;
      }
      if (q >= n) throw new XmlError("XML が壊れています");
      let body = text.slice(lt + 1, q);
      const selfClose = body.endsWith("/");
      if (selfClose) body = body.slice(0, -1);
      const m = /^([^\s/>]+)/.exec(body);
      if (m === null) throw new XmlError("XML が壊れています");
      const name = localName(m[1] as string);
      const attrs: Record<string, string> = {};
      const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      const rest = body.slice((m[1] as string).length);
      let a: RegExpExecArray | null;
      while ((a = re.exec(rest)) !== null) attrs[localName(a[1] as string)] = decodeEntities(a[3] ?? a[4] ?? "");
      if (selfClose) top().children.push({ name, attrs, children: [] });
      else {
        if (stack.length > 200) throw new XmlError("XML の入れ子が深すぎます");
        stack.push({ name, attrs, children: [] });
      }
      p = q + 1;
    }
  }
  if (stack.length !== 1) throw new XmlError("XML のタグが閉じていません");
  const root = stack[0]?.children.find((c): c is XmlElement => typeof c !== "string");
  if (root === undefined) throw new XmlError("XML が空です");
  return root;

  function top() {
    return stack[stack.length - 1] as { name: string; attrs: Record<string, string>; children: XmlNode[] };
  }
  function pushText(t: string) {
    if (stack.length > 1) top().children.push(decodeEntities(t));
  }
}

export function child(el: XmlElement, name: string): XmlElement | undefined {
  return el.children.find((c): c is XmlElement => typeof c !== "string" && c.name === name);
}

export function childrenNamed(el: XmlElement, name: string): XmlElement[] {
  return el.children.filter((c): c is XmlElement => typeof c !== "string" && c.name === name);
}

/** 子孫の文字をつなげる（共有文字列の書式つきの文字 r/t も） */
export function textOf(el: XmlElement): string {
  let s = "";
  for (const c of el.children) {
    if (typeof c === "string") s += c;
    else if (c.name !== "rPh" && c.name !== "phoneticPr") s += textOf(c);
  }
  return s;
}
