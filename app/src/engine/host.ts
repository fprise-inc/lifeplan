// 本体（Rust）と画面側のエンジンへの入口
import { invoke } from "@tauri-apps/api/core";
import type { DictionaryEntry, LearnedFormat } from "../../../statement/src/index.ts";
import { forEngine } from "./moneyRows.ts";
import { isEngineError, type EngineError, type EngineRequest, type FullResult, type PreviewResult } from "./types.ts";
import type { OfficeTextEntry, TextOp } from "../workspace/office/customTexts.ts";

/** 画面側のエンジンのセッション（engine/src/engine/run.ts の Session。JSON の文字列で受け渡す） */
export interface WebSession {
  set(slotsJson: string): string;
  compute(idsJson?: string, optionsJson?: string): string;
  results(idsJson?: string): string;
  status(): string;
  slide(slotsJson: string, focusId: string): string;
  release(optionsJson?: string): string;
}

/** まとめた JS（public/engine/engine.js）がグローバルに置くもの */
export interface WebEngine {
  createSession(packsJson: string, optionsJson?: string): WebSession;
  run(requestJson: string, packsJson: string, optionsJson?: string): string;
  runBatch(requestsJson: string, packsJson: string, optionsJson?: string): string;
}

export function webEngine(): WebEngine | null {
  const e = (globalThis as { FinanciaEngine?: WebEngine }).FinanciaEngine;
  return e !== undefined && typeof e.createSession === "function" ? e : null;
}

export interface SlotRequest {
  id: string;
  rev: number;
  request: string;
}

export interface ComputeResponse {
  /** 本体の中での時間（ミリ秒） */
  ms: number;
  slots: Record<string, { rev: number; ms: number; result: PreviewResult | EngineError }>;
}

/** 提案書の PDF を作った結果（PDF のバイトは本体の中に置き、画面には渡さない） */
export interface RenderInfo {
  pages: number;
  /** ページの大きさ（pt。幅・高さ） */
  sizes: [number, number][];
  bytes: number;
  /** 本体の中で PDF を作った時間（ミリ秒） */
  ms: number;
  noticesPageAdded: boolean;
}

/** 平文の書き出しの出口（本体）で保存した結果。保存しなかったときは saved: false */
export interface SaveOutcome {
  saved: boolean;
  fileName: string | null;
  syncFolder: boolean;
  digest: string | null;
}

/** 提案書の PDF（0009）: 刻印・必須の記載は本体が決める。保存先は本体が OS のダイアログで FP に選ばせる */
export interface ReportHost {
  /** 帳票の入力（JSON）から PDF を作る。宛名は出力の PDF に重ねるだけ（保存しない） */
  render(inputJson: string, addressee: string | null): Promise<RenderInfo>;
  /** 見本の1ページ（0 から）の PNG（ページの縮小一覧。scale は 1pt あたりの画素） */
  page(index: number, scale: number): Promise<Blob>;
  /** 見本の1ページ（0 から）の SVG の文字列（本体の見本。拡大してもぼやけない） */
  pageSvg(index: number): Promise<string>;
  save(): Promise<SaveOutcome>;
  /** 作った PDF を本体から捨てる（画面を離れたとき） */
  discard(): Promise<void>;
}

/** ヒアリングシート（0018）の保存と、記入済みのシートを選んで読むこと */
export interface SheetHost {
  save(bytes: Uint8Array, meta: { customerNo: string; exportedOn: string; prefilled: boolean }): Promise<SaveOutcome>;
  /** 選ばなかったときは null */
  open(): Promise<Uint8Array | null>;
}

/** 事務所で覚えた明細の辞書と形（0034。本体の household-store の StatementOffice。店の鍵と項目・列の対応付けだけで、金額・日付は持たない） */
export interface StatementOfficeData {
  dictionary: DictionaryEntry[];
  formats: (LearnedFormat & { by?: string })[];
}

/** 明細の取り込み（0034）: 明細のファイルを開く・覚えた辞書と形の読み書き。読む・仕分けるは画面の statement/ の部品が PC の中で行う */
export interface StatementHost {
  /** 覚えた辞書と形（事務所で共有しているときは全員の分を合わせたもの） */
  office(): Promise<StatementOfficeData>;
  /** FP が直した結果を覚える（直した人は本体が決める）。合わせた後の辞書と形を返す */
  learn(entries: readonly DictionaryEntry[], formats: readonly LearnedFormat[]): Promise<StatementOfficeData>;
  /** 本体の開くダイアログで選んだ明細のファイルの中身（10MB まで。パス・ファイル名は渡らない）。選ばなかったときは null */
  open(): Promise<Uint8Array | null>;
  /** 確認シート（画面の statement/ の部品が作った .xlsx）を、本体の平文の書き出しの出口で保存する（0034 の9） */
  saveSheet(bytes: Uint8Array, meta: { customerNo: string; exportedOn: string }): Promise<SaveOutcome>;
  /** お客さまが印を付けた確認シートを選んで、中身を返す（10MB まで。パス・ファイル名は渡らない）。選ばなかったときは null */
  openSheet(): Promise<Uint8Array | null>;
}

/** 持ち帰り用のレポート（0030）の保存: 画面が作った HTML のバイト列を、本体の平文の書き出しの出口で保存する */
export interface TakeawayHost {
  /** meta.encrypted はパスワードを付けたか（本体がファイルの見出しと突き合わせて記録する） */
  save(bytes: Uint8Array, meta: { exportedOn: string; encrypted: boolean }): Promise<SaveOutcome>;
}

// ---- 顧客番号の区分と通し番号・見本の棚（0033。本体の numbering） ----

/** 区分（記号は英大文字1〜2字） */
export interface Category {
  code: string;
  name: string;
}

/** 区分の設定（本体の CategorySettings）。decided が false なら、初めて世帯の一覧を使うときに「区分を使いますか？」と聞く。決めた後で空なら区分を使わない */
export interface CategorySettings {
  categories: Category[];
  decided: boolean;
}

/** 区分の設定の変更の1行（from は今の記号。新しく足す区分は無し） */
export interface CategoryEdit {
  from?: string;
  code: string;
  name: string;
}

/** 見本の中身の説明 */
export interface SampleInfo {
  /** 見本番号（家族の形-年代-順番。例 3-4-01） */
  no: string;
  name: string;
  traits: string[];
}

/** 見本を作る・登録するときの指定 */
export interface SampleRequest {
  family: number;
  age: number;
  name: string;
  traits: string[];
}

/** 一覧の札・開いた世帯の番号の中身（本体の Label） */
export interface NumberLabel {
  category?: string;
  serial?: number;
  branch?: string;
  sample?: SampleInfo;
}

/** 保存の状態（本体の household-store の Status） */
export interface StoreStatus {
  state: "ready" | "needsRecovery";
  firstRun: boolean;
  recoveryAcknowledged: boolean;
  recoveryVerifiedAt: string | null;
  lastOpened: string | null;
  deletionsPending: number;
  deletionsCompleted: number;
}

