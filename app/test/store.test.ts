// 世帯の保存（0011・0012・0013・0016）: 本文の往復・持たない情報・過去の形式の見本・画面にパスを渡さないこと・自動保存
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_DIR, REPO_DIR } from "../scripts/lib.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { CURRENT } from "../src/workspace/plans/band.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { savePlan } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { Autosaver, type SaveState, type Timers } from "../src/workspace/store/autosave.ts";
import { makeSnapshot, snapshotDigest, verifySnapshot } from "../src/workspace/snapshots/snapshots.ts";
import { BODY_FORMAT_VERSION, bodyObject, bodyOf, EMPTY_CARRY, fromBody, summaryOf, type BodyState } from "../src/workspace/store/body.ts";
import { keyLines } from "../src/workspace/store/RecoveryPanel.tsx";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-10-18T10:00:00.000Z";

function sample(): BodyState {
  // 0.5 から: 資産運用（期間を分けた積立・積立の終わりが空・FP が入れた利回り・取り崩しの計画。0026）の見本の世帯
  const id = "investmentCouple";
  const req = modelHousehold(id);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const demo = demoHousehold(id) ?? null;
  let wh: WorkingHousehold = fromRequest(req, { memo: ["架空のメモ"] });
  wh = { ...wh, labelsByMember: { [self.id]: "ご主人" } };
  const cat = buildCatalog(wh, self.id, demo);
  const a = savePlan(wh, cat, { name: "プランB 生活費を28万円に", base: null, values: { "lever:livingMonthly": 280000 }, now: NOW });
  const b = savePlan(a.wh, cat, { name: "プランC プランB＋70歳まで働く", tags: ["老後"], base: a.id, values: { "lever:livingMonthly": 280000, "lever:retireAge": 70 }, now: NOW });
  return {
    wh: b.wh,
    workspace: { template: id, band: [a.id, b.id], base: CURRENT, selected: b.id, shownItems: ["rates:shift"] },
    display: { ...DEFAULT_DISPLAY_SETTINGS, metrics: ["takeHome"], atAge: 90, layout: "side", invBreakdown: true },
    carry: { extDefinitions: { "ext.exampleOffice.carCount": { type: "integer", label: "車の台数" } }, ext: { "ext.exampleOffice.carCount": 2 } },
  };
}

/** 見本の控え（固定の ID・日時。PDF を書き出した時点） */
async function withSnapshot(s: BodyState): Promise<BodyState> {
  const snap = await makeSnapshot({
    wh: s.wh,
    drafts: {},
    draft: { trigger: "pdf", memo: "提案書（16ページ）", plan: { id: s.workspace.selected, letter: "C", name: "プランB＋70歳まで働く" } },
    appVersion: "0.1.0",
    now: new Date(Date.UTC(2026, 9, 19, 5, 0, 0)),
    id: "00000000-0000-4000-8000-0000000000c1",
  });
  // 作った日時は端末の時差によらない固定の値にして、指紋を作り直す
  const fixed = { ...snap, createdAt: "2026-10-19T14:00:00+09:00" };
  return { ...s, wh: { ...s.wh, snapshots: [{ ...fixed, digest: await snapshotDigest(fixed) }] } };
}

function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (typeof v === "object" && v !== null)
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  return out;
}

