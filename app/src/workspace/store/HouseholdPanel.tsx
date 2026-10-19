// 世帯の一覧（上の帯の「世帯」から開く）: 保存した世帯を開く・新しく作る・表示用の顧客番号を変える・完全削除（0013 の5）。
// 一覧に出すのは表示用の顧客番号と構成の要約（続柄と人数）だけ。氏名は持たない（0012）
import { useEffect, useState } from "preact/hooks";
import type { StorageNotice, StoredHousehold, StoreStatus } from "../../engine/host.ts";
import { OFFICE_MESSAGES, sinceText } from "./office.ts";
import { storageNoticeText } from "./storage.ts";

export interface HouseholdPanelProps {
  status: StoreStatus | null;
  /** 保存の部品を使えない理由（使えるときは null） */
  unavailable: string | null;
  /** 直前の操作の失敗 */
  error: string | null;
  list: StoredHousehold[];
  /** 開いている保存した世帯（見本を開いているときは null） */
  currentId: string | null;
  /** 見本（架空のモデル世帯）。保存しないで見る・ここから作る */
  demos: { id: string; title: string }[];
  /** 開いているのが保存していない見本・空の世帯なら、その名前 */
  unsavedTitle: string | null;
  onOpen: (id: string) => void;
  onCreate: (from: string | null) => void;
  onViewDemo: (id: string) => void;
  onSaveCurrent: () => void;
  onRename: (id: string, customerNo: string) => Promise<string | null>;
  onDelete: (id: string, confirm: string) => Promise<string | null>;
  onRecovery: () => void;
  /** AI接続口の事務所全体の設定を開く */
  onAiConnector?: () => void;
  aiEnabled?: boolean;
  /** 事務所の共有の設定を開く（0023） */
  onOffice?: () => void;
  /** 事務所の共有の状態（off・pending・member・removed・unavailable） */
  officeState?: string;
  /** 同期サービスの衝突の写しを選ぶ画面を開く */
  onForks?: (id: string) => void;
  /** 保存先（このPCの中・同期フォルダ）の設定を開く（0024） */
  onStorage?: () => void;
  /** 使い方: 1人で複数の PC の同期フォルダ（personal）／事務所での共有（office）。共有していなければ null */
  usage?: "personal" | "office" | null;
  /** 保存先と同期の通知 */
  storageNotices?: StorageNotice[];
  onClose: () => void;
}

const CUSTOMER_NO = /^[A-Za-z0-9_-]{1,16}$/;

/** 一覧の日時（ISO 8601 → 2026/10/18 14:03。端末の時刻で） */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const STORE_MESSAGES: Record<string, string> = {
  E_STORE_CUSTOMER_NO: "顧客番号は英数字・ハイフン・下線の16字までです（お名前は入れないでください）",
  E_STORE_CONFIRM: "確認の顧客番号が違います",
  E_STORE_CONFLICT: "ほかの人（ほかのPC）がこの世帯を先に保存していました。上書きせず、今の内容はこのPCの中に残しました。どちらを残すか選んでください",
  E_STORE_READ_ONLY: "新しい版のアプリで保存された世帯のため、閲覧だけできます（保存はできません）",
  E_STORE_FORMAT_TOO_NEW: "新しい版のアプリで保存されたファイルです。アプリを更新してください",
  E_STORE_CORRUPT: "世帯ファイルを開けませんでした（壊れているか、書き換えられています）",
  E_STORE_NO_KEY: "この世帯の鍵がありません（削除した世帯の可能性があります）",
  E_STORE_NEEDS_RECOVERY: "復元キーを入れるまで、保存した世帯を開けません",
  E_STORE_KEYCHAIN: "OS の資格情報の保管庫を使えませんでした",
  E_STORE_IO: "ファイルの読み書きに失敗しました",
  ...OFFICE_MESSAGES,
};

export const storeMessage = (code: string) => STORE_MESSAGES[code] ?? `保存の処理に失敗しました（${code}）`;

