// 学校の一覧（マスタデータ master.education.schools。0010 の1・2、0217）の道具。
// 1. 取り込み（importSchoolCodes）: 文部科学省の「学校コード一覧」の CSV（公式の場所から取ったもの）を、正本の CSV
//    （data/schools/schools.csv）にする。取った CSV の指紋（sha256）が pack.yaml の出典と合うことを確かめる
// 2. 検査（checkSchoolPack）: 学校コードの形・検査数字・学校種と都道府県と設置区分が CSV の列と合うこと、移行先のコードが一覧にあって
//    循環しないこと、別名の辞書（aliases.yaml）が一覧の学校コードを指していること
// 3. 画面に配る形（buildSchoolBundle）: 正本の CSV と別名の辞書から、画面が遅れて読む JS（src/generated/schools.data.js）を作る。
//    学部・学科の一覧と学校別の学費（app/scripts/tuitionData.ts。0219）も同じ JS に入れる
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

export const SCHOOL_PACK_ID = "master.education.schools";

/** 文部科学省の学校種の記号（学校コードの1〜2桁目）。別添1「学校コードの構成」 */
export const SCHOOL_KINDS: Readonly<Record<string, string>> = {
  A1: "幼稚園",
  A2: "幼保連携型認定こども園",
  B1: "小学校",
  C1: "中学校",
  C2: "義務教育学校",
  D1: "高等学校",
  D2: "中等教育学校",
  E1: "特別支援学校",
  F1: "大学",
  F2: "短期大学",
  G1: "高等専門学校",
  H1: "専修学校",
  H2: "各種学校",
};

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県", "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県", "新潟県", "富山県",
  "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県", "三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県", "鳥取県", "島根県",
  "岡山県", "広島県", "山口県", "徳島県", "香川県", "愛媛県", "高知県", "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

/** 正本の CSV の1行 */
export interface SchoolRow {
  code: string;
  kind: string;
  pref: string;
  sector: string;
  name: string;
  /** 市区町村（所在地から。政令指定都市は区まで。郡は外す） */
  city: string;
  /** 廃止の日（文部科学省の「属性情報廃止年月日」。廃止していなければ ""） */
  abolishedOn: string;
  /** 移行後の学校コード（文部科学省の「移行後の学校コード」。無ければ ""） */
  successor: string;
}

export const CSV_COLUMNS = ["code", "kind", "pref", "sector", "name", "city", "abolishedOn", "successor"] as const;

export class SchoolDataError extends Error {}

// ---- CSV ----

/** RFC 4180 の CSV を読む（引用符の中の改行・二重の引用符を扱う） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);

export function writeSchoolCsv(rows: readonly SchoolRow[]): string {
  return [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((k) => csvCell(r[k])).join(","))].join("\n") + "\n";
}

export function readSchoolCsv(text: string): SchoolRow[] {
  const [head, ...body] = parseCsv(text.replace(/^\uFEFF/, ""));
  if (head === undefined || head.join(",") !== CSV_COLUMNS.join(",")) throw new SchoolDataError(`schools.csv: 見出しは ${CSV_COLUMNS.join(",")}`);
  return body.filter((r) => r.length > 1 || (r[0] ?? "") !== "").map((r, i) => {
    if (r.length !== CSV_COLUMNS.length) throw new SchoolDataError(`schools.csv: ${i + 2}行目の列の数が ${r.length}`);
    return Object.fromEntries(CSV_COLUMNS.map((k, j) => [k, r[j] as string])) as unknown as SchoolRow;
  });
}

// ---- 学校コード ----

/** 検査数字（別添1 別紙）: 1桁目の英字を2桁の数字にし、上の桁から1と2を交互に掛け、10以上の積は各桁の和にして足す。10−（和を10で割った余り）、余り0なら0 */
export function checkDigit(code12: string): number {
  const letter = code12.charCodeAt(0) - 64;
  if (letter < 1 || letter > 8) return -1;
  const digits = `${String(letter).padStart(2, "0")}${code12.slice(1)}`;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const p = Number(digits[i]) * (i % 2 === 0 ? 1 : 2);
    sum += p >= 10 ? Math.floor(p / 10) + (p % 10) : p;
  }
  const r = sum % 10;
  return r === 0 ? 0 : 10 - r;
}

/** 学校コードの形（学校種・都道府県番号・設置区分・学校番号・検査数字の13桁） */
export const isSchoolCodeShape = (code: string): boolean => /^[A-H][12](0[1-9]|[1-3][0-9]|4[0-7])[123][1-9][0-9]{6}[0-9]$/.test(code);

/**
 * 検査数字が合うか。文部科学省の一覧にも合わないコードが少しある（令和8年5月1日時点の暫定版で 60,285 校のうち 212）。一覧のコードは
 * 文部科学省の正なので、合わなくても誤りにはせず、数を知らせるだけにする
 */
