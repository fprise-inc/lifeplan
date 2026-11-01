// 読み替え表（0035 の9・0036 の5）と、凍結した読み替えの見本（0035 の12）
// - 作る手順（手で流す: WRITE_READINGS=1 npx vitest run test/readings.test.ts）: 0.16 の画面の欄の定義・動かす項目の一覧を、見本の世帯
//   （モデル世帯・形式の見本・画面の「＋ 足す」の操作で物を足した世帯）で動かし、鍵ごとに「値を変えると世帯のどの1つの値が変わるか」を
//   調べて registry/readings.yaml を作り、古い鍵・当て先・値の組を凍結した見本（crates/household-store/tests/fixtures/readings/0.16/）に書く。
//   1つの値をそのまま書かない欄（複数の値を動かす・物を作る・単位を変える）は、下の OVERRIDES で合成の対策か「読み替えられない」にする。
//   この手順は 0.16 の欄の定義があるうちだけ使う（入力画面を作り直して欄の定義が変わったら消す。作ったものは凍結した見本として残る）
// - いつも流す確かめ: 凍結した見本のすべての組が、表でいつも同じ当て先に読め、当て先の値が見本の値と同じこと。表の行はどれも見本で確かめてある
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { READING_ENTRIES } from "../src/generated/readings.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { allFields } from "../src/workspace/input/form.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { buildStages } from "../src/workspace/input/stages/index.ts";
import { LATER_FIELD_ENTRIES } from "../src/workspace/store/laterFields.ts";
import { keyOf, LATER_ENTRIES, matchKey, migrationId, readAt, resolveAssumedKey, resolveKey, sha256, unbox, type AtStep, type Reading, type ReadingEntry } from "../src/workspace/store/readings.ts";

const FROZEN = join(REPO_DIR, "crates", "household-store", "tests", "fixtures", "readings", "0.16");
const FORMAT = join(REPO_DIR, "crates", "household-store", "tests", "fixtures", "household-format");

/** 凍結した見本の1組: 世帯・古い鍵・読み替えた先・当て先に入っている値（無ければ null） */
interface FrozenRecord {
  household: string;
  key: string;
  reading: Reading;
  value: unknown;
}

type Json = Record<string, unknown>;

/** 凍結した見本の世帯の要求の `input`（形式の見本は本文の household.request から、ほかは凍結した世帯から） */
function frozenInput(name: string): Json {
  if (name.startsWith("format-")) {
    const body = JSON.parse(readFileSync(join(FORMAT, name.slice("format-".length), "body.json"), "utf8")) as { household: { request: { input: Json } } };
    return body.household.request.input;
  }
  return (JSON.parse(readFileSync(join(FROZEN, "households", `${name}.json`), "utf8")) as { input: Json }).input;
}

function readFrozen(): FrozenRecord[] {
  return JSON.parse(readFileSync(join(FROZEN, "records.json"), "utf8")) as FrozenRecord[];
}

/** 古い鍵を、その種類の決まりで読む（`assumed:` で始まる鍵は仮の印） */
function resolveAny(key: string, input: Json): Reading | null {
  return key.startsWith("assumed:") ? resolveAssumedKey(key.slice("assumed:".length), input) : resolveKey(key, input);
}

