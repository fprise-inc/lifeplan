// お客さまのページの入口（0125）: URL のフラグメントから鍵を出して問いを受け取り、画面を出す。
// - 通信するのは同じ所の受け付けの API だけ（CSP の connect-src 'self'）。外のスクリプト・フォント・画像は読まない
// - 下書きは、この端末のこのブラウザの中だけに、依頼の鍵から導いた鍵で暗号化して置く（送ったら消す）
import "./form.css";
import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { draftStorageKey, openDraftText, openRequest, removeFile, sealDraftText, submitAnswers, uploadFile, type Opened } from "../../../hearing/src/web/customer.ts";
import { answersOf, initialDraft, readDraft, type Draft } from "../../../hearing/src/web/flow.ts";
import { API_PREFIX, fetchTransport } from "../../../hearing/src/web/protocol.ts";
import { errorText, HearingForm } from "./Form.tsx";

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

type State = { kind: "loading" } | { kind: "error"; code: string } | { kind: "ready"; o: Opened; draft: Draft };

function Page() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    void (async () => {
      try {
        const o = await openRequest(location.hash, transport);
        if (o.submitted) return setState({ kind: "error", code: "E_RELAY_SUBMITTED" });
        let draft = initialDraft(o.packet);
        const saved = store()?.getItem(draftStorageKey(o.keys));
        if (saved !== null && saved !== undefined) {
          const v = readDraft(await openDraftText(o.keys, saved));
          if (v !== null) draft = v;
        }
        setState({ kind: "ready", o, draft });
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
  return (
    <HearingForm
      packet={o.packet}
      mode="live"
      initial={state.draft}
      onDraft={save}
      upload={(bytes) => uploadFile(o, bytes, transport)}
      removeFile={(id) => removeFile(o, id, transport)}
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
