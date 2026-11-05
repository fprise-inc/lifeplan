/// <reference types="vitest/config" />
// 画面のビルド（Vite）と単体テスト（Vitest）の設定
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import { parse as parseToml } from "smol-toml";
import { APP_DIR, ENGINE_DIST, REPO_DIR } from "./scripts/lib.ts";
import { devCustom } from "./scripts/devCustom.ts";
import { handleApi } from "../hearing/relay/handler.ts";
import { memoryStore } from "../hearing/relay/store.ts";
import { API_PREFIX as HEARING_API } from "../hearing/src/web/protocol.ts";
import { NAME_MAX_CHARS, readLogoHeader } from "./src/workspace/office/branding.ts";
import { addCode, applyFetch, applyNotices, dismissNotice, featureStatus, publicKeys, reference, revokedIds, todayJst, verifyCode, verifyCodeRevocations, verifyRevocations, withoutRevokedKeys, type NoticeRecord } from "./scripts/devFeatureCode.ts";

/**
 * 開発用のサーバーだけの入口（本番のビルドには入らない）: Tauri の外（ふつうのブラウザ・ヘッドレスの Chrome）で画面を確かめるために、
 * 本体の命令の代わりに、架空のモデル世帯と制度データを返す。画面の側は import.meta.env.DEV のときだけ使う
 */
/** 必須の記載（本体の app/src-tauri/src/report.rs と同じ文。開発用のサーバーで見本を作るときだけ使う） */
const DEV_NOTICES = [
  "この提案書は、お伺いした情報と前提条件にもとづく試算です。将来の金額や結果を保証するものではありません。",
  "公的データの出典: 国税庁、厚生労働省、日本年金機構、文部科学省、金融庁、総務省統計局の公表資料（加工して作成）",
  "前提条件や計算方法の一部は担当FPが設定しています。",
];
const DEV_REFORM = "遺族年金は2028年4月の見直し前の制度で計算しています（2028年4月以後に亡くなる想定）。";

function readBody(req: import("node:http").IncomingMessage): Promise<Buffer> {
  return new Promise((ok, ng) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => ok(Buffer.concat(chunks)));
    req.on("error", ng);
  });
}

/** Web のヒアリングの受け付けの置き場（開発用のサーバーのメモリの中だけ。0125） */
const devRelayStore = memoryStore();

/**
 * お客さまのページ（h/index.html）の CSP を、開発用のサーバーのときだけ緩める（vite の差し込みの style と、変更を届ける ws のため）。
 * 本番のビルド（scripts/build-hearing-form.ts）では緩めない
 */
function devHearingFormCsp(): Plugin {
  return {
    name: "financia-dev-hearing-form-csp",
    apply: "serve",
    transformIndexHtml(html, ctx) {
      if (!ctx.path.startsWith("/h/")) return html;
      return html.replace("style-src 'self';", "style-src 'self' 'unsafe-inline';").replace("connect-src 'self';", "connect-src 'self' ws:;");
    },
  };
}

/** 開発用のサーバーの世帯の保存（メモリの中だけ。再起動で消える） */
type DevLabel = { category?: string; serial?: number; branch?: string; sample?: { no: string; name: string; traits: string[] } };
const devStore = {
  households: new Map<string, { customerNo: string; summary: string; createdAt: string; updatedAt: string; body: string; generation: number; updatedBy?: string | null; openBy?: { name: string; since: string }[]; forks?: number; conflict?: boolean; label: DevLabel }>(),
  // 顧客番号の区分と次の通し番号（本体の numbering と同じ決まり。0033）。区分は最初から入れず、初めに「区分を使いますか？」と聞く
  categories: [] as { code: string; name: string }[],
  categoriesDecided: false,
  nextSerial: 1,
  lastOpened: null as string | null,
  acknowledgedAt: null as string | null,
  verifiedAt: null as string | null,
  // 見本の復元キー（開発用。本物の親鍵ではない）
  recoveryKey: Array.from({ length: 58 }, (_, i) => "0123456789ABCDEFGHJKMNPQRSTVWXYZ"[(i * 7 + 3) % 32]).join("").replace(/(.{4})(?=.)/g, "$1-"),
  deletions: 0,
};

/** 開発用のサーバーの、覚えた明細の辞書と形（メモリの中だけ。本体の事務所データの代わり。0034） */
type DevDictEntry = { key: string; category: string; at: string; annual?: boolean; by?: string; removed?: boolean };
type DevFormat = { fingerprint: string; kind: string; mapping: unknown; label?: string; at: string };
/** 開発用のサーバーの、お知らせの手元の状態（既読の印と受付番号。メモリの中だけ。0087） */
let devNoticeLocal: unknown = {};
const devStatement = { data: { dictionary: [] as DevDictEntry[], formats: [] as DevFormat[] }, next: 0, sheet: null as Buffer | null };

