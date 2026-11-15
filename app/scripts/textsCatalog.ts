// 説明の一覧（0016 の 2026-11-01 の追記の2・2026-11-02 の追記）を、画面の定義から作る（prepare-assets が src/generated/texts-catalog.json に書く。
// 本体が build.rs で埋め込み、カスタム層の settings/texts.json を確かめる・承認した文を当てるのに使う。SDK の reference/texts.json にもする予定）。
//
// 今載せる物:
// - 欄の説明（`field:<入力項目ID>[/<道>]`。FieldDef.help）: 見本の世帯すべてで入力の画面を組み、当て先のある欄の説明を集める。
//   同じ id で世帯によって文が違う所（年・物の種類が文に入る所）は、差し込みの印（vars）を付けるまで載せない（数は summary に出す）
// - 計算の知らせ（`notice:<文の表の鍵>`。engineNotices.ts の文の表）: 種類（noticeKind）を付け、消せるのは前提の外・仮の値・制度データの知らせだけ
// - 推定の根拠の文（`estimate:<入力項目ID>[/<道>]`。2026-11-02 の追記の4）: 見本の世帯すべてで推定の欄を集める。公式の文は世帯ごとに違う
//   （統計の版・人数・額が入る）ので、一覧の公式の文は差し込みの印 {basis}（公式の根拠の文）だけ。事務所の文には {basis}・{value}（推定の値）を
//   差し込める。消せない（書き換える・足すだけ）
// - 結果の画面の文（`result:<タブ>/<名前>`。0212）: 結論の1文・その2行目・取り崩しの条件・グラフの注・結果のタブのポイント・「夢と予定」の区画の文・万一のときのタブの
//   結論の1文。表は src/workspace/resultTexts.ts（公式の文は差し込みの印つきの型）。結果の画面はお客さまと一緒に見るので audience は customer。
//   書き換えるだけ（消せるのはグラフの注だけ）。計算の値が入る印は numberVars（書き換えで落とすと本体の検査が注意を出す）
// まだ載せない物（後の回）: 当て先の無い欄（`field:ui.…`）・区画とまとまりの説明・ボタンの説明・入力項目の見出し・確かめの注意・提示層の文
//   （説明モード・お客さまに見せる画面）・提案書の文
//
// 名前の一覧（terms-catalog.json。`terms-reference@1.0`）と欄の一覧（fields-catalog.json。`fields-reference@1.0`）も、同じ画面の定義から作る
// （2026-11-02 の追記の1・2）:
// - 名前の一覧: 入力の欄の名前（`field:…`。見本の世帯すべてで同じ名前の欄だけ）と、結果の表の行の名前（`row:<行の鍵>`。report/src/rowNames.ts の表。
//   FP の画面・お客さまに見せる画面・提案書・持ち帰り用のレポートのどこでも同じ名前になるので audience は customer）
// - 欄の一覧: 隠す・並べ替えのできる入力の欄（当て先のある欄すべて）
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EngineRequest } from "../src/engine/types.ts";
import { noticeTextTable } from "../src/workspace/engineNotices.ts";
import type { FieldDef, StageId } from "../src/workspace/input/form.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { buildStage, STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { ESTIMATE_OFFICIAL, estimateTextId, fieldTextId } from "../src/workspace/input/textIds.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { RESULT_TEXTS, resultOfficialText } from "../src/workspace/resultTexts.ts";
import { ROW_NAME_VARS, ROW_NAMES } from "../../report/src/rowNames.ts";
import { APP_DIR, REPO_DIR } from "./lib.ts";

export const CATALOG_SCHEMA = "texts-reference@1.0";
export const TERMS_CATALOG_SCHEMA = "terms-reference@1.0";
export const FIELDS_CATALOG_SCHEMA = "fields-reference@1.0";

export interface CatalogEntry {
  id: string;
  kind: string;
  where: string;
  audience: "fp" | "customer";
  text: string;
  vars: string[];
  hash: string;
  ops: ("replace" | "append" | "hide" | "order")[];
  noticeKind?: string;
  /** 差し込みの印の意味（AI と承認の画面のため） */
  varsHelp?: Record<string, string>;
  /** 計算の値（年齢・年・額・率）が入る印。書き換えで落とすと本体の検査が注意を出す（結果の画面の文。0212） */
  numberVars?: string[];
}

