// 拡張の束の宣言（manifest.json・fields/<名前>.json）の確かめ（0114 の2〜4）。
// - 段1（β公開まで）は同梱の公式の拡張だけを読む（official.ts）。同じ確かめを、段2 でカスタム層の束を読むときにも使う
// - 誤りがあれば束を読み込まない（段2 では承認できない）。誤りの文は FP が読める日本語
import { EXTENSION_CONTRACT, type ExtFieldsDecl, type ExtInput, type ExtManifest, type ExtensionPoint } from "../../../../report/src/index.ts";

/** 読み込んだ束（差し込み口の関数は provides の export の名前で引く） */
export interface LoadedExtension {
  manifest: ExtManifest;
  fields: ExtFieldsDecl[];
  parts: Record<string, (input: ExtInput) => unknown>;
  /** 同梱の公式の拡張か（段1 は true だけ） */
  official: boolean;
}

/** 束・入力欄の値の置き場所・章の id の書式（ext.<作成者>.<名前>。0004 の書式の3段） */
export const EXT_ID = /^ext\.([a-z][A-Za-z0-9]*)\.[a-z][A-Za-z0-9]*$/;
const SEGMENT = /^[a-z][A-Za-z0-9]*$/;
/** 知っている差し込み口（見せ方の差し込み口。0114 の5） */
export const EXTENSION_POINTS: readonly ExtensionPoint[] = ["view.balance", "report.chapter"];
/** 渡せる値の名前（0114 の5） */
export const READABLE: readonly string[] = ["balance.now"];
/** 束が使える世帯の条件 */
const HOUSEHOLDS = ["all", "executive"];
const FIELD_TYPES = ["yen", "month", "choice", "check"];

/** 受け付けない字（改行のほかの制御文字と、文字の向きを変える字。0016 の 2026-11-01 の追記の3） */
// eslint-disable-next-line no-control-regex -- 受け付けない字を見つけるため
const BAD_CHARS = /[\u0000-\u0009\u000b-\u001f\u007f‪-‮⁦-⁩]/;
const TEXT_MAX = 1000;
const LABEL_MAX = 80;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function text(errors: string[], where: string, v: unknown, max: number, optional = false): void {
  if (v === undefined && optional) return;
  if (!isStr(v) || v === "") errors.push(`${where} が文字ではありません`);
  else if (v.length > max) errors.push(`${where} が長すぎます（${max}字まで）`);
  else if (BAD_CHARS.test(v)) errors.push(`${where} に使えない字があります`);
}

/** 作成者（ext.<作成者>.<名前> の2段目） */
export const authorOf = (id: string): string | null => EXT_ID.exec(id)?.[1] ?? null;

