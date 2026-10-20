// 持ち帰り用のレポートの HTML ファイルを作る（作業の層。0030）。保存は本体の平文の書き出しの出口（host.takeaway.save。0020 の5）。
// - 画面の部品（public/takeaway/viewer.js・viewer.css）と計算エンジン（public/engine/engine.js。本体が埋め込むものと同じファイル）は、
//   アプリ自身の中から読む（CSP の connect-src 'self'）。外のサーバーには取りに行かない
// - 制度データはその世帯の計算に使うものだけに絞る（packs.ts。確かめて同じ結果にならなければ全部）
// - パスワードを付けたときは、データ（宛名・作成日・事務所名・計算の要求・制度データ）を丸ごと暗号化する（container.ts）。パスワードは
//   この関数の中だけで使い、どこにも保存しない
import type { WebEngine } from "../../engine/host.ts";
import { gzip, seal, sha256Hex, toBase64 } from "../../takeaway/container.ts";
import { assembleHtml } from "../../takeaway/html.ts";
import type { TakeawayData, TakeawayPayload } from "../../takeaway/model.ts";
import { probeRequests } from "./build.ts";
import { choosePacks, type PackChoice } from "./packs.ts";

export interface TakeawayAssets {
  viewerJs: string;
  viewerCss: string;
  engineJs: string;
  /** 入れた部品のライセンスの文 */
  licenses: string;
}

/** アプリの中から部品を読む（画面のビルドに入っているファイル） */
export async function loadAssets(fetcher: (path: string) => Promise<Response> = (p) => fetch(p)): Promise<TakeawayAssets> {
  const get = async (p: string) => {
    const r = await fetcher(p);
    if (!r.ok) throw new Error("E_TAKEAWAY_ASSET");
    return r.text();
  };
  const [viewerJs, viewerCss, engineJs, licenses] = await Promise.all([get("/takeaway/viewer.js"), get("/takeaway/viewer.css"), get("/engine/engine.js"), get("/takeaway/licenses.txt")]);
  return { viewerJs, viewerCss, engineJs, licenses };
}

export interface TakeawayFile {
  bytes: Uint8Array;
  packs: Omit<PackChoice, "packs">;
  /** ファイルの大きさの内訳（バイト） */
  sizes: { total: number; engine: number; data: number; viewer: number };
}

export async function makeTakeawayFile(o: { payload: TakeawayPayload; engine: WebEngine; packsJson: string; password: string | null; assets: TakeawayAssets }): Promise<TakeawayFile> {
  const choice = choosePacks(o.engine, o.packsJson, probeRequests(o.payload));
  const data: TakeawayData = { payload: o.payload, packs: choice.packs };
  const sealed = await seal(JSON.stringify(data), o.password);
  const engineBytes = new TextEncoder().encode(o.assets.engineJs);
  const engineGz = toBase64(await gzip(engineBytes));
  const html = await assembleHtml({ viewerJs: o.assets.viewerJs, viewerCss: o.assets.viewerCss, engineGz, engineSha256: await sha256Hex(engineBytes), sealed, licenses: o.assets.licenses });
  const bytes = new TextEncoder().encode(html);
  const { packs: _p, ...packInfo } = choice;
  void _p;
  return { bytes, packs: packInfo, sizes: { total: bytes.length, engine: engineGz.length, data: sealed.body.length, viewer: o.assets.viewerJs.length + o.assets.viewerCss.length } };
}
