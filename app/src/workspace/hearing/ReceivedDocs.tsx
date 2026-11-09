// 受け取った書類（Web のヒアリング。0191）: 世帯ごとの一覧（何を・誰の・いつ・大きさ・見たか・保存したか）・自分のフォルダに保存（1つずつ・まとめて）・
// 入力のパネルの「届いた書類を見る」の入口。見る枠（DocViewer.tsx）を開く口は、入力のホームが DocViewContext で配る。
// - アプリは書類を自動で消さず、消すように促さない。FP が「消す」を押したときだけ、確かめてから消す
// - 見た・保存したの印は世帯ファイルの依頼の記録に残す（元に戻す・やり直すの履歴には積まない。依頼の記録と同じ）
import { createContext } from "preact";
import { useContext, useMemo, useState } from "preact/hooks";
import type { FolderSaveOutcome, SaveOutcome } from "../../engine/host.ts";
import { Help } from "../../presentation/Help.tsx";
import { docRequests, type DocRequest } from "../input/docRequests.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { byDocument, docLabel, fileNames, filesForCard, receivedFiles, receivedSummary, sizeText, withFileMarks, withoutFiles, type ReceivedFile } from "./receivedDocs.ts";
import { fileBytes, STORED_DOCUMENTS_MAX_BYTES } from "./web.ts";

/** 保存の口（本体かブラウザ。host.ts の HearingWebHost の一部） */
export interface ReceivedHost {
  saveDocument(bytes: Uint8Array, meta: { fileName: string }): Promise<SaveOutcome>;
  saveDocuments(files: readonly { bytes: Uint8Array; fileName: string }[]): Promise<FolderSaveOutcome>;
}

export interface ReceivedProps {
  /** 保存の口（無ければ保存のボタンを出さない） */
  host?: ReceivedHost;
  /** 依頼の記録を書き換える（見た・保存した・消す。履歴に積まない） */
  update: (f: (wh: WorkingHousehold) => WorkingHousehold) => void;
}

export interface ReceivedDocsState {
  files: ReceivedFile[];
  names: Map<string, string>;
  /** 見る枠に出しているファイル */
  viewing: string | null;
  view: (fileId: string | null) => void;
  listOpen: boolean;
  setListOpen: (open: boolean) => void;
  markViewed: (fileId: string) => void;
  canSave: boolean;
  /** 保存して、知らせの文を返す。folder はフォルダを選んでまとめて保存する（既定は2件以上のとき。1件は保存のダイアログで名前も選べる） */
  save: (list: readonly ReceivedFile[], folder?: boolean) => Promise<string>;
  remove: (fileIds: readonly string[]) => void;
  /** 保存・消すの知らせ */
  note: string | null;
  /** 書類待ちの1通（入力項目とのつながり） */
  pending: DocRequest[];
}

const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

/** 入力のホームが持つ、受け取った書類の状態 */
export function useReceivedDocs(wh: WorkingHousehold, p: ReceivedProps): ReceivedDocsState {
  const files = useMemo(() => receivedFiles(wh), [wh]);
  const names = useMemo(() => fileNames(files), [files]);
  const pending = useMemo(() => (files.some((f) => f.doc.docRequest !== undefined) ? docRequests(wh) : []), [wh, files]);
  const [viewing, setViewing] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const host = p.host;
  /** 保存して、知らせの文を返す（一覧と見る枠にも出す） */
  const save = async (list: readonly ReceivedFile[], folder = list.length > 1): Promise<string> => {
    const msg = await saveFiles(list, folder);
    setNote(msg);
    return msg;
  };
  const saveFiles = async (list: readonly ReceivedFile[], folder: boolean): Promise<string> => {
    if (host === undefined || list.length === 0) return "保存できる書類がありません";
    try {
      if (!folder && list.length === 1) {
        const r = list[0] as ReceivedFile;
        const out = await host.saveDocument(fileBytes(r.file), { fileName: names.get(r.file.fileId) ?? "書類" });
        if (!out.saved) return "保存しませんでした";
        p.update((w) => withFileMarks(w, [r.file.fileId], "savedAt", nowIso()));
        return `「${out.fileName ?? ""}」を保存しました。${out.syncFolder ? "同期フォルダの中です（クラウドの保存サービスに上がります）。" : ""}`;
      }
      const out = await host.saveDocuments(list.map((r) => ({ bytes: fileBytes(r.file), fileName: names.get(r.file.fileId) ?? "書類" })));
      if (!out.picked) return "保存しませんでした（フォルダを選びませんでした）";
      const ids = out.saved.map((s) => list[s.index]?.file.fileId).filter((x): x is string => x !== undefined);
      if (ids.length > 0) p.update((w) => withFileMarks(w, ids, "savedAt", nowIso()));
      const where = out.via === "downloads" ? "ブラウザのダウンロードのフォルダに保存しました" : `選んだフォルダに保存しました${out.syncFolder ? "（同期フォルダの中です。クラウドの保存サービスに上がります）" : ""}`;
      return `${ids.length}件を${where}。${out.failed > 0 ? `${out.failed}件は保存できませんでした。` : ""}${out.via === "folder" ? "同じ名前で同じ中身のファイルがあったものは、そのままにしました。" : ""}`;
    } catch (e) {
      return `保存できませんでした（${e instanceof Error ? e.message : String(e)}）`;
    }
  };
  return {
    files,
    names,
    viewing: viewing !== null && files.some((f) => f.file.fileId === viewing) ? viewing : null,
    view: setViewing,
    listOpen,
    setListOpen,
    markViewed: (id) => {
      if (files.find((f) => f.file.fileId === id)?.file.viewedAt === undefined) p.update((w) => withFileMarks(w, [id], "viewedAt", nowIso()));
    },
    canSave: host !== undefined,
    save,
    remove: (ids) => {
      p.update((w) => withoutFiles(w, ids));
      setNote(`${ids.length}件をこの世帯から消しました`);
    },
    note,
    pending,
  };
}

