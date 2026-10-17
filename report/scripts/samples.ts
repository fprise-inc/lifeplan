// 見本の提案書を作る（npm run samples）。架空のモデル世帯から帳票の入力を組み立て、report-pdf（Rust）で PDF にする。
// 出力: report/dist/samples/<世帯>.input.json・.frame.json・.pdf・.meta.json（dist/ はリポジトリに入れない。CI の成果物で見る）
// 先に: engine/ で `npm run build`、リポジトリ直下で `cargo build --release -p report-pdf`
// --fixture を付けると、Rust のテストの入力（crates/report-pdf/tests/fixtures/advisoryFeeProposal.input.json）も書き直す
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProposalInput } from "../src/build.ts";
import { REPO_DIR, REPORT_DIR } from "./engine.ts";
import { reportPdfBin, sampleFrame } from "./reportPdf.ts";
import { SAMPLES } from "./sampleBundles.ts";

const fixture = process.argv.includes("--fixture");
const out = join(REPORT_DIR, "dist", "samples");
mkdirSync(out, { recursive: true });
const bin = reportPdfBin();
if (bin === null) throw new Error("report-pdf がありません。先にリポジトリ直下で `cargo build --release -p report-pdf` を流してください");
for (const s of SAMPLES) {
  const bundle = s.bundle();
  const input = buildProposalInput(bundle);
  const base = join(out, s.id);
  writeFileSync(`${base}.input.json`, JSON.stringify(input, null, 1) + "\n");
  writeFileSync(`${base}.frame.json`, JSON.stringify(sampleFrame(bundle, input), null, 1) + "\n");
  execFileSync(bin, ["render", "--input", `${base}.input.json`, "--frame", `${base}.frame.json`, "--out", `${base}.pdf`, "--meta", `${base}.meta.json`], { stdio: "inherit" });
  console.log(`${s.id}: ${base}.pdf（${s.title}）`);
  if (fixture && s.id === "advisoryFeeProposal") {
    const dir = join(REPO_DIR, "crates", "report-pdf", "tests", "fixtures");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${s.id}.input.json`), JSON.stringify(input, null, 1) + "\n");
  }
}
