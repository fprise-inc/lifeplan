// 事務所の共有の設定（中央のパネル。0023）:
// - 既定はオフ。1人で使うときは何もしなくてよい
// - 始める（最初の1人）・参加する（2人目から）: 共有フォルダは本体が OS のダイアログで選ばせる（画面はパスを持たない）
// - 参加の申請と承認: 承認する人は、申請した人から別の経路で聞いた指紋（16文字）を入力する。申請の指紋は画面に出さない
// - メンバーの一覧（表示名・指紋・参加日）と、外す（確認つき・親鍵の入れ替え。外した人の手元の写しは消せないことを正直に出す）
import { useEffect, useRef, useState } from "preact/hooks";
import type { OfficeHost, OfficeStatus } from "../../engine/host.ts";
import { shortDate } from "./HouseholdPanel.tsx";
import { normalizeFingerprint, officeMessage } from "./office.ts";

export interface OfficePanelProps {
  office: OfficeHost;
  status: OfficeStatus | null;
  onStatus: (s: OfficeStatus) => void;
  /** 世帯を移した・始めた（世帯の一覧を読み直す） */
  onHouseholdsChanged: () => void;
  /** 事務所の復元キーのパネルを開く */
  onRecovery: () => void;
  onClose: () => void;
}

const codeOf = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "E_OFFICE");