function devStoreOp(op: string, a: Record<string, string>): { ok: true; value?: unknown } | { ok: false; code: string } {
  const s = devStore;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  // 事務所で共有しているときは、事務所の復元キー（外すたびに新しくなる）と、その保管の記録を使う（本体と同じ。0023 の5）
  const shared = devOffice.state === "member";
  const status = () => ({ state: "ready", firstRun: s.households.size === 0 && s.acknowledgedAt === null, recoveryAcknowledged: shared ? devOffice.ack !== null : s.acknowledgedAt !== null, recoveryVerifiedAt: shared ? (devOffice.ack?.verifiedAt ?? null) : s.verifiedAt, lastOpened: s.lastOpened, deletionsPending: s.deletions, deletionsCompleted: 0 });
  const norm = (k: string) => k.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  const editors = Object.fromEntries(devOffice.members.map((m) => [m.memberId, { name: m.name }]));
  const withMeta = (body: string, customerNo: string) => JSON.stringify({ ...(JSON.parse(body) as object), meta: { format: "lifeplan.household", formatVersion: "0.2", savedAt: now, appVersion: "dev", customerNo, revisions: [], editors } });
  const me = devOffice.state === "member" ? (devOffice.members.find((m) => m.isMe)?.name ?? null) : null;
  const h = a.id !== undefined ? s.households.get(a.id) : undefined;
  const fmt = (code: string | undefined, serial: number, branch?: string) => `${code ?? ""}${String(serial).padStart(4, "0")}${branch !== undefined ? `-${branch}` : ""}`;
  const entry = (id: string, e: NonNullable<typeof h>) => ({ id, customerNo: e.customerNo, summary: e.summary, createdAt: e.createdAt, updatedAt: e.updatedAt, updatedBy: e.updatedBy ?? null, openBy: e.openBy ?? [], forks: e.forks ?? 0, ...e.label });
  const opened = (id: string, e: NonNullable<typeof h>) => ({ id, customerNo: e.customerNo, body: withMeta(e.body, e.customerNo), readOnly: false, generation: e.generation, savedBy: e.updatedBy ?? null, othersOpen: e.openBy ?? [], ...e.label });
  const nextSerial = () => {
    const max = Math.max(0, ...[...s.households.values()].map((e) => e.label.serial ?? 0));
    s.nextSerial = Math.max(s.nextSerial, max + 1);
    return s.nextSerial++;
  };
  const newSample = (raw: string | undefined): DevLabel | null => {
    const r = JSON.parse(raw ?? "null") as { family: number; age: number; name: string; traits: string[] } | null;
    if (r === null || !(r.family >= 1 && r.family <= 5 && r.age >= 2 && r.age <= 7) || r.name.trim() === "" || r.name.length > 40) return null;
    const used = new Set([...s.households.values()].flatMap((e) => (e.label.sample !== undefined ? [e.label.sample.no] : [])));
    for (let o = 10; o <= 99; o++) {
      const no = `${r.family}-${r.age}-${String(o).padStart(2, "0")}`;
      if (!used.has(no)) return { sample: { no, name: r.name, traits: r.traits } };
    }
    return null;
  };
  switch (op) {
    case "status":
      return { ok: true, value: status() };
    case "list":
    case "listSamples":
      return { ok: true, value: [...s.households.entries()].filter(([, e]) => (e.label.sample !== undefined) === (op === "listSamples")).map(([id, e]) => entry(id, e)).sort((x, y) => (op === "listSamples" ? (x.customerNo < y.customerNo ? -1 : 1) : x.updatedAt < y.updatedAt ? 1 : -1)) };
    case "create": {
      const id = crypto.randomUUID();
      let label: DevLabel;
      if (a.sample !== undefined) {
        const l = newSample(a.sample);
        if (l === null) return { ok: false, code: "E_STORE_SAMPLE" };
        label = l;
      } else {
        const code = a.category ?? (s.categories.some((c) => c.code === "C") ? "C" : s.categories[0]?.code);
        if (code !== undefined && !s.categories.some((c) => c.code === code)) return { ok: false, code: "E_STORE_CATEGORY" };
        label = { ...(code !== undefined ? { category: code } : {}), serial: nextSerial() };
      }
      const customerNo = label.sample?.no ?? fmt(label.category, label.serial as number);
      const e = { customerNo, summary: a.summary ?? "", createdAt: now, updatedAt: now, body: a.body ?? "{}", generation: 1, updatedBy: me, label };
      s.households.set(id, e);
      s.lastOpened = id;
      return { ok: true, value: opened(id, e) };
    }
    case "open":
      if (h === undefined) return { ok: false, code: "E_STORE_UNKNOWN_HOUSEHOLD" };
      s.lastOpened = a.id ?? null;
      return { ok: true, value: opened(a.id as string, h) };
    case "categories":
      return { ok: true, value: { categories: s.categories, decided: s.categoriesDecided } };
    case "setCategories": {
      const edits = JSON.parse(a.edits ?? "[]") as { from?: string; code: string; name: string }[];
      if (edits.some((e) => !/^[A-Z]{1,2}$/.test(e.code) || e.name.trim() === "" || e.name.length > 20) || new Set(edits.map((e) => e.code)).size !== edits.length) return { ok: false, code: "E_STORE_CATEGORY" };
      const used = new Set([...s.households.values()].flatMap((e) => (e.label.sample === undefined && e.label.category !== undefined ? [e.label.category] : [])));
      if ([...used].some((c) => !edits.some((e) => e.from === c))) return { ok: false, code: "E_STORE_CATEGORY_IN_USE" };
      for (const e of edits) {
        if (e.from === undefined || e.from === e.code) continue;
        for (const x of s.households.values()) {
          if (x.label.category !== e.from || x.label.sample !== undefined) continue;
          x.label.category = e.code;
          if (x.label.serial !== undefined) x.customerNo = fmt(e.code, x.label.serial, x.label.branch);
        }
      }
      s.categories = edits.map((e) => ({ code: e.code, name: e.name }));
      s.categoriesDecided = true;
      return { ok: true, value: { categories: s.categories, decided: true } };
    }
    case "setCategory":
      if (h === undefined) return { ok: false, code: "E_STORE_UNKNOWN_HOUSEHOLD" };
      if (h.label.sample !== undefined) return { ok: false, code: "E_STORE_SAMPLE" };
      if (!s.categories.some((c) => c.code === a.category)) return { ok: false, code: "E_STORE_CATEGORY" };
      h.label.category = a.category;
      if (h.label.serial !== undefined) h.customerNo = fmt(a.category as string, h.label.serial, h.label.branch);
      return { ok: true, value: { customerNo: h.customerNo, duplicate: false } };
    case "assignSerial":
      if (h === undefined) return { ok: false, code: "E_STORE_UNKNOWN_HOUSEHOLD" };
      if (h.label.sample !== undefined) return { ok: false, code: "E_STORE_SAMPLE" };
      if (h.label.serial === undefined) {
        const code = h.label.category !== undefined && s.categories.some((c) => c.code === h.label.category) ? h.label.category : s.categories.some((c) => c.code === "C") ? "C" : s.categories[0]?.code;
        h.label = { ...(code !== undefined ? { category: code } : {}), serial: nextSerial() };
        h.customerNo = fmt(code, h.label.serial as number);
      }
      return { ok: true, value: { customerNo: h.customerNo, duplicate: false } };
    case "makeSample": {
      if (h === undefined) return { ok: false, code: "E_STORE_UNKNOWN_HOUSEHOLD" };
      if (h.label.sample !== undefined) return { ok: false, code: "E_STORE_SAMPLE" };
      const l = newSample(a.sample);
      if (l === null) return { ok: false, code: "E_STORE_SAMPLE" };
      h.label = l;
      h.customerNo = l.sample?.no as string;
      return { ok: true, value: { customerNo: h.customerNo, duplicate: false } };
    }
    case "updateSample":
      if (h === undefined) return { ok: false, code: "E_STORE_UNKNOWN_HOUSEHOLD" };
      if (h.label.sample === undefined || (a.name ?? "").trim() === "") return { ok: false, code: "E_STORE_SAMPLE" };
      h.label.sample = { ...h.label.sample, name: a.name as string, traits: JSON.parse(a.traits ?? "[]") as string[] };
      return { ok: true };
    case "save":
      if (h === undefined) return { ok: false, code: "E_STORE_NOT_OPEN" };
      if (h.conflict === true) return { ok: false, code: "E_STORE_CONFLICT" };
      Object.assign(h, { body: a.body, summary: a.summary, updatedAt: now, generation: h.generation + 1, updatedBy: me });
      return { ok: true, value: { generation: h.generation, savedAt: now } };
    case "forkInfo":
      if (h === undefined) return { ok: false, code: "E_STORE_UNKNOWN_HOUSEHOLD" };
      return { ok: true, value: { savedConflict: h.conflict === true, theirsSavedAt: h.updatedAt, theirsBy: h.updatedBy ?? null, theirsGeneration: h.generation, oursGeneration: h.conflict === true ? h.generation : null, syncCopies: h.forks ?? 0, personal: devOffice.usage === "personal" } };
    case "resolveFork":
      if (h === undefined) return { ok: false, code: "E_STORE_UNKNOWN_HOUSEHOLD" };
      if (h.conflict !== true && a.keepOurs === "1") return { ok: false, code: "E_STORE_NO_FORK" };
      h.conflict = false;
      return { ok: true, value: opened(a.id as string, h) };
    case "resolveSyncCopies":
      if (h === undefined || (h.forks ?? 0) === 0) return { ok: false, code: "E_STORE_NO_FORK" };
      h.forks = 0;
      return { ok: true };
    case "rename": {
      if (h === undefined) return { ok: false, code: "E_STORE_UNKNOWN_HOUSEHOLD" };
      if (h.label.sample !== undefined) return { ok: false, code: "E_STORE_SAMPLE" };
      const c = (a.customerNo ?? "").trim();
      if (!/^[A-Za-z0-9_-]{1,16}$/.test(c)) return { ok: false, code: "E_STORE_CUSTOMER_NO" };
      // 同じ番号をそのまま入れたときは何も変えない（今までの PC の接頭辞の番号を体系の番号に読み替えない）
      if (c === h.customerNo) return { ok: true, value: { customerNo: h.customerNo, duplicate: false } };
      // 区分の記号＋通し番号[-枝番]なら体系の番号（区分を使わないときは数字だけ）、そうでなければ自由な番号（区分はそのまま）
      const m = /^([A-Z]{0,2})(\d{1,6})(?:-([1-9]\d?|C))?$/.exec(c);
      const known = m !== null && (m[1] === "" ? s.categories.length === 0 : s.categories.some((x) => x.code === m[1]));
      if (m !== null && known && Number(m[2]) > 0) {
        const code = m[1] === "" ? undefined : m[1];
        h.label = { ...(code !== undefined ? { category: code } : {}), serial: Number(m[2]), ...(m[3] !== undefined ? { branch: m[3] } : {}) };
        h.customerNo = fmt(code, Number(m[2]), m[3]);
        s.nextSerial = Math.max(s.nextSerial, Number(m[2]) + 1);
      } else {
        h.label = h.label.category !== undefined ? { category: h.label.category } : {};
        h.customerNo = c;
      }
      return { ok: true, value: { customerNo: h.customerNo, duplicate: [...s.households.entries()].some(([k, e]) => k !== a.id && e.label.sample === undefined && (e.customerNo === h.customerNo || (h.label.serial !== undefined && e.label.serial === h.label.serial && e.label.branch === h.label.branch))) } };
    }
    case "delete":
      if (h === undefined) return { ok: false, code: "E_STORE_UNKNOWN_HOUSEHOLD" };
      if ((a.confirm ?? "").trim() !== h.customerNo) return { ok: false, code: "E_STORE_CONFIRM" };
      s.households.delete(a.id as string);
      if (s.lastOpened === a.id) s.lastOpened = null;
      s.deletions++;
      return { ok: true };
    case "recoveryKey":
      return { ok: true, value: shared ? devOffice.key : s.recoveryKey };
    case "acknowledge":
      if (shared) devOffice.ack = { by: devOffice.myName ?? "", at: now, verifiedAt: devOffice.ack?.verifiedAt ?? null };
      else s.acknowledgedAt = now;
      return { ok: true, value: status() };
    case "test":
    case "restore": {
      const k = norm(a.key ?? "");
      if (k.length !== 58) return { ok: false, code: "E_RECOVERY_TYPO" };
      if (k !== norm(shared && op === "test" ? devOffice.key : s.recoveryKey)) return { ok: false, code: "E_RECOVERY_MISMATCH" };
      // 共有の事務所では、試して開けたら保管済みとみなす
      if (op === "test" && shared) devOffice.ack = { by: devOffice.ack?.by ?? devOffice.myName ?? "", at: devOffice.ack?.at ?? now, verifiedAt: now };
      else if (op === "test") s.verifiedAt = now;
      return { ok: true, value: status() };
    }
  }
  return { ok: false, code: "E_DEV_STORE_OP" };
}

/**
 * 開発用のサーバーの事務所での共有（本体の office_* の代わり。メモリの中だけ）。フォルダのダイアログは出さず、架空の共有フォルダを選んだことにする。
 * 決まり（承認は指紋の入力が必須・申請の指紋は承認する人に返さない・外すときは表示名の確認）は本体（household-store）と同じにしてある。
 * `/__dev/office/simulate?kind=request|approved|presence|conflict|editor|fork|recoveryJoin|others|personalOthers|pcJoin|otherPcOpen|longAbsence` で、他の PC の操作が届いたことにする
 * （longAbsence は、30日より長く開かなかった間に鍵が入れ替わり、名簿をたどれなくなったことにする。番号は 7K2M-QX9P-4HDN-R8VT、復元キーは今の架空の復元キーを返す）
 * （others は架空の事務所の復元キー、personalOthers は1台目の PC が同期フォルダを始めたことにして、その架空の復元キーを返す。0024）
 */
type DevMember = { memberId: string; name: string; fingerprint: string; joinedAt: string; approvedBy: string | null; role: string; isMe: boolean; viaRecovery?: boolean };
/** 開発用のサーバーの事務所の復元キー（外すたびに作り直す。画面の確かめ用の架空の値） */
const devOfficeKey = () => {
  const al = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const c = Array.from({ length: 58 }, () => al[Math.floor(Math.random() * 32)] as string).join("");
  return (c.match(/.{1,4}/g) ?? []).join("-");
};
const devOffice = {
  state: "off" as "off" | "pending" | "member" | "removed",
  myName: null as string | null,
  myFingerprint: "R8DW-5N2K-QH7T-3MVA",
  members: [] as DevMember[],
  removed: [] as { name: string; removedAt: string; removedBy: string | null }[],
  requests: [] as { requestId: string; name: string; requestedAt: string; fingerprint: string }[],
  ack: null as null | { by: string; at: string; verifiedAt: string | null },
  key: devOfficeKey(),
  notices: [] as { kind: "recoveryJoin"; name: string; at: string }[],
  /** 使い方（1人で2台の PC の同期フォルダ・事務所での共有。0024） */
  usage: null as null | "personal" | "office",
  /** 「ほかの PC で始めた」フォルダの使い方（復元キーで開く画面の確かめ用） */
  othersUsage: "office" as "personal" | "office",
  /** もう1台の PC が世帯を開いている（この PC の中へ戻すのを止める確かめ用） */
  otherPcOpen: false,
  /** 30日より長く開かなかった間に鍵の入れ替えがあり、名簿をたどれない（番号・復元キーを入れる画面の確かめ用。0023 の追記 2026-11-04） */
  unverified: false,
};
/** 開発用のサーバーの事務所の確かめ用の番号（画面の確かめ用の架空の値） */
const DEV_OFFICE_CODE = "7K2M-QX9P-4HDN-R8VT";

