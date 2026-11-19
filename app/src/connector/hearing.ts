// AI接続口（crates/lifeplan）に同梱する Web のヒアリングの選び方（0222）。plan.js の中で動く（画面と同じ関数: workspace/hearing/aiSelection.ts）。
// - hearingOptions: ヒアリングで聞ける項目の一覧（get_hearing_options）。渡された世帯があれば、項目ごとに今の値があるか（値は返さない）
// - hearingCheck: AI が書いた選び方を WebSelection にそろえて確かめる（issue_hearing_url・propose_hearing_template の前）。答えは
//   { selection, problems, counts, review, summary }。問題があれば selection は null（接続口はアプリに頼まない）
// - 渡された世帯の今の値の有無は、FP の画面と同じ関数（entered.ts の enteredKeys。詳細の票・簡易の票で「空でない答え」のある項目キー。まだ何も
//   入れていない新しい世帯は「値なし」。0222 の追記 2026-11-19）。
//   渡された世帯は縮約版（計算に要る入力だけ）なので、FP のメモなどの文の項目は値が無いことになる（アプリが発行するときは、世帯ファイルの値で見せる）
import type { EngineRequest } from "../engine/types.ts";
import { enteredKeys, nothingEntered } from "../workspace/hearing/entered.ts";
import type { PostRetirement } from "../workspace/input/household.ts";
import { workingOf } from "./working.ts";
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

/**
 * 渡された世帯から、今の値のある項目キー（両方の票。値は返さない）。世帯が無ければ null。画面と同じ関数（workspace/hearing/entered.ts の
 * enteredKeys）で決める（詳細の票は、画面の見直しのひな形・世帯にもう値が入っているかと同じ答え）。まだ何も入れていない新しい世帯は「値なし」（0222 の追記 2026-11-19）。
 * shared は { input, postRetirement?, enteredState? }。enteredState はアプリ本体が添える画面の入力の進み具合（保存した入力項目の数・足した
 * 入力項目の数・仮の値を入れた欄のキー〔物の ID は共有の仮の ID〕）で、AI には見せない。無ければ数は0・仮の値なしとして読む
 */
export function filledKeys(shared: unknown): string[] | null {
  if (!isObj(shared) || !isObj(shared.input)) return null;
  const req = { input: shared.input } as unknown as EngineRequest;
  const post = isObj(shared.postRetirement) ? (shared.postRetirement as Record<string, PostRetirement>) : undefined;
  let w;
  try {
    w = workingOf(req, post !== undefined ? { postRetirement: post } : {});
  } catch {
    return [];
  }
  if (w === null) return [];
  const st = isObj(shared.enteredState) ? shared.enteredState : {};
  const n = (k: string) => (typeof st[k] === "number" ? (st[k] as number) : 0);
  const assumed = Array.isArray(st.assumed) ? Object.fromEntries(st.assumed.filter((k): k is string => typeof k === "string").map((k) => [k, "仮の値"])) : {};
  const wh = { ...w.wh, assumed };
  // 保存した・足した入力項目があれば、画面の nothingEnteredYet と同じく「何か入れた世帯」（数だけで決まる。中身は見ない）
  const nothing = n("confirmed") === 0 && n("addedItems") === 0 && nothingEntered({ ...wh, confirmed: [], addedItems: [] });
  // 両方の票（簡易の票の項目キーにも今の値があるかを付ける）。詳細の票は画面の見直し・世帯にもう値が入っているかと同じ答え
  const out = new Set<string>();
  for (const s of AI_SHEETS) {
    try {
      for (const k of enteredKeys(wh, sheetDefOf(s), nothing)) out.add(k);
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
