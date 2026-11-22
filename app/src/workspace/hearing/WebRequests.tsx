// Web のヒアリング（0125・0158）の依頼の一覧: 発行済み・回答あり・受け取り済み・取り込み済み・期限切れ。答えと書類を受け取って開き（受け取った分は
// サーバーから消す）、取り込みの画面で候補として承認する。書類は答えと別に、期限まで何回でも届く（受け取るたびに送りごとの記録を残す）。
// 期限の延長（押した日から30日・発行した日から90日まで）。受け取った書類は、その世帯の書類として開く・保存する・消す。
// - 「開く」は入力のホームの見る枠（DocViewer.tsx。写真も PDF も。拡大・回転・ページ送り）に出す。見る枠の無い所（入力のホームの外）では、
//   写真をこの中に描く（img の URL にしない。0016。バイトを createImageBitmap で絵にしてキャンバスに描く）
// - 保存は受け取った書類の一覧と同じ名前・同じ印（0191）
// - 0192: 届いたかは開いたときと決まった間隔で確かめ、アプリを開いている間は覚える（画面を閉じても消えない）。行に何を頼んだか（ひな形・項目の数・
//   書類・顧客番号）。送られた内容を、お客さまが見たのと同じ並びで見る・印刷する
// - 0222: AI から発行した依頼の行に「出どころ AI」（発行の日時と AI のアプリの名乗り）。取り消しは FP の画面で発行した依頼と同じ
// - 0192 の追記（2026-11-17）: 行の形を段階で分けた（rowMode）。回答が届いたら「受け取る」「取り消す」だけ。「受け取る」で、そのまま取り込みの
//   候補の画面へ。取り消す・受け付けを終えるは、どの段階でも1回確かめる。取り込み済みは1行にたたむ（送られた内容・書類はたたんだ行から開ける）。
//   書類を「あとで送る」の書類待ちがあれば、期限まで書類待ちの段を出す
// - 0192 の追記（2026-11-18）: 取り込み済みの依頼は一覧から外す（web.ts の listed。書類待ち・届いた書類があれば期限まで残す。一覧が空なら枠ごと
//   出さない）。外した依頼の送られた内容は、取り込み済みの回答（ImportedAnswers。「事前ヒアリングを取り込む」の下）から見る・印刷する
// - 0222 の追記（2026-11-20）: 利用者の判断で、名前を「発行した URL」に改め、FP が URL生成で作った URL と、AI が発行してこの世帯に結びついた URL を
//   1つの表に並べる（行は issuedUrls.ts の issuedRows。新しい順）。行の作った側の印は「FP が作成」「AI が発行」。まだ世帯のファイルに移っていない AI の
//   依頼（閲覧だけで開いた世帯など）は、状態と「AI が発行した URL で確かめる」だけの行。取り込み済みの回答と、まだ世帯の決まっていない AI の URL の
//   リンクは、この表の下に置く（どれも無ければ枠ごと出さない）

import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SentAnswers } from "../../hearingForm/Form.tsx";
import type { HearingWebHost } from "../../engine/host.ts";
import type { WorkingHousehold } from "../input/household.ts";
import type { ImportView } from "./sheet.ts";
import { useDocView } from "./ReceivedDocs.tsx";
import { AiUnassignedLink } from "../ai/AiHearingIssued.tsx";
import { issuedRows, unassignedLink, type IssuedAi, type IssuedRow } from "./issuedUrls.ts";
import { takeFocus, wantedFocus } from "./bell.ts";
import { accepting, answeredScreens, arrivalOf, checkAnswered, checkArrivals, cleanupOnServer, documentFileName, extendState, extendWeb, fileBytes, gateLines, importedEntries, importWeb, invitationText, limitOf, noteArrival, onArrivals, packetOf, receivedDraft, receiveWeb, removeOnServer, rowMode, selectedCount, selectionName, sentAtText, STATUS_TEXT, statusOf, waitingDocuments, webLog, withoutFile, withWebEntry, type StoredDocumentFile, type WebLogEntry } from "./web.ts";

interface Props {
  wh: WorkingHousehold;
  web: HearingWebHost;
  officeName: string;
  appVersion: string;
  onSave: (wh: WorkingHousehold) => void;
  saveNow: () => Promise<boolean>;
  /** 取り込みの候補の画面を開く（received は「受け取る」から直に来たときの受け取りの知らせ） */
  onImport: (view: ImportView, requestId: string, submittedAt: string | null, received?: string) => void;
  /** AI が発行した URL（AI からの発行を受けられる画面だけ。readOnly は閲覧だけで開いた世帯、onOpen は「AI が発行した URL」を開く） */
  ai?: IssuedAi & { readOnly: boolean; onOpen: () => void };
}

