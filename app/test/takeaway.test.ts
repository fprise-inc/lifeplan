// 持ち帰り用のレポート（0030）: 中身に内部情報が入らないこと・パスワードありで平文の数字が残らないこと・外への通信の口が無いこと・
// 計算エンジンが画面側のものと同じこと・つまみの当て方がアプリと同じこと
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BLOCK, fromBase64, gunzip, open, readHeader, seal, sha256Hex, WrongPassword } from "../src/takeaway/container.ts";
import { applyTry, leverValues } from "../src/takeaway/levers.ts";
import type { TakeawayData } from "../src/takeaway/model.ts";
import { applyLevers } from "../src/workspace/levers.ts";
import { CURRENT } from "../src/workspace/plans/band.ts";
import { applyValues } from "../src/workspace/plans/plans.ts";
import { buildPayload, cleanText, dataSetLabel, probeRequests } from "../src/workspace/takeaway/build.ts";
import { makeTakeawayFile } from "../src/workspace/takeaway/file.ts";
import { choosePacks } from "../src/workspace/takeaway/packs.ts";
import { FREE_TEXT, IdMap, sanitizeRequest, SCHOOL_PLACEHOLDER } from "../src/workspace/takeaway/sanitize.ts";
import { ENGINE_DIST, REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview, realEngine } from "./helpers.ts";
import { assets, choiceFor, MARK, openHousehold, payloadFor } from "./takeawayFixture.ts";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** HTML から塊を取り出す */
function block(html: string, id: string): string {
  const m = new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`).exec(html);
  if (m === null) throw new Error(`no block ${id}`);
  return m[1] as string;
}

async function dataOf(html: string, password: string | null): Promise<TakeawayData> {
  return JSON.parse(await open(readHeader(block(html, BLOCK.header)), block(html, BLOCK.data), password)) as TakeawayData;
}

async function file(id: string, password: string | null, over = {}) {
  const { o, payload } = payloadFor(id, over, { marks: true });
  const { engine, packs } = realEngine();
  const f = await makeTakeawayFile({ payload, engine, packsJson: packs, password, assets: assets() });
  return { o, payload, f, html: new TextDecoder().decode(f.bytes) };
}

describe("持ち帰り用のレポート: 見本のファイル", () => {
  it("書き出す（TAKEAWAY_SAMPLE_DIR があればそこへ）", async () => {
    const dir = process.env.TAKEAWAY_SAMPLE_DIR;
    const plain = await file("salariedCoupleTwoKids", null, { addressee: "見本 太郎", office: "見本FP事務所" });
    const locked = await file("salariedCoupleTwoKids", "mihon-pass-2026", { addressee: "見本 太郎", office: "見本FP事務所" });
    expect(plain.f.sizes.total).toBeLessThan(3 * 1024 * 1024);
    if (dir !== undefined && dir !== "") {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "見本_パスワードなし.html"), plain.f.bytes);
      writeFileSync(join(dir, "見本_パスワードあり.html"), locked.f.bytes);
      writeFileSync(join(dir, "sizes.json"), JSON.stringify({ plain: plain.f.sizes, locked: locked.f.sizes, packs: plain.f.packs }, null, 2));
    }
  });
});

/** 自由記述の欄（スキーマの文字の欄のうち、選べる値・書式・パターンの決まっていないもの）を探す */
function freeTextPaths(): string[] {
  const out: string[] = [];
  const walk = (n: unknown, path: string) => {
    if (Array.isArray(n)) return n.forEach((x, i) => walk(x, `${path}/${i}`));
    if (typeof n !== "object" || n === null) return;
    const o = n as Record<string, unknown>;
    const t = o.type;
    const isString = t === "string" || (Array.isArray(t) && t.includes("string"));
    if (isString && o.enum === undefined && o.pattern === undefined && o.const === undefined && o.format === undefined && o.$ref === undefined) out.push(path);
    for (const [k, v] of Object.entries(o)) walk(v, `${path}/${k}`);
  };
  for (const [name, file] of [["engine.input", "engine.input.json"], ["common", "common.json"], ["engine.request", "engine.request.json"]] as const) {
    const before = out.length;
    walk(JSON.parse(readFileSync(join(REPO_DIR, "engine", "schemas", file), "utf8")), "");
    for (let i = before; i < out.length; i++) out[i] = `${name}#${out[i]}`;
  }
  return out.sort();
}

