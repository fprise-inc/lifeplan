// 上の帯の整理: ふだんは状態の札を出さない・急ぎのものだけ札・行動を求める通知は通知の印にまとめる・
// 文字を大きくしたとき・窓が狭いときに見切れない（詰める段を選ぶ決まりと、実際の画面で測った幅で確かめる）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { APP_DIR } from "../scripts/lib.ts";
import { chooseFit, FIT_MAX } from "../src/workspace/header/fit.ts";
import { DROP_MAX_W, dropPlace, HouseholdDrop } from "../src/workspace/header/HouseholdDrop.tsx";
import { BasisLine, HouseholdNow } from "../src/workspace/header/HouseholdNow.tsx";
import type { StorageNotice } from "../src/engine/host.ts";
import { barAlerts, barNotices, noticeTarget, saveText, type BarInputs } from "../src/workspace/header/status.ts";
import { storageNoticeText } from "../src/workspace/store/storage.ts";
import { NoticeBell, TextSizePick, TopBar } from "../src/workspace/header/TopBar.tsx";

const noop = () => undefined;
const message = (code: string) => `失敗（${code}）`;
const base: BarInputs = { opened: true, stored: true, save: { kind: "saved", at: "2026-10-19T05:03:00.000Z" }, paused: false, aiSharing: false, storage: [], showing: { recovery: false, office: false, storage: false }, presence: null, message };

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

  const sn = (kind: string, scope: StorageNotice["scope"], extra: Partial<StorageNotice> = {}): StorageNotice => ({ kind, level: "warn", scope, count: null, name: null, at: null, code: null, ...extra });

  it("本体の保存先と同期の通知（文は storageNoticeText と同じ）と、開いている人を1か所に", () => {
    const storage = [sn("recoveryNotKept", "office"), sn("recoveryJoin", "office", { name: "担当N" }), sn("syncCopies", "office", { count: 2 })];
    const n = barNotices({ ...base, storage, presence: "担当Bさんが開いています（12分前から）" });
    expect(n.map((x) => x.target)).toEqual(["recovery", "office", "households", "presence"]);
    expect(n.map((x) => x.text)).toEqual([...storage.map(storageNoticeText), "担当Bさんが開いています（12分前から）"]);
    expect(n[1]!.text).toBe("復元キーで担当Nさんが加わりました");
    // 保存していない世帯では、開いている人の通知は出さない
    expect(barNotices({ ...base, stored: false, presence: "x" })).toEqual([]);
  });

  it("1人で2台の PC の同期フォルダ: 加わった PC は「さん」を付けず PC の呼び名で。押すと保存先の画面", () => {
    const n = barNotices({ ...base, storage: [sn("recoveryJoin", "personal", { name: "自宅のノート" }), sn("localHouseholds", "personal", { count: 3 })] });
    expect(n[0]!.text).toContain("「自宅のノート」");
    expect(n[0]!.text).not.toContain("さん");
    expect(n.map((x) => [x.target, x.action])).toEqual([
      ["storage", "保存先"],
      ["storage", "保存先"],
    ]);
  });

  it("押す先: 鍵が無い＝復元キーを入れる・事務所の共有の通知＝事務所の共有。その画面を開いている間は、その画面の通知を出さない", () => {
    expect(noticeTarget(sn("needsRecovery", "local"))).toBe("restore");
    expect(noticeTarget(sn("pending", "office"))).toBe("office");
    expect(noticeTarget(sn("unavailable", "personal"))).toBe("storage");
    const storage = [sn("recoveryNotKept", "local"), sn("joinRequest", "office", { count: 1 }), sn("removed", "personal")];
    expect(barNotices({ ...base, storage }).length).toBe(3);
    expect(barNotices({ ...base, storage, showing: { recovery: true, office: true, storage: true } })).toEqual([]);
    expect(barNotices({ ...base, storage, showing: { recovery: false, office: true, storage: false } }).map((x) => x.target)).toEqual(["recovery", "storage"]);
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

  it("CSS: 最後の段では、左の列は世帯のボタンの最小の幅を取り、右の操作は残りの幅で折り返す（幅375pxで世帯のボタンが ↶↷ に重ならない）", () => {
    const css = readFileSync(join(APP_DIR, "src/styles/header.css"), "utf-8");
    // 右を max-content のまま取ると、左の列が世帯のボタンの min-width より狭くなり、ボタンが列からはみ出す
    expect(css).toMatch(/\.top\[data-fit="3"\] \{[^}]*grid-template-columns: minmax\(min-content, 1fr\) minmax\(0, max-content\)/);
    // 世帯のボタンの中身の長さ（見本の名前など）で左の列を広げない
    expect(css).toMatch(/\.top\[data-fit="3"\] \.hh-btn \{[^}]*contain: inline-size/);
    expect(css).toMatch(/\.top\[data-fit="3"\] \.top-r \{[^}]*flex-wrap: wrap/);
  });
});