/** 今その世帯を開いている他のメンバー（事務所で共有しているとき。0023 の7） */
export interface PresenceView {
  name: string;
  /** 開いた日時（ISO 8601） */
  since: string;
}

/** 保存した世帯の一覧の1件（表示用の顧客番号と構成の要約だけ。氏名は持たない。0012）。番号の中身（区分・通し番号・枝番・見本）は 0033 */
export interface StoredHousehold extends NumberLabel {
  id: string;
  customerNo: string;
  summary: string;
  createdAt: string;
  updatedAt: string;
  /** 最後に直した人の表示名（事務所で共有しているときだけ） */
  updatedBy: string | null;
  /** 今開いている他のメンバー */
  openBy: PresenceView[];
  /** 同期サービスの衝突の写しの数 */
  forks: number;
}

/** 開いた世帯（本文は JSON の文字列。0011 の2） */
export interface StoredOpened extends NumberLabel {
  id: string;
  customerNo: string;
  body: string;
  readOnly: boolean;
  generation: number;
  /** この改訂を保存した人（事務所で共有しているとき） */
  savedBy: string | null;
  /** 今この世帯を開いている他のメンバー */
  othersOpen: PresenceView[];
}

/** 分岐を選ぶ画面の材料（0023 の7） */
export interface ForkInfo {
  savedConflict: boolean;
  theirsSavedAt: string | null;
  theirsBy: string | null;
  theirsGeneration: number;
  oursGeneration: number | null;
  syncCopies: number;
  /** 1人で複数の PC の同期フォルダ（相手は人ではなく、もう1台の PC。0024） */
  personal: boolean;
}

// ---- 事務所での共有（0023）。共有フォルダは本体のダイアログで選ばせ、画面にはパスも鍵も渡らない ----

export interface OfficeMember {
  memberId: string;
  name: string;
  fingerprint: string;
  joinedAt: string;
  approvedBy: string | null;
  role: string;
  isMe: boolean;
  /** 復元キーで名簿に自分を足したメンバー（承認した人はいない。0023 の5） */
  viaRecovery: boolean;
}

/** ほかのメンバーへの知らせ（今は「復元キーで○○さんが加わりました」だけ） */
export interface OfficeNotice {
  kind: "recoveryJoin";
  name: string;
  at: string;
}

/** 参加の申請（承認する人には指紋を出さない。指紋は本人から別の経路で聞いて入力する） */
export interface OfficeRequest {
  requestId: string;
  name: string;
  requestedAt: string;
}

export interface OfficeStatus {
  state: "off" | "pending" | "member" | "removed" | "unavailable";
  /** 使い方: 1人で複数の PC の同期フォルダ（0024）／事務所での共有（0023）。off のときは null */
  usage: "personal" | "office" | null;
  problem: string | null;
  myName: string | null;
  myFingerprint: string | null;
  members: OfficeMember[];
  removed: { name: string; removedAt: string; removedBy: string | null }[];
  requests: OfficeRequest[];
  officeCode: string | null;
  syncFolder: boolean;
  localHouseholds: number;
  recoveryAcknowledged: boolean;
  recoveryAcknowledgedBy: string | null;
  recoveryAcknowledgedAt: string | null;
  /** 復元キーで実際に開けることを確かめた日時（今のキーについて） */
  recoveryVerifiedAt: string | null;
  /** 事務所の復元キーを保管するまで、承認・外すを止めている（世帯の閲覧・編集は止めない。0023 の5） */
  recoveryRequired: boolean;
  /** まだ見ていない知らせ */
  notices: OfficeNotice[];
}

/**
 * 保存先と同期の知らせ（0024。パス・鍵は入らない）。画面の上の帯の「知らせ」にまとめられる形。
 * kind: needsRecovery・recoveryNotKept・unavailable（code に理由）・closed・removed・pending・recoveryJoin（name・at）・
 * joinRequest（count）・localHouseholds（count）・syncCopies（count）
 */
/** 機能を有効にするコード（0110）の1つ。本体が署名を確かめた中身（この版のアプリが知っている機能だけ）。コードの文字列は返さない */
export interface FeatureCodeView {
  /** 外すときに指す短い印 */
  ref: string;
  /** コードの番号 */
  id: string;
  /** FP の表示名（「○○さん向けに有効」） */
  name: string;
  /** 有効にする機能の名前（例: combinedBs） */
  features: string[];
  issued: string;
  /** 期限（YYYY-MM-DD。この日の終わりまで。日本の日付）。期限なしのコードは null */
  expires: string | null;
  /** 期限内・期限まで30日以内（更新の知らせ）・切れた・提供元が止めた（止めた一覧に載っている。外れたら戻る） */
  state: "active" | "expiring" | "expired" | "revoked";
  /** 期限までの日数（期限の日は 0。切れたら負。期限なしのコードは null） */
  daysLeft: number | null;
  /** 切れた・止めたの知らせを出すか（本体が決める。分かった日から7日の内で、閉じていないとき。使えるコードは false） */
  notice: boolean;
  /** 切れた・止めたと分かった日（日本の日付。使えるコードは null） */
  noticeSince: string | null;
}

/** 止めた一覧（0110 の追記）の確かめの様子。中身の一覧は返さない */
export interface FeatureCheckView {
  /** 最後に取りに行った日時（UTC） */
  checkedAt: string | null;
  /** 最後に取れた日時（UTC） */
  okAt: string | null;
  /** 最後に取りに行った結果（一度も取りに行っていなければ null） */
  result: "ok" | "offline" | "rejected" | null;
  /** 今使っている一覧の通し番号（一度も取れていなければ null） */
  serial: number | null;
  listed: number;
}

/** AIから届いた、機能を有効にするコードの候補（0015 の追記の2段目。入れる前と後。コードの文字列は返さない） */
export interface FeatureCandidateView {
  id: string;
  receivedAt: string;
  /** AIのアプリが名乗った名前（自己申告） */
  connector: string | null;
  /** 入れられるか */
  ok: boolean;
  /** 入れられないときの符号（E_FEATURE_CODE_…） */
  error: string | null;
  name: string | null;
  features: string[];
  expires: string | null;
  before: string[];
  after: string[];
  /** 入れると外れる今のコードの数 */
  replaces: number;
}

/** 機能を有効にするコードの状態（0110。本体が確かめる。画面は出すだけ） */
export interface FeatureStatus {
  /** 判定に使った今日（日本の日付） */
  today: string;
  /** 今使える機能（期限内のコードのどれかに入っている機能） */
  active: string[];
  /** 入れたコード（期限の遅い順） */
  codes: FeatureCodeView[];
  /** 確かめられなかったコード（鍵を差し替えた後の古いコードなど。外せる） */
  invalid: { ref: string; error: string }[];
  /** 止めた一覧の確かめの様子（古い本体・開発用のサーバーの代わりでは無いことがある） */
  check?: FeatureCheckView;
  /** AIから届いた、コードを入れる候補（承認待ち） */
  candidates?: FeatureCandidateView[];
}

