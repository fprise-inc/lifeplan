// 答え合わせ（検証 L2）の合格率と、合わなかった例の原因を表にする（npm run l2）
import { CASES, l2Summary } from "../test/l2/cases.ts";

const s = l2Summary();
const pct = (n: number, d: number) => `${((n * 1000) / d / 10).toFixed(1)}%`;
const comparable = CASES.filter((c) => c.status === "pass").length;
console.log(`公式の計算例 ${s.total} 件のうち一致 ${s.passed} 件（${pct(s.passed, s.total)}）。標準税率などの扱いの違いが無い例 ${comparable} 件では ${s.passed}/${comparable}`);
for (const area of ["所得税", "住民税", "社会保険", "公的年金", "給付"] as const) {
  const cs = CASES.filter((c) => c.area === area);
  console.log(`- ${area}: ${cs.length} 件`);
}
if (s.mismatches.length > 0) {
  console.log("\n| 例 | 公式の答え | この計算 | 原因 |\n|---|---|---|---|");
  for (const m of s.mismatches) console.log(`| ${m.id} | ${m.expected} | ${m.actual} | ${m.cause} |`);
}
if (s.failures.length > 0) {
  console.error("\n一致するはずの例が合わない:");
  for (const f of s.failures) console.error(`- ${f.id}: 公式 ${f.expected} / この計算 ${String(f.actual)}`);
  process.exit(1);
}
