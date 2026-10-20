// 持ち帰り用のレポートの HTML ファイル1つを組み立てる（0030）。
// - 画面の部品（viewer.js・viewer.css。scripts/build-takeaway.ts が作る）と、計算エンジン（engine/dist/engine.js と同じバイト列を gzip したもの）と、
//   データの塊（container.ts。パスワードを付けたときは暗号化したもの）を1つの HTML に入れる。外のファイル・サーバーは読まない
// - CSP（meta）: 外への通信を全部止める（connect-src・img-src・font-src・frame-src などは 'none'）。実行できるのは、ハッシュで決めた画面の部品の
//   スクリプトと、その部品が作る blob: の URL（計算エンジンを縮めて入れているので、開いた後にほどいて読み込む）だけ。style も ハッシュで決めた1つだけ
// - 平文で出るのは、見出し（形式・版・暗号の値）と、計算エンジン・画面の部品（公開のコード）だけ。暗号化したときは、宛名・作成日・事務所名・数字は
//   すべてデータの塊の中
import { BLOCK, headerText, sha256Base64, type Sealed } from "./container.ts";

export interface TakeawayParts {
  viewerJs: string;
  viewerCss: string;
  /** 計算エンジンの gzip（Base64）と、元の JS の SHA-256（16進） */
  engineGz: string;
  engineSha256: string;
  sealed: Sealed;
  /** 入れた部品のライセンスの文（scripts/build-takeaway.ts の licenses.txt。HTML の末尾にコメントで入れる） */
  licenses: string;
}

/** HTML の中の <script>・<style> を途中で閉じさせない（書き換えると意味が変わりうるので、含んでいたら止める） */
function scriptSafe(s: string): string {
  if (/<\/?script|<!--/i.test(s)) throw new Error("E_TAKEAWAY_VIEWER");
  return s;
}
function styleSafe(s: string): string {
  if (/<\/?style|<!--/i.test(s)) throw new Error("E_TAKEAWAY_VIEWER");
  return s;
}
const jsonSafe = (s: string) => s.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

export const TAKEAWAY_TITLE = "ライフプランの試算";

export function csp(scriptHash: string, styleHash: string): string {
  return [
    "default-src 'none'",
    `script-src 'sha256-${scriptHash}' blob:`,
    `style-src 'sha256-${styleHash}'`,
    "img-src 'none'",
    "font-src 'none'",
    "connect-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'none'",
    "manifest-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join("; ");
}

export async function assembleHtml(p: TakeawayParts): Promise<string> {
  const js = scriptSafe(p.viewerJs);
  const css = styleSafe(p.viewerCss);
  const policy = csp(await sha256Base64(js), await sha256Base64(css));
  return [
    "<!doctype html>",
    '<html lang="ja">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${policy}">`,
    '<meta name="referrer" content="no-referrer">',
    '<meta name="robots" content="noindex, nofollow">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${TAKEAWAY_TITLE}</title>`,
    `<style>${css}</style>`,
    "</head>",
    "<body>",
    '<div id="app"><p class="tk-boot">読み込んでいます…</p><noscript><p class="tk-boot">このファイルは、ブラウザで JavaScript を有効にして開いてください。</p></noscript></div>',
    `<script type="application/json" id="${BLOCK.header}">${jsonSafe(headerText(p.sealed.header))}</script>`,
    `<script type="application/octet-stream" id="${BLOCK.data}">${p.sealed.body}</script>`,
    `<script type="application/octet-stream" id="${BLOCK.engine}" data-sha256="${p.engineSha256}">${p.engineGz}</script>`,
    `<script>${js}</script>`,
    "</body>",
    "</html>",
    `<!--\nこのファイルに入れた部品のライセンス\n\n${p.licenses.replace(/--/g, "- -").replace(/[<>]/g, " ")}\n-->`,
    "",
  ].join("\n");
}