export interface StorageNotice {
  kind: string;
  level: "info" | "warn" | "alert";
  /** どの保存先の知らせか（この PC の中・1人で複数の PC の同期フォルダ・事務所での共有） */
  scope: "local" | "personal" | "office";
  count: number | null;
  name: string | null;
  at: string | null;
  code: string | null;
}

export interface OfficeHost {
  status(): Promise<OfficeStatus>;
  /** 共有を始める（本体がフォルダのダイアログを出す。選ばなかったら null） */
  start(name: string): Promise<OfficeStatus | null>;
  /** 参加の申請を置く（本体がフォルダのダイアログを出す。選ばなかったら null） */
  join(name: string): Promise<OfficeStatus | null>;
  /** 参加の申請を取り下げる・外された設定を片付ける */
  cancel(): Promise<OfficeStatus>;
  /** 承認（fingerprint は新しいメンバーから別の経路で聞いて入力した指紋） */
  approve(requestId: string, fingerprint: string): Promise<OfficeStatus>;
  reject(requestId: string): Promise<OfficeStatus>;
  /** 外す（confirm は外す人の表示名） */
  remove(memberId: string, confirm: string): Promise<OfficeStatus>;
  /** このPCの中の世帯を共有フォルダへ移す（移した数） */
  moveLocal(): Promise<number>;
  /** 全員の PC が使えなくなったとき: 本体がフォルダのダイアログを出し、事務所の復元キーで名簿に自分を足す（選ばなかったら null） */
  recover(name: string, key: string): Promise<OfficeStatus | null>;
  /** 事務所の共有をやめる（最後の1人だけ。confirm は自分の表示名）。世帯をこの PC の中へ移す */
  end(confirm: string): Promise<OfficeStatus>;
  /** 知らせを見た（この PC では次から出さない） */
  dismissNotices(): Promise<OfficeStatus>;
  /** 事務所の既定値（0073。事務所データの JSON のオブジェクト。形は office/settings.ts の readOfficeSettings で確かめる） */
  defaults(): Promise<unknown>;
  /** 事務所の既定値を置き換える */
  putDefaults(value: Record<string, unknown>): Promise<void>;
  /** 機能を有効にするコード（0110）の状態。本物か・期限内かは本体が確かめる */
  featureStatus(): Promise<FeatureStatus>;
  /** コードを入れる（本物で期限内のものだけ。断るときは E_FEATURE_CODE_… の符号） */
  addFeatureCode(code: string): Promise<FeatureStatus>;
  /** コードを外す（ref は状態の印） */
  removeFeatureCode(ref: string): Promise<FeatureStatus>;
  /** 期限の切れた・止めたコードの知らせを閉じる（ref は状態の印。コードは外さない） */
  dismissFeatureNotice(ref: string): Promise<FeatureStatus>;
  /** 止めた一覧を今すぐ確かめる（結果は少し後の状態に出る） */
  checkFeatureCodes(): Promise<FeatureStatus>;
  /** AIから届いたコードの候補を入れる（accept）か捨てる */
  decideFeatureCandidate(id: string, accept: boolean): Promise<FeatureStatus>;
  /** 保存先を同期フォルダにする（1人で複数の PC。0024）。本体がフォルダのダイアログを出す（選ばなかったら null）。name はこの PC の呼び名 */
  syncStart(name: string): Promise<OfficeStatus | null>;
  /** 2台目の PC: すでに使っている同期フォルダを、本体のダイアログで選び、復元キーで開く（選ばなかったら null） */
  syncOpen(name: string, key: string): Promise<OfficeStatus | null>;
  /** 保存先をこの PC の中へ戻す（confirm はこの PC の呼び名） */
  syncEnd(confirm: string): Promise<OfficeStatus>;
  /** 保存先と同期の知らせ */
  notices(): Promise<StorageNotice[]>;
}

/**
 * 世帯ファイルの保存（0011・0013）。暗号化・鍵・ファイルの読み書きはすべて本体が行い、画面はパスを渡さない・受け取らない（0016 の1）。
 * 世帯は本体が振る内部ID だけで指す
 */
export interface StoreHost {
  status(): Promise<StoreStatus>;
  /** 顧客の世帯の一覧（見本は入れない） */
  list(): Promise<StoredHousehold[]>;
  /** 新しい世帯（opts.category は区分の記号。無ければ見込み客（区分を使わないときは通し番号だけ）。opts.sample があれば見本として作る。0033） */
  create(body: string, summary: string, opts?: { category?: string; sample?: SampleRequest }): Promise<StoredOpened>;
  open(id: string): Promise<StoredOpened>;
  save(id: string, body: string, summary: string): Promise<{ generation: number; savedAt: string }>;
  rename(id: string, customerNo: string): Promise<{ customerNo: string; duplicate: boolean }>;
  /** 完全削除（confirm は FP が打った顧客番号） */
  remove(id: string, confirm: string): Promise<void>;
  /** 復元キー（72文字）。表示のためだけに受け取り、どこにも保存しない */
  recoveryKey(): Promise<string>;
  acknowledgeRecovery(): Promise<StoreStatus>;
  testRecoveryKey(key: string): Promise<StoreStatus>;
  restoreWithRecoveryKey(key: string): Promise<StoreStatus>;
  /** アプリを閉じる前の保存が済んだことを本体に知らせる（本体が閉じる） */
  closeReady(): Promise<void>;
  /** アプリを閉じるのを待ってもらう・やめる（保存できていない変更をどうするか FP に聞くとき。待つ時間の上限で閉じない） */
  closeCancel(): Promise<void>;
  /** 分岐を選ぶ画面の材料（0023 の7） */
  forkInfo(id: string): Promise<ForkInfo>;
  /** 分岐を選ぶ（keepOurs: こちらで上書き／false: 相手の内容を残す）。開き直した世帯を返す */
  resolveFork(id: string, keepOurs: boolean): Promise<StoredOpened>;
  /** 同期サービスの衝突の写しを片付ける（adopt: 一番新しい写しを今の内容にする） */
  resolveSyncCopies(id: string, adopt: boolean): Promise<void>;
  /** 保存した世帯から離れた（見本を開いた・削除した）: 事務所で共有しているときの自分の開いている印を消す */
  leave(): Promise<void>;
  /** 開発用のビルドで、鍵を OS の保管庫ではなくファイルに置いているか（画面に小さな札を出す） */
  devFileKeys(): Promise<boolean>;
  // ---- 顧客番号の区分と通し番号・見本の棚（0033） ----
  /** 見本の棚（FP が作った見本） */
  listSamples(): Promise<StoredHousehold[]>;
  /** 区分を変える（体系の番号は記号だけが変わる） */
  setCategory(id: string, category: string): Promise<{ customerNo: string; duplicate: boolean }>;
  /** 自由な番号の世帯に、区分の記号＋新しい通し番号を付ける */
  assignSerial(id: string): Promise<{ customerNo: string; duplicate: boolean }>;
  /** 顧客の世帯を見本の棚へ移す（「中身は架空です」を確かめた後） */
  makeSample(id: string, sample: SampleRequest): Promise<{ customerNo: string; duplicate: boolean }>;
  updateSample(id: string, name: string, traits: string[]): Promise<void>;
  categories(): Promise<CategorySettings>;
  /** 区分の設定を変える（空は「区分を使わない」。初めの「区分を使いますか？」の答えもこれで書く） */
  setCategories(edits: CategoryEdit[]): Promise<CategorySettings>;
}