describe("読み替え表と凍結した見本（0035 の9・12）", () => {
  it("決まった ID は SHA-256 から UUID 第4版の書式で作る", () => {
    for (const s of ["", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(64), "あいう"]) {
      const want = createHash("sha256").update(s, "utf8").digest("hex");
      expect(Buffer.from(sha256(new TextEncoder().encode(s))).toString("hex")).toBe(want);
    }
    const id = migrationId("3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10/rateSchedule/0");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // 本体の変換の段も同じ ID を作る（同じ固定の値を本体のテスト crates/household-store/tests/readings.rs でも確かめる）
    expect(id).toBe("7c511b6c-4f38-4475-ac92-7c43676cfba5");
    expect(id).not.toBe(migrationId("3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10/rateSchedule/1"));
    const digest = createHash("sha256").update("lifeplan.migrate.0.17:3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10/rateSchedule/0", "utf8").digest();
    const b = Buffer.from(digest.subarray(0, 16));
    b[6] = ((b[6] as number) & 0x0f) | 0x40;
    b[8] = ((b[8] as number) & 0x3f) | 0x80;
    expect(id.replaceAll("-", "")).toBe(b.toString("hex"));
  });

  it("表の型は重ならず、入力項目ID は登録簿にある（廃止の ID は読み替え先つき）", () => {
    const froms = READING_ENTRIES.map((e) => e.from);
    expect(new Set(froms).size).toBe(froms.length);
    const reg = readFileSync(join(REPO_DIR, "registry", "items.yaml"), "utf8");
    for (const e of READING_ENTRIES) {
      expect(e.until).toBe("0.16");
      if ("item" in e.to) expect(reg, e.from).toContain(`- id: ${e.to.item}\n`);
      // 1つの鍵に合う行は1つだけ
      const sample = e.from.replace(/\{(object|member|id)\}/g, "3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10").replace(/\{n\}/g, "0");
      expect(READING_ENTRIES.filter((x) => matchKey(sample)?.entry === x).length, e.from).toBe(1);
      expect(matchKey(sample)?.entry.from).toBe(e.from);
    }
  });

  it.runIf(existsSync(join(FROZEN, "records.json")))("凍結した見本の組が、表でいつも同じ当て先に読め、値が同じ", () => {
    const records = readFrozen();
    expect(records.length).toBeGreaterThan(0);
    const inputs = new Map<string, Json>();
    const used = new Set<string>();
    for (const r of records) {
      const input = inputs.get(r.household) ?? frozenInput(r.household);
      inputs.set(r.household, input);
      const got = resolveAny(r.key, input);
      expect(got, `${r.household} ${r.key}`).toEqual(r.reading);
      const m = matchKey(r.key.startsWith("assumed:") ? `assumed:${r.key.slice(8)}` : r.key) ?? matchKey(`field:${r.key.slice(8)}`);
      if (m !== null) used.add(m.entry.from);
      if (r.reading.kind === "address") expect(unbox(readAt(input, r.reading.address)) ?? null, `${r.household} ${r.key}`).toEqual(r.value);
    }
    // 表の行はどれも、凍結した見本で確かめてある
    expect(READING_ENTRIES.map((e) => e.from).filter((f) => !used.has(f))).toEqual([]);
  });

  it.runIf(existsSync(join(FROZEN, "records.json")))("当て先・合成の対策から鍵へ戻せ、戻した鍵を読み直すと同じ当て先になる（形式 0.17 の世帯ファイルを画面の鍵で読むため）", () => {
    const inputs = new Map<string, Json>();
    for (const r of readFrozen()) {
      if (r.reading.kind === "unresolved") continue;
      const input = inputs.get(r.household) ?? frozenInput(r.household);
      inputs.set(r.household, input);
      const assumed = r.key.startsWith("assumed:");
      const key = keyOf(r.reading, input, assumed ? "assumed" : "item");
      expect(key, `${r.household} ${r.key}`).not.toBeNull();
      const back = assumed ? resolveAssumedKey(key as string, input) : resolveKey(key as string, input);
      if (r.reading.kind === "address") expect(back?.kind === "address" ? back.address : back, `${r.household} ${r.key}`).toEqual(r.reading.address);
      else expect(back, `${r.household} ${r.key}`).toEqual(r.reading);
    }
  });

  it.runIf(process.env.WRITE_READINGS !== undefined)("0.16 の欄の定義から、読み替え表と凍結した見本を作る", async () => {
    const { generate } = await import("./readingsGenerate.ts");
    const { entries, records, households } = generate();
    writeTable(entries);
    mkdirSync(join(FROZEN, "households"), { recursive: true });
    for (const [name, h] of households) writeFileSync(join(FROZEN, "households", `${name}.json`), `${JSON.stringify(h, null, 1)}\n`);
    writeFileSync(join(FROZEN, "records.json"), `${JSON.stringify(records, null, 1)}\n`);
    expect(readdirSync(join(FROZEN, "households")).length, "前に作った世帯のファイルが残っています（households を空にしてから作り直す）").toBe(households.size);
  });
});
describe("鍵の引き方（覚えた答え）", () => {
  /** 前の引き方: 表の行を頭から順に正規表現で試し、最初に合った行（覚えない・頭の文字で絞らない） */
  function plainMatch(key: string, entries: readonly ReadingEntry[]) {
    const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
    for (const entry of entries) {
      const slots: string[] = [];
      const src = entry.from.replace(/\{(object|member|id|n)\}|[.*+?^$()|[\]\\]/g, (m, name: string | undefined) => {
        if (name === undefined) return `\\${m}`;
        slots.push(name);
        return name === "n" ? "(\\d+)" : `(${UUID})`;
      });
      const m = new RegExp(`^${src}$`).exec(key);
      if (m === null) continue;
      const out: { entry: ReadingEntry; object?: string; member?: string; ids: string[]; ns: number[] } = { entry, ids: [], ns: [] };
      slots.forEach((s, i) => {
        const v = m[i + 1] as string;
        if (s === "object") out.object = v;
        else if (s === "member") out.member = v;
        else if (s === "id") out.ids.push(v);
        else out.ns.push(Number(v));
      });
      return out;
    }
    return null;
  }

  it("覚えた答えは、表を頭から試した答えと同じで、2回目も同じ（凍らせた同じもの）", () => {
    const entries = [...READING_ENTRIES, ...LATER_ENTRIES, ...LATER_FIELD_ENTRIES];
    const keys = new Set<string>();
    const ids = ["3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10", "7c511b6c-4f38-4475-ac92-7c43676cfba5"];
    for (const e of entries)
      for (const n of ["0", "1", "12"])
        for (const id of ids) {
          const k = e.from.replace(/\{(object|member|id)\}/g, id).replace(/\{n\}/g, n);
          keys.add(k);
          keys.add(`${k}x`);
          keys.add(k.slice(0, -1));
          keys.add(k.replace(/^field:/, "assumed:"));
        }
    if (existsSync(join(FROZEN, "records.json"))) for (const r of readFrozen()) keys.add(r.key);
    // モデル世帯の入力の欄のキー（入力の画面が描くたびに引く鍵）
    for (const f of readdirSync(join(REPO_DIR, "data", "modelHouseholds")).filter((x) => x.endsWith(".json"))) {
      const wh = fromRequest(JSON.parse(readFileSync(join(REPO_DIR, "data", "modelHouseholds", f), "utf8")) as Parameters<typeof fromRequest>[0]);
      for (const stage of buildStages(wh))
        for (const fd of allFields(stage)) {
          keys.add(`field:${fd.key}`);
          keys.add(`assumed:${fd.key}`);
        }
    }
    for (const k of ["", "field:", "lever:", "field:living", "x".repeat(300)]) keys.add(k);
    expect(keys.size).toBeGreaterThan(2000);
    let found = 0;
    for (const k of keys) {
      const want = plainMatch(k, entries);
      const got = matchKey(k);
      expect(got === null ? null : { ...got, ids: [...got.ids], ns: [...got.ns] }, k).toEqual(want);
      if (got !== null) {
        found++;
        expect(got.entry, k).toBe(want?.entry);
        expect(Object.isFrozen(got) && Object.isFrozen(got.ids) && Object.isFrozen(got.ns), k).toBe(true);
      }
      expect(matchKey(k), k).toBe(got);
    }
    expect(found).toBeGreaterThan(1000);
    // 渡した表ごとに覚える（別の表では、その表の答え）
    const one = [entries[entries.length - 1] as ReadingEntry];
    for (const k of keys) expect(matchKey(k, one)?.entry ?? null, k).toBe(plainMatch(k, one)?.entry ?? null);
  });
});


