// Web のヒアリング（0125）の通しの点検: 発行 → お客さまが1画面ずつ答える → 書類を送る → FP が受け取る → 取り込む → 世帯ファイルに保存して読み戻す、の一周。
// - 暗号・中継は本物の関数（hearing/src/web の発行・開く・書類の送り・送信・受け取り）を通す。サーバーは受け付けの処理（relay/handler.ts）をメモリの置き場で動かす
// - お客さまは、お客さまの画面と同じ順に1画面ずつ進む（walk）。空のまま「次へ」は「あとで」と同じ（Form.tsx の next）
// - 毎回確かめること（0193）:
//   1. 今の値が消えない（「あとで」・空のまま・粗い答え・出なかった問いで、今の値・行を上書きしない・消さない）
//   2. 見直しで、答えた所（前回の値）に合わせて問いが飛ぶ
//   3. 数が合う（お客さまが通った画面＝送る答えの元の画面、お客さまが答えた問い＝受け取った答え、FP の画面の問いの数＝同じ家族でお客さまが答える問いの画面の数）
//   4. 取り込みの後の世帯ファイル（アプリが開く形）を保存して読み戻しても同じ
// - 今ある不具合は「直す待ち」（it.fails。まだ落ちることを確かめる）。直したまとまりが it.fails を it にする（直ったのに it.fails のままだと落ちる）
// - ひな形の名前が変わったら SIMPLE・REVIEW を、FP の画面の数え方が変わったら fpQuestionCount を合わせる
import { describe, expect, it } from "vitest";
import { handleApi } from "../../hearing/relay/handler.ts";
import { memoryStore } from "../../hearing/relay/store.ts";
import { answersOf, draftKey, fieldAnswered, fieldKeys, initialDraft, markSent, openRequest, screenFields, screenGates, screenId, screens, sendDocuments, submitAnswers, unsentFiles, uploadFile, estimate, type Draft, type DraftAnswer, type DraftFile, type GateId, type Opened, type QuestionsPacket, type RelayTransport, type Screen, type WebSelection } from "../../hearing/src/web/index.ts";
import { FILLED_ON } from "../../hearing/src/web/packet.ts";
import { API_PREFIX } from "../../hearing/src/web/protocol.ts";
import { applyImport, approvalTime, defaultSelection, type ImportView } from "../src/workspace/hearing/sheet.ts";
import { cleanupOnServer, documentFromTemplate, importWeb, issueWeb, markImported, officeFace, previewPacket, receiveWeb, receivedDocuments, templateSelection, webLog, type WebLogEntry, type WebTaken, type WebTemplateKind } from "../src/workspace/hearing/web.ts";
import { fromRequest, withElementIds, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { bodyOf, EMPTY_CARRY, fromBody } from "../src/workspace/store/body.ts";
import { modelHousehold } from "./helpers.ts";

const OFFICE = officeFace({ name: "【架空】みらいFP事務所", color: "#2f6f5e", purpose: "ライフプランの作成のため", privacyContact: "" });
const NOW = new Date("2026-11-05T09:00:00Z");
const SENT = new Date("2026-11-06T13:15:00Z");
const AT = approvalTime(new Date(2026, 10, 7, 10, 0, 0));

let n = 0;
const seq = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
/** 値の入った世帯（夫婦と子2人・持ち家と住宅ローン・預貯金 800万円・生活費 月30万円） */
const filled = (): WorkingHousehold => fromRequest(modelHousehold("salariedCoupleTwoKids"));

// ---- ひな形（名前が変わったら、ここだけ合わせる） ----

/** 簡易の票（シンプル） */
const SIMPLE: WebTemplateKind = "first";
const REVIEW: WebTemplateKind = "review";

// ---- 答えの形 ----

const v = (text: string): DraftAnswer => ({ status: "value", raw: { kind: "text", text } });
const num = (text: string): DraftAnswer => ({ status: "value", raw: { kind: "number", text } });
const ym = (y: number, m: number): DraftAnswer => ({ status: "value", raw: { kind: "text", text: String(y) }, raw2: { kind: "number", text: String(m) } });
const LATER: DraftAnswer = { status: "later" };
const k = draftKey;
const jpeg = (seed: number) => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 1500 }, (_, i) => (i * seed) % 251)]) as Uint8Array<ArrayBuffer>;

// ---- 受け付けのサーバー（メモリの置き場） ----

function relayFor() {
  const store = memoryStore();
  const t: RelayTransport = async (r) => {
    const headers: Record<string, string> = {};
    if (r.token !== undefined) headers.authorization = `Bearer ${r.token}`;
    const res = await handleApi(new Request(`https://relay.test${API_PREFIX}${r.path}`, { method: r.method, headers, ...(r.body !== undefined ? { body: r.body } : {}) }), { store, now: () => NOW });
    return { status: res.status, body: await res.text() };
  };
  return { store, t };
}

// ---- お客さま: 画面を1つずつ進む ----

/** お客さまの答え方。answers に無い問いは、前回の値（見直し）があればそのまま、無ければ空のまま「次へ」（＝「あとで」） */
interface Script {
  gates?: Partial<Record<GateId, number>>;
  answers?: Record<string, DraftAnswer>;
  /** 書類ごと: 付ける写真（何枚か）・手元にない・あとで送る。無い書類は「まだ」のまま */
  documents?: Record<string, { photos: number[] } | "notAvailable" | "later">;
}

interface Walked {
  o: Opened;
  /** 送った下書き */
  d: Draft;
  /** 通った画面（最初の画面・確かめの画面を除く） */
  visited: Screen[];
  /** 送った答えの元の画面（送る直前の下書きでの並び。最初の画面・確かめの画面を除く） */
  final: Screen[];
}

