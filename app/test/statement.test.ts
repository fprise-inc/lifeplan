// 明細の取り込みとヒアリング（0034）を入力のホームにつなぐ部分（workspace/statement/model.ts）:
// 口座の登録 → 架空の明細を読んで取り込む → 迷う行を決める（辞書の学習・世帯の決まり・働き方）→ 候補を承認すると現状に入り、計算できる
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_ROWS_PER_HOUSEHOLD, readLog, SHEET_HEADER_ROW, type StatementCandidate } from "../../statement/src/index.ts";
import { approvalTime } from "../src/workspace/hearing/sheet.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import {
  accountLabelProblem,
  addAccount,
  addImport,
  analyze,
  approve,
  approveMarks,
  beforeText,
  candidatesOf,
  decide,
  defaultCandidateSelection,
  defaultMarkSelection,
  exportMarkSheet,
  formatToLearn,
  keepStatements,
  logOf,
  markDateText,
  markText,
  otherReview,
  importPeriodProblem,
  periodProblem,
  putRule,
  readFile,
  readFileWithYear,
  readSheet,
  requestSize,
  sheetPlan,
  removeAccount,
  setPeriod,
  setStyles,
  shareOfPercent,
  percentText,
  styleRows,
  withLog,
  withSheetRequest,
  yearChoices,
  type ReadOk,
} from "../src/workspace/statement/model.ts";
import { bodyOf, EMPTY_CARRY, fromBody } from "../src/workspace/store/body.ts";
import { editXlsx, setCell, text as utf8, unzip } from "../../xlsx/test/helpers.ts";
import { APP_DIR, REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

const FIX = join(REPO_DIR, "statement", "test", "fixtures");
const file = (name: string) => new Uint8Array(readFileSync(join(FIX, name)));
const AT = approvalTime(new Date(2026, 9, 23, 10, 0, 0));

let n = 0;
const seq = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

/** 見本の自営業の世帯（本人が個人事業主・配偶者は働いていない） */
function household(): WorkingHousehold {
  return withRefreshedEstimates(fromRequest(modelHousehold("sampleSelfEmployedFamily")));
}

async function readOk(name: string, kind: "card" | "bank" | "app"): Promise<ReadOk> {
  const out = await readFile(file(name), kind, []);
  if (!out.ok) throw new Error(JSON.stringify(out.issues));
  return out;
}

/** カード（本人・カード会社あり）と銀行（本人）の明細を取り込んだ世帯 */
async function imported(): Promise<{ wh: WorkingHousehold; self: string; spouse: string }> {
  let wh = household();
  const members = wh.request.input.household.members;
  const self = members.find((m) => m.kind === "self")!.id;
  const spouse = members.find((m) => m.kind === "spouse")!.id;
  let log = addAccount(logOf(wh), { kind: "card", label: "ご本人のカード（Aカード）", owner: self, issuer: "smbc" }, "acc-card");
  log = addAccount(log, { kind: "bank", label: "ご本人の給与口座", owner: self }, "acc-bank");
  for (const [name, kind, account] of [
    ["card-year-utf8bom.csv", "card", "acc-card"],
    ["bank-utf8.csv", "bank", "acc-bank"],
  ] as const) {
    const r = addImport(log, await readOk(name, kind), { id: seq(), account, at: AT });
    if (!r.ok) throw new Error(r.reason);
    log = r.log;
  }
  wh = withLog(wh, log);
  return { wh, self, spouse };
}

describe("口座・カードの登録", () => {
  it("呼び名にカード番号・口座番号らしき数字は書けない（空・長すぎるも止める）", () => {
    expect(accountLabelProblem("ご本人のカード（Aカード）")).toBeNull();
    expect(accountLabelProblem("")).not.toBeNull();
    expect(accountLabelProblem("カード 0000-1111-2222-3333")).toMatch(/番号/);
    expect(accountLabelProblem("給与口座 1234567")).toMatch(/番号/);
    expect(accountLabelProblem("あ".repeat(61))).not.toBeNull();
  });

  it("口座を外すと、その明細の取り込みもいっしょに外れる。空になった記録は世帯から区画ごと外す", async () => {
    const { wh } = await imported();
    const log = logOf(wh);
    const out = removeAccount(removeAccount(log, "acc-card"), "acc-bank");
    expect(out.imports).toEqual([]);
    expect(withLog(wh, out).statements).toBeUndefined();
  });

  it("カード会社はカードのときだけ持つ", () => {
    const log = addAccount(logOf(household()), { kind: "bank", label: "口座", owner: null, issuer: "smbc" }, "a");
    expect(log.accounts[0]?.issuer).toBeUndefined();
  });
});

describe("明細を読んで取り込む", () => {
  it("番号は読んだ時点で消え、推し量った対応付けは覚える形になる。同じファイルは2回取り込まない", async () => {
    const out = await readOk("card-year-utf8bom.csv", "card");
    expect(JSON.stringify(out.table)).not.toMatch(/1111|9876543/);
    expect(out.needsMapping).toBe(true);
    const f = formatToLearn(out, "card", AT);
    expect(f).toMatchObject({ fingerprint: out.fingerprint, kind: "card", mapping: out.mapping });
    // 覚える形に金額・日付・店の名前は入らない
    expect(JSON.stringify(f)).not.toMatch(/セブン|1,280|2025/);
    const { wh } = await imported();
    const again = addImport(logOf(wh), out, { id: "x", account: "acc-card", at: AT });
    expect(again).toEqual({ ok: false, reason: "duplicate" });
    // 覚えた形で読むと、確かめなくてよい
    const learned = await readFile(file("card-year-utf8bom.csv"), "card", [f!]);
    expect(learned.ok && learned.mappingSource === "learned" && !learned.needsMapping).toBe(true);
  });

  it("1つの世帯の行の上限を超える明細は取り込まない（開き直したときに取り込みが丸ごと消えないように）", async () => {
    const out = await readOk("card-year-utf8bom.csv", "card");
    const big = (k: number, rows: number): ReadOk => ({ ...out, file: { sha256: `sha256:${String(k).repeat(64)}`, bytes: 1 }, rows: Array.from({ length: rows }, (_, i) => ({ ...out.rows[0]!, line: i + 2 })) });
    let log = addAccount(logOf(household()), { kind: "card", label: "カード", owner: null }, "acc");
    for (const k of [1, 2]) {
      const r = addImport(log, big(k, 20000), { id: seq(), account: "acc", at: AT });
      if (!r.ok) throw new Error(r.reason);
      log = r.log;
    }
    expect(addImport(log, big(3, 20000), { id: seq(), account: "acc", at: AT })).toEqual({ ok: false, reason: "tooMany" });
    const fits = addImport(log, big(4, MAX_ROWS_PER_HOUSEHOLD - 40000), { id: seq(), account: "acc", at: AT });
    expect(fits.ok).toBe(true);
    if (!fits.ok) return;
    // 上限ちょうどまでは、開き直しても全部の取り込みが残る
    expect(readLog(JSON.parse(JSON.stringify(fits.log))).imports.map((i) => i.rows.length)).toEqual([20000, 20000, MAX_ROWS_PER_HOUSEHOLD - 40000]);
  });

  it("元のファイル・ファイル名は世帯に残らない（指紋と大きさだけ）", async () => {
    const { wh } = await imported();
    const text = JSON.stringify(wh.statements);
    expect(text).not.toMatch(/card-year|bank-utf8|\.csv/);
    expect(text).not.toMatch(/0000-1111-2222-3333|1234567|0009876543/);
    expect(logOf(wh).imports.every((i) => /^sha256:[0-9a-f]{64}$/.test(i.file.sha256) && i.file.bytes > 0)).toBe(true);
  });

  it("期間は形と順番を確かめてから直す", async () => {
    const { wh } = await imported();
    const log = logOf(wh);
    const id = log.imports[0]!.id;
    expect(periodProblem({ from: "2025-10-01", to: "2025-09-30" })).not.toBeNull();
    expect(setPeriod(log, id, { from: "2025-13-01", to: "2026-09-30" })).toBe(log);
    expect(setPeriod(log, id, { from: "2025-10-01", to: "2026-09-30" }).imports[0]?.period).toEqual({ from: "2025-10-01", to: "2026-09-30" });
  });

  // 期間を使った日より狭く直すと、期間の外の行も合計に入ったまま狭い日数で割るので、月平均が多く出ていた
  it("期間は使った日の最初と最後を含める（狭くはできない。広げるのはよい）", async () => {
    const { wh } = await imported();
    const log = logOf(wh);
    const imp = log.imports[0]!;
    const dates = imp.rows.map((r) => r.date).sort();
    const span = { from: dates[0]!, to: dates.at(-1)! };
    const next = (d: string, k: number) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86400000).toISOString().slice(0, 10);
    const narrow = { from: next(span.from, 1), to: span.to };
    expect(periodProblem(narrow, span)).toContain(`${span.from.replace(/-/g, "/")}`);
    expect(periodProblem({ from: span.from, to: next(span.to, -1) }, span)).not.toBeNull();
    expect(periodProblem({ from: next(span.from, -10), to: next(span.to, 10) }, span)).toBeNull();
    expect(importPeriodProblem(log, imp.id, narrow)).not.toBeNull();
    expect(setPeriod(log, imp.id, narrow)).toBe(log);
    const before = analyze(wh, []).summary.livingTotal;
    expect(analyze(withLog(wh, setPeriod(log, imp.id, narrow)), []).summary.livingTotal).toBe(before);
    // 取り込む前の期間も同じ
    const out = await readOk("card-year-utf8bom.csv", "card");
    const fresh = addAccount(logOf(household()), { kind: "card", label: "カード", owner: null }, "acc");
    const rs = out.rows.map((r) => r.date).sort();
    expect(addImport(fresh, out, { id: seq(), account: "acc", at: AT, period: { from: next(rs[0]!, 1), to: rs.at(-1)! } })).toEqual({ ok: false, reason: "period" });
    expect(addImport(fresh, out, { id: seq(), account: "acc", at: AT, period: { from: next(rs[0]!, -5), to: rs.at(-1)! } }).ok).toBe(true);
  });
});