/** 提案書に当てる事務所の見た目（本体の office::report_brand の代わり。0121）: 名前とロゴはメモリの見た目から、色は画面が渡した色 */
function devReportBrand(accent: string | null): { brand?: Record<string, unknown> } {
  const b = devBranding.value as { name?: string; logo?: { data: string } };
  const brand: Record<string, unknown> = {};
  if (accent !== null && /^#[0-9a-f]{6}$/.test(accent)) brand.accent = accent;
  if (b.name !== undefined) brand.office = b.name;
  if (b.logo !== undefined) brand.logo = b.logo.data;
  return Object.keys(brand).length > 0 ? { brand } : {};
}

/** 事務所の既定値（開発用のサーバーのメモリの中だけ。0073） */
const devOfficeDefaults: { value: Record<string, unknown> } = { value: {} };

/**
 * 事務所の見た目（本体の office_branding_get・office_branding_put・office_logo_pick の代わり。0121）: メモリの中だけ。
 * ロゴを選ぶ代わりに FINANCIA_DEV_OPEN_LOGO の画像（無ければアプリのアイコンの PNG）を読む。見出しの確かめは本体と同じ決まり（office/branding.ts）
 */
const devBranding: { value: Record<string, unknown> } = { value: {} };
const devLogoFile = () => process.env.FINANCIA_DEV_OPEN_LOGO || join(APP_DIR, "src-tauri", "icons", "128x128.png");
function devCheckBranding(v: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; code: string } {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { ok: false, code: "E_STORE_BRANDING" };
  const o = v as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (o.name !== undefined && o.name !== null) {
    if (typeof o.name !== "string" || [...o.name.trim()].length > NAME_MAX_CHARS || [...o.name].some((c) => c.charCodeAt(0) < 0x20)) return { ok: false, code: "E_STORE_BRANDING" };
    if (o.name.trim() !== "") out.name = o.name.trim();
  }
  if (o.color !== undefined && o.color !== null) {
    if (typeof o.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(o.color.trim())) return { ok: false, code: "E_STORE_BRANDING" };
    out.color = o.color.trim().toLowerCase();
  }
  if (o.appearance !== undefined && o.appearance !== null) {
    if (o.appearance !== "light" && o.appearance !== "dark" && o.appearance !== "system") return { ok: false, code: "E_STORE_BRANDING" };
    out.appearance = o.appearance;
  }
  if (o.logo !== undefined && o.logo !== null) {
    const l = o.logo as Record<string, unknown>;
    const bytes = new Uint8Array(Buffer.from(String(l.data ?? ""), "base64"));
    const h = readLogoHeader(bytes);
    if (typeof h === "string") return { ok: false, code: h };
    out.logo = { ...h, data: Buffer.from(bytes).toString("base64") };
  }
  return { ok: true, value: out };
}

/** 機能を有効にするコード（本体の feature_code_* の代わり。0110）: メモリの中だけ。公開鍵は本体と同じ配布元の設定から読む。
 * 今日は FINANCIA_DEV_TODAY（YYYY-MM-DD）か、開発用の op「featureToday」で変えられる（期限が近い・切れたの見え方を確かめるため）。
 * 公開鍵は開発用のビルドと同じく [keys] と [dev_keys] の両方。
 * 取り下げの一覧（0117 の3 (3)・0110 の追記）は FINANCIA_DEV_FEATURE_REVOCATIONS、コードを止めるだけの一覧（0117 の追記 2026-11-04 の2）は
 * FINANCIA_DEV_FEATURE_CODE_REVOCATIONS に書いた手元のファイルを「配信元」とみなして読む（無い・読めないときは「つながらない」）。
 * 本体と同じく、コードが入っているときだけ、最初に状態を読んだときと1日1回と「今すぐ確かめる」で読む */
type DevKeys = { feature_code?: string[]; revocation?: string[]; feature_code_revocation?: string[] };
const devDist = parseToml(readFileSync(join(REPO_DIR, "config", "distribution.toml"), "utf8")) as { keys?: DevKeys; dev_keys?: DevKeys };
const devAllFeatureKeys = publicKeys([...(devDist.keys?.feature_code ?? []), ...(devDist.dev_keys?.feature_code ?? [])]);
const devRevocationKeys = publicKeys([...(devDist.keys?.revocation ?? []), ...(devDist.dev_keys?.revocation ?? [])]);
const devCodeRevocationKeys = publicKeys([...(devDist.keys?.feature_code_revocation ?? []), ...(devDist.dev_keys?.feature_code_revocation ?? [])]);
type DevCandidate = { id: string; receivedAt: string; code: string; connector: string | null };
const devFeatures: { codes: string[]; today: string | null; saved: string | null; savedCodes: string | null; checkedAt: string | null; okAt: string | null; result: "ok" | "offline" | "rejected" | null; lastCheckMs: number | null; candidates: DevCandidate[]; notices: NoticeRecord[] } = {
  codes: [],
  notices: [],
  today: /^\d{4}-\d{2}-\d{2}$/.test(process.env.FINANCIA_DEV_TODAY ?? "") ? (process.env.FINANCIA_DEV_TODAY as string) : null,
  saved: null,
  savedCodes: null,
  checkedAt: null,
  okAt: null,
  result: null,
  lastCheckMs: null,
  candidates: [],
};
const devFeatureToday = () => devFeatures.today ?? todayJst();
const devRevoked = () => revokedIds(devFeatures.saved, devRevocationKeys, devFeatures.savedCodes, devCodeRevocationKeys);
/** コードの鍵（取り下げの一覧で取り下げた鍵を外したもの） */
const devCodeKeys = () => withoutRevokedKeys(devAllFeatureKeys, devFeatures.saved, devRevocationKeys);
/** 止めた一覧を「配信元」（手元のファイル）から取る */
function devFeatureCheck() {
  const read = (name: string): string | null => {
    const f = process.env[name] ?? "";
    try {
      return f === "" ? null : readFileSync(f, "utf8");
    } catch {
      return null;
    }
  };
  // 本体と同じく、先に取り下げの一覧を当て、そこで外した鍵を除いた鍵で、コードを止めるだけの一覧を確かめる
  const r = applyFetch(devFeatures.saved, read("FINANCIA_DEV_FEATURE_REVOCATIONS"), devRevocationKeys);
  const c = applyFetch(devFeatures.savedCodes, read("FINANCIA_DEV_FEATURE_CODE_REVOCATIONS"), withoutRevokedKeys(devCodeRevocationKeys, r.saved, devRevocationKeys), verifyCodeRevocations);
  const result = r.result === "rejected" || c.result === "rejected" ? "rejected" : r.result === "ok" && c.result === "ok" ? "ok" : "offline";
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  Object.assign(devFeatures, { saved: r.saved, savedCodes: c.saved, checkedAt: now, result, lastCheckMs: Date.now(), ...(result === "ok" ? { okAt: now } : {}) });
}
function devFeatureView() {
  if (devFeatures.codes.length > 0 && (devFeatures.lastCheckMs === null || Date.now() - devFeatures.lastCheckMs > (devFeatures.result === "ok" ? 24 : 1) * 3600_000)) devFeatureCheck();
  const today = devFeatureToday();
  const revoked = devRevoked();
  const st = featureStatus(devFeatures.codes, devCodeKeys(), today, revoked);
  devFeatures.notices = applyNotices(st, devFeatures.notices);
  const saved = devFeatures.saved === null ? null : verifyRevocations(devFeatures.saved, devRevocationKeys);
  const savedCodes = devFeatures.savedCodes === null ? null : verifyCodeRevocations(devFeatures.savedCodes, withoutRevokedKeys(devCodeRevocationKeys, devFeatures.saved, devRevocationKeys));
  const candidates = devFeatures.candidates.map((c) => {
    const v = verifyCode(c.code, devCodeKeys());
    const r = addCode(devFeatures.codes, c.code, devCodeKeys(), today, revoked);
    const after = r.ok ? featureStatus(r.codes, devCodeKeys(), today, revoked).active : st.active;
    return {
      id: c.id,
      receivedAt: c.receivedAt,
      connector: c.connector,
      ok: r.ok,
      error: r.ok ? null : r.error,
      name: v.ok ? v.claims.name : null,
      features: v.ok ? v.claims.features : [],
      expires: v.ok ? (v.claims.expires ?? null) : null,
      before: st.active,
      after,
      replaces: r.ok ? devFeatures.codes.filter((x) => !r.codes.includes(x)).length : 0,
    };
  });
  return { ...st, check: { checkedAt: devFeatures.checkedAt, okAt: devFeatures.okAt, result: devFeatures.result, serial: saved !== null && saved.ok ? saved.list.serial : null, codeListSerial: savedCodes !== null && savedCodes.ok ? savedCodes.list.serial : null, listed: devRevoked().length }, candidates };
}

function devOfficeOp(op: string, a: Record<string, unknown>): { ok: true; value?: unknown } | { ok: false; code: string } {
  const o = devOffice;
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const norm = (f: string) => f.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  const name = typeof a.name === "string" ? a.name.trim() : "";
  const status = () => ({
    state: o.state === "member" && o.unverified ? "unavailable" : o.state,
    usage: o.state === "off" ? null : (o.usage ?? "office"),
    problem: o.state === "member" && o.unverified ? "E_OFFICE_ROSTER_UNVERIFIED" : null,
    myName: o.myName,
    myFingerprint: o.state === "off" ? null : o.myFingerprint,
    members: o.state === "member" ? o.members.map((m) => ({ ...m, viaRecovery: m.viaRecovery === true })) : [],
    removed: o.state === "member" ? o.removed : [],
    requests: o.state === "member" ? o.requests.map(({ requestId, name: n, requestedAt }) => ({ requestId, name: n, requestedAt })) : [],
    officeCode: o.state === "member" && !o.unverified ? DEV_OFFICE_CODE : null,
    syncFolder: o.state !== "off",
    localHouseholds: o.state === "member" ? 0 : devStore.households.size,
    recoveryAcknowledged: o.ack !== null,
    recoveryAcknowledgedBy: o.ack?.by ?? null,
    recoveryAcknowledgedAt: o.ack?.at ?? null,
    recoveryVerifiedAt: o.ack?.verifiedAt ?? null,
    recoveryRequired: o.state === "member" && o.ack === null,
    notices: o.state === "member" ? o.notices : [],
    viewOnly: false,
  });
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString().replace(/\.\d+Z$/, "Z");
  switch (op) {
    case "status":
      return { ok: true, value: status() };
    case "start":
    case "join": {
      if (name === "" || [...name].length > 20) return { ok: false, code: "E_OFFICE_NAME" };
      if (o.state === "member" || o.state === "pending") return { ok: false, code: "E_OFFICE_STATE" };
      o.myName = name;
      o.usage = "office";
      if (op === "join") {
        o.state = "pending";
        return { ok: true, value: status() };
      }
      o.state = "member";
      o.key = devOfficeKey();
      o.ack = null;
      o.members = [{ memberId: crypto.randomUUID(), name, fingerprint: o.myFingerprint, joinedAt: now, approvedBy: null, role: "member", isMe: true }];
      return { ok: true, value: status() };
    }
    case "recover": {
      // 全員の PC が使えなくなったとき: 架空の共有フォルダの事務所に、復元キーで加わる
      if (name === "" || [...name].length > 20) return { ok: false, code: "E_OFFICE_NAME" };
      const k = norm(String(a.key ?? ""));
      if (k.length !== 58) return { ok: false, code: "E_RECOVERY_TYPO" };
      if (o.state === "member" || o.state === "pending") return { ok: false, code: "E_OFFICE_STATE" };
      if (k !== norm(o.key)) return { ok: false, code: "E_RECOVERY_MISMATCH" };
      o.state = "member";
      o.myName = name;
      o.usage = o.othersUsage;
      o.members = [
        { memberId: crypto.randomUUID(), name: "担当A", fingerprint: "M3TQ-8VNA-2KXD-H7RP", joinedAt: ago(60 * 24 * 30), approvedBy: null, role: "member", isMe: false },
        { memberId: crypto.randomUUID(), name, fingerprint: o.myFingerprint, joinedAt: now, approvedBy: null, role: "member", isMe: true, viaRecovery: true },
      ];
      o.ack = o.ack ?? { by: name, at: now, verifiedAt: now };
      return { ok: true, value: status() };
    }
    case "end": {
      const me = o.members.find((m) => m.isMe);
      if (o.state !== "member" || me === undefined) return { ok: false, code: "E_OFFICE_STATE" };
      if (String(a.confirm ?? "").trim() !== me.name) return { ok: false, code: "E_OFFICE_CONFIRM" };
      if (o.members.length > 1) return { ok: false, code: "E_OFFICE_OTHERS_REMAIN" };
      Object.assign(o, { state: "off", members: [], removed: [], requests: [], ack: null, notices: [], usage: null });
      return { ok: true, value: status() };
    }
    // 1人で2台の PC の同期フォルダ（本体の storage_* の代わり。0024）
    case "syncStart": {
      if (name === "" || [...name].length > 20) return { ok: false, code: "E_OFFICE_NAME" };
      if (o.state === "member" || o.state === "pending") return { ok: false, code: "E_OFFICE_STATE" };
      if (devStore.acknowledgedAt === null && devStore.verifiedAt === null) return { ok: false, code: "E_SYNC_RECOVERY_REQUIRED" };
      // 今の復元キーをそのまま使い、保管の記録も引き継ぐ
      Object.assign(o, { state: "member", usage: "personal", myName: name, key: devStore.recoveryKey, ack: { by: name, at: devStore.acknowledgedAt ?? now, verifiedAt: devStore.verifiedAt }, removed: [], requests: [], notices: [] });
      o.members = [{ memberId: crypto.randomUUID(), name, fingerprint: o.myFingerprint, joinedAt: now, approvedBy: null, role: "member", isMe: true }];
      return { ok: true, value: status() };
    }
    case "syncOpen": {
      if (name === "" || [...name].length > 20) return { ok: false, code: "E_OFFICE_NAME" };
      const k = norm(String(a.key ?? ""));
      if (k.length !== 58) return { ok: false, code: "E_RECOVERY_TYPO" };
      if (o.state === "member" || o.state === "pending") return { ok: false, code: "E_OFFICE_STATE" };
      if (k !== norm(o.key)) return { ok: false, code: "E_RECOVERY_MISMATCH" };
      if (o.othersUsage !== "personal") return { ok: false, code: "E_SYNC_IS_OFFICE" };
      Object.assign(o, { state: "member", usage: "personal", myName: name });
      o.members = [
        { memberId: crypto.randomUUID(), name: "事務所のPC", fingerprint: "M3TQ-8VNA-2KXD-H7RP", joinedAt: ago(60 * 24 * 14), approvedBy: null, role: "member", isMe: false },
        { memberId: crypto.randomUUID(), name, fingerprint: o.myFingerprint, joinedAt: now, approvedBy: null, role: "member", isMe: true, viaRecovery: true },
      ];
      o.ack = o.ack ?? { by: "事務所のPC", at: ago(60 * 24 * 14), verifiedAt: null };
      return { ok: true, value: status() };
    }
    case "syncEnd": {
      const me = o.members.find((m) => m.isMe);
      if (o.state !== "member" || o.usage !== "personal" || me === undefined) return { ok: false, code: "E_OFFICE_STATE" };
      if (String(a.confirm ?? "").trim() !== me.name) return { ok: false, code: "E_OFFICE_CONFIRM" };
      if (o.otherPcOpen) return { ok: false, code: "E_SYNC_OTHER_PC_OPEN" };
      Object.assign(o, { state: "off", members: [], removed: [], requests: [], notices: [], usage: null });
      return { ok: true, value: status() };
    }
    case "notices": {
      const st = status();
      const scope = st.usage === null ? "local" : st.usage;
      const n = (kind: string, level: string, extra: Record<string, unknown> = {}) => ({ kind, level, scope, count: null, name: null, at: null, code: null, ...extra });
      const out: unknown[] = [];
      if (!(o.state === "member" ? o.ack !== null : devStore.acknowledgedAt !== null)) out.push(n("recoveryNotKept", scope === "local" ? "info" : "warn"));
      if (o.state === "pending") out.push(n("pending", "info"));
      for (const x of st.notices) out.push(n("recoveryJoin", "alert", { name: x.name, at: x.at }));
      if (st.requests.length > 0) out.push(n("joinRequest", scope === "personal" ? "alert" : "info", { count: st.requests.length }));
      const forks = [...devStore.households.values()].filter((h) => (h.forks ?? 0) > 0).length;
      if (forks > 0) out.push(n("syncCopies", "warn", { count: forks }));
      return { ok: true, value: out };
    }
    case "dismissNotices":
      o.notices = [];
      return { ok: true, value: status() };
    case "acceptRoster": {
      // 本体の office_accept_roster の代わり: 番号（16文字）か今の復元キー（58文字）が合ったときだけ受け入れる
      if (o.state !== "member" || !o.unverified) return { ok: false, code: "E_OFFICE_STATE" };
      const c = norm(String(a.code ?? ""));
      if (c.length === 16) {
        if (c !== norm(DEV_OFFICE_CODE)) return { ok: false, code: "E_OFFICE_CODE_MISMATCH" };
      } else if (c.length > 16) {
        if (c.length !== 58) return { ok: false, code: "E_RECOVERY_TYPO" };
        if (c !== norm(o.key)) return { ok: false, code: "E_OFFICE_CODE_MISMATCH" };
      } else return { ok: false, code: "E_OFFICE_CODE_SHAPE" };
      o.unverified = false;
      return { ok: true, value: status() };
    }
    case "cancel":
      if (o.state === "member") return { ok: false, code: "E_OFFICE_STATE" };
      o.state = "off";
      o.myName = null;
      o.usage = null;
      return { ok: true, value: status() };
    case "approve": {
      const r = o.requests.find((x) => x.requestId === a.requestId);
      if (o.state !== "member" || r === undefined) return { ok: false, code: "E_OFFICE_STATE" };
      if (o.usage === "personal") return { ok: false, code: "E_SYNC_PERSONAL" };
      if (o.ack === null) return { ok: false, code: "E_OFFICE_RECOVERY_REQUIRED" };
      if (norm(String(a.fingerprint ?? "")) !== norm(r.fingerprint)) return { ok: false, code: "E_OFFICE_FINGERPRINT" };
      o.requests = o.requests.filter((x) => x !== r);
      o.members.push({ memberId: r.requestId, name: r.name, fingerprint: r.fingerprint, joinedAt: now, approvedBy: o.myName, role: "member", isMe: false });
      return { ok: true, value: status() };
    }
    case "reject":
      o.requests = o.requests.filter((x) => x.requestId !== a.requestId);
      return { ok: true, value: status() };
    case "remove": {
      const m = o.members.find((x) => x.memberId === a.memberId);
      if (m === undefined) return { ok: false, code: "E_OFFICE_STATE" };
      if (m.isMe) return { ok: false, code: "E_OFFICE_SELF" };
      if (o.ack === null) return { ok: false, code: "E_OFFICE_RECOVERY_REQUIRED" };
      if (String(a.confirm ?? "").trim() !== m.name) return { ok: false, code: "E_OFFICE_CONFIRM" };
      o.members = o.members.filter((x) => x !== m);
      o.removed.push({ name: m.name, removedAt: now, removedBy: o.myName });
      o.ack = null;
      o.key = devOfficeKey();
      return { ok: true, value: status() };
    }
    // 事務所の既定値（本体の office_defaults_get・office_defaults_put の代わり。0073）: メモリの中だけ
    case "defaultsGet":
      return { ok: true, value: devOfficeDefaults.value };
    case "defaultsPut": {
      const v = a.value;
      if (typeof v !== "object" || v === null || Array.isArray(v) || JSON.stringify(v).length > 256 * 1024) return { ok: false, code: "E_STORE_OFFICE_DEFAULTS" };
      devOfficeDefaults.value = v as Record<string, unknown>;
      return { ok: true, value: null };
    }
    case "brandingGet":
      return { ok: true, value: devBranding.value };
    case "brandingPut": {
      const r = devCheckBranding(a.value);
      if (!r.ok) return r;
      devBranding.value = r.value;
      return { ok: true, value: r.value };
    }
    case "logoPick": {
      const f = devLogoFile();
      if (!existsSync(f)) return { ok: true, value: null };
      const bytes = new Uint8Array(readFileSync(f));
      const h = readLogoHeader(bytes);
      if (typeof h === "string") return { ok: false, code: h };
      return { ok: true, value: { ...h, data: Buffer.from(bytes).toString("base64") } };
    }
    case "featureStatus":
      return { ok: true, value: devFeatureView() };
    case "featureAdd": {
      const r = addCode(devFeatures.codes, String(a.code ?? ""), devCodeKeys(), devFeatureToday(), devRevoked());
      if (!r.ok) return { ok: false, code: r.error };
      devFeatures.codes = r.codes;
      devFeatures.lastCheckMs = null;
      return { ok: true, value: devFeatureView() };
    }
    case "featureRemove": {
      const next = devFeatures.codes.filter((c) => reference(c) !== String(a.ref ?? ""));
      if (next.length === devFeatures.codes.length) return { ok: false, code: "E_FEATURE_CODE_NOT_FOUND" };
      devFeatures.codes = next;
      return { ok: true, value: devFeatureView() };
    }
    case "featureNoticeDismiss": {
      // 本体の feature_code_notice_dismiss の代わり（記録を今の状態に合わせてから閉じる。コードは外さない）
      devFeatureView();
      const next = dismissNotice(devFeatures.notices, String(a.ref ?? ""));
      if (next === null) return { ok: false, code: "E_FEATURE_CODE_NOT_FOUND" };
      devFeatures.notices = next;
      return { ok: true, value: devFeatureView() };
    }
    case "featureCheck":
      // 本体の feature_codes_check の代わり（本体は裏で取りに行く。ここではすぐ読む）
      if (devFeatures.codes.length > 0) devFeatureCheck();
      return { ok: true, value: devFeatureView() };
    case "featureCandidateDecide": {
      // 本体の feature_code_candidate_decide の代わり（入れられないコードは候補を残して符号を返す）
      const c = devFeatures.candidates.find((x) => x.id === a.id);
      if (c === undefined) return { ok: false, code: "E_FEATURE_CODE_CANDIDATE_UNKNOWN" };
      if (a.accept === true) {
        const r = addCode(devFeatures.codes, c.code, devCodeKeys(), devFeatureToday(), devRevoked());
        if (!r.ok) return { ok: false, code: r.error };
        devFeatures.codes = r.codes;
        devFeatures.lastCheckMs = null;
      }
      devFeatures.candidates = devFeatures.candidates.filter((x) => x !== c);
      return { ok: true, value: devFeatureView() };
    }
    case "featureToday":
      // 開発用のサーバーだけ: 期限の判定に使う今日を変える（空なら PC の今日）
      devFeatures.today = typeof a.today === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.today) ? a.today : null;
      return { ok: true, value: devFeatureView() };
    case "moveLocal":
      return { ok: true, value: o.state === "member" ? devStore.households.size : 0 };
    case "reset":
      // 画面の確かめを最初からやり直す（開発用のサーバーのメモリを空にする）
      Object.assign(o, { state: "off", myName: null, members: [], removed: [], requests: [], ack: null, notices: [], key: devOfficeKey(), usage: null, othersUsage: "office", otherPcOpen: false, unverified: false });
      devStore.households.clear();
      devStore.lastOpened = null;
      devStore.acknowledgedAt = null;
      return { ok: true, value: status() };
    case "simulate": {
      const kind = String(a.kind ?? "");
      const target = devStore.lastOpened !== null ? devStore.households.get(devStore.lastOpened) : undefined;
      if (kind === "recoveryJoin" && o.state === "member") {
        o.members.push({ memberId: crypto.randomUUID(), name: "担当N", fingerprint: "N4KD-7QXA-2MVT-H9RP", joinedAt: ago(5), approvedBy: null, role: "member", isMe: false, viaRecovery: true });
        o.notices.push({ kind: "recoveryJoin", name: "担当N", at: ago(5) });
      } else if (kind === "others" || kind === "personalOthers") {
        // 他の PC で事務所を始めた・同期フォルダを始めた（復元キーで加わる・開く画面の確かめ用。架空の復元キーを返す）
        o.key = devOfficeKey();
        o.ack = null;
        o.othersUsage = kind === "personalOthers" ? "personal" : "office";
        return { ok: true, value: o.key };
      } else if (kind === "pcJoin" && o.state === "member") {
        // 1人で2台の PC: もう1台の PC が復元キーで同期フォルダを開いた
        o.members.push({ memberId: crypto.randomUUID(), name: "自宅のノート", fingerprint: "N4KD-7QXA-2MVT-H9RP", joinedAt: ago(5), approvedBy: null, role: "member", isMe: false, viaRecovery: true });
        o.notices.push({ kind: "recoveryJoin", name: "自宅のノート", at: ago(5) });
      } else if (kind === "longAbsence" && o.state === "member") {
        o.unverified = true;
        o.key = devOfficeKey();
        return { ok: true, value: o.key };
      } else if (kind === "otherPcOpen") {
        o.otherPcOpen = !o.otherPcOpen;
        for (const h of devStore.households.values()) if (h === target || devStore.households.size === 1) h.openBy = o.otherPcOpen ? [{ name: "自宅のノート", since: ago(3) }] : [];
      } else if (kind === "request") o.requests.push({ requestId: crypto.randomUUID(), name: "担当C", requestedAt: ago(3), fingerprint: "7XQM-2KDN-HV4R-P9TC" });
      else if (kind === "approved" && o.state === "pending") {
        o.state = "member";
        o.members = [
          { memberId: crypto.randomUUID(), name: "担当A", fingerprint: "M3TQ-8VNA-2KXD-H7RP", joinedAt: ago(60 * 24 * 7), approvedBy: null, role: "member", isMe: false },
          { memberId: crypto.randomUUID(), name: o.myName ?? "担当B", fingerprint: o.myFingerprint, joinedAt: now, approvedBy: "担当A", role: "member", isMe: true },
        ];
      } else if (kind === "presence") {
        for (const h of devStore.households.values()) if (h === target || devStore.households.size === 1) h.openBy = [{ name: "担当B", since: ago(12) }];
      } else if (kind === "editor") {
        let i = 0;
        for (const h of devStore.households.values()) h.updatedBy = i++ % 2 === 0 ? "担当B" : (o.myName ?? "担当A");
      } else if (kind === "conflict" && target !== undefined) {
        target.conflict = true;
        target.updatedBy = "担当B";
        target.updatedAt = ago(1);
      } else if (kind === "fork" && target !== undefined) target.forks = 1;
      else return { ok: false, code: "E_DEV_SIMULATE" };
      return { ok: true, value: status() };
    }
  }
  return { ok: false, code: "E_DEV_OFFICE_OP" };
}