export const checkDigitMatches = (code: string): boolean => checkDigit(code.slice(0, 12)) === Number(code[12]);

// ---- 文部科学省の CSV の取り込み ----

/** 「A1(幼稚園)」「01(北海道)」「2(公)」の括弧の前の記号 */
const codePart = (v: string) => v.replace(/\(.*$/s, "").trim();

/**
 * 公立の学校の名前（「札幌市立」「蟹江町立」「千代田区立」）から、都道府県ごとの市区町村の名前を集める。所在地の先頭を市区町村に切るのに使う
 * （「四日市市」「大町市」のように名前の中に市・町・村の字がある所を、字の位置だけで切ると誤るため）
 */
function municipalityNames(rows: readonly { pref: string; sector: string; name: string }[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.sector !== "2") continue;
    const m = /^(.+?[市区町村])立/.exec(r.name.replace(/\s/g, ""));
    if (m === null) continue;
    const set = out.get(r.pref) ?? new Set<string>();
    set.add(m[1] as string);
    out.set(r.pref, set);
  }
  return out;
}

/** 政令指定都市（所在地の区まで持つ市） */
const DESIGNATED_CITIES = new Set(["札幌市", "仙台市", "さいたま市", "千葉市", "横浜市", "川崎市", "相模原市", "新潟市", "静岡市", "浜松市", "名古屋市", "京都市", "大阪市", "堺市", "神戸市", "岡山市", "広島市", "北九州市", "福岡市", "熊本市"]);

/** 所在地から市区町村（政令指定都市は区まで。郡は外す）。公立の学校の名前から集めた名前（known）を先に使い、無ければ字の位置で切る */
export function cityOf(address: string, prefName: string, known: ReadonlySet<string>): string {
  let a = address.replace(/[\s\u3000]/g, "");
  if (a.startsWith(prefName)) a = a.slice(prefName.length);
  const longest = (t: string) => {
    let best = "";
    for (const k of known) if (k.length > best.length && t.startsWith(k)) best = k;
    return best;
  };
  let best = longest(a);
  if (best === "") {
    // 郡（「海部郡蟹江町」の「海部郡」）を外して探す。郡の名前に市の字は無い
    const gun = /^([^市]{1,5}?郡)/.exec(a);
    const rest = gun !== null ? a.slice((gun[1] as string).length) : a;
    best = longest(rest);
    if (best === "") best = /^(.{1,6}?[市区町村])/.exec(rest)?.[1] ?? "";
  }
  if (DESIGNATED_CITIES.has(best)) {
    const ward = /^(.{1,4}?区)/.exec(a.slice(a.indexOf(best) + best.length));
    if (ward !== null) best += ward[1] as string;
  }
  return best;
}

/** 所在地の市区町村。所在地がほかの都道府県から始まる学校（都の学校が県に置く施設など）は、その都道府県の名前で切る */
function cityIn(address: string, pref: string, known: ReadonlyMap<string, ReadonlySet<string>>): string {
  const a = address.replace(/[\s\u3000]/g, "");
  const other = PREFECTURES.findIndex((p) => a.startsWith(p));
  const p = other >= 0 ? String(other + 1).padStart(2, "0") : pref;
  return cityOf(a, PREFECTURES[Number(p) - 1] ?? "", known.get(p) ?? new Set());
}

export interface MextFile {
  name: string;
  sha256: string;
}

/**
 * 文部科学省の学校コード一覧の CSV（1行目は表題と更新日、2行目は見出し）を正本の行にする。files は pack.yaml の出典（ファイル名と指紋）で、
 * dir にそろっていて指紋が合うことを確かめる
 */
