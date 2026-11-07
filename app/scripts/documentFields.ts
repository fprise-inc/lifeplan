// 書類を読む AI 向けの「入力の欄の一覧」（0152 の2）を、入力の画面の欄の定義から作る（sdk/skills/read-documents/fields.md）。
// 書類の候補（答えの形 document-candidates@1）の当て先は、入力項目ID と場所 at で入力の画面の欄に当たる（documents/resolve.ts）。
// AI が迷わず書けるように、書類から入る入力項目の欄ごとに、場所・欄の名前・値の書き方（円・整数の単位・率・年月・選択肢）・額の期間を並べる。
//
// - 読めるのは保険証券・ご契約内容のお知らせ・設計書だけ（0159）なので、保険の契約の欄（insurance.）だけを載せる
// - 欄は、見本の世帯すべての入力の画面と、保険の種類ごとに1件足した形から集める。足す形は画面のボタンと同じ操作で作る（形を手で作らない）
// - 場所の中の物の中の明細の ID（保険の保障など）は `<ID>` と書き、AI が書く形（ID を除いた形）を添える
// - 時点の欄（when）は、書類の年月を決まった年月の時点として入れられる（documents/apply.ts の coerce。0154 の4）。年齢・出来事で決める入れ方は欄で直す
//
// npm run gen:document-fields で書き直す。中身が今の画面の定義と同じかは test/documentGuides.test.ts が確かめる（変えたら書き直す）
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { EngineRequest } from "../src/engine/types.ts";
import { ITEM_LABELS } from "../src/generated/labels.ts";
import { createObject } from "../src/workspace/documents/apply.ts";
import { NEW_OBJECT_KINDS } from "../src/workspace/documents/objects.ts";
import { findObject } from "../src/workspace/store/readings.ts";
import { fieldPlaces } from "../src/workspace/documents/resolve.ts";
import type { FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { KINDS } from "../src/workspace/input/insuranceKinds.ts";
import { READABLE_ITEM_PREFIX } from "../src/workspace/documents/types.ts";
import { REPO_DIR } from "./lib.ts";

/** 書類から入る入力項目（この頭の入力項目の欄だけを載せる。読み口が受ける入力項目と同じ。0159） */
export const DOCUMENT_ITEM_PREFIXES = [READABLE_ITEM_PREFIX] as const;

export const DOCUMENT_FIELDS_PATH = join(REPO_DIR, "sdk", "skills", "read-documents", "fields.md");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function models(): WorkingHousehold[] {
  const dir = join(REPO_DIR, "data", "modelHouseholds");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => fromRequest(JSON.parse(readFileSync(join(dir, f), "utf8")) as EngineRequest, {}));
}


/** 保険の種類ごとに1件足した形（書類から足す新しい物と同じ作り方。documents/apply.ts の createObject） */
function insuranceVariants(wh: WorkingHousehold): WorkingHousehold[] {
  return Object.keys(NEW_OBJECT_KINDS).flatMap((k) => {
    const made = createObject(wh, k);
    return made === null ? [] : [made.wh];
  });
}

interface Row {
  item: string;
  at: string[];
  kind: FieldDef["kind"];
  period: string;
  labels: Set<string>;
  /** 選択肢（値 → 名前。人を選ぶ欄の構成員の ID は people に数えるだけ） */
  options: Map<string, string>;
  people: boolean;
  suffix: Set<string>;
  min: number | null;
  max: number | null;
  who: Set<string>;
  structural: boolean;
}

const PERIOD: Record<string, string> = { monthly: "月額", annual: "年額", once: "1回の額・時点の額" };

function valueText(r: Row): string {
  switch (r.kind) {
    case "yen":
      return "円の整数";
    case "int": {
      const range = r.min !== null || r.max !== null ? `・${r.min ?? ""}〜${r.max ?? ""}` : "";
      return `整数${r.suffix.size > 0 ? `（${[...r.suffix].join("・")}）` : ""}${range}`;
    }
    case "pct":
      return "率（「1.2%」のように % を付けた文字）";
    case "decimal":
      return `10進の数の文字${r.suffix.size > 0 ? `（${[...r.suffix].join("・")}）` : ""}`;
    case "select": {
      const rest = [...r.options].map(([v, l]) => `\`${v}\`（${l}）`).join("・");
      if (r.people) return `人（self・spouse・child1…・holder）${rest !== "" ? `か ${rest}` : ""}`;
      return `選択肢: ${rest}`;
    }
    case "ym":
      return "年月（YYYY-MM）";
    case "bool":
      return "真偽（true・false）";
    case "text":
      return "文字（200字まで）";
    case "when":
      return "年月（YYYY-MM。時点の欄）";
  }
}