/** 入力欄の宣言を確かめる（誤りの文の一覧。空なら読める） */
export function checkFields(d: unknown, bundleId: string): string[] {
  const e: string[] = [];
  if (!isObj(d)) return ["入力欄の宣言が JSON の対ではありません"];
  if (d.schema !== "extFields@1.0") e.push("入力欄の宣言の schema が extFields@1.0 ではありません");
  if (!isStr(d.key) || !EXT_ID.test(d.key)) e.push("入力欄の key が ext.<作成者>.<名前> の形ではありません");
  else if (authorOf(d.key) !== authorOf(bundleId)) e.push("入力欄の key の作成者が束の id の作成者と違います");
  if (typeof d.version !== "number" || !Number.isInteger(d.version) || d.version < 1) e.push("入力欄の version が1以上の整数ではありません");
  if (d.attachTo !== "household") e.push("入力欄の attachTo は今は household だけです");
  text(e, "入力欄の label", d.label, LABEL_MAX);
  text(e, "入力欄の description", d.description, TEXT_MAX, true);
  if ("default" in d || "defaults" in d) e.push("既定の値は書けません（事務所の既定値の画面で変えてください）");
  const fields = Array.isArray(d.fields) ? d.fields : [];
  if (fields.length === 0) e.push("入力欄の fields がありません");
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const f of fields) {
    if (!isObj(f)) {
      e.push("欄が JSON の対ではありません");
      continue;
    }
    const id = isStr(f.id) ? f.id : "";
    if (!/^[a-z][A-Za-z0-9]*(:[a-z][A-Za-z0-9]*)?$/.test(id)) e.push(`欄の id「${id}」の書き方が違います`);
    if (ids.has(id)) e.push(`欄の id「${id}」が2つあります`);
    ids.add(id);
    const path = Array.isArray(f.path) ? f.path : [];
    if (path.length < 1 || path.length > 2 || !path.every((p) => isStr(p) && SEGMENT.test(p))) e.push(`欄「${id}」の path は英小文字で始まる英数字の1〜2段です`);
    const pk = path.join(".");
    if (paths.has(pk)) e.push(`欄「${id}」の path が、ほかの欄と同じです`);
    paths.add(pk);
    if (!FIELD_TYPES.includes(f.type as string)) e.push(`欄「${id}」の type は yen・month・choice・check のどれかです`);
    text(e, `欄「${id}」の label`, f.label, LABEL_MAX);
    text(e, `欄「${id}」の help`, f.help, TEXT_MAX, true);
    text(e, `欄「${id}」の placeholder`, f.placeholder, LABEL_MAX, true);
    if ("default" in f || "value" in f) e.push(`欄「${id}」に既定の値は書けません（事務所の既定値の画面で変えてください）`);
    if (f.negative !== undefined && (f.type !== "yen" || typeof f.negative !== "boolean")) e.push(`欄「${id}」の negative は yen の欄だけです`);
    if (f.type === "choice") {
      const opts = Array.isArray(f.options) ? f.options : [];
      if (opts.length === 0) e.push(`欄「${id}」の options がありません`);
      for (const o of opts) {
        if (!isObj(o) || !isStr(o.value) || o.value === "") e.push(`欄「${id}」の選択肢の value が空です`);
        else text(e, `欄「${id}」の選択肢の label`, o.label, LABEL_MAX);
      }
    } else if (f.options !== undefined) e.push(`欄「${id}」の options は choice の欄だけです`);
  }
  // 入れ子の path と、1段の path がぶつからない
  for (const p of paths) if (p.includes(".") && paths.has(p.split(".")[0] as string)) e.push(`path「${p}」が、ほかの欄の path の下にあります`);
  const form = isObj(d.form) ? d.form : null;
  if (form === null) e.push("入力欄の form がありません");
  else {
    text(e, "form の title", form.title, LABEL_MAX);
    text(e, "form の note", form.note, TEXT_MAX);
    for (const g of Array.isArray(form.groups) ? form.groups : []) {
      if (!isObj(g)) continue;
      text(e, "まとまりの title", g.title, LABEL_MAX);
      text(e, "まとまりの note", g.note, TEXT_MAX, true);
      for (const id of Array.isArray(g.fields) ? g.fields : []) if (!isStr(id) || !ids.has(id)) e.push(`form に宣言に無い欄「${String(id)}」があります`);
    }
  }
  return e;
}

