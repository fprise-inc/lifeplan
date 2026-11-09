// Web のヒアリング（0125・0158）の依頼の一覧: 発行済み・回答あり・受け取り済み・取り込み済み・期限切れ。答えと書類を受け取って開き（受け取った分は
// サーバーから消す）、取り込みの画面で候補として承認する。書類は答えと別に、期限まで何回でも届く（受け取るたびに送りごとの記録を残す）。
// 期限の延長（押した日から30日・発行した日から90日まで）。受け取った書類は、その世帯の書類として開く・保存する・消す。
// - 「開く」は入力のホームの見る枠（DocViewer.tsx。写真も PDF も。拡大・回転・ページ送り）に出す。見る枠の無い所（入力のホームの外）では、
//   写真をこの中に描く（img の URL にしない。0016。バイトを createImageBitmap で絵にしてキャンバスに描く）
// - 保存は受け取った書類の一覧と同じ名前・同じ印（0191）
// - 0192: 届いたかは開いたときと決まった間隔で確かめ、アプリを開いている間は覚える（画面を閉じても消えない）。行に何を頼んだか（ひな形・項目の数・
//   書類・顧客番号）。送られた内容を、お客さまが見たのと同じ並びで見る・印刷する
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SentAnswers } from "../../hearingForm/Form.tsx";
import type { HearingWebHost } from "../../engine/host.ts";
import type { WorkingHousehold } from "../input/household.ts";
import type { ImportView } from "./sheet.ts";
import { useDocView } from "./ReceivedDocs.tsx";
import { accepting, answeredScreens, arrivalOf, checkAnswered, checkArrivals, cleanupOnServer, documentFileName, extendState, extendWeb, fileBytes, gateLines, importWeb, invitationText, limitOf, noteArrival, onArrivals, packetOf, receivedDraft, receiveWeb, removeOnServer, selectedCount, selectionName, sentAtText, STATUS_TEXT, statusOf, webLog, withoutFile, withWebEntry, type StoredDocumentFile, type WebLogEntry } from "./web.ts";