/** 見る枠を開く口（入力のホームが配る。書類のお願い・Web の依頼の一覧から使う） */
export const DocViewContext = createContext<ReceivedDocsState | null>(null);
export const useDocView = (): ReceivedDocsState | null => useContext(DocViewContext);

const day = (iso: string) => new Date(iso).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
const dayTime = (iso: string) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const kindText = (r: ReceivedFile) => (r.file.mime === "application/pdf" ? "PDF" : "写真");

/** 入力のホームの見出しのボタン「受け取った書類（N件・2.1MB）」 */
export function ReceivedButton({ rd }: { rd: ReceivedDocsState }) {
  if (rd.files.length === 0 && !rd.listOpen) return null;
  const s = receivedSummary(rd.files);
  return (
    <button type="button" class="add-btn" aria-expanded={rd.listOpen} onClick={() => rd.setListOpen(!rd.listOpen)} data-received-open>
      受け取った書類（{s.files}件・{sizeText(s.bytes)}）
    </button>
  );
}

/** 入力のパネルの「届いた書類を見る」（その入力項目で見ながら打つ書類） */
export function DocLinks({ rd, card }: { rd: ReceivedDocsState; card: string }) {
  const groups = byDocument(filesForCard(rd.files, card, rd.pending));
  if (groups.length === 0) return null;
  return (
    <div class="ip-docs" data-panel-docs>
      <span class="ip-docs-h">届いた書類</span>
      {groups.map((g) => {
        const on = g.files.some((f) => f.file.fileId === rd.viewing);
        return (
          <button type="button" class={`btn small${on ? " on" : ""}`} key={g.key} aria-pressed={on} onClick={() => rd.view(on ? null : (g.files[0]?.file.fileId ?? null))} data-panel-doc={g.key} title="入力のパネルを開いたまま、横に書類を出します">
            {docLabel(g)}を{on ? "閉じる" : "見る"}
            {g.files.length > 1 ? `（${g.files.length}枚）` : ""}
          </button>
        );
      })}
    </div>
  );
}