const OWNER_KEYS = ["member", "owner", "insured", "policyholder", "annuitant"] as const;

/** 欄の持ち主の書き方: 人の欄（member）・人の物の欄（member でも物でも当たる）・物の欄（newObject・object）・世帯の欄 */
function whoOf(wh: WorkingHousehold, p: ReturnType<typeof fieldPlaces>[number]): string {
  const input = wh.request.input as unknown as Record<string, unknown>;
  const memberIds = new Set(wh.request.input.household.members.map((m) => m.id));
  const owned = (id: string): boolean => {
    const o = findObject(input, id);
    return o !== undefined && OWNER_KEYS.some((k) => typeof o[k] === "string" && memberIds.has(o[k] as string));
  };
  const t = p.address?.target;
  if (t !== undefined) {
    if ("member" in t) return "人の欄";
    if ("object" in t) return memberIds.has(t.object) ? "人の欄" : owned(t.object) ? "人の物の欄" : "物の欄";
    return "世帯の欄";
  }
  const ids = p.field.key.split("/").filter((x) => UUID.test(x));
  if (ids.some((x) => memberIds.has(x))) return "人の欄";
  if (ids.some(owned)) return "人の物の欄";
  return ids.length > 0 ? "物の欄" : "世帯の欄";
}

const esc = (s: string): string => s.replace(/\|/gu, "／").replace(/\n/gu, " ");