describe("ヒアリング（迷う行を決める）", () => {
  it("個人事業主の行は「事業の経費」を選べ、割合で按分する。会社員にすると「立替」を選べる", async () => {
    const { wh, self, spouse } = await imported();
    const an = analyze(wh, []);
    expect(an.review.length).toBeGreaterThan(0);
    const biz = otherReview(an.review).find((r) => r.reasons.includes("bucketUndecided"));
    expect(biz?.allowed).toContain("business");
    expect(biz?.allowed).not.toContain("reimbursable");
    const share = shareOfPercent(60)!;
    expect(share).toBe("0.6");
    expect(percentText(share)).toBe("60%");
    const d = decide(logOf(wh), [{ importId: biz!.importId, rowId: biz!.rowId, bucket: "business", share }], [], AT);
    const row = analyze(withLog(wh, d.log), []).rows.find((r) => r.row.id === biz!.rowId && r.importId === biz!.importId)!;
    expect(row.bucket).toBe("business");
    expect((row.parts.business ?? 0) + (row.parts.household ?? 0)).toBe(row.row.amount);
    // 働き方の選び直し: 配偶者を会社員にすると、選べる区分に立替が入る（期間からの働き方に戻せる）
    const styled = withLog(wh, setStyles(logOf(wh), spouse, ["employee"]));
    expect(styleRows(styled).find((s) => s.member === spouse)?.buckets).toContain("reimbursable");
    expect(styleRows(withLog(styled, setStyles(logOf(styled), spouse, null))).find((s) => s.member === spouse)?.chosen).toBe(false);
    expect(styleRows(wh).find((s) => s.member === self)?.styles).toEqual(["selfEmployed"]);
  });

  it("分からない店の項目を決めると、同じ店の行にまとめて入り、覚える辞書は店の鍵と項目だけ", async () => {
    const { wh } = await imported();
    const an = analyze(wh, []);
    const u = an.unknown[0]!;
    const d = decide(logOf(wh), u.rows.map((r) => ({ ...r, category: "clothing" as const })), [], AT);
    expect(d.learn).toHaveLength(1);
    expect(Object.keys(d.learn[0]!).sort()).toEqual(["at", "category", "key"]);
    expect(d.learn[0]!.key).toBe(u.key);
    const after = analyze(withLog(wh, d.log), d.learn);
    expect(after.unknown.some((x) => x.key === u.key)).toBe(false);
    expect(after.review.length).toBeLessThan(an.review.length);
  });

  it("世帯の決まり（通信は事業50%）で、同じ項目の迷う行がまとめて決まる。会社員の行には当てない", async () => {
    const { wh, self } = await imported();
    const before = analyze(wh, []).review.filter((r) => r.category === "communication").length;
    expect(before).toBeGreaterThan(0);
    const log = putRule(logOf(wh), { match: { category: "communication" }, bucket: "business", share: "0.5" }, "rule-1", AT);
    const an = analyze(withLog(wh, log), []);
    expect(an.review.filter((r) => r.category === "communication")).toHaveLength(0);
    const tel = an.rows.find((r) => r.category === "communication" && r.owner === self)!;
    expect(tel.bucketSource).toBe("rule");
    expect(tel.share).toBe("0.5");
    // 本人を会社員にすると、事業の決まりは当てない
    const emp = analyze(withLog(wh, setStyles(log, self, ["employee"])), []);
    expect(emp.rows.find((r) => r.category === "communication" && r.owner === self)?.bucketSource).not.toBe("rule");
  });
});