const yamlStr = (s: string) => JSON.stringify(s);
const yamlStep = (s: AtStep): string =>
  typeof s === "string" ? yamlStr(s) : "n" in s ? `{n: ${s.n}}` : "nth" in s ? `{nth: ${s.nth}}` : "id" in s ? `{id: ${s.id}}` : `{where: {${Object.entries(s.where).map(([k, v]) => `${k}: ${yamlStr(v)}`).join(", ")}}}`;
function yamlTo(to: ReadingEntry["to"]): string {
  if ("unresolved" in to) return `{unresolved: ${yamlStr(to.unresolved)}}`;
  if ("lever" in to) return `{lever: ${to.lever}${to.object === true ? ", object: true" : ""}${to.member === true ? ", member: true" : ""}${to.element !== undefined ? `, element: {target: ${to.element.target}, item: ${to.element.item}, at: [${to.element.at.map(yamlStep).join(", ")}]}` : ""}}`;
  return `{target: ${to.target}${to.find !== undefined ? `, find: ${to.find}` : ""}, item: ${to.item}, at: [${to.at.map(yamlStep).join(", ")}]${to.method !== undefined ? `, method: ${to.method}` : ""}}`;
}

function writeTable(entries: ReadingEntry[]): void {
  const lines = [
    "# 0035 の9: 読み替え表。世帯ファイルの形式 0.16 までに保存された鍵（差分の key・対策に足した項目・仮の印の欄のキー）を、",
    "# 当て先（向き先＋入力項目ID＋場所。0036 の2）か合成の対策（0036 の3）に読み替える。本体の変換の段・画面・テストが同じ表を読む。",
    "# 0.16 の欄の定義から app/test/readings.test.ts の作る手順で作った（手で書き換えない。凍結した見本で確かめる）。",
    "# from の {object}・{member}・{id} は ID、{n} は並びの番号。at の {n: k} は from の k 番目の番号の要素、{nth: i} は i 番目の要素、",
    "# {id: k} は from の k 番目の {id} の要素、{where: …} は欄の値が合う最初の要素（ID の無い要素は、変換の段が振る決まった ID で指す）。",
    "# find: currentPeriod は、構成員の計算基準月の働き方の期間（無ければ次に始まる期間、それも無ければ最後の期間）。",
    "# lever は合成の対策（0036 の3。object・member は鍵の ID を、element は鍵の番号の要素の ID を物として持つ）。1つの値をそのまま書かない欄",
    "# （単位を直す・時点に直す・物を作る・複数の値を動かす）も、0.16 の欄の書き方で当てる合成の対策にした。unresolved は読み替えずに要確認で残す（0036 の5）",
    "kind: reading",
    "entries:",
  ];
  for (const e of [...entries].sort((a, b) => (a.from < b.from ? -1 : 1))) lines.push(`  - from: ${yamlStr(e.from)}`, `    until: "${e.until}"`, `    to: ${yamlTo(e.to)}`);
  writeFileSync(join(REPO_DIR, "registry", "readings.yaml"), `${lines.join("\n")}\n`);
}
