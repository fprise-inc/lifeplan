// AI接続口（crates/lifeplan）に同梱する Web のヒアリングの選び方（0222）。plan.js の中で動く（画面と同じ関数: workspace/hearing/aiSelection.ts）。
// - hearingOptions: ヒアリングで聞ける項目の一覧（get_hearing_options）。渡された世帯があれば、項目ごとに今の値があるか（値は返さない）
// - hearingCheck: AI が書いた選び方を WebSelection にそろえて確かめる（issue_hearing_url・propose_hearing_template の前）。答えは
//   { selection, problems, counts, review, summary }。問題があれば selection は null（接続口はアプリに頼まない）
// - 渡された世帯の今の値の有無は、FP の画面の見直しのひな形と同じく、詳細の票・簡易の票の書き出し（exportAnswers）で「空でない答え」のある項目キー。
//   渡された世帯は縮約版（計算に要る入力だけ）なので、FP のメモなどの文の項目は値が無いことになる（アプリが発行するときは、世帯ファイルの値で見せる）
import { exportAnswers } from "../../../hearing/src/export.ts";
import type { EngineRequest as HearingEngineRequest } from "../../../hearing/src/types.ts";
import type { WebSelection } from "../../../hearing/src/web/packet.ts";
import { aiSelection, AI_SHEETS, hearingOptions as options, selectionSummary, sheetDefOf, type AiSelectionArgs, type AiSheet } from "../workspace/hearing/aiSelection.ts";
import { readHearingTemplates } from "../workspace/hearing/selection.ts";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function parse(json: string): unknown {
  if (json === "") return null;
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

/** 渡された世帯の計算の入力から、今の値のある項目キー（両方の票。値は返さない）。世帯が無ければ null */
export function filledKeys(input: unknown): string[] | null {
  if (!isObj(input)) return null;
  const out = new Set<string>();
  for (const s of AI_SHEETS) {
    try {
      const r = exportAnswers(sheetDefOf(s), { input } as unknown as HearingEngineRequest);
      for (const a of r.answers) if (a.status !== "blank") out.add(a.key);
    } catch {
      // 形の違う入力: その票は値なしとして読む
    }
  }
  return [...out];
}

/** アプリ本体の答え（事務所のひな形。getOfficeHearing）を読む。アプリが起動していなければ null */
function officeOf(json: string): { templates: { name: string; selection: WebSelection }[] } | null {
  const v = parse(json);
  if (!isObj(v)) return null;
  return { templates: readHearingTemplates(v.templates) };
}

/** get_hearing_options（a は { sheet? }、shared は渡された世帯の計算の入力か ""、office はアプリ本体の答えか ""） */
export function hearingOptions(a: string, shared: string, office: string): string {
  const args = parse(a);
  const sheet = isObj(args) && typeof args.sheet === "string" && (AI_SHEETS as readonly string[]).includes(args.sheet) ? (args.sheet as AiSheet) : undefined;
  const o = officeOf(office);
  const filled = filledKeys(parse(shared));
  return JSON.stringify(options({ ...(sheet !== undefined ? { sheet } : {}), filled, officeTemplates: o?.templates ?? null }));
}

/** issue_hearing_url・propose_hearing_template の選び方の確かめ（a は選び方の引数、shared・office は上と同じ） */
export function hearingCheck(a: string, shared: string, office: string): string {
  const args = parse(a);
  if (!isObj(args)) return JSON.stringify({ selection: null, problems: ["選び方は JSON の物で書いてください"], counts: null, review: false });
  const o = officeOf(office);
  const r = aiSelection(args as AiSelectionArgs, { filled: filledKeys(parse(shared)), officeTemplates: o?.templates ?? null });
  return JSON.stringify({ ...r, ...(r.selection !== null ? { summary: selectionSummary(r.selection) } : {}) });
}
