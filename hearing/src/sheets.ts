// アプリに同梱する公式のシート定義（公開したすべての版を残し続ける。0018 の7）。Excel の書き出し・読み込みの部品を読まずに
// シート定義だけを使う所（AI接続口の同梱の JS など。0222）のために、入口（index.ts）から分けた
import basic1 from "../sheets/basic/1.json" with { type: "json" };
import basic2 from "../sheets/basic/2.json" with { type: "json" };
import basic3 from "../sheets/basic/3.json" with { type: "json" };
import full1 from "../sheets/full/1.json" with { type: "json" };
import full2 from "../sheets/full/2.json" with { type: "json" };
import full3 from "../sheets/full/3.json" with { type: "json" };
import full4 from "../sheets/full/4.json" with { type: "json" };
import full5 from "../sheets/full/5.json" with { type: "json" };
import type { SheetDefinition } from "./definition.ts";

/** アプリに同梱する公式のシート定義（公開したすべての版を残し続ける。0018 の7） */
export const OFFICIAL_SHEETS: readonly SheetDefinition[] = [basic1, basic2, basic3, full1, full2, full3, full4, full5] as unknown as SheetDefinition[];
