// 学校別の学費（マスタデータ master.education.tuition。0010 の1・3・7、0219）と学部・学科の一覧（master.education.schools の departments.yaml）の道具。
// 1. 読む（readTuitionPack・readDepartments）: data/tuition の pack.yaml・national.yaml、data/schools/departments.yaml
// 2. 検査（checkTuition）: 学校コードが国立大学の一覧にあること、区間の形（最初は null・年度は増える・額が変わる区間は在学生の扱いを持つ）、
//    出典の必須項目、省令の上限（標準額の1.2倍）の外の額（読み違いとして止める）、入学料が授業料を上回らないこと、行が全年次そろうこと、
//    学部・学科の部局ID の形と重なり・修業年数・学費の区分が学校にあること
// 3. 画面に配る形（tuitionBundle）: 学校の一覧の bundle に足す tuition と departments
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { PLAN_GRADES, TUITION_PACK_ID, TUITION_PLAN_IDS, tuitionRows, type SchoolTuitionData, type TuitionPlanId } from "../src/workspace/input/tuition.ts";
import type { SchoolRow } from "./schoolList.ts";

export interface TuitionPackMeta {
  packId: string;
  version: string;
  standards: { ratioCap: string; plans: Record<string, { admission: number; annual: number }> };
}

export interface DepartmentUnit {
  id: string;
  name: string;
  years: number;
  plan?: TuitionPlanId;
  retired?: boolean;
}

export interface DepartmentsDoc {
  school: string;
  source?: { url: string; title: string; retrievedAt: string };
  units: DepartmentUnit[];
}

export function readTuitionPack(dir: string): { pack: TuitionPackMeta; schools: SchoolTuitionData[] } {
  const pack = parse(readFileSync(join(dir, "pack.yaml"), "utf8")) as TuitionPackMeta;
  if (pack.packId !== TUITION_PACK_ID) throw new Error(`pack.yaml: packId は ${TUITION_PACK_ID}`);
  const doc = (parse(readFileSync(join(dir, "national.yaml"), "utf8")) ?? {}) as { schools?: SchoolTuitionData[] };
  return { pack, schools: (doc.schools ?? []).map((s) => ({ ...s, plans: (s.plans ?? []).map((p) => ({ ...p, revisions: p.revisions ?? [] })), sources: s.sources ?? {} })) };
}

export function readDepartments(dir: string): DepartmentsDoc[] {
  const doc = (parse(readFileSync(join(dir, "departments.yaml"), "utf8")) ?? {}) as { departments?: DepartmentsDoc[] };
  return doc.departments ?? [];
}

const yearOk = (y: unknown): y is number => Number.isInteger(y) && (y as number) >= 2000 && (y as number) <= 2040;