describe("候補の承認", () => {
  it("FP がチェックした候補だけが承認の記録つきで現状に入り、取り込んだ記録が残り、計算できる", async () => {
    const { wh } = await imported();
    const an = analyze(wh, []);
    const list = candidatesOf(wh, an.summary, "00000000-0000-4000-8000-0000000000aa", seq);
    expect(list.length).toBeGreaterThan(1);
    const living = list.find((c) => c.collection === "livingExpenses")!;
    expect(beforeText(living)).toMatch(/^今/);
    // 迷う行が残っているので、どれも要確認（最初はどれもチェックしない）
    expect(defaultCandidateSelection(list).size).toBe(0);
    const annual = list.find((c) => c.collection === "periodicExpenses")!;
    const sel = new Set([living.id, annual.id]);
    const next = approve(wh, list, sel, an.summary, "00000000-0000-4000-8000-0000000000aa", AT);
    const h = next.request.input.household;
    const le = h.livingExpenses![0]!;
    const box = (le.mode === "total" ? le.monthly : le.categories![0]!.monthly)!;
    expect(box).toMatchObject({ state: "estimated", origin: { kind: "import", ref: "00000000-0000-4000-8000-0000000000aa" }, approval: { by: "fp", at: AT, candidate: living.id }, estimate: { method: "statementAverage" } });
    const boxes = h.periodicExpenses!.map((p) => p.amount as unknown as { origin: { kind: string }; approval?: { candidate?: string }; estimate?: { method: string } });
    expect(boxes.some((b) => b.origin.kind === "import" && b.approval?.candidate === annual.id && b.estimate?.method === "statementAnnual")).toBe(true);
    const applied = logOf(next).applied;
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ id: "00000000-0000-4000-8000-0000000000aa", by: "fp", at: AT });
    expect(applied[0]!.items.map((i) => i.candidate).sort()).toEqual([...sel].sort());
    expect(applied[0]!.imports).toHaveLength(2);
    // 計算エンジンが受け付ける（推定の出し方 statementAverage・statementAnnual はスキーマにある）
    expect(() => preview(next.request)).not.toThrow();
    // 同じ値の生活費の候補は、承認した後にもう一度出さない
    const again = candidatesOf(next, analyze(next, []).summary, "00000000-0000-4000-8000-0000000000bb", seq);
    expect(again.some((c: StatementCandidate) => c.collection === "livingExpenses")).toBe(false);
  });

  it("チェックしていない候補は入らない（承認しないと現状は変わらない）", async () => {
    const { wh } = await imported();
    const an = analyze(wh, []);
    const list = candidatesOf(wh, an.summary, "00000000-0000-4000-8000-0000000000cc", seq);
    expect(approve(wh, list, new Set(), an.summary, "00000000-0000-4000-8000-0000000000cc", AT)).toBe(wh);
  });

  it("承認して入れた名前を付けた支出と同じ候補は、次から出さない（承認していないもの・消したもの・直したものは出す）", async () => {
    const { wh } = await imported();
    const an = analyze(wh, []);
    const list = candidatesOf(wh, an.summary, "00000000-0000-4000-8000-0000000000dd", seq);
    const annuals = list.filter((c) => c.collection === "periodicExpenses");
    expect(annuals.length).toBeGreaterThan(0);
    const picked = annuals[0]!;
    const label = (picked.value as { label: string }).label;
    const next = approve(wh, list, new Set([picked.id]), an.summary, "00000000-0000-4000-8000-0000000000dd", AT);
    const titles = (w: WorkingHousehold) => candidatesOf(w, analyze(w, []).summary, "00000000-0000-4000-8000-0000000000ee", seq).filter((c) => c.collection === "periodicExpenses").map((c) => c.title);
    // 承認したものは出ない。承認していない一時的支出の候補は今までどおり出る
    expect(titles(next)).not.toContain(picked.title);
    expect(titles(next)).toEqual(annuals.filter((c) => c !== picked).map((c) => c.title));
    // 承認して入れた支出を消したら、また候補に出る
    const h = next.request.input.household;
    const removed: WorkingHousehold = { ...next, request: { ...next.request, input: { ...next.request.input, household: { ...h, periodicExpenses: h.periodicExpenses!.filter((p) => p.label !== label) } } } };
    expect(titles(removed)).toContain(picked.title);
    // FP が金額を直したら（明細の値でなくなったら）、また候補に出る（同じ名前の支出があるので要確認）
    const edited: WorkingHousehold = {
      ...next,
      request: { ...next.request, input: { ...next.request.input, household: { ...h, periodicExpenses: h.periodicExpenses!.map((p) => (p.label === label ? { ...p, amount: { value: 1, state: "confirmed", origin: { kind: "manual" } } } : p)) } } },
    };
    const again = candidatesOf(edited, analyze(edited, []).summary, "00000000-0000-4000-8000-0000000000ff", seq).find((c) => c.title === picked.title);
    expect(again?.status).toBe("needsReview");
  });
});