/**
 * 開発用のサーバーの AI接続口（本体の ai_* の代わり。メモリの中だけ）。画面の確かめ用で、本物の受け口は開けない。
 * 決まり（既定はオフ・同意が無ければ渡さない・撤回で共有を止める・候補は判断を1回だけ）は本体（ai-share）と同じにしてある。
 * `/__dev/ai/simulate?kind=read|propose` で、AI からの読み取り・プランの候補が届いたことにする。
 * `/__dev/ai/proposeFeatureCode`（POST {code}）で、機能を有効にするコードの候補が届いたことにする
 */
const devAi = {
  enabled: false,
  books: new Map<string, { consents: Record<string, unknown>[]; records: Record<string, unknown>[]; candidates: Record<string, unknown>[] }>(),
  share: null as null | { householdId: string; shareId: string; alias: string; expiresMs: number },
};
const DEV_AI_EXPLANATION = "（開発用の見本）ご相談の内容をもとにしたライフプランの計算や見直しの検討に、FPが契約している外部のAIを使うことがあります。\nAIに渡すのは、計算に必要な項目だけです。お名前・ご住所・FPのメモは渡しません。\nこの同意はいつでも撤回でき、撤回した後はAIに渡しません。";

function devAiOp(op: string, a: Record<string, unknown>): { ok: true; value?: unknown } | { ok: false; code: string } {
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const id = typeof a.id === "string" ? a.id : "";
  const book = () => {
    let b = devAi.books.get(id);
    if (b === undefined) devAi.books.set(id, (b = { consents: [], records: [], candidates: [] }));
    return b;
  };
  const active = () => (devAi.share !== null && devAi.share.expiresMs > Date.now() ? devAi.share : null);
  const shareStatus = () => {
    const s = active();
    return s === null ? null : { shareId: s.shareId, alias: s.alias, householdId: s.householdId, customerNumber: devStore.households.get(s.householdId)?.customerNo ?? null, expiresInSec: Math.floor((s.expiresMs - Date.now()) / 1000) };
  };
  const end = (reason: string) => {
    const s = active();
    if (s === null) return;
    const r = devAi.books.get(s.householdId)?.records.find((x) => x.shareId === s.shareId);
    if (r !== undefined && r.endedAt === null) Object.assign(r, { endedAt: now, endReason: reason });
    devAi.share = null;
  };
  const consentState = (b: ReturnType<typeof book>) => (b.consents.at(-1)?.decision as string | undefined) ?? "none";
  const view = () => {
    const b = book();
    const sh = shareStatus();
    return { consentState: consentState(b), consents: b.consents, explanation: DEV_AI_EXPLANATION, explanationRef: "sha256:dev", share: sh !== null && sh.householdId === id ? sh : null, records: b.records, candidates: b.candidates, allowlistVersion: "reduced@2", fields: ["member.birth", "income.salary.annual", "livingExpense.monthly", "account.marketValue", "assumptions.inflation"], saved: devStore.households.has(id) };
  };
  const setup = (title: string, client: string, text: string) => ({ client, title, text });
  switch (op) {
    case "status": {
      const sh = shareStatus();
      return {
        ok: true,
        value: {
          enabled: devAi.enabled,
          running: devAi.enabled,
          problem: null,
          storeReady: true,
          connector: { found: true, version: "0.1.0", versionMatches: true },
          shares: sh === null ? [] : [sh],
          setup: [
            setup("コマンドで登録するAIアプリ（claude mcp add）", "command", 'claude mcp add --transport stdio --scope user -e LIFEPLAN_RUNTIME_DIR="<開発用の作業フォルダ>" fprise-lifeplan -- "<接続口の場所>" mcp'),
            setup("JSON の設定ファイル（mcpServers）に書くAIアプリ", "json", '{\n  "mcpServers": {\n    "fprise-lifeplan": {\n      "args": ["mcp"],\n      "command": "<接続口の場所>",\n      "env": { "LIFEPLAN_RUNTIME_DIR": "<開発用の作業フォルダ>" }\n    }\n  }\n}'),
            setup("TOML の設定ファイル（mcp_servers）に書くAIアプリ", "toml", '[mcp_servers.fprise-lifeplan]\ncommand = "<接続口の場所>"\nargs = ["mcp"]'),
          ],
          durations: [15, 60, 120, 240, 480],
          dev: true,
          featureCodeCandidates: devFeatures.candidates.length,
        },
      };
    }
    case "setEnabled":
      devAi.enabled = a.enabled === true;
      if (!devAi.enabled) {
        end("revoked");
        devFeatures.candidates = [];
      }
      return devAiOp("status", {});
    case "proposeFeatureCode": {
      // 接続口の propose_feature_code が届いたことにする（本体の受け口と同じ決まり: AI接続口がオンのときだけ・形だけ見る・同じコードはまとめる・4件まで）
      if (!devAi.enabled) return { ok: false, code: "E_AI_OFF" };
      const code = String(a.code ?? "").replace(/\s+/g, "");
      if (code.length > 2048 || !/^LPFC1-[A-Za-z0-9_.-]+$/.test(code)) return { ok: false, code: "INVALID" };
      if (!devFeatures.candidates.some((c) => c.code === code)) {
        if (devFeatures.candidates.length >= 4) return { ok: false, code: "INVALID" };
        devFeatures.candidates.push({ id: crypto.randomUUID(), receivedAt: now, code, connector: "dev-client 1.0" });
      }
      return { ok: true, value: { status: "pendingReview" } };
    }
    case "copySetup":
      return { ok: true, value: false };
    case "household":
      return devStore.households.has(id) ? { ok: true, value: view() } : { ok: false, code: "E_STORE_NOT_OPEN" };
    case "recordConsent": {
      const i = a.input as Record<string, unknown>;
      const b = book();
      if (i.fpConfirmed !== true) return { ok: false, code: "E_AI_CONSENT_FP_CONFIRM" };
      if (i.decision === "given" && consentState(b) === "given") return { ok: false, code: "E_AI_CONSENT_ALREADY" };
      if (i.decision === "withdrawn" && consentState(b) !== "given") return { ok: false, code: "E_AI_CONSENT_NOT_GIVEN" };
      b.consents.push({ id: crypto.randomUUID(), kind: "externalAi", decision: i.decision, obtainedOn: i.obtainedOn, method: i.method, explanationRef: "sha256:dev", ...(i.decision === "given" ? { externalAi: { company: i.company, country: i.country, noTrainingConfirmed: i.noTrainingConfirmed }, scope: "reduced" } : {}), fpConfirmed: true, recordedAt: now, origin: "thisOffice" });
      if (i.decision !== "given" && active()?.householdId === id) end("consentWithdrawn");
      return { ok: true, value: view() };
    }
    case "startShare": {
      const b = book();
      if (!devAi.enabled) return { ok: false, code: "E_AI_OFF" };
      if (consentState(b) !== "given") return { ok: false, code: "E_AI_NO_CONSENT" };
      if (active() !== null) return { ok: false, code: "E_AI_ALREADY_SHARED" };
      const minutes = Number(a.minutes);
      const shareId = `s-${crypto.randomUUID().slice(0, 8)}`;
      devAi.share = { householdId: id, shareId, alias: "共有中の世帯A", expiresMs: Date.now() + minutes * 60_000 };
      b.records.push({ id: crypto.randomUUID(), kind: "household", shareId, grantedAt: now, expiresAt: new Date(Date.now() + minutes * 60_000).toISOString().replace(/\.\d+Z$/, "Z"), endedAt: null, endReason: null, scope: "reduced", allowlistVersion: "reduced@2", fields: view().fields, householdRevision: "generation-dev", destinationDeclared: String(a.destination), consentAtGrant: { state: "given", recordId: (b.consents.at(-1)?.id as string) ?? null, warned: false }, reads: [], proposals: [] });
      return { ok: true, value: view() };
    }
    case "stopShare":
      if (active()?.householdId === id) end("revoked");
      return { ok: true, value: view() };
    case "decide": {
      const c = book().candidates.find((x) => x.id === a.candidate);
      if (c === undefined) return { ok: false, code: "E_AI_CANDIDATE_UNKNOWN" };
      if (c.status !== "pending") return { ok: false, code: "E_AI_CANDIDATE_DECIDED" };
      Object.assign(c, { status: a.accept === true ? "accepted" : "rejected", decidedAt: now, decidedBy: "fp", planId: a.accept === true ? a.plan : null });
      return { ok: true, value: view() };
    }
    case "simulate": {
      const s = active();
      if (s === null) return { ok: false, code: "E_AI_NOT_SHARED" };
      const b = devAi.books.get(s.householdId)!;
      const r = b.records.find((x) => x.shareId === s.shareId)! as { reads: Record<string, unknown>[]; proposals: Record<string, unknown>[] };
      if (a.kind === "propose") {
        const cid = crypto.randomUUID();
        b.candidates.push({ id: cid, source: "ai", shareId: s.shareId, receivedAt: now, title: "物価の上がり方を年1.5%で見直したプラン", summary: "物価の前提を少し高めにし、老後の金融資産がどれだけ変わるかを比べるためのプランです。", diffs: [{ id: crypto.randomUUID(), target: { plan: "assumptions" }, item: "assumptions.inflation", op: "set", value: "0.015", note: "最近の物価の動きに合わせて高めに見る" }, { id: crypto.randomUUID(), target: { plan: "assumptions" }, item: "assumptions.marketShocks", op: "set", value: [{ year: 2030, drop: "0.3" }], note: "下落の年を足す" }], origin: { kind: "ai", connector: "dev-client 1.0" }, status: "pending", decidedAt: null, decidedBy: null, planId: null });
        r.proposals.push({ candidateId: cid, at: now });
      } else {
        const last = r.reads.at(-1);
        if (last !== undefined && last.tool === "get_shared_household") Object.assign(last, { count: (last.count as number) + 1, lastAt: now });
        else r.reads.push({ firstAt: now, lastAt: now, count: 1, tool: "get_shared_household", fields: view().fields, digest: "sha256:3f6c0a9d2b71e4c85a0f19d6b2c3e4f5a6b7c8d9e0f1a2b3c4d5e6f708192a3b", caller: { connectorPid: 4242, connectorExe: "lifeplan", parentExe: "ai-app", mcpClientDeclared: "dev-client 1.0" } });
      }
      return { ok: true };
    }
  }
  return { ok: false, code: "E_DEV_AI_OP" };
}

