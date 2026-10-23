// テストの共通部分: 架空の明細（test/fixtures。scripts/fixtures.ts が作る）と架空の世帯
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createImport, emptyLog, readStatement, type HouseholdLike, type ReadContext, type SourceKind, type StatementAccount, type StatementLog } from "../src/index.ts";

export const FIXTURES = join(import.meta.dirname, "fixtures");

export const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(join(FIXTURES, name)));

export async function read(name: string, kind: SourceKind, ctx: Omit<ReadContext, "kind"> = {}) {
  const r = await readStatement(fixture(name), { kind, fileName: name, ...ctx });
  if (!r.ok) throw new Error(`読めない: ${name} ${JSON.stringify(r.issues)}`);
  return r;
}

/** 架空の世帯: 夫（会社員）・妻（個人事業主）・子 */
export const SELF = "00000000-0000-4000-8000-000000000001";
export const SPOUSE = "00000000-0000-4000-8000-000000000002";
export const CHILD = "00000000-0000-4000-8000-000000000003";

export const HOUSEHOLD: HouseholdLike = {
  members: [
    { id: SELF, kind: "self", birth: { birthYearMonth: "1986-04" } },
    { id: SPOUSE, kind: "spouse", birth: { birthYearMonth: "1988-09" } },
    { id: CHILD, kind: "child", birth: { birthYearMonth: "2018-06" } },
  ],
  employmentPeriods: [
    { member: SELF, from: { at: "2009-04" }, to: { memberAge: { member: SELF, years: 60 } }, type: "regular" },
    { member: SPOUSE, from: { at: "2015-04" }, to: { at: "2019-03" }, type: "regular" },
    { member: SPOUSE, from: { at: "2020-10" }, to: null, type: "selfEmployed" },
  ],
};

export const BASE_MONTH = "2026-10";

export interface Source {
  readonly name: string;
  readonly kind: SourceKind;
  readonly account: string;
  readonly owner: string | null;
  readonly label?: string;
}

let seq = 0;
/** 明細を読んで、取り込みの記録を作る（同じ口座の名前の明細は同じ口座に入れる） */
export async function buildLog(sources: readonly Source[], base: StatementLog = emptyLog()): Promise<StatementLog> {
  let log = base;
  for (const s of sources) {
    const out = await read(s.name, s.kind);
    if (!log.accounts.some((a) => a.id === s.account)) {
      const acc: StatementAccount = { id: s.account, kind: s.kind, label: s.label ?? s.account, owner: s.owner };
      log = { ...log, accounts: [...log.accounts, acc] };
    }
    seq++;
    const imp = createImport(log, out, { id: `imp-${seq}`, account: s.account, at: `2026-10-20T10:00:${String(seq % 60).padStart(2, "0")}+09:00` });
    if (imp === null) throw new Error(`同じファイル: ${s.name}`);
    log = { ...log, imports: [...log.imports, imp] };
  }
  return log;
}

/** 決まった ID を順に返す */
export function ids(prefix = "id"): () => string {
  let n = 0;
  return () => `${prefix}-${++n}`;
}
