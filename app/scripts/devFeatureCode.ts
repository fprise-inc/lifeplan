// 開発用のサーバーの代わり（vite.config.ts）だけが使う、機能を有効にするコード（0110）の確かめ。
// 本物の確かめは本体（crates/feature-code。Rust）。ここは画面の確かめを本体なしで流すための写しで、形と決まりは本体と同じにする:
// - 形: "LPFC1-" ＋ 中身の JSON（base64url）＋ "." ＋ Ed25519 の署名（base64url）。署名するのは「前置き＋中身の JSON のバイト列」
// - 公開鍵は config/distribution.toml の [keys] の feature_code と、開発用の [dev_keys] の feature_code（「鍵の名前:公開鍵」）
// - 期限は日本の日付で、期限の日の終わりまで。30日前から更新の知らせ。同じ機能を同じか遅い期限まで含む古いコードは、新しいコードを入れると外す
// - 期限は省ける（中身の形の版 2。期限のあるコードは版 1）
// - 提供元が止める（0110 の追記 2026-11-04）: 配布の取り下げの一覧（crates/distribution の revocations。取り下げ用の鍵で署名した封筒）の
//   revoked.featureCodes に載っているコードは「止めた」。revoked.keys に載ったコードの鍵は外す。最後に確かめられた一覧で判断し、
//   取れない・署名が合わない・古い一覧は無視する
// - 切れた・止めたの知らせ（0110 の追記 2026-11-02。本体の crates/feature-code の notice と同じ）: 分かった日から7日だけ出す。閉じたら出さない。
//   使える状態に戻ったら記録を消す（再び止められたら出直す）。切れた ↔ 止めた が入れ替わったときも出直す
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

export const FEATURES = ["combinedBs"] as const;
const PREFIX = "LPFC1-";
const CONTEXT = Buffer.from("lifeplan-feature-code/1\0", "utf8");
const RENEW_NOTICE_DAYS = 30;
/** 切れた・止めたと分かった日から、知らせを出す日数 */
export const NOTICE_DAYS = 7;
const MAX_CODES = 16;

interface Claims {
  v: number;
  kid: string;
  id: string;
  name: string;
  features: string[];
  issued: string;
  expires?: string;
}

export interface DevCodeView {
  ref: string;
  id: string;
  name: string;
  features: string[];
  issued: string;
  expires: string | null;
  state: "active" | "expiring" | "expired" | "revoked";
  daysLeft: number | null;
  notice: boolean;
  noticeSince: string | null;
}

export interface DevFeatureStatus {
  today: string;
  active: string[];
  codes: DevCodeView[];
  invalid: { ref: string; error: string }[];
}

/** 「鍵の名前:公開鍵（base64url）」の並びから、鍵の名前 → 鍵 */
export function publicKeys(lines: readonly string[]): Map<string, KeyObject> {
  const m = new Map<string, KeyObject>();
  for (const l of lines) {
    const i = l.indexOf(":");
    const raw = Buffer.from(l.slice(i + 1), "base64url");
    if (i <= 0 || raw.length !== 32) continue;
    // Ed25519 の公開鍵の SPKI（DER）の決まった前置き＋32バイト
    m.set(l.slice(0, i), createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]), format: "der", type: "spki" }));
  }
  return m;
}

export const normalize = (code: string): string => code.replace(/\s+/g, "");
export const reference = (code: string): string => createHash("sha256").update(normalize(code)).digest("hex").slice(0, 16);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const dayOf = (d: string): number | null => {
  if (!DATE.test(d)) return null;
  const t = Date.parse(`${d}T00:00:00Z`);
  return Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d ? null : t / 86_400_000;
};