describe("元に戻す・やり直すの対象にしない", () => {
  it("今の明細の取り込みの記録を持ち越す", async () => {
    const { wh } = await imported();
    const old = household();
    expect(keepStatements(old, wh).statements).toBe(wh.statements);
    expect(keepStatements(wh, old).statements).toBeUndefined();
    expect(keepStatements(wh, wh)).toBe(wh);
  });
});

describe("確認シート（前もってお客さまに印を付けてもらう表計算のファイル。0034 の9）", () => {
  const SHEET = "xl/worksheets/sheet1.xml";
  const RANDOM = new Uint8Array([3, 1, 4, 1, 5, 9]);
  async function exported() {
    const { wh, self } = await imported();
    const an = analyze(wh, []);
    const sheet = await exportMarkSheet(wh, an, { random: RANDOM, at: AT, appVersion: "0.1.0", customerNo: "A0042" });
    return { wh: withLog(wh, withSheetRequest(logOf(wh), sheet.request)), an, sheet, self };
  }

  it("迷う行を書き出す。シートに世帯の内部ID・口座の ID・カード番号は載らず、依頼の記録は世帯ファイルの区画 statements に残る", async () => {
    const { wh, an, sheet, self } = await exported();
    // 店単位で答えられる同じ店の行は1行にまとめる（明細の行は全部載る）
    expect(sheet.rows).toBe(sheetPlan(an).lines.length);
    expect(sheet.rows).toBeLessThan(an.review.length);
    expect(sheet.entries).toBe(an.review.length);
    expect(requestSize(sheet.request)).toEqual({ lines: sheet.rows, rows: an.review.length });
    const all = [...(await unzip(sheet.bytes)).values()].map(utf8).join("\n");
    for (const needle of [self, "acc-card", "acc-bank", wh.request.input.household.members[0]!.id]) expect(all).not.toContain(needle);
    expect(all).toContain("ご本人のカード（Aカード）");
    const body = JSON.parse(bodyOf({ wh, workspace: { template: null, selected: "current", band: [] } as never, display: {} as never, carry: EMPTY_CARRY })) as { statements: { requests: unknown[] } };
    expect(body.statements.requests).toHaveLength(1);
    expect(fromBody(JSON.stringify(body)).wh.statements?.requests?.[0]?.id).toBe(sheet.request.id);
  });

  it("返ってきた印を確かめて入れると、迷う行が減り、取り込んだ記録が依頼に残る。別の世帯では読まない", async () => {
    const { wh, an, sheet } = await exported();
    const target = an.review.find((r) => r.reasons.includes("unknownMerchant"))!;
    const ws = utf8((await unzip(sheet.bytes)).get(SHEET));
    const row = Number(new RegExp(`<c r="C(\\d+)"[^>]*><is><t xml:space="preserve">${target.merchant}</t>`).exec(ws)?.[1]);
    const filled = await editXlsx(sheet.bytes, (f) => {
      setCell(f, SHEET, `H${row}`, '<c t="inlineStr"><is><t>教養娯楽</t></is></c>');
      setCell(f, SHEET, `I${row}`, '<c t="inlineStr"><is><t>家計（ふだんの暮らし）</t></is></c>');
    });
    const r = await readSheet(filled, wh, analyze(wh, []));
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.candidates.map((c) => c.merchant)).toEqual([target.merchant]);
    expect(markText(r.candidates[0]!)).toBe("教養娯楽・家計");
    const sel = defaultMarkSelection(r.candidates);
    const done = approveMarks(logOf(wh), r, sel, [], AT);
    expect(done.decided).toBe(1);
    expect(done.learn.map((e) => e.category)).toEqual(["recreation"]);
    const next = withLog(wh, done.log);
    expect(analyze(next, []).review.length).toBe(an.review.length - 1);
    expect(logOf(next).requests?.[0]?.received).toEqual([{ at: AT, file: r.file, decided: 1 }]);
    // 別の世帯（依頼の記録の無い世帯）では読まない
    const other = await readSheet(filled, household(), analyze(household(), []));
    expect(other.ok ? [] : other.issues.map((i) => i.code)).toEqual(["S_SHEET_OTHER_HOUSEHOLD"]);
  });
});

