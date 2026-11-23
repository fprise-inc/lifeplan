// テストの道具: 画面を描いている途中でボタンを押し、押した後の形を HTML で返す（確かめの文・ボタンの並びを見るため）。
// preact-render-to-string は、描いている途中に状態が変わった部品をその場で描き直す。押す物（目印の属性）が初めて作られたときに onClick（無ければ onChange）を
// 呼ぶと、その部品の状態が変わり、押した後の形が描かれる。状態を持つ部品が自分で作る物にだけ使える（子の部品が作る物で親の状態を変えても、親は描き直されない）
import { options, type VNode } from "preact";
import { renderToString } from "preact-render-to-string";

/** attrs の順に押す（「data-x」か、値まで見る「data-x=値」）。見つからない物があれば失敗にする */
export function renderPressing(node: VNode<any>, ...attrs: string[]): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  const left = attrs.map((a) => a.split("=") as [string, string | undefined]);
  const prev = options.vnode;
  options.vnode = (v) => {
    const p = v.props as Record<string, unknown> | null;
    const next = left[0];
    if (next !== undefined && typeof v.type === "string" && p !== null && next[0] in p && (next[1] === undefined || String(p[next[0]]) === next[1])) {
      const press = p.onClick ?? p.onChange;
      if (typeof press === "function") {
        left.shift();
        (press as (e: unknown) => void)({ preventDefault: () => undefined, stopPropagation: () => undefined, currentTarget: {} });
      }
    }
    prev?.(v);
  };
  try {
    const html = renderToString(node);
    if (left.length > 0) throw new Error(`押す物が見つかりません: ${left.map((a) => a.join("=")).join("、")}`);
    return html;
  } finally {
    options.vnode = prev;
  }
}

/** HTML の中のボタンの文字（出てくる順） */
export const buttonTexts = (html: string): string[] => [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].map((m) => (m[1] ?? "").replace(/<[^>]+>/g, "").trim());

/** 目印の属性を持つ要素の中身（その要素の開くタグから、同じ名前の閉じるタグが釣り合う所まで） */
export function within(html: string, attr: string): string {
  const at = html.indexOf(attr);
  if (at < 0) throw new Error(`ありません: ${attr}`);
  const start = html.lastIndexOf("<", at);
  const tag = /^<([a-z0-9]+)/.exec(html.slice(start))?.[1] ?? "";
  const re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, re.lastIndex);
  }
  throw new Error(`閉じていません: ${attr}`);
}
