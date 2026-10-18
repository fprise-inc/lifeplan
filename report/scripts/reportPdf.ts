// report-pdf（Rust のコマンド）を呼ぶ道具と、見本の外枠（刻印・必須の記載）。見本の PDF とテストで使う
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProposalBundle } from "../src/bundle.ts";
import type { ProposalInput } from "../src/input.ts";
import { REPO_DIR } from "./engine.ts";

/** 必須の記載（0009 の6）。アプリでは本体が決めて渡す。ここは見本の文言 */
export const STANDARD_NOTICES = [
  "この提案書は、お伺いした情報と前提条件にもとづく試算です。将来の金額や結果を保証するものではありません。",
  "公的データの出典: 国税庁、厚生労働省、日本年金機構、文部科学省、金融庁、総務省統計局の公表資料（加工して作成）",
  "前提条件や計算方法の一部は担当FPが設定しています。",
];
export const REFORM_NOTICE = "遺族年金は2028年4月の見直し前の制度で計算しています（2028年4月以後に亡くなる想定）。";

/** 刻印の制度データの版の見本: 計算基準月と、使ったパックと版の組の指紋の先頭（書式は未確定。0009 の未確定・0017） */
export function sampleDataSetLabel(bundle: ProposalBundle): string {
  const packs = (bundle.proposal.result.header.data ?? []).map((d) => `${d.packId}@${d.version}`).sort();
  return `${bundle.proposal.request.input.baseMonth.replace("-", ".")}-${createHash("sha256").update(packs.join("\n")).digest("hex").slice(0, 8)}`;
}

export interface FrameJson {
  stamp: { dataSetLabel: string; baseMonth: string };
  beta: boolean;
  notices: string[];
  internal: { snapshotId: string | null; dataSetId: string | null; customDigests: string[] };
}

export function sampleFrame(bundle: ProposalBundle, input: ProposalInput): FrameJson {
  return {
    stamp: { dataSetLabel: sampleDataSetLabel(bundle), baseMonth: input.basis.baseMonth },
    beta: true,
    notices: [...STANDARD_NOTICES, ...(input.assumptions.survivorReform ? [REFORM_NOTICE] : [])],
    internal: { snapshotId: null, dataSetId: null, customDigests: [] },
  };
}

/** ビルドした report-pdf（release を優先。REPORT_PDF_BIN で指定もできる）。無ければ null */
export function reportPdfBin(): string | null {
  const exe = process.platform === "win32" ? "report-pdf.exe" : "report-pdf";
  const list = [process.env.REPORT_PDF_BIN, join(REPO_DIR, "target", "release", exe), join(REPO_DIR, "target", "debug", exe)];
  return list.find((p): p is string => p !== undefined && p !== "" && existsSync(p)) ?? null;
}

export interface RenderResult {
  pdf: Buffer;
  meta: { pages: number; bytes: number; addressee: { page: number } | null; noticesPageAdded: boolean; sizes: [number, number][] };
  pages: string[];
}

/** 帳票の入力と外枠から PDF を作り、各ページの文字を抜き出す */
export function renderAndExtract(bin: string, input: ProposalInput, frame: FrameJson): RenderResult {
  const dir = mkdtempSync(join(tmpdir(), "report-pdf-"));
  writeFileSync(join(dir, "input.json"), JSON.stringify(input));
  writeFileSync(join(dir, "frame.json"), JSON.stringify(frame));
  execFileSync(bin, ["render", "--input", join(dir, "input.json"), "--frame", join(dir, "frame.json"), "--out", join(dir, "out.pdf"), "--meta", join(dir, "meta.json"), "--debug"]);
  const pages = JSON.parse(execFileSync(bin, ["text", join(dir, "out.pdf")], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8")) as string[];
  return { pdf: readFileSync(join(dir, "out.pdf")), meta: JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as RenderResult["meta"], pages };
}
