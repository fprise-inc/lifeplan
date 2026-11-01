// 開発用のサーバーの代わり（vite.config.ts）だけが使う、機能を有効にするコード（0110）の確かめ。
// 本物の確かめは本体（crates/feature-code。Rust）。ここは画面の確かめを本体なしで流すための写しで、形と決まりは本体と同じにする:
// - 形: "LPFC1-" ＋ 中身の JSON（base64url）＋ "." ＋ Ed25519 の署名（base64url）。署名するのは「前置き＋中身の JSON のバイト列」
// - 公開鍵は config/distribution.toml の [keys] の feature_code（「鍵の名前:公開鍵」）
// - 期限は日本の日付で、期限の日の終わりまで。30日前から更新の知らせ。同じ機能を同じか遅い期限まで含む古いコードは、新しいコードを入れると外す
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

export const FEATURES = ["combinedBs"] as const;
const PREFIX = "LPFC1-";
const CONTEXT = Buffer.from("lifeplan-feature-code/1\0", "utf8");
const RENEW_NOTICE_DAYS = 30;
const MAX_CODES = 16;

interface Claims {
  v: number;
  kid: string;
  id: string;
  name: string;
  features: string[];
  issued: string;
  expires: string;
}

export interface DevCodeView {
  ref: string;
  id: string;
  name: string;
  features: string[];
  issued: string;
  expires: string;
  state: "active" | "expiring" | "expired";
  daysLeft: number;
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
  const shapeOk =
    claims.v === 1 &&
    typeof claims.id === "string" &&
    typeof claims.name === "string" &&
    claims.name.length > 0 &&
    Array.isArray(claims.features) &&
    claims.features.length > 0 &&
    claims.features.every((f) => typeof f === "string") &&
    dayOf(claims.issued) !== null &&
    dayOf(claims.expires) !== null;
  return shapeOk ? { ok: true, claims } : { ok: false, error: "E_FEATURE_CODE_FORMAT" };
}

function viewOf(code: string, keys: Map<string, KeyObject>, today: number): { ok: true; view: DevCodeView } | { ok: false; error: string } {
  const r = verifyCode(code, keys);
  if (!r.ok) return r;
  const features = r.claims.features.filter((f) => (FEATURES as readonly string[]).includes(f));
  if (features.length === 0) return { ok: false, error: "E_FEATURE_CODE_NO_FEATURE" };
  const daysLeft = (dayOf(r.claims.expires) as number) - today;
  const state = daysLeft < 0 ? "expired" : daysLeft <= RENEW_NOTICE_DAYS ? "expiring" : "active";
  return { ok: true, view: { ref: reference(code), id: r.claims.id, name: r.claims.name, features, issued: r.claims.issued, expires: r.claims.expires, state, daysLeft } };
}

export function featureStatus(codes: readonly string[], keys: Map<string, KeyObject>, today: string): DevFeatureStatus {
  const t = dayOf(today) ?? 0;
  const views: DevCodeView[] = [];
  const invalid: { ref: string; error: string }[] = [];
  for (const c of codes) {
    const r = viewOf(c, keys, t);
    if (r.ok) views.push(r.view);
    else invalid.push({ ref: reference(c), error: r.error });
  }
  views.sort((a, b) => (a.expires === b.expires ? a.id.localeCompare(b.id) : a.expires < b.expires ? 1 : -1));
  const active = FEATURES.filter((f) => views.some((v) => v.state !== "expired" && v.features.includes(f)));
  return { today, active, codes: views, invalid };
}

export function addCode(codes: readonly string[], code: string, keys: Map<string, KeyObject>, today: string): { ok: true; codes: string[] } | { ok: false; error: string } {
  const t = dayOf(today) ?? 0;
  const n = normalize(code);
  const r = viewOf(n, keys, t);
  if (!r.ok) return r;
  if (r.view.state === "expired") return { ok: false, error: "E_FEATURE_CODE_EXPIRED" };
  const next = codes.filter((c) => {
    if (normalize(c) === n) return false;
    const o = viewOf(c, keys, t);
    return !(o.ok && o.view.expires <= r.view.expires && o.view.features.every((f) => r.view.features.includes(f)));
  });
  next.push(n);
  return next.length > MAX_CODES ? { ok: false, error: "E_FEATURE_CODE_LIMIT" } : { ok: true, codes: next };
}

/** 日本の今日（UTC+9） */
export const todayJst = (now = Date.now()): string => new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