// ---- AI接続口（0014・0015）。画面には鍵もパスも渡らない（接続の設定の文面は場所を伏せたもの） ----

/** 共有中の世帯（仮名・顧客番号・残り時間） */
export interface AiShareStatus {
  shareId: string;
  alias: string;
  householdId: string;
  customerNumber: string | null;
  expiresInSec: number;
}

/** 接続の設定の文面（接続口の場所は `<接続口の場所>` に伏せてある。本物は copySetup でクリップボードへ） */
export interface AiSetupGuide {
  client: string;
  title: string;
  text: string;
}

export interface AiStatus {
  /** 事務所全体の設定（既定はオフ） */
  enabled: boolean;
  /** アプリ本体の受け口が開いているか */
  running: boolean;
  problem: string | null;
  storeReady: boolean;
  connector: { found: boolean; version: string | null; versionMatches: boolean };
  shares: AiShareStatus[];
  setup: AiSetupGuide[];
  /** 共有の期限の選択肢（分） */
  durations: number[];
  dev: boolean;
  /** AIから届いた、機能を有効にするコードの候補の数（承認待ち。中身は featureStatus で読む） */
  featureCodeCandidates?: number;
}

export type AiConsentDecision = "given" | "refused" | "withdrawn";
export type AiConsentMethod = "paper" | "inPerson" | "email" | "hearingSheet" | "other";

/** 同意の記録の1行（0014 の2） */
export interface AiConsentRecord {
  id: string;
  kind: "purpose" | "externalAi" | "familyInfo";
  decision: AiConsentDecision;
  obtainedOn: string;
  method: AiConsentMethod;
  explanationRef?: string;
  externalAi?: { company: string; country: string; noTrainingConfirmed: boolean };
  scope?: string;
  fpConfirmed: boolean;
  recordedAt: string;
  origin: "thisOffice" | "previousOffice";
}

export interface AiReadEntry {
  firstAt: string;
  lastAt: string;
  count: number;
  tool: string;
  fields: string[];
  digest: string;
  /** 観測できた呼び出し元（参考情報。認証ではない。実行ファイルはファイル名だけ） */
  caller: { connectorPid: number | null; connectorExe: string | null; parentExe: string | null; mcpClientDeclared: string | null };
}

/** AIに渡した記録の1件（0014 の3。共有1つが1件） */
export interface AiShareRecord {
  id: string;
  kind: string;
  shareId: string;
  grantedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endReason: "revoked" | "expired" | "appClosed" | "consentWithdrawn" | null;
  scope: string;
  allowlistVersion: string;
  fields: string[];
  householdRevision: string;
  destinationDeclared: string;
  consentAtGrant: { state: string; recordId: string | null; warned: boolean };
  reads: AiReadEntry[];
  proposals: { candidateId: string; at: string }[];
}

export interface AiProposedDiff {
  id: string;
  target: { object: string } | { plan: "assumptions" };
  item: string;
  op: "set";
  value: unknown;
  note: string | null;
}

/** AIからの候補（承認待ち・保存した・捨てた） */
export interface AiCandidate {
  id: string;
  source: "ai";
  shareId: string;
  receivedAt: string;
  /** AIが書いた文章（指示ではない。文字のまま出す） */
  title: string;
  summary: string;
  diffs: AiProposedDiff[];
  origin: { kind: "ai"; connector: string | null };
  status: "pending" | "accepted" | "rejected";
  decidedAt: string | null;
  decidedBy: string | null;
  planId: string | null;
}

/** 世帯の「同意とAIの記録」 */
export interface AiHouseholdView {
  consentState: "none" | AiConsentDecision;
  consents: AiConsentRecord[];
  explanation: string;
  explanationRef: string;
  share: AiShareStatus | null;
  records: AiShareRecord[];
  candidates: AiCandidate[];
  allowlistVersion: string;
  fields: string[];
  saved: boolean;
}

export interface AiConsentInput {
  decision: AiConsentDecision;
  obtainedOn: string;
  method: AiConsentMethod;
  company: string;
  country: string;
  noTrainingConfirmed: boolean;
  fpConfirmed: boolean;
}

/** AI接続口（本体の命令。世帯は内部IDだけで指す） */
export interface AiHost {
  status(): Promise<AiStatus>;
  setEnabled(enabled: boolean): Promise<AiStatus>;
  /** 接続の設定の文面（本物の場所入り）を本体が OS のクリップボードへ写す */
  copySetup(client: string): Promise<boolean>;
  household(id: string): Promise<AiHouseholdView>;
  recordConsent(id: string, input: AiConsentInput): Promise<AiHouseholdView>;
  startShare(id: string, minutes: number, destination: string): Promise<AiHouseholdView>;
  stopShare(id: string): Promise<AiHouseholdView>;
  /** AIの候補についての FP の判断（accept のときは保存したプランの ID） */
  decide(id: string, candidate: string, accept: boolean, plan: string | null): Promise<AiHouseholdView>;
}

/** 本体の命令（0016 の1: 用途ごとの命令だけ） */
/** お知らせの一覧（0087）: 配信元のお知らせを読む口（1か所）・手元の既読の印と受付番号・要望のフォームを開く */
export interface NoticesHost {
  /** 配信元のお知らせ（本体が署名を確かめた一覧の JSON。無ければ null。今は通信しないので、開発用のビルドの見本だけ） */
  feed(): Promise<string | null>;
  /** 手元の状態（既読の印と受付番号。この PC のアプリのデータ） */
  local(): Promise<unknown>;
  putLocal(value: unknown): Promise<void>;
  /** 要望・不具合のフォームを既定のブラウザで開く（受付番号だけを渡す。版と OS は本体が入れる） */
  openForm(code: string): Promise<void>;
  /** 受付番号を写す（クリップボード。写せたら true） */
  copy(code: string): Promise<boolean>;
}

