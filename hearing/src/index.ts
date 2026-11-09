// ヒアリングシートの部品の入口（0018）。アプリの画面からは、ここの関数だけを呼ぶ。
//   書き出し: createHearingSheet … シート定義（と世帯）から .xlsx のバイト列と、アプリの側に残す依頼の記録を作る
//   取り込み: importHearingSheet … 返ってきた .xlsx を読み、世帯データの候補・不足と矛盾・推定の印・同意の下書きにする
// ファイルの保存・読み込みのダイアログ、乱数（依頼番号）、依頼の記録の保存（世帯ファイルの取り込みの記録）はアプリ本体が受け持つ
import basic1 from "../sheets/basic/1.json" with { type: "json" };
import basic2 from "../sheets/basic/2.json" with { type: "json" };
import basic3 from "../sheets/basic/3.json" with { type: "json" };
import full1 from "../sheets/full/1.json" with { type: "json" };
import full2 from "../sheets/full/2.json" with { type: "json" };
import full3 from "../sheets/full/3.json" with { type: "json" };
import full4 from "../sheets/full/4.json" with { type: "json" };
import full5 from "../sheets/full/5.json" with { type: "json" };
import { type FilledSheet } from "./answers.ts";
import { checkDefinition, type SheetDefinition } from "./definition.ts";
import { blankAnswers, exportAnswers, management } from "./export.ts";
import { importAnswers, type ImportResult } from "./import.ts";
import { issue, type Issue } from "./issues.ts";
import { layoutDigest } from "./layout.ts";
import type { EngineRequest } from "./types.ts";
import { readSheetXlsx, type HearingRequest } from "./xlsx/read.ts";
import { writeSheetXlsx, type OfficeInfo } from "./xlsx/write.ts";
import type { ZipLimits } from "../../xlsx/src/zip.ts";

export { HEARING_FORMAT, HEARING_FORMAT_VERSION, requestIdFrom, REQUEST_ID_PATTERN, type Answer, type FilledSheet, type Management, type RawValue } from "./answers.ts";
export { checkDefinition, type MoneyRangeStep, type SheetDefinition, type SheetItem } from "./definition.ts";
export { blankAnswers, exportAnswers, type ExportOptions, type ExportResult } from "./export.ts";
export { approveAll, DEFAULT_ASSUMPTIONS, GATE_KINDS, importAnswers, keyLabel, type Candidate, type ChecklistItem, type ConsentDraft, type FieldRecord, type GateAnswersIn, type GateKind, type ImportOptions, type ImportRecord, type ImportResult } from "./import.ts";
export type { Issue, IssueCode, IssueLevel } from "./issues.ts";
export { layoutDigest } from "./layout.ts";
export { readSheetXlsx, type HearingRequest, type ReadOptions, type ReadResult } from "./xlsx/read.ts";
export { REQUESTED_DOCUMENTS_HEADING, REQUESTED_DOCUMENTS_NOTE, writeSheetXlsx, type OfficeInfo, type WriteOptions } from "./xlsx/write.ts";
export { DEFAULT_LIMITS, type ZipLimits } from "../../xlsx/src/zip.ts";

/** アプリに同梱する公式のシート定義（公開したすべての版を残し続ける。0018 の7） */
export const OFFICIAL_SHEETS: readonly SheetDefinition[] = [basic1, basic2, basic3, full1, full2, full3, full4, full5] as unknown as SheetDefinition[];

/** 書き出せるシート（retired は書き出さない） */
export function exportableSheets(): SheetDefinition[] {
  return OFFICIAL_SHEETS.filter((d) => d.status !== "retired");
}

/** シートID の書き出せる最新の版（basic＝シンプル〔簡易版〕・full＝詳細版。見直しは詳細版に前回の値を記入する） */
export function latestSheet(sheetId: string): SheetDefinition | undefined {
  return exportableSheets()
    .filter((d) => d.sheetId === sheetId)
    .sort((a, b) => b.version - a.version)[0];
}

