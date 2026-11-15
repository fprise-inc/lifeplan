// 学校の一覧の正本（data/schools/schools.csv）を、文部科学省の「学校コード一覧」の CSV から作り直す（年1回。0217）。
// 使い方: node scripts/school-list-import.ts <取った CSV のフォルダ>
//   1. 文部科学省の「学校コード」のページ（pack.yaml の sources の url）から、CSV の4つを新しい空のフォルダに取る（公式の場所からだけ）
//   2. pack.yaml の sources（ファイル名・取得日・指紋・版）と version・edition を新しい版に直す
//   3. このスクリプトを流す（指紋が合わなければ止まる）。検査（checkSchoolRows）の誤りがあれば書かずに止まる
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_DIR } from "./lib.ts";
import { checkSchoolRows, importSchoolCodes, readAliases, readSchoolPackMeta, SCHOOL_KINDS, writeSchoolCsv } from "./schoolList.ts";

const src = process.argv[2];
if (src === undefined) {
  console.error("使い方: node scripts/school-list-import.ts <文部科学省の学校コード一覧の CSV を置いたフォルダ>");
  process.exit(1);
}
const dir = join(REPO_DIR, "data", "schools");
const pack = readSchoolPackMeta(dir);
const { rows, updatedOn, selfSuccessors } = importSchoolCodes(
  src,
  pack.sources.filter((s) => s.file.endsWith(".csv")).map((s) => ({ name: s.file, sha256: s.sha256 })),
);
const { errors, checkDigitMismatches } = checkSchoolRows(rows, readAliases(readFileSync(join(dir, "aliases.yaml"), "utf8")));
if (errors.length > 0) {
  console.error(errors.slice(0, 50).join("\n"));
  process.exit(1);
}
writeFileSync(join(dir, "schools.csv"), writeSchoolCsv(rows));
const count = new Map<string, { all: number; open: number }>();
for (const r of rows) {
  const c = count.get(r.kind) ?? { all: 0, open: 0 };
  c.all++;
  if (r.abolishedOn === "") c.open++;
  count.set(r.kind, c);
}
console.log(`更新日: ${[...new Set(updatedOn)].join("・")}。移行後の学校コードが自分自身の行（移行先なしと読んだ）: ${selfSuccessors.join("・")}`);
for (const [k, c] of [...count].sort()) console.log(`${k} ${SCHOOL_KINDS[k]}: ${c.all}（うち廃止していない ${c.open}）`);
console.log(`合計: ${rows.length}。市区町村が空: ${rows.filter((r) => r.city === "").length}。検査数字の合わない学校コード（誤りにしない）: ${checkDigitMismatches.length}`);