/** カスタム層（0016 の3・4・6。2026-11-02 の追記）の説明の文の差し替え: 本体が確かめた状態。パスはホームを ~ にした表示だけ */
export interface CustomIssue {
  /** 何行目か（0 から。ファイル全体のときは null） */
  row: number | null;
  id: string | null;
  code: string;
  /** FP 向けの文 */
  message: string;
}
export interface CustomRowText {
  do: TextOp;
  text: string | null;
}
/** 承認の画面の1行（公式の文／今の事務所の文／新しい文） */
export interface CustomRowDiff {
  id: string;
  where: string;
  audience: string | null;
  official: string | null;
  current: CustomRowText | null;
  next: CustomRowText | null;
  changed: boolean;
  /** 説明の一覧に無い（使われていない行） */
  unused: boolean;
}
/** アプリの更新で公式の文が変わった行 */
export interface CustomUpdateRow {
  id: string;
  nowId: string;
  where: string;
  /** 承認したときの公式の文（分かるときだけ） */
  before: string | null;
  official: string;
  office: CustomRowText;
  /** 確かめるまで事務所の文を止めている */
  stopped: boolean;
  reason: "meaning" | "vars" | "op" | null;
}
export interface CustomTextsStatus {
  /** カスタム層の場所の表示（ホームは ~） */
  dir: string;
  isDefaultDir: boolean;
  folderExists: boolean;
  file: "none" | "present" | "unreadable";
  /** 今のファイルの指紋（無ければ "none"）。承認・承認しないときに渡す */
  fingerprint: string;
  state: "none" | "approved" | "pending" | "declined";
  errors: CustomIssue[];
  warnings: CustomIssue[];
  unused: string[];
  approved: { fingerprint: string; approvedAt: number } | null;
  /** 承認の台帳を確かめられなかった（承認を無効にした） */
  ledgerReset: boolean;
  /** 承認した中身が保存庫に無い・指紋が合わない */
  approvedMissing: boolean;
  rows: CustomRowDiff[];
  updates: CustomUpdateRow[];
  /** 画面に当てる事務所の文（承認した中身から作った物だけ） */
  effective: OfficeTextEntry[];
  /** 書き換えられる文の数 */
  catalogSize: number;
}
/** カスタム層の命令（読み書き・検査・指紋・承認は本体。画面からパスは渡さない） */
export interface CustomHost {
  status(): Promise<CustomTextsStatus>;
  /** 承認待ちの中身を承認する（fingerprint は見せた状態の指紋。その後に変わっていたら E_CUSTOM_CHANGED） */
  approve(fingerprint: string): Promise<CustomTextsStatus>;
  /** 承認しない（前に承認した文のまま） */
  decline(fingerprint: string): Promise<CustomTextsStatus>;
  /** 事務所の文を全部やめて公式の文に戻す（ファイルは消さない） */
  revert(): Promise<CustomTextsStatus>;
  /** 更新で公式の文が変わった行: keep なら「このまま使う」、false なら行を外して公式の文に戻す（どちらもその場で承認） */
  rows(ids: string[], keep: boolean): Promise<CustomTextsStatus>;
  /** 確かめられなかった台帳を作り直す */
  resetLedger(): Promise<CustomTextsStatus>;
  /** カスタム層の場所を本体のダイアログで選ぶ（選ばなかったら null） */
  chooseDir(): Promise<CustomTextsStatus | null>;
  /** 場所を既定に戻す */
  resetDir(): Promise<CustomTextsStatus>;
  /** フォルダと settings/ を作る */
  createDir(): Promise<CustomTextsStatus>;
}

export interface HostApi {
  readonly kind: "tauri" | "browser-dev";
  /** 制度データ・マスタのパック（JSON の配列の文字列） */
  packs(): Promise<string>;
  listHouseholds(): Promise<string[]>;
  openHousehold(id: string): Promise<EngineRequest>;
  /** 正の計算（表示の形） */
  compute(slots: SlotRequest[]): Promise<ComputeResponse>;
  /** 根拠の記録「全部」での計算 */
  evidence(requestJson: string): Promise<FullResult | EngineError>;
  report: ReportHost;
  sheets: SheetHost;
  takeaway: TakeawayHost;
  store: StoreHost;
  ai: AiHost;
  office: OfficeHost;
  statements: StatementHost;
  notices: NoticesHost;
  /** カスタム層（無い画面〔テストの代わりの本体など〕では、事務所の文を当てない） */
  custom?: CustomHost;
}

const bytesOf = (b: ArrayBuffer | Uint8Array | number[]): Uint8Array => (b instanceof Uint8Array ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : Uint8Array.from(b));