/** 受け取った書類の一覧（入力のホームの見出しの「受け取った書類」から開く） */
export function ReceivedDocs({ rd }: { rd: ReceivedDocsState }) {
  const [asking, setAsking] = useState<string | null>(null);
  const s = receivedSummary(rd.files);
  const unsaved = rd.files.filter((r) => r.file.savedAt === undefined);
  return (
    <section class="ck rd" aria-label="受け取った書類" data-received-docs>
      <div class="ck-head">
        <h2>
          受け取った書類
          <Help label="受け取った書類" id="receivedDocs">
            <p>Web のヒアリングで、お客さまから受け取った書類です。この世帯のファイルの中に暗号化して置いています（ほかの世帯からは見えません）。</p>
            <p>「見る」で、入力のパネルを開いたまま横に書類を出せます（拡大・回転・PDF のページ送り）。入力のパネルの見出しの下の「届いた書類」からも出せます。</p>
            <p>「保存」で、自分のフォルダに保存します。ファイル名は「顧客番号_書類の名前_持ち主_受け取った日」です（お客さまのお名前は入りません）。保存したファイルは暗号化されないので、事務所の決まりで管理してください。</p>
            <p>アプリは書類を自動では消しません。この世帯のファイルが大きくなったときは、大きさを見て、要らなくなった書類を「消す」で消してください（1世帯 {sizeText(STORED_DOCUMENTS_MAX_BYTES)} まで受け取れます）。</p>
          </Help>
        </h2>
        <p class="ck-lead" data-received-summary>
          {s.files > 0 ? `${s.files}件・${sizeText(s.bytes)}（この世帯のファイルの中。1世帯 ${sizeText(STORED_DOCUMENTS_MAX_BYTES)} まで）・まだ見ていない ${s.unseen}件・まだ保存していない ${s.unsaved}件` : "受け取った書類はありません。"}
        </p>
      </div>
      {rd.files.length > 0 && rd.canSave ? (
        <div class="rp-actions">
          <button type="button" class="btn primary" disabled={unsaved.length === 0} onClick={() => void rd.save(unsaved, true)} data-received-save-unsaved>
            まだ保存していない書類を保存（{unsaved.length}件）
          </button>
          <button type="button" class="btn" onClick={() => void rd.save(rd.files, true)} data-received-save-all>
            全部を保存（{rd.files.length}件）
          </button>
          <span class="rp-note">保存先のフォルダを1回選ぶと、まとめて保存します。</span>
        </div>
      ) : null}
      {rd.note !== null ? (
        <p class="in-note" role="status" data-received-note>
          {rd.note}
        </p>
      ) : null}
      {rd.files.length > 0 ? (
        <table class="rd-table">
          <thead>
            <tr>
              <th scope="col">書類</th>
              <th scope="col">誰の</th>
              <th scope="col">受け取った日</th>
              <th scope="col">大きさ</th>
              <th scope="col">見た</th>
              <th scope="col">保存</th>
              <th scope="col">
                <span class="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rd.files.map((r) => {
              const id = r.file.fileId;
              return (
                <tr key={id} data-received-file={id} class={rd.viewing === id ? "on" : undefined}>
                  <td>
                    <b>{r.name}</b>
                    <small>
                      {" "}
                      {kindText(r)}
                      {r.count > 1 ? ` ${r.index}/${r.count}` : ""}・{r.requestId}
                    </small>
                  </td>
                  <td>{r.whose ?? "—"}</td>
                  <td title={r.sentAt !== null ? `お客さまが送った日時（申告）: ${dayTime(r.sentAt)}` : undefined}>{dayTime(r.receivedAt)}</td>
                  <td class="num">{sizeText(r.file.bytes)}</td>
                  <td data-received-viewed={r.file.viewedAt !== undefined ? "1" : "0"}>{r.file.viewedAt !== undefined ? "見た" : <span class="rd-yet">まだ</span>}</td>
                  <td data-received-saved={r.file.savedAt !== undefined ? "1" : "0"}>{r.file.savedAt !== undefined ? `保存した（${day(r.file.savedAt)}）` : <span class="rd-yet">まだ</span>}</td>
                  <td class="rd-acts">
                    <button type="button" class="link-btn" onClick={() => rd.view(rd.viewing === id ? null : id)} data-received-view={id}>
                      {rd.viewing === id ? "閉じる" : "見る"}
                    </button>
                    {rd.canSave ? (
                      <button type="button" class="link-btn" onClick={() => void rd.save([r])} data-received-save={id} title={rd.names.get(id)}>
                        保存
                      </button>
                    ) : null}
                    {asking === id ? (
                      <span class="wr-confirm" role="alert">
                        この世帯から消します（元に戻せません）。{r.file.savedAt === undefined ? "まだ自分のフォルダに保存していません。" : ""}
                        <button
                          type="button"
                          class="btn small danger"
                          onClick={() => {
                            setAsking(null);
                            if (rd.viewing === id) rd.view(null);
                            rd.remove([id]);
                          }}
                          data-received-delete-yes={id}
                        >
                          消す
                        </button>
                        <button type="button" class="btn small" onClick={() => setAsking(null)}>
                          やめる
                        </button>
                      </span>
                    ) : (
                      <button type="button" class="link-btn" onClick={() => setAsking(id)} data-received-delete={id}>
                        消す
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
      <div class="rp-actions">
        <button type="button" class="btn" onClick={() => rd.setListOpen(false)} data-received-close>
          閉じる
        </button>
      </div>
    </section>
  );
}