export function OfficePanel(p: OfficePanelProps) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [name, setName] = useState("");
  const [fps, setFps] = useState<Record<string, string>>({});
  const [removing, setRemoving] = useState<{ id: string; name: string; value: string } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const st = p.status;

  useEffect(() => panel.current?.focus({ preventScroll: true }), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [p.onClose]);
  // 承認待ちの間は、名簿に入ったかを時々確かめる
  useEffect(() => {
    if (st?.state !== "pending") return;
    const t = setInterval(() => void p.office.status().then(p.onStatus, () => undefined), 5000);
    return () => clearInterval(t);
  }, [st?.state, p.office, p.onStatus]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ ok: false, text: officeMessage(codeOf(e)) });
    } finally {
      setBusy(false);
    }
  };

  const nameOk = name.trim() !== "" && [...name.trim()].length <= 20;
  const nameField = (
    <label class="of-name">
      あなたの表示名（ほかのメンバーに見える名前）
      <input value={name} maxLength={20} placeholder="例: 佐藤" onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} data-office-name />
      <span class="pl-sub">あなた（FP）の名前です。顧客のお名前は入れないでください</span>
    </label>
  );

  return (
    <>
      <div class="scrim" aria-hidden="true" onClick={p.onClose} />
      <div ref={panel} class="rk-panel of-panel" role="dialog" aria-modal="true" aria-labelledby="of-title" tabIndex={-1} data-office-panel={st?.state ?? "loading"}>
        <h2 id="of-title">事務所の共有</h2>
        {st === null ? <p>読み込んでいます…</p> : null}
        {st?.state === "off" ? (
          <>
            <p>
              複数の FP で、同じ顧客の世帯をそれぞれの PC で開けるようにします。世帯は、事務所で選んだ共有フォルダ（同期サービスの同期フォルダや社内のファイルサーバー）に、
              <b>暗号化したまま</b>置きます。提供元のサーバーは使いません。1人で使うときは、このままで構いません。
            </p>
            {nameField}
            <h3>事務所で最初の1人として始める</h3>
            <p class="pl-sub">共有フォルダを選ぶと、その中に事務所のフォルダを作り、このPCの世帯（{st.localHouseholds}件）を移します。事務所の復元キーが新しくなるので、保管してください。</p>
            <button
              type="button"
              class="btn primary"
              disabled={busy || !nameOk}
              onClick={() =>
                void run(async () => {
                  const r = await p.office.start(name);
                  if (r === null) return;
                  p.onStatus(r);
                  p.onHouseholdsChanged();
                  setMsg({ ok: true, text: "事務所の共有を始めました。事務所の復元キーを保管してください" });
                  // 共有の事務所の復元キーは新しくなるので、すぐに保管の案内を出す（0013 の3・0023 の1）
                  p.onRecovery();
                })
              }
              data-office-start
            >
              共有フォルダを選んで始める
            </button>
            <h3>事務所の共有に参加する</h3>
            <p class="pl-sub">事務所を始めた人と同じ共有フォルダを選ぶと、参加の申請を置きます。ほかのメンバーが承認すると使えます。</p>
            <button
              type="button"
              class="btn"
              disabled={busy || !nameOk}
              onClick={() =>
                void run(async () => {
                  const r = await p.office.join(name);
                  if (r !== null) p.onStatus(r);
                })
              }
              data-office-join
            >
              共有フォルダを選んで参加を申請する
            </button>
          </>
        ) : null}
        {st?.state === "pending" ? (
          <>
            <p>
              参加の申請を置きました。承認する人（事務所のメンバー）に、<b>電話や対面など、ファイルとは別の方法で</b>、次の指紋を読み上げて伝えてください。
              承認されると、自動で使えるようになります。
            </p>
            <div class="rk-key of-fp" data-office-my-fingerprint>
              {st.myFingerprint ?? "—"}
            </div>
            <p class="pl-sub">指紋は、あなたのこのPCの鍵の印です。ほかの人が同じ名前で申請を置いても、指紋が合わないので承認されません。</p>
            <div class="rk-row">
              <button type="button" class="btn" disabled={busy} onClick={() => void run(async () => p.onStatus(await p.office.status()))}>
                承認されたか確かめる
              </button>
              <button type="button" class="link-btn danger" disabled={busy} onClick={() => void run(async () => p.onStatus(await p.office.cancel()))} data-office-cancel>
                申請を取り下げる
              </button>
            </div>
          </>
        ) : null}
        {st?.state === "removed" ? (
          <>
            <p class="hh-warn">この事務所の共有から外されました。共有フォルダの世帯は、このPCでは開けません。</p>
            <button type="button" class="btn" disabled={busy} onClick={() => void run(async () => p.onStatus(await p.office.cancel()))}>
              このPCの中の事務所に戻る
            </button>
          </>
        ) : null}
        {st?.state === "unavailable" ? (
          <>
            <p class="hh-warn">{officeMessage(st.problem ?? "E_OFFICE_UNAVAILABLE")}</p>
            <button type="button" class="btn" disabled={busy} onClick={() => void run(async () => p.onStatus(await p.office.status()))}>
              確かめ直す
            </button>
          </>
        ) : null}
        {st?.state === "member" ? (
          <>
            <p>
              事務所の共有: <b>オン</b>
              {st.syncFolder ? "（共有フォルダは同期フォルダの中）" : ""}。あなたの表示名は <b>{st.myName}</b>、指紋は <code class="of-code">{st.myFingerprint}</code>
            </p>
            <p class="pl-sub">
              事務所の確かめ用の番号 <code class="of-code" data-office-code>{st.officeCode}</code>（全員の画面で同じになります。参加した人は、承認した人の画面と同じかを確かめてください）
            </p>
            {st.requests.length > 0 ? (
              <>
                <h3>参加の申請（{st.requests.length}）</h3>
                <p class="pl-sub">
                  申請した人の画面に出ている<b>指紋（16文字）を、電話や対面で読み上げてもらって</b>入力してください。共有フォルダに書ける人なら誰でも申請を置けるため、指紋が合わないと承認できません。
                </p>
                <ul class="of-requests">
                  {st.requests.map((r) => {
                    const v = fps[r.requestId] ?? "";
                    const ok = normalizeFingerprint(v) !== null;
                    return (
                      <li key={r.requestId} data-office-request={r.name}>
                        <span>
                          <b>{r.name}</b> さん <span class="pl-sub">{shortDate(r.requestedAt)} に申請</span>
                        </span>
                        <input
                          class="of-fp-input"
                          value={v}
                          placeholder="例: 7K2M-QX9P-ABCD-EFGH"
                          aria-label={`${r.name}さんの指紋`}
                          onInput={(e) => setFps({ ...fps, [r.requestId]: (e.currentTarget as HTMLInputElement).value })}
                          data-office-fingerprint
                        />
                        <button
                          type="button"
                          class="btn primary"
                          disabled={busy || !ok}
                          onClick={() =>
                            void run(async () => {
                              p.onStatus(await p.office.approve(r.requestId, v));
                              setMsg({ ok: true, text: `${r.name}さんを承認しました` });
                            })
                          }
                          data-office-approve
                        >
                          承認する
                        </button>
                        <button type="button" class="link-btn danger" disabled={busy} onClick={() => void run(async () => p.onStatus(await p.office.reject(r.requestId)))}>
                          断る
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : null}
            <h3>メンバー（{st.members.length}）</h3>
            <div class="plan-list-wrap">
              <table class="plan-list of-members">
                <thead>
                  <tr>
                    <th>表示名</th>
                    <th>指紋</th>
                    <th>参加日</th>
                    <th>承認した人</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {st.members.map((m) => (
                    <tr key={m.memberId} data-office-member={m.name}>
                      <td>
                        <b>{m.name}</b>
                        {m.isMe ? <span class="pl-tag">あなた</span> : null}
                      </td>
                      <td>
                        <code class="of-code">{m.fingerprint}</code>
                      </td>
                      <td class="num">{shortDate(m.joinedAt).slice(0, 10)}</td>
                      <td>{m.approvedBy ?? "（始めた人）"}</td>
                      <td>
                        {!m.isMe && st.members.length > 1 ? (
                          <button type="button" class="link-btn danger" onClick={() => setRemoving({ id: m.memberId, name: m.name, value: "" })} data-office-remove={m.name}>
                            外す
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {removing !== null ? (
              <div class="of-remove" role="alert" data-office-remove-confirm>
                <p>
                  <b>{removing.name}さんを外すと</b>、事務所の鍵とすべての世帯の鍵を入れ替え、これから保存する内容は{removing.name}さんには読めなくなります。
                </p>
                <p>
                  ただし、<b>{removing.name}さんのPCに既に同期された写しや、{removing.name}さんが書き出したファイルは、このアプリからは消せません</b>（外す時点までの内容は読めるままです）。
                  共有フォルダの共有の設定からも{removing.name}さんを外してください。事務所の復元キーも新しくなるので、保管し直してください。
                </p>
                <label>
                  確認のため表示名（{removing.name}）を入れてください{" "}
                  <input value={removing.value} onInput={(e) => setRemoving({ ...removing, value: (e.currentTarget as HTMLInputElement).value })} data-office-remove-input />
                </label>
                <div class="rk-row">
                  <button
                    type="button"
                    class="btn danger"
                    disabled={busy || removing.value.trim() !== removing.name}
                    onClick={() =>
                      void run(async () => {
                        p.onStatus(await p.office.remove(removing.id, removing.value));
                        setMsg({ ok: true, text: `${removing.name}さんを外し、鍵を入れ替えました。事務所の復元キーを保管し直してください` });
                        setRemoving(null);
                        p.onRecovery();
                      })
                    }
                    data-office-remove-go
                  >
                    外す（鍵を入れ替える）
                  </button>
                  <button type="button" class="link-btn" onClick={() => setRemoving(null)}>
                    やめる
                  </button>
                </div>
              </div>
            ) : null}
            {st.removed.length > 0 ? (
              <p class="pl-sub">
                外したメンバー: {st.removed.map((r) => `${r.name}（${shortDate(r.removedAt).slice(0, 10)}）`).join("、")}
              </p>
            ) : null}
            {st.localHouseholds > 0 ? (
              <p>
                このPCの中に、まだ共有していない世帯が {st.localHouseholds}件 あります。{" "}
                <button
                  type="button"
                  class="btn"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const n = await p.office.moveLocal();
                      p.onStatus(await p.office.status());
                      p.onHouseholdsChanged();
                      setMsg({ ok: true, text: `${n}件の世帯を共有フォルダへ移しました` });
                    })
                  }
                  data-office-move
                >
                  共有フォルダへ移す
                </button>
              </p>
            ) : null}
            <h3>事務所の復元キー</h3>
            <p>
              {st.recoveryAcknowledged ? `保管済み（${st.recoveryAcknowledgedBy ?? "メンバー"}さん、${shortDate(st.recoveryAcknowledgedAt ?? "")}）` : "まだ保管されていません。事務所の代表の方が保管してください。"}{" "}
              <button type="button" class="link-btn" onClick={p.onRecovery}>
                復元キーを表示・保管する
              </button>
            </p>
            <h3>知っておいてほしいこと</h3>
            <ul class="of-notes">
              <li>ほかの人が開いている世帯を開くと「○○さんが開いています」と出ます。同期の遅れの分だけ遅れて届く目安で、同時に直すことを止める仕組みではありません。</li>
              <li>同時に直して分岐したときは、どちらを残すか（または両方をプランとして残すか）を選べます。選ばなかったほうも、このPCの中に暗号化したまま残ります。</li>
              <li>同期サービスの版の履歴には、暗号化された古い写しが残ります。完全削除の後も読めなくしたいときは、版の履歴から消すか、事務所の鍵を入れ替えてください。</li>
              <li>「誰が直したか」の記録は事務所の中の協力のためのもので、メンバーどうしの間での名乗りの証明ではありません。</li>
            </ul>
          </>
        ) : null}
        {msg !== null ? (
          <p class={msg.ok ? "rk-ok" : "hh-err"} role="status" data-office-msg>
            {msg.text}
          </p>
        ) : null}
        <div class="rk-foot">
          <button type="button" class="btn" onClick={p.onClose}>
            閉じる
          </button>
        </div>
      </div>
    </>
  );
}
