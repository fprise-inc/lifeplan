// 事務所の既定値の画面の「説明の文（カスタム層）」（0016 の3・4・6。2026-11-02 の追記）:
// カスタム層の settings/texts.json（FP の AI が書く）を、本体が確かめた状態で見せ、FP が「承認する」「承認しない」「公式の文に戻す」を押す。
// - 承認するまで、画面の文は前に承認した文（無ければ公式の文）のまま。計算の結果は変わらない
// - 承認の画面は行ごとに「公式の文／今の事務所の文／新しい文」を並べる。誤りがあれば承認できない
// - アプリの更新で公式の文が変わった行は、「このまま使う」「公式の文に戻す」を選ぶ（アプリの画面の操作なので、その場で承認する）
// - 文は文字として出す（HTML として読まない）。押した結果はすぐ効く（下の「保存」は要らない）
import { useState } from "preact/hooks";
import type { CustomHost, CustomRowText, CustomTextsStatus } from "../../engine/host.ts";

/** 行の文の見せ方（足す・消すは公式の文との関係を添える） */
export function rowTextLabel(t: CustomRowText | null): string {
  if (t === null) return "（公式の文）";
  if (t.do === "hide") return "（出さない）";
  const text = (t.text ?? "").replace(/\{\{/g, "{").replace(/\}\}/g, "}");
  return t.do === "append" ? `（公式の文の後ろに足す）\n${text}` : text;
}

const unescape = (s: string | null): string => (s ?? "").replace(/\{\{/g, "{").replace(/\}\}/g, "}");

