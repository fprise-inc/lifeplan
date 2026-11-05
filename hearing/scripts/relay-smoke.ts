// 手元の受け付けのサーバー（hearing/relay/ で wrangler dev。R2 は miniflare が手元に作る）に対して、Web のヒアリングの一周を流す（0125）。
// CI では流さない（wrangler を依存に入れていないため）。流し方は hearing/relay/README.md の「手元で動かす」
//   node --disable-warning=ExperimentalWarning scripts/relay-smoke.ts http://127.0.0.1:8787
import { latestSheet } from "../src/index.ts";
import { answersOf, API_PREFIX, draftKey, fetchTransport, initialDraft, issueRequest, openRequest, receive, relay, selectionFromSheet, submitAnswers, uploadFile } from "../src/web/index.ts";

const base = process.argv[2] ?? "http://127.0.0.1:8787";
const t = fetchTransport(`${base}${API_PREFIX}`);
const def = latestSheet("basic");
if (def === undefined) throw new Error("シートがありません");
const selection = { ...selectionFromSheet(def), documents: [{ id: "d1", kind: "withholding", title: "源泉徴収票（ご本人）", purpose: "年収の確かめ", where: "支払金額" }] };
const { record } = await issueRequest({ definition: def, selection, requestId: "R-SM0KE2", customerNo: "T0001", office: { name: "【架空】試しの事務所", color: null, purpose: "試し", privacyContact: "" }, days: 7, now: new Date(), pageUrl: `${base}/h/`, transport: t });
console.log("発行:", record.url.replace(/#.*/, "#（鍵）"));
const o = await openRequest(new URL(record.url).hash, t);
const photo = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...Array.from({ length: 5000 }, (_, i) => i % 256)]);
const up = await uploadFile(o, photo, t);
let d = initialDraft(o.packet);
d = { ...d, gates: { spouse: 0, child: 0 }, answers: { [draftKey("hs.family.adult.birthYearMonth", 1)]: { status: "value", raw: { kind: "text", text: "1980" }, raw2: { kind: "number", text: "5" } } }, documents: { d1: { status: "attached", files: [{ fileId: up.fileId, mime: "image/jpeg", bytes: photo.length, sha256: up.sha256, label: "写真 1" }] } } };
await submitAnswers(o, answersOf(o.packet, d, new Date()), t);
let twice = "";
try {
  await submitAnswers(o, answersOf(o.packet, d, new Date()), t);
} catch (e) {
  twice = (e as Error).message;
}
console.log("2回目の送信:", twice);
const got = await receive(record, def, t);
console.log("受け取り: 答え", got?.checked.answers.length, "書類", got?.files.length, "受け取れなかった書類", got?.missingFiles);
await relay.remove(t, record.serverId, record.secrets.pickupToken);
let gone = "";
try {
  await openRequest(new URL(record.url).hash, t);
} catch (e) {
  gone = (e as Error).message;
}
console.log("消した後:", gone);
if (twice !== "E_RELAY_SUBMITTED" || got?.files.length !== 1 || gone !== "E_RELAY_GONE") process.exit(1);
console.log("OK");