describe("確認シートの店ごとにまとめた行", () => {
  const SHEET = "xl/worksheets/sheet1.xml";
  it("まとめた行の印を承認すると、その店の行すべてが決まり、取り込んだ記録には明細の行の数が残る", async () => {
    const { wh: base } = await imported();
    const an = analyze(base, []);
    const sheet = await exportMarkSheet(base, an, { random: new Uint8Array([2, 7, 1, 8, 2, 8]), at: AT, appVersion: "0.1.0" });
    const wh = withLog(base, withSheetRequest(logOf(base), sheet.request));
    const shop = sheetPlan(an).lines.find((l) => l.kind === "shop" && l.items.length >= 3)!;
    const no = sheet.request.rows.find((x) => x.row === shop.items[0]!.rowId && x.import === shop.items[0]!.importId)!.no;
    const row = SHEET_HEADER_ROW + no;
    const filled = await editXlsx(sheet.bytes, (f) => setCell(f, SHEET, `H${row}`, '<c t="inlineStr"><is><t>通信</t></is></c>'));
    const r = await readSheet(filled, wh, analyze(wh, []));
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.candidates).toHaveLength(1);
    const c = r.candidates[0]!;
    expect([c.kind, c.count, c.amount]).toEqual(["shop", shop.items.length, shop.total]);
    expect(markDateText(c)).toBe(`${shop.from.replace(/-/g, "/")}〜${shop.to.replace(/-/g, "/")}・${shop.items.length}回`);
    const done = approveMarks(logOf(wh), r, defaultMarkSelection(r.candidates), [], AT);
    expect([done.lines, done.decided]).toEqual([1, shop.items.length]);
    expect(analyze(withLog(wh, done.log), []).review.length).toBe(an.review.length - shop.items.length);
    expect(logOf(withLog(wh, done.log)).requests?.[0]?.received[0]?.decided).toBe(shop.items.length);
  });
});