/** 承認した日（その PC の日付） */
export function approvedOn(at: number): string {
  const d = new Date(at * 1000);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 今の様子の1行 */
export function customStateLine(st: CustomTextsStatus): string {
  const n = st.effective.length;
  switch (st.state) {
    case "none":
      return `事務所の文はありません（公式の文のまま）。書き換えられる文は ${st.catalogSize} か所です。`;
    case "approved":
      return `事務所の文を ${n} か所で使っています${st.approved !== null ? `（${approvedOn(st.approved.approvedAt)}に承認）` : ""}。`;
    case "pending":
      return n > 0 ? `カスタム層の文が変わりました（承認待ち）。承認するまで、前に承認した文（${n} か所）のまま出しています。` : "カスタム層の文が変わりました（承認待ち）。承認するまで、公式の文のまま出しています。";
    case "declined":
      return n > 0 ? `承認しなかった中身がカスタム層のファイルに残っています。画面には前に承認した文（${n} か所）を出しています。` : "承認しなかった中身がカスタム層のファイルに残っています。画面には公式の文を出しています。";
  }
}

/** 更新で止めた理由 */
const STOP_REASON: Record<string, string> = {
  meaning: "公式の説明の意味が変わったため、事務所の文を止めて公式の文を出しています",
  vars: "事務所の文で使っていた差し込みの印が無くなったため、事務所の文を止めて公式の文を出しています",
  op: "この文にはその操作ができなくなったため、事務所の文を止めて公式の文を出しています",
};

/** 本体の誤りの符号の文 */
export function customErrorText(e: unknown): string {
  const code = String(e);
  if (code === "E_CUSTOM_CHANGED") return "見ている間にカスタム層のファイルが変わりました。新しい中身を確かめてから、もう一度押してください。";
  if (code === "E_CUSTOM_INVALID") return "誤りのある中身は承認できません。上の誤りを直してください（AI に頼むときは、この誤りの文を渡してください）。";
  if (code === "E_CUSTOM_PENDING") return "承認待ちの変更があります。先に、承認するか・承認しないかを決めてください。";
  if (code === "E_CUSTOM_PLACE_OVERLAP") return "その場所は選べません。データフォルダ・書き出しのフォルダなど、アプリが使う場所と重なっています。";
  if (code === "E_CUSTOM_PLACE") return "その場所は選べません。別のフォルダを選んでください。";
  if (code === "E_CUSTOM_IO") return "ファイルを読み書きできませんでした。フォルダの場所と権限を確かめてください。";
  if (code === "E_CUSTOM_NOTHING") return "承認待ちの変更はありません。";
  return `うまくいきませんでした（${code}）。`;
}

export function CustomTextsSection({ host, status, onStatus }: { host: CustomHost; status: CustomTextsStatus | null; onStatus: (st: CustomTextsStatus) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const run = async (f: () => Promise<CustomTextsStatus | null>, done?: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const st = await f();
      if (st !== null) onStatus(st);
      if (done !== undefined && st !== null) setMsg({ ok: true, text: done });
    } catch (e) {
      setMsg({ ok: false, text: customErrorText(e) });
    } finally {
      setBusy(false);
    }
  };
  if (status === null) {
    return (
      <section class="os-sec" aria-labelledby="os-custom" data-custom-texts="loading">
        <h3 id="os-custom">説明の文（カスタム層）</h3>
        <p class="pl-sub">読み込んでいます…</p>
      </section>
    );
  }
  const st = status;
  const changedRows = st.rows.filter((r) => r.changed);
  const inUse = st.rows.filter((r) => r.current !== null && !r.unused);
  return (
    <section class="os-sec" aria-labelledby="os-custom" data-custom-texts={st.state}>
      <h3 id="os-custom">説明の文（カスタム層）</h3>
      <p class="pl-sub">
        入力の欄の「?」の説明と、結果のタブの計算のお知らせの文を、事務所の言い方に直せます。直した文はカスタム層のフォルダの settings/texts.json に書きます（FP の AI に頼めます）。アプリの外で書き換えた文は、ここで承認するまで画面に出ません。計算の結果は変わりません。
      </p>
      <p class="pl-sub" data-custom-dir>
        カスタム層のフォルダ: <code>{st.dir}</code>
        {st.isDefaultDir ? "（既定の場所）" : ""}
        {st.folderExists ? "" : "。まだありません"}{" "}
        {!st.folderExists ? (
          <button type="button" class="link-btn" disabled={busy} onClick={() => void run(() => host.createDir(), "フォルダを作りました。AI にこのフォルダを開いてもらい、settings/texts.json を書いてもらえます。")} data-custom-create>
            フォルダを作る
          </button>
        ) : null}{" "}
        <button type="button" class="link-btn" disabled={busy} onClick={() => void run(() => host.chooseDir())} data-custom-choose>
          場所を変える
        </button>
        {!st.isDefaultDir ? (
          <>
            {" "}
            <button type="button" class="link-btn" disabled={busy} onClick={() => void run(() => host.resetDir())} data-custom-reset-dir>
              既定の場所に戻す
            </button>
          </>
        ) : null}
      </p>
      {st.ledgerReset ? (
        <p class="fatal" role="status" data-custom-ledger-reset>
          承認の記録を確かめられませんでした（書き換えられたか、事務所の鍵が変わったため）。前の承認は無効にし、公式の文を出しています。中身を確かめて、承認し直してください。
          <button type="button" class="link-btn" disabled={busy} onClick={() => void run(() => host.resetLedger())}>
            承認の記録を作り直す
          </button>
        </p>
      ) : null}
      {st.approvedMissing ? (
        <p class="fatal" role="status" data-custom-approved-missing>
          承認した中身が見つからない（または書き換えられていた）ため、公式の文を出しています。中身を確かめて、承認し直してください。
        </p>
      ) : null}
      {st.file === "unreadable" ? <p class="fatal">カスタム層の settings/texts.json を読めません（権限を確かめてください）。前に承認した文のまま出しています。</p> : null}
      <p class="pl-sub" data-custom-state-line>
        {customStateLine(st)}
      </p>
      {st.state === "pending" || st.state === "declined" ? (
        <div class={`os-custom-box${st.state === "pending" ? " pending" : ""}`} role="group" aria-label="承認待ちの説明の文" data-custom-pending={st.fingerprint}>
          {st.errors.length > 0 ? (
            <>
              <p class="fatal">このままでは承認できません（{st.errors.length} か所の誤り）:</p>
              <ul class="os-custom-issues" data-custom-errors>
                {st.errors.map((e, i) => (
                  <li key={i}>
                    {e.row !== null ? `${e.row + 1}行目` : "ファイル全体"}
                    {e.id !== null ? `（${e.id}）` : ""}: {e.message}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {st.warnings.length > 0 ? (
            <ul class="os-custom-issues pl-sub" data-custom-warnings>
              {st.warnings.map((e, i) => (
                <li key={i}>
                  {e.row !== null ? `${e.row + 1}行目` : ""}
                  {e.id !== null ? `（${e.id}）` : ""}: {e.message}
                </li>
              ))}
            </ul>
          ) : null}
          {st.unused.length > 0 ? <p class="pl-sub">使われていない行（このアプリに無い文の行。読み飛ばします）: {st.unused.join("、")}</p> : null}
          {changedRows.length > 0 ? (
            <table class="os-code-diff os-custom-diff" data-custom-diff>
              <thead>
                <tr>
                  <th scope="col">場所</th>
                  <th scope="col">公式の文</th>
                  <th scope="col">今の事務所の文</th>
                  <th scope="col">新しい文</th>
                </tr>
              </thead>
              <tbody>
                {changedRows.map((r) => (
                  <tr key={r.id} data-custom-row={r.id}>
                    <th scope="row">
                      {r.audience === "customer" ? "お客さまに見える文: " : ""}
                      {r.where !== "" ? r.where : r.id}
                    </th>
                    <td>{r.unused ? "（このアプリに無い文）" : unescape(r.official)}</td>
                    <td>{rowTextLabel(r.current)}</td>
                    <td class="os-code-diff-new">{rowTextLabel(r.next)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : st.errors.length === 0 ? (
            <p class="pl-sub">{st.file === "none" ? "カスタム層の settings/texts.json が無くなりました。承認すると、事務所の文をやめて公式の文に戻ります。" : "画面に出る文の違いはありません。"}</p>
          ) : null}
          <p class="pl-sub">AI が書いた中身でも、承認するまで画面には出ません。中身を確かめて、使ってよいときだけ押してください。</p>
          <div class="rp-actions">
            <button type="button" class="btn primary" disabled={busy || st.errors.length > 0} onClick={() => void run(() => host.approve(st.fingerprint), "承認しました。画面の文に使います（保存は要りません）。")} data-custom-approve>
              承認する
            </button>
            {st.state === "pending" ? (
              <button type="button" class="btn" disabled={busy} onClick={() => void run(() => host.decline(st.fingerprint), "承認しませんでした。前の文のまま出します。")} data-custom-decline>
                承認しない（今のまま）
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {st.updates.length > 0 ? (
        <div class="os-custom-box pending" role="group" aria-label="公式の説明が変わった所" data-custom-updates={st.updates.length}>
          <p>
            <b>アプリの更新で、事務所の文を使っている公式の説明が {st.updates.length} か所変わりました。</b>
          </p>
          <p class="pl-sub">ふつうは事務所の文をそのまま使い続けます。意味が変わった所だけは、確かめるまで公式の文を出します。直すときは、AI に頼んでファイルを直し、ここで承認してください。</p>
          <table class="os-code-diff os-custom-diff" data-custom-update-table>
            <thead>
              <tr>
                <th scope="col">場所</th>
                <th scope="col">前の公式の文</th>
                <th scope="col">新しい公式の文</th>
                <th scope="col">事務所の文</th>
                <th scope="col">選ぶ</th>
              </tr>
            </thead>
            <tbody>
              {st.updates.map((u) => (
                <tr key={u.id} data-custom-update={u.id}>
                  <th scope="row">
                    {u.where}
                    {u.stopped && u.reason !== null ? <span class="pl-sub os-custom-stop">{STOP_REASON[u.reason]}</span> : null}
                  </th>
                  <td>{u.before !== null ? unescape(u.before) : "（分かりません）"}</td>
                  <td class="os-code-diff-new">{unescape(u.official)}</td>
                  <td>{rowTextLabel(u.office)}</td>
                  <td>
                    {u.reason !== "op" && u.reason !== "vars" ? (
                      <button type="button" class="link-btn" disabled={busy || st.state !== "approved"} onClick={() => void run(() => host.rows([u.id], true), "事務所の文をこのまま使います。")} data-custom-keep={u.id}>
                        このまま使う
                      </button>
                    ) : null}{" "}
                    <button type="button" class="link-btn" disabled={busy || st.state !== "approved"} onClick={() => void run(() => host.rows([u.id], false), "公式の文に戻しました。")} data-custom-drop={u.id}>
                      公式の文に戻す
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {st.state !== "approved" ? <p class="pl-sub">先に、上の承認待ちの変更を決めてください。</p> : null}
        </div>
      ) : null}
      {st.state === "approved" && inUse.length > 0 ? (
        <details class="pl-sub" data-custom-in-use>
          <summary>使っている事務所の文を見る（{inUse.length} か所）</summary>
          <table class="os-code-diff os-custom-diff">
            <thead>
              <tr>
                <th scope="col">場所</th>
                <th scope="col">公式の文</th>
                <th scope="col">事務所の文</th>
              </tr>
            </thead>
            <tbody>
              {inUse.map((r) => (
                <tr key={r.id}>
                  <th scope="row">{r.where}</th>
                  <td>{unescape(r.official)}</td>
                  <td>{rowTextLabel(r.current)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
      {st.effective.length > 0 || st.state === "approved" ? (
        confirmRevert ? (
          <p class="rp-note" data-custom-revert-confirm>
            事務所の文を全部やめて、公式の文に戻します（カスタム層のファイルは消しません。もう一度使うときは「承認する」を押します）。
            <button
              type="button"
              class="link-btn"
              disabled={busy}
              onClick={() => {
                setConfirmRevert(false);
                void run(() => host.revert(), "公式の文に戻しました。");
              }}
            >
              戻す
            </button>
            <button type="button" class="link-btn" onClick={() => setConfirmRevert(false)}>
              やめる
            </button>
          </p>
        ) : (
          <p class="pl-sub">
            <button type="button" class="link-btn" disabled={busy} onClick={() => setConfirmRevert(true)} data-custom-revert>
              事務所の文をやめて、公式の文に戻す
            </button>
          </p>
        )
      ) : null}
      {msg !== null ? (
        <p class={msg.ok ? "rp-note" : "fatal"} role="status" data-custom-msg>
          {msg.text}
        </p>
      ) : null}
    </section>
  );
}