export function tauriHost(): HostApi {
  return {
    kind: "tauri",
    custom: {
      status: () => invoke<CustomTextsStatus>("custom_texts_status"),
      approve: (fingerprint) => invoke<CustomTextsStatus>("custom_texts_approve", { fingerprint }),
      decline: (fingerprint) => invoke<CustomTextsStatus>("custom_texts_decline", { fingerprint }),
      revert: () => invoke<CustomTextsStatus>("custom_texts_revert"),
      rows: (ids, keep) => invoke<CustomTextsStatus>("custom_texts_rows", { ids, keep }),
      resetLedger: () => invoke<CustomTextsStatus>("custom_ledger_reset"),
      chooseDir: () => invoke<CustomTextsStatus | null>("custom_dir_choose"),
      resetDir: () => invoke<CustomTextsStatus>("custom_dir_reset"),
      createDir: () => invoke<CustomTextsStatus>("custom_dir_create"),
    },
    packs: async () => JSON.stringify(await invoke<unknown[]>("engine_packs")),
    listHouseholds: () => invoke<string[]>("list_households"),
    openHousehold: (id) => invoke<EngineRequest>("open_household", { id }),
    compute: (slots) => invoke<ComputeResponse>("compute", { slots }),
    evidence: (request) => invoke<FullResult | EngineError>("evidence", { request }),
    report: {
      render: (input, addressee) => invoke<RenderInfo>("proposal_render", { input, addressee }),
      page: async (page, scale) => new Blob([bytesOf(await invoke<ArrayBuffer>("proposal_page", { page, scale })) as Uint8Array<ArrayBuffer>], { type: "image/png" }),
      pageSvg: async (page) => new TextDecoder().decode(bytesOf(await invoke<ArrayBuffer>("proposal_page", { page, scale: 1, format: "svg" }))),
      save: () => invoke<SaveOutcome>("proposal_save"),
      discard: () => invoke<void>("proposal_discard"),
    },
    takeaway: {
      save: (bytes, m) => invoke<SaveOutcome>("takeaway_save", bytes, { headers: { "x-exported-on": m.exportedOn, "x-encrypted": m.encrypted ? "1" : "0" } }),
    },
    store: {
      status: () => invoke<StoreStatus>("store_status"),
      list: () => invoke<StoredHousehold[]>("store_list"),
      create: (body, summary, opts) => invoke<StoredOpened>("store_create", { body, summary, category: opts?.category ?? null, sample: opts?.sample ?? null }),
      open: (id) => invoke<StoredOpened>("store_open", { id }),
      save: (id, body, summary) => invoke<{ generation: number; savedAt: string }>("store_save", { id, body, summary }),
      rename: (id, customerNo) => invoke<{ customerNo: string; duplicate: boolean }>("store_rename", { id, customerNo }),
      remove: (id, confirm) => invoke<void>("store_delete", { id, confirm }),
      recoveryKey: () => invoke<string>("recovery_key_show"),
      acknowledgeRecovery: () => invoke<StoreStatus>("recovery_key_acknowledge"),
      testRecoveryKey: (key) => invoke<StoreStatus>("recovery_key_test", { key }),
      restoreWithRecoveryKey: (key) => invoke<StoreStatus>("recovery_key_restore", { key }),
      closeReady: () => invoke<void>("app_close_ready"),
      closeCancel: () => invoke<void>("app_close_cancel"),
      forkInfo: (id) => invoke<ForkInfo>("store_fork_info", { id }),
      resolveFork: (id, keepOurs) => invoke<StoredOpened>("store_fork_resolve", { id, keepOurs }),
      resolveSyncCopies: (id, adopt) => invoke<void>("store_sync_copies_resolve", { id, adopt }),
      leave: () => invoke<void>("store_leave"),
      devFileKeys: () => invoke<boolean>("store_keystore"),
      listSamples: () => invoke<StoredHousehold[]>("store_list_samples"),
      setCategory: (id, category) => invoke<{ customerNo: string; duplicate: boolean }>("store_set_category", { id, category }),
      assignSerial: (id) => invoke<{ customerNo: string; duplicate: boolean }>("store_assign_serial", { id }),
      makeSample: (id, sample) => invoke<{ customerNo: string; duplicate: boolean }>("store_make_sample", { id, sample }),
      updateSample: (id, name, traits) => invoke<void>("store_update_sample", { id, name, traits }),
      categories: () => invoke<CategorySettings>("store_categories"),
      setCategories: (edits) => invoke<CategorySettings>("store_set_categories", { edits }),
    },
    office: {
      status: () => invoke<OfficeStatus>("office_status"),
      start: (name) => invoke<OfficeStatus | null>("office_start", { name }),
      join: (name) => invoke<OfficeStatus | null>("office_join", { name }),
      cancel: () => invoke<OfficeStatus>("office_cancel"),
      approve: (requestId, fingerprint) => invoke<OfficeStatus>("office_approve", { request: requestId, fingerprint }),
      reject: (requestId) => invoke<OfficeStatus>("office_reject", { request: requestId }),
      remove: (memberId, confirm) => invoke<OfficeStatus>("office_remove", { member: memberId, confirm }),
      moveLocal: () => invoke<number>("office_move_local"),
      recover: (name, key) => invoke<OfficeStatus | null>("office_recover", { name, key }),
      end: (confirm) => invoke<OfficeStatus>("office_end", { confirm }),
      dismissNotices: () => invoke<OfficeStatus>("office_dismiss_notices"),
      defaults: () => invoke<unknown>("office_defaults_get"),
      putDefaults: (value) => invoke<void>("office_defaults_put", { value }),
      featureStatus: () => invoke<FeatureStatus>("feature_codes_status"),
      addFeatureCode: (code) => invoke<FeatureStatus>("feature_code_add", { code }),
      removeFeatureCode: (ref) => invoke<FeatureStatus>("feature_code_remove", { codeRef: ref }),
      dismissFeatureNotice: (ref) => invoke<FeatureStatus>("feature_code_notice_dismiss", { codeRef: ref }),
      checkFeatureCodes: () => invoke<FeatureStatus>("feature_codes_check"),
      decideFeatureCandidate: (id, accept) => invoke<FeatureStatus>("feature_code_candidate_decide", { candidate: id, accept }),
      syncStart: (name) => invoke<OfficeStatus | null>("storage_sync_start", { name }),
      syncOpen: (name, key) => invoke<OfficeStatus | null>("storage_sync_open", { name, key }),
      syncEnd: (confirm) => invoke<OfficeStatus>("storage_sync_end", { confirm }),
      notices: () => invoke<StorageNotice[]>("storage_notices"),
    },
    notices: {
      feed: () => invoke<string | null>("notices_feed"),
      local: () => invoke<unknown>("notice_local_get"),
      putLocal: (value) => invoke<void>("notice_local_put", { value }),
      openForm: (code) => invoke<void>("feedback_form_open", { code }),
      copy: (code) => invoke<boolean>("feedback_copy", { code }),
    },
    ai: {
      status: () => invoke<AiStatus>("ai_status"),
      setEnabled: (enabled) => invoke<AiStatus>("ai_set_enabled", { enabled }),
      copySetup: (client) => invoke<boolean>("ai_setup_copy", { client }),
      household: (id) => invoke<AiHouseholdView>("ai_household", { id }),
      recordConsent: (id, input) => invoke<AiHouseholdView>("ai_consent_record", { id, input }),
      startShare: (id, minutes, destination) => invoke<AiHouseholdView>("ai_share_start", { id, minutes, destination }),
      stopShare: (id) => invoke<AiHouseholdView>("ai_share_stop", { id }),
      decide: (id, candidate, accept, plan) => invoke<AiHouseholdView>("ai_candidate_decide", { id, candidate, accept, plan }),
    },
    statements: {
      office: () => invoke<StatementOfficeData>("statement_office"),
      learn: (entries, formats) => invoke<StatementOfficeData>("statement_learn", { entries, formats }),
      open: async () => {
        const b = bytesOf(await invoke<ArrayBuffer>("statement_open"));
        return b.length === 0 ? null : b;
      },
      saveSheet: (bytes, m) => invoke<SaveOutcome>("statement_sheet_save", bytes, { headers: { "x-customer-no": m.customerNo, "x-exported-on": m.exportedOn } }),
      openSheet: async () => {
        const b = bytesOf(await invoke<ArrayBuffer>("statement_sheet_open"));
        return b.length === 0 ? null : b;
      },
    },
    sheets: {
      save: (bytes, m) => invoke<SaveOutcome>("hearing_save", bytes, { headers: { "x-customer-no": m.customerNo, "x-exported-on": m.exportedOn, "x-prefilled": m.prefilled ? "1" : "0" } }),
      open: async () => {
        const b = bytesOf(await invoke<ArrayBuffer>("hearing_open"));
        return b.length === 0 ? null : b;
      },
    },
  };
}

/** 今の処理をいったん終え、描画と入力を挟んでから続ける */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * 1件だけの正の計算（取り崩しの計算・前回の控えなど、表示の枠の外で頼む計算）。同時に頼まれても安全にする:
 * 同じ要求が計算中ならその結果を待つ（二重に計算しない）、違う要求は1つずつ順に計算する、
 * 本体の失敗（投げられた符号）とエンジンのエラーはどちらも null（呼び出し側が「計算しています…」のまま残らない）
 */
export function singleCompute(host: Pick<HostApi, "compute">): (req: EngineRequest) => Promise<PreviewResult | null> {
  const inflight = new Map<string, Promise<PreviewResult | null>>();
  let queue: Promise<unknown> = Promise.resolve();
  return (req) => {
    const request = JSON.stringify(forEngine(req));
    const same = inflight.get(request);
    if (same !== undefined) return same;
    const run = async (): Promise<PreviewResult | null> => {
      try {
        const res = await host.compute([{ id: "calc", rev: 1, request }]);
        const r = res.slots.calc?.result;
        return r === undefined || isEngineError(r) ? null : r;
      } catch {
        return null;
      } finally {
        inflight.delete(request);
      }
    };
    const p = queue.then(run);
    queue = p;
    inflight.set(request, p);
    return p;
  };
}

/** 開発用のサーバーの答え（失敗は符号の文字列で投げる。本体の命令と同じ） */
async function devJson<T>(res: Response): Promise<T> {
  if (!res.ok) throw (await res.text()) || `E_DEV_${res.status}`;
  return (await res.json()) as T;
}

