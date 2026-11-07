// 対策の「＋ 動かす項目を追加」で入力の欄そのものを動かす項目（`field:` の項目）は、どれもプランに保存でき、開き直しても値が残る
// （0036 の追記 2026-10-29）。形式 0.16 より後に足した欄は、0.16 の読み替え表（凍結）に無いので、画面の鍵と当て先を行き来する表
// （src/workspace/store/laterFields.ts）を今の欄の定義から作る。
// - 作る手順（欄を足したら手で流す: WRITE_LATER_READINGS=1 npx vitest run test/field-items-save.test.ts）: 見本の世帯の欄に値を書き、
//   1つの値をそのまま書く欄の行を作る（laterReadingsGenerate.ts）。作れない欄は、合成の対策の行（store/readings.ts の LATER_ENTRIES）を
//   手で足すか、下の NOT_MOVABLE に理由を書く（どちらでもない欄があれば、この手順は失敗する）
// - いつも流す確かめ: どの欄も表で読めるか動かす項目に出さない欄であること（欄を足して表を作り直していなければ失敗する）・出す欄は
//   どれも保存して開き直すと値が残り、当てた中身の全体が欄に書いたのと同じこと（0.16 の表の欄も。欄が一緒に変える値まで）・表の型が重ならないこと
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { READING_ENTRIES } from "../src/generated/readings.ts";
import type { WorkingHousehold } from "../src/workspace/input/household.ts";
import { sameJson } from "../src/workspace/plans/diffs.ts";
import { buildCatalog, type Catalog, type ItemValue, type MovableItem } from "../src/workspace/plans/items.ts";
import { applyPlan, effectiveValues, savePlan } from "../src/workspace/plans/plans.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { BODY_FORMAT_VERSION, bodyOf, EMPTY_CARRY, fromBody } from "../src/workspace/store/body.ts";
import { LATER_FIELD_ENTRIES } from "../src/workspace/store/laterFields.ts";
import { LATER_ENTRIES, matchKey, resolveKey, type ReadingEntry } from "../src/workspace/store/readings.ts";
import { bump, generateLater, households, movableFields, sameExceptStates } from "./laterReadingsGenerate.ts";

const NOW = "2026-10-29T10:00:00.000Z";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const patternOf = (key: string) => key.replace(UUID, "{id}").replace(/(?<=\/|^|:)\d+(?=\/|$|:)/g, "{n}");
const KNOWN: readonly ReadingEntry[] = [...READING_ENTRIES, ...LATER_ENTRIES];
const PER_PATTERN = process.env.FIELD_SAVE_ALL !== undefined ? Infinity : 3;

/**
 * 動かす項目に出さない欄（1つの値をそのまま書かず、物を持たせる合成の対策も作れない欄）。入力画面でプランを選んで直す（0043）。
 * 型（ID は {id}、番号は {n}）→ 理由
 */
const NOT_MOVABLE: Record<string, string> = {
  ...Object.fromEntries(
    ["assetReturns/bond.domestic", "assetReturns/bond.global", "assetReturns/cash.deposit", "assetReturns/cash.foreign", "assetReturns/equity.domestic", "assetReturns/equity.global", "assetReturns/reit.domestic", "assetReturns/reit.global", "depositReturn", "educationInflation", "inflation", "investmentReturn", "pensionMacroSlide", "pensionMacroSlideEmployee", "realEstate/landGrowth", "wageGrowth"].flatMap((s) =>
      ["from", "to", "rate"].map((x) => [`field:assume/${s}/ex/{n}/${x}`, "例外の期間は年ごとの値の並びで、1つの期間の始まり・終わり・率を変えると複数の年の値が変わる（期間は ID を持たない）"]),
    ),
  ),
  "field:edu/{id}/loan/{id}/term": "年数を月数に直して書く（並びの要素の中の値で、物を持たせる合成の対策にできない）",
  "field:edu/{id}/scholar/{id}/term": "年数を月数に直して書く（並びの要素の中の値で、物を持たせる合成の対策にできない）",
  "field:living/{id}/cat/new-allowance": "まだ無い費目の欄（入れると費目を足す。費目ごとに合成の対策を作らない）",
  "field:savings/new/actual": "まだ無い年の貯まった額の欄（入れると確かめの記録を足す。プランで動かすものではない）",
  "field:retirement/{id}/contrib": "国民年金基金の掛金の月額は、入れると掛金の始まり・終わりも足す（1つの値をそのまま書かない）。プランでは動かさない",
  "field:housing/res/{id}/purchase/building": "注文住宅の建物の代金は合計−土地の代金を見せる欄で、直すと合計を書き土地の代金の推定の印を外す（1つの値をそのまま書かない。プランでは合計か土地の代金を動かす。0115）",
};
/** 型が NOT_MOVABLE のどれかに当たるか（まだ無い費目の欄は、費目の名前によらず出さない） */
const notMovable = (p: string): boolean => Object.hasOwn(NOT_MOVABLE, p) || p.startsWith("field:living/{id}/cat/new-");