describe("世帯ファイルの本文（0011 の2）", () => {
  it("保存→読み込みで同じ（現状・案・帯の並び・表示の設定・拡張領域）", () => {
    const s = sample();
    const back = fromBody(bodyOf(s));
    expect(back.wh).toEqual(s.wh);
    expect(back.workspace).toEqual(s.workspace);
    expect(back.display).toEqual(s.display);
    expect(back.carry).toEqual(s.carry);
    // 本体が足す meta があっても読める
    const withMeta = JSON.stringify({ ...JSON.parse(bodyOf(s)), meta: { format: "lifeplan.household", formatVersion: BODY_FORMAT_VERSION, customerNo: "A0001" } });
    expect(fromBody(withMeta).wh).toEqual(s.wh);
  });

  it("控え（0.3 から）: 区画 snapshots に置いて読み戻す。household の区画には入れない。控えが無ければ区画を作らない", async () => {
    const s = await withSnapshot(sample());
    const text = bodyOf(s);
    const b = JSON.parse(text) as { snapshots?: unknown[]; household: Record<string, unknown> };
    expect(b.snapshots).toHaveLength(1);
    expect(b.household.snapshots).toBeUndefined();
    const back = fromBody(text);
    expect(back.wh).toEqual(s.wh);
    expect(await verifySnapshot(back.wh.snapshots![0]!)).toBe(true);
    expect(JSON.parse(bodyOf(sample())).snapshots).toBeUndefined();
  });

  it("案の数に上限は無い", () => {
    const s = sample();
    const self = roles(s.wh.request).find((r) => r.key === "self")!.member;
    const cat = buildCatalog(s.wh, self.id, null);
    let wh = s.wh;
    for (let i = 0; i < 60; i++) wh = savePlan(wh, cat, { name: `案${i}`, base: null, values: { "lever:livingMonthly": 200000 + i * 1000 }, now: NOW }).wh;
    expect(fromBody(bodyOf({ ...s, wh })).wh.proposals).toHaveLength(62);
  });

  it("持たない情報の項目名が無い（0012 の3: name・kana・address・phone・番号類）", () => {
    const keys = keysOf(bodyObject(sample()));
    const bad = keys.filter((k) => /name|kana|address|phone|mynumber|pensionnumber|accountnumber|氏名|住所|電話|口座番号/i.test(k));
    expect(bad).toEqual([]);
  });

  it("保存しないもの: 提案書の宛名・保存していない案の変更は本文に入らない", () => {
    const text = bodyOf(sample());
    expect(text).not.toContain("addressee");
    expect(text).not.toContain("drafts");
  });

  it("一覧の構成の要約は続柄と人数だけ", () => {
    expect(summaryOf(sample().wh.request)).toBe("本人・配偶者・子2人");
  });

  it("形の合わない本文は読まない", () => {
    expect(() => fromBody("[]")).toThrow("E_BODY_SHAPE");
    expect(() => fromBody('{"household":{}}')).toThrow("E_BODY_SHAPE");
    // 足りない区画は既定で補う
    const s = fromBody(JSON.stringify({ household: { request: sample().wh.request } }));
    expect(s.wh.proposals).toEqual([]);
    expect(s.workspace.selected).toBe(CURRENT);
    expect(s.carry).toEqual(EMPTY_CARRY);
    // 表示の設定の知らない値は既定に戻す（グラフの比べ方を含む）
    const d = fromBody(JSON.stringify({ household: { request: sample().wh.request }, display: { metrics: ["x", "takeHome"], atAge: "9", layout: "diagonal" } })).display;
    expect(d).toEqual({ ...DEFAULT_DISPLAY_SETTINGS, metrics: ["takeHome"] });
  });

  it("過去のすべての形式の版の見本を、今の画面で読める（0011 の5）", async () => {
    const base = join(REPO_DIR, "crates", "household-store", "tests", "fixtures", "household-format");
    const versions = readdirSync(base).filter((v) => /^\d+\.\d+$/.test(v));
    expect(versions).toContain(BODY_FORMAT_VERSION);
    const newest = [...versions].sort((x, y) => x.split(".").map(Number).reduce((acc, n, i) => acc || n - Number(y.split(".")[i]), 0)).at(-1);
    expect(BODY_FORMAT_VERSION, "画面の形式の版は、いちばん新しい見本の版").toBe(newest);
    for (const v of versions) {
      const body = readFileSync(join(base, v, "body.json"), "utf8");
      const s = fromBody(body);
      expect(s.wh.request.input.household.members.length).toBeGreaterThan(0);
      expect(s.wh.proposals.length).toBeGreaterThan(0);
      // 読んで書き戻しても、拡張領域を失わない
      const again = JSON.parse(bodyOf(s)) as Record<string, unknown>;
      // 0.2 から: メモの行ごとの書いた人（0023 の6）も、読んで書き戻して失わない
      const memoBy = (JSON.parse(body) as { household: { memoBy?: unknown } }).household.memoBy;
      if (memoBy !== undefined) expect((again.household as { memoBy?: unknown }).memoBy).toEqual(memoBy);
      const orig = JSON.parse(body) as Record<string, unknown>;
      expect(again.ext).toEqual(orig.ext);
      // 0.3 から: 控えも、読んで書き戻して失わない（中身は変えない。指紋が合う）
      if (orig.snapshots !== undefined) {
        expect(again.snapshots).toEqual(orig.snapshots);
        for (const x of s.wh.snapshots ?? []) expect(await verifySnapshot(x), `${v} の控えの指紋`).toBe(true);
      }
      expect(again.extDefinitions).toEqual(orig.extDefinitions);
    }
  });

  // 見本の本文を作り直す（手で流す: WRITE_HOUSEHOLD_FIXTURE_SOURCE=<出力先> npx vitest run test/store.test.ts）。
  // 暗号化した見本は crates/household-store の regenerate_fixture（--ignored）で作る
  it.runIf(process.env.WRITE_HOUSEHOLD_FIXTURE_SOURCE !== undefined)("見本の本文を書き出す", async () => {
    writeFileSync(process.env.WRITE_HOUSEHOLD_FIXTURE_SOURCE as string, JSON.stringify(bodyObject(await withSnapshot(sample())), null, 2) + "\n");
  });
});

