// 画面の入口
import "@fontsource/biz-udpgothic/400.css";
import "@fontsource/biz-udpgothic/700.css";
import "./styles/app.css";
import "./styles/header.css";
import "./styles/wire.css";
import "./styles/store.css";
import "./styles/ai.css";
import "./styles/invest.css";
import "./styles/balance.css";
import "./styles/statement.css";
import "./takeaway/takeaway.css";
import { render } from "preact";
import { App } from "./workspace/App.tsx";

const root = document.getElementById("app");
if (root !== null) render(<App />, root);

// 開発用のサーバーのときだけ: 画面の中のエラーを開発用のサーバーに送る（WebView の中が見えないときの切り分け用）
if (import.meta.env.DEV) {
  const send = (what: string) => void fetch("/__dev/report", { method: "POST", body: JSON.stringify({ devError: what }) }).catch(() => undefined);
  window.addEventListener("error", (e) => send(String(e.message)));
  window.addEventListener("unhandledrejection", (e) => send(String(e.reason)));
}