/** 一覧の Markdown を作る */
export function buildDocumentFields(): string {
  const rows = new Map<string, Row>();
  const base = models();
  const all = [...base, ...insuranceVariants(base[0] as WorkingHousehold)];
  for (const wh of all) {
    for (const p of fieldPlaces(wh)) {
      const f = p.field;
      if (f.item === null || !DOCUMENT_ITEM_PREFIXES.some((x) => (f.item as string).startsWith(x))) continue;
      const at = p.address === null ? [] : p.address.at.map((x) => (UUID.test(x) ? "<ID>" : x));
      const period = f.kind === "yen" ? (PERIOD[f.basis] ?? f.basis) : "";
      const key = `${f.item}|${at.join("/")}|${f.kind}|${period}|${f.kind === "select" ? f.label : ""}`;
      const r = rows.get(key) ?? { item: f.item, at, kind: f.kind, period, labels: new Set<string>(), options: new Map<string, string>(), people: false, suffix: new Set<string>(), min: null, max: null, who: new Set<string>(), structural: false };
      r.labels.add(f.label);
      r.who.add(whoOf(wh, p));
      if (f.structural === true) r.structural = true;
      if (f.kind === "select")
        for (const o of f.options) {
          if (UUID.test(o.value)) r.people = true;
          else if (o.value !== "" && !r.options.has(o.value)) r.options.set(o.value, o.label);
        }
      if (f.kind === "int" || f.kind === "decimal") {
        if (f.suffix !== undefined) r.suffix.add(f.suffix);
      }
      if (f.kind === "int") {
        if (f.min !== undefined) r.min = r.min === null ? f.min : Math.min(r.min, f.min);
        if (f.max !== undefined) r.max = r.max === null ? f.max : Math.max(r.max, f.max);
      }
      rows.set(key, r);
    }
  }
  const order = (r: Row): string => `${r.item}|${r.at.join("/")}|${[...r.labels][0] ?? ""}`;
  const sorted = [...rows.values()].sort((a, b) => (order(a) < order(b) ? -1 : order(a) > order(b) ? 1 : 0));
  const lines: string[] = [
    "# 入力の欄の一覧（保険の書類から入る入力項目）",
    "",
    "<!-- 自動生成（app/scripts/documentFields.ts。npm run gen:document-fields）。手で直さない -->",
    "",
    "書類の候補の `values[].item`（入力項目ID）と `at`（場所）は、この一覧の組み合わせだけを書きます。値は「値の書き方」の形で、円の欄の `period` は「額の期間」に合わせます（違う期間の額は、FP が直して入れることになります）。",
    "",
    "- 読めるのは保険証券・ご契約内容のお知らせ・設計書だけです（`docType` は `insurancePolicy`）。この一覧に無い入力項目の候補は、アプリが読みません。",
    "- **場所**の `<ID>` は、物の中の明細（保険の保障など）の ID です。ID を知らないときは `<ID>` を除いて書きます（例: `[\"<ID>\", \"amount\"]` → `\"at\": [\"amount\"]`。何本も当たれば FP が選びます）。場所が「（なし）」の欄は `at` を書きません。",
    "- **人・物**: 「人の欄」は `member`（`holder`〔書類の名義の人〕・`self`・`spouse`・`child1`…）を書きます。「人の物の欄」（その人の保険の契約）は `member` で当たります（その人の契約が何件もあれば FP が選びます）。新しく足す契約の欄は `newObject`（`objects` の鍵）を書きます。今ある契約の ID が分かるとき（AI接続口で世帯を受け取ったとき）だけ `object` に書きます。",
    "- **種類を決める欄**は、計算を大きく変えるので、FP が1つずつ承認します（まとめての承認に入りません）。",
    "- 欄の名前は、入力の画面の名前です（世帯・種類によって名前が変わる欄は、いくつか並べています）。",
    "- **時点の欄**（「年月（YYYY-MM。時点の欄）」。払込の終わり・保障の終わりのように、年月か年齢・出来事で決める欄）は、書類に印字された年月だけを `\"YYYY-MM\"` で書けます（決まった年月の時点として入ります）。保険の手引きでは書かない欄です（年齢で決まることが多いため）。",
    "",
  ];
  let current = "";
  for (const r of sorted) {
    const group = r.item.split(".")[0] as string;
    if (group !== current) {
      const first = current === "";
      current = group;
      lines.push(...(first ? [] : [""]), `## ${group}`, "", "| 入力項目ID | 場所 at | 欄の名前 | 値の書き方 | 額の期間 | 人・物 |", "|---|---|---|---|---|---|");
    }
    const at = r.at.length === 0 ? "（なし）" : `\`${JSON.stringify(r.at)}\``;
    const labels = [...r.labels].slice(0, 4).join("・");
    const name = `${esc(labels)}${r.structural ? "（種類を決める欄）" : ""}`;
    lines.push(`| \`${r.item}\`（${esc(ITEM_LABELS[r.item] ?? "")}） | ${at} | ${name} | ${esc(valueText(r))} | ${r.period} | ${[...r.who].sort().join("・")} |`);
  }
  lines.push(
    "",
    "## 新しい物の種類（`objects[].kind`）",
    "",
    "保険の契約は、証券1通（主契約と特約で1つの契約）ごとに `objects` に1つ書き、その契約の値の候補に `newObject` でその鍵を書きます。同じ契約が世帯にもうあれば、FP が確かめの画面で「今の○○に当てる」を選びます（AI は、今ある契約の ID が分かるときだけ `object` に書き、`objects` には書きません）。",
    "",
    "| kind | 名前 | 主な保障（`insurance.coverages` の `[\"amount\"]`） | 保障の額の期間 |",
    "|---|---|---|---|",
  );
  for (const k of KINDS) {
    if (NEW_OBJECT_KINDS[`insurance:${k.kind}`] === undefined) continue;
    lines.push(`| \`insurance:${k.kind}\` | ${esc(k.label)} | ${k.main === null ? "（保障の額を持たない。保険料だけ）" : esc(k.main.label)} | ${k.main === null ? "" : (PERIOD[k.main.basis] ?? k.main.basis)} |`);
  }
  lines.push("");
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  writeFileSync(DOCUMENT_FIELDS_PATH, buildDocumentFields());
  console.log(`書きました: ${DOCUMENT_FIELDS_PATH}`);
}
