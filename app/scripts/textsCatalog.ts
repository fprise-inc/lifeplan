// 説明の一覧（0016 の 2026-11-01 の追記の2・2026-11-02 の追記）を、画面の定義から作る（prepare-assets が src/generated/texts-catalog.json に書く。
// 本体が build.rs で埋め込み、カスタム層の settings/texts.json を確かめる・承認した文を当てるのに使う。SDK の reference/texts.json にもする予定）。
//
// 今載せる物:
// - 欄の説明（`field:<入力項目ID>[/<道>]`。FieldDef.help）: 見本の世帯すべてで入力の画面を組み、当て先のある欄の説明を集める。
//   同じ id で世帯によって文が違う所（年・物の種類が文に入る所）は、差し込みの印（vars）を付けるまで載せない（数は summary に出す）
// - 計算の知らせ（`notice:<文の表の鍵>`。engineNotices.ts の文の表）: 種類（noticeKind）を付け、消せるのは前提の外・仮の値・制度データの知らせだけ
// まだ載せない物（後の回）: 当て先の無い欄（`field:ui.…`）・区画とまとまりの説明・ボタンの説明・入力項目の見出し・推定の根拠・確かめの注意・提示層の文
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineRequest } from "../src/engine/types.ts";
import { noticeTextTable } from "../src/workspace/engineNotices.ts";
import type { StageId } from "../src/workspace/input/form.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { buildStage, STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { fieldTextId } from "../src/workspace/input/textIds.ts";
import { APP_DIR, REPO_DIR } from "./lib.ts";

export const CATALOG_SCHEMA = "texts-reference@1.0";

export interface CatalogEntry {
  id: string;
  kind: string;
  where: string;
  audience: "fp" | "customer";
  text: string;
  vars: string[];
  hash: string;
  ops: ("replace" | "append" | "hide")[];
  noticeKind?: string;
}

export interface TextsCatalog {
  schema: string;
  /** 作った元の数（載せなかった物の数も。確かめ用） */
  summary: { fields: number; fieldsVarying: number; notices: number };
  entries: CatalogEntry[];
}

const sha = (s: string): string => `sha256:${createHash("sha256").update(s, "utf8").digest("hex")}`;

/** 欄の説明の中の { } は、差し込みの印ではなく字そのもの（一覧の文は {{ }} で書く） */
const escapeBraces = (s: string): string => s.replace(/\{/g, "{{").replace(/\}/g, "}}");

const STAGES: { id: StageId; label: string }[] = [...STAGE_ORDER, { id: "fee", label: "FP顧問料" }];

function models(): EngineRequest[] {
  const dir = join(REPO_DIR, "data", "modelHouseholds");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as EngineRequest);
}

export function buildTextsCatalog(): TextsCatalog {
  const fields = new Map<string, { texts: Set<string>; where: string }>();
  for (const req of models()) {
    const wh = fromRequest(req, {});
    for (const st of STAGES) {
      for (const sec of buildStage(st.id, wh).sections) {
        for (const g of sec.groups) {
          for (const f of [...g.fields, ...(g.openFields ?? [])]) {
            if (f.help === undefined || f.help === "" || f.readOnly !== undefined) continue;
            const id = fieldTextId(f, wh);
            if (id === null) continue;
            const e = fields.get(id) ?? { texts: new Set<string>(), where: `${st.label}の「${f.label}」の「?」` };
            e.texts.add(f.help);
            fields.set(id, e);
          }
        }
      }
    }
  }
  const entries: CatalogEntry[] = [];
  let varying = 0;
  for (const [id, e] of fields) {
    if (e.texts.size !== 1) {
      varying++;
      continue;
    }
    const text = escapeBraces([...e.texts][0] as string);
    entries.push({ id, kind: "field", where: e.where, audience: "fp", text, vars: [], hash: sha(text), ops: ["replace", "append", "hide"] });
  }
  const notices = noticeTextTable();
  for (const n of notices) {
    const text = escapeBraces(n.text);
    const hideable = n.kind === "outside" || n.kind === "assumed" || n.kind === "data";
    entries.push({ id: `notice:${n.key}`, kind: "notice", where: "結果のタブの「計算のお知らせ」", audience: "fp", text, vars: [], hash: sha(text), ops: hideable ? ["replace", "append", "hide"] : ["replace", "append"], noticeKind: n.kind });
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { schema: CATALOG_SCHEMA, summary: { fields: fields.size - varying, fieldsVarying: varying, notices: notices.length }, entries };
}

export const CATALOG_PATH = join(APP_DIR, "src", "generated", "texts-catalog.json");

/** 一覧を書く（中身が変わっていなければ書かない） */
export function writeTextsCatalog(): void {
  const text = `${JSON.stringify(buildTextsCatalog(), null, 1)}\n`;
  if (!existsSync(CATALOG_PATH) || readFileSync(CATALOG_PATH, "utf8") !== text) writeFileSync(CATALOG_PATH, text);
}