interface Props {
  wh: WorkingHousehold;
  web: HearingWebHost;
  officeName: string;
  appVersion: string;
  onSave: (wh: WorkingHousehold) => void;
  saveNow: () => Promise<boolean>;
  onImport: (view: ImportView, requestId: string, submittedAt: string | null) => void;
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

export function WebRequests({ wh, web, officeName, appVersion, onSave, saveNow, onImport }: Props) {
  const list = webLog(wh).slice().sort((a, b) => (a.record.issuedAt < b.record.issuedAt ? 1 : -1));
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
  /** 入力のホームの見る枠と、受け取った書類の一覧の保存（あれば使う。0191） */
  const rd = useDocView();
  if (list.length === 0) return null;
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
      note(e.record.requestId, parts.length > 0 ? `${parts.join("と")}が届いています。「受け取る」を押してください` : a.answered ? "新しく届いた書類はありません" : "まだ届いていません");
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
      await cleanupOnServer(r.entry, r.taken, web.call);
      const t = r.taken;
      const n = answeredScreens(r.entry);
      const what = [...(t.answers ? [n !== null ? `お答え ${n.answered}画面（問いの画面 ${n.total}）` : "お答え"] : []), ...(t.batches.length > 0 ? [`書類 ${t.files}（${t.batches.length}回分）`] : [])];
      const warn = [...(t.missingFiles > 0 ? [`受け取れなかった書類 ${t.missingFiles}`] : []), ...(t.badBatches > 0 ? [`開けなかった書類の送り ${t.badBatches}`] : []), ...(t.dropped > 0 ? [`形の違う答え ${t.dropped}は捨てました`] : [])];
      note(e.record.requestId, `受け取りました（${[...what, ...warn].join("・")}）。受け取った分はサーバーから消しました。書類は期限（${day(r.entry.record.expiresAt)}）まで、同じ URL で続けて届きます`);
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
  return (
    <section class="card hs-panel wr" aria-label="URL の依頼" data-web-requests>
      <div class="card-h">
        <h2>URL の依頼（{list.length}）</h2>
        <span class="aside">受け取ると、答えと書類はこの世帯のファイルの中に暗号化して置き、受け取った分はサーバーから消します。書類は期限まで何回でも届きます</span>
      </div>
      <ul class="wr-list">
        {list.map((e) => {
          const st = statusOf(e, now, answeredOf(e.record.requestId), wh);
          const id = e.record.requestId;
          const docs = e.record.selection.documents;
          const live = accepting(e, now);
          const ext = extendState(e, now);
          const batches = e.batches ?? [];
          const gates = gateLines(e);
          return (
            <li key={id} class={`wr-row st-${st}`} data-web-request={id} data-web-status={st}>
              <div class="wr-h">
                <b>{id}</b>
                <span class={`hs-kind wr-st ${st}`}>{STATUS_TEXT[st]}</span>
                {e.closedAt !== undefined ? <span class="hs-kind wr-st cancelled">受け付け終了</span> : null}
                {arrivedOf(id) && live ? (
                  <span class="hs-kind wr-st answered" data-web-arrived>
                    届いています
                  </span>
                ) : null}
                <small>
                  発行 {day(e.record.issuedAt)}・期限 <span data-web-expires>{day(e.record.expiresAt)}</span>（延長は {day(limitOf(e.record))} まで）
                  {e.received !== undefined ? <span data-web-sent-at>・お客さまが送った日時 {sentAtText(e.received.submittedAt)}</span> : null}
                </small>
              </div>
              <p class="rp-note wr-what" data-web-what>
                {selectionName(e.record.selection)}（聞く項目 {selectedCount(e.record.selection)}）・書類: {docs.length === 0 ? "なし" : docs.length <= 2 ? docs.map((d) => d.title).join("・") : `${docs[0]?.title ?? ""}ほか${docs.length - 1}通`}・顧客番号 {e.record.customerNo}
              </p>
              {e.received !== undefined || batches.length > 0 ? (
                <p class="rp-note wr-got" data-web-got>
                  {e.received !== undefined ? `答え: ${dayTime(e.received.at)} に受け取り（${((n) => (n === null ? "" : `問いの画面 ${n.total}のうち ${n.answered}画面に答えあり`))(answeredScreens(e))}）` : "答え: まだ"}
                  {docs.length > 0 ? `・書類: ${batches.length > 0 ? `${batches.length}回受け取り（最後 ${dayTime(batches[batches.length - 1]?.receivedAt ?? "")}）` : "まだ"}` : ""}
                </p>
              ) : null}
              {gates.length > 0 ? (
                <p class="rp-note wr-gates" data-web-gates>
                  分岐の答え: {gates.map((g) => `${g.label} ${g.text}`).join("・")}
                </p>
              ) : null}
              <div class="rp-actions">
                {live ? (
                  <>
                    {/* 届いていると分かるまでは「届いたかを確かめる」が主のボタン。分かったら「受け取る」を主にする（0139・0158） */}
                    <button type="button" class={`btn${arrivedOf(id) ? "" : " primary"}`} disabled={busy !== null} onClick={() => void check(e)} data-web-check>
                      届いたかを確かめる
                    </button>
                    {arrivedOf(id) ? (
                      <button type="button" class="btn primary" disabled={busy !== null} onClick={() => void take(e)} data-web-receive>
                        受け取る
                      </button>
                    ) : null}
                    <button type="button" class="btn" disabled={busy !== null || !ext.ok} onClick={() => void extend(e)} title={ext.ok ? "押した日から30日に延ばします（発行した日から90日まで）" : undefined} data-web-extend>
                      {ext.ok && ext.to !== null ? `延長（${day(ext.to)}まで）` : "延長（今日から30日）"}
                    </button>
                    {e.received === undefined ? (
                      <button type="button" class="btn" onClick={() => void navigator.clipboard?.writeText(invitationText(e, officeName)).then(() => note(id, "案内文を写しました"))}>
                        案内文をコピー
                      </button>
                    ) : null}
                    {closing === id ? (
                      <span class="wr-confirm" role="alert" data-web-cancel-ask>
                        {e.received === undefined ? "お客さまはこの URL を開けなくなります（途中のお答えも送れません）。取り消しますか。" : "お客さまはこの URL を開けなくなり、書類も届きません。受け付けを終えますか。"}
                        <button type="button" class="btn" disabled={busy !== null} onClick={() => void cancel(e)} data-web-cancel-yes>
                          {e.received === undefined ? "取り消す" : "終える"}
                        </button>
                        <button type="button" class="btn" onClick={() => setClosing(null)}>
                          やめる
                        </button>
                      </span>
                    ) : (
                      <button type="button" class="btn" disabled={busy !== null} onClick={() => setClosing(id)} data-web-cancel>
                        {e.received === undefined ? "取り消す" : "受け付けを終える"}
                      </button>
                    )}
                  </>
                ) : null}
                {st === "received" || st === "imported" || st === "undone" ? (
                  <button type="button" class={`btn${st === "imported" ? "" : " primary"}`} onClick={() => onImport(importWeb(wh, e, appVersion), id, e.received?.submittedAt ?? null)} data-web-import>
                    {st === "received" ? "取り込む（候補を確かめる）" : "もう一度取り込む"}
                  </button>
                ) : null}
                {st === "undone" ? <span class="rp-note">取り込みを元に戻したので、世帯には入っていません（受け取った答えはこの世帯に残っています）。</span> : null}
                {e.received !== undefined ? (
                  <button type="button" class="btn" onClick={() => setAnswersOpen(answersOpen === id ? null : id)} aria-expanded={answersOpen === id} data-web-answers-open>
                    {answersOpen === id ? "送られた内容を閉じる" : "送られた内容を見る"}
                  </button>
                ) : null}
                {(e.received !== undefined || batches.length > 0) && docs.length > 0 ? (
                  <button type="button" class="btn" onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id} data-web-docs-open>
                    書類（{e.files?.length ?? 0}）
                  </button>
                ) : null}
              </div>
              {live && !ext.ok && ext.reason === "limit" ? (
                <p class="rp-note" data-web-extend-limit>
                  期限は発行した日から90日（{day(limitOf(e.record))}）までです。これ以上は延ばせません。
                </p>
              ) : null}
              {st === "expired" && e.closedAt === undefined ? <p class="rp-note">期限が過ぎました（サーバーでは期限を過ぎると消えます）。まだ答えや書類が要るときは、新しく発行してください。</p> : null}
              {msg[id] !== undefined ? (
                <p class="rp-note" role="status">
                  {msg[id]}
                </p>
              ) : null}
              {answersOpen === id && e.received !== undefined ? <SentView e={e} /> : null}
              {open === id ? (
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
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