function devHost(): Plugin {
  const households = join(REPO_DIR, "data", "modelHouseholds");
  const regulation = join(ENGINE_DIST, "regulation");
  // 提案書の見本（開発用）: 最後に作った PDF とページの PNG の置き場
  let lastReport: { dir: string; issuedOn: string } | null = null;
  const saveDir = () => process.env.FINANCIA_DEV_SAVE_DIR ?? "";
  const reportBin = () => [process.env.REPORT_PDF_BIN, join(REPO_DIR, "target", "release", "report-pdf"), join(REPO_DIR, "target", "debug", "report-pdf")].find((p): p is string => p !== undefined && p !== "" && existsSync(p)) ?? null;
  const dataSetLabel = (baseMonth: string) => {
    const ids = readdirSync(regulation)
      .filter((f) => f.endsWith(".json"))
      .map((f) => (JSON.parse(readFileSync(join(regulation, f), "utf8")) as { pack: { packId: string; version: string } }).pack)
      .map((p) => `${p.packId}@${p.version}`)
      .sort();
    return `${baseMonth.replace("-", ".")}-${createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 8)}`;
  };
  return {
    name: "financia-dev-host",
    apply: "serve",
    configureServer(server) {
      // FINANCIA_DEVLOG=1 のとき、画面からの要求を1行ずつ出す（WebView の中が見えないときの切り分け用）
      if (process.env.FINANCIA_DEVLOG === "1") server.middlewares.use((req, _res, next) => (console.log(`[dev] ${req.method} ${req.url}`), next()));
      // Web のヒアリングの受け付け（0125）: 開発用のサーバーだけ、同じ所の /api/hearing/v1 で受け付けのサーバーの処理（hearing/relay/handler.ts）を
      // メモリの置き場で動かす。FINANCIA_DEV_HEARING_RELAY（例 http://127.0.0.1:8787）があれば、手元の wrangler dev に回す。
      // お客さまのページ（/h/）も同じ所に出るので、発行した URL をそのまま開いて試せる
      server.middlewares.use(HEARING_API, (req, res) => {
        void (async () => {
          const body = req.method === "GET" || req.method === "HEAD" ? undefined : (await readBody(req)).toString("utf8");
          const headers: Record<string, string> = {};
          for (const k of ["authorization", "content-type", "origin"]) if (typeof req.headers[k] === "string") headers[k] = req.headers[k] as string;
          const path = `${HEARING_API}${req.url ?? ""}`;
          const target = process.env.FINANCIA_DEV_HEARING_RELAY;
          let out: Response;
          if (target !== undefined && target !== "") {
            const { origin: _o, ...rest } = headers;
            void _o;
            out = await fetch(`${target.replace(/\/$/, "")}${path}`, { method: req.method ?? "GET", headers: rest, ...(body !== undefined ? { body } : {}) });
          } else {
            out = await handleApi(new Request(`http://${req.headers.host ?? "localhost"}${path}`, { method: req.method ?? "GET", headers, ...(body !== undefined ? { body } : {}) }), { store: devRelayStore, now: () => new Date() });
          }
          res.statusCode = out.status;
          res.setHeader("content-type", out.headers.get("content-type") ?? "application/json");
          res.setHeader("cache-control", "no-store");
          res.end(await out.text());
        })().catch(() => {
          res.statusCode = 502;
          res.end('{"error":"E_RELAY_UNREACHABLE"}');
        });
      });
      server.middlewares.use("/__dev/", (req, res, next) => {
        const path = (req.url ?? "").replace(/^\/+/, "");
        // カスタム層の説明の文（本体の custom_texts_*・custom_dir_* の代わり。0016 の追記 2026-11-02）
        const cu = /^custom\/([A-Za-z]+)$/.exec(path);
        if (cu !== null && req.method === "POST") {
          void (async () => {
            const raw = (await readBody(req)).toString("utf8");
            try {
              const out = devCustom(cu[1] as string, raw === "" ? {} : (JSON.parse(raw) as Record<string, unknown>));
              res.setHeader("content-type", "application/json; charset=utf-8");
              res.end(JSON.stringify(out));
            } catch (e) {
              res.statusCode = 400;
              res.end(String(e));
            }
          })();
          return;
        }
        // 提案書の PDF（本体の proposal_render・proposal_page・proposal_save の代わり。report-pdf のコマンドを呼ぶ）
        if (path === "report/render" && req.method === "POST") {
          void (async () => {
            const t0 = performance.now();
            const { input, addressee, accent } = JSON.parse((await readBody(req)).toString("utf8")) as { input: string; addressee: string | null; accent?: string | null };
            const bin = reportBin();
            if (bin === null) return void ((res.statusCode = 500), res.end("E_DEV_NO_REPORT_PDF"));
            const data = JSON.parse(input) as { basis: { baseMonth: string }; document: { issuedOn: string }; assumptions: { survivorReform: boolean } };
            const label = dataSetLabel(data.basis.baseMonth);
            const frame = { stamp: { dataSetLabel: label, baseMonth: data.basis.baseMonth }, beta: true, notices: [...DEV_NOTICES, ...(data.assumptions.survivorReform ? [DEV_REFORM] : [])], internal: { snapshotId: null, dataSetId: label, customDigests: [] }, ...devReportBrand(accent ?? null) };
            const dir = mkdtempSync(join(tmpdir(), "financia-dev-report-"));
            writeFileSync(join(dir, "input.json"), input);
            writeFileSync(join(dir, "frame.json"), JSON.stringify(frame));
            const args = ["render", "--input", join(dir, "input.json"), "--frame", join(dir, "frame.json"), "--out", join(dir, "out.pdf"), "--meta", join(dir, "meta.json"), "--pages-dir", dir, "--scale", "0.5"];
            if (addressee !== null && addressee.trim() !== "") args.push("--addressee", addressee);
            execFile(bin, args, (err, _out, stderr) => {
              if (err !== null) return void ((res.statusCode = 500), res.end(/"code":"([A-Z_]+)"/.exec(stderr)?.[1] ?? "E_DEV_REPORT"));
              const meta = JSON.parse(readFileSync(join(dir, "meta.json"), "utf8")) as { pages: number; bytes: number; noticesPageAdded: boolean; sizes: [number, number][] };
              lastReport = { dir, issuedOn: data.document.issuedOn };
              res.setHeader("content-type", "application/json; charset=utf-8");
              res.end(JSON.stringify({ pages: meta.pages, sizes: meta.sizes, bytes: meta.bytes, ms: performance.now() - t0, noticesPageAdded: meta.noticesPageAdded }));
            });
          })();
          return;
        }
        const pg = /^report\/(page|svg)\/(\d+)$/.exec(path);
        if (pg !== null) {
          const svg = pg[1] === "svg";
          const f = lastReport === null ? null : join(lastReport.dir, `page-${pg[2]}.${svg ? "svg" : "png"}`);
          if (f === null || !existsSync(f)) return void ((res.statusCode = 404), res.end());
          res.setHeader("content-type", svg ? "image/svg+xml" : "image/png");
          return void res.end(readFileSync(f));
        }
        if (path === "report/save" && req.method === "POST") {
          if (lastReport === null) return void ((res.statusCode = 400), res.end("E_REPORT_NONE"));
          if (saveDir() === "") return void ((res.statusCode = 400), res.end("E_DEV_NO_SAVE_DIR"));
          const name = `提案書_${lastReport.issuedOn}.pdf`;
          copyFileSync(join(lastReport.dir, "out.pdf"), join(saveDir(), name));
          const digest = `sha256:${createHash("sha256").update(readFileSync(join(saveDir(), name))).digest("hex")}`;
          res.setHeader("content-type", "application/json; charset=utf-8");
          return void res.end(JSON.stringify({ saved: true, fileName: name, syncFolder: false, digest }));
        }
        if (path === "report/discard" && req.method === "POST") {
          lastReport = null;
          return void res.end();
        }
        // 持ち帰り用のレポート（本体の takeaway_save の代わり。0030）: 保存先は FINANCIA_DEV_SAVE_DIR だけ
        if (path.startsWith("takeaway/save") && req.method === "POST") {
          void (async () => {
            const body = await readBody(req);
            if (saveDir() === "") return void ((res.statusCode = 400), res.end("E_DEV_NO_SAVE_DIR"));
            if (!body.subarray(0, 15).toString("utf8").toLowerCase().startsWith("<!doctype html>")) return void ((res.statusCode = 400), res.end("E_TAKEAWAY_BODY"));
            const q = new URL(req.url ?? "", "http://localhost").searchParams;
            const on = /^\d{4}-\d{2}-\d{2}$/.test(q.get("exportedOn") ?? "") ? `_${q.get("exportedOn")}` : "";
            const name = `ライフプランの試算${on}${q.get("encrypted") === "1" ? "_パスワードつき" : ""}.html`;
            writeFileSync(join(saveDir(), name), body);
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ saved: true, fileName: name, syncFolder: false, digest: `sha256:${createHash("sha256").update(body).digest("hex")}` }));
          })();
          return;
        }
        // ヒアリングシート（本体の hearing_save・hearing_open の代わり）
        if (path.startsWith("sheets/save") && req.method === "POST") {
          void (async () => {
            const body = await readBody(req);
            if (saveDir() === "") return void ((res.statusCode = 400), res.end("E_DEV_NO_SAVE_DIR"));
            const q = new URL(req.url ?? "", "http://localhost").searchParams;
            const no = /^[A-Za-z0-9_-]{1,16}$/.test(q.get("customerNo") ?? "") ? `_${q.get("customerNo")}` : "";
            const on = /^\d{4}-\d{2}-\d{2}$/.test(q.get("exportedOn") ?? "") ? `_${q.get("exportedOn")}` : "";
            const name = `ヒアリングシート${no}${on}.xlsx`;
            writeFileSync(join(saveDir(), name), body);
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ saved: true, fileName: name, syncFolder: false, digest: `sha256:${createHash("sha256").update(body).digest("hex")}` }));
          })();
          return;
        }
        // Web のヒアリングで受け取った書類の保存（本体の hearing_document_save の代わり。0125）: FINANCIA_DEV_SAVE_DIR に書く
        if (path.startsWith("hearing/docsave") && req.method === "POST") {
          void (async () => {
            const body = await readBody(req);
            if (saveDir() === "") return void ((res.statusCode = 400), res.end("E_DEV_NO_SAVE_DIR"));
            const q = new URL(req.url ?? "", "http://localhost").searchParams;
            const name = (q.get("name") ?? "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "書類.bin";
            writeFileSync(join(saveDir(), name), body);
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ saved: true, fileName: name, syncFolder: false, digest: `sha256:${createHash("sha256").update(body).digest("hex")}` }));
          })();
          return;
        }
        if (path === "sheets/open") {
          const f = process.env.FINANCIA_DEV_OPEN_FILE || join(REPO_DIR, "hearing", "samples", "basic-1-sample.xlsx");
          res.setHeader("content-type", "application/octet-stream");
          return void res.end(readFileSync(f));
        }
        // お知らせ（本体の notices_feed・notice_local_get・notice_local_put・feedback_form_open の代わり。0087）:
        // 配信元のお知らせは FINANCIA_DEV_NOTICES（ファイルのパス。見本は app/schemas/notices.dev-sample.json）の封筒を、本体の開発用のビルドと同じく署名なしで受け付ける。
        // 手元の状態はメモリの中だけ（再起動で消える）。フォームはブラウザで開かず、開いた受付番号を記録するだけ
        const nm = /^notices\/([A-Za-z]+)$/.exec(path);
        if (nm !== null && req.method === "POST") {
          void (async () => {
            const args = JSON.parse((await readBody(req)).toString("utf8") || "{}") as { value?: unknown; code?: string };
            const json = (v: unknown) => {
              res.setHeader("content-type", "application/json; charset=utf-8");
              res.end(JSON.stringify(v));
            };
            const op = nm[1];
            if (op === "feed") {
              const f = process.env.FINANCIA_DEV_NOTICES;
              if (f === undefined || f === "" || !existsSync(f)) return json(null);
              const env = JSON.parse(readFileSync(f, "utf8")) as { format?: string; payload?: string };
              return json(env.format === "financia-notices-envelope" && typeof env.payload === "string" ? env.payload : null);
            }
            if (op === "local") return json(devNoticeLocal);
            if (op === "putLocal") {
              devNoticeLocal = args.value ?? {};
              return json(null);
            }
            if (op === "openForm") {
              if (!/^R-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(args.code ?? "")) return void ((res.statusCode = 400), res.end("E_RECEIPT"));
              console.log(`[dev] 要望のフォームを開く（受付番号 ${args.code}。開発用のサーバーでは開きません）`);
              return json(null);
            }
            res.statusCode = 404;
            res.end();
          })();
          return;
        }
        // 明細の取り込み（本体の statement_office・statement_learn・statement_open の代わり。0034）: 覚えた辞書と形はメモリの中だけ。
        // 開くは FINANCIA_DEV_OPEN_STATEMENT（カンマ区切りのパス）か、架空の明細（statement/test/fixtures）を順に返す。statement/reset で最初に戻す
        const sm = /^statement\/([a-z]+)(?:\?|$)/.exec(path);
        if (sm !== null) {
          void (async () => {
            const op = sm[1] as string;
            const json = (v: unknown) => {
              res.setHeader("content-type", "application/json; charset=utf-8");
              res.end(JSON.stringify(v));
            };
            if (op === "office") return json(devStatement.data);
            if (op === "learn" && req.method === "POST") {
              const a = JSON.parse((await readBody(req)).toString("utf8") || "{}") as { entries?: DevDictEntry[]; formats?: DevFormat[] };
              const dict = new Map(devStatement.data.dictionary.map((e) => [e.key, e]));
              for (const e of a.entries ?? []) {
                const cur = dict.get(e.key);
                if (cur === undefined || e.at > cur.at || (e.at === cur.at && e.removed === true)) dict.set(e.key, e);
              }
              const fm = new Map(devStatement.data.formats.map((f) => [`${f.kind}\u001f${f.fingerprint}`, f]));
              for (const f of a.formats ?? []) {
                const k = `${f.kind}\u001f${f.fingerprint}`;
                const cur = fm.get(k);
                if (cur === undefined || f.at >= cur.at) fm.set(k, f);
              }
              devStatement.data = { dictionary: [...dict.values()].sort((x, y) => (x.key < y.key ? -1 : 1)), formats: [...fm.values()] };
              return json(devStatement.data);
            }
            if (op === "reset") {
              devStatement.next = 0;
              return void res.end();
            }
            // 確認シートの保存（本体の statement_sheet_save の代わり）: 保存先は FINANCIA_DEV_SAVE_DIR だけ。最後に保存したシートを覚え、
            // 開く（sheetopen）は FINANCIA_DEV_OPEN_STATEMENT_SHEET のファイルか、最後に保存したシートを返す
            if (op === "sheetsave" && req.method === "POST") {
              const body = await readBody(req);
              if (body.subarray(0, 4).toString("binary") !== "PK\x03\x04") return void ((res.statusCode = 400), res.end("E_STATEMENT_SHEET_BODY"));
              const q = new URL(req.url ?? "", "http://localhost").searchParams;
              const no = /^[A-Za-z0-9_-]{1,16}$/.test(q.get("customerNo") ?? "") ? `_${q.get("customerNo")}` : "";
              const on = /^\d{4}-\d{2}-\d{2}$/.test(q.get("exportedOn") ?? "") ? `_${q.get("exportedOn")}` : "";
              const name = `明細の確認シート${no}${on}.xlsx`;
              devStatement.sheet = body;
              if (saveDir() !== "") writeFileSync(join(saveDir(), name), body);
              return json({ saved: true, fileName: name, syncFolder: false, digest: `sha256:${createHash("sha256").update(body).digest("hex")}` });
            }
            if (op === "sheetopen") {
              const f = process.env.FINANCIA_DEV_OPEN_STATEMENT_SHEET ?? "";
              const b = f !== "" && existsSync(f) ? readFileSync(f) : devStatement.sheet;
              if (b === null) return void ((res.statusCode = 204), res.end());
              res.setHeader("content-type", "application/octet-stream");
              return void res.end(b);
            }
            if (op === "open") {
              const env = process.env.FINANCIA_DEV_OPEN_STATEMENT ?? "";
              const fx = join(REPO_DIR, "statement", "test", "fixtures");
              const list = env !== "" ? env.split(",") : ["card-year-utf8bom.csv", "bank-utf8.csv", "card-statement.pdf", "app-utf8bom.csv"].map((f) => join(fx, f));
              const f = list[devStatement.next++ % list.length] as string;
              if (statSync(f).size > 10 * 1024 * 1024) return void ((res.statusCode = 400), res.end("E_IMPORT_TOO_LARGE"));
              res.setHeader("content-type", "application/octet-stream");
              return void res.end(readFileSync(f));
            }
            res.statusCode = 404;
            res.end();
          })();
          return;
        }
        // 世帯の保存（本体の store_*・recovery_key_* の代わり）: 開発用のサーバーのメモリの中だけ。暗号化もファイルへの保存もしない
        const st = /^store\/([a-zA-Z]+)$/.exec(path);
        if (st !== null && req.method === "POST") {
          void (async () => {
            const args = JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, string>;
            const r = devStoreOp(st[1] as string, args);
            res.statusCode = r.ok ? 200 : 400;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(r.ok ? JSON.stringify(r.value ?? null) : r.code);
          })();
          return;
        }
        // 事務所での共有（本体の office_* の代わり）: 開発用のサーバーのメモリの中だけ
        const of = /^office\/([a-zA-Z]+)(?:\?|$)/.exec(path);
        if (of !== null) {
          void (async () => {
            const args = req.method === "POST" ? (JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, unknown>) : Object.fromEntries(new URL(req.url ?? "", "http://x").searchParams);
            const r = devOfficeOp(of[1] as string, args);
            res.statusCode = r.ok ? 200 : 400;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(r.ok ? JSON.stringify(r.value ?? null) : r.code);
          })();
          return;
        }
        // AI接続口（本体の ai_* の代わり）: 開発用のサーバーのメモリの中だけ。本物の受け口は開けない
        const ai = /^ai\/([a-zA-Z]+)(?:\?|$)/.exec(path);
        if (ai !== null) {
          void (async () => {
            const args = req.method === "POST" ? (JSON.parse((await readBody(req)).toString("utf8") || "{}") as Record<string, unknown>) : Object.fromEntries(new URL(req.url ?? "", "http://x").searchParams);
            const r = devAiOp(ai[1] as string, args);
            res.statusCode = r.ok ? 200 : 400;
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(r.ok ? JSON.stringify(r.value ?? null) : r.code);
          })();
          return;
        }
        void next;
        // 画面の自己確認（#selfcheck）の待ち
        const sl = /^sleep\/(\d+)$/.exec(path);
        if (sl !== null) {
          setTimeout(() => res.end(), Math.min(Number(sl[1]), 10_000));
          return;
        }
        // 画面の自己確認（#selfcheck）の区切り（画面を撮る合図）
        if (path.startsWith("stage/")) {
          console.log(`[stage] ${decodeURIComponent(path.slice(6))}`);
          res.end();
          return;
        }
        // 画面の自己確認（#selfcheck）の結果を受け取る。FINANCIA_REPORT があればそのファイルに書く
        if (path === "report" && req.method === "POST") {
          let body = "";
          req.on("data", (c: Buffer) => (body += c.toString("utf8")));
          req.on("end", () => {
            const out = process.env.FINANCIA_REPORT;
            if (out !== undefined && out !== "") writeFileSync(out, body);
            else console.log(body);
            res.end();
          });
          return;
        }
        const send = (body: string) => {
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(body);
        };
        if (path === "households") return send(JSON.stringify(readdirSync(households).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort()));
        if (path === "packs") return send(`[${readdirSync(regulation).filter((f) => f.endsWith(".json")).sort().map((f) => readFileSync(join(regulation, f), "utf8")).join(",")}]`);
        const m = /^households\/([A-Za-z0-9]+)$/.exec(path);
        if (m !== null) return send(readFileSync(join(households, `${m[1]}.json`), "utf8"));
        res.statusCode = 404;
        res.end();
      });
    },
  };
}