const DOC_STATUS: Record<string, string> = { attached: "届いた", notAvailable: "手元にない", later: "あとで送る", blank: "まだ" };

function DocImage({ f }: { f: StoredDocumentFile }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [fail, setFail] = useState(false);
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const bmp = await createImageBitmap(new Blob([fileBytes(f)], { type: f.mime }));
        const c = ref.current;
        if (!live || c === null) return;
        const k = Math.min(1, 900 / bmp.width);
        c.width = Math.round(bmp.width * k);
        c.height = Math.round(bmp.height * k);
        c.getContext("2d")?.drawImage(bmp, 0, 0, c.width, c.height);
        bmp.close();
      } catch {
        if (live) setFail(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [f.fileId]);
  if (fail) return <p class="rp-note">この画面では表示できない形です（HEIC など）。「保存」して開いてください。</p>;
  return <canvas ref={ref} class="wr-img" aria-label="受け取った書類の画像" />;
}

/** 送られた内容（お客さまが見たのと同じ並び・同じ言葉。見るだけ）と印刷 */
function SentView({ e }: { e: WebLogEntry }) {
  const packet = useMemo(() => packetOf(e), [e.record.requestId]);
  const draft = useMemo(() => receivedDraft(e), [e]);
  useEffect(() => {
    const done = () => document.body.classList.remove("printing-answers");
    window.addEventListener("afterprint", done);
    return () => {
      window.removeEventListener("afterprint", done);
      done();
    };
  }, []);
  if (packet === null || draft === null) return <p class="rp-note">送られた内容を出せませんでした（この版のアプリが知らない票です）。</p>;
  const print = () => {
    document.body.classList.add("printing-answers");
    if (typeof window.print === "function") window.print();
  };
  return (
    <div class="wr-answers" data-web-answers>
      <div class="wr-h">
        <b>
          お客さまが送った内容（{e.record.requestId}・{e.received !== undefined ? sentAtText(e.received.submittedAt) : ""}）
        </b>
        <button type="button" class="link-btn" onClick={print} data-web-answers-print>
          印刷
        </button>
      </div>
      <div class="hf wr-answers-list">
        <SentAnswers packet={packet} draft={draft} />
      </div>
      <p class="rp-note">「あとで」にした問い・空のままの問いは「（まだ）」と出ます。印刷したものは暗号化されません。保管に気をつけてください。</p>
    </div>
  );
}

const day = (iso: string) => new Date(iso).toLocaleDateString("ja-JP");
const dayTime = (iso: string) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** 作った側の印（FP が URL生成で作った依頼は「FP が作成」、AI が発行した依頼は「AI が発行」。発行の日時と AI のアプリの名乗りは添え書きに） */
function byBadge(e: WebLogEntry) {
  if (e.origin?.kind === "ai")
    return (
      <span class="hs-kind wr-origin ai" title={`AI が発行しました（${dayTime(e.origin.at)}${e.origin.connector !== null ? `・${e.origin.connector}` : ""}）`} data-web-origin="ai">
        AI が発行
      </span>
    );
  return (
    <span class="hs-kind wr-origin" data-web-origin="fp">
      FP が作成
    </span>
  );
}

/** まだ世帯のファイルに移っていない、AI が発行した依頼の行（事務所データ。状態と、「AI が発行した URL」で確かめるだけ） */
function OfficeRow({ row, now, readOnly, onOpen }: { row: IssuedRow; now: Date; readOnly: boolean; onOpen: () => void }) {
  const e = row.entry;
  const st = statusOf(e, now, arrivalOf(row.requestId)?.submitted === true);
  const arrived = accepting(e, now) && ((a) => a !== undefined && (a.answers || a.batches > 0))(arrivalOf(row.requestId));
  return (
    <li class={`wr-row st-${st}`} data-web-request={row.requestId} data-web-status={st} data-web-place="office">
      <div class="wr-h">
        <b>{row.requestId}</b>
        <span class={`hs-kind wr-st ${st}`}>{STATUS_TEXT[st]}</span>
        {byBadge(e)}
        {arrived ? (
          <span class="hs-kind wr-st answered" data-web-arrived>
            届いています
          </span>
        ) : null}
        <small>
          発行 {day(e.record.issuedAt)}・期限 {day(e.record.expiresAt)}
        </small>
      </div>
      <p class="rp-note wr-what">
        {selectionName(e.record.selection)}（聞く項目 {selectedCount(e.record.selection)}）・
        {readOnly ? "閲覧だけで開いているため、この世帯のファイルにはまだ移していません（編集できる状態で開くと移り、受け取り・取り込みができます）" : "この世帯のファイルに移す前の依頼です（世帯を保存できると移り、受け取り・取り込みができます）"}
      </p>
      <div class="rp-actions">
        <button type="button" class="btn" onClick={onOpen} data-web-office-open>
          AI が発行した URL で確かめる
        </button>
      </div>
    </li>
  );
}