/** URL を開いて、お客さまの画面と同じ順に1画面ずつ答え、書類を送ってから答えを送る（Form.tsx と同じ: 書類は答えの前に送る） */
async function walk(url: string, t: RelayTransport, s: Script): Promise<Walked> {
  const o = await openRequest(new URL(url).hash, t);
  const p = o.packet;
  let d = initialDraft(p);
  const visited: Screen[] = [];
  let cur = "intro";
  for (let guard = 0; guard < 300; guard++) {
    const list = screens(p, d);
    const here = list.find((x) => screenId(x) === cur);
    if (here === undefined) throw new Error(`画面が消えた: ${cur}`);
    if (here.kind === "review") break;
    if (here.kind === "intro") d = { ...d, started: true };
    if (here.kind === "consent") d = { ...d, answers: { ...d.answers, ...Object.fromEntries(p.consent.items.map((c) => [k(c.key), s.answers?.[k(c.key)] ?? v("given")])) } };
    if (here.kind === "document") {
      const want = s.documents?.[here.id];
      if (want === "notAvailable" || want === "later") d = { ...d, documents: { ...d.documents, [here.id]: { status: want, files: [] } } };
      else if (want !== undefined) {
        const files: DraftFile[] = [];
        for (const [i, seed] of want.photos.entries()) {
          const bytes = jpeg(seed);
          const up = await uploadFile(o, bytes, t);
          files.push({ fileId: up.fileId, mime: "image/jpeg", bytes: bytes.length, sha256: up.sha256, label: `写真 ${i + 1}` });
        }
        d = { ...d, documents: { ...d.documents, [here.id]: { status: "attached", files } } };
      }
    }
    // 選んだ書類の状態で画面の中身（かわりに聞く問い）が変わるので、もう一度並べてから答える
    const again = screens(p, d).find((x) => screenId(x) === cur) as Screen;
    for (const g of screenGates(again)) {
      const val = s.gates?.[g] ?? d.gates[g];
      if (val === undefined) throw new Error(`分岐の問いの答えが無い: ${g}`);
      d = { ...d, gates: { ...d.gates, [g]: val } };
    }
    const answers = { ...d.answers };
    for (const f of screenFields(again)) for (const key of fieldKeys(f)) if (s.answers?.[k(key, f.index)] !== undefined) answers[k(key, f.index)] = s.answers[k(key, f.index)] as DraftAnswer;
    d = { ...d, answers };
    // 答えた後の並び（答えで問いが出たり消えたりする）。空のまま「次へ」は「あとで」
    const after = screens(p, d);
    const at = after.findIndex((x) => screenId(x) === cur);
    const shown = after[at] as Screen;
    const marked = { ...d.answers };
    for (const f of screenFields(shown)) if (!fieldAnswered(d, f) && marked[k(f.key, f.index)] === undefined) marked[k(f.key, f.index)] = LATER;
    d = { ...d, answers: marked };
    if (shown.kind !== "intro") visited.push(shown);
    cur = screenId(after[at + 1] as Screen);
  }
  // 書類を先に送り（送りの番号は送るファイルから決まる）、答えを送る
  const pending = unsentFiles(d);
  if (pending.length > 0) d = markSent(d, await sendDocuments(o, pending, t, SENT), SENT.toISOString());
  await submitAnswers(o, answersOf(p, d, SENT), t);
  const final = screens(p, d).filter((x) => x.kind !== "intro" && x.kind !== "review");
  return { o, d, visited, final };
}

/** お客さまが答えの後に、同じ URL から書類を送る */
async function sendLater(w: Walked, t: RelayTransport, docId: string, seed: number): Promise<void> {
  const bytes = jpeg(seed);
  const up = await uploadFile(w.o, bytes, t);
  await sendDocuments(w.o, [{ id: docId, files: [{ fileId: up.fileId, mime: "image/jpeg", bytes: bytes.length, sha256: up.sha256, label: "写真 1" }] }], t, new Date("2026-11-08T09:00:00Z"));
}

// ---- 数 ----

/** 問いの画面の数（FP の画面の「問い N」と同じ単位: 問いの画面だけ。分岐の問い・同意・書類・確かめは入れない） */
const itemCount = (list: readonly Screen[]) => list.filter((x) => x.kind === "item").length;
/** 問いの画面に出た問い（draftKey。別の答え方の欄〔範囲・年齢〕も入れる） */
const shownKeys = (list: readonly Screen[]) => list.flatMap((x) => screenFields(x).flatMap((f) => fieldKeys(f).map((key) => k(key, f.index))));

/** FP の画面（WebBuilder.tsx）の「URL を発行する（問い N）」と同じ数え方 */
async function fpQuestionCount(wh: WorkingHousehold, sel: WebSelection): Promise<number> {
  const p = await previewPacket(wh, sel, OFFICE, NOW);
  return screens(p, initialDraft(p)).filter((x) => x.kind === "item").length;
}

/** お客さまが答えた問い（送る答えに入るはずのもの: 出ている問いの、「あとで」でない答え。月の無い生年月は送らない） */
function answeredKeys(p: QuestionsPacket, w: Walked): string[] {
  const types = new Map(p.items.map((i) => [i.key, i.type]));
  const out = [k(FILLED_ON), ...p.consent.items.map((c) => k(c.key))];
  for (const f of w.final.flatMap((x) => screenFields(x)))
    for (const key of fieldKeys(f)) {
      const a = w.d.answers[k(key, f.index)];
      if (a === undefined || a.status === "later") continue;
      if (a.status === "value" && types.get(key) === "yearMonth" && (a.raw2 === undefined || a.raw2.kind === "bool" || !/^\d{1,2}$/.test(a.raw2.text))) continue;
      out.push(k(key, f.index));
    }
  // 配偶者の方が「いらっしゃらない」: 配偶者の方の欄を「該当なし」にして送る（ページが入れる）
  if (w.d.gates.spouse === 0) for (const key of ["hs.family.adult.birthYearMonth", "hs.family.adult.age"]) if (p.items.some((i) => i.key === key && i.states.includes("notApplicable"))) out.push(k(key, 2));
  if (w.d.gates.spouse === 0 && p.items.some((i) => i.key === "hs.family.spouse.marriage")) out.push(k("hs.family.spouse.marriage"));
  return out.sort();
}

// ---- FP: 受け取って取り込む ----

interface Round {
  before: WorkingHousehold;
  w: Walked;
  entry: WebLogEntry;
  view: ImportView;
  after: WorkingHousehold;
  /** 受け取るたびに受け取ったもの（1回目は答えと、答えの前に送った書類。2回目は答えの後に送った書類） */
  takes: WebTaken[];
}