describe("画面にファイルの道（パス）を渡さない（0016 の1）", () => {
  const tauri = join(APP_DIR, "src-tauri");
  it("画面に与える権限は、アプリが定義した命令だけ（プラグインの権限・ファイル・ダイアログは無い）", () => {
    const cap = JSON.parse(readFileSync(join(tauri, "capabilities", "main.json"), "utf8")) as { permissions: string[] };
    const build = readFileSync(join(tauri, "build.rs"), "utf8");
    const commands = [...build.slice(build.indexOf("const COMMANDS"), build.indexOf("];")).matchAll(/"([a-z_]+)"/g)].map((m) => m[1] as string);
    expect(commands).toContain("store_save");
    expect(cap.permissions.sort()).toEqual(commands.map((c) => `allow-${c.replace(/_/g, "-")}`).sort());
    const cargo = readFileSync(join(tauri, "Cargo.toml"), "utf8");
    expect(cargo).not.toMatch(/tauri-plugin-/);
    const pkg = JSON.parse(readFileSync(join(APP_DIR, "package.json"), "utf8")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((k) => k.startsWith("@tauri-apps/plugin-"))).toEqual([]);
  });

  it("保存・事務所の共有の命令に渡すのは、内部ID・本文・要約・顧客番号・確認・復元キー・分岐の選び方・表示名・申請と指紋だけ", () => {
    const host = readFileSync(join(APP_DIR, "src", "engine", "host.ts"), "utf8");
    const calls = [...host.matchAll(/invoke<[^>]*>\("((?:store|recovery_key|app|office)_[a-z_]+)"(?:, \{ ([^}]*) \})?\)/g)];
    expect(calls.length).toBeGreaterThanOrEqual(23);
    // 0023: 共有フォルダは本体のダイアログで選ばせるので、パス・フォルダの引数は無い
    const allowed = new Set(["id", "body", "summary", "customerNo", "confirm", "key", "keepOurs", "adopt", "name", "request: requestId", "fingerprint", "member: memberId"]);
    for (const c of calls) {
      const args = (c[2] ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "");
      for (const a of args) expect(allowed.has(a), `${c[1]} の引数 ${a}`).toBe(true);
    }
  });

  it("画面の側のコードは、ファイルの道を組み立てない（世帯ファイルの拡張子・データフォルダの名前を持たない）", () => {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d, { withFileTypes: true })) {
        if (f.isDirectory()) walk(join(d, f.name));
        else if (/\.(ts|tsx)$/.test(f.name)) files.push(join(d, f.name));
      }
    };
    walk(join(APP_DIR, "src"));
    for (const f of files) {
      const t = readFileSync(f, "utf8");
      expect(t, f).not.toMatch(/\.lphf|\.lpkv|\.lpod|data-dev/);
    }
    expect(existsSync(join(APP_DIR, "src", "workspace", "store", "body.ts"))).toBe(true);
  });
});

