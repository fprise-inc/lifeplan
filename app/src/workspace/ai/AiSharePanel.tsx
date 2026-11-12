// 世帯の「AIとの共有」（中央のパネル。0014・0015）:
// - 状態のカード（共有しない／同意あり／共有中）
// - 外部AIへの提供の同意を記録する（範囲・同意の取り方・日付・FP の確認）。撤回もここで記録する（撤回すると共有はすぐに止まる）
// - 前の版の説明・ヒアリングシートの同意欄（書類を含まない）で同意した世帯は、今の説明で同意を記録し直せる（0157・0172。計算の項目はそのまま渡せる）
// - 同意は「外部の AI サービスに渡すことへの同意」1つ。どの AI の会社かは聞かない（0172。前の版の記録の会社はそのまま出す）
// - 世帯をAIに渡す（申告した接続先・期限）・取り消す
// - 記録: 同意の記録・AIに渡した記録（いつ・どの接続から・何を・何回）・AIからの候補
// 記録を書くのは本体。画面は入力を送り、本体が返した記録を見せるだけ
import { useEffect, useRef, useState } from "preact/hooks";
import type { AiConsentDecision, AiConsentMethod, AiHost, AiHouseholdView, AiStatus } from "../../engine/host.ts";
import { aiMessage, codeOf, consentCoversDocuments, consentMethods, DECISION_LABELS, dateTimeText, durationText, END_REASONS, itemName, METHODS, methodLabel, readCount, remainingText, shareState, SHARE_STATE_TEXT, todayText } from "./model.ts";

export type AiPanelTab = "consent" | "records";

export interface AiSharePanelProps {
  ai: AiHost;
  householdId: string;
  customerNo: string;
  status: AiStatus | null;
  view: AiHouseholdView | null;
  onView: (v: AiHouseholdView) => void;
  onOpenConnector: () => void;
  onClose: () => void;
  initialTab?: AiPanelTab;
}

interface ConsentForm {
  noTraining: boolean;
  method: AiConsentMethod;
  date: string;
  confirmed: boolean;
}

/** 書類を含まない同意（前の版の説明・ヒアリングシートの同意欄）の世帯を渡すときの注意（0157・0172） */
const NO_DOCUMENTS_NOTE = "この世帯の同意は、書類を AI に渡すことを含みません。同意を記録し直すまで、書類は AI に渡さないでください（AI から書類の候補が届いても受け取りません）。";

/** 同意の記録が書類の読み取りを含むか（`given` の行だけに付ける言葉） */
const documentsLabel = (documents: boolean | undefined, method: AiConsentMethod): string =>
  documents === true ? "・書類の読み取りを含む" : method === "hearingSheet" ? "・シートの同意欄の文（書類を含まない）" : "・前の版の説明（書類を含まない）";

/** 前の版で記録した行の提供先（会社・所在国。今は聞かない。0172） */
const providerText = (e: { company?: string; country?: string } | undefined): string | null =>
  e?.company !== undefined ? `${e.company}${e.country !== undefined ? `（${e.country}）` : ""}` : null;

const emptyForm = (): ConsentForm => ({ noTraining: false, method: "paper", date: todayText(), confirmed: false });

