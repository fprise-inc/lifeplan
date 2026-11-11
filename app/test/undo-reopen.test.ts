// 開き直したときの元に戻すの履歴: 中身が前に開いていたときと同じなら続きから。違えば空から始め、そのことを知らせる
import { describe, expect, it } from "vitest";
import { DEMO_HOUSEHOLDS } from "../src/workspace/catalog.ts";
import { fromRequest, sampleRequest, withElementIds, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { roles } from "../src/workspace/roles.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { bodyOf, EMPTY_CARRY, fromBody, type BodyState } from "../src/workspace/store/body.ts";
import { HistoryBook, UndoHistory } from "../src/workspace/undo/history.ts";
import { reopenHistory, sameBodyContent } from "../src/workspace/undo/reopen.ts";
import { modelHousehold } from "./helpers.ts";

/** 画面が開いた世帯に当てる整え（App.tsx の openedFrom と同じ: 住宅ローン控除の仮の条件・新しい要素の ID） */
function screen(wh0: WorkingHousehold): WorkingHousehold {
  const wh1 = withProvisionalHousing(wh0);
  const request = withElementIds(wh1.request, true);
  return request === wh1.request ? wh1 : { ...wh1, request };
}
const state = (wh: WorkingHousehold, template: string): BodyState => ({ wh, workspace: { template, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }, carry: EMPTY_CARRY });
/** 本体が保存して開き直したときの本文（本体は JSON を読み直して書くので、欄の並びが名前の順になる。meta を足す） */
function viaHost(body: string): string {
  const sort = (v: unknown): unknown => (Array.isArray(v) ? v.map(sort) : v !== null && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v);
  return JSON.stringify(sort({ ...(JSON.parse(body) as object), meta: { customerNo: "0001", formatVersion: "0.38" } }));
}
/** 画面が開いた本文から作る「読んだ本文」（App.tsx の loadStored と同じ道） */
function loadedFrom(body: string): string {
  const st = fromBody(body);
  return bodyOf({ ...st, wh: screen(st.wh) });
}

describe("開き直したときに、元に戻すの履歴を続けてよいか", () => {
  const d = DEMO_HOUSEHOLDS[0]!;
  const wh = screen(fromRequest(sampleRequest(modelHousehold(d.id))));
  const saved = bodyOf(state(wh, d.id));

  it("見本から作った世帯を保存して開き直す: 本体が欄の並びを変えても、中身が同じなら続ける", () => {
    const loaded = loadedFrom(viaHost(saved));
    // 文字列としては違う（前はこれで比較していたので、履歴が空になっていた）
    expect(loaded === saved).toBe(false);
    expect(sameBodyContent(saved, loaded)).toBe(true);
    expect(reopenHistory(saved, loaded)).toBe("continue");
  });

  it("入力を足して保存した後に開き直す（足した欄が並びの後ろにある）: 続ける", () => {
    const self = roles(wh.request).find((r) => r.key === "self")!.member.id;
    const edited: WorkingHousehold = { ...wh, memo: [...wh.memo, "面談で確認"], labelsByMember: { ...wh.labelsByMember, [self]: "本人" } };
    const body = bodyOf(state(edited, d.id));
    expect(reopenHistory(body, loadedFrom(viaHost(body)))).toBe("continue");
  });

  it("中身が違えば（ほかの PC で直された・保存できなかった変更を捨てた）空から", () => {
    const other = bodyOf(state({ ...wh, memo: [...wh.memo, "ほかの PC で足したメモ"] }, d.id));
    expect(sameBodyContent(saved, other)).toBe(false);
    expect(reopenHistory(saved, loadedFrom(viaHost(other)))).toBe("reset");
  });

  it("この画面でまだ開いていない世帯は空から（知らせる履歴も無い）", () => {
    expect(reopenHistory(undefined, saved)).toBe("reset");
  });

  it("読めない本文どうしは同じとしない", () => {
    expect(sameBodyContent("{", saved)).toBe(false);
  });
});

describe("世帯ごとの履歴: 開き直して空にしたとき、捨てた履歴があったか", () => {
  it("戻せる・やり直せる履歴があったときだけ true", () => {
    const book = new HistoryBook<number>(() => new UndoHistory<number>({ same: (a, b) => a === b }));
    expect(book.has("A")).toBe(false);
    book.select("A").record(0, 1, { label: "A1" });
    expect(book.has("A")).toBe(true);
    book.current?.undo();
    expect(book.has("A")).toBe(true);
    book.reset("A");
    expect(book.has("A")).toBe(false);
  });
});

describe("世帯ごとの履歴: 開いている世帯を新しい世帯として保存したとき", () => {
  it("いまの履歴を新しい世帯の名前で持ち直す（見本の名前には残さない）", () => {
    const book = new HistoryBook<number>(() => new UndoHistory<number>({ same: (a, b) => a === b }));
    book.select("sample").record(0, 1, { label: "見本で動かした" });
    book.rename("stored:x");
    expect(book.id).toBe("stored:x");
    book.current?.record(1, 2, { label: "保存した後に動かした" });
    book.select("other");
    book.select("stored:x");
    expect(book.current?.undo()?.label).toBe("保存した後に動かした");
    expect(book.current?.undo()?.label).toBe("見本で動かした");
    expect(book.has("sample")).toBe(false);
  });
});