describe("本体の命令（0016 の1）", () => {
  it("明細の命令に渡すのは、覚える辞書の行と形だけ（パス・ファイル名を渡さない・受け取らない）", () => {
    const host = readFileSync(join(APP_DIR, "src", "engine", "host.ts"), "utf8");
    const calls = [...host.matchAll(/invoke<[^>]*>\("(statement_[a-z_]+)"(?:, \{ ([^}]*) \})?\)/g)];
    expect(calls.map((c) => c[1]).sort()).toEqual(["statement_learn", "statement_office", "statement_open", "statement_sheet_open"]);
    // 確認シートの保存に渡すのは、シートのバイト列と、顧客番号・書き出した日の見出しだけ
    const save = /invoke<SaveOutcome>\("statement_sheet_save", bytes, \{ headers: \{ ([^}]*) \} \}\)/.exec(host);
    expect(save?.[1]?.split(",").map((x) => x.trim().split(":")[0])).toEqual(['"x-customer-no"', '"x-exported-on"']);
    for (const c of calls) expect((c[2] ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "").every((a) => a === "entries" || a === "formats")).toBe(true);
    const rust = readFileSync(join(APP_DIR, "src-tauri", "src", "statement.rs"), "utf8");
    expect(rust).not.toMatch(/std::fs::write|File::create/);
  });
});