/** 検査。errors は止める誤り */
export function checkTuition(schools: readonly SchoolTuitionData[], departments: readonly DepartmentsDoc[], rows: readonly SchoolRow[], pack: TuitionPackMeta): { errors: string[] } {
  const errors: string[] = [];
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const cap = Number(pack.standards.ratioCap);
  const seen = new Set<string>();
  const plansOf = new Map<string, Map<string, string>>();
  for (const s of schools) {
    const at = `national.yaml ${s.school}`;
    if (seen.has(s.school)) errors.push(`${at}: 同じ学校が2つあります`);
    seen.add(s.school);
    const r = byCode.get(s.school);
    if (r === undefined) errors.push(`${at}: 学校の一覧にありません`);
    else if (r.kind !== "F1" || r.sector !== "1" || r.abolishedOn !== "") errors.push(`${at}: 廃止していない国立大学ではありません（${r.name}）`);
    const sources = s.sources ?? {};
    for (const [id, src] of Object.entries(sources)) {
      if (!/^https?:\/\//.test(src.url ?? "")) errors.push(`${at}: 出典 ${id} の URL`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(src.retrievedAt ?? "")) errors.push(`${at}: 出典 ${id} の取得日`);
      if (!/^[0-9a-f]{64}$/.test(src.sha256 ?? "")) errors.push(`${at}: 出典 ${id} の原本の指紋（sha256）`);
      if ((src.title ?? "") === "") errors.push(`${at}: 出典 ${id} の題名`);
    }
    const plans = new Map<string, string>();
    for (const p of s.plans ?? []) {
      const pa = `${at} ${p.plan}`;
      if (!TUITION_PLAN_IDS.includes(p.plan)) errors.push(`${pa}: 知らない区分`);
      if (plans.has(p.plan)) errors.push(`${pa}: 同じ区分が2つあります`);
      plans.set(p.plan, p.status);
      if (p.status !== "reviewed" && p.status !== "pendingReview") errors.push(`${pa}: status は reviewed か pendingReview`);
      if (!yearOk(p.latestEntryYear) || p.latestEntryYear < 2026) errors.push(`${pa}: latestEntryYear`);
      const std = pack.standards.plans[p.plan];
      if (std === undefined) {
        errors.push(`${pa}: 省令の標準額がありません（pack.yaml の standards）`);
        continue;
      }
      if (p.status === "reviewed" && p.revisions.length === 0) errors.push(`${pa}: 確かめ済みなのに区間がありません`);
      let prev: (typeof p.revisions)[number] | null = null;
      for (const [i, rv] of p.revisions.entries()) {
        const ra = `${pa} の${i + 1}つ目の区間`;
        if (i === 0 && rv.from !== null) errors.push(`${ra}: 最初の区間の from は null`);
        if (i > 0 && (!yearOk(rv.from) || (prev !== null && prev.from !== null && (rv.from as number) <= prev.from))) errors.push(`${ra}: from の年度は前の区間より後`);
        if (i > 0 && (rv.from as number) > p.latestEntryYear) errors.push(`${ra}: from が latestEntryYear より後`);
        if (prev !== null && prev.annual !== rv.annual && rv.appliesTo !== "newEntrants" && rv.appliesTo !== "allStudents") errors.push(`${ra}: 授業料の改定の区間は appliesTo（在学生の扱い）を持つ`);
        // 省令の上限（標準額の1.2倍）の外は読み違い
        if (!Number.isInteger(rv.annual) || rv.annual <= 0 || rv.annual > Math.round(std.annual * cap)) errors.push(`${ra}: 授業料 ${rv.annual} 円は省令の上限（${Math.round(std.annual * cap)} 円）の外`);
        if (rv.annual < std.annual * 0.9) errors.push(`${ra}: 授業料 ${rv.annual} 円は標準額の9割を下回る（読み違いを疑う）`);
        if (rv.admission !== null && (!Number.isInteger(rv.admission) || rv.admission <= 0 || rv.admission > Math.round(std.admission * cap))) errors.push(`${ra}: 入学料 ${rv.admission} 円は省令の上限（${Math.round(std.admission * cap)} 円）の外`);
        if (rv.admission !== null && rv.admission > rv.annual) errors.push(`${ra}: 入学料が授業料の年額を上回る`);
        if (sources[rv.source] === undefined) errors.push(`${ra}: 出典 ${rv.source} が sources にありません`);
        prev = rv;
      }
      // 行が入学年度ごとに全年次そろうこと（0010 の3）
      if (p.revisions.length > 0) {
        const rs = tuitionRows(p);
        for (const e of new Set(rs.map((x) => x.entryYear))) {
          const grades = new Set(rs.filter((x) => x.entryYear === e && x.item === "tuition.annual").map((x) => x.grade));
          if (grades.size !== PLAN_GRADES[p.plan]) errors.push(`${pa}: ${e}年度入学の行が全年次そろっていません`);
        }
      }
    }
    plansOf.set(s.school, plans);
  }
  const depSeen = new Set<string>();
  for (const d of departments) {
    const at = `departments.yaml ${d.school}`;
    if (depSeen.has(d.school)) errors.push(`${at}: 同じ学校が2つあります`);
    depSeen.add(d.school);
    if (!byCode.has(d.school)) errors.push(`${at}: 学校の一覧にありません`);
    const ids = new Set<string>();
    for (const u of d.units ?? []) {
      if (!/^d\d{3}$/.test(u.id)) errors.push(`${at}: 部局ID ${u.id} の形（d001 など）`);
      if (ids.has(u.id)) errors.push(`${at}: 部局ID ${u.id} が2つあります（使い回さない）`);
      ids.add(u.id);
      if (u.name.trim() === "") errors.push(`${at} ${u.id}: 名前がありません`);
      if (!Number.isInteger(u.years) || u.years < 1 || u.years > 6) errors.push(`${at} ${u.id}: 修業年数`);
      const plan = u.plan ?? "day";
      const status = plansOf.get(d.school)?.get(plan);
      if (plansOf.has(d.school) && status === undefined) errors.push(`${at} ${u.id}: 学費の区分 ${plan} が national.yaml にありません`);
      if (u.plan !== undefined && status !== "reviewed") errors.push(`${at} ${u.id}: 学費の区分 ${plan} が確かめ済みではありません`);
      if (u.years > PLAN_GRADES[plan]) errors.push(`${at} ${u.id}: 修業年数が区分の行の年次（${PLAN_GRADES[plan]}）より長い`);
    }
  }
  return { errors };
}

/** 画面に配る形（学校の一覧の bundle に足す）。確かめ待ちの区分も配る（画面で「確かめ待ち」と出すため。行は写さない） */
export function tuitionBundle(schools: readonly SchoolTuitionData[], departments: readonly DepartmentsDoc[], pack: TuitionPackMeta): { tuition: { pack: string; version: string; schools: Record<string, SchoolTuitionData> }; departments: Record<string, { id: string; name: string; years: number; plan?: string }[]> } {
  const t: Record<string, SchoolTuitionData> = {};
  for (const s of schools) {
    const sources: SchoolTuitionData["sources"] = {};
    for (const [id, src] of Object.entries(s.sources)) sources[id] = { url: src.url, title: src.title, retrievedAt: src.retrievedAt };
    t[s.school] = { school: s.school, ...(s.general !== undefined ? { general: s.general } : {}), plans: s.plans.map((p) => ({ plan: p.plan, status: p.status, latestEntryYear: p.latestEntryYear, revisions: p.revisions.map((r) => ({ from: r.from, ...(r.appliesTo !== undefined ? { appliesTo: r.appliesTo } : {}), admission: r.admission, annual: r.annual, source: r.source })) })), sources };
  }
  const deps: Record<string, { id: string; name: string; years: number; plan?: string }[]> = {};
  for (const d of departments) deps[d.school] = d.units.filter((u) => u.retired !== true).map((u) => ({ id: u.id, name: u.name, years: u.years, ...(u.plan !== undefined ? { plan: u.plan } : {}) }));
  return { tuition: { pack: TUITION_PACK_ID, version: pack.version, schools: t }, departments: deps };
}
