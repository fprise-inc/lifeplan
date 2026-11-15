// AI からの表示の設定の候補（接続口の propose_display_settings。0215）を、事務所の既定値に当てる所。
// - 候補の値は get_display_settings の今の値（current.office.value）と同じ形。当てる前に、接続口と同じ関数（connector/displayProposal.ts）で
//   もう一度確かめる（本体の受け口は形の外側しか見ないため。確かめられない候補は「反映する」を出さない）
// - 「反映する」は、その設定だけを事務所の既定値に書き、前の値を事務所データの前の値（displayHistory.ts）に残す。「前の値に戻す」も同じ書き方
// - 新しい世帯で出す入力項目と、開いたときの入れ方（input.items）は、事務所の既定を変えるだけ（新しく作る世帯に写す。作った世帯にそろえる操作は出さない）
import { DEFAULT_PREMISE_KINDS, readPremiseChoice, readSceneChoice, SCENE_KINDS } from "../contingency/premiseChoice.ts";
import { DEFAULT_LEVER_KINDS, readLeverChoice } from "../plans/leverChoice.ts";
import { STAGE_ORDER } from "../input/stageOrder.ts";
import type { StageId } from "../input/form.ts";
import { officeCurrent } from "../../connector/display.ts";
import { buildDisplayCatalog, type ProposableDisplayId } from "../../connector/displayCatalog.ts";
import { checkDisplayValue, type DisplayValueCheck } from "../../connector/displayProposal.ts";
import { withHistoryEntry, type DisplayHistoryEntry } from "./displayHistory.ts";
import { DEFAULT_OFFICE_SETTINGS, withLivingLayout, withOfficeItems, type OfficeSettings } from "./settings.ts";
import type { LivingLayout } from "./livingLayout.ts";

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** 事務所の既定値の、その設定の今の値（get_display_settings の current.office と同じ。value・isDefault・text） */
export const displayNow = (s: OfficeSettings, id: ProposableDisplayId) => officeCurrent(s)[id] as { value: unknown; isDefault: boolean; text: string };

/** 確かめた値（checkDisplayValue でそろえた物）を、その設定だけ事務所の既定値に書いた設定（ほかの設定・前の値は変えない） */
export function withDisplayValue(s: OfficeSettings, id: ProposableDisplayId, v: unknown): OfficeSettings {
  switch (id) {
    case "input.order": {
      const order = strings(v) as StageId[];
      return { ...s, layout: same(order, STAGE_ORDER.map((x) => x.id)) ? null : { order } };
    }
    case "input.items":
      return withOfficeItems(s, v as Parameters<typeof withOfficeItems>[1]);
    case "input.living":
      return withLivingLayout(s, v as LivingLayout);
    case "result.levers": {
      const on = strings(v);
      return { ...s, levers: readLeverChoice({ shown: on.filter((k) => !(DEFAULT_LEVER_KINDS as readonly string[]).includes(k)), hidden: DEFAULT_LEVER_KINDS.filter((k) => !on.includes(k)) }) };
    }
    case "contingency.premises": {
      const on = strings(v);
      return { ...s, premises: readPremiseChoice({ shown: on.filter((k) => !(DEFAULT_PREMISE_KINDS as readonly string[]).includes(k)), hidden: DEFAULT_PREMISE_KINDS.filter((k) => !on.includes(k)) }) };
    }
    case "contingency.scenes": {
      const on = strings(v);
      return { ...s, scenes: readSceneChoice({ ...s.scenes, hidden: SCENE_KINDS.map((k) => k.kind).filter((k) => !on.includes(k)) }) };
    }
    case "contingency.openScene":
      return { ...s, scenes: readSceneChoice({ ...s.scenes, open: v }) };
  }
}

/** 候補の値の画面の言葉（その値だけを既定に書いたときの今の値の要約。承認の画面の「候補」の列） */
export const displayText = (id: ProposableDisplayId, v: unknown): string => displayNow(withDisplayValue(DEFAULT_OFFICE_SETTINGS, id, v), id).text;

/** 承認の画面の1行: 今 → 候補（候補が確かめられないときは problem） */
export interface DisplayProposalRow {
  id: ProposableDisplayId;
  now: string;
  next: string | null;
  /** 今と同じ値の候補（反映しても変わらない） */
  unchanged: boolean;
  /** 変わる所（選んだ物の並びの設定だけ。「足す: …／外す: …」。並べ替えだけ・ほかの形は null） */
  change: string | null;
  problem: string | null;
  /** 確かめてそろえた値（反映するときに書く値） */
  value: unknown;
}

export function proposalRow(s: OfficeSettings, id: ProposableDisplayId, v: unknown): DisplayProposalRow {
  const now = displayNow(s, id);
  const r: DisplayValueCheck = checkDisplayValue(id, v);
  if (!r.ok) return { id, now: now.text, next: null, unchanged: false, change: null, problem: r.message, value: null };
  return { id, now: now.text, next: displayText(id, r.value), unchanged: same(now.value, r.value), change: changeText(id, now.value, r.value), problem: null, value: r.value };
}

/** 選んだ物の並び（対策・想定の前提・場面の帯）の、足す物と外す物の言葉 */
function changeText(id: ProposableDisplayId, before: unknown, after: unknown): string | null {
  if (id !== "result.levers" && id !== "contingency.premises" && id !== "contingency.scenes") return null;
  const a = strings(before);
  const b = strings(after);
  const label = (k: string) => buildDisplayCatalog().settings.find((s) => s.id === id)?.choices?.find((c) => c.value === k)?.label ?? k;
  const add = b.filter((k) => !a.includes(k)).map(label);
  const drop = a.filter((k) => !b.includes(k)).map(label);
  const parts = [...(add.length > 0 ? [`足す: ${add.join("・")}`] : []), ...(drop.length > 0 ? [`外す: ${drop.join("・")}`] : [])];
  return parts.length > 0 ? parts.join("／") : null;
}

/**
 * 値をその設定に書き、前の値を残した設定（reason: ai＝AI の候補を反映する・restore＝前の値に戻す）。値は確かめた物だけ（確かめられなければ null）。
 * 今と同じ値なら、設定も前の値も変えない
 */
export function applyDisplayValue(s: OfficeSettings, id: ProposableDisplayId, v: unknown, at: string, reason: DisplayHistoryEntry["reason"]): OfficeSettings | null {
  const r = checkDisplayValue(id, v);
  if (!r.ok) return null;
  const before = displayNow(s, id).value;
  if (same(before, r.value)) return s;
  return { ...withDisplayValue(s, id, r.value), displayHistory: withHistoryEntry(s.displayHistory, id, { value: before, at, reason }) };
}

/** 前の値に戻した設定（index は前の値の並びの位置。無ければ null。戻す前の値も前の値に残す） */
export function restoreDisplayValue(s: OfficeSettings, id: ProposableDisplayId, index: number, at: string): OfficeSettings | null {
  const e = s.displayHistory?.[id]?.[index];
  return e === undefined ? null : applyDisplayValue(s, id, e.value, at, "restore");
}

/** 開いている画面の編集中の設定に、反映した1つの設定と前の値だけを写す（ほかの編集中の欄は変えない） */
export function carryDisplayValue(draft: OfficeSettings, saved: OfficeSettings, id: ProposableDisplayId): OfficeSettings {
  const next = withDisplayValue(draft, id, displayNow(saved, id).value);
  const { displayHistory: _h, ...rest } = next;
  void _h;
  return saved.displayHistory === undefined ? rest : { ...rest, displayHistory: saved.displayHistory };
}