export interface CreateSheetOptions {
  readonly definition: SheetDefinition;
  /** 前回の値を記入するときの世帯（0018 の9。FP が選んだときだけ。詳細版 full のシートだけ） */
  readonly household?: { readonly request: EngineRequest; readonly assumed?: Readonly<Record<string, string>> } | null;
  /** 依頼番号（requestIdFrom にアプリ本体の乱数を渡して作る） */
  readonly requestId: string;
  readonly customerNo: string;
  readonly office: OfficeInfo;
  readonly appVersion: string;
  /** 書き出す日（YYYY-MM-DD） */
  readonly exportedOn: string;
  /** この世帯でお願いしたい書類（1枚目の配置の後ろに足す。取り込みは読まない。WriteOptions.requestedDocuments） */
  readonly requestedDocuments?: readonly string[];
}

export interface CreateSheetResult {
  readonly bytes: Uint8Array;
  /** アプリの側に残す依頼の記録（世帯ファイルの取り込みの記録に暗号化して置く） */
  readonly request: HearingRequest;
  readonly filled: FilledSheet;
  /** 書き出す前に FP に見せる知らせ（前回の値を記入するときの警告、シートに載らない物） */
  readonly issues: readonly Issue[];
}

/** ヒアリングシートの .xlsx を作る */
export async function createHearingSheet(o: CreateSheetOptions): Promise<CreateSheetResult> {
  const problems = checkDefinition(o.definition);
  if (problems.length > 0) throw new Error(`シート定義に問題があります: ${problems.join("・")}`);
  if (o.definition.status === "retired") throw new Error("廃止したシートは書き出しません");
  // 前回の値を記入する（見直し）のは詳細版だけ。簡易版（シンプル）は大まかに聞く軽い票で、前回の値の欄の形（範囲・合計）が違う
  if (o.household != null && o.definition.sheetId !== "full") throw new Error("前回の値を記入して書き出せるのは詳細版のシートだけです");
  const digest = await layoutDigest(o.definition);
  const m = management(o.definition, { requestId: o.requestId, customerNo: o.customerNo, layoutDigest: digest, appVersion: o.appVersion, exportedOn: o.exportedOn });
  const issues: Issue[] = [];
  let answers = blankAnswers(o.definition);
  if (o.household != null) {
    const ex = exportAnswers(o.definition, o.household.request, o.household.assumed !== undefined ? { assumed: o.household.assumed } : {});
    answers = [...ex.answers];
    issues.push(issue("warning", "H_EXPORT_PREFILL", "暗号化されない Excel に、金額などの前回の値が載ります。送り方に気をつけてください（書き出したことを記録します）"), ...ex.issues);
  }
  const filled: FilledSheet = { management: m, answers };
  const bytes = writeSheetXlsx(o.definition, answers, { management: m, office: o.office, ...(o.requestedDocuments !== undefined && o.requestedDocuments.length > 0 ? { requestedDocuments: o.requestedDocuments } : {}) });
  const request: HearingRequest = { requestId: o.requestId, sheetId: o.definition.sheetId, sheetVersion: o.definition.version, layoutDigest: digest, customerNo: o.customerNo, exportedOn: o.exportedOn, prefilled: o.household != null };
  return { bytes, request, filled, issues };
}

export interface ImportSheetOptions {
  readonly baseMonth: string;
  readonly requests?: readonly HearingRequest[];
  readonly definitions?: readonly SheetDefinition[];
  readonly newId?: () => string;
  readonly limits?: ZipLimits;
}

export type ImportSheetResult = ({ readonly ok: true } & ImportResult & { readonly definition: SheetDefinition; readonly requestRecord: HearingRequest | null }) | { readonly ok: false; readonly issues: readonly Issue[] };

/** 返ってきた .xlsx を読み、世帯データの候補にする */
export async function importHearingSheet(bytes: Uint8Array, o: ImportSheetOptions): Promise<ImportSheetResult> {
  const read = await readSheetXlsx(bytes, { definitions: o.definitions ?? OFFICIAL_SHEETS, ...(o.requests !== undefined ? { requests: o.requests } : {}), ...(o.limits !== undefined ? { limits: o.limits } : {}) });
  if (!read.ok) return read;
  const r = importAnswers(read.definition, read.filled, { baseMonth: o.baseMonth, ...(o.newId !== undefined ? { newId: o.newId } : {}) });
  return { ok: true, ...r, issues: [...read.issues, ...r.issues], definition: read.definition, requestRecord: read.request };
}
