// お客さまのページの入口（0125）: URL のフラグメントから鍵を出して問いを受け取り、画面を出す。
// - 通信するのは同じ所の受け付けの API だけ（CSP の connect-src 'self'）。外のスクリプト・フォント・画像は読まない
// - 下書きは、この端末のこのブラウザの中だけに、依頼の鍵から導いた鍵で暗号化して置く（送ったら消す）
// - 答えを送った後も、同じ URL で書類を送れる（0158）。開き直したときは「書類を送る」の画面。送った書類の控えも端末の中に暗号化して置く
import "./form.css";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { draftStorageKey, moreStorageKey, openDraftText, openRequest, removeFile, sealDraftText, sendDocuments, submitAnswers, uploadFile, type Opened } from "../../../hearing/src/web/customer.ts";
import { answersOf, initialDraft, readDraft, type Draft } from "../../../hearing/src/web/flow.ts";
import { API_PREFIX, fetchTransport } from "../../../hearing/src/web/protocol.ts";
import { EMPTY_MORE, errorText, HearingForm, readMore, type MoreState } from "./Form.tsx";

const transport = fetchTransport(API_PREFIX);

function store(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div class="hf">
      <main class="hf-main hf-sent">
        <h1>{title}</h1>
        <p>{text}</p>
      </main>
    </div>
  );
}

type State = { kind: "loading" } | { kind: "error"; code: string } | { kind: "ready"; o: Opened; draft: Draft; more: MoreState };

function Page() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    void (async () => {
      try {
        const o = await openRequest(location.hash, transport);
        // 答えを送った後: 頼まれた書類があれば「書類を送る」の画面（期限まで何回でも）。無ければ、もう答えてあることだけを出す
        if (o.submitted && o.packet.documents.length === 0) return setState({ kind: "error", code: "E_RELAY_SUBMITTED" });
        let more = EMPTY_MORE;
        const savedMore = store()?.getItem(moreStorageKey(o.keys));
        if (savedMore !== null && savedMore !== undefined) more = readMore(await openDraftText(o.keys, savedMore));
        let draft = initialDraft(o.packet);
        const saved = store()?.getItem(draftStorageKey(o.keys));
        if (saved !== null && saved !== undefined) {
          const v = readDraft(await openDraftText(o.keys, saved));
          if (v !== null) draft = v;
        }
        setState({ kind: "ready", o, draft, more });
      } catch (e) {
        setState({ kind: "error", code: e instanceof Error ? e.message : "E_WEB" });
      }
    })();
  }, []);
  if (state.kind === "loading") return <Message title="読み込んでいます" text="少しお待ちください。" />;
  if (state.kind === "error") {
    if (state.code === "E_WEB_LINK" || state.code === "E_WEB_DECRYPT") return <Message title="リンクが正しくありません" text="届いたリンクを、最後まで（# の後ろまで）そのまま開いてください。続くときは担当の FP にご連絡ください。" />;
    if (state.code === "E_RELAY_SUBMITTED") return <Message title="お答えいただいています" text="このご質問には、もうお答えいただいています。直したいことがあれば、担当の FP にお伝えください。" />;
    return <Message title="開けませんでした" text={errorText(state.code)} />;
  }
  const { o } = state;
  const save = (d: Draft) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void sealDraftText(o.keys, d).then((t) => store()?.setItem(draftStorageKey(o.keys), t)).catch(() => undefined), 300);
  };
  const saveMore = (m: MoreState) => void sealDraftText(o.keys, m).then((t) => store()?.setItem(moreStorageKey(o.keys), t)).catch(() => undefined);
  return (
    <HearingForm
      packet={o.packet}
      mode="live"
      initial={state.draft}
      answeredAt={o.submitted ? o.submittedAt : null}
      more={state.more}
      onMore={saveMore}
      onDraft={save}
      onClear={() => {
        clearTimeout(timer.current);
        store()?.removeItem(draftStorageKey(o.keys));
      }}
      upload={(bytes) => uploadFile(o, bytes, transport)}
      removeFile={(id) => removeFile(o, id, transport)}
      sendDocuments={(list) => sendDocuments(o, list, transport)}
      submit={async (d) => {
        await submitAnswers(o, answersOf(o.packet, d, new Date()), transport);
        clearTimeout(timer.current);
        store()?.removeItem(draftStorageKey(o.keys));
      }}
    />
  );
}

// 別の依頼のリンクを同じタブで開いた（# の後だけが変わった）ときは、読み直す
window.addEventListener("hashchange", () => location.reload());

const root = document.getElementById("hf");
if (root !== null) render(<Page />, root);
