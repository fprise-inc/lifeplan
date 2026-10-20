// 持ち帰り用のレポートの HTML ファイルの中で動く入口（0030。scripts/build-takeaway.ts が1つの JS にまとめ、HTML にハッシュつきで埋め込む）。
// 1. 計算エンジンの塊（gzip）をほどき、元の JS の SHA-256 を確かめ、blob: の URL のスクリプトとして読み込む（CSP の script-src は
//    この部品のハッシュと blob: だけ。外のサーバーからは何も読まない）
// 2. データの塊を開く（暗号化していればパスワードを聞く。違うパスワードなら開かない）
// 3. 画面（TakeawayView）を描く
import "../../styles/app.css";
import "../../styles/balance.css";
import "../takeaway.css";
import { render } from "preact";
import { useState } from "preact/hooks";
import { BLOCK, canCompress, fromBase64, gunzip, open, readHeader, sha256Hex, WrongPassword, type ContainerHeader } from "../container.ts";
import { TAKEAWAY_FORMAT, TAKEAWAY_VERSION, type TakeawayData } from "../model.ts";
import type { EngineLike } from "./calc.ts";
import { TakeawayView } from "./TakeawayView.tsx";

const text = (id: string) => document.getElementById(id)?.textContent ?? "";

async function loadEngine(): Promise<EngineLike> {
  const el = document.getElementById(BLOCK.engine);
  const want = el?.getAttribute("data-sha256") ?? "";
  const js = await gunzip(fromBase64(text(BLOCK.engine)));
  if ((await sha256Hex(js)) !== want) throw new Error("E_TAKEAWAY_ENGINE");
  const url = URL.createObjectURL(new Blob([js as Uint8Array<ArrayBuffer>], { type: "text/javascript" }));
  await new Promise<void>((ok, ng) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = () => ok();
    s.onerror = () => ng(new Error("E_TAKEAWAY_ENGINE"));
    document.body.appendChild(s);
  });
  URL.revokeObjectURL(url);
  const e = (globalThis as { FinanciaEngine?: EngineLike }).FinanciaEngine;
  if (e === undefined || typeof e.createSession !== "function") throw new Error("E_TAKEAWAY_ENGINE");
  return e;
}

function parseData(json: string): TakeawayData {
  const d = JSON.parse(json) as TakeawayData;
  if (d.payload?.format !== TAKEAWAY_FORMAT || d.payload.version !== TAKEAWAY_VERSION || !Array.isArray(d.packs) || !Array.isArray(d.payload.plans) || d.payload.plans.length === 0) throw new Error("E_TAKEAWAY_FORMAT");
  return d;
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <div class="tk-gate card" role="alert">
      <h1>{title}</h1>
      <p>{body}</p>
    </div>
  );
}

function PasswordGate({ header, onOpen }: { header: ContainerHeader; onOpen: (d: TakeawayData) => void }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (e: Event) => {
    e.preventDefault();
    if (pw === "" || busy) return;
    setBusy(true);
    setErr(null);
    try {
      onOpen(parseData(await open(header, text(BLOCK.data), pw)));
    } catch (x) {
      setErr(x instanceof WrongPassword ? "パスワードが違います。FPから伝えられたパスワードを、もう一度入れてください。" : "このファイルを開けませんでした。ファイルが壊れているかもしれません。");
      setBusy(false);
    }
  };
  return (
    <form class="tk-gate card" onSubmit={(e) => void go(e)} data-takeaway-gate>
      <h1>ライフプランの試算</h1>
      <p>このファイルはパスワードで守られています。FPから別にお伝えしたパスワードを入れてください。</p>
      <label>
        パスワード
        <input type="password" value={pw} autocomplete="off" autofocus onInput={(e) => setPw((e.currentTarget as HTMLInputElement).value)} data-takeaway-password />
      </label>
      <button type="submit" class="btn primary" disabled={busy || pw === ""} data-takeaway-open>
        {busy ? "開いています…" : "開く"}
      </button>
      {err !== null ? (
        <p class="fatal" role="alert" data-takeaway-error>
          {err}
        </p>
      ) : null}
      <p class="tk-hint">パスワードはこのパソコン・スマホの中だけで使い、どこにも送りません。</p>
    </form>
  );
}

function Boot({ header, engine }: { header: ContainerHeader; engine: EngineLike }) {
  const [data, setData] = useState<TakeawayData | null>(null);
  if (data !== null) return <TakeawayView data={data} engine={engine} />;
  return <PasswordGate header={header} onOpen={setData} />;
}

async function start(): Promise<void> {
  const root = document.getElementById("app");
  if (root === null) return;
  if (!canCompress() || typeof crypto?.subtle === "undefined") {
    render(<Message title="このブラウザでは開けません" body="お手数ですが、パソコン・スマホのブラウザを最新版にしてから開いてください。" />, root);
    return;
  }
  try {
    const header = readHeader(text(BLOCK.header));
    const engine = await loadEngine();
    root.textContent = "";
    if (header.enc === null) render(<TakeawayView data={parseData(await open(header, text(BLOCK.data), null))} engine={engine} />, root);
    else render(<Boot header={header} engine={engine} />, root);
  } catch {
    root.textContent = "";
    render(<Message title="このファイルを開けませんでした" body="ファイルが壊れているかもしれません。お手数ですが、担当のFPにご連絡ください。" />, root);
  }
}

void start();