export default defineConfig({
  clearScreen: false,
  plugins: [devHost(), devHearingFormCsp()],
  // hearing/・report/・statement/・xlsx/ の部品と同梱の拡張の束（npm の依存なしの TypeScript）を画面から読む
  // 拡張の束（sdk/examples/extensions/。同梱の公式の拡張の正本）が読む @lifeplan/sdk を、正本の report/src/sdk.ts につなぐ（0114 の9）
  resolve: { alias: { "@lifeplan/sdk": join(REPO_DIR, "report", "src", "sdk.ts") } },
  server: { port: 1420, strictPort: true, fs: { allow: [APP_DIR, join(REPO_DIR, "hearing"), join(REPO_DIR, "report"), join(REPO_DIR, "sdk", "examples", "extensions"), join(REPO_DIR, "statement"), join(REPO_DIR, "xlsx", "src"), join(REPO_DIR, "engine", "src")] } },
  oxc: { jsx: { runtime: "automatic", importSource: "preact" } },
  build: {
    target: "es2022",
    // 0016: CSP（img-src・font-src は 'self' だけ）の下で data: の URI を作らない
    assetsInlineLimit: 0,
    // 計算エンジン（public/engine/engine.js）は大きいが、まとめずにそのまま写す
    chunkSizeWarningLimit: 1024,
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    environment: "node",
    testTimeout: 60_000,
  },
});
