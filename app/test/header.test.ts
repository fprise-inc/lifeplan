// 上の帯の整理: ふだんは状態の札を出さない・急ぎのものだけ札・行動を求める通知は通知の印にまとめる・
// 文字を大きくしたとき・窓が狭いときに見切れない（詰める段を選ぶ決まりと、実際の画面で測った幅で確かめる）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { APP_DIR } from "../scripts/lib.ts";
import { chooseFit, FIT_MAX } from "../src/workspace/header/fit.ts";
import { BasisLine, HouseholdNow } from "../src/workspace/header/HouseholdNow.tsx";
import { barAlerts, barNotices, saveText, type BarInputs } from "../src/workspace/header/status.ts";
import { NoticeBell, TextSizePick, TopBar } from "../src/workspace/header/TopBar.tsx";

const noop = () => undefined;
const message = (code: string) => `失敗（${code}）`;
const base: BarInputs = { opened: true, stored: true, save: { kind: "saved", at: "2026-10-19T05:03:00.000Z" }, paused: false, aiSharing: false, recoveryDue: null, joined: [], presence: null, message };

describe("上の帯の札（ふだんは出さない）", () => {
  it("保存済み・保存中・待ち・保存していない世帯（見本）・AIを使わない／使うが共有していない: 札は出ない", () => {
    for (const save of [{ kind: "saved", at: "2026-10-19T05:03:00.000Z" }, { kind: "saving" }, { kind: "pending" }, { kind: "idle" }] as const) expect(barAlerts({ ...base, save })).toEqual([]);
    expect(barAlerts({ ...base, stored: false })).toEqual([]);
    expect(barAlerts({ ...base, stored: false, save: { kind: "error", code: "E_STORE_IO" } })).toEqual([]);
  });

  it("保存に失敗した: 目立つ札（err）。詳しい文はかざしたときと世帯の選択のメニューで見る", () => {
    const a = barAlerts({ ...base, save: { kind: "error", code: "E_STORE_IO" } });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ kind: "saveError", tone: "err", text: "保存できませんでした", title: "失敗（E_STORE_IO）" });
    expect(a[0]!.short.length).toBeLessThan(a[0]!.text.length);
  });

  it("閲覧だけで保存しない・ほかの人が開いていて自動保存を止めている: 札（warn）。止めているときは失敗より先に出す", () => {
    expect(barAlerts({ ...base, save: { kind: "error", code: "E_STORE_READ_ONLY" } }).map((a) => [a.kind, a.tone])).toEqual([["readOnly", "warn"]]);
    expect(barAlerts({ ...base, paused: true, save: { kind: "error", code: "E_STORE_IO" } }).map((a) => a.kind)).toEqual(["paused"]);
  });

  it("この世帯をAIと共有中のときだけ、AIの札を出す", () => {
    expect(barAlerts({ ...base, aiSharing: true }).map((a) => [a.kind, a.tone])).toEqual([["aiSharing", "ai"]]);
    expect(barAlerts({ ...base, opened: false, aiSharing: true })).toEqual([]);
  });
});

describe("通知の印にまとめる通知", () => {
  it("ふだんは0件（通知の印も出さない）", () => {
    expect(barNotices(base)).toEqual([]);
    const html = renderToString(h(TopBar, { tabs: [{ id: "a", label: "入力" }], tab: "a", onTab: noop, household: null, alerts: [], notices: [], tools: null, big: false, onBig: noop }));
    expect(html).not.toContain("data-notice-bell");
  });

  it("復元キーの保管・開いている人・復元キーで加わった人を、この順で1か所に", () => {
    const n = barNotices({ ...base, recoveryDue: "office", presence: "担当Bさんが開いています（12分前から）", joined: ["担当N", "担当M"] });
    expect(n.map((x) => x.kind)).toEqual(["recovery", "presence", "joined"]);
    expect(n[0]!.text).toBe("事務所の復元キーを保管してください");
    expect(n[2]!.text).toBe("復元キーで担当Nさん・担当Mさんが加わりました");
    expect(barNotices({ ...base, recoveryDue: "own" })[0]!.text).toBe("復元キーを保管してください");
    // 保存していない世帯では、開いている人の通知は出さない
    expect(barNotices({ ...base, stored: false, presence: "x" })).toEqual([]);
  });

  it("通知の印は件数つき。読み上げの名前にも件数を入れる", () => {
    const html = renderToString(h(NoticeBell, { notices: [{ id: "recovery", text: "復元キーを保管してください", action: "復元キー", onClick: noop }] }));
    expect(html).toContain('data-notice-bell="1"');
    expect(html).toContain('aria-label="通知（1件）"');
  });
});