export interface TextsCatalog {
  schema: string;
  /** 作った元の数（載せなかった物の数も。確かめ用） */
  summary: { fields: number; fieldsVarying: number; notices: number; estimates: number; results: number };
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

/** 見本の世帯すべての、入力の画面の欄（入力項目・世帯・欄） */
function* allModelFields(): Generator<{ st: { id: StageId; label: string }; wh: ReturnType<typeof fromRequest>; f: FieldDef }> {
  for (const req of models()) {
    const wh = fromRequest(req, {});
    for (const st of STAGES) {
      for (const sec of buildStage(st.id, wh).sections) {
        for (const g of sec.groups) {
          for (const f of [...g.fields, ...(g.openFields ?? [])]) yield { st, wh, f };
        }
      }
    }
  }
}

const ESTIMATE_VARS_HELP = { basis: "公式の根拠の文（世帯ごとに違う。例: 同じ人数の世帯の平均〔統計の版・人数〕）", value: "推定の値（例: 月28.5万円）" };

export function buildTextsCatalog(): TextsCatalog {
  const fields = new Map<string, { texts: Set<string>; where: string }>();
  const estimates = new Map<string, string>();
  for (const { st, wh, f } of allModelFields()) {
    if (fieldStatus(f, wh).status === "estimated") {
      const id = estimateTextId(f, wh);
      if (id !== null && !estimates.has(id)) estimates.set(id, `${st.label}の「${f.label}」の推定の根拠（「推定」の印を押すと出る文）`);
    }
    if (f.help === undefined || f.help === "" || f.readOnly !== undefined) continue;
    const id = fieldTextId(f, wh);
    if (id === null) continue;
    const e = fields.get(id) ?? { texts: new Set<string>(), where: `${st.label}の「${f.label}」の「?」` };
    e.texts.add(f.help);
    fields.set(id, e);
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
  for (const [id, where] of estimates) {
    entries.push({ id, kind: "estimate", where, audience: "fp", text: ESTIMATE_OFFICIAL, vars: ["basis", "value"], hash: sha(ESTIMATE_OFFICIAL), ops: ["replace", "append"], varsHelp: ESTIMATE_VARS_HELP });
  }
  const notices = noticeTextTable();
  for (const n of notices) {
    const text = escapeBraces(n.text);
    const hideable = n.kind === "outside" || n.kind === "assumed" || n.kind === "data";
    entries.push({ id: `notice:${n.key}`, kind: "notice", where: "結果のタブの「計算のお知らせ」", audience: "fp", text, vars: [], hash: sha(text), ops: hideable ? ["replace", "append", "hide"] : ["replace", "append"], noticeKind: n.kind });
  }
  for (const d of RESULT_TEXTS) {
    const text = resultOfficialText(d);
    const vars = Object.keys(d.vars);
    entries.push({
      id: d.id,
      kind: "result",
      where: d.where,
      audience: "customer",
      text,
      vars,
      hash: sha(text),
      ops: d.hideable === true ? ["replace", "hide"] : ["replace"],
      ...(vars.length > 0 ? { varsHelp: { ...d.vars } } : {}),
      ...(d.numberVars.length > 0 ? { numberVars: [...d.numberVars] } : {}),
    });
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { schema: CATALOG_SCHEMA, summary: { fields: fields.size - varying, fieldsVarying: varying, notices: notices.length, estimates: estimates.size, results: RESULT_TEXTS.length }, entries };
}

export interface NamedCatalog {
  schema: string;
  summary: Record<string, number>;
  entries: CatalogEntry[];
}

/** 名前の一覧（入力の欄の名前と、結果の表の行の名前） */
export function buildTermsCatalog(): NamedCatalog {
  const names = new Map<string, { labels: Set<string>; where: string }>();
  for (const { st, wh, f } of allModelFields()) {
    const id = fieldTextId(f, wh);
    if (id === null || f.label === "") continue;
    const e = names.get(id) ?? { labels: new Set<string>(), where: `${st.label}の欄「${f.label}」の名前（入力の画面）` };
    e.labels.add(f.label);
    names.set(id, e);
  }
  const entries: CatalogEntry[] = [];
  let varying = 0;
  for (const [id, e] of names) {
    if (e.labels.size !== 1) {
      varying++;
      continue;
    }
    const text = escapeBraces([...e.labels][0] as string);
    entries.push({ id, kind: "field", where: e.where, audience: "fp", text, vars: [], hash: sha(text), ops: ["replace"] });
  }
  for (const [key, text] of Object.entries(ROW_NAMES)) {
    const vars = [...(ROW_NAME_VARS[key] ?? [])];
    entries.push({
      id: `row:${key}`,
      kind: "row",
      where: `キャッシュフロー表の行「${text.replace("{person}", "○○")}」の名前（提案書・持ち帰り用のレポートも）`,
      audience: "customer",
      text,
      vars,
      hash: sha(text),
      ops: ["replace"],
      ...(vars.length > 0 ? { varsHelp: { person: "人の呼び方（ご本人・配偶者など）" } } : {}),
    });
  }
  entries.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { schema: TERMS_CATALOG_SCHEMA, summary: { fields: names.size - varying, fieldsVarying: varying, rows: Object.keys(ROW_NAMES).length }, entries };
}

/** 欄の一覧（隠す・並べ替えのできる入力の欄。text は公式の名前） */
export function buildFieldsCatalog(): NamedCatalog {
  const seen = new Map<string, CatalogEntry>();
  for (const { st, wh, f } of allModelFields()) {
    const id = fieldTextId(f, wh);
    if (id === null || seen.has(id)) continue;
    const text = escapeBraces(f.label);
    seen.set(id, { id, kind: "field", where: `${st.label}の欄「${f.label}」`, audience: "fp", text, vars: [], hash: sha(text), ops: ["hide", "order"] });
  }
  const entries = [...seen.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { schema: FIELDS_CATALOG_SCHEMA, summary: { fields: entries.length }, entries };
}

export const CATALOG_PATH = join(APP_DIR, "src", "generated", "texts-catalog.json");
export const TERMS_CATALOG_PATH = join(APP_DIR, "src", "generated", "terms-catalog.json");
export const FIELDS_CATALOG_PATH = join(APP_DIR, "src", "generated", "fields-catalog.json");

const writeIfChanged = (path: string, v: unknown): void => {
  const text = `${JSON.stringify(v, null, 1)}\n`;
  if (!existsSync(path) || readFileSync(path, "utf8") !== text) writeFileSync(path, text);
};

/** 一覧を書く（中身が変わっていなければ書かない） */
export function writeTextsCatalog(): void {
  writeIfChanged(CATALOG_PATH, buildTextsCatalog());
  writeIfChanged(TERMS_CATALOG_PATH, buildTermsCatalog());
  writeIfChanged(FIELDS_CATALOG_PATH, buildFieldsCatalog());
}