describe("世帯の選択の出方（箱のすぐ下から一覧が下へ伸びる）", () => {
  const box = { left: 140, bottom: 48, width: 300 };
  it("左の端は箱の左にそろえ、上は箱の下（三角の分だけ下）。三角は箱のまん中を指す。高さは窓の下の端まで", () => {
    const pl = dropPlace(box, 1440, 900);
    expect(pl.left).toBe(140);
    expect(pl.top).toBe(60);
    expect(pl.width).toBe(DROP_MAX_W);
    expect(pl.arrow).toBe(150);
    expect(pl.maxHeight).toBe(900 - 60 - 12);
  });
  it("窓の外に出ない（右の端で寄せる）。狭い窓は両端 8px で窓いっぱい。三角は一覧の中に収める", () => {
    const pl = dropPlace({ left: 600, bottom: 48, width: 300 }, 1200, 800);
    expect(pl.left + pl.width).toBe(1200 - 16);
    expect(pl.arrow).toBe(600 + 150 - pl.left);
    const nar = dropPlace({ left: 40, bottom: 96, width: 200 }, 375, 700);
    expect(nar).toMatchObject({ left: 8, width: 375 - 16, top: 108 });
    const far = dropPlace({ left: 0, bottom: 40, width: 10 }, 1440, 900);
    expect(far.arrow).toBe(18);
    // 文字「大」では一覧の幅も広げる（窓に収まる分まで）
    expect(dropPlace(box, 1600, 900, 1.25).width).toBe(1350);
    // 低い窓でも最低の高さは残す（一覧の中で縦に送る）
    expect(dropPlace(box, 1440, 120).maxHeight).toBe(160);
  });
  it("開いているとき: 後ろを薄く暗くする幕と、見出しで名前を付けた一覧（dialog）。閉じているときは何も描かない", () => {
    const html = renderToString(h(HouseholdDrop, { open: true, onClose: noop }, h("p", null, "中身")));
    expect(html).toContain("data-household-scrim");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-labelledby="hh-title"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('data-household-drop="open"');
    expect(html).toContain('class="hh-drop-in"');
    expect(html).toContain("中身");
    expect(html.indexOf("data-household-scrim")).toBeLessThan(html.indexOf('role="dialog"'));
    expect(renderToString(h(HouseholdDrop, { open: false, onClose: noop }, h("p", null, "中身")))).toBe("");
  });
  it("箱の ▼ は開いている間 ▲。押すと一覧（dialog）が開くことを読み上げで伝える", () => {
    const bar = (open: boolean) => renderToString(h(TopBar, { tabs: [{ id: "main", label: "結果" }], tab: "main", onTab: noop, household: { no: "D0001", sub: "", open, onToggle: noop }, alerts: [], notices: [], tools: null, big: false, onBig: noop }));
    const btn = (html: string) => html.slice(html.indexOf("data-household-button"), html.indexOf("</button>", html.indexOf("data-household-button")));
    expect(btn(bar(false))).toContain("▼");
    expect(btn(bar(false))).not.toContain("▲");
    expect(btn(bar(true))).toContain("▲");
    expect(bar(true)).toContain('aria-expanded="true"');
    expect(bar(true)).toContain('aria-haspopup="dialog"');
  });
  it("出るとき・閉じるときの動きは短く（150〜200ms）、OS の「視差効果を減らす」のときは動かさない", () => {
    const css = readFileSync(join(APP_DIR, "src/styles/header.css"), "utf-8");
    const motion = css.slice(css.indexOf("@media (prefers-reduced-motion: no-preference)"));
    const block = motion.slice(0, motion.indexOf("}\n}") + 3);
    expect(block).toContain(".hh-drop { animation: hh-drop-in 0.18s");
    expect(block).toContain(".hh-drop.is-out { animation: hh-drop-out 0.15s");
    // 動きの指定は「視差効果を減らす」でないときの中だけ
    expect(css.replace(block, "")).not.toMatch(/\.hh-(drop|scrim)[^{]*\{[^}]*animation/);
    // 一覧の中だけ縦に送る（後ろの画面へスクロールをつなげない）
    expect(css).toMatch(/\.hh-drop-in \{[^}]*overflow-y: auto[^}]*overscroll-behavior: contain/);
  });
});