export function WebRequests({ wh, web, officeName, appVersion, onSave, saveNow, onImport, ai }: Props) {
  const rows = issuedRows(wh, new Date(), ai);
  const list = rows.filter((r) => r.place === "household").map((r) => r.entry);
  const imported = importedEntries(wh);
  const unassigned = ai !== undefined ? unassignedLink(ai.store, new Date()).count : 0;
  // 届いたかの確かめの結果は、アプリを開いている間覚える（web.ts の arrivals。画面を閉じても消えない。0192）
  const [, setTick] = useState(0);
  useEffect(() => onArrivals(() => setTick((n) => n + 1)), []);
  // 開いたときに、受け付けている依頼を確かめる（まだ確かめていない依頼があるときだけ）
  useEffect(() => {
    const now0 = new Date();
    if (webLog(wh).some((e) => accepting(e, now0) && arrivalOf(e.record.requestId) === undefined)) void checkArrivals(wh, web.call).catch(() => undefined);
  }, []);
  const answeredOf = (id: string) => arrivalOf(id)?.submitted === true;
  /** 確かめたら、まだ受け取っていない答えか書類の送りがあった（「受け取る」を出す） */
  const arrivedOf = (id: string) => {
    const a = arrivalOf(id);
    return a !== undefined && (a.answers || a.batches > 0);
  };
  const [answersOpen, setAnswersOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  /** たたんだ行（取り込み済み・取り消し・期限切れ）のうち、開いて詳しく見ている行 */
  const [unfolded, setUnfolded] = useState<string | null>(null);
  /** 入力のホームの見る枠と、受け取った書類の一覧の保存（あれば使う。0191） */
  const rd = useDocView();
  // ベルの届いた知らせから来たら、その依頼の行を見せて「受け取る」に移す（0192 の追記 2026-11-18）
  const sectionRef = useRef<HTMLElement | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  useEffect(() => {
    const id = wantedFocus();
    if (id === null || !list.some((e) => e.record.requestId === id)) return;
    const row = [...(sectionRef.current?.querySelectorAll<HTMLElement>("[data-web-request]") ?? [])].find((el) => el.dataset.webRequest === id);
    if (row === undefined) return;
    takeFocus(id);
    row.scrollIntoView({ block: "center" });
    row.querySelector<HTMLButtonElement>("[data-web-receive]")?.focus({ preventScroll: true });
    setFocused(id);
    const t = setTimeout(() => setFocused((f) => (f === id ? null : f)), 4000);
    return () => clearTimeout(t);
  });
  if (rows.length === 0 && imported.length === 0 && unassigned === 0) return null;
  const now = new Date();
  const note = (id: string, m: string) => setMsg((x) => ({ ...x, [id]: m }));
  const run = async (e: WebLogEntry, f: () => Promise<void>) => {
    setBusy(e.record.requestId);
    try {
      await f();
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      note(
        e.record.requestId,
        code === "E_RELAY_UNREACHABLE"
          ? "受け付けのサーバーにつながりませんでした"
          : code === "E_WEB_DECRYPT"
            ? "答えの暗号文が開けませんでした（改ざんの疑い。受け取っていません）"
            : code === "E_RELAY_EXTEND_LIMIT"
              ? `期限は発行した日から90日（${day(limitOf(e.record))}）までです。これ以上は延ばせません`
              : code === "E_RELAY_GONE" || code === "E_RELAY_EXPIRED"
                ? "サーバーにありません（期限が過ぎたか、消しました）"
                : `できませんでした（${code}）`,
      );
    } finally {
      setBusy(null);
    }
  };
  const check = (e: WebLogEntry) =>
    run(e, async () => {
      const a = await checkAnswered(e, web.call);
      noteArrival(e.record.requestId, a === null ? null : { answers: a.newAnswers, batches: a.batches, submitted: a.answered, at: new Date().toISOString() });
      if (a === null) return note(e.record.requestId, "サーバーにありません（期限が過ぎたか、消しました）");
      const parts = [...(a.newAnswers ? ["答え"] : []), ...(a.batches > 0 ? [`書類（${a.batches}回分）`] : [])];
      note(e.record.requestId, parts.length > 0 ? `${parts.join("と")}が届いています。「${a.newAnswers || e.received === undefined ? "受け取る" : "届いた書類を受け取る"}」で受け取れます` : a.answered ? "新しく届いた書類はありません" : "まだ届いていません");
    });
  const take = (e: WebLogEntry) =>
    run(e, async () => {
      const r = await receiveWeb(wh, e, web.call);
      const prev = arrivalOf(e.record.requestId);
      noteArrival(e.record.requestId, { answers: false, batches: 0, submitted: prev?.submitted === true || r?.entry.received !== undefined, at: new Date().toISOString() });
      if (r === null) return note(e.record.requestId, e.received === undefined ? "まだ届いていません" : "新しく届いた書類はありません");
      onSave(r.wh);
      // 世帯ファイルに書けてから、受け取った分だけサーバーから消す（書けなければ消さない。もう一度受け取れる）
      if (!(await saveNow())) return note(e.record.requestId, "受け取りました。世帯を保存できなかったので、サーバーの分は消していません");
      // サーバーから消せなくても、受け取った分は世帯にある（次に受け取るときは読まない）。取り込みには進む
      const cleaned = await cleanupOnServer(r.entry, r.taken, web.call).then(
        () => true,
        () => false,
      );
      const t = r.taken;
      const n = answeredScreens(r.entry);
      const what = [...(t.answers ? [n !== null ? `回答 ${n.answered}画面（問いの画面 ${n.total}）` : "回答"] : []), ...(t.batches.length > 0 ? [`書類 ${t.files}（${t.batches.length}回分）`] : [])];
      const warn = [...(t.missingFiles > 0 ? [`受け取れなかった書類 ${t.missingFiles}`] : []), ...(t.badBatches > 0 ? [`開けなかった書類の送り ${t.badBatches}`] : []), ...(t.dropped > 0 ? [`形の違う答え ${t.dropped}は捨てました`] : [])];
      const text = `受け取りました（${[...what, ...warn].join("・")}）。${cleaned ? "受け取った分はサーバーから消しました" : "サーバーの分は消せませんでした（期限が来れば消えます）"}。書類は期限（${day(r.entry.record.expiresAt)}）まで、同じ URL で続けて届きます`;
      // 答えを受け取ったら、受け取りの画面を挟まず、そのまま取り込みの候補の画面へ（0192 の追記 2026-11-17）
      if (t.answers && r.entry.received !== undefined) return onImport(importWeb(r.wh, r.entry, appVersion), e.record.requestId, r.entry.received.submittedAt, text);
      note(e.record.requestId, text);
    });
  const extend = (e: WebLogEntry) =>
    run(e, async () => {
      const r = await extendWeb(wh, e, web.call);
      onSave(r.wh);
      await saveNow();
      note(
        e.record.requestId,
        // 日付が変わらないほどの延び（発行したすぐ後に押したとき）は「のまま」と出す
        r.changed && day(r.entry.record.expiresAt) !== day(e.record.expiresAt)
          ? `期限を ${day(r.entry.record.expiresAt)} まで延ばしました${r.entry.record.expiresAt === limitOf(r.entry.record) ? "（発行した日から90日の上限です）" : ""}。お客さまの画面の期限も変わります（案内文は送り直さなくてかまいません）`
          : `期限は ${day(r.entry.record.expiresAt)} のままです（延長は押した日から30日です。今の期限がそれより先なので、延びませんでした）`,
      );
    });
  const cancel = (e: WebLogEntry) =>
    run(e, async () => {
      try {
        await removeOnServer(e, web.call);
      } catch (err) {
        if (!(err instanceof Error && (err.message === "E_RELAY_GONE" || err.message === "E_RELAY_EXPIRED"))) throw err;
      }
      setClosing(null);
      // もう受け取れないので、届いた知らせ（ベル・行の印）を忘れる
      noteArrival(e.record.requestId, null);
      // 答えを受け取った依頼は「受け付けを終えた」印だけ（受け取り済み・取り込み済みのまま）。まだなら取り消し
      onSave(withWebEntry(wh, e.received === undefined ? { ...e, state: "cancelled" } : { ...e, closedAt: new Date().toISOString().replace(/\.\d+Z$/, "Z") }));
      note(e.record.requestId, e.received === undefined ? "取り消しました（サーバーから消しました。URL はもう開けません）" : "受け付けを終えました（サーバーから消しました。URL はもう開けず、書類も届きません）");
    });
  const save = async (e: WebLogEntry, f: StoredDocumentFile, title: string, n: number) => {
    const r = rd?.files.find((x) => x.file.fileId === f.fileId);
    if (rd !== null && r !== undefined && rd.canSave) {
      return note(e.record.requestId, await rd.save([r]));
    }
    const out = await web.saveDocument(fileBytes(f), { fileName: documentFileName(e.record.customerNo, title, f, n) });
    note(e.record.requestId, out.saved ? `「${out.fileName ?? ""}」を保存しました。${out.syncFolder ? "同期フォルダの中です。" : ""}写し終えたら消してください` : "保存しませんでした");
  };
  /** 届いた書類の一覧（行の下に開く） */
  const docsBox = (e: WebLogEntry) => {
    const id = e.record.requestId;
    const docs = e.record.selection.documents;
    const batches = e.batches ?? [];
    return (
      <div class="wr-docs" data-web-docs>
        {batches.length > 0 ? (
          <div class="wr-batches" data-web-batches>
            <b>受け取った書類の送り</b>
            <ol>
              {batches.map((b) => (
                <li key={b.batchId} data-web-batch>
                  {dayTime(b.sentAt)} に送られ、{dayTime(b.receivedAt)} に受け取り:{" "}
                  {b.documents.map((x) => `${docs.find((d) => d.id === x.id)?.title ?? x.id} ${x.files}`).join("・") || "（受け取れたファイルなし）"}
                  {b.missingFiles > 0 ? `（受け取れなかったファイル ${b.missingFiles}）` : ""}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
        {docs.map((d) => {
          const a = e.received?.documents.find((x) => x.id === d.id);
          const files = (e.files ?? []).filter((f) => f.docId === d.id);
          const status = files.length > 0 ? "attached" : (a?.status ?? "blank");
          return (
            <div class="wr-doc" key={d.id} data-web-doc-received={d.id}>
              <div class="wr-h">
                <b>{d.title}</b>
                <span class={`hs-kind ${status === "attached" ? "new" : status === "notAvailable" || status === "later" ? "review" : ""}`}>{DOC_STATUS[status]}</span>
                {d.docRequest !== undefined ? <small>書類待ちの欄と結びついています（写したら書類待ちが消えます）</small> : null}
              </div>
              {files.map((f, n) => {
                const b = batches.find((x) => x.batchId === f.batchId);
                return (
                  <div class="wr-file" key={f.fileId}>
                    <span>
                      {f.mime === "application/pdf" ? "PDF" : "写真"} {n + 1}（{Math.ceil(f.bytes / 1024)}KB{b !== undefined ? `・${dayTime(b.receivedAt)} に受け取り` : ""}）
                    </span>
                    {f.viewedAt !== undefined ? <small data-web-doc-viewed>見た</small> : null}
                    {f.savedAt !== undefined ? <small data-web-doc-saved>保存した</small> : null}
                    {rd !== null ? (
                      <button type="button" class="link-btn" onClick={() => rd.view(rd.viewing === f.fileId ? null : f.fileId)} data-web-doc-view>
                        {rd.viewing === f.fileId ? "閉じる" : "開く"}
                      </button>
                    ) : f.mime !== "application/pdf" ? (
                      <button type="button" class="link-btn" onClick={() => setView(view === f.fileId ? null : f.fileId)}>
                        {view === f.fileId ? "閉じる" : "開く"}
                      </button>
                    ) : null}
                    <button type="button" class="link-btn" onClick={() => void save(e, f, d.title, n + 1)} data-web-doc-save>
                      保存
                    </button>
                    <button type="button" class="link-btn" onClick={() => onSave(withoutFile(wh, id, f.fileId))} data-web-doc-delete>
                      消す
                    </button>
                    {view === f.fileId ? <DocImage f={f} /> : null}
                  </div>
                );
              })}
            </div>
          );
        })}
        <p class="rp-note">書類はこの世帯のファイルの中に暗号化して置いています（ほかの世帯からは見えません）。入力のホームの「受け取った書類」で、全部の書類の一覧・横に出して見る・まとめて自分のフォルダに保存ができます。保存したファイルは暗号化されません。</p>
      </div>
    );
  };
  /** 取り消す・受け付けを終えるの確かめ（押してすぐは取り消さない。どの段階でも1回確かめる。確かめのボタンは元のボタンと別の段に出す） */
  const cancelAsk = (e: WebLogEntry, arrived: boolean) => (
    <div class="wr-ask" role="alertdialog" aria-label={e.received === undefined ? "取り消しの確かめ" : "受け付けを終えるかの確かめ"} data-web-cancel-ask>
      <span>
        {e.received !== undefined
          ? "お客さまはこの URL を開けなくなり、書類も届きません。受け付けを終えますか。"
          : arrived
            ? "届いている回答を受け取らずに、サーバーから消します（もう受け取れません）。お客さまもこの URL を開けなくなります。取り消しますか。"
            : "お客さまはこの URL を開けなくなります（途中の回答も送れません）。取り消しますか。"}
      </span>
      <span class="wr-ask-acts">
        <button type="button" class="btn danger" disabled={busy !== null} onClick={() => void cancel(e)} data-web-cancel-yes>
          {e.received === undefined ? "はい、取り消す" : "はい、受け付けを終える"}
        </button>
        <button type="button" class="btn" onClick={() => setClosing(null)} data-web-cancel-no>
          やめる
        </button>
      </span>
    </div>
  );
  /** 送られた内容・書類のボタン（たたんだ行からも開ける） */
  const viewButtons = (e: WebLogEntry, link: boolean) => {
    const id = e.record.requestId;
    const cls = link ? "link-btn" : "btn";
    return (
      <>
        {e.received !== undefined ? (
          <button type="button" class={cls} onClick={() => setAnswersOpen(answersOpen === id ? null : id)} aria-expanded={answersOpen === id} data-web-answers-open>
            {answersOpen === id ? "送られた内容を閉じる" : "送られた内容を見る・印刷"}
          </button>
        ) : null}
        {(e.received !== undefined || (e.batches ?? []).length > 0) && e.record.selection.documents.length > 0 ? (
          <button type="button" class={cls} onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id} data-web-docs-open>
            書類（{e.files?.length ?? 0}）
          </button>
        ) : null}
      </>
    );
  };
  const importNow = (e: WebLogEntry) => onImport(importWeb(wh, e, appVersion), e.record.requestId, e.received?.submittedAt ?? null);
  return (
    <section ref={sectionRef} class="card hs-panel wr" aria-label="発行した URL" data-web-requests>
      <div class="card-h">
        <h2>発行した URL（{rows.length + imported.length}）</h2>
        <span class="aside">「URL生成」で作った URL と、AI が発行した URL を新しい順に並べます。回答が届いたら「受け取る」を押すと、答えと書類をこの世帯のファイルの中に暗号化して置き（受け取った分はサーバーから消します）、そのまま取り込みの候補の画面に進みます。書類は期限まで何回でも届きます</span>
      </div>
      {rows.length === 0 && imported.length === 0 ? (
        <p class="rp-note" data-web-requests-none>
          この世帯の URL はまだありません。
        </p>
      ) : null}
      {rows.length > 0 ? (
      <ul class="wr-list">
        {rows.map((row) => {
          if (row.place === "office") return <OfficeRow key={row.requestId} row={row} now={now} readOnly={ai?.readOnly === true} onOpen={ai?.onOpen ?? (() => undefined)} />;
          const e = row.entry;
          const id = e.record.requestId;
          const arr = arrivalOf(id);
          const st = statusOf(e, now, answeredOf(id), wh);
          const mode = rowMode(e, now, arr, wh);
          const docs = e.record.selection.documents;
          const live = accepting(e, now);
          const ext = extendState(e, now);
          const gates = gateLines(e);
          const waitingDocs = waitingDocuments(e, now);
          /** 届いたもの（まだ受け取っていない答え・書類の送り）があり、受け取れる */
          const canTake = live && arrivedOf(id);
          const folded = (mode === "done" || mode === "closed") && unfolded !== id;
          const what = `${selectionName(e.record.selection)}（聞く項目 ${selectedCount(e.record.selection)}）・書類: ${docs.length === 0 ? "なし" : docs.length <= 2 ? docs.map((d) => d.title).join("・") : `${docs[0]?.title ?? ""}ほか${docs.length - 1}通`}${e.record.customerNo !== "" ? `・顧客番号 ${e.record.customerNo}` : ""}`;
          const takeBtn = (primary: boolean) => (
            <button type="button" class={`btn${primary ? " primary" : ""}`} disabled={busy !== null} onClick={() => void take(e)} data-web-receive>
              {busy === id ? "受け取っています…" : mode === "waiting" || mode === "arrived" ? "受け取る" : "届いた書類を受け取る"}
            </button>
          );
          const cancelBtn = (label: string) => (
            <button type="button" class="btn" disabled={busy !== null || closing === id} onClick={() => setClosing(id)} aria-expanded={closing === id} data-web-cancel>
              {label}
            </button>
          );
          const tail = (
            <>
              {closing === id ? cancelAsk(e, mode === "arrived" || canTake) : null}
              {msg[id] !== undefined ? (
                <p class="rp-note" role="status">
                  {msg[id]}
                </p>
              ) : null}
              {answersOpen === id && e.received !== undefined ? <SentView e={e} /> : null}
              {open === id ? docsBox(e) : null}
            </>
          );
          if (folded) {
            // 取り込み済み・取り消し・期限切れは1行にたたむ。書類待ちがあれば、期限まで書類待ちの段を出す（0192 の追記 2026-11-17）
            return (
              <li key={id} class={`wr-row wr-fold st-${st}${focused === id ? " wr-focus" : ""}`} data-web-request={id} data-web-status={st} data-web-folded>
                <div class="wr-h">
                  <b>{id}</b>
                  <span class={`hs-kind wr-st ${st}`}>{STATUS_TEXT[st]}</span>
                  {e.closedAt !== undefined ? <span class="hs-kind wr-st cancelled">受け付け終了</span> : null}
                  {byBadge(e)}
                  {canTake ? (
                    <span class="hs-kind wr-st answered" data-web-arrived>
                      書類が届いています
                    </span>
                  ) : null}
                  <small>
                    {selectionName(e.record.selection)}
                    {e.record.customerNo !== "" ? `・顧客番号 ${e.record.customerNo}` : ""}
                    {e.importedAt !== undefined && mode === "done" ? `・${day(e.importedAt)} に取り込み` : mode === "closed" ? `・発行 ${day(e.record.issuedAt)}` : ""}
                  </small>
                  <span class="wr-fold-acts">
                    {viewButtons(e, true)}
                    <button type="button" class="link-btn" onClick={() => setUnfolded(id)} data-web-unfold>
                      詳しく
                    </button>
                  </span>
                </div>
                {waitingDocs.length > 0 ? (
                  <div class="wr-waiting" data-web-docs-waiting>
                    <span>
                      書類待ち: {waitingDocs.map((d) => d.title).join("・")}（期限 {day(e.record.expiresAt)} まで。届いたら、ここに「届いた書類を受け取る」が出ます）
                    </span>
                    <span class="rp-actions">
                      {canTake ? takeBtn(true) : null}
                      <button type="button" class="link-btn" disabled={busy !== null} onClick={() => void check(e)} data-web-check>
                        届いたかを確かめる
                      </button>
                    </span>
                  </div>
                ) : canTake ? (
                  <div class="rp-actions">{takeBtn(true)}</div>
                ) : null}
                {tail}
              </li>
            );
          }
          return (
            <li key={id} class={`wr-row st-${st}${focused === id ? " wr-focus" : ""}`} data-web-request={id} data-web-status={st} data-web-mode={mode}>
              <div class="wr-h">
                <b>{id}</b>
                <span class={`hs-kind wr-st ${st}`}>{STATUS_TEXT[st]}</span>
                {e.closedAt !== undefined ? <span class="hs-kind wr-st cancelled">受け付け終了</span> : null}
                {byBadge(e)}
                {canTake ? (

                  <span class="hs-kind wr-st answered" data-web-arrived>
                    届いています
                  </span>
                ) : null}
                <small>
                  発行 {day(e.record.issuedAt)}・期限 <span data-web-expires>{day(e.record.expiresAt)}</span>
                  {mode === "waiting" ? `（延長は ${day(limitOf(e.record))} まで）` : ""}
                  {e.received !== undefined ? <span data-web-sent-at>・お客さまが送った日時 {sentAtText(e.received.submittedAt)}</span> : null}
                </small>
                {unfolded === id ? (
                  <button type="button" class="link-btn" onClick={() => setUnfolded(null)} data-web-fold>
                    たたむ
                  </button>
                ) : null}
              </div>
              <p class="rp-note wr-what" data-web-what>
                {what}

              </p>
              {e.received !== undefined || (e.batches ?? []).length > 0 ? (
                <p class="rp-note wr-got" data-web-got>
                  {e.received !== undefined ? `答え: ${dayTime(e.received.at)} に受け取り（${((n) => (n === null ? "" : `問いの画面 ${n.total}のうち ${n.answered}画面に答えあり`))(answeredScreens(e))}）` : "答え: まだ"}
                  {docs.length > 0 ? `・書類: ${(e.batches ?? []).length > 0 ? `${(e.batches ?? []).length}回受け取り（最後 ${dayTime((e.batches ?? [])[(e.batches ?? []).length - 1]?.receivedAt ?? "")}）` : "まだ"}` : ""}
                  {waitingDocs.length > 0 ? `・書類待ち: ${waitingDocs.map((d) => d.title).join("・")}` : ""}
                </p>
              ) : null}
              {gates.length > 0 ? (
                <p class="rp-note wr-gates" data-web-gates>
                  分岐の答え: {gates.map((g) => `${g.label} ${g.text}`).join("・")}
                </p>
              ) : null}
              <div class="rp-actions">
                {mode === "waiting" ? (
                  <>
                    {/* 届く前: 届いたかを確かめる・延長・案内文をコピー・取り消す（書類だけ先に届いていれば受け取る） */}
                    {canTake ? takeBtn(true) : null}
                    <button type="button" class={`btn${canTake ? "" : " primary"}`} disabled={busy !== null} onClick={() => void check(e)} data-web-check>
                      届いたかを確かめる
                    </button>
                    <button type="button" class="btn" disabled={busy !== null || !ext.ok} onClick={() => void extend(e)} title={ext.ok ? "押した日から30日に延ばします（発行した日から90日まで）" : undefined} data-web-extend>
                      {ext.ok && ext.to !== null ? `延長（${day(ext.to)}まで）` : "延長（今日から30日）"}
                    </button>
                    <button type="button" class="btn" onClick={() => void navigator.clipboard?.writeText(invitationText(e, officeName, wh)).then(() => note(id, "案内文を写しました"))} data-web-copy>
                      案内文をコピー
                    </button>
                    {cancelBtn("取り消す")}
                  </>
                ) : null}
                {mode === "arrived" ? (
                  <>
                    {/* 回答が届いた: 受け取る（そのまま取り込みの候補の画面へ）・取り消すだけ */}
                    {takeBtn(true)}
                    {cancelBtn("取り消す")}
                  </>
                ) : null}
                {mode === "toImport" || mode === "done" || mode === "closed" ? (
                  <>
                    {e.received !== undefined ? (
                      <button type="button" class={`btn${mode === "toImport" ? " primary" : ""}`} onClick={() => importNow(e)} data-web-import>
                        {mode === "toImport" ? "取り込む（候補を確かめる）" : "もう一度取り込む"}
                      </button>
                    ) : null}
                    {canTake ? takeBtn(false) : null}
                    {viewButtons(e, false)}
                    {live && waitingDocs.length > 0 ? (
                      <button type="button" class="btn" disabled={busy !== null || !ext.ok} onClick={() => void extend(e)} title={ext.ok ? "書類の期限を、押した日から30日に延ばします（発行した日から90日まで）" : undefined} data-web-extend>
                        {ext.ok && ext.to !== null ? `書類の期限を延長（${day(ext.to)}まで）` : "書類の期限を延長"}
                      </button>
                    ) : null}
                    {live ? cancelBtn("受け付けを終える") : null}
                  </>
                ) : null}
              </div>
              {st === "undone" ? <p class="rp-note">取り込みを元に戻したので、世帯には入っていません（受け取った答えはこの世帯に残っています）。</p> : null}
              {live && !ext.ok && ext.reason === "limit" && (mode === "waiting" || waitingDocs.length > 0) ? (
                <p class="rp-note" data-web-extend-limit>
                  期限は発行した日から90日（{day(limitOf(e.record))}）までです。これ以上は延ばせません。
                </p>
              ) : null}
              {st === "expired" && e.closedAt === undefined ? <p class="rp-note">期限が過ぎました（サーバーでは期限を過ぎると消えます）。まだ答えや書類が要るときは、新しく発行してください。</p> : null}
              {tail}
            </li>
          );
        })}
      </ul>
      ) : null}
      <ImportedAnswers wh={wh} />
      {ai !== undefined ? <AiUnassignedLink store={ai.store} web={web} onOpen={ai.onOpen} /> : null}
    </section>
  );
}

/**
 * 取り込み済みの回答（0192 の追記 2026-11-18）: 「発行した URL」の一覧から外した取り込み済みの依頼の、送られた内容を見る・印刷の入口。
 * たたんだ1行で出し、開くと依頼ごとに「送られた内容を見る・印刷」（書類は入力のホームの「受け取った書類」から）
 */
export function ImportedAnswers({ wh }: { wh: WorkingHousehold }) {
  const list = importedEntries(wh);
  const [open, setOpen] = useState<string | null>(null);
  if (list.length === 0) return null;
  return (
    <details class="hs-group hs-fold wr-imported" data-web-imported={list.length}>
      <summary>
        <b>取り込み済みの URL の回答（{list.length}）</b> <small>送られた内容を見る・印刷できます</small>
      </summary>
      <ul class="hs-list">
        {list.map((e) => {
          const id = e.record.requestId;
          return (
            <li key={id} data-web-imported-item={id}>
              <span>
                {id}・{selectionName(e.record.selection)}・顧客番号 {e.record.customerNo}
                {e.importedAt !== undefined ? `・${day(e.importedAt)} に取り込み` : ""}
              </span>{" "}
              <button type="button" class="link-btn" onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id} data-web-answers-open>
                {open === id ? "送られた内容を閉じる" : "送られた内容を見る・印刷"}
              </button>
              {open === id ? <SentView e={e} /> : null}
            </li>
          );
        })}
      </ul>
      {list.some((e) => (e.files ?? []).length > 0) ? <p class="rp-note">受け取った書類は、入力のホームの「受け取った書類」から開けます。</p> : null}
    </details>
  );
}