const devAi = (op: string, args: Record<string, unknown> = {}) => fetch(`/__dev/ai/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });
const devOffice = (op: string, args: Record<string, unknown> = {}) => fetch(`/__dev/office/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });
const devCustom = (op: string, args: Record<string, unknown> = {}) => fetch(`/__dev/custom/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });
const devNotices = (op: string, args: Record<string, unknown> = {}) => fetch(`/__dev/notices/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });
const devStore = (op: string, args: Record<string, string> = {}) => fetch(`/__dev/store/${op}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(args) });

/**
 * 開発用のサーバーだけ（import.meta.env.DEV）: Tauri の外のブラウザで画面を確かめるための代わり。
 * 正の計算の代わりに画面側のエンジンで計算する（quickjs-ng ではない。数字は一致テストで同じことを確かめている）
 */
export function devBrowserHost(engine: WebEngine): HostApi {
  let packsText: Promise<string> | null = null;
  const packs = (): Promise<string> => {
    // 同時に頼まれても読むのは1回（失敗したら次に読み直す）
    packsText ??= fetch("/__dev/packs").then(
      (r) => r.text(),
      (e: unknown) => {
        packsText = null;
        throw e;
      },
    );
    return packsText;
  };
  /** 計算の順番待ち（前の計算が終わってから次を始める） */
  let queue: Promise<unknown> = Promise.resolve();
  return {
    kind: "browser-dev",
    // カスタム層: 開発用のサーバーが FINANCIA_DEV_CUSTOM_DIR のフォルダを読む（承認はメモリの中だけ。検査は形と一覧の id だけの簡単な物）
    custom: {
      status: async () => devJson<CustomTextsStatus>(await devCustom("status")),
      approve: async (fingerprint) => devJson<CustomTextsStatus>(await devCustom("approve", { fingerprint })),
      decline: async (fingerprint) => devJson<CustomTextsStatus>(await devCustom("decline", { fingerprint })),
      revert: async () => devJson<CustomTextsStatus>(await devCustom("revert")),
      rows: async (ids, keep) => devJson<CustomTextsStatus>(await devCustom("rows", { ids, keep })),
      resetLedger: async () => devJson<CustomTextsStatus>(await devCustom("resetLedger")),
      chooseDir: async () => devJson<CustomTextsStatus | null>(await devCustom("chooseDir")),
      resetDir: async () => devJson<CustomTextsStatus>(await devCustom("resetDir")),
      createDir: async () => devJson<CustomTextsStatus>(await devCustom("createDir")),
    },
    packs,
    listHouseholds: async () => (await fetch("/__dev/households")).json() as Promise<string[]>,
    openHousehold: async (id) => (await fetch(`/__dev/households/${encodeURIComponent(id)}`)).json() as Promise<EngineRequest>,
    // 画面と同じスレッドで計算するので、同時に頼まれても1つずつ順に計算し、1件ごとに描画と入力を挟む
    // （続けて計算すると、その間ずっと画面が止まる）
    compute: (slots) => {
      const run = async (): Promise<ComputeResponse> => {
        const p = await packs();
        const t0 = performance.now();
        const out: ComputeResponse["slots"] = {};
        for (const s of slots) {
          await nextTask();
          const t = performance.now();
          const r = JSON.parse(engine.runBatch(`[${s.request}]`, p, '{"preview":true}')) as unknown;
          out[s.id] = { rev: s.rev, ms: performance.now() - t, result: (Array.isArray(r) ? r[0] : r) as PreviewResult | EngineError };
        }
        return { ms: performance.now() - t0, slots: out };
      };
      const res = queue.then(run);
      queue = res.catch(() => undefined);
      return res;
    },
    evidence: async (request) => JSON.parse(engine.run(request, await packs(), "{}")) as FullResult | EngineError,
    // 提案書の PDF とヒアリングシート: 開発用のサーバーが report-pdf のコマンドを呼ぶ・FINANCIA_DEV_SAVE_DIR に書く
    report: {
      render: async (input, addressee) => devJson<RenderInfo>(await fetch("/__dev/report/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input, addressee }) })),
      page: async (page) => {
        const res = await fetch(`/__dev/report/page/${page + 1}`);
        if (!res.ok) throw `E_DEV_${res.status}`;
        return res.blob();
      },
      pageSvg: async (page) => {
        const res = await fetch(`/__dev/report/svg/${page + 1}`);
        if (!res.ok) throw `E_DEV_${res.status}`;
        return res.text();
      },
      save: async () => devJson<SaveOutcome>(await fetch("/__dev/report/save", { method: "POST" })),
      discard: async () => void (await fetch("/__dev/report/discard", { method: "POST" })),
    },
    // 世帯の保存: 開発用のサーバーのメモリの中だけ（暗号化もファイルへの保存もしない。画面の確かめ用）
    store: {
      status: async () => devJson<StoreStatus>(await devStore("status")),
      list: async () => devJson<StoredHousehold[]>(await devStore("list")),
      create: async (body, summary, opts) => devJson<StoredOpened>(await devStore("create", { body, summary, ...(opts?.category !== undefined ? { category: opts.category } : {}), ...(opts?.sample !== undefined ? { sample: JSON.stringify(opts.sample) } : {}) })),
      open: async (id) => devJson<StoredOpened>(await devStore("open", { id })),
      save: async (id, body, summary) => devJson<{ generation: number; savedAt: string }>(await devStore("save", { id, body, summary })),
      rename: async (id, customerNo) => devJson<{ customerNo: string; duplicate: boolean }>(await devStore("rename", { id, customerNo })),
      remove: async (id, confirm) => void (await devJson<unknown>(await devStore("delete", { id, confirm }))),
      recoveryKey: async () => devJson<string>(await devStore("recoveryKey")),
      acknowledgeRecovery: async () => devJson<StoreStatus>(await devStore("acknowledge")),
      testRecoveryKey: async (key) => devJson<StoreStatus>(await devStore("test", { key })),
      restoreWithRecoveryKey: async (key) => devJson<StoreStatus>(await devStore("restore", { key })),
      closeReady: async () => undefined,
      closeCancel: async () => undefined,
      forkInfo: async (id) => devJson<ForkInfo>(await devStore("forkInfo", { id })),
      resolveFork: async (id, keepOurs) => devJson<StoredOpened>(await devStore("resolveFork", { id, keepOurs: keepOurs ? "1" : "" })),
      resolveSyncCopies: async (id, adopt) => void (await devJson<unknown>(await devStore("resolveSyncCopies", { id, adopt: adopt ? "1" : "" }))),
      leave: async () => undefined,
      devFileKeys: async () => false,
      listSamples: async () => devJson<StoredHousehold[]>(await devStore("listSamples")),
      setCategory: async (id, category) => devJson<{ customerNo: string; duplicate: boolean }>(await devStore("setCategory", { id, category })),
      assignSerial: async (id) => devJson<{ customerNo: string; duplicate: boolean }>(await devStore("assignSerial", { id })),
      makeSample: async (id, sample) => devJson<{ customerNo: string; duplicate: boolean }>(await devStore("makeSample", { id, sample: JSON.stringify(sample) })),
      updateSample: async (id, name, traits) => void (await devJson<unknown>(await devStore("updateSample", { id, name, traits: JSON.stringify(traits) }))),
      categories: async () => devJson<CategorySettings>(await devStore("categories")),
      setCategories: async (edits) => devJson<CategorySettings>(await devStore("setCategories", { edits: JSON.stringify(edits) })),
    },
    // 事務所での共有: 開発用のサーバーのメモリの中の代わり（フォルダのダイアログは出さず、架空の共有フォルダを選んだことにする）
    office: {
      status: async () => devJson<OfficeStatus>(await devOffice("status")),
      start: async (name) => devJson<OfficeStatus | null>(await devOffice("start", { name })),
      join: async (name) => devJson<OfficeStatus | null>(await devOffice("join", { name })),
      cancel: async () => devJson<OfficeStatus>(await devOffice("cancel")),
      approve: async (requestId, fingerprint) => devJson<OfficeStatus>(await devOffice("approve", { requestId, fingerprint })),
      reject: async (requestId) => devJson<OfficeStatus>(await devOffice("reject", { requestId })),
      remove: async (memberId, confirm) => devJson<OfficeStatus>(await devOffice("remove", { memberId, confirm })),
      moveLocal: async () => devJson<number>(await devOffice("moveLocal")),
      recover: async (name, key) => devJson<OfficeStatus | null>(await devOffice("recover", { name, key })),
      end: async (confirm) => devJson<OfficeStatus>(await devOffice("end", { confirm })),
      dismissNotices: async () => devJson<OfficeStatus>(await devOffice("dismissNotices")),
      defaults: async () => devJson<unknown>(await devOffice("defaultsGet")),
      putDefaults: async (value) => void (await devJson<unknown>(await devOffice("defaultsPut", { value }))),
      featureStatus: async () => devJson<FeatureStatus>(await devOffice("featureStatus")),
      addFeatureCode: async (code) => devJson<FeatureStatus>(await devOffice("featureAdd", { code })),
      removeFeatureCode: async (ref) => devJson<FeatureStatus>(await devOffice("featureRemove", { ref })),
      dismissFeatureNotice: async (ref) => devJson<FeatureStatus>(await devOffice("featureNoticeDismiss", { ref })),
      checkFeatureCodes: async () => devJson<FeatureStatus>(await devOffice("featureCheck")),
      decideFeatureCandidate: async (id, accept) => devJson<FeatureStatus>(await devOffice("featureCandidateDecide", { id, accept })),
      syncStart: async (name) => devJson<OfficeStatus | null>(await devOffice("syncStart", { name })),
      syncOpen: async (name, key) => devJson<OfficeStatus | null>(await devOffice("syncOpen", { name, key })),
      syncEnd: async (confirm) => devJson<OfficeStatus>(await devOffice("syncEnd", { confirm })),
      notices: async () => devJson<StorageNotice[]>(await devOffice("notices")),
    },
    // お知らせ: 開発用のサーバーが FINANCIA_DEV_NOTICES の見本を確かめて返す。手元の状態はサーバーのメモリの中だけ。フォームは開かない（記録だけ）
    notices: {
      feed: async () => devJson<string | null>(await devNotices("feed")),
      local: async () => devJson<unknown>(await devNotices("local")),
      putLocal: async (value) => void (await devJson<unknown>(await devNotices("putLocal", { value }))),
      openForm: async (code) => void (await devJson<unknown>(await devNotices("openForm", { code }))),
      // 開発用のサーバーでは本体で写さない（画面がブラウザの仕組みで写す）
      copy: async () => false,
    },
    // AI接続口: 開発用のサーバーのメモリの中の代わり（本物の受け口は開けない。画面の確かめ用）
    ai: {
      status: async () => devJson<AiStatus>(await devAi("status")),
      setEnabled: async (enabled) => devJson<AiStatus>(await devAi("setEnabled", { enabled })),
      copySetup: async (client) => devJson<boolean>(await devAi("copySetup", { client })),
      household: async (id) => devJson<AiHouseholdView>(await devAi("household", { id })),
      recordConsent: async (id, input) => devJson<AiHouseholdView>(await devAi("recordConsent", { id, input })),
      startShare: async (id, minutes, destination) => devJson<AiHouseholdView>(await devAi("startShare", { id, minutes, destination })),
      stopShare: async (id) => devJson<AiHouseholdView>(await devAi("stopShare", { id })),
      decide: async (id, candidate, accept, plan) => devJson<AiHouseholdView>(await devAi("decide", { id, candidate, accept, plan })),
    },
    // 明細の取り込み: 覚えた辞書と形は開発用のサーバーのメモリの中だけ。開くは架空の明細（statement/test/fixtures）を順に返す
    statements: {
      office: async () => devJson<StatementOfficeData>(await fetch("/__dev/statement/office", { method: "POST" })),
      learn: async (entries, formats) => devJson<StatementOfficeData>(await fetch("/__dev/statement/learn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries, formats }) })),
      open: async () => {
        const res = await fetch("/__dev/statement/open");
        if (res.status === 204) return null;
        if (!res.ok) throw (await res.text()) || `E_DEV_${res.status}`;
        return new Uint8Array(await res.arrayBuffer());
      },
      saveSheet: async (bytes, m) =>
        devJson<SaveOutcome>(await fetch(`/__dev/statement/sheetsave?customerNo=${encodeURIComponent(m.customerNo)}&exportedOn=${encodeURIComponent(m.exportedOn)}`, { method: "POST", body: bytes as Uint8Array<ArrayBuffer> })),
      openSheet: async () => {
        const res = await fetch("/__dev/statement/sheetopen");
        if (res.status === 204) return null;
        if (!res.ok) throw (await res.text()) || `E_DEV_${res.status}`;
        return new Uint8Array(await res.arrayBuffer());
      },
    },
    takeaway: {
      save: async (bytes, m) => devJson<SaveOutcome>(await fetch(`/__dev/takeaway/save?exportedOn=${encodeURIComponent(m.exportedOn)}&encrypted=${m.encrypted ? 1 : 0}`, { method: "POST", body: bytes as Uint8Array<ArrayBuffer> })),
    },
    sheets: {
      save: async (bytes, m) =>
        devJson<SaveOutcome>(await fetch(`/__dev/sheets/save?customerNo=${encodeURIComponent(m.customerNo)}&exportedOn=${encodeURIComponent(m.exportedOn)}&prefilled=${m.prefilled ? 1 : 0}`, { method: "POST", body: bytes as Uint8Array<ArrayBuffer> })),
      open: async () => {
        const res = await fetch("/__dev/sheets/open");
        if (res.status === 204) return null;
        if (!res.ok) throw (await res.text()) || `E_DEV_${res.status}`;
        return new Uint8Array(await res.arrayBuffer());
      },
    },
  };
}

export function isTauri(): boolean {
  return typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === "object";
}
