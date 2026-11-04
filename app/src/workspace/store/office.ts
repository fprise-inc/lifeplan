// 事務所での共有（0023）の画面の側の小さな部品: 文言・指紋の入力の形・開いている人の文・メモの書いた人・分岐の「両方を残す」。
// 鍵・共有フォルダの場所は本体だけが持ち、画面には来ない
import type { PresenceView } from "../../engine/host.ts";

export const OFFICE_MESSAGES: Record<string, string> = {
  E_OFFICE_FINGERPRINT: "指紋が違います。申請した人の画面に出ている16文字を、もう一度読み上げてもらってください",
  E_OFFICE_NAME: "表示名は1〜20文字で入れてください（あなたの名前です。顧客のお名前は入れないでください）",
  E_OFFICE_FOLDER: "そのフォルダは選べません（アプリのデータの場所・カスタム層・AIの作業フォルダの中、またはそれらを含むフォルダです）",
  E_OFFICE_EXISTS: "そのフォルダには、既に事務所があります。「参加する」から申請してください",
  E_OFFICE_NOT_FOUND: "そのフォルダに事務所が見つかりません。事務所を始めた人と同じ共有フォルダを選んでください",
  E_OFFICE_STATE: "今の状態ではできない操作です",
  E_OFFICE_BUSY: "ほかのPCで名簿が先に書き換えられました。もう一度操作してください",
  E_OFFICE_SELF: "自分自身と、最後の1人は外せません",
  E_OFFICE_CONFIRM: "確認の表示名が違います",
  E_OFFICE_REMOVED: "この事務所の共有から外されました",
  E_OFFICE_FORGED: "共有フォルダの名簿が、この事務所のものとして確かめられません（書き換えられた疑いがあります）。ほかのメンバーに確かめてください",
  E_OFFICE_UNAVAILABLE: "共有フォルダが見つかりません（外付けのドライブ・同期の停止・フォルダの移動を確かめてください）",
  E_OFFICE_KEY_MISSING: "このPCのメンバーの鍵が見つかりません。もう一度「参加する」から申請してください",
  E_OFFICE_WAITING_SYNC: "この世帯の鍵の同期を待っています。少し待ってから開き直してください",
  E_OFFICE_BAD_KEY: "申請の鍵が壊れています。申請し直してもらってください",
  E_OFFICE_RECOVERY_REQUIRED: "事務所の復元キーがまだ保管されていません。保管するまで、参加の承認とメンバーを外す操作は止めています",
  E_OFFICE_CLOSED: "この事務所の共有は終わっています（最後のメンバーが共有をやめました）",
  E_OFFICE_OTHERS_REMAIN: "ほかのメンバーがいる間は、共有をやめられません。先にほかのメンバーを外してください",
  E_OFFICE_FORMAT_TOO_NEW: "共有フォルダのファイルが、新しい版のアプリで書かれています。アプリを更新してください",
  E_OFFICE_VIEW_ONLY: "この事務所では、あなたは閲覧だけの役割です（新しい版のアプリで決めた役割）。世帯は見られますが、保存や共有の操作はできません",
  E_RECOVERY_TYPO: "復元キーに打ち間違いがあります。文字を確かめてください（大文字・小文字、区切りの有無は問いません）",
  E_RECOVERY_MISMATCH: "この事務所の今の復元キーではありません（メンバーを外すと復元キーは新しくなり、古い控えでは加われません）",
  E_STORE_NO_FORK: "選ぶ分岐がありません",
};

/** 外す画面と外した後に、目立つ形で出す案内（0023 の4・残る危険） */
export const syncShareNotice = (name: string) => `共有フォルダの共有の設定（同期サービス側）からも、${name}さんを外してください`;

export const officeMessage = (code: string) => OFFICE_MESSAGES[code] ?? `事務所の共有の操作に失敗しました（${code}）`;

