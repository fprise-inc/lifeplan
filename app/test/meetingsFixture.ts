// テストの道具: 目印の文字を入れた面談の記録（0182）。お客さまと見てよい欄・FP だけの欄・保険の意向の両方の置き方を持つ。
// 提示層・持ち帰り・提案書・AI に出ないことを確かめるのに使う
import { newMeeting, withIntent, type Meeting } from "../src/workspace/meetings/meetings.ts";

export function markedMeetings(mark = "MEETING-MARK"): Meeting[] {
  const a = withIntent({ ...newMeeting("2026-10-01", "m-1"), shared: { talked: `${mark}-shared-talked`, decided: `${mark}-shared-decided`, todo: `${mark}-shared-todo` }, fpOnly: { note: `${mark}-fponly-note` } }, { initial: `${mark}-intent-initial`, final: `${mark}-intent-final`, reason: `${mark}-intent-reason` }, false);
  const b = withIntent({ ...newMeeting("2026-11-09", "m-2"), shared: { talked: `${mark}-shared-2`, decided: "", todo: "" }, fpOnly: { note: `${mark}-fponly-2` } }, { initial: `${mark}-fpintent`, final: "", reason: "" }, true);
  return [a, b];
}
