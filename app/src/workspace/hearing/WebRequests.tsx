// Web のヒアリング（0125）の依頼の一覧: 発行済み・回答あり・受け取り済み・取り込み済み・期限切れ。答えを受け取って開き（受け取ったら
// サーバーから消す）、取り込みの画面で候補として承認する。受け取った書類は、その世帯の書類として開く・保存する・消す。
// - 書類の画像は img の URL にしない（0016）。バイトを createImageBitmap で絵にしてキャンバスに描く。PDF は保存して開く
import { useEffect, useRef, useState } from "preact/hooks";
import type { HearingWebHost } from "../../engine/host.ts";
import type { WorkingHousehold } from "../input/household.ts";
import type { ImportView } from "./sheet.ts";
import { checkAnswered, documentFileName, fileBytes, importWeb, invitationText, receiveWeb, removeOnServer, sentAtText, STATUS_TEXT, statusOf, webLog, withoutFile, withWebEntry, type StoredDocumentFile, type WebLogEntry } from "./web.ts";

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

export function WebRequests({ wh, web, officeName, appVersion, onSave, saveNow, onImport }: Props) {
  const list = webLog(wh).slice().sort((a, b) => (a.record.issuedAt < b.record.issuedAt ? 1 : -1));
  const [answered, setAnswered] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<string | null>(null);
  if (list.length === 0) return null;
  const now = new Date();
  const note = (id: string, m: string) => setMsg((x) => ({ ...x, [id]: m }));
  const run = async (e: WebLogEntry, f: () => Promise<void>) => {
    setBusy(e.record.requestId);
    try {
      await f();
    } catch (err) {
      const code = err instanceof Error ? err.message : String(err);
      note(e.record.requestId, code === "E_RELAY_UNREACHABLE" ? "受け付けのサーバーにつながりませんでした" : code === "E_WEB_DECRYPT" ? "答えの暗号文が開けませんでした（改ざんの疑い。受け取っていません）" : `できませんでした（${code}）`);
    } finally {
      setBusy(null);
    }
  };
  const check = (e: WebLogEntry) =>
    run(e, async () => {
      const a = await checkAnswered(e, web.call);
      if (a === null) note(e.record.requestId, "サーバーにありません（期限が過ぎたか、消しました）");
      else {
        setAnswered((x) => ({ ...x, [e.record.requestId]: a }));
        note(e.record.requestId, a ? "回答があります。「受け取る」を押してください" : "まだ回答はありません");
      }
    });
  const take = (e: WebLogEntry) =>
    run(e, async () => {
      const r = await receiveWeb(wh, e, web.call);
      if (r === null) return note(e.record.requestId, "まだ回答はありません");
      onSave(r.wh);
      // 世帯ファイルに書けてから、サーバーから消す（書けなければ消さない。もう一度受け取れる）
      if (!(await saveNow())) return note(e.record.requestId, "受け取りました。世帯を保存できなかったので、サーバーの答えは消していません");
      await removeOnServer(e, web.call);
      const rec = r.entry.received;
      note(e.record.requestId, `受け取りました（答え ${rec?.answers.length ?? 0}・書類 ${r.entry.files?.length ?? 0}${rec !== undefined && rec.missingFiles > 0 ? `・受け取れなかった書類 ${rec.missingFiles}` : ""}${rec !== undefined && rec.dropped > 0 ? `・形の違う答え ${rec.dropped}は捨てました` : ""}）。サーバーからは消しました`);
    });
  const cancel = (e: WebLogEntry) =>
    run(e, async () => {
      try {
        await removeOnServer(e, web.call);
      } catch (err) {
        if (!(err instanceof Error && (err.message === "E_RELAY_GONE" || err.message === "E_RELAY_EXPIRED"))) throw err;
      }
      onSave(withWebEntry(wh, { ...e, state: "cancelled" }));
      note(e.record.requestId, "取り消しました（サーバーから消しました。URL はもう開けません）");
    });
  const save = async (e: WebLogEntry, f: StoredDocumentFile, title: string, n: number) => {
    const out = await web.saveDocument(fileBytes(f), { fileName: documentFileName(e.record.customerNo, title, f, n) });
    note(e.record.requestId, out.saved ? `「${out.fileName ?? ""}」を保存しました。${out.syncFolder ? "同期フォルダの中です。" : ""}写し終えたら消してください` : "保存しませんでした");
  };
  return (
    <section class="card hs-panel wr" aria-label="Web の依頼" data-web-requests>
      <div class="card-h">
        <h2>Web の依頼（{list.length}）</h2>
        <span class="aside">受け取ると、答えと書類はこの世帯のファイルの中に暗号化して置き、サーバーからは消します</span>
      </div>
      <ul class="wr-list">
        {list.map((e) => {
          const st = statusOf(e, now, answered[e.record.requestId] === true, wh);
          const id = e.record.requestId;
          const docs = e.record.selection.documents;
          return (
            <li key={id} class={`wr-row st-${st}`} data-web-request={id} data-web-status={st}>
              <div class="wr-h">
                <b>{id}</b>
                <span class={`hs-kind wr-st ${st}`}>{STATUS_TEXT[st]}</span>
                <small>
                  発行 {new Date(e.record.issuedAt).toLocaleDateString("ja-JP")}・期限 {new Date(e.record.expiresAt).toLocaleDateString("ja-JP")}・項目 {e.record.selection.sections.reduce((n, s) => n + s.items.length, 0)}・書類 {docs.length}
                  {e.received !== undefined ? <span data-web-sent-at>・お客さまが送った日時 {sentAtText(e.received.submittedAt)}</span> : null}
                </small>
              </div>
              <div class="rp-actions">
                {st === "issued" || st === "answered" ? (
                  <>
                    {/* 回答があると分かるまでは「回答を確かめる」が主のボタン。分かったら「受け取る」を主にする */}
                    <button type="button" class={`btn${st === "issued" ? " primary" : ""}`} disabled={busy !== null} onClick={() => void check(e)} data-web-check>
                      回答を確かめる
                    </button>
                    {st === "answered" ? (
                      <button type="button" class="btn primary" disabled={busy !== null} onClick={() => void take(e)} data-web-receive>
                        受け取る
                      </button>
                    ) : null}
                    <button type="button" class="btn" onClick={() => void navigator.clipboard?.writeText(invitationText(e, officeName)).then(() => note(id, "案内文を写しました"))}>
                      案内文をコピー
                    </button>
                    <button type="button" class="btn" disabled={busy !== null} onClick={() => void cancel(e)}>
                      取り消す
                    </button>
                  </>
                ) : null}
                {st === "received" || st === "imported" || st === "undone" ? (
                  <button type="button" class={`btn${st === "imported" ? "" : " primary"}`} onClick={() => onImport(importWeb(wh, e, appVersion), id, e.received?.submittedAt ?? null)} data-web-import>
                    {st === "received" ? "取り込む（候補を確かめる）" : "もう一度取り込む"}
                  </button>
                ) : null}
                {st === "undone" ? <span class="rp-note">取り込みを元に戻したので、世帯には入っていません（受け取った答えはこの世帯に残っています）。</span> : null}
                {e.received !== undefined && docs.length > 0 ? (
                  <button type="button" class="btn" onClick={() => setOpen(open === id ? null : id)} aria-expanded={open === id} data-web-docs-open>
                    書類（{e.files?.length ?? 0}）
                  </button>
                ) : null}
                {st === "expired" ? <span class="rp-note">期限が過ぎました。必要なら新しく発行してください（サーバーでは期限を過ぎると消えます）。</span> : null}
              </div>
              {msg[id] !== undefined ? (
                <p class="rp-note" role="status">
                  {msg[id]}
                </p>
              ) : null}
              {open === id && e.received !== undefined ? (
                <div class="wr-docs" data-web-docs>
                  {docs.map((d) => {
                    const a = e.received?.documents.find((x) => x.id === d.id);
                    const files = (e.files ?? []).filter((f) => f.docId === d.id);
                    return (
                      <div class="wr-doc" key={d.id} data-web-doc-received={d.id}>
                        <div class="wr-h">
                          <b>{d.title}</b>
                          <span class={`hs-kind ${a?.status === "attached" ? "new" : a?.status === "notAvailable" || a?.status === "later" ? "review" : ""}`}>{DOC_STATUS[a?.status ?? "blank"]}</span>
                          {d.docRequest !== undefined ? <small>書類待ちの欄と結びついています（写したら書類待ちが消えます）</small> : null}
                        </div>
                        {files.map((f, n) => (
                          <div class="wr-file" key={f.fileId}>
                            <span>
                              {f.mime === "application/pdf" ? "PDF" : "写真"} {n + 1}（{Math.ceil(f.bytes / 1024)}KB）
                            </span>
                            {f.mime !== "application/pdf" ? (
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
                        ))}
                      </div>
                    );
                  })}
                  <p class="rp-note">書類はこの世帯のファイルの中に暗号化して置いています（ほかの世帯からは見えません）。数字を写し終えたら「消す」を押してください。保存したファイルは暗号化されないので、写し終えたら消してください。</p>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