function bodyText(wh: WorkingHousehold, sel: string, shown: string[]): string {
  return bodyOf({ wh, workspace: { template: null, band: [sel], base: "current", selected: sel, shownItems: shown }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }, carry: EMPTY_CARRY });
}

const selfOf = (wh: WorkingHousehold) => wh.request.input.household.members.find((m) => m.kind === "self")?.id ?? "";

describe("入力の欄を動かす項目は、どれもプランに保存できる（0036 の追記 2026-10-29）", () => {
  const hs = households();

  it.runIf(process.env.WRITE_LATER_READINGS !== undefined)("今の欄の定義から、0.16 より後に足した欄の当て先の表を作る", () => {
    const r = generateLater(KNOWN, LATER_FIELD_ENTRIES, BODY_FORMAT_VERSION);
    const rows = r.entries.map((e) => `  ${JSON.stringify(e)},`).join("\n");
    const text = [
      "// 自動生成（app/test/field-items-save.test.ts の作る手順）。手で書き換えない",
      "// 形式 0.16 より後に足した入力の欄の、画面の鍵（`field:<欄のキー>`）→ 当て先（0036 の追記 2026-10-29）。0.16 の読み替え表（凍結）の",
      "// 後ろに足して引く。世帯ファイルには鍵を書かず当て先で書くので、本体の 0.16 → 0.17 の変換の段は読まない",
      'import type { ReadingEntry } from "./readings.ts";',
      "",
      "export const LATER_FIELD_ENTRIES: readonly ReadingEntry[] = [",
      rows,
      "];",
      "",
    ].join("\n");
    // 行を作れない欄は、合成の対策の行（LATER_ENTRIES）を手で足すか、動かす項目に出さない欄（NOT_MOVABLE）に理由を書く
    const left = [...r.unsaved].filter(([p]) => !notMovable(p.replace(/\{(object|member)\}/g, "{id}")));
    expect(left.map(([p, why]) => `${p}: ${why}`)).toEqual([]);
    writeFileSync(join(import.meta.dirname, "..", "src", "workspace", "store", "laterFields.ts"), text);
  }, 600_000);

  it("表の型は重ならない（0.16 の読み替え表・合成の対策の行とも）", () => {
    const all = [...KNOWN, ...LATER_FIELD_ENTRIES];
    for (const e of [...LATER_ENTRIES, ...LATER_FIELD_ENTRIES]) {
      const sample = e.from.replace(/\{(object|member|id)\}/g, "3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10").replace(/\{n\}/g, "0");
      expect(matchKey(sample, all)?.entry.from, e.from).toBe(e.from);
    }
  });

  it("読み替えられない欄は動かす項目に出さない（出して、保存で黙って落とさない）", () => {
    const shown = new Set<string>();
    const missing = new Set<string>();
    for (const [name, wh] of hs) {
      const cat = buildCatalog(wh, selfOf(wh), null);
      for (const f of movableFields(wh)) {
        const key = `field:${f.key}`;
        const p = patternOf(key);
        const r = resolveKey(key, wh.request.input as never);
        if (notMovable(p)) {
          if (cat.byKey.has(key)) shown.add(`${p}（${name}）`);
        } else if (r === null) missing.add(`${p}（${name}）`);
        else if (r.kind === "unresolved" && cat.byKey.has(key)) shown.add(`${p}（${name}）`);
      }
    }
    expect([...shown]).toEqual([]);
    expect([...missing]).toEqual([]);
  });

  it("値を入れて保存し、開き直すと値が残り、当てた中身は欄に書いたのと同じ", () => {
    const failures = new Map<string, string>();
    const tried = new Map<string, number>();
    for (const [name, wh] of hs) {
      const cat = buildCatalog(wh, selfOf(wh), null);
      for (const it of cat.items) {
        if (it.control.kind !== "field") continue;
        const p = patternOf(it.key);
        // 同じ型の欄は3つの世帯まで確かめる（すべての世帯ですべての欄を確かめると時間がかかる。FIELD_SAVE_ALL=1 で全部）
        const n = tried.get(p) ?? 0;
        if (n >= PER_PATTERN || failures.has(p)) continue;
        const why = roundTrip(wh, cat, it);
        if (why === "same") continue;
        tried.set(p, n + 1);
        if (why !== null) failures.set(p, `${why}（${name}）`);
      }
    }
    expect(tried.size).toBeGreaterThan(250);
    expect([...failures].map(([p, why]) => `${p}: ${why}`).sort()).toEqual([]);
  });

  it("欄が一緒に変える値がある 0.16 の表の欄は、どの見本の世帯でも、当てた中身の全体が欄に書いたのと同じ（0036 の追記 2026-10-29 の2）", () => {
    const failures: string[] = [];
    let n = 0;
    for (const [name, wh] of hs) {
      const cat = buildCatalog(wh, selfOf(wh), null);
      for (const it of cat.items) {
        if (it.control.kind !== "field" || !LINKED.has(patternOf(it.key))) continue;
        const why = roundTrip(wh, cat, it);
        if (why === "same") continue;
        n++;
        if (why !== null) failures.push(`${patternOf(it.key)}: ${why}（${name}）`);
      }
    }
    expect(n).toBeGreaterThan(LINKED.size);
    expect(failures).toEqual([]);
  }, 600_000);
});

