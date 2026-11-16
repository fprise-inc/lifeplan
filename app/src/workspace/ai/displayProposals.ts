// AI からの、渡された世帯ごとの表示の設定の案（接続口の propose_display_settings の share_id。0213 の段B の後半）を、その世帯に当てる所。
// - 案の値は get_display_settings の今の値（current.household.value）と同じ形。当てる前に、接続口と同じ関数（connector/displayProposal.ts）で
//   もう一度確かめる（本体の受け口は形の外側しか見ないため。確かめられない案は「反映する」を出さない）
// - 「今」はその世帯の画面に出している値（事務所の既定値に従う印のある設定は事務所の今の既定値）。印のある設定は「事務所の既定値」と添える
// - 「反映する」を押した設定は、その世帯だけの値になる（事務所の既定値に従う印を外す。値が事務所の既定値と同じでも外す）。この世帯で並べる時点は
//   世帯だけの値をそのまま書く。新しい世帯で出す入力項目と開いたときの入れ方（input.items）は、この世帯の入力項目の選び方（itemChoice）を書く
// - 戻すのは、元に戻すの履歴（反映した後の「元に戻す」）と、表示の設定の「事務所の既定値に戻す」（押す前が事務所の既定値だった設定）。
//   世帯ファイルに前の値は持たない（設計記録の「前の値に戻す」）
import { householdCurrent, type CurrentValue } from "../../connector/display.ts";
import type { HouseholdProposableDisplayId } from "../../connector/displayCatalog.ts";
import { checkDisplayValue, isHouseholdProposableDisplayId } from "../../connector/displayProposal.ts";
import type { BsColumn } from "../../presentation/model.ts";
import { readItemChoice, type ItemChoice } from "../input/itemChoice.ts";
import { isOfficeDisplayId, setDisplayValue, type DisplayPair, type StoredDisplay } from "../settings.ts";

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** 案を当てる世帯の今の状態（世帯の表示の設定・入力項目の選び方・事務所の今の既定値） */
export interface HouseholdDisplayState {
  display: StoredDisplay;
  itemChoice: ItemChoice | undefined;
  /** 結果のタブ・資産と負債のタブの表示の設定の事務所の既定値（officeDisplayOf の答え） */
  office: DisplayPair;
}

/** その世帯の、設定ごとの今の値（get_display_settings の current.household と同じ読み方。value・text・followsOffice） */
export function householdNow(s: HouseholdDisplayState): Record<string, CurrentValue> {
  const raw = { display: { result: s.display.result, balance: s.display.balance, followOffice: s.display.followOffice ?? [] }, itemChoice: s.itemChoice ?? null, shownItems: [] };
  return householdCurrent(raw, { display: s.office });
}

/**
 * 確かめた値を、その設定だけ世帯に書いた状態（ほかの設定は変えない）。結果のタブ・資産と負債のタブの11件は、事務所の既定値に従う印を外して
 * この世帯だけの値にする。並べる時点は世帯だけの値。入力項目の選び方は itemChoice を置き換える
 */
export function withHouseholdValue(s: HouseholdDisplayState, id: HouseholdProposableDisplayId, v: unknown): HouseholdDisplayState {
  if (id === "input.items") {
    const c = readItemChoice(v);
    return { ...s, itemChoice: c };
  }
  if (id === "balance.columns") return { ...s, display: { ...s.display, balance: { ...s.display.balance, columns: v as BsColumn[] | null } } };
  if (!isOfficeDisplayId(id)) return s;
  const own = setDisplayValue(s.display, id, v);
  return { ...s, display: { ...own, followOffice: (s.display.followOffice ?? []).filter((x) => x !== id) } };
}

/** 承認の画面の1行: 今 → 案（案が確かめられないときは problem） */
export interface HouseholdProposalRow {
  id: HouseholdProposableDisplayId;
  now: string;
  /** 「今」が事務所の既定値に従っているか（true＝事務所の既定値・false＝この世帯だけ・null＝事務所の既定値を持たない設定） */
  nowFollows: boolean | null;
  next: string | null;
  /** 今と同じ値の案（反映しても変わらない） */
  unchanged: boolean;
  problem: string | null;
  /** 確かめてそろえた値（反映するときに書く値） */
  value: unknown;
}

export function householdProposalRow(s: HouseholdDisplayState, id: string, v: unknown): HouseholdProposalRow | null {
  if (!isHouseholdProposableDisplayId(id)) return null;
  const nowAll = householdNow(s);
  const now = nowAll[id];
  const nowText = now?.text ?? "—";
  const nowFollows = isOfficeDisplayId(id) ? now?.followsOffice === true : null;
  const r = checkDisplayValue(id, v);
  if (!r.ok) return { id, now: nowText, nowFollows, next: null, unchanged: false, problem: r.message, value: null };
  const next = householdNow(withHouseholdValue(s, id, r.value))[id]?.text ?? "—";
  return { id, now: nowText, nowFollows, next, unchanged: same(now?.value, r.value), problem: null, value: r.value };
}