/** 年・行ごとの金額の合計（ID を付け替えても同じ数字になることを比べる） */
const sums = (table: { year: number; row: string; amount: number }[]) => {
  const m = new Map<string, number>();
  for (const c of table) m.set(`${c.year}|${c.row}`, (m.get(`${c.year}|${c.row}`) ?? 0) + c.amount);
  return [...m.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
};

describe("持ち帰り用のレポート: 内部情報を入れない", () => {
  it("計算の要求の自由記述の欄は、すべて扱いを決めてある（スキーマに欄が増えたら止まる）", () => {
    expect(freeTextPaths()).toEqual(Object.keys(FREE_TEXT).sort());
  });

  it("FP用のメモ・呼び名・AIの記録・料金表の写し・自由記述・元の ID が中身に出ない。数字は変わらない", () => {
    const o = openHousehold("advisoryFeeProposal", { marks: true });
    const h = o.wh.request.input.household;
    const living = h.livingExpenses?.[0]?.monthly as unknown as Record<string, unknown>;
    living.origin = { kind: "ai", ref: "0b1c2d3e-4f50-4a6b-8c7d-8e9fa0b1c2d3", connector: `${MARK}-ai` };
    living.approval = { by: "fp", at: "2026-10-01T10:00:00+09:00", candidate: "0b1c2d3e-4f50-4a6b-8c7d-8e9fa0b1c2d3" };
    const fee = h.advisoryFees?.[0] as unknown as Record<string, unknown>;
    fee.menu = { id: "office.standard", label: `${MARK}-menu` };
    (h as unknown as Record<string, unknown>).periodicExpenses = [{ id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", label: `${MARK}-periodic`, row: "cf.expense.other", from: { at: "2030-01" }, everyYears: 5, amount: { value: 100000, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: `${MARK}-basis` } } }, { id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8e", label: `${MARK}-dream`, kind: "dream", row: "cf.expense.lumpSum.other", from: { at: "2031-04" }, to: { at: "2031-04" }, everyYears: 1, amount: { value: 300000, state: "confirmed", origin: { kind: "manual" } }, dream: { rank: 1, note: `${MARK}-dreamNote` } }];
    o.wh.proposals.forEach((p) => p.diffs.forEach((d) => (d.note = `${MARK}-note`)));
    const original = JSON.stringify(o.wh);
    const ids = new Set(original.match(UUID) ?? []);
    const payload = buildPayload(o.ctx, choiceFor(o, { addressee: "見本 花子", office: "見本FP事務所" }));
    const text = JSON.stringify(payload);
    expect(text).not.toContain(MARK);
    expect(text).not.toContain("office.standard");
    expect(text).not.toContain('"approval"');
    expect(text).not.toContain('"ai"');
    for (const id of ids) expect(text, id).not.toContain(id);
    // 許可した項目だけ（型に無い項目が紛れ込まない）
    expect(Object.keys(payload).sort()).toEqual(["addressee", "base", "createdOn", "dataSet", "format", "levers", "moneyThree", "notices", "office", "plans", "proposal", "targetAge", "version", "views"]);
    for (const p of payload.plans) expect(Object.keys(p).sort()).toEqual(["letter", "name", "request"]);
    expect(payload.addressee).toBe("見本 花子");
    // ID を付け替え、自由記述を外しても、計算の数字は同じ
    const raw = applyValues(o.wh, o.ctx.valuesOf(o.b), o.cat);
    const prop = payload.plans.find((p) => p.letter === payload.proposal)!;
    expect(sums(preview(prop.request).table)).toEqual(sums(preview(raw).table));
  });

  it("学校コード・保険の商品の参照・習い事の見出し・車の維持費の内訳の行の名前を外す", () => {
    const req = modelHousehold("educationTwoKids");
    const h = req.input.household as unknown as Record<string, unknown>;
    const goals = (h.goals ?? []) as { education?: { stages: Record<string, unknown>[]; lessons?: Record<string, unknown>[] } }[];
    const ed = goals.find((g) => g.education !== undefined)?.education;
    expect(ed).toBeDefined();
    ed!.lessons = [{ from: { at: "2030-04" }, to: { at: "2033-03" }, monthly: 10000, label: `${MARK}-lesson` }];
    (ed!.stages[0] as Record<string, unknown>).school = { school: "A123456789012", unit: "A123456789012/d001", track: `${MARK}-track`, rows: [], source: { pack: "master.education.tuition", version: "1" } };
    const contracts = (h.insuranceContracts ?? []) as Record<string, unknown>[];
    contracts.push({ schedule: { source: { productRef: `${MARK}-product`, digest: `sha256:${"0".repeat(64)}` }, rows: [] } });
    // 車の維持費の内訳の名前つきの行の名前（0069）
    h.cars = [{ id: "00000000-0000-4000-8000-0000000000c1", owner: "x", purchase: { first: { at: "2030-04" }, everyYears: 8, price: 1 }, upkeepMode: "detail", upkeepOther: [{ id: "00000000-0000-4000-8000-0000000000c2", label: `${MARK}-tire`, annual: 24000 }] }];
    const out = JSON.stringify(sanitizeRequest(req, new IdMap()));
    expect(out).not.toContain(MARK);
    expect(out).not.toContain("A123456789012");
    expect(out).toContain(SCHOOL_PLACEHOLDER);
  });
});

describe("持ち帰り用のレポート: 文字の欄の長さの上限", () => {
  // 上限の文字数で切るとき、UTF-16 の単位で切っていたので、絵文字（サロゲートペア・家族の絵文字・肌の色・旗）の片割れが残っていた
  it("上限で切るときは、見える1文字（書記素）の切れ目で切る。上限（UTF-16 の単位）は今までどおり超えない", () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
    for (const [s, max] of [
      ["あ".repeat(39) + "😀", 40],
      ["架空様👨‍👩‍👧‍👦ご一家", 6],
      ["案👍🏽", 3],
      ["旗🇯🇵🇯🇵", 4],
      ["は\u3099じめ", 1],
    ] as const) {
      const t = cleanText(s, max) ?? "";
      expect(t.length).toBeLessThanOrEqual(max);
      expect(lone.test(t), JSON.stringify(t)).toBe(false);
      expect(s.startsWith(t)).toBe(true);
    }
    expect(cleanText("あ".repeat(39) + "😀", 40)).toBe("あ".repeat(39));
    expect(cleanText("架空様👨‍👩‍👧‍👦ご一家", 6)).toBe("架空様");
    expect(cleanText("案👍🏽", 3)).toBe("案");
    expect(cleanText("旗🇯🇵🇯🇵", 5)).toBe("旗🇯🇵");
    // 切らないときはそのまま（前後の空白・制御文字の扱いは今までどおり）
    expect(cleanText(" 架空様👨‍👩‍👧‍👦 ", 40)).toBe("架空様👨‍👩‍👧‍👦");
    expect(cleanText("a\u0001b", 40)).toBe("a b");
    expect(cleanText("  ", 40)).toBeNull();
  });
});

