// 推定の目安の数の写し（hearing/src/statistics.generated.ts）を、正本の YAML（data/master・data/regulation。0007）から作る。
// 入力の画面（app）とヒアリングシートの取り込みは、どちらもこの写しを hearing/src/estimates.ts から読む（推定の目安の数を1か所に置く）。
// 画面は配布の制度データのパック（非同期で届く）を待たずに推定を出すので、ビルドの前の写しにしている。
//   npm run statistics         写しを作り直す
//   npm run statistics:check   写しが正本と食い違っていないことを確かめる（CI）
// 選び方は計算エンジンと同じ: 決定済み（enacted）で、訂正されていない（supersededIn が null）行。条件・管轄の無い全国の行だけ
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";

const REPO = join(import.meta.dirname, "..", "..");
const TARGET = join(import.meta.dirname, "..", "src", "statistics.generated.ts");

/** マスタデータのうち、推定の目安に使うパック（フォルダの値をすべて写す） */
const MASTER_PACKS = ["wageStats", "retirementBenefit", "living.statistics", "education.statistics", "care.statistics", "housing.statistics", "loanRates"];
/** マスタデータのうち、条件（性別など）ごとの行を写す値（id に「.<条件の値>」を付けて写す。例: lifeTable.lifeExpectancy.male） */
const CONDITIONED_MASTER: readonly [string, string, string][] = [["lifeTable", "lifeTable.lifeExpectancy", "sex"]];
/** 制度データのうち、推定の目安の式と入力の画面の知らせ（退職所得の控除の重なりの年数など）に使う値（適用期間ごとの行を写す） */
const REGULATION_VALUES: readonly [string, string][] = [
  ["tax", "incomeTax.employmentIncomeDeduction"],
  ["tax", "residentTax.basicDeduction"],
  ["tax", "incomeTax.retirementIncome.overlap.lookbackYears"],
  ["tax", "incomeTax.retirementIncome.overlap.lookbackYearsAfterDc"],
  ["tax", "incomeTax.retirementIncome.overlap.lookbackYearsForDc"],
  ["tax", "inheritanceTax.retirementAllowance.exemptionPerHeir"],
  ["tax", "residentTax.perCapita.municipal"],
  ["tax", "residentTax.perCapita.prefectural"],
  ["tax", "forestEnvironmentTax.amount"],
  ["socialInsurance", "socialInsurance.health.standardMonthlyRemuneration"],
  ["socialInsurance", "socialInsurance.pension.standardMonthlyRemuneration"],
  // 親の扶養の境目（介護・親のカードの1行）
  ["socialInsurance", "socialInsurance.dependent.incomeLimit"],
  ["socialInsurance", "socialInsurance.dependent.incomeLimitElderly"],
  ["socialInsurance", "socialInsurance.dependent.elderlyAge"],
  ["socialInsurance", "socialInsurance.health.lateElderlyAge"],
  ["tax", "incomeTax.dependentIncomeLimit"],
  ["tax", "incomeTax.publicPensionDeduction.over65.tier1"],
  ["tax", "incomeTax.publicPensionDeduction.under65.tier1"],
  ["tax", "incomeTax.publicPensionDeduction.elderlyAge"],
];
/** 保険者（協会けんぽの支部）ごとの行を写す制度データの値（管轄 insurer の行。code を持たせる） */
const INSURER_VALUES: readonly [string, string][] = [["socialInsurance", "socialInsurance.health.kyokaikenpo.rate"]];

type Obj = Record<string, unknown>;

function readValue(path: string): Obj {
  return parse(readFileSync(path, "utf8"), { version: "1.2", schema: "core" }) as Obj;
}

/** 計算に使える行（決定済み・訂正されていない・全国・条件なし）を適用開始の順に */
function liveEntries(v: Obj): Obj[] {
  return (v.entries as Obj[])
    .filter((e) => e.status === "enacted" && e.supersededIn === null && e.jurisdiction === "national" && (e.conditions as unknown[]).length === 0)
    .sort((a, b) => ((a.appliesFrom as string) < (b.appliesFrom as string) ? -1 : 1));
}

