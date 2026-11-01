// 自動保存に失敗したまま世帯を切り替える・アプリを閉じるとき: 黙って捨てず、保存し直す・捨てる・やめるを選ばせる
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { Autosaver, saveBeforeLeave, type LeaveChoice } from "../src/workspace/store/autosave.ts";
import { LeaveDialog } from "../src/workspace/store/LeaveDialog.tsx";

const NOW = "2026-10-31T10:00:00.000Z";
const noTimers = { set: () => 0, clear: () => undefined };

/** 失敗する保存（fail が true の間） */
function saver() {
  const saved: string[] = [];
  const s = { fail: "E_STORE_IO" as string | null, saved };
  const a = new Autosaver(async (b) => {
    if (s.fail !== null) throw s.fail;
    saved.push(b);
    return NOW;
  }, () => undefined, 1500, noTimers);
  return { a, s };
}

describe("保存できていない変更が分かる", () => {
  it("保存に失敗した後も、保存できていない変更があると分かる（直らない失敗で自動保存を止めたときも）", async () => {
    for (const code of ["E_STORE_IO", "E_STORE_NO_KEY"]) {
      const { a, s } = saver();
      s.fail = code;
      a.reset("A");
      a.change("B");
      await a.flush();
      expect(a.unsaved, code).toBe(true);
      expect(a.failure, code).toBe(code);
    }
  });
  it("保存できたら、保存できていない変更は無い。見本（保存しない世帯）でも無い", async () => {
    const { a, s } = saver();
    s.fail = null;
    a.reset("A");
    a.change("B");
    await a.flush();
    expect(a.unsaved).toBe(false);
    expect(a.failure).toBeNull();
    a.reset(null);
    a.change("C");
    expect(a.unsaved).toBe(false);
  });
});

describe("世帯を離れる前の保存", () => {
  it("保存できたら、聞かずに離れる", async () => {
    const { a, s } = saver();
    s.fail = null;
    a.reset("A");
    a.change("B");
    const asked: string[] = [];
    expect(await saveBeforeLeave(a, async (c) => (asked.push(c), "cancel"))).toBe(true);
    expect(asked).toEqual([]);
    expect(s.saved).toEqual(["B"]);
  });

  it("保存できないときは理由を添えて聞く。やめるなら離れず、変更は残る", async () => {
    const { a } = saver();
    a.reset("A");
    a.change("B");
    const asked: string[] = [];
    expect(await saveBeforeLeave(a, async (c) => (asked.push(c), "cancel"))).toBe(false);
    expect(asked).toEqual(["E_STORE_IO"]);
    expect(a.unsaved).toBe(true);
  });

  it("保存し直して保存できたら離れる（止めた失敗の後でも、今の本文を保存する）", async () => {
    const { a, s } = saver();
    s.fail = "E_STORE_NO_KEY";
    a.reset("A");
    a.change("B");
    const answers: LeaveChoice[] = ["retry", "retry"];
    let n = 0;
    const ok = await saveBeforeLeave(
      a,
      async () => {
        n += 1;
        // 2回目に聞かれる前に、保存できるようになる
        if (n === 2) s.fail = null;
        return answers.shift() ?? "cancel";
      },
      () => "C",
    );
    expect(ok).toBe(true);
    expect(n).toBe(2);
    expect(s.saved).toEqual(["C"]);
    expect(a.unsaved).toBe(false);
  });

  it("捨てるを選んだら離れる", async () => {
    const { a } = saver();
    a.reset("A");
    a.change("B");
    expect(await saveBeforeLeave(a, async () => "discard")).toBe(true);
  });

  it("開いていない（自動保存が無い）ときは、そのまま離れる", async () => {
    expect(await saveBeforeLeave(null, async () => "cancel")).toBe(true);
  });
});

describe("離れる前の確かめの画面", () => {
  const render = (code: string, action: "switch" | "close", error: string | null = null) =>
    renderToString(h(LeaveDialog, { customerNo: "C0001", code, action, busy: false, error, message: (c: string) => `理由:${c}`, onChoose: () => undefined }));
  it("保存し直す・捨てる・やめるを出し、理由と、何が無くなるかを書く", () => {
    const html = render("E_STORE_IO", "switch");
    expect(html).toContain("世帯 C0001");
    expect(html).toContain("理由:E_STORE_IO");
    expect(html).toContain('data-choice="retry"');
    expect(html).toContain('data-choice="discard"');
    expect(html).toContain('data-choice="cancel"');
    expect(html).toContain("変更を捨てて切り替える");
    expect(render("E_STORE_IO", "close")).toContain("変更を捨てて閉じる");
  });
  it("分岐（ほかで先に保存されていた）のときは、保存し直す代わりに分岐を選ぶ画面へ", () => {
    const html = render("E_STORE_CONFLICT", "switch");
    expect(html).toContain('data-choice="fork"');
    expect(html).not.toContain('data-choice="retry"');
  });
  it("保存し直しても保存できなかったときは、そのことを書く", () => {
    expect(render("E_STORE_IO", "switch", "もう一度保存しましたが、保存できませんでした")).toContain("もう一度保存しましたが、保存できませんでした");
  });
});