export function importSchoolCodes(dir: string, files: readonly MextFile[]): { rows: SchoolRow[]; updatedOn: string[]; selfSuccessors: string[] } {
  const selfSuccessors: string[] = [];
  const raw: { code: string; kind: string; pref: string; sector: string; name: string; address: string; abolishedOn: string; successor: string }[] = [];
  const updatedOn: string[] = [];
  const present = new Set(readdirSync(dir));
  for (const f of files) {
    if (!present.has(f.name)) throw new SchoolDataError(`${f.name} がありません（${dir}）`);
    const buf = readFileSync(join(dir, f.name));
    const sha = createHash("sha256").update(buf).digest("hex");
    if (sha !== f.sha256) throw new SchoolDataError(`${f.name}: 指紋が pack.yaml と違います（${sha}）。取り直したなら pack.yaml の出典を直してください`);
    const [title, head, ...body] = parseCsv(buf.toString("utf8").replace(/^\uFEFF/, ""));
    const u = (title ?? []).findIndex((c) => c.startsWith("更新日"));
    if (u >= 0) updatedOn.push((title?.[u + 1] ?? "").trim());
    const cols = (head ?? []).map((h) => h.replace(/\s/g, ""));
    const at = (n: string) => {
      const i = cols.indexOf(n);
      if (i < 0) throw new SchoolDataError(`${f.name}: 見出し「${n}」がありません`);
      return i;
    };
    const ix = { code: at("学校コード"), kind: at("学校種"), pref: at("都道府県番号"), sector: at("設置区分"), name: at("学校名"), address: at("学校所在地"), abolished: at("属性情報廃止年月日"), successor: at("移行後の学校コード") };
    for (const r of body) {
      if ((r[ix.code] ?? "").trim() === "") continue;
      raw.push({
        code: (r[ix.code] as string).trim(),
        kind: codePart(r[ix.kind] ?? ""),
        pref: codePart(r[ix.pref] ?? ""),
        sector: codePart(r[ix.sector] ?? ""),
        name: (r[ix.name] ?? "").replace(/[\r\n]+/g, "").trim(),
        address: (r[ix.address] ?? "").trim(),
        abolishedOn: (r[ix.abolished] ?? "").trim(),
        successor: (r[ix.successor] ?? "").trim(),
      });
      // 移行後の学校コードが自分自身の行（一覧にある）は、移行先なしと読む
      const last = raw[raw.length - 1] as { code: string; successor: string };
      if (last.successor === last.code) {
        last.successor = "";
        selfSuccessors.push(last.code);
      }
    }
  }
  const known = municipalityNames(raw);
  const rows = raw
    .map((r) => ({ code: r.code, kind: r.kind, pref: r.pref, sector: r.sector, name: r.name, city: cityIn(r.address, r.pref, known), abolishedOn: r.abolishedOn, successor: r.successor }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  return { rows, updatedOn, selfSuccessors };
}

// ---- 別名の辞書 ----

export interface AliasEntry {
  /** 学校コード */
  code: string;
  /** 略称（abbr）・旧校名（former）・別の表記（variant） */
  names: { name: string; kind: "abbr" | "former" | "variant" }[];
}

export interface AliasDoc {
  /** 学校の別名 */
  aliases: AliasEntry[];
  /** 学校の読み（ひらがな）。学校コード → 読み。文部科学省の一覧に読みが無いので、確かめた学校から足す */
  readings: Record<string, string>;
  /** 文部科学省の一覧に移行後の学校コードが無い統合・改称の補い（from は廃止した学校のコード） */
  successors: { from: string; to: string; note: string }[];
}

export function readAliases(text: string): AliasDoc {
  const d = (parse(text) ?? {}) as Partial<AliasDoc>;
  return { aliases: d.aliases ?? [], readings: d.readings ?? {}, successors: d.successors ?? [] };
}

// ---- 検査 ----

/** 一覧の検査。errors は止める誤り、checkDigitMismatches は検査数字の合わない学校コード（誤りにしない。checkDigitMatches） */
export function checkSchoolRows(rows: readonly SchoolRow[], aliases: AliasDoc): { errors: string[]; checkDigitMismatches: string[] } {
  const errors: string[] = [];
  const checkDigitMismatches: string[] = [];
  const byCode = new Map<string, SchoolRow>();
  for (const r of rows) {
    if (byCode.has(r.code)) errors.push(`${r.code}: 同じ学校コードが2つあります`);
    byCode.set(r.code, r);
    if (!isSchoolCodeShape(r.code)) errors.push(`${r.code}: 学校コードの形が合いません`);
    else if (!checkDigitMatches(r.code)) checkDigitMismatches.push(r.code);
    if (r.code.slice(0, 2) !== r.kind || r.code.slice(2, 4) !== r.pref || r.code[4] !== r.sector) errors.push(`${r.code}: 学校種・都道府県・設置区分の列が学校コードと合いません`);
    if (SCHOOL_KINDS[r.kind] === undefined) errors.push(`${r.code}: 知らない学校種 ${r.kind}`);
    if (r.name === "") errors.push(`${r.code}: 学校名がありません`);
    if (r.abolishedOn !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(r.abolishedOn)) errors.push(`${r.code}: 廃止の日の形 ${r.abolishedOn}`);
  }
  const successorOf = new Map<string, string>();
  for (const r of rows) if (r.successor !== "") successorOf.set(r.code, r.successor);
  for (const s of aliases.successors) {
    const from = byCode.get(s.from);
    if (from === undefined) errors.push(`aliases.yaml の successors: ${s.from} は一覧にありません`);
    else if (from.abolishedOn === "") errors.push(`aliases.yaml の successors: ${s.from}（${from.name}）は廃止されていません`);
    else if (from.successor !== "" && from.successor !== s.to) errors.push(`aliases.yaml の successors: ${s.from} は一覧の移行先（${from.successor}）と違います`);
    if (!byCode.has(s.to)) errors.push(`aliases.yaml の successors: 移行先 ${s.to} は一覧にありません`);
    successorOf.set(s.from, s.to);
  }
  for (const start of successorOf.keys()) {
    const seen = new Set<string>([start]);
    let c = successorOf.get(start);
    while (c !== undefined) {
      if (seen.has(c)) {
        errors.push(`${start}: 移行先をたどると循環します`);
        break;
      }
      seen.add(c);
      c = successorOf.get(c);
    }
  }
  for (const a of aliases.aliases) {
    if (!byCode.has(a.code)) errors.push(`aliases.yaml: ${a.code} は一覧にありません`);
    for (const n of a.names) if (!["abbr", "former", "variant"].includes(n.kind) || n.name.trim() === "") errors.push(`aliases.yaml: ${a.code} の別名の形`);
  }
  for (const [code, kana] of Object.entries(aliases.readings)) {
    if (!byCode.has(code)) errors.push(`aliases.yaml の readings: ${code} は一覧にありません`);
    if (!/^[ぁ-ゖー\s]+$/.test(kana)) errors.push(`aliases.yaml の readings: ${code} の読みはひらがなで書きます`);
  }
  return { errors, checkDigitMismatches };
}

// ---- 画面に配る形 ----

/**
 * 画面に配る形（schools.data.js の中身）。学校1つは [学校コード, 学校名, 市区町村の番号, 読み, 廃止の日, 移行先]。後ろの空の値は省く。
 * 学校種・都道府県・設置区分は学校コードから読む
 */
export interface SchoolBundle {
  pack: string;
  version: string;
  edition: string;
  cities: string[];
  schools: (string | number)[][];
  aliases: [string, string, string][];
  /** 学部・学科（学校コード → 部局の並び。departments.yaml。0219） */
  departments?: Record<string, { id: string; name: string; years: number; plan?: string }[]>;
  /** 学校別の学費（master.education.tuition。data/tuition。0219） */
  tuition?: { pack: string; version: string; schools: Record<string, unknown> };
}

export function buildSchoolBundle(rows: readonly SchoolRow[], aliases: AliasDoc, meta: { version: string; edition: string }, more: Pick<SchoolBundle, "departments" | "tuition"> = {}): SchoolBundle {
  const cityIndex = new Map<string, number>();
  const cities: string[] = [];
  const extra = new Map(aliases.successors.map((s) => [s.from, s.to]));
  const schools = rows.map((r) => {
    let ci = cityIndex.get(r.city);
    if (ci === undefined) {
      ci = cities.length;
      cities.push(r.city);
      cityIndex.set(r.city, ci);
    }
    const t: (string | number)[] = [r.code, r.name, ci, aliases.readings[r.code] ?? "", r.abolishedOn, r.successor !== "" ? r.successor : (extra.get(r.code) ?? "")];
    while (t.length > 3 && t[t.length - 1] === "") t.pop();
    return t;
  });
  const al: [string, string, string][] = [];
  for (const a of aliases.aliases) for (const n of a.names) al.push([a.code, n.name, n.kind]);
  return { pack: SCHOOL_PACK_ID, version: meta.version, edition: meta.edition, cities, schools, aliases: al, ...more };
}

/** パックの見出し（pack.yaml）を読む */
export function readSchoolPackMeta(dir: string): SchoolPackMeta {
  const pack = parse(readFileSync(join(dir, "pack.yaml"), "utf8")) as SchoolPackMeta;
  if (pack.packId !== SCHOOL_PACK_ID) throw new SchoolDataError(`pack.yaml: packId は ${SCHOOL_PACK_ID}`);
  return pack;
}

/** パックのフォルダ（pack.yaml・schools.csv・aliases.yaml）を読む */
export function readSchoolPack(dir: string): { rows: SchoolRow[]; aliases: AliasDoc; pack: SchoolPackMeta } {
  return { rows: readSchoolCsv(readFileSync(join(dir, "schools.csv"), "utf8")), aliases: readAliases(readFileSync(join(dir, "aliases.yaml"), "utf8")), pack: readSchoolPackMeta(dir) };
}

export interface SchoolPackMeta {
  packId: string;
  version: string;
  edition: string;
  sources: { url: string; file: string; retrievedAt: string; sha256: string; locator: string }[];
}

/** 画面が遅れて読む JS（JSON の文字を1回で読む形にする。大きな配列を JS の式で書くより読み込みが速い） */
export function schoolBundleModule(b: SchoolBundle): string {
  return [
    "// 自動生成（scripts/prepare-assets.ts → scripts/schoolList.ts）。手で書き換えない。正本は data/schools",
    `export default JSON.parse(${JSON.stringify(JSON.stringify(b))});`,
    "",
  ].join("\n");
}