function build(): string {
  const master: Record<string, unknown> = {};
  for (const pack of MASTER_PACKS) {
    const dir = join(REPO, "data", "master", pack);
    for (const name of readdirSync(dir).sort()) {
      if (!name.endsWith(".yaml") || name === "pack.yaml") continue;
      const v = readValue(join(dir, name));
      const live = liveEntries(v);
      const e = live.at(-1);
      if (e === undefined) continue;
      const sources = e.sources as Obj[];
      master[v.id as string] = {
        title: v.title,
        value: e.value,
        rev: e.rev,
        reviewed: (e.approval as Obj | undefined)?.method === "reviewed",
        retrievedAt: sources[0]?.retrievedAt ?? null,
      };
    }
  }
  for (const [pack, id, key] of CONDITIONED_MASTER) {
    const v = readValue(join(REPO, "data", "master", pack, `${id}.yaml`));
    const live = (v.entries as Obj[]).filter((e) => e.status === "enacted" && e.supersededIn === null && e.jurisdiction === "national");
    const byValue = new Map<string, Obj>();
    for (const e of live) {
      const conds = e.conditions as Obj[];
      if (conds.length !== 1 || conds[0]?.key !== key) continue;
      const cur = byValue.get(String(conds[0].equals));
      if (cur === undefined || (cur.appliesFrom as string) <= (e.appliesFrom as string)) byValue.set(String(conds[0].equals), e);
    }
    for (const [val, e] of [...byValue].sort(([a], [b]) => (a < b ? -1 : 1))) {
      const sources = e.sources as Obj[];
      master[`${id}.${val}`] = { title: v.title, value: e.value, rev: e.rev, reviewed: (e.approval as Obj | undefined)?.method === "reviewed", retrievedAt: sources[0]?.retrievedAt ?? null };
    }
  }
  const regulation: Record<string, unknown> = {};
  for (const [area, id] of REGULATION_VALUES) {
    const path = join(REPO, "data", "regulation", area, `${id}.yaml`);
    if (!existsSync(path)) throw new Error(`${id}: 制度データのファイルがありません`);
    const v = readValue(path);
    regulation[id] = liveEntries(v).map((e) => ({ from: e.appliesFrom, to: e.appliesTo, rev: e.rev, value: e.value }));
  }
  for (const [area, id] of INSURER_VALUES) {
    const v = readValue(join(REPO, "data", "regulation", area, `${id}.yaml`));
    regulation[id] = (v.entries as Obj[])
      .filter((e) => e.status === "enacted" && e.supersededIn === null && (e.conditions as unknown[]).length === 0 && typeof e.jurisdiction === "object" && (e.jurisdiction as Obj).level === "insurer")
      .sort((a, b) => ((a.appliesFrom as string) < (b.appliesFrom as string) ? -1 : 1))
      .map((e) => ({ from: e.appliesFrom, to: e.appliesTo, rev: e.rev, insurer: (e.jurisdiction as Obj).code, value: e.value }));
  }
  return [
    "// 自動生成（hearing/scripts/statistics.ts。npm run statistics）。手で書き換えない。",
    "// 正本は data/master（wageStats・retirementBenefit・living.statistics・education.statistics・care.statistics・housing.statistics・loanRates・lifeTable）と data/regulation の YAML（0007）。推定の目安の数の写し",
    'import type { DatedValue, MasterValue } from "./statistics.ts";',
    "",
    `export const MASTER_VALUES: Readonly<Record<string, MasterValue>> = ${JSON.stringify(master, null, 1)};`,
    "",
    `export const REGULATION_VALUES: Readonly<Record<string, readonly DatedValue[]>> = ${JSON.stringify(regulation, null, 1)};`,
    "",
  ].join("\n");
}

const text = build();
if (process.argv.includes("--check")) {
  const cur = existsSync(TARGET) ? readFileSync(TARGET, "utf8") : "";
  if (cur !== text) {
    console.error("hearing/src/statistics.generated.ts が data/ の正本と食い違っています。npm run statistics で作り直してください");
    process.exit(1);
  }
  console.log("推定の目安の写しは正本と同じです");
} else {
  writeFileSync(TARGET, text);
  console.log(`書き出しました: ${TARGET}`);
}