describe("上の帯の並びと、アイコンだけにしたときの名前", () => {
  const html = renderToString(
    h(TopBar, {
      tabs: [
        { id: "input", label: "入力" },
        { id: "main", label: "結果" },
      ],
      tab: "main",
      onTab: noop,
      household: { no: "D0001", sub: "本人・配偶者・子2人", open: false, onToggle: noop },
      alerts: [{ id: "saveError", text: "保存できませんでした", short: "保存の失敗", title: "詳しい文", tone: "err", onClick: noop }],
      notices: [{ id: "recovery", text: "復元キーを保管してください", action: "復元キー", onClick: noop }],
      tools: h("button", { type: "button", class: "memo-btn", "data-memo-toggle": true }, "メモ"),
      big: true,
      onBig: noop,
    }),
  );

  it("左＝ロゴと世帯の選択と急ぎの札、中＝タブ、右＝メモ・文字の大きさ・通知の印", () => {
    const at = (s: string) => html.indexOf(s);
    expect(at('class="top-l"')).toBeLessThan(at("data-household-button"));
    expect(at("data-household-button")).toBeLessThan(at("data-bar-alert"));
    expect(at("data-bar-alert")).toBeLessThan(at('class="tabs"'));
    expect(at('class="tabs"')).toBeLessThan(at('class="top-r"'));
    expect(at('class="top-r"')).toBeLessThan(at("data-memo-toggle"));
    expect(at("data-memo-toggle")).toBeLessThan(at("data-text-size-pick"));
    expect(at("data-text-size-pick")).toBeLessThan(at("data-notice-bell"));
  });

  it("文字を隠してアイコンだけにしても、ボタンの名前（aria-label）は残る", () => {
    expect(html).toContain('aria-label="文字の大きさ 大"');
    expect(html).toContain('aria-label="保存できませんでした"');
    expect(html).toContain('aria-label="世帯の選択（D0001）"');
  });

  it("上の帯から外したもの: 保存の状態の文・AIを使わない札・鍵の置き場の札・計算の基準日は、帯の部品に無い", () => {
    const src = readFileSync(join(APP_DIR, "src/workspace/header/TopBar.tsx"), "utf-8");
    for (const s of ["保存していません", "AI: 使わない", "鍵はファイル", "時点"]) expect(src).not.toContain(s);
  });
});