export function HouseholdPanel(p: HouseholdPanelProps) {
  const [renaming, setRenaming] = useState<{ id: string; value: string; error: string | null } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; value: string; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [p.onClose]);

  const ready = p.status?.state === "ready" && p.unavailable === null;
  const shared = p.officeState === "member";
  /** 1人で複数の PC の同期フォルダ: 「人」ではなく「PC」の言葉で出す（0024） */
  const personal = p.usage === "personal";
  // 一覧に出す通知（鍵が無い・PC の中だけで復元キーを保管していないは、この下と帯の案内で出すので除く）
  const notices = (p.storageNotices ?? []).filter((n) => n.kind !== "needsRecovery" && !(n.kind === "recoveryNotKept" && n.scope === "local"));
  const storageLabel = p.officeState === undefined || p.officeState === "off" ? "このPCの中" : personal ? (p.officeState === "member" ? "同期フォルダ（2台のPC）" : "同期フォルダ（使えません）") : "事務所の共有フォルダ";
  return (
    <section class="card hh-panel" aria-label="世帯の一覧" data-household-panel>
      <div class="card-h">
        <h2>世帯</h2>
        <span class="aside">{shared ? (personal ? "世帯ごとに暗号化して、同期フォルダに自動で保存します（2台のPCで使えます）" : "世帯ごとに暗号化して、事務所の共有フォルダに自動で保存します") : "世帯ごとに暗号化して、このPCのアプリのデータの場所に自動で保存します"}</span>
        <button type="button" class="btn" onClick={p.onClose}>
          閉じる
        </button>
      </div>
      {p.unavailable !== null ? <p class="hh-warn">{p.unavailable}</p> : null}
      {notices.length > 0 ? (
        <ul class="sp-notices" data-household-notices>
          {notices.map((n) => (
            <li key={`${n.kind}-${n.at ?? ""}`} class={`sp-n-${n.level}`}>
              {storageNoticeText(n)}
              {p.onStorage !== undefined && personal ? (
                <button type="button" class="link-btn" onClick={p.onStorage}>
                  保存先を開く
                </button>
              ) : p.onOffice !== undefined && n.scope === "office" ? (
                <button type="button" class="link-btn" onClick={p.onOffice}>
                  事務所の共有を開く
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {p.error !== null ? (
        <p class="hh-warn" role="alert">
          {p.error}
        </p>
      ) : null}
      {p.status?.state === "needsRecovery" ? (
        <p class="hh-warn">
          この PC の資格情報の保管庫に、事務所の鍵が見つかりません。
          <button type="button" class="link-btn" onClick={p.onRecovery}>
            復元キーを入れる
          </button>
        </p>
      ) : null}
      {p.unsavedTitle !== null && ready ? (
        <div class="hh-unsaved">
          <span>
            いま開いている「{p.unsavedTitle}」は保存していません。
          </span>
          <button type="button" class="btn primary" onClick={p.onSaveCurrent} data-save-current>
            この世帯を保存して使う
          </button>
        </div>
      ) : null}
      {ready ? (
        <>
          <h3 class="hh-h">保存した世帯（{p.list.length}）</h3>
          {p.list.length === 0 ? <p class="in-note">まだありません。下の「新しく作る」から始めてください。</p> : null}
          {p.list.length > 0 ? (
            <div class="plan-list-wrap">
              <table class="plan-list hh-list">
                <thead>
                  <tr>
                    <th>顧客番号</th>
                    <th>家族</th>
                    <th>最後に保存</th>
                    {shared ? <th>{personal ? "最後に直したPC" : "最後に直した人"}</th> : null}
                    {shared ? <th>{personal ? "開いているPC" : "開いている人"}</th> : null}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {p.list.map((h) => (
                    <tr key={h.id} class={h.id === p.currentId ? "sel" : ""} data-household-row={h.customerNo}>
                      <td>
                        <b>{h.customerNo}</b>
                        {h.id === p.currentId ? <span class="pl-tag">開いています</span> : null}
                        {h.forks > 0 ? (
                          <button type="button" class="link-btn danger hh-fork" onClick={() => p.onForks?.(h.id)} data-household-forks={h.forks}>
                            同期の衝突の写しがあります
                          </button>
                        ) : null}
                      </td>
                      <td>{h.summary || "—"}</td>
                      <td class="num">{shortDate(h.updatedAt)}</td>
                      {shared ? <td data-household-editor>{h.updatedBy ?? "—"}</td> : null}
                      {shared ? (
                        <td data-household-presence={h.openBy.length}>
                          {h.openBy.length === 0 ? (
                            "—"
                          ) : (
                            <span class="hh-presence">
                              {h.openBy.map((o) => (personal ? `「${o.name}」（${sinceText(o.since)}）` : `${o.name}さん（${sinceText(o.since)}）`)).join("、")}
                            </span>
                          )}
                        </td>
                      ) : null}
                      <td>
                        {renaming?.id === h.id ? (
                          <form
                            class="pl-edit"
                            onSubmit={(e) => {
                              e.preventDefault();
                              const v = renaming.value.trim();
                              if (!CUSTOMER_NO.test(v)) return setRenaming({ ...renaming, error: storeMessage("E_STORE_CUSTOMER_NO") });
                              setBusy(true);
                              void p.onRename(h.id, v).then((err) => {
                                setBusy(false);
                                if (err === null) setRenaming(null);
                                else setRenaming({ ...renaming, error: err });
                              });
                            }}
                          >
                            <input value={renaming.value} maxLength={16} aria-label="新しい顧客番号" onInput={(e) => setRenaming({ ...renaming, value: (e.currentTarget as HTMLInputElement).value, error: null })} />
                            <button type="submit" class="btn" disabled={busy}>
                              変える
                            </button>
                            <button type="button" class="link-btn" onClick={() => setRenaming(null)}>
                              やめる
                            </button>
                            <span class="pl-sub">英数字・ハイフン・下線の16字まで。お名前は入れないでください</span>
                            {renaming.error !== null ? <span class="hh-err">{renaming.error}</span> : null}
                          </form>
                        ) : deleting?.id === h.id ? (
                          <form
                            class="pl-confirm hh-delete"
                            onSubmit={(e) => {
                              e.preventDefault();
                              setBusy(true);
                              void p.onDelete(h.id, deleting.value).then((err) => {
                                setBusy(false);
                                if (err === null) setDeleting(null);
                                else setDeleting({ ...deleting, error: err });
                              });
                            }}
                          >
                            <span>
                              世帯ファイル・直前の世代・アプリのバックアップの写しを消し、この世帯の鍵を消します。元に戻せません。
                              アプリのバックアップからも完全に読めなくなるのは30日後です。同期サービスの版の履歴や、ご自分で取ったバックアップはアプリから消せません。
                            </span>
                            <label>
                              確認のため顧客番号（{h.customerNo}）を入れてください{" "}
                              <input value={deleting.value} maxLength={16} aria-label="確認の顧客番号" onInput={(e) => setDeleting({ ...deleting, value: (e.currentTarget as HTMLInputElement).value, error: null })} data-delete-confirm />
                            </label>
                            <button type="submit" class="btn danger" disabled={busy || deleting.value.trim() !== h.customerNo} data-delete-go>
                              完全に削除する
                            </button>
                            <button type="button" class="link-btn" onClick={() => setDeleting(null)}>
                              やめる
                            </button>
                            {deleting.error !== null ? <span class="hh-err">{deleting.error}</span> : null}
                          </form>
                        ) : (
                          <span class="pl-ops">
                            {h.id !== p.currentId ? (
                              <button type="button" class="link-btn" onClick={() => p.onOpen(h.id)} data-open-household={h.customerNo}>
                                開く
                              </button>
                            ) : null}
                            <button type="button" class="link-btn" onClick={() => setRenaming({ id: h.id, value: h.customerNo, error: null })}>
                              顧客番号を変える
                            </button>
                            <button type="button" class="link-btn danger" onClick={() => setDeleting({ id: h.id, value: "", error: null })} data-delete-household={h.customerNo}>
                              完全削除
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {p.status !== null && p.status.deletionsPending > 0 ? (
            <p class="in-note">完全削除した世帯が {p.status.deletionsPending}件 あります。アプリのバックアップからも読めなくなるまで、削除の日から30日かかります。</p>
          ) : null}
          <h3 class="hh-h">新しく作る</h3>
          <div class="hh-new">
            <button type="button" class="btn" onClick={() => p.onCreate(null)} data-create-blank>
              空から作る
            </button>
            {p.demos.map((d) => (
              <button type="button" class="btn" key={d.id} onClick={() => p.onCreate(d.id)}>
                見本「{d.title}」から作る
              </button>
            ))}
          </div>
        </>
      ) : null}
      <h3 class="hh-h">見本を見る（保存しません）</h3>
      <div class="hh-new">
        {p.demos.map((d) => (
          <button type="button" class="link-btn" key={d.id} onClick={() => p.onViewDemo(d.id)}>
            {d.title}（架空）
          </button>
        ))}
      </div>
      <div class="hh-foot">
        <button type="button" class="link-btn" onClick={p.onRecovery} data-open-recovery>
          復元キー
        </button>
        {p.status?.state === "ready" ? <span class="pl-sub">{p.status.recoveryAcknowledged ? "復元キーは保管済みです" : "復元キーをまだ保管していません"}</span> : null}
        {p.onStorage !== undefined ? (
          <>
            <button type="button" class="link-btn" onClick={p.onStorage} data-open-storage>
              保存先
            </button>
            <span class="pl-sub" data-storage-label>{storageLabel}</span>
          </>
        ) : null}
        {p.onOffice !== undefined ? (
          <>
            <button type="button" class="link-btn" onClick={p.onOffice} data-open-office>
              事務所の共有
            </button>
            <span class="pl-sub">{personal ? "オフ（同期フォルダで1人で使っています）" : p.officeState === "member" ? "オン" : p.officeState === "pending" ? "承認待ち" : p.officeState === "removed" ? "外されました" : p.officeState === "unavailable" ? "使えません" : "オフ（既定）"}</span>
          </>
        ) : null}
        {p.onAiConnector !== undefined ? (
          <>
            <button type="button" class="link-btn" onClick={p.onAiConnector} data-open-ai-connector>
              AI接続口
            </button>
            <span class="pl-sub">{p.aiEnabled === true ? "オン" : "オフ（既定）"}</span>
          </>
        ) : null}
      </div>
    </section>
  );
}