export function AiSharePanel(p: AiSharePanelProps) {
  const [tab, setTab] = useState<AiPanelTab>(p.initialTab ?? "consent");
  const [form, setForm] = useState<ConsentForm>(emptyForm);
  const [withdraw, setWithdraw] = useState<{ method: AiConsentMethod; date: string; confirmed: boolean } | null>(null);
  const [destination, setDestination] = useState("");
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // 開いたときに1回だけ、パネルに焦点を移す（読み直しのたびに入力欄から焦点を奪わない）
  useEffect(() => panel.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [p.onClose]);

  const run = async (fn: () => Promise<AiHouseholdView>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      p.onView(await fn());
      setMsg({ ok: true, text: ok });
      return true;
    } catch (e) {
      setMsg({ ok: false, text: aiMessage(codeOf(e)) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const record = async (decision: AiConsentDecision) => {
    const done = await run(
      () => p.ai.recordConsent(p.householdId, { decision, obtainedOn: form.date, method: renew && form.method === "hearingSheet" ? "paper" : form.method, noTrainingConfirmed: form.noTraining, fpConfirmed: form.confirmed }),
      decision === "given" ? "同意を記録しました" : "同意しなかったことを記録しました",
    );
    if (done) setForm(emptyForm());
  };

  const v = p.view;
  const state = shareState(p.status, v);
  const text = SHARE_STATE_TEXT[state];
  const latest = v?.consents.filter((c) => c.kind === "externalAi" && c.origin === "thisOffice").at(-1);
  const enabled = p.status?.enabled === true;
  // 架空の世帯（AIの候補から架空として作った世帯）: お客さまの情報を含まないので、同意の記録は要らない（期限・取り消し・記録は同じ）
  const fictional = v?.fictional === true;
  // 書類を含まない同意（前の版の説明・ヒアリングシートの同意欄）の世帯: 計算の項目は渡せるが、書類を AI に渡す前に取り直す（0157・0172）
  const renew = v !== null && v.consentState === "given" && v.consentDocuments !== true;
  // ヒアリングシートの同意欄で記録する（シートの文で、書類を含まない。取り直しでは選べない。0172）
  const sheet = !renew && form.method === "hearingSheet";
  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={p.onClose} />
      <div ref={panel} class="rk-panel ai-panel" role="dialog" aria-modal="true" aria-labelledby="ai-share-title" tabIndex={-1} data-ai-share-panel={tab}>
        <h2 id="ai-share-title">
          AIとの共有（顧客番号 {p.customerNo}
          {fictional ? "・架空の世帯" : ""}）
        </h2>
        <div class={`ai-state s-${state}`} data-ai-state={state}>
          <b>{state === "sharing" && v?.share != null ? `共有中・${remainingText(v.share.expiresInSec)}` : text.short.replace(/^AI: /, "")}</b>
          <span>{text.long}</span>
        </div>
        <nav class="ai-tabs" aria-label="AIとの共有の画面">
          <button type="button" class={tab === "consent" ? "on" : ""} onClick={() => setTab("consent")} data-ai-tab="consent">
            同意と共有
          </button>
          <button type="button" class={tab === "records" ? "on" : ""} onClick={() => setTab("records")} data-ai-tab="records">
            共有の記録{v !== null && v.records.length > 0 ? `（${v.records.length}）` : ""}
          </button>
        </nav>
        {msg !== null ? (
          <p class={msg.ok ? "rk-ok" : "hh-err"} role="status">
            {msg.text}
          </p>
        ) : null}
        {v === null ? (
          <p class="in-note">読み込んでいます…</p>
        ) : tab === "consent" ? (
          <>
            <h3>外部AIへの提供の同意</h3>
            {fictional ? (
              <p class="in-note" data-ai-fictional-note>
                この世帯は、AIの候補から作った架空の世帯です（お客さまの情報を含みません）。同意の記録が無くても AI に渡せます。期限・取り消し・共有の記録・渡すのは計算に要る項目だけ（縮約版）は、お客さまの世帯と同じです。お客さまの世帯にしたら（世帯の一覧の「お客さまの世帯にする」）、同意を記録するまで渡せません。
              </p>
            ) : null}
            {fictional ? null : latest !== undefined ? (
              <p class="ai-latest" data-ai-consent-latest={latest.decision}>
                いまの記録: <b>{DECISION_LABELS[latest.decision]}</b>（{latest.obtainedOn}・{methodLabel(latest.method)}
                {providerText(latest.externalAi) !== null ? `・提供先 ${providerText(latest.externalAi)}` : ""}
                {latest.decision === "given" ? documentsLabel(latest.documents, latest.method) : ""}）
              </p>
            ) : (
              <p class="in-note">まだ記録がありません。同意が無い世帯は、AIに渡せません（既定は「渡さない」）。</p>
            )}
            {renew ? (
              <p class="hh-warn" data-ai-consent-renew>
                この世帯の同意は{latest?.method === "hearingSheet" ? "ヒアリングシートの同意欄" : "前の版の説明"}でいただいたもので、書類の読み取りで書類を AI に渡すことは含まれていません。計算に要る項目を AI に渡すことは、このまま続けられます。書類を AI に渡す前に、お客さまに今の説明を見せて、同意を記録し直してください。今の説明に同意いただけないときは、記録しなくてかまいません（書類は AI に渡さず、手で入れてください）。
              </p>
            ) : null}
            {!fictional && (v.consentState !== "given" || renew) ? (
              <form
                class="ai-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void record("given");
                }}
                data-ai-consent-form
              >
                {sheet ? (
                  <p class="in-note" data-ai-sheet-note>
                    ヒアリングシートの同意欄の次の文で記録します。この文は書類の読み取りに触れていないので、書類を AI に渡すことを含まない同意になります。書類を AI に渡す世帯は、記録した後に、今の説明を見せて記録し直してください。
                  </p>
                ) : (
                  <p class="in-note">顧客に次の説明{v.explanationVersion !== undefined ? `（版${v.explanationVersion}）` : ""}を見せて（読み上げて）、同意をいただいてから記録してください。</p>
                )}
                <blockquote class="ai-explain" data-ai-explanation={sheet ? "hearingSheet" : "app"}>
                  {(sheet ? (v.hearingSheetExplanation ?? "") : v.explanation).split("\n").map((l) => (
                    <p key={l}>{l}</p>
                  ))}
                </blockquote>
                <div class="ai-grid">
                  <label>
                    同意の取り方
                    <select value={sheet || consentMethods(renew).some((m) => m.value === form.method) ? form.method : "paper"} onChange={(e) => setForm({ ...form, method: (e.currentTarget as HTMLSelectElement).value as AiConsentMethod })} data-ai-method>
                      {consentMethods(renew).map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    同意を得た日
                    <input type="date" value={form.date} max={todayText()} onInput={(e) => setForm({ ...form, date: (e.currentTarget as HTMLInputElement).value })} data-ai-date />
                  </label>
                </div>
                <fieldset class="ai-scope">
                  <legend>渡してよい範囲</legend>
                  <label>
                    <input type="radio" checked readOnly /> 計算に要る項目だけ（縮約版 {v.allowlistVersion}・{v.fields.length}項目）
                  </label>
                  <details>
                    <summary>渡す項目を見る</summary>
                    <p class="ai-fields">{v.fields.map(itemName).filter((x, i, a) => a.indexOf(x) === i).join("・")}</p>
                  </details>
                  <p class="in-note">お名前・ご住所・お電話番号は持っていません。顧客番号・FPのメモ・相談内容の文章・呼び名・ほかの世帯は渡しません。</p>
                  <label>
                    <input type="checkbox" checked={consentCoversDocuments(sheet ? "hearingSheet" : "paper")} disabled data-ai-scope-documents /> 書類の読み取り: 担当のFPが、お名前・ご住所・番号を伏せた書類を、読み取りのために AI に渡すことがあります
                    {sheet ? "（ヒアリングシートの同意欄では含みません）" : "（説明の3段落目）"}
                  </label>
                </fieldset>
                <label class="ai-check">
                  <input type="checkbox" checked={form.noTraining} onChange={(e) => setForm({ ...form, noTraining: (e.currentTarget as HTMLInputElement).checked })} data-ai-no-training />
                  使う AI サービスで、渡した情報がAIの学習に使われない設定であることを確かめました
                </label>
                <label class="ai-check">
                  <input type="checkbox" checked={form.confirmed} onChange={(e) => setForm({ ...form, confirmed: (e.currentTarget as HTMLInputElement).checked })} data-ai-confirm />
                  {sheet ? "顧客がヒアリングシートの同意欄で、上の文に同意していることを確かめました（FPの確認）" : "上の説明を顧客に見せて、同意をいただいたことを確かめました（FPの確認）"}
                </label>
                <div class="ai-actions">
                  <button type="submit" class="btn primary" disabled={busy || !form.confirmed} data-ai-record-given>
                    {renew ? "今の説明で同意を記録し直す" : "同意を記録する"}
                  </button>
                  {!renew ? (
                    <button type="button" class="btn" disabled={busy || !form.confirmed} onClick={() => void record("refused")} data-ai-record-refused>
                      同意しなかったことを記録する
                    </button>
                  ) : null}
                </div>
              </form>
            ) : null}
            {v.consentState !== "given" ? null : withdraw === null ? (
              <button type="button" class="link-btn danger" onClick={() => setWithdraw({ method: "inPerson", date: todayText(), confirmed: false })} data-ai-withdraw-open>
                撤回を記録する
              </button>
            ) : (
              <form
                class="ai-form ai-withdraw"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => p.ai.recordConsent(p.householdId, { decision: "withdrawn", obtainedOn: withdraw.date, method: withdraw.method, noTrainingConfirmed: false, fpConfirmed: withdraw.confirmed }), "撤回を記録しました。この世帯の共有は止めました").then((ok) => ok && setWithdraw(null));
                }}
              >
                <p>撤回を記録すると、この世帯の共有をすぐに止め、これからはAIに渡せません。すでに渡した内容は、AIの会社の側に残ることがあります。</p>
                <div class="ai-grid">
                  <label>
                    撤回の受け方
                    <select value={withdraw.method} onChange={(e) => setWithdraw({ ...withdraw, method: (e.currentTarget as HTMLSelectElement).value as AiConsentMethod })}>
                      {METHODS.map((m) => (
                        <option key={m.value} value={m.value}>
                          {m.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    撤回を受けた日
                    <input type="date" value={withdraw.date} max={todayText()} onInput={(e) => setWithdraw({ ...withdraw, date: (e.currentTarget as HTMLInputElement).value })} />
                  </label>
                </div>
                <label class="ai-check">
                  <input type="checkbox" checked={withdraw.confirmed} onChange={(e) => setWithdraw({ ...withdraw, confirmed: (e.currentTarget as HTMLInputElement).checked })} data-ai-withdraw-confirm />
                  顧客から撤回の申し出を受けたことを確かめました（FPの確認）
                </label>
                <div class="ai-actions">
                  <button type="submit" class="btn danger" disabled={busy || !withdraw.confirmed} data-ai-withdraw>
                    撤回を記録する
                  </button>
                  <button type="button" class="link-btn" onClick={() => setWithdraw(null)}>
                    キャンセル
                  </button>
                </div>
              </form>
            )}

            <h3>この世帯をAIに渡す</h3>
            {!enabled ? (
              <p class="in-note">
                AI接続口はオフです（既定）。
                <button type="button" class="link-btn" onClick={p.onOpenConnector} data-ai-open-connector>
                  事務所の設定を開く
                </button>
              </p>
            ) : v.share !== null ? (
              <div class="ai-sharing" data-ai-sharing>
                <p>
                  AIには「<b>{v.share.alias}</b>」として見えています（顧客番号・お名前は渡していません）。{remainingText(v.share.expiresInSec)}。
                </p>
                {renew ? <p class="in-note" data-ai-sharing-no-documents>{NO_DOCUMENTS_NOTE}</p> : null}
                <button type="button" class="btn danger" disabled={busy} onClick={() => void run(() => p.ai.stopShare(p.householdId), "共有を取り消しました")} data-ai-stop>
                  共有を取り消す
                </button>
              </div>
            ) : v.consentState !== "given" && !fictional ? (
              <p class="in-note">外部AIへの提供の同意を記録すると、渡せるようになります。</p>
            ) : (
              <form
                class="ai-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => p.ai.startShare(p.householdId, minutes, destination), "AIに渡しました。期限が来るか取り消すまで、AI接続口から読めます");
                }}
                data-ai-share-form
              >
                <div class="ai-grid">
                  <label>
                    使うAIのアプリ（申告）
                    <input value={destination} maxLength={60} placeholder="例: 事務所のAIアプリ" onInput={(e) => setDestination((e.currentTarget as HTMLInputElement).value)} data-ai-destination />
                  </label>
                  <label>
                    期限
                    <select value={String(minutes)} onChange={(e) => setMinutes(Number((e.currentTarget as HTMLSelectElement).value))} data-ai-minutes>
                      {(p.status?.durations ?? [60]).map((m) => (
                        <option key={m} value={String(m)}>
                          {durationText(m)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <ul class="ai-limits">
                  <li>渡すのは計算に要る項目だけ（縮約版）です。物の ID は共有ごとの仮の ID に置き換えます。</li>
                  <li>許可は「このPCのAI接続口全体」に出すものです。申告したアプリの名前は確かめられません（記録には申告として残ります）。</li>
                  <li>取り消しで止まるのは今後の読み取りだけです。すでに送った内容は、AIの会社の側に残ります。</li>
                  {renew ? <li data-ai-share-no-documents>{NO_DOCUMENTS_NOTE}</li> : null}
                </ul>
                <div class="ai-actions">
                  <button type="submit" class="btn primary" disabled={busy || destination.trim() === ""} data-ai-share-start>
                    この世帯をAIに渡す
                  </button>
                </div>
              </form>
            )}
          </>
        ) : (
          <AiRecords view={v} />
        )}
        <div class="rk-foot">
          <button type="button" class="btn" onClick={p.onClose} data-ai-share-close>
            閉じる
          </button>
        </div>
      </div>
    </>
  );
}

/** 共有の記録（同意の記録・AIに渡した記録・AIからの候補） */
export function AiRecords({ view }: { view: AiHouseholdView }) {
  const records = [...view.records].reverse();
  // 提供先の会社は、前の版で記録した行だけが持つ（今は聞かない。0172）。そういう行があるときだけ列を出す
  const withProvider = view.consents.some((c) => providerText(c.externalAi) !== null);
  return (
    <div class="ai-records" data-ai-records>
      <p class="in-note">接続先は FP の申告、呼び出し元は観測できた範囲の参考情報で、どちらも認証ではありません。記録は追記だけで、書き換え・削除はできません（世帯の完全削除のときだけ消えます）。</p>
      <h3>AIに渡した記録（{view.records.length}件）</h3>
      {records.length === 0 ? <p class="in-note">まだありません。</p> : null}
      {records.map((r) => (
        <section key={r.id} class="ai-record" data-ai-record={r.shareId}>
          <div class="ai-record-h">
            <b>{dateTimeText(r.grantedAt)} に渡した</b>
            <span>{r.endedAt === null ? `共有中（期限 ${dateTimeText(r.expiresAt)}）` : `${dateTimeText(r.endedAt)} に終わり（${END_REASONS[r.endReason ?? ""] ?? r.endReason}）`}</span>
          </div>
          <dl class="ai-kv">
            <dt>申告した接続先</dt>
            <dd>{r.destinationDeclared}</dd>
            <dt>範囲</dt>
            <dd>
              {r.scope === "reduced" ? "縮約版" : r.scope}（{r.allowlistVersion}・{r.fields.length}項目）
            </dd>
            <dt>渡した時点の同意</dt>
            <dd>{r.consentAtGrant.state === "given" ? "同意あり" : `同意なし（${r.consentAtGrant.state}）`}</dd>
            <dt>読まれた回数</dt>
            <dd>{readCount(r)}回</dd>
            <dt>プランの候補</dt>
            <dd>{r.proposals.length}件</dd>
          </dl>
          {r.reads.length > 0 ? (
            <table class="plan-list ai-reads">
              <thead>
                <tr>
                  <th>読まれた日時</th>
                  <th>道具</th>
                  <th>回数</th>
                  <th>呼び出し元（参考）</th>
                  <th>中身の指紋</th>
                </tr>
              </thead>
              <tbody>
                {r.reads.map((x, i) => (
                  <tr key={i}>
                    <td class="num">
                      {dateTimeText(x.firstAt)}
                      {x.count > 1 ? `〜${dateTimeText(x.lastAt)}` : ""}
                    </td>
                    <td>{x.tool}</td>
                    <td class="num">{x.count}</td>
                    <td>
                      {[x.caller.mcpClientDeclared !== null ? `名乗り: ${x.caller.mcpClientDeclared}` : null, x.caller.parentExe !== null ? `起動したアプリ: ${x.caller.parentExe}` : null, x.caller.connectorExe !== null ? `接続口: ${x.caller.connectorExe}${x.caller.connectorPid !== null ? `（${x.caller.connectorPid}）` : ""}` : null]
                        .filter((s) => s !== null)
                        .join("・") || "—"}
                    </td>
                    <td class="ai-digest">{x.digest.slice(0, 19)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p class="in-note">まだ読まれていません。</p>
          )}
        </section>
      ))}
      <h3>AIからの候補（{view.candidates.length}件）</h3>
      {view.candidates.length === 0 ? <p class="in-note">まだありません。</p> : null}
      {view.candidates.length > 0 ? (
        <table class="plan-list">
          <thead>
            <tr>
              <th>届いた日時</th>
              <th>AIが書いた題名</th>
              <th>変更</th>
              <th>判断</th>
            </tr>
          </thead>
          <tbody>
            {[...view.candidates].reverse().map((c) => (
              <tr key={c.id} data-ai-candidate-row={c.status}>
                <td class="num">{dateTimeText(c.receivedAt)}</td>
                <td>{c.title}</td>
                <td class="num">{c.diffs.length}件</td>
                <td>{c.status === "pending" ? "承認待ち" : `${c.status === "accepted" ? "プランとして保存" : "捨てた"}（${dateTimeText(c.decidedAt)}）`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <h3>同意の記録（{view.consents.length}件）</h3>
      {view.consents.length === 0 ? <p class="in-note">まだありません。</p> : null}
      {view.consents.length > 0 ? (
        <table class="plan-list">
          <thead>
            <tr>
              <th>記録した日時</th>
              <th>判断</th>
              <th>日付</th>
              <th>取り方</th>
              {withProvider ? <th>提供先（前の記録）</th> : null}
              <th>学習に使われない設定</th>
            </tr>
          </thead>
          <tbody>
            {[...view.consents].reverse().map((c) => (
              <tr key={c.id} data-ai-consent-row={c.decision}>
                <td class="num">{dateTimeText(c.recordedAt)}</td>
                <td>
                  {DECISION_LABELS[c.decision]}
                  {c.decision === "given" ? `（${documentsLabel(c.documents, c.method).slice(1)}）` : ""}
                  {c.origin === "previousOffice" ? "（引き継ぎ）" : ""}
                </td>
                <td class="num">{c.obtainedOn}</td>
                <td>{methodLabel(c.method)}</td>
                {withProvider ? <td>{providerText(c.externalAi) ?? "—"}</td> : null}
                <td>{c.externalAi !== undefined ? (c.externalAi.noTrainingConfirmed ? "確かめた" : "確かめていない") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