/** 束を確かめる（誤りの文の一覧。空なら読める） */
export function checkExtension(m: unknown, fields: readonly unknown[], parts: Record<string, unknown>, o: { official: boolean }): string[] {
  const e: string[] = [];
  if (!isObj(m)) return ["manifest.json が JSON の対ではありません"];
  if (m.manifestVersion !== "1.0") e.push("manifestVersion が 1.0 ではありません");
  const id = isStr(m.id) ? m.id : "";
  if (!EXT_ID.test(id)) e.push("束の id が ext.<作成者>.<名前> の形ではありません");
  if (authorOf(id) === "official" && !o.official) e.push("作成者 official は提供元だけが使えます（写した束は作成者を自分の名前に変えてください）");
  text(e, "name", m.name, LABEL_MAX);
  if (!isStr(m.version) || !/^\d+\.\d+\.\d+$/.test(m.version)) e.push("version が 1.2.3 の形ではありません");
  text(e, "author", m.author, LABEL_MAX);
  text(e, "license", m.license, LABEL_MAX);
  if (m.kind !== "component") e.push("kind が component ではありません");
  if (!isStr(m.entry) || !/^[A-Za-z0-9_\-/]+\.ts$/.test(m.entry) || m.entry.includes("..")) e.push("entry が束の中の .ts ではありません");
  text(e, "description", m.description, TEXT_MAX, true);
  const provides = Array.isArray(m.provides) ? m.provides : [];
  if (provides.length === 0) e.push("provides がありません");
  const points = new Set<string>();
  for (const p of provides) {
    if (!isObj(p)) continue;
    if (p.type !== "extend") e.push("provides の type は今は extend だけです（公式部品の差し替えは段2）");
    if (!EXTENSION_POINTS.includes(p.extensionPoint as ExtensionPoint)) e.push(`知らない差し込み口「${String(p.extensionPoint)}」です`);
    if (points.has(p.extensionPoint as string)) e.push(`差し込み口「${String(p.extensionPoint)}」が2つあります`);
    points.add(p.extensionPoint as string);
    if (p.contract !== EXTENSION_CONTRACT) e.push(`差し込み口「${String(p.extensionPoint)}」の約束の版「${String(p.contract)}」はこの版のアプリが知りません`);
    if (!isStr(p.export) || typeof parts[p.export] !== "function") e.push(`入口に関数「${String(p.export)}」がありません`);
    if (p.extensionPoint === "view.balance") text(e, "見るものの label", p.label, LABEL_MAX);
    if (p.extensionPoint === "report.chapter") {
      const c = isObj(p.chapter) ? p.chapter : {};
      if (!isStr(c.id) || !EXT_ID.test(c.id)) e.push("章の id が ext.<作成者>.<名前> の形ではありません");
      else if (authorOf(c.id) !== authorOf(id)) e.push("章の id の作成者が束の id の作成者と違います");
      text(e, "章の label", c.label, LABEL_MAX);
      if (!isStr(c.typst) || !/^reports\/[A-Za-z0-9_-]+\.typ$/.test(c.typst)) e.push("章の typst が reports/<名前>.typ ではありません");
    }
  }
  for (const r of Array.isArray(m.reads) ? m.reads : []) if (!READABLE.includes(r as string)) e.push(`渡せない値「${String(r)}」を reads に書いています`);
  const files = Array.isArray(m.fields) ? m.fields : [];
  if (files.length !== fields.length) e.push("manifest の fields と、読んだ入力欄の宣言の数が合いません");
  for (const f of files) if (!isStr(f) || !/^fields\/[A-Za-z0-9_-]+\.json$/.test(f)) e.push(`入力欄のファイル「${String(f)}」が fields/<名前>.json ではありません`);
  const keys = new Set<string>();
  for (const d of fields) {
    e.push(...checkFields(d, id));
    const k = isObj(d) && isStr(d.key) ? d.key : "";
    if (keys.has(k)) e.push(`入力欄の key「${k}」が2つあります`);
    keys.add(k);
  }
  const a = m.activation;
  if (a !== undefined) {
    if (!isObj(a)) e.push("activation が JSON の対ではありません");
    else {
      if (a.feature !== undefined && (!isStr(a.feature) || !SEGMENT.test(a.feature))) e.push("activation の feature の書き方が違います");
      if (a.feature !== undefined && authorOf(id) !== "official") e.push("activation の feature（機能を有効にするコード）は公式の拡張だけが書けます");
      if (a.households !== undefined && !HOUSEHOLDS.includes(a.households as string)) e.push("activation の households は all か executive です");
    }
  }
  return e;
}
