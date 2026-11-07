// 世帯を開けなかったとき（0011 の7）: 開く操作の言葉の文言と、直前の世代で開き直す画面
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { openMessage, storeMessage } from "../src/workspace/store/HouseholdPanel.tsx";
import { PreviousPanel, offersPrevious } from "../src/workspace/store/PreviousPanel.tsx";

describe("開けなかったときの文言", () => {
  it("開く操作の失敗は、開く操作の言葉で出す（「保存の処理に失敗しました」と出さない）", () => {
    for (const c of ["E_STORE_FORMAT_UNKNOWN", "E_STORE_BODY", "E_BODY_SHAPE", "E_STORE_UNKNOWN_HOUSEHOLD", "E_STORE_CORRUPT", "E_STORE_IO", "E_SOMETHING_NEW"]) {
      const m = openMessage(c);
      expect(m, c).not.toContain("保存の処理");
      expect(m, c).toContain("開けません");
    }
    expect(openMessage("E_STORE_FORMAT_UNKNOWN")).toContain("知らない形式の版");
    expect(openMessage("E_STORE_FORMAT_UNKNOWN")).toContain("アプリを更新");
    // 開く操作に限らない符号（復元キー・新しい版）は、ふだんの文言のまま
    expect(openMessage("E_STORE_NEEDS_RECOVERY")).toBe(storeMessage("E_STORE_NEEDS_RECOVERY"));
    expect(openMessage("E_STORE_FORMAT_TOO_NEW")).toBe(storeMessage("E_STORE_FORMAT_TOO_NEW"));
  });

  it("ふだんの文言の既定は「保存の処理」に限らない言葉にし、知らない版・世帯が無いときの文言を持つ", () => {
    expect(storeMessage("E_SOMETHING_NEW")).not.toContain("保存の処理");
    expect(storeMessage("E_SOMETHING_NEW")).toContain("E_SOMETHING_NEW");
    for (const c of ["E_STORE_FORMAT_UNKNOWN", "E_STORE_UNKNOWN_HOUSEHOLD", "E_STORE_BODY", "E_STORE_NO_PREVIOUS"]) expect(storeMessage(c), c).not.toContain(c);
  });
});

describe("直前の世代で開き直す画面", () => {
  it("壊れた・読めないときだけ、直前の世代を探す（鍵・復元キー・新しい版のときは探さない）", () => {
    for (const c of ["E_STORE_CORRUPT", "E_STORE_FORMAT_UNKNOWN", "E_STORE_BODY"]) expect(offersPrevious(c), c).toBe(true);
    for (const c of ["E_BODY_SHAPE", "E_STORE_NEEDS_RECOVERY", "E_STORE_NO_KEY", "E_STORE_FORMAT_TOO_NEW", "E_STORE_IO", "E_OFFICE_UNAVAILABLE"]) expect(offersPrevious(c), c).toBe(false);
  });

  it("戻す前に、どの時点の保存か（日時・何回目の保存か・保存した人）と、壊れたファイルを残すことを見せる", () => {
    const html = renderToString(
      h(PreviousPanel, { customerNo: "A0001", reason: openMessage("E_STORE_CORRUPT"), info: { generation: 12, savedAt: "2026-11-06T05:03:00Z", savedBy: "山田" }, busy: false, error: null, onOpen: () => undefined, onClose: () => undefined }),
    );
    expect(html).toContain("A0001");
    expect(html).toContain("2026/11/06");
    expect(html).toContain("12");
    expect(html).toContain("山田");
    expect(html).toContain("直前の保存で開く");
    expect(html).toContain("別名で残します");
    expect(html).toContain("戻りません");
  });

  it("保存の日時が無い直前の世代も、何回目の保存かで見せる", () => {
    const html = renderToString(h(PreviousPanel, { customerNo: "A0001", reason: "", info: { generation: 3, savedAt: null, savedBy: null }, busy: true, error: "失敗", onOpen: () => undefined, onClose: () => undefined }));
    expect(html).toContain("3回目");
    expect(html).toContain("失敗");
    expect(html).toContain("disabled");
  });
});