/**
 * 0.16 の表の欄のうち、欄が一緒に変える値がある欄の型（車の買い替えの間隔→下取り額・仕送り→扶養と同居の既定・ローンの残高→借入額・保障の額→
 * 保障の表の各行・収益不動産の取得価額→取得の時期・働き方の期間の年収→別の期間の年収・標準報酬月額→もう片方）
 */
const LINKED = new Set([
  "field:ev/car/{id}/every",
  "field:family/{id}/allowance",
  "field:housing/debt/{id}/balance",
  "field:ins/{id}/cov/{id}/amount",
  "field:sav/{id}/property/acqPrice",
  "field:work/period/{id}/annual",
  "field:work/period/{id}/smrH",
  "field:work/period/{id}/smrP",
]);

/** 決まった並びの ID で作る（欄が物・要素を作るとき、欄に書いた世帯と当てた世帯で同じ ID にする） */
function withIds<T>(f: () => T): T {
  const real = crypto.randomUUID;
  let seq = 0;
  (crypto as { randomUUID: () => string }).randomUUID = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "f")}`;
  try {
    return f();
  } finally {
    (crypto as { randomUUID: typeof real }).randomUUID = real;
  }
}

/** 1つの項目に値を入れて保存し、開き直して確かめる（問題が無ければ null、値を動かせなければ "same"） */
function roundTrip(wh: WorkingHousehold, cat: Catalog, it: MovableItem): string | null | "same" {
  const f = (it.control as { field: Parameters<typeof bump>[0] }).field;
  const v0 = it.read(wh);
  const v1 = bump(f, v0) as ItemValue;
  if (it.same(v1, v0)) return "same";
  const want = withIds(() => it.apply(wh, v1).request.input);
  if (sameJson(want, wh.request.input)) return "same";
  const saved = savePlan(wh, cat, { name: "見本", base: null, values: { [it.key]: v1 }, now: NOW });
  const plan = saved.wh.proposals.find((x) => x.id === saved.id);
  if (plan === undefined || plan.diffs.length === 0) return "保存すると差分になりません";
  const body = JSON.parse(bodyText(saved.wh, saved.id, [it.key])) as { workspace: { shownItems: unknown[] } };
  if (body.workspace.shownItems.length === 0) return "対策に足した項目が世帯ファイルに残りません";
  const back = fromBody(JSON.stringify(body)).wh;
  const cat2 = buildCatalog(back, selfOf(back), null);
  // 同じ当て先を動かす項目が複数あれば、どの項目の値として戻ってもよい（今の働き方の期間の欄と、その期間の欄など。0036 の追記）
  const values = effectiveValues(back, saved.id);
  const target = resolveKey(it.key, back.request.input as never);
  const got = Object.entries(values).find(([k]) => k === it.key || (target !== null && sameJson(resolveKey(k, back.request.input as never), target)));
  if (got === undefined || !it.same(got[1], v1)) return `開き直すと値が残りません ${JSON.stringify(got?.[1])} / ${JSON.stringify(v1)}`;
  // 当てた中身は、開き直した現状の欄に書いたのと同じ（開き直しで現状の形が整うことがあるので、開き直した現状で比べる）
  const it2 = cat2.byKey.get(it.key) ?? cat2.byKey.get(got[0]);
  if (it2 === undefined) return "開き直すと動かす項目がありません";
  const applied = withIds(() => applyPlan(back, saved.id, cat2).request);
  // 当てた中身の全体が、欄に書いたのと同じ（0.16 の読み替え表〔凍結〕の行の欄も。差分は欄と同じ書き方で当てるので、欄が一緒に変える値〔下取り額・
  // もう片方の標準報酬月額など〕も同じに変わる。0036 の追記 2026-10-29 の2）
  if (!sameExceptStates(applied.input, withIds(() => it2.apply(back, v1).request.input))) return "当てた中身が、欄に書いたのと違います";
  return null;
}