describe("持ち帰り用のレポート: つまみと制度データ", () => {
  it("つまみの当て方は、アプリの対策と同じ部品（同じ値なら同じ要求）", () => {
    const { payload } = payloadFor("salariedCoupleTwoKids");
    const prop = payload.plans.find((p) => p.letter === payload.proposal)!.request;
    const cfg = payload.levers;
    expect(cfg.items.map((i) => i.key)).toEqual(["retireAge", "pensionAge", "nisaMonthly", "livingMonthly"]);
    const v = leverValues(prop, cfg);
    const tried = applyTry(prop, cfg, { levers: { retireAge: 65, livingMonthly: (v.livingMonthly ?? 0) + 10000 } });
    expect(tried).toEqual(applyLevers(prop, cfg.self, { retireAge: 65, livingMonthly: (v.livingMonthly ?? 0) + 10000 }, cfg.reemployment !== null ? { reemployment: cfg.reemployment } : {}));
    // 範囲の外の値は範囲に収める・許していないつまみは当てない
    const excluded = payloadFor("salariedCoupleTwoKids", { excluded: new Set(["retireAge", "fee"]) }).payload;
    expect(excluded.levers.items.map((i) => i.key)).not.toContain("retireAge");
    expect(excluded.levers.fee).toBeNull();
    const p2 = excluded.plans.find((p) => p.letter === excluded.proposal)!.request;
    expect(applyTry(p2, excluded.levers, { levers: { retireAge: 70 } })).toEqual(p2);
  });

  it("制度データは使うものだけに絞り、絞っても同じ結果になる（つまみの端も）", () => {
    const { payload } = payloadFor("salariedCoupleTwoKids");
    const { engine, packs } = realEngine();
    const probes = probeRequests(payload);
    expect(probes.length).toBe(payload.plans.length + 2 * payload.levers.items.length + (payload.levers.fee !== null ? 2 : 0));
    const c = choosePacks(engine, packs, probes);
    expect(c.pruned).toBe(true);
    expect(c.kept).toBeLessThan(c.total);
    const full = JSON.parse(engine.runBatch(JSON.stringify(probes), packs, '{"preview":true}')) as { table: unknown }[];
    const pruned = JSON.parse(engine.runBatch(JSON.stringify(probes), JSON.stringify(c.packs), '{"preview":true}')) as { table: unknown }[];
    expect(pruned.map((r) => JSON.stringify(r.table))).toEqual(full.map((r) => JSON.stringify(r.table)));
  });

  it("制度データの版は提案書の刻印と同じ書式", async () => {
    const { packs } = realEngine();
    expect(await dataSetLabel("2026-10", packs)).toMatch(/^2026\.10-[0-9a-f]{8}$/);
  });
});

