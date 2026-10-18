// 見本のシート（架空の記入例）の JSON から、回答の一覧と .xlsx を作る（scripts/sample.ts とテストで共通）
import { OFFICIAL_SHEETS, writeSheetXlsx, layoutDigest, type Answer, type SheetDefinition } from "../src/index.ts";
import { axisOf, itemByKey } from "../src/definition.ts";
import { management } from "../src/export.ts";
import { formatValue } from "../src/values.ts";
import { OFFICE } from "./helpers.ts";

export interface SampleFile {
  readonly management: { readonly requestId: string; readonly customerNo: string; readonly appVersion: string; readonly exportedOn: string };
  readonly values: Readonly<Record<string, string | number | { readonly state: "unknown" | "notApplicable" }>>;
}

export function sampleDefinition(file: string): SheetDefinition {
  const m = /^([a-zA-Z0-9]+)-(\d+)-sample\.json$/.exec(file);
  const def = OFFICIAL_SHEETS.find((d) => d.sheetId === m?.[1] && d.version === Number(m?.[2]));
  if (def === undefined) throw new Error(`見本のシート定義が無い: ${file}`);
  return def;
}

export function sampleAnswers(def: SheetDefinition, sample: SampleFile): Answer[] {
  const items = itemByKey(def);
  const out: Answer[] = [];
  for (const [k, val] of Object.entries(sample.values)) {
    const [key, idx] = k.split("#") as [string, string | undefined];
    const it = items.get(key);
    if (it === undefined) throw new Error(`定義に無い項目: ${key}`);
    if ((axisOf(def, key) !== null) !== (idx !== undefined)) throw new Error(`繰り返しの番号の付け方が違う: ${k}`);
    const at = { key, ...(idx !== undefined ? { index: Number(idx) } : {}) };
    if (typeof val === "object") out.push({ ...at, status: val.state });
    else {
      const f = formatValue(it, val);
      out.push({ ...at, status: "value", raw: f.raw, ...(f.raw2 !== undefined ? { raw2: f.raw2 } : {}) });
    }
  }
  return out;
}

export async function sampleBytes(file: string, sample: SampleFile): Promise<Uint8Array> {
  const def = sampleDefinition(file);
  const digest = await layoutDigest(def);
  const m = management(def, { ...sample.management, layoutDigest: digest });
  return writeSheetXlsx(def, sampleAnswers(def, sample), { management: m, office: OFFICE });
}
