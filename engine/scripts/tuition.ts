// 0010: 学費データ（master.education.tuition）の YAML の正本を検査する道具と、世帯の教育の目標へ写す形（0010 の9: 計算に使った行を世帯ファイルに写す）。
// 検査（0010 の「テストで確かめること」のうち形の検査）: JSON Schema、出典の ID があること、入学年度ごとに修業年数分の年次の授業料の行がそろうこと、
// 入学金は1年次だけ、架空の見本のパックには架空の出典だけ。警告: 入学金が年次の授業料を上回る、前の入学年度からの変化が大きい（±30%）
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { AJV_OPTIONS, ENGINE_DIR, readJson } from "./lib.ts";
import { DataError, parseStrictYaml, type Json } from "./regulation.ts";

type Obj = { [k: string]: Json };
export interface TuitionRow {
  entryYear: number;
  grade: number;
  item: string;
  monthOffset: number;
  amount: number;
  source: string;
}
export interface TuitionUnit {
  school: string;
  unit: string;
  track: string | null;
  termStartMonth: number;
  years: number;
  rows: TuitionRow[];
  sources: Record<string, Obj>;
  recordedIn: string;
}

function ajv() {
  const a = new Ajv2020({ ...AJV_OPTIONS, allErrors: true });
  for (const k of ["x-unit", "x-item", "x-collection"]) a.addKeyword({ keyword: k, schemaType: "string" });
  a.addKeyword({ keyword: "x-owner", schemaType: "array" });
  for (const f of ["common.json", "regulation.value.json", "master.education.tuition.json"]) a.addSchema(readJson(join(ENGINE_DIR, "schemas", f)) as object);
  return a;
}

/** 1つのファイルを検査する。誤りは DataError、警告は返す */
export function checkTuitionUnit(raw: Json, where: string, fictional: boolean): { unit: TuitionUnit; warnings: string[] } {
  const a = ajv();
  if (!a.validate("urn:financia:schema:master.education.tuition", raw)) throw new DataError(`${where}: 形式の誤り ${a.errorsText()}`);
  const u = raw as unknown as TuitionUnit;
  const warnings: string[] = [];
  if (!u.unit.startsWith(u.school)) throw new DataError(`${where}: unit は学校コードで始めます`);
  for (const s of Object.values(u.sources)) if ((s.type === "fictional") !== fictional) throw new DataError(`${where}: 出典 fictional は架空の見本のパックだけに使います`);
  for (const r of u.rows) {
    if (u.sources[r.source] === undefined) throw new DataError(`${where}: 出典 ${r.source} がありません`);
    if (r.grade > u.years) throw new DataError(`${where}: 年次 ${r.grade} が修業年数 ${u.years} を超えています`);
    if (r.item === "tuition.admission" && r.grade !== 1) throw new DataError(`${where}: 入学金は1年次だけです`);
  }
  const entryYears = [...new Set(u.rows.map((r) => r.entryYear))].sort((x, y) => x - y);
  for (const ey of entryYears) {
    for (let g = 1; g <= u.years; g++) {
      if (!u.rows.some((r) => r.entryYear === ey && r.grade === g && r.item === "tuition.annual")) throw new DataError(`${where}: ${ey}年度入学の${g}年次の授業料の行がありません（修業年数分の年次をそろえます）`);
    }
    const sum = (item: string, g: number) => u.rows.filter((r) => r.entryYear === ey && r.grade === g && r.item === item).reduce((s, r) => s + r.amount, 0);
    if (sum("tuition.admission", 1) > sum("tuition.annual", 1)) warnings.push(`${where}: ${ey}年度入学の入学金が1年次の授業料を上回ります`);
    const prev = entryYears[entryYears.indexOf(ey) - 1];
    if (prev !== undefined) {
      const a0 = sum("tuition.annual", 1);
      const p0 = u.rows.filter((r) => r.entryYear === prev && r.grade === 1 && r.item === "tuition.annual").reduce((s, r) => s + r.amount, 0);
      if (p0 > 0 && Math.abs(a0 - p0) * 10 > p0 * 3) warnings.push(`${where}: ${prev}→${ey}年度入学の授業料の変化が30%を超えます`);
    }
  }
  return { unit: u, warnings };
}

/** パックのフォルダ（pack.yaml と schools/*.yaml）を検査する */
export function checkTuitionPack(dir: string): { units: TuitionUnit[]; warnings: string[]; fictional: boolean } {
  const pack = parseStrictYaml(readFileSync(join(dir, "pack.yaml"), "utf8"), "pack.yaml") as Obj;
  if (pack.packId !== "master.education.tuition") throw new DataError("pack.yaml: packId は master.education.tuition");
  if (!existsSync(join(dir, "LICENSE"))) throw new DataError("LICENSE がありません（0021）");
  const fictional = pack.fictional === true;
  const units: TuitionUnit[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const f of readdirSync(join(dir, "schools")).sort()) {
    const where = `schools/${f}`;
    const r = checkTuitionUnit(parseStrictYaml(readFileSync(join(dir, "schools", f), "utf8"), where), where, fictional);
    const key = `${r.unit.unit}|${r.unit.track ?? ""}`;
    if (seen.has(key)) throw new DataError(`${where}: 同じ学校・学部・区分が2つあります`);
    seen.add(key);
    if (fictional && !r.unit.school.startsWith("X")) throw new DataError(`${where}: 架空の見本の学校コードは X で始めます（実在の学校コードを使わない）`);
    units.push(r.unit);
    warnings.push(...r.warnings);
  }
  return { units, warnings, fictional };
}

/** 世帯の教育の目標へ写す形（0010 の9）: その入学年度の行（無ければ最も近い前の入学年度の行。部品が推計の印を付ける） */
export function toHouseholdSchool(u: TuitionUnit, entryYear: number, packVersion: string, fictional: boolean): Obj {
  const years = [...new Set(u.rows.map((r) => r.entryYear))].sort((x, y) => x - y);
  const ref = years.includes(entryYear) ? entryYear : (years.filter((y) => y <= entryYear).at(-1) ?? (years[0] as number));
  return {
    school: u.school,
    unit: u.unit,
    track: u.track,
    termStartMonth: u.termStartMonth,
    rows: u.rows.filter((r) => r.entryYear === ref).map((r) => ({ entryYear: r.entryYear, grade: r.grade, item: r.item, monthOffset: r.monthOffset, amount: r.amount })),
    source: { pack: "master.education.tuition", version: packVersion, ...(fictional ? { fictional: true } : {}) },
  } as unknown as Obj;
}