describe("持ち帰り用のレポート: パスワードと平文", () => {
  const MARK_YEN = 287_654;
  const withMarkYen = async (password: string | null) => {
    const o = openHousehold("salariedCoupleTwoKids");
    const box = o.wh.request.input.household.livingExpenses?.[0]?.monthly as unknown as { value: number };
    box.value = MARK_YEN;
    const payload = buildPayload(o.ctx, choiceFor(o, { addressee: "見本 花子", office: "見本FP事務所", proposal: o.b }));
    const { engine, packs } = realEngine();
    const f = await makeTakeawayFile({ payload, engine, packsJson: packs, password, assets: assets() });
    return new TextDecoder().decode(f.bytes);
  };

  it("パスワードなし: データの塊は gzip の平文で、開くと数字・宛名がある（確かめ方が効くことの確認）", async () => {
    const html = await withMarkYen(null);
    expect(readHeader(block(html, BLOCK.header)).enc).toBeNull();
    const json = await open(readHeader(block(html, BLOCK.header)), block(html, BLOCK.data), null);
    expect(json).toContain(String(MARK_YEN));
    expect(json).toContain("見本 花子");
  });

  it("パスワードあり: ファイルのどこにも平文の数字・宛名・事務所名が残らない。正しいパスワードだけで開く", async () => {
    const html = await withMarkYen("correct horse 2026");
    const header = readHeader(block(html, BLOCK.header));
    expect(header.enc?.cipher).toBe("AES-256-GCM");
    expect(header.enc?.iter).toBeGreaterThanOrEqual(600_000);
    for (const s of [String(MARK_YEN), "287,654", "見本 花子", "見本FP事務所", "生活費を見直して"]) expect(html, s).not.toContain(s);
    const body = fromBase64(block(html, BLOCK.data));
    expect([body[0], body[1]]).not.toEqual([0x1f, 0x8b]);
    await expect(gunzip(body)).rejects.toThrow();
    const json = await open(header, block(html, BLOCK.data), "correct horse 2026");
    expect(json).toContain(String(MARK_YEN));
    await expect(open(header, block(html, BLOCK.data), "wrong")).rejects.toBeInstanceOf(WrongPassword);
    await expect(open(header, block(html, BLOCK.data), null)).rejects.toBeInstanceOf(WrongPassword);
    // 1ビットの書き換え・見出しの値の書き換えでも開かない
    const flipped = new Uint8Array(body);
    flipped[flipped.length - 5] = (flipped[flipped.length - 5] as number) ^ 1;
    const { toBase64 } = await import("../src/takeaway/container.ts");
    await expect(open(header, toBase64(flipped), "correct horse 2026")).rejects.toBeInstanceOf(WrongPassword);
    await expect(open({ ...header, enc: { ...header.enc!, iter: header.enc!.iter + 1 } }, block(html, BLOCK.data), "correct horse 2026")).rejects.toBeInstanceOf(WrongPassword);
  });

  it("塩と IV は書き出すたびに違う", async () => {
    const a = await seal("{}", "pw-123456");
    const b = await seal("{}", "pw-123456");
    expect(a.header.enc?.salt).not.toBe(b.header.enc?.salt);
    expect(a.header.enc?.iv).not.toBe(b.header.enc?.iv);
  });
});