/** 発行して、お客さまが答え、FP が受け取ってサーバーから消し、既定のチェックのまま承認して取り込む */
async function round(wh: WorkingHousehold, sel: WebSelection, s: Script, then?: (w: Walked, t: RelayTransport) => Promise<void>): Promise<Round & { relay: ReturnType<typeof relayFor>; issued: WorkingHousehold }> {
  const relay = relayFor();
  const { t } = relay;
  const r = await issueWeb(wh, { selection: sel, customerNo: "A0042", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
  const w = await walk(r.entry.record.url, t, s);
  const got = await receiveWeb(r.wh, r.entry, t, NOW);
  if (got === null) throw new Error("受け取れない");
  await cleanupOnServer(got.entry, got.taken, t);
  let cur = got.wh;
  let entry = got.entry;
  const takes = [got.taken];
  if (then !== undefined) {
    await then(w, t);
    const more = await receiveWeb(cur, entry, t, new Date("2026-11-08T10:00:00Z"));
    if (more !== null) {
      await cleanupOnServer(more.entry, more.taken, t);
      cur = more.wh;
      entry = more.entry;
      takes.push(more.taken);
    }
  }
  const view = importWeb(cur, entry, "0.1.0", seq);
  const after = markImported(applyImport(cur, view, defaultSelection(view), AT).wh, entry.record.requestId, AT);
  return { before: wh, w, entry, view, after, takes, relay, issued: r.wh };
}

// ---- 毎回確かめること ----

/** 世帯の行（ID を持つ物）の ID の一覧（構成員・働き方・ローン・口座・保険・目標・生活費 など） */
function rowIds(wh: WorkingHousehold): string[] {
  const h = wh.request.input.household as unknown as Record<string, unknown>;
  const out: string[] = [];
  for (const [name, list] of Object.entries(h)) if (Array.isArray(list)) for (const x of list) if (typeof x === "object" && x !== null && typeof (x as { id?: unknown }).id === "string") out.push(`${name}/${(x as { id: string }).id}`);
  return out.sort();
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

/** 値のある末端の欄の道（世帯の行は ID で、行の中の並びは番号で）。null・空の並びは値の無い欄 */
function leafPaths(x: unknown, path: string, out: Map<string, unknown>): void {
  if (x === null || x === undefined) return;
  if (Array.isArray(x)) {
    x.forEach((e, i) => leafPaths(e, `${path}/${isObj(e) && typeof e.id === "string" && path.split("/").length === 2 ? e.id : String(i)}`, out));
    return;
  }
  if (isObj(x)) {
    for (const [key, val] of Object.entries(x)) leafPaths(val, `${path}/${key}`, out);
    return;
  }
  out.set(path, x);
}

/**
 * 今の世帯にあって、取り込みの後に無くなった欄（行が残っているのに欄の値が消えた所）。お客さまが答えた欄は値が変わってよいが、消えてはいけない。
 * 返すのは「行の一覧/欄」の形（何が消えたか読めるように、行の ID は外す）
 */
function lostFields(before: WorkingHousehold, after: WorkingHousehold): string[] {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  leafPaths(before.request.input.household, "", a);
  leafPaths(after.request.input.household, "", b);
  const rows = new Set(rowIds(after).map((r) => `/${r}`));
  const out = new Set<string>();
  for (const path of a.keys()) {
    const row = path.split("/").slice(0, 3).join("/");
    if (!rows.has(row) || b.has(path)) continue;
    out.add(path.split("/").filter((_, i) => i !== 2).join("/").replace(/\/\d+(?=\/|$)/g, "/n"));
  }
  return [...out].sort();
}

/** 取り込んだ後にアプリが開く世帯（App.tsx の openedFrom と同じ: 推定を入れ直し、新しく足した並びの要素に ID を振る） */
function opened(wh: WorkingHousehold): WorkingHousehold {
  const r = withRefreshedEstimates(wh);
  return { ...r, request: withElementIds(r.request, true) };
}

/** 世帯ファイルの本文に書いて、読み戻す */
function reopen(wh: WorkingHousehold): { text: string; back: WorkingHousehold; again: string } {
  const state = { wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }, carry: EMPTY_CARRY };
  const text = bodyOf(state);
  const back = fromBody(text).wh;
  return { text, back, again: bodyOf({ ...state, wh: back }) };
}

/** どの場合にも確かめること（1 今の行・お答えの無い所を残す、3 数、4 保存して読み戻す）。欄が消えないことは lostFields で、2 は見直しの場合で */
function checkEveryTime(x: Round): void {
  const p = x.w.o.packet;
  const e = webLog(x.after).find((y) => y.record.requestId === x.entry.record.requestId) as WebLogEntry;
  // 1. 今の世帯の行（人・働き方・ローン・口座・保険…）は1つも消えない
  expect(rowIds(x.before).filter((id) => !rowIds(x.after).includes(id))).toEqual([]);
  // お答えの無い候補（「あとで」・空のまま・出なかった問いだけの物）は、既定でチェックしない
  const sel = defaultSelection(x.view);
  expect(x.view.candidates.filter((c) => c.kind === "noAnswer" && sel.has(c.id)).map((c) => c.title)).toEqual([]);
  // 3. 通った画面が、送った答えの元の画面と同じ（答えの後で並びが変わって、見ていない問いの答えが入ったり、見た問いの答えが落ちたりしない）
  expect(x.w.visited.map(screenId)).toEqual(x.w.final.map(screenId));
  // お客さまが答えた問い ＝ 受け取った答え（捨てた答えは無い）
  expect(e.received?.dropped).toBe(0);
  expect((e.received?.answers ?? []).map((a) => k(a.key, a.index)).sort()).toEqual(answeredKeys(p, x.w));
  // 受け取った答えは、お客さまの画面に出た問いだけ（記入の年月・同意・ページが入れる「該当なし」を除く）
  const auto = new Set([k(FILLED_ON), ...p.consent.items.map((c) => k(c.key)), k("hs.family.adult.birthYearMonth", 2), k("hs.family.adult.age", 2), k("hs.family.spouse.marriage")]);
  const shown = new Set(shownKeys(x.w.final));
  expect((e.received?.answers ?? []).map((a) => k(a.key, a.index)).filter((key) => !auto.has(key) && !shown.has(key))).toEqual([]);
  // 4. 取り込みの後の世帯ファイルを保存して読み戻しても同じ（もう一度書いても同じ中身。欄の並びは問わない）
  const app = opened(x.after);
  const { text, back, again } = reopen(app);
  expect(JSON.parse(again)).toEqual(JSON.parse(text));
  expect(back.request).toEqual(app.request);
  expect(back.hearing).toEqual(app.hearing);
  expect(back.assumed).toEqual(app.assumed);
  expect(webLog(back).find((y) => y.record.requestId === e.record.requestId)).toEqual(e);
}

// ---- 1. 値の入った世帯に、シンプルの票 ----

/** 夫婦と子2人の世帯の答え（ご本人の生年月・年収、配偶者の方の年収、住まい） */
const SIMPLE_ANSWERS: Record<string, DraftAnswer> = {
  [k("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7),
  [k("hs.family.adult.sex", 1)]: v("male"),
  [k("hs.family.adult.birthYearMonth", 2)]: ym(1983, 10),
  [k("hs.family.child.birthYearMonth", 1)]: ym(2014, 5),
  [k("hs.family.child.birthYearMonth", 2)]: ym(2017, 9),
  [k("hs.work.type", 1)]: v("regular"),
  [k("hs.income.annual", 1)]: num("640"),
  [k("hs.work.type", 2)]: v("partTime"),
  [k("hs.income.annualRange", 2)]: v("100〜200万円"),
  [k("hs.housing.type")]: v("own"),
  [k("hs.loan.monthlyTotal")]: num("98000"),
  [k("hs.assets.depositTotal")]: num("850"),
};

describe("通しの点検: 値の入った世帯に、シンプルの票を送る", () => {
  const go = () => round(filled(), templateSelection(SIMPLE, filled()), { gates: { spouse: 1, child: 2, parent: 0 }, answers: SIMPLE_ANSWERS });

  it("一周して、毎回確かめることが通る。答えた所だけが変わり、答えていない所（生活費・保険料・投資）は今の値のまま", async () => {
    const x = await go();
    checkEveryTime(x);
    const h0 = x.before.request.input.household;
    const h = x.after.request.input.household;
    // 答えなかった生活費は今の値のまま
    expect(h.livingExpenses).toEqual(h0.livingExpenses);
    // 預貯金は答えた 850万円
    expect((h.accounts ?? []).find((a) => a.kind === "deposit")?.marketValue).toMatchObject({ value: 8500000 });
    // 粗い答え（毎月の返済額だけ・残高はまだ）は、詳しく入れてあった住宅ローンを残す
    expect(h.debts).toEqual(h0.debts);
  });

  it("お客さまの最初の画面の「N画面ほど」は、夫婦と子2人・ご両親ありで答えた画面の数と同じ", async () => {
    const { t } = relayFor();
    const wh = filled();
    const r = await issueWeb(wh, { selection: templateSelection(SIMPLE, wh), customerNo: "A1", office: OFFICE, pageUrl: "https://relay.test/h/", transport: t, now: NOW });
    const w = await walk(r.entry.record.url, t, { gates: { spouse: 1, child: 2, parent: 1 }, answers: SIMPLE_ANSWERS });
    expect(estimate(w.o.packet).screens).toBe(w.final.filter((x) => x.kind === "consent" || x.kind === "gate" || x.kind === "item").length);
  });

  it.fails("直す待ち（FP の画面）: FP の画面の「問い N」が、開いている世帯の人数（夫婦と子2人）でお客さまが答える問いの画面の数と同じ", async () => {
    const x = await go();
    // 今は、FP の画面は配偶者の方・お子さまのいない下書きで数える（夫婦と子2人の世帯で 9、お客さまは 10 画面）
    expect(await fpQuestionCount(x.before, templateSelection(SIMPLE, x.before))).toBe(itemCount(x.w.final));
  });

  it.fails("直す待ち（FP の画面）: 依頼の一覧の「答え N」が、お客さまが答えた問いの数と同じ（記入の年月・同意・ページが入れる「該当なし」を数えない）", async () => {
    const x = await go();
    const p = x.w.o.packet;
    const answered = x.w.final.flatMap((s) => screenFields(s)).filter((f) => fieldAnswered(x.w.d, f)).length;
    // WebRequests.tsx の受け取りの知らせ「答え N」と同じ数え方
    expect(x.entry.received?.answers.length).toBe(answered);
    expect(answered).toBe(answeredKeys(p, x.w).length - 1 - p.consent.items.length);
  });

  it("年収を答えた働き方の候補を承認しても、シートで聞かない欄（標準報酬月額・企業年金・失業給付）は消えない（0139 の追記 2026-11-09）", async () => {
    const x = await go();
    expect(lostFields(x.before, x.after)).toEqual([]);
  });
});

// ---- 2. 見直しの票（前回の値が入る） ----

describe("通しの点検: 見直しの票（前回の値が入る）", () => {
  const sel = () => templateSelection(REVIEW, filled());
  /** 前回の値のまま確かめて送る（ご両親のことは答えない） */
  const asIs = () => round(filled(), sel(), { gates: { parent: 0 } });

  it("前回の値のまま確かめて送ると、毎回確かめることが通る", async () => {
    checkEveryTime(await asIs());
  });

  it("答えた所（前回の値）に合わせて問いが飛ぶ: 持ち家なので家賃を聞かずローンを聞く。会社員のご本人に勤務時間を聞かず、パートの配偶者の方には聞く", async () => {
    const x = await asIs();
    const keys = shownKeys(x.w.final);
    expect(keys).not.toContain(k("hs.housing.rent"));
    for (const key of [k("hs.housing.propertyTax"), k("hs.loan.balance", 1), k("hs.loan.rate", 1)]) expect(keys).toContain(key);
    expect(keys).not.toContain(k("hs.work.weeklyHours", 1));
    expect(keys).toContain(k("hs.work.weeklyHours", 2));
    // 会社員なので事業の所得・会社とのお金は聞かない。お子さまは前回の2人の分だけ
    expect(keys.filter((key) => key.startsWith("hs.income.business") || key.startsWith("hs.company."))).toEqual([]);
    expect(keys).not.toContain(k("hs.education.after", 3));
    // 前回の値が無ければ（同じ票を空の下書きで）、飛ばさずに出す問いがある
    const p = x.w.o.packet;
    const empty = screens(p, { ...initialDraft(p), answers: {}, gates: { spouse: 1, child: 2, loan: 1, policy: 1, parent: 0 } });
    expect(shownKeys(empty)).toContain(k("hs.housing.rent"));
    expect(shownKeys(empty)).toContain(k("hs.work.weeklyHours", 1));
  });

  it("見直しで答えを変えると（持ち家→賃貸）、ローンの問いが消え、前回のローンの値は送らない。今のローンは消えない", async () => {
    const x = await round(filled(), sel(), { gates: { parent: 0 }, answers: { [k("hs.housing.type")]: v("rent"), [k("hs.housing.rent")]: num("120000") } });
    checkEveryTime(x);
    const keys = shownKeys(x.w.final);
    expect(keys.filter((key) => key.startsWith("hs.loan.") || key.startsWith("hs.housing.propertyTax"))).toEqual([]);
    expect(keys).toContain(k("hs.housing.rent"));
    expect((x.entry.received?.answers ?? []).filter((a) => a.key.startsWith("hs.loan."))).toEqual([]);
    expect(x.after.request.input.household.debts).toEqual(x.before.request.input.household.debts);
  });

  it("FP の画面の「問い N」は、前回の値の分かる見直しなら、同じ家族（ご両親4人がご健在と答える）でお客さまが答える問いの画面の数と同じ", async () => {
    const alive = Object.fromEntries([1, 2, 3, 4].map((i) => [k("hs.family.parent.alive", i), v("alive")]));
    const x = await round(filled(), sel(), { gates: { parent: 1 }, answers: alive });
    expect(await fpQuestionCount(x.before, sel())).toBe(itemCount(x.w.final));
  });

  it.fails("直す待ち（FP の画面）: 見直しで、ご両親のことを「答えない」と答えた方の問いの画面の数と、FP の画面の「問い N」が同じ（FP の数は、答えで変わる幅が分かる言い方にする）", async () => {
    // 今は、FP の画面はご両親4人の問いを数える（98）。お客さまが「答えない」を選ぶと 89 画面
    const x = await asIs();
    expect(await fpQuestionCount(x.before, sel())).toBe(itemCount(x.w.final));
  });

  it("前回の値のまま送ると、変更の候補が出ない（既定でチェックの付く物が無い。0139 の追記 2026-11-09）", async () => {
    const x = await asIs();
    const sel = defaultSelection(x.view);
    expect(x.view.candidates.filter((c) => sel.has(c.id)).map((c) => `${c.kind}: ${c.title}`)).toEqual([]);
  });

  it("答えていない配偶者の方の住民税から、新しい行（推定の0円）を入れない（お答えなし。0139 の追記 2026-11-09）", async () => {
    // 前は、空のまま「次へ」にした配偶者の方の住民税が「新規」の候補（推定 0円）になり、既定でチェックが付いた
    const x = await asIs();
    expect((x.entry.received?.answers ?? []).filter((a) => a.key === "hs.income.residentTax" && a.index === 2)).toEqual([]);
    const sel = defaultSelection(x.view);
    expect(x.view.candidates.filter((c) => c.kind === "new" && sel.has(c.id)).map((c) => c.title)).toEqual([]);
  });

  it("前回の値のまま送って既定のまま承認しても、今の世帯の欄は消えない（住まいの評価と持ち分・教育の塾と受験・取得価額・生活費の段階など。0139 の追記 2026-11-09）", async () => {
    const x = await asIs();
    expect(lostFields(x.before, x.after)).toEqual([]);
  });
});

// ---- 3. 「あとで」・空のまま次へ、が混ざる答え ----

describe("通しの点検: 「あとで」と空のまま「次へ」が混ざる答え", () => {
  it("答えた所だけが変わる。「あとで」（預貯金・ご本人の年収）と空のまま（配偶者の方の年収・第2子・投資・生活費・保険料・ローン）は今の値のまま", async () => {
    const x = await round(filled(), templateSelection(SIMPLE, filled()), {
      gates: { spouse: 1, child: 2, parent: 0 },
      answers: {
        [k("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7),
        [k("hs.family.child.birthYearMonth", 1)]: ym(2014, 5),
        [k("hs.work.type", 1)]: v("regular"),
        [k("hs.income.annual", 1)]: LATER,
        [k("hs.work.type", 2)]: v("partTime"),
        [k("hs.housing.type")]: v("own"),
        [k("hs.assets.depositTotal")]: LATER,
      },
    });
    checkEveryTime(x);
    const h0 = x.before.request.input.household;
    const h = x.after.request.input.household;
    // 「あとで」・空のままの答えは送らない
    const sent = (x.entry.received?.answers ?? []).map((a) => k(a.key, a.index));
    for (const key of [k("hs.income.annual", 1), k("hs.income.annual", 2), k("hs.assets.depositTotal"), k("hs.expense.living"), k("hs.family.child.birthYearMonth", 2)]) expect(sent).not.toContain(key);
    expect(x.w.d.answers[k("hs.expense.living")]).toEqual(LATER);
    // 今の値のまま
    expect((h.accounts ?? []).find((a) => a.kind === "deposit")?.marketValue).toEqual((h0.accounts ?? []).find((a) => a.kind === "deposit")?.marketValue);
    expect(h.livingExpenses).toEqual(h0.livingExpenses);
    expect(h.debts).toEqual(h0.debts);
    expect(h.insuranceContracts).toEqual(h0.insuranceContracts);
    const salary = (hh: typeof h) => (hh.employmentPeriods ?? []).map((p) => [p.member, p.salary?.annual]);
    expect(salary(h)).toEqual(salary(h0));
    const kid2 = h0.members.filter((m) => m.kind === "child")[1];
    expect(h.members.find((m) => m.id === kid2?.id)?.birth).toEqual(kid2?.birth);
  });

  it("全部を「あとで」・空のままにして送ると、FP が全部にチェックを入れて承認しても、今の世帯は何も変わらない", async () => {
    const wh = filled();
    const relay = relayFor();
    const r = await issueWeb(wh, { selection: templateSelection(SIMPLE, wh), customerNo: "A1", office: OFFICE, pageUrl: "https://relay.test/h/", transport: relay.t, now: NOW });
    const w = await walk(r.entry.record.url, relay.t, { gates: { spouse: 1, child: 2, parent: 0 } });
    const got = await receiveWeb(r.wh, r.entry, relay.t, NOW);
    const view = importWeb(got!.wh, got!.entry, "0.1.0", seq);
    const after = markImported(applyImport(got!.wh, view, new Set(view.candidates.map((c) => c.id)), AT).wh, got!.entry.record.requestId, AT);
    checkEveryTime({ before: wh, w, entry: got!.entry, view, after, takes: [got!.taken] });
    expect(view.candidates.filter((c) => c.kind !== "noAnswer" && c.kind !== "same").map((c) => `${c.kind}: ${c.title}`)).toEqual([]);
    expect(after.request.input).toEqual(wh.request.input);
    expect(after.assumed).toEqual(wh.assumed);
  });
});

// ---- 4. 書類つき ----

describe("通しの点検: 書類つき（源泉徴収票をご本人と配偶者の方の分・ねんきん定期便）", () => {
  const sel = () => {
    const s0 = templateSelection(SIMPLE, filled());
    const d1 = documentFromTemplate(s0, "withholding", "self");
    const s1 = { ...s0, documents: [d1] };
    const d2 = documentFromTemplate(s1, "withholding", "spouse");
    const s2 = { ...s1, documents: [d1, d2] };
    return { ...s2, documents: [d1, d2, documentFromTemplate(s2, "pensionNotice", "self")] };
  };
  /** ご本人の源泉徴収票は写真2枚・配偶者の方の分は「手元にない」（かわりに年収の範囲）・ねんきん定期便は「あとで送る」（答えの後に送る） */
  const go = () =>
    round(filled(), sel(), { gates: { spouse: 1, child: 2, parent: 0 }, answers: { ...SIMPLE_ANSWERS, [k("hs.income.annual", 1)]: num("640"), [k("hs.income.annualRange", 2)]: v("100〜200万円") }, documents: { d1: { photos: [3, 5] }, d2: "notAvailable", d3: "later" } }, (w, t) => sendLater(w, t, "d3", 7));

  it("一周して、毎回確かめることが通る", async () => {
    checkEveryTime(await go());
  });

  it("頼んだ書類で分かる問い（年収）は問いの画面に出ない。「手元にない」を選んだ配偶者の方の分だけ、その書類の画面で聞く", async () => {
    const x = await go();
    const items = x.w.final.filter((s) => s.kind === "item");
    expect(shownKeys(items).filter((key) => key.startsWith("hs.income.annual"))).toEqual([]);
    const doc = (id: string) => x.w.final.find((s) => s.kind === "document" && s.id === id) as Extract<Screen, { kind: "document" }>;
    expect(shownKeys([doc("d1")])).toEqual([]);
    expect(shownKeys([doc("d2")])).toEqual([k("hs.income.annual", 2), k("hs.income.annualRange", 2)]);
    expect(shownKeys([doc("d3")])).toEqual([]);
    // 届いた答え: 配偶者の方は書類の画面で答えた年収の範囲。ご本人の年収は（下書きに残っていても）送らない
    const sent = (x.entry.received?.answers ?? []).map((a) => k(a.key, a.index));
    expect(sent).toContain(k("hs.income.annualRange", 2));
    expect(sent.filter((key) => key.endsWith("#1") && key.startsWith("hs.income."))).toEqual([]);
    // 書類で分かるはずのご本人の給与は、今の値のまま
    const self = x.before.request.input.household.members.find((m) => m.kind === "self")?.id;
    const salary = (h: WorkingHousehold) => (h.request.input.household.employmentPeriods ?? []).filter((p) => p.member === self).map((p) => p.salary?.annual);
    expect(salary(x.after)).toEqual(salary(x.before));
  });

  it("書類は答えと別に届く: 答えには状態だけ。ファイルは書類の送りで届き、答えの後に送った分は次の受け取りで届く", async () => {
    const x = await go();
    expect(x.entry.received?.documents).toEqual([
      { id: "d1", status: "attached" },
      { id: "d2", status: "notAvailable" },
      { id: "d3", status: "later" },
    ]);
    expect(JSON.stringify(x.entry.received)).not.toContain("fileId");
    // 1回目: 答えと、答えの前に送った写真2枚（1回分）。2回目: 答えの後に送った1枚だけ（答えは受け取り済み）
    expect(x.takes.map((tk) => ({ answers: tk.answers, batches: tk.batches.length, files: tk.files }))).toEqual([
      { answers: true, batches: 1, files: 2 },
      { answers: false, batches: 1, files: 1 },
    ]);
    expect(x.entry.batches?.map((b) => b.documents)).toEqual([[{ id: "d1", files: 2 }], [{ id: "d3", files: 1 }]]);
    const docs = receivedDocuments(x.after);
    expect(docs.map((d) => [d.doc.id, d.answer?.status, d.files.length])).toEqual([
      ["d1", "attached", 2],
      ["d2", "notAvailable", 0],
      ["d3", "later", 1],
    ]);
    // サーバーには依頼の記録と問いだけ（受け取った答え・書類の送り・ファイルは消えた）
    expect([...x.relay.store.dump().keys()].filter((key) => !key.startsWith("m/") && !key.endsWith("/q"))).toEqual([]);
  });
});

// ---- 5. 分岐の答えが今の世帯と違う ----

describe("通しの点検: 分岐の答え（お子さまの人数・配偶者の方）が今の世帯と違う", () => {
  const go = (gates: Partial<Record<GateId, number>>, answers: Record<string, DraftAnswer> = {}) => round(filled(), templateSelection(SIMPLE, filled()), { gates: { parent: 0, ...gates }, answers: { [k("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7), ...answers } });

  it("お子さま3人（今は2人）: 3人目は新しい候補。今の2人は消えず、知らせが出る", async () => {
    const x = await go({ spouse: 1, child: 3 }, { [k("hs.family.child.birthYearMonth", 1)]: ym(2012, 5), [k("hs.family.child.birthYearMonth", 2)]: ym(2015, 8), [k("hs.family.child.birthYearMonth", 3)]: ym(2027, 3) });
    checkEveryTime(x);
    expect(x.view.gates.map((g) => g.text)).toEqual(["お子さまは3人とのお答え（今の世帯は2人）"]);
    expect(x.view.candidates.filter((c) => c.group === "家族" && c.title.endsWith("子")).map((c) => `${c.kind}: ${c.title}`)).toEqual(["same: 第1子", "same: 第2子", "new: 第3子"]);
    const kids = x.after.request.input.household.members.filter((m) => m.kind === "child");
    expect(kids.map((m) => m.birth.birthYearMonth)).toEqual(["2012-05", "2015-08", "2027-03"]);
  });

  it("お子さま3人と答え、3人目（出産の予定）の生年月だけを答えても、今の第1子の生年月は書き換わらない（問いの順で当てる。0139 の追記 2026-11-09）", async () => {
    // 前は、答えのあるお子さまだけを生まれの順に今の子へ当てたので、3人目の答えが第1子に当たり、第1子の生年月が 2027年3月（まだいない家族）になった
    const x = await go({ spouse: 1, child: 3 }, { [k("hs.family.child.birthYearMonth", 3)]: ym(2027, 3) });
    const before = x.before.request.input.household.members.filter((m) => m.kind === "child").map((m) => [m.id, m.birth.birthYearMonth]);
    const after = x.after.request.input.household.members.filter((m) => m.kind === "child").map((m) => [m.id, m.birth.birthYearMonth]);
    expect(after.slice(0, 2)).toEqual(before);
  });

  it("お子さま1人（今は2人）: 2人目の問いは出ず、2人目は消えない。知らせが出る", async () => {
    const x = await go({ spouse: 1, child: 1 });
    checkEveryTime(x);
    expect(shownKeys(x.w.final)).not.toContain(k("hs.family.child.birthYearMonth", 2));
    expect(x.view.gates.map((g) => g.text)).toEqual(["お子さまは1人とのお答え（今の世帯は2人）"]);
    expect(x.after.request.input.household.members.filter((m) => m.kind === "child").map((m) => m.id)).toEqual(x.before.request.input.household.members.filter((m) => m.kind === "child").map((m) => m.id));
  });

  it("配偶者の方「いらっしゃらない」（今はいる）: 配偶者の方の問いは出ず、配偶者の方と働き方は消えない。知らせが出る", async () => {
    const x = await go({ spouse: 0, child: 2 });
    checkEveryTime(x);
    expect(shownKeys(x.w.final).filter((key) => key.endsWith("#2") && (key.startsWith("hs.family.adult.") || key.startsWith("hs.work.")))).toEqual([]);
    expect(x.view.gates.map((g) => g.text)).toEqual(["配偶者はいないとのお答え（今の世帯にはいます）"]);
    const spouse = x.before.request.input.household.members.find((m) => m.kind === "spouse");
    expect(x.after.request.input.household.members.find((m) => m.id === spouse?.id)).toEqual(spouse);
  });
});

// ---- 6. 取り込みで今の値を壊さない（記録のある欄だけを重ねる・お答えの無い新しい行・お子さまの当て方。0139 の追記 2026-11-09） ----

describe("通しの点検: 承認しても、答えた欄だけが変わる（記録のある欄だけを今の行に重ねる）", () => {
  const self = (wh: WorkingHousehold) => wh.request.input.household.members.find((m) => m.kind === "self")?.id as string;
  const selfWork = (wh: WorkingHousehold) => (wh.request.input.household.employmentPeriods ?? []).find((p) => p.member === self(wh)) as unknown as Record<string, unknown>;

  it("シンプルの票で年収を答えると、給与は届いた値になり、標準報酬月額・企業年金・失業給付は今の値のまま。候補に、聞かない欄は今のままと添える", async () => {
    const x = await round(filled(), templateSelection(SIMPLE, filled()), { gates: { spouse: 1, child: 2, parent: 0 }, answers: SIMPLE_ANSWERS });
    const before = selfWork(x.before);
    const after = selfWork(x.after);
    expect((after.salary as { annual: { value: number } }).annual.value).not.toBe((before.salary as { annual: { value: number } }).annual.value);
    for (const key of ["standardMonthlyRemuneration", "corporatePension", "unemploymentClaim", "healthInsurance", "employer", "from", "to"]) expect(after[key]).toEqual(before[key]);
    const c = x.view.candidates.find((y) => y.title === "ご本人の仕事と収入");
    expect(c?.kind).toBe("changed");
    expect(c?.note).toContain("標準報酬月額・企業年金など、シートでお聞きしていない欄は今の値のまま");
  });

  it("見直しで進路の答えを変えると、同じ学校の要素の ID と受験の費用・塾は今のまま。違う学校にすると、前の学校の受験の費用は持ち越さない", async () => {
    const goal = (wh: WorkingHousehold, i: number) => (wh.request.input.household.goals ?? []).find((g) => g.owner === wh.request.input.household.members.filter((m) => m.kind === "child")[i]?.id) as unknown as { education: { stages: Record<string, unknown>[]; lessons?: unknown[] } };
    const x = await round(filled(), templateSelection(REVIEW, filled()), { gates: { parent: 0 }, answers: { [k("hs.education.after", 1)]: v("privateScience"), [k("hs.education.living", 1)]: v("home"), [k("hs.education.after", 2)]: v("vocational") } });
    checkEveryTime(x);
    const a0 = goal(x.before, 0).education;
    const a1 = goal(x.after, 0).education;
    expect(a1.stages[2]).toEqual({ ...a0.stages[2], field: "science", living: "home" });
    expect(a1.lessons).toEqual(a0.lessons);
    const b1 = goal(x.after, 1).education;
    expect(b1.stages.map((s) => s.stage)).toEqual(["elementary", "juniorHigh", "highSchool", "vocational"]);
    expect(b1.stages[3]?.exam).toBeUndefined();
    expect(b1.stages.slice(0, 3)).toEqual(goal(x.before, 1).education.stages.slice(0, 3));
  });

  it("聞かない欄の仮の印は残し、答えた欄の仮の印だけを外す", async () => {
    const wh = filled();
    const period = selfWork(wh).id as string;
    const deposit = (wh.request.input.household.accounts ?? []).find((a) => a.kind === "deposit")?.id as string;
    // 勤務先の従業員数（見直しで答える）・預貯金の利回り（シートで聞かない）に仮の印がある世帯
    const marked: WorkingHousehold = { ...wh, assumed: { ...wh.assumed, [`work/period/${period}/size`]: "仮の値（FP）", [`sav/${deposit}/rate`]: "仮の値（FP）" } };
    const x = await round(marked, templateSelection(REVIEW, marked), { gates: { parent: 0 }, answers: { [k("hs.work.employerSize", 1)]: num("500"), [k("hs.assets.deposit", 1)]: num("900") } });
    expect(x.after.assumed[`work/period/${period}/size`]).toBeUndefined();
    expect(x.after.assumed[`sav/${deposit}/rate`]).toBe("仮の値（FP）");
    expect(lostFields(x.before, x.after)).toEqual([]);
  });

  it("FP が全部にチェックを入れて承認しても、今の世帯の欄は消えない（住宅ローン控除の条件の取得価額・持ち分も残る）", async () => {
    const wh = filled();
    const relay = relayFor();
    const r = await issueWeb(wh, { selection: templateSelection(REVIEW, wh), customerNo: "A1", office: OFFICE, pageUrl: "https://relay.test/h/", transport: relay.t, now: NOW });
    await walk(r.entry.record.url, relay.t, { gates: { parent: 0 } });
    const got = await receiveWeb(r.wh, r.entry, relay.t, NOW);
    const view = importWeb(got!.wh, got!.entry, "0.1.0", seq);
    const after = applyImport(got!.wh, view, new Set(view.candidates.map((c) => c.id)), AT).wh;
    expect(lostFields(wh, after)).toEqual([]);
    const housing = (h: WorkingHousehold) => (h.request.input.household.debts ?? [])[0]?.housing;
    expect(housing(after)).toMatchObject({ acquisitionCost: housing(wh)?.acquisitionCost, ownership: housing(wh)?.ownership });
  });
});

describe("通しの点検: お答えの無い新しい行・お子さまの当て方", () => {
  const taxes = (wh: WorkingHousehold) => (wh.request.input.household.residentTaxAssessments ?? []) as { id: string; member: string }[];
  it("答えていない配偶者の方の住民税は、全部にチェックを入れて承認しても入らない（お答えなし: 今は入れていない）", async () => {
    const wh = filled();
    const relay = relayFor();
    const r = await issueWeb(wh, { selection: templateSelection(REVIEW, wh), customerNo: "A1", office: OFFICE, pageUrl: "https://relay.test/h/", transport: relay.t, now: NOW });
    await walk(r.entry.record.url, relay.t, { gates: { parent: 0 } });
    const got = await receiveWeb(r.wh, r.entry, relay.t, NOW);
    const view = importWeb(got!.wh, got!.entry, "0.1.0", seq);
    const tax = view.candidates.find((c) => c.title === "配偶者の住民税");
    expect(tax?.kind).toBe("noAnswer");
    expect(tax?.fields.flatMap((f) => f.diffs)).toEqual([{ label: "住民税の年税額", current: "入れていない", next: "入れていない", kept: true, rough: false }]);
    const after = applyImport(got!.wh, view, new Set(view.candidates.map((c) => c.id)), AT).wh;
    const spouse = wh.request.input.household.members.find((m) => m.kind === "spouse")?.id;
    expect(taxes(after).filter((a) => a.member === spouse)).toEqual([]);
    expect(taxes(after).map((a) => a.id)).toEqual(taxes(wh).map((a) => a.id));
  });

  it("今いる配偶者の方の働き方が新しく入るときは、答えの無い住民税の推定も一緒に入る（新しい働き方の計算に要る）", async () => {
    const base = filled();
    const spouse = base.request.input.household.members.find((m) => m.kind === "spouse")?.id;
    const wh: WorkingHousehold = { ...base, request: { ...base.request, input: { ...base.request.input, household: { ...base.request.input.household, employmentPeriods: (base.request.input.household.employmentPeriods ?? []).filter((p) => p.member !== spouse) } } } };
    const x = await round(wh, templateSelection(REVIEW, wh), { gates: { parent: 0 }, answers: { [k("hs.work.type", 2)]: v("partTime"), [k("hs.work.since", 2)]: ym(2020, 4), [k("hs.income.salary", 2)]: num("180") } });
    const kinds = x.view.candidates.filter((c) => c.title.startsWith("配偶者の")).map((c) => `${c.kind}: ${c.title}`);
    expect(kinds).toContain("new: 配偶者の仕事と収入");
    expect(kinds).toContain("new: 配偶者の住民税");
    expect(taxes(x.after).filter((a) => a.member === spouse)).toHaveLength(1);
  });

  it("お子さま3人と答え、3人目だけ生年月を答えると、3人目は新しいお子さまの候補で、今の2人の候補は無い", async () => {
    const x = await round(filled(), templateSelection(SIMPLE, filled()), { gates: { parent: 0, spouse: 1, child: 3 }, answers: { [k("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7), [k("hs.family.child.birthYearMonth", 3)]: ym(2027, 3) } });
    checkEveryTime(x);
    expect(x.view.candidates.filter((c) => c.group === "家族" && c.title.endsWith("子")).map((c) => `${c.kind}: ${c.title}`)).toEqual(["new: 第3子"]);
    expect(x.after.request.input.household.members.filter((m) => m.kind === "child").map((m) => m.birth.birthYearMonth)).toEqual(["2012-05", "2015-08", "2027-03"]);
  });

  it("2人目だけ生年月を答え直すと、今の第2子に当たる（第1子は変わらない）", async () => {
    const x = await round(filled(), templateSelection(SIMPLE, filled()), { gates: { parent: 0, spouse: 1, child: 2 }, answers: { [k("hs.family.adult.birthYearMonth", 1)]: ym(1981, 7), [k("hs.family.child.birthYearMonth", 2)]: ym(2015, 9) } });
    checkEveryTime(x);
    const kids = (wh: WorkingHousehold) => wh.request.input.household.members.filter((m) => m.kind === "child").map((m) => [m.id, m.birth.birthYearMonth, m.leaves]);
    const before = kids(x.before);
    expect(kids(x.after)).toEqual([before[0], [before[1]?.[0], "2015-09", before[1]?.[2]]]);
  });
});