describe("年の書かれていない明細", () => {
  // 年の書かれていない日付だけの CSV は、案内が「年を選んで」なのに年を選ぶ欄が無く、取り込めなかった
  it("年の書かれていない日付だけの明細は、推定の年で読み、選び直した年で読み直せる", async () => {
    const csv = new TextEncoder().encode("利用日,利用店名,利用金額\n10/03,架空スーパー,1200\n10/05,架空コンビニ,500\n");
    const before = await readFile(csv, "card", []);
    expect(before.ok && before.rows.length).toBe(0);
    const out = await readFileWithYear(csv, "card", []);
    if (!out.ok || out.yearless === undefined) throw new Error("年を選べない");
    const suggested = out.yearless.suggested;
    expect(out.yearless.year).toBe(suggested);
    expect(out.rows.map((r) => r.date)).toEqual([`${suggested}-10-03`, `${suggested}-10-05`]);
    expect(out.issues.map((i) => i.code)).not.toContain("S_ROW_YEAR");
    const again = await readFileWithYear(csv, "card", [], undefined, suggested - 2);
    expect(again.ok && again.rows.map((r) => r.date)).toEqual([`${suggested - 2}-10-03`, `${suggested - 2}-10-05`]);
    const choices = yearChoices(2026);
    expect(choices[0]).toEqual({ value: 2027, label: "2027年" });
    expect(choices.find((c) => c.value === 2026)?.label).toBe("2026年（推定）");
    // 年つきの明細はそのまま（年を選ぶ欄を出さない）
    const dated = await readFileWithYear(file("card-year-utf8bom.csv"), "card", []);
    expect(dated.ok && dated.yearless).toBeUndefined();
  });
});