describe("持ち帰り用のレポート: 外と話さないファイル", () => {
  it("CSP で外への通信を止め、実行できるのはハッシュで決めた部品と blob: だけ", async () => {
    const { html } = await file("salariedCoupleTwoKids", null);
    const head = html.slice(0, html.indexOf("</head>"));
    const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(head);
    expect(m).not.toBeNull();
    const policy = m![1] as string;
    for (const d of ["default-src 'none'", "connect-src 'none'", "img-src 'none'", "font-src 'none'", "frame-src 'none'", "object-src 'none'", "worker-src 'none'", "base-uri 'none'", "form-action 'none'"]) expect(policy).toContain(d);
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval|https?:|\*/);
    // CSP の meta は文字コードの次（どの読み込みよりも先）
    expect(head.indexOf("Content-Security-Policy")).toBeLessThan(head.indexOf("<style"));
    // 実行するスクリプトは1つだけで、そのハッシュが CSP にある
    const exec = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1] as string);
    expect(exec).toHaveLength(1);
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(exec[0]))).toString("base64");
    expect(policy).toContain(`'sha256-${hash}'`);
    // 外を指す属性・要素が無い
    const outside = html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style>[\s\S]*?<\/style>/g, "");
    expect(outside).not.toMatch(/\s(src|href|action|srcset|poster)=/i);
    expect(outside).not.toMatch(/<(link|img|iframe|object|embed|base|form)\b/i);
  });

  it("画面の部品は通信・保存の機能を使わない", () => {
    const js = assets().viewerJs;
    for (const w of ["XMLHttpRequest", "WebSocket", "sendBeacon", "EventSource", "localStorage", "sessionStorage", "indexedDB", "importScripts", "new Worker", "window.open"]) expect(js, w).not.toContain(w);
    expect(js).not.toMatch(/\bfetch\s*\(/);
    expect(js).not.toMatch(/\bimport\s*\(/);
    expect(assets().viewerCss).not.toMatch(/url\(\s*["']?(?!#)/);
  });

  it("計算エンジンは画面側のもの（engine/dist/engine.js）とバイト単位で同じ", async () => {
    const { html } = await file("salariedCoupleTwoKids", null);
    const js = await gunzip(fromBase64(block(html, BLOCK.engine)));
    const want = readFileSync(join(ENGINE_DIST, "engine.js"));
    expect(Buffer.from(js).equals(want)).toBe(true);
    expect(html).toContain(`data-sha256="${await sha256Hex(new Uint8Array(want))}"`);
  });

  it("ファイルの中のデータを開くと、許可した値と絞った制度データだけ", async () => {
    const { html, payload } = await file("salariedCoupleTwoKids", null);
    const d = await dataOf(html, null);
    expect(Object.keys(d).sort()).toEqual(["packs", "payload"]);
    expect(d.payload).toEqual(payload);
    expect(d.payload.plans.map((p) => p.letter)).toEqual(["A", "B", "C"]);
    expect(d.payload.plans[0]?.request.input.household.members.length).toBeGreaterThan(0);
    void CURRENT;
  });

  it("入れた部品のライセンスの文を末尾に入れる（MIT は写しにライセンスの文を求める）", async () => {
    const { html } = await file("salariedCoupleTwoKids", null);
    const tail = html.slice(html.indexOf("</html>"));
    expect(tail).toContain("preact@");
    expect(tail).toContain("MIT License");
    expect(tail.indexOf("-->")).toBe(tail.length - 4);
  });
});