describe("文字の大きさ「文字 [中] [大]」", () => {
  const render = (big: boolean) => renderToString(h(TextSizePick, { big, onPick: noop }));
  const opt = (html: string, size: "mid" | "large") => new RegExp(`<button[^>]*data-text-size="${size}"[^>]*>`).exec(html)?.[0] ?? "";

  it("「文字」のラベルと、枠で囲んだ［中］［大］の2つ。radio のグループで、グループの名前は「文字の大きさ」", () => {
    const html = render(false);
    expect(html).toMatch(/role="radiogroup"[^>]*aria-label="文字の大きさ"/);
    expect(html).toContain(">文字</span>");
    expect(html.match(/role="radio"/g)).toHaveLength(2);
    expect(html.indexOf('data-text-size="mid"')).toBeLessThan(html.indexOf('data-text-size="large"'));
  });

  it("選んでいる方だけ aria-checked。Tab で止まるのは選んでいる方（もう一方は矢印キーで選ぶ）", () => {
    for (const [big, on, off] of [[false, "mid", "large"], [true, "large", "mid"]] as const) {
      const html = render(big);
      expect(opt(html, on)).toContain('aria-checked="true"');
      expect(opt(html, on)).toContain('tabindex="0"');
      expect(opt(html, off)).toContain('aria-checked="false"');
      expect(opt(html, off)).toContain('tabindex="-1"');
    }
  });

  it("既定は「中」（アプリを開いたとき）", () => {
    const src = readFileSync(join(APP_DIR, "src/workspace/App.tsx"), "utf-8");
    expect(src).toMatch(/const out: ReturnType<typeof parseHash> = \{ big: false/);
    expect(src).toContain("useState(initial.big)");
  });

  it("CSS: 選んでいる方を塗る。帯を詰める段2以上では「文字」のラベルだけ隠す（［中］［大］は残す）", () => {
    const css = readFileSync(join(APP_DIR, "src/styles/header.css"), "utf-8");
    expect(css).toMatch(/\.fs-opt\[aria-checked="true"\] \{[^}]*background: var\(--prop\)/);
    expect(css).toMatch(/\.top:is\(\[data-fit="2"\], \[data-fit="3"\]\) \.fs-lbl \{ display: none; \}/);
    expect(css).not.toMatch(/\.fs-opt[^{]*\{ display: none/);
  });
});

describe("世帯の選択のメニューの頭と、結果の画面の頭", () => {
  it("保存の状態の文: 保存した世帯は自動で保存している旨と時刻、失敗はその文、止めているときはその旨", () => {
    expect(saveText(false, { kind: "idle" }, message).cls).toBe("unsaved");
    expect(saveText(true, { kind: "saving" }, message).text).toBe("保存しています…");
    expect(saveText(true, { kind: "error", code: "E_STORE_IO" }, message)).toEqual({ text: "失敗（E_STORE_IO）", cls: "err" });
    expect(saveText(true, { kind: "saved", at: "x" }, message).text).toContain("自動で保存しています");
    expect(saveText(true, { kind: "saved", at: "2026-10-19T05:03:00.000Z" }, message).text).toMatch(/\d\d:\d\d に保存/);
    expect(saveText(true, { kind: "saved", at: "2026-10-19T05:03:00.000Z" }, message, true).text).toContain("編集を始めるまで保存しません");
  });

  it("開いている世帯の状態: 年齢・計算の基準・保存・（AIを使う設定のときだけ）AIとの共有と同意の入口", () => {
    const props = { title: "顧客番号 D0001", members: "ご主人 45歳・奥様 43歳", asOf: "2026年10月時点", save: { text: "自動で保存しています", cls: "", state: "saved" } };
    const off = renderToString(h(HouseholdNow, { ...props, ai: null }));
    expect(off).toContain("ご主人 45歳");
    expect(off).toContain("2026年10月時点の計算");
    expect(off).toContain('data-save-state="saved"');
    expect(off).not.toContain("AIとの共有");
    const on = renderToString(h(HouseholdNow, { ...props, ai: { text: "同意があります", sharing: false, onOpen: noop } }));
    expect(on).toContain("AIとの共有");
    expect(on).toContain("data-open-ai-share");
  });

  it("結果の画面の頭に、年齢と基準の月を小さく出す", () => {
    const html = renderToString(h(BasisLine, { members: "ご主人 45歳", asOf: "2026年10月時点" }));
    expect(html).toContain("data-basis");
    expect(html).toContain("2026年10月時点");
  });
});

describe("帯を詰める段（見切れさせない）", () => {
  it("広い順に試して、はみ出さない最初の段を使う。最後の段（折り返し）は試さない", () => {
    const tried: number[] = [];
    expect(
      chooseFit((f) => {
        tried.push(f);
        return f < 2;
      }),
    ).toBe(2);
    expect(tried).toEqual([0, 1, 2]);
    const tried2: number[] = [];
    expect(
      chooseFit((f) => {
        tried2.push(f);
        return true;
      }),
    ).toBe(FIT_MAX);
    expect(tried2).toEqual([0, 1, 2]);
    expect(chooseFit(() => false)).toBe(0);
  });

  // 開発用のサーバーの画面で測った、段ごとに要る帯の幅（px。左右の余白・部品の間を含む）。
  // ふだん: 保存した世帯・通知1件。いちばん多い: 自動保存を止めている札・AIと共有中の札・通知2件
  const measured = {
    ふだん: [1083, 1037, 859],
    ふだん_文字大: [1209, 1157, 956],
    いちばん多い: [1375, 1329, 1042],
    いちばん多い_文字大: [1539, 1487, 1159],
  } as const;
  const widths = [1280, 1366, 1440, 1536, 1600, 1680, 1920, 2000, 2560];

  it.each(Object.entries(measured))("%s: 1280〜2560px のどの幅でも1行に収まる段がある（要る幅 ≦ 窓の幅）", (_name, need) => {
    for (const w of widths) {
      const fit = chooseFit((f) => need[f]! > w);
      expect(fit, `${w}px`).toBeLessThan(FIT_MAX);
      expect(need[fit]!, `${w}px`).toBeLessThanOrEqual(w);
    }
  });

  it("広い窓（1700px 以上）では、文字を大きくしてもすべて文字つき（段0）のまま", () => {
    for (const need of Object.values(measured)) for (const w of [1700, 2000, 2560]) expect(chooseFit((f) => need[f]! > w)).toBe(0);
  });

  it("CSS: 段ごとの決まりがあり、帯を隠して切らない（overflow: hidden を使わない）。最後の段はタブを2行目に折り返す", () => {
    const css = readFileSync(join(APP_DIR, "src/styles/header.css"), "utf-8");
    expect(css).toMatch(/\.top\[data-fit\]:not\(\[data-fit="0"\]\) \.lbl \{ display: none; \}/);
    expect(css).toMatch(/\.top:is\(\[data-fit="2"\], \[data-fit="3"\]\)/);
    expect(css).toMatch(/\.top\[data-fit="3"\] \{[^}]*grid-template-areas: "l r" "t t"/);
    const top = /^\.top \{([^}]*)\}/m.exec(css)?.[1] ?? "";
    expect(top).not.toMatch(/overflow|position: (sticky|fixed)/);
    // 以前の決めどおり、上の帯は画面の上に固定しない
    const app = readFileSync(join(APP_DIR, "src/styles/app.css"), "utf-8");
    expect(app).not.toMatch(/\.top\s*\{[^}]*position:\s*(sticky|fixed)/);
  });
});