describe("自動保存", () => {
  function fakeTimers() {
    const q: { fn: () => void; ms: number; live: boolean }[] = [];
    const t: Timers = {
      set: (fn, ms) => {
        q.push({ fn, ms, live: true });
        return q.length - 1;
      },
      clear: (h) => {
        const x = q[h as number];
        if (x !== undefined) x.live = false;
      },
    };
    const fire = () => {
      for (const x of q.splice(0)) if (x.live) x.fn();
    };
    return { t, q, fire };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("変更から待って、最後の本文だけを保存する。同じ本文は保存しない", async () => {
    const saved: string[] = [];
    const states: SaveState[] = [];
    const { t, fire } = fakeTimers();
    const a = new Autosaver(async (b) => (saved.push(b), NOW), (s) => states.push(s), 1500, t);
    a.reset("A");
    a.change("A");
    fire();
    await tick();
    expect(saved).toEqual([]);
    a.change("B");
    a.change("C");
    expect(a.dirty).toBe(true);
    fire();
    await tick();
    expect(saved).toEqual(["C"]);
    expect(states.at(-1)).toEqual({ kind: "saved", at: NOW });
    expect(a.dirty).toBe(false);
  });

  it("flush は待たずに保存する。保存していない世帯（見本）では何もしない", async () => {
    const saved: string[] = [];
    const { t } = fakeTimers();
    const a = new Autosaver(async (b) => (saved.push(b), NOW), () => undefined, 1500, t);
    a.reset(null);
    a.change("X");
    await a.flush();
    expect(saved).toEqual([]);
    a.reset("A");
    a.change("B");
    await a.flush();
    expect(saved).toEqual(["B"]);
  });

  it("分岐が見つかったら自動保存を止める（上書きを続けない）", async () => {
    let n = 0;
    const states: SaveState[] = [];
    const { t, fire } = fakeTimers();
    const a = new Autosaver(async () => (n++, Promise.reject("E_STORE_CONFLICT")), (s) => states.push(s), 1500, t);
    a.reset("A");
    a.change("B");
    fire();
    await tick();
    a.change("C");
    fire();
    await a.flush();
    expect(n).toBe(1);
    expect(states.at(-1)).toEqual({ kind: "error", code: "E_STORE_CONFLICT" });
  });

  it("保存中に変わったら、終わってからもう一度保存する", async () => {
    const saved: string[] = [];
    let release: () => void = () => undefined;
    const { t, fire } = fakeTimers();
    const a = new Autosaver(
      (b) =>
        new Promise<string>((ok) => {
          release = () => (saved.push(b), ok(NOW));
        }),
      () => undefined,
      1500,
      t,
    );
    a.reset("A");
    a.change("B");
    fire();
    await tick();
    a.change("C");
    release();
    await tick();
    await tick();
    fire();
    await tick();
    release();
    await tick();
    expect(saved).toEqual(["B", "C"]);
  });
});

describe("復元キーの表示", () => {
  it("5組ずつ3行に分ける", () => {
    const key = Array.from({ length: 15 }, (_, i) => `A${String(i).padStart(3, "0")}`).join("-");
    const lines = keyLines(key);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("A000-A001-A002-A003-A004");
  });
});
