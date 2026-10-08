// モデル世帯（data/modelHouseholds、架空・CC0）で、制度改正の差分を見る（npm run models）
// 令和8年度改正より前のパックの版（2026.1.0）と最新の版で、2027年の税・社会保険料と年間収支を並べる
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runEngine, type EngineResult } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { REPO_DIR } from "./lib.ts";
import { buildPack, packDirs } from "./regulation.ts";

const packs = packDirs().map(buildPack);
const dir = join(REPO_DIR, "data", "modelHouseholds");
const ROWS = ["cf.taxSi.incomeTax", "cf.taxSi.residentTax", "cf.taxSi.health", "cf.taxSi.care", "cf.taxSi.childSupport", "cf.taxSi.pension", "cf.taxSi.employment", "cf.net"];
const label = (r: string) => r.split(".").pop() as string;
const year = Number(process.argv[2] ?? "2027");
const sum = (r: EngineResult, row: string) =>
  row === "cf.net"
    ? (r.annual.find((a) => a.row === row && a.year === year)?.amount ?? 0)
    : (r.table as unknown as { row: string; year: number; amount: number }[]).filter((c) => c.row === row && c.year === year).reduce((s, c) => s + c.amount, 0);
console.log(`${year}年の値（円）。左: 版 2026.1.0（改正前の知識）、右: 最新の版、差`);
console.log(`| 世帯 | ${ROWS.map(label).join(" | ")} |\n|---|${ROWS.map(() => "---").join("|")}|`);
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const req = JSON.parse(readFileSync(join(dir, f), "utf8")) as EngineRequest;
  const old = { ...req, input: { ...req.input, dataSet: { "regulation.tax": "2026.1.0", "regulation.socialInsurance": "2026.1.0" } } } as EngineRequest;
  const a = runEngine(old, packs);
  const b = runEngine(req, packs);
  console.log(`| ${f.replace(/\.json$/, "")} | ${ROWS.map((r) => `${sum(a, r)} → ${sum(b, r)}（${sum(b, r) - sum(a, r) >= 0 ? "+" : ""}${sum(b, r) - sum(a, r)}）`).join(" | ")} |`);
}