/** 本物か（署名と中身の形）。期限はここでは見ない */
export function verifyCode(code: string, keys: Map<string, KeyObject>): { ok: true; claims: Claims } | { ok: false; error: string } {
  const c = normalize(code);
  const m = /^LPFC1-([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(c);
  if (c.length > 2048 || !c.startsWith(PREFIX) || m === null) return { ok: false, error: "E_FEATURE_CODE_FORMAT" };
  const payload = Buffer.from(m[1] as string, "base64url");
  const sig = Buffer.from(m[2] as string, "base64url");
  let claims: Claims;
  try {
    claims = JSON.parse(payload.toString("utf8")) as Claims;
  } catch {
    return { ok: false, error: "E_FEATURE_CODE_FORMAT" };
  }
  const key = typeof claims.kid === "string" ? keys.get(claims.kid) : undefined;
  if (key === undefined) return { ok: false, error: "E_FEATURE_CODE_KEY" };
  if (sig.length !== 64 || !verify(null, Buffer.concat([CONTEXT, payload]), key, sig)) return { ok: false, error: "E_FEATURE_CODE_SIGNATURE" };
  const versionOk = (claims.v === 1 && claims.expires !== undefined) || claims.v === 2;
  const shapeOk =
    versionOk &&
    typeof claims.id === "string" &&
    typeof claims.name === "string" &&
    claims.name.length > 0 &&
    Array.isArray(claims.features) &&
    claims.features.length > 0 &&
    claims.features.every((f) => typeof f === "string") &&
    dayOf(claims.issued) !== null &&
    (claims.expires === undefined || dayOf(claims.expires) !== null);
  return shapeOk ? { ok: true, claims } : { ok: false, error: "E_FEATURE_CODE_FORMAT" };
}

/** 期限の遅い順に比べる鍵（期限なしがいちばん遅い） */
const rank = (e: string | null): string => (e === null ? "~" : e);

function viewOf(code: string, keys: Map<string, KeyObject>, today: number, revoked: readonly string[]): { ok: true; view: DevCodeView } | { ok: false; error: string } {
  const r = verifyCode(code, keys);
  if (!r.ok) return r;
  const features = r.claims.features.filter((f) => (FEATURES as readonly string[]).includes(f));
  if (features.length === 0) return { ok: false, error: "E_FEATURE_CODE_NO_FEATURE" };
  const expires = r.claims.expires ?? null;
  const daysLeft = expires === null ? null : (dayOf(expires) as number) - today;
  const state = revoked.includes(r.claims.id) ? "revoked" : daysLeft === null ? "active" : daysLeft < 0 ? "expired" : daysLeft <= RENEW_NOTICE_DAYS ? "expiring" : "active";
  const notice = state === "expired" || state === "revoked";
  return { ok: true, view: { ref: reference(code), id: r.claims.id, name: r.claims.name, features, issued: r.claims.issued, expires, state, daysLeft, notice, noticeSince: null } };
}

export function featureStatus(codes: readonly string[], keys: Map<string, KeyObject>, today: string, revoked: readonly string[] = []): DevFeatureStatus {
  const t = dayOf(today) ?? 0;
  const views: DevCodeView[] = [];
  const invalid: { ref: string; error: string }[] = [];
  for (const c of codes) {
    const r = viewOf(c, keys, t, revoked);
    if (r.ok) views.push(r.view);
    else invalid.push({ ref: reference(c), error: r.error });
  }
  views.sort((a, b) => (a.expires === b.expires ? a.id.localeCompare(b.id) : rank(a.expires) < rank(b.expires) ? 1 : -1));
  const active = FEATURES.filter((f) => views.some((v) => (v.state === "active" || v.state === "expiring") && v.features.includes(f)));
  return { today, active, codes: views, invalid };
}

export function addCode(codes: readonly string[], code: string, keys: Map<string, KeyObject>, today: string, revoked: readonly string[] = []): { ok: true; codes: string[] } | { ok: false; error: string } {
  const t = dayOf(today) ?? 0;
  const n = normalize(code);
  const r = viewOf(n, keys, t, revoked);
  if (!r.ok) return r;
  if (r.view.state === "expired") return { ok: false, error: "E_FEATURE_CODE_EXPIRED" };
  if (r.view.state === "revoked") return { ok: false, error: "E_FEATURE_CODE_REVOKED" };
  const next = codes.filter((c) => {
    if (normalize(c) === n) return false;
    const o = viewOf(c, keys, t, revoked);
    return !(o.ok && rank(o.view.expires) <= rank(r.view.expires) && o.view.features.every((f) => r.view.features.includes(f)));
  });
  next.push(n);
  return next.length > MAX_CODES ? { ok: false, error: "E_FEATURE_CODE_LIMIT" } : { ok: true, codes: next };
}

/** 切れた・止めたの知らせの記録（コードの印と状態ごと。分かった日と閉じた印） */
export interface NoticeRecord {
  ref: string;
  state: "expired" | "revoked";
  since: string;
  dismissed: boolean;
}

/** 状態に知らせの記録を当てる（本体の notice::apply と同じ）。新しい記録を返し、st のコードの notice・noticeSince を入れ直す */
export function applyNotices(st: DevFeatureStatus, records: readonly NoticeRecord[]): NoticeRecord[] {
  const t = dayOf(st.today);
  const next: NoticeRecord[] = [];
  for (const c of st.codes) {
    if (c.state !== "expired" && c.state !== "revoked") {
      c.notice = false;
      c.noticeSince = null;
      continue;
    }
    const prev = records.find((r) => r.ref === c.ref && r.state === c.state);
    const r: NoticeRecord = prev !== undefined ? { ...prev } : { ref: c.ref, state: c.state, since: st.today, dismissed: false };
    const s = dayOf(r.since);
    if (s === null || (t !== null && s > t)) r.since = st.today;
    const since = dayOf(r.since);
    c.notice = !r.dismissed && (since === null || t === null || t - since < NOTICE_DAYS);
    c.noticeSince = r.since;
    next.push(r);
  }
  return next;
}

/** 印で指したコードの知らせを閉じる（記録が無ければ null） */
export const dismissNotice = (records: readonly NoticeRecord[], ref: string): NoticeRecord[] | null => (records.some((r) => r.ref === ref) ? records.map((r) => (r.ref === ref ? { ...r, dismissed: true } : r)) : null);

/** 日本の今日（UTC+9） */
export const todayJst = (now = Date.now()): string => new Date(now + 9 * 3600_000).toISOString().slice(0, 10);

// ---- 取り下げの一覧（0117 の3 (3)・0110 の追記。本体の crates/distribution の envelope・revocations と同じ形）----

const REV_ENVELOPE = "fprise-lifeplan-revocations-envelope";
const REV_FORMAT = "fprise-lifeplan-revocations";
const REV_MAX_BYTES = 1024 * 1024;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const CODE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const major = (v: unknown): number | null => (typeof v === "string" && /^\d+\.\d+$/.test(v) ? Number(v.split(".")[0]) : null);

export interface RevocationList {
  serial: number;
  /** 止めるコードの番号（revoked.featureCodes） */
  revoked: string[];
  /** 取り下げた鍵の名前（revoked.keys） */
  keys: string[];
}

/** 署名と形を確かめた一覧（確かめられなければ符号。符号は本体と同じ E_DIST_*） */
export function verifyRevocations(text: string, keys: Map<string, KeyObject>): { ok: true; list: RevocationList } | { ok: false; error: string } {
  const bad = { ok: false as const, error: "E_DIST_FORMAT" };
  if (Buffer.byteLength(text, "utf8") > REV_MAX_BYTES) return bad;
  let env: { format?: unknown; formatVersion?: unknown; payload?: unknown; signatures?: unknown };
  try {
    env = JSON.parse(text) as typeof env;
  } catch {
    return bad;
  }
  if (env.format !== REV_ENVELOPE || typeof env.payload !== "string" || !Array.isArray(env.signatures)) return bad;
  if (major(env.formatVersion) !== 1) return { ok: false, error: "E_DIST_UNSUPPORTED" };
  let known = false;
  let verified = false;
  for (const s of env.signatures as { keyId?: unknown; alg?: unknown; sig?: unknown }[]) {
    if (s.alg !== "ed25519" || typeof s.keyId !== "string" || typeof s.sig !== "string") continue;
    const key = keys.get(s.keyId);
    if (key === undefined) continue;
    known = true;
    const sig = Buffer.from(s.sig, "base64");
    if (sig.length === 64 && verify(null, Buffer.from(env.payload, "utf8"), key, sig)) {
      verified = true;
      break;
    }
  }
  if (!verified) return { ok: false, error: known ? "E_DIST_SIGNATURE" : "E_DIST_KEY" };
  let p: { format?: unknown; formatVersion?: unknown; serial?: unknown; issuedAt?: unknown; expiresAt?: unknown; revoked?: { featureCodes?: unknown; keys?: unknown } };
  try {
    p = JSON.parse(env.payload) as typeof p;
  } catch {
    return bad;
  }
  if (p.format !== REV_FORMAT) return bad;
  if (major(p.formatVersion) !== 1) return { ok: false, error: "E_DIST_UNSUPPORTED" };
  const codes = p.revoked?.featureCodes ?? [];
  const kids = p.revoked?.keys ?? [];
  const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every((y) => typeof y === "string");
  const shapeOk = Number.isInteger(p.serial) && (p.serial as number) >= 0 && typeof p.issuedAt === "string" && UTC.test(p.issuedAt) && typeof p.expiresAt === "string" && UTC.test(p.expiresAt) && p.expiresAt > p.issuedAt && typeof p.revoked === "object" && strings(codes) && codes.every((c) => CODE_ID.test(c)) && new Set(codes).size === codes.length && strings(kids);
  return shapeOk ? { ok: true, list: { serial: p.serial as number, revoked: codes, keys: kids } } : bad;
}

/** 取りに行った結果を当てる（本体の apply_fetch と同じ: 取れない・確かめられない・古いときは、最後に取れた一覧のまま） */
export function applyFetch(saved: string | null, fetched: string | null, keys: Map<string, KeyObject>): { saved: string | null; result: "ok" | "offline" | "rejected" } {
  const cur = saved === null ? null : verifyRevocations(saved, keys);
  const keep = cur !== null && cur.ok ? saved : null;
  if (fetched === null) return { saved: keep, result: "offline" };
  const r = verifyRevocations(fetched, keys);
  if (!r.ok) return { saved: keep, result: "rejected" };
  if (cur !== null && cur.ok && r.list.serial < cur.list.serial) return { saved: keep, result: "rejected" };
  return { saved: fetched, result: "ok" };
}

/** 保存しておいた一覧の止めるコードの番号（確かめられなければ空） */
export function revokedIds(saved: string | null, keys: Map<string, KeyObject>): string[] {
  if (saved === null) return [];
  const r = verifyRevocations(saved, keys);
  return r.ok ? r.list.revoked : [];
}

/** コードの鍵から、保存しておいた一覧で取り下げた鍵を外したもの（本体の KeyRing::without と同じ） */
export function withoutRevokedKeys(codeKeys: Map<string, KeyObject>, saved: string | null, revocationKeys: Map<string, KeyObject>): Map<string, KeyObject> {
  const r = saved === null ? null : verifyRevocations(saved, revocationKeys);
  if (r === null || !r.ok) return codeKeys;
  return new Map([...codeKeys].filter(([kid]) => !r.list.keys.includes(kid)));
}