/** 指紋の入力を比べられる形にする（区切り・空白・小文字・全角を吸収。O→0、I・L→1）。16文字でなければ null */
export function normalizeFingerprint(input: string): string | null {
  const s = input
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toUpperCase()
    .replace(/[\s\-‐－ー—–_.・]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{16}$/.test(s) ? s : null;
}

/** 「○分前から」（開いている人の表示） */
export function sinceText(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const min = Math.max(0, Math.round((now - t) / 60_000));
  if (min < 1) return "今から";
  if (min < 60) return `${min}分前から`;
  const h = Math.floor(min / 60);
  return `${h}時間前から`;
}

/** 「○○さんが開いています（○分前から）」。1人で複数の PC の同期フォルダ（personal）では「もう1台のPC「○○」で開いています」（0024） */
export function presenceText(list: readonly PresenceView[], now: number = Date.now(), personal = false): string {
  return list.map((p) => (personal ? `もう1台のPC「${p.name}」で開いています（${sinceText(p.since, now)}）` : `${p.name}さんが開いています（${sinceText(p.since, now)}）`)).join("、");
}

/**
 * メモの行ごとの書いた人（0023 の6）: 変わらない行は前の書いた人を残し、新しい行・直した行は今の人にする。
 * 同じ文の行が複数あるときは、前から順に対応させる
 */
export function memoAuthors(before: readonly string[], beforeBy: readonly (string | null)[] | undefined, after: readonly string[], me: string | null): (string | null)[] {
  const pool = new Map<string, (string | null)[]>();
  before.forEach((line, i) => {
    const list = pool.get(line) ?? [];
    list.push(beforeBy?.[i] ?? null);
    pool.set(line, list);
  });
  return after.map((line) => {
    const list = pool.get(line);
    if (list !== undefined && list.length > 0) return list.shift() ?? null;
    return me;
  });
}

interface PlanLike {
  id: string;
  title?: string;
  name?: string;
  /** 土台のプラン（null は現状） */
  base?: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * 分岐の「両方を残す」（0023 の7）: 相手の内容を土台に、こちらにだけあるプランを足す。同じ ID で中身が違うプランは、
 * 別の ID の写しにして「（こちらの分岐）」を付けて足す。足したプランの土台が写しにしたプランなら、土台も写しに向け直す
 * （こちらで作ったときの土台の中身のまま。相手の同じ ID のプランを土台にしない）。現状（入力）は相手のまま（混ぜない）。足したプランの数も返す
 */
export function mergeForkBodies(theirsJson: string, oursJson: string, newId: () => string): { body: string; added: number } {
  const theirs = JSON.parse(theirsJson) as Record<string, unknown>;
  const ours = JSON.parse(oursJson) as Record<string, unknown>;
  const tp = (Array.isArray(theirs.proposals) ? theirs.proposals : []) as PlanLike[];
  const op = (Array.isArray(ours.proposals) ? ours.proposals : []) as PlanLike[];
  const byId = new Map(tp.map((p) => [p.id, p]));
  // 写しにするプラン（同じ ID で中身が違う）の、元の ID → 写しの ID
  const copied = new Map<string, string>();
  for (const p of op) {
    const same = byId.get(p.id);
    if (same !== undefined && JSON.stringify(same) !== JSON.stringify(p)) copied.set(p.id, newId());
  }
  const rebased = (p: PlanLike): PlanLike => {
    const to = typeof p.base === "string" ? copied.get(p.base) : undefined;
    return to === undefined ? p : { ...p, base: to };
  };
  const out = [...tp];
  let added = 0;
  for (const p of op) {
    const copy = copied.get(p.id);
    if (!byId.has(p.id)) {
      out.push(rebased(p));
      added++;
    } else if (copy !== undefined) {
      const label = `${p.title ?? p.name ?? "プラン"}（こちらの分岐）`;
      out.push({ ...rebased(p), id: copy, ...(p.title !== undefined ? { title: label } : { name: label }) });
      added++;
    }
  }
  const merged: Record<string, unknown> = { ...theirs, proposals: out };
  if (isObj(theirs.meta)) merged.meta = theirs.meta;
  // 控え（0009 の2）は作った後に変えないので、両方の分岐の控えを ID で重ねずに残す
  const ts = Array.isArray(theirs.snapshots) ? (theirs.snapshots as { id?: unknown }[]) : [];
  const os = Array.isArray(ours.snapshots) ? (ours.snapshots as { id?: unknown }[]) : [];
  const seen = new Set(ts.map((x) => x.id));
  const snaps = [...ts, ...os.filter((x) => !seen.has(x.id))];
  if (snaps.length > 0) merged.snapshots = snaps;
  return { body: JSON.stringify(merged), added };
}

/** 本文の meta.editors から、メンバーID → 表示名 */
export function editorsOf(bodyJson: string): Record<string, string> {
  try {
    const b = JSON.parse(bodyJson) as { meta?: { editors?: Record<string, { name?: unknown }> } };
    const out: Record<string, string> = {};
    for (const [id, v] of Object.entries(b.meta?.editors ?? {})) if (typeof v?.name === "string") out[id] = v.name;
    return out;
  } catch {
    return {};
  }
}
