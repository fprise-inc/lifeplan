// 本体（Rust）と画面側のエンジンへの入口
import { invoke as rawInvoke, type InvokeArgs, type InvokeOptions } from "@tauri-apps/api/core";
import { OcrFailure, type DictionaryEntry, type LearnedFormat, type OcrPage } from "../../../statement/src/index.ts";
import { forEngine } from "./moneyRows.ts";
import { retryTimedOut } from "./retry.ts";
import { isEngineError, type EngineError, type EngineRequest, type FullResult, type PreviewResult } from "./types.ts";
import type { OfficeTextEntry, TextOp } from "../workspace/office/customTexts.ts";
import { API_PREFIX, type RelayRequest, type RelayResponse } from "../../../hearing/src/web/protocol.ts";
import { browserSaveAll, browserSaveOne } from "./browserSave.ts";
import { commandAction, EMPTY_ERROR_LOG, messageOf, recordError, UNLOGGED_COMMANDS, type ErrorKind, type ErrorLogView } from "../workspace/notices/errorLog.ts";

/**
 * 本体の命令（0234）: 失敗した命令は、命令の名前とエラーの文をエラーの記録に残してから、そのまま投げ直す（扱いは呼んだ所のまま）。
 * 記録の命令そのものは記録しない。文は本体が削ってから残す（世帯の中身・ファイルの場所は残さない）
 */
async function invoke<T>(cmd: string, args?: InvokeArgs, options?: InvokeOptions): Promise<T> {
  try {
    return await rawInvoke<T>(cmd, args, options);
  } catch (e) {
    if (!UNLOGGED_COMMANDS.has(cmd)) recordError({ kind: "command", action: commandAction(cmd), message: messageOf(e) });
    throw e;
  }
}

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
  /**
   * 帳票の入力（JSON）から PDF を作る。宛名は出力の PDF に重ねるだけ（保存しない）。accent は事務所の基調の色から導いた見出しなどの色
   * （0121。白地で読める濃さ。null は帳票の標準の色）。事務所の名前とロゴは本体が事務所データから入れる
   */
  render(inputJson: string, addressee: string | null, accent?: string | null): Promise<RenderInfo>;
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

/**
 * Web のヒアリング（0125）: 受け付けのサーバーとのやりとり（本体の命令だけが通信する。相手は配布元の設定の [hearing_web] の relay だけ）と、
 * 受け取った書類の保存（本体の平文の書き出しの出口）
 */
export interface HearingWebHost {
  /** お客さまのページの URL（# の前まで）。dev は開発用のビルド・サーバー（手元の受け付けを向いている） */
  config(): Promise<{ pageUrl: string; dev: boolean }>;
  call(r: RelayRequest): Promise<RelayResponse>;
  saveDocument(bytes: Uint8Array, meta: { fileName: string }): Promise<SaveOutcome>;
  /**
   * 受け取った書類をまとめて、FP が選んだフォルダに保存する（0191）。フォルダは1回だけ選ぶ。同じ名前で中身の違うファイルがあれば番号を足し、
   * 同じ中身ならそのまま（書き直さない）。デスクトップのアプリは本体の平文の書き出しの出口、ブラウザはブラウザの保存の仕組み
   */
  saveDocuments(files: readonly { bytes: Uint8Array; fileName: string }[]): Promise<FolderSaveOutcome>;
}

/** まとめて保存した結果（フォルダを選ばなかったときは picked: false）。via はフォルダに書いたか、ブラウザのダウンロードにしたか */
export interface FolderSaveOutcome {
  picked: boolean;
  saved: { index: number; fileName: string }[];
  failed: number;
  syncFolder: boolean;
  via: "folder" | "downloads";
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
  /**
   * 本体の開くダイアログで選んだ明細のファイルの中身（1つ 10MB まで。パス・ファイル名は渡らない）。写真・スクショは何枚か選べる
   * （選んだ順。CSV・PDF は1つ）。選ばなかったときは空
   */
  open(): Promise<Uint8Array[]>;
  /**
   * 明細の写真・スクショ（画像のバイト列）の文字を、本体が OS の文字認識で読む（0034 の段階3。外に送らない）。
   * 読めないときは OcrFailure（E_OCR_UNSUPPORTED・E_OCR_NO_LANGUAGE・E_OCR_OLD_MAC・E_OCR_IMAGE など）
   */
  ocr(image: Uint8Array): Promise<OcrPage>;
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

/** 見本の出どころ（セットの見本を直した版のときだけ。set はセットの ID、id はセットの中の見本の ID、rev は見本の中身の版。0247） */
export interface SampleOrigin {
  set: string;
  id: string;
  rev: number;
}

/** 見本の中身の説明（見本は番号を持たない。名前・家族の形・本人の年代・項目で探す。0247 の1） */
export interface SampleInfo {
  name: string;
  traits: string[];
  /** 家族の形（1 単身・2 夫婦のみ・3 夫婦と子・4 ひとり親・5 シニア） */
  family: number;
  /** 本人の年代（2〜7） */
  age: number;
  /** セットの見本を直した版のときだけ */
  origin?: SampleOrigin;
  /** 最初の状態から変わっているか（無ければ false） */
  changed?: boolean;
}

/** 見本を最初の状態に戻した結果（removed: セットの見本を直した版を消した。次に開くとアプリの中の見本が開く） */
export interface SampleResetOutcome {
  kind: "removed";
}

/** 見本を作る・登録するときの指定 */
export interface SampleRequest {
  family: number;
  age: number;
  name: string;
  traits: string[];
  /** セットの見本を直した版を作るときだけ */
  origin?: SampleOrigin;
}

/** 一覧の札・開いた世帯の番号の中身（本体の Label） */
export interface NumberLabel {
  category?: string;
  serial?: number;
  branch?: string;
  sample?: SampleInfo;
  /** 架空の世帯（AIの候補から「架空」として作った世帯。本体だけが付け、外すのは「お客さまの世帯にする」だけ）。無ければお客さまの世帯 */
  fictional?: boolean;
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
  /** この PC の事務所データが、このアプリより新しい版で保存されている（閲覧だけ。保存しない。アプリの更新を案内する。0222）。無い本体は false */
  officeTooNew?: boolean;
  /** 見本番号を無くす移行・一覧の作り直しで、重なった名前を直した見本（この起動の間。画面は保存先の知らせ sampleRenames でお知らせの一覧の「参考」に出す。0247 の8） */
  sampleRenames?: { from: string; to: string }[];
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

/** 開けなかった世帯の、直前の世代（.prev）の時点（0011 の7） */
export interface PreviousGeneration {
  /** 何回目の保存か */
  generation: number;
  /** 保存した日時（ISO 8601。本文に記録が無ければ null） */
  savedAt: string | null;
  /** 保存した人の表示名（事務所で共有しているとき） */
  savedBy: string | null;
}

/** 開いた世帯（本文は JSON の文字列。0011 の2） */
export interface StoredOpened extends NumberLabel {
  id: string;
  customerNo: string;
  body: string;
  /** 閲覧だけ（新しい版のアプリで保存された世帯か、名簿の自分の役割が閲覧だけ） */
  readOnly: boolean;
  /** 閲覧だけの理由が、名簿の自分の役割（この版の知らない役割は閲覧だけ。0023 の2）。古い本体は返さない */
  viewOnly?: boolean;
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
  /** 事務所の確かめ用の番号（16文字を4文字ずつ区切る。全員の画面で同じ。名簿を受け入れていないときは null） */
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
  /** 名簿の自分の役割が閲覧だけ（新しい版のアプリが決めた、この版の知らない役割。世帯は開けるが、保存・共有の操作はできない。0023 の2） */
  viewOnly: boolean;
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

/** 止めた一覧（0110 の追記。取り下げの一覧と、コードを止めるだけの一覧〔0117 の追記 2026-11-04 の2〕）の確かめの様子。中身の一覧は返さない */
export interface FeatureCheckView {
  /** 最後に取りに行った日時（UTC） */
  checkedAt: string | null;
  /** 最後に2つとも取れた日時（UTC） */
  okAt: string | null;
  /** 最後に取りに行った結果（2つの一覧をまとめたもの。2つとも取れたときだけ ok。一度も取りに行っていなければ null） */
  result: "ok" | "offline" | "rejected" | null;
  /** 今使っている取り下げの一覧の通し番号（一度も取れていなければ null） */
  serial: number | null;
  /** 今使っているコードを止めるだけの一覧の通し番号（一度も取れていなければ null） */
  codeListSerial?: number | null;
  /** 2つの一覧のどちらかに載っている、止めるコードの数 */
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
  /**
   * 手元の鍵からたどれない名簿（problem が E_OFFICE_ROSTER_UNVERIFIED。30日より長く開かなかった間に、ほかのメンバーが外す操作をした）を、
   * ほかのメンバーから聞いた事務所の確かめ用の番号（16文字）か、事務所の復元キーで受け入れる。合わなければ E_OFFICE_CODE_MISMATCH で、受け入れない
   */
  acceptRoster(key: string): Promise<OfficeStatus>;
  /** 事務所の既定値（0073。事務所データの JSON のオブジェクト。形は office/settings.ts の readOfficeSettings で確かめる） */
  defaults(): Promise<unknown>;
  /** 事務所の既定値を置き換える */
  putDefaults(value: Record<string, unknown>): Promise<void>;
  /**
   * 世帯ファイルにまだ入っていない Web のヒアリングの依頼（0222。AI 接続口から発行した、世帯の決まっていない依頼と開いていない世帯の依頼。
   * 鍵を含むので事務所データに暗号化して持つ）。形は hearing/aiHearing.ts の readOfficeHearing で確かめる。無い本体は使えない
   */
  hearingRequests?(): Promise<unknown>;
  putHearingRequests?(value: Record<string, unknown>): Promise<void>;
  /** 事務所の見た目（0121。名前・ロゴの画像・基調の色・この PC の画面の明るさ）。形は office/branding.ts の readBranding で確かめる */
  branding(): Promise<unknown>;
  /** 事務所の見た目を置き換える（本体が確かめて整えた値を返す。断るときは E_STORE_BRANDING・E_STORE_LOGO・E_STORE_LOGO_TOO_LARGE） */
  putBranding(value: Record<string, unknown>): Promise<unknown>;
  /** ロゴの画像を選ぶ（本体のダイアログ。PNG・JPEG だけ。確かめた画像を返し、保存はしない。選ばなかったら null） */
  pickLogo(): Promise<unknown>;
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
  /**
   * 新しい世帯（opts.category は区分の記号。無ければ見込み客（区分を使わないときは通し番号だけ）。opts.sample があれば見本として作る。0033）。
   * opts.reservedNames は見本の名前に使えない名前（アプリのセットの見本の名前。0247 の1）
   */
  create(body: string, summary: string, opts?: { category?: string; sample?: SampleRequest; reservedNames?: string[] }): Promise<StoredOpened>;
  open(id: string): Promise<StoredOpened>;
  /**
   * 開かずに、Web のヒアリングの依頼の、届いたかの確かめに要る欄だけを読む（開いていない世帯の届いた知らせ。0192 の追記 2026-11-18）。
   * 開いた印（前回開いた世帯・事務所の共有の「開いている」）を変えない。答え・書類・選び方・URL は返さない。古い本体には無い
   */
  peekHearing?(id: string): Promise<unknown>;
  /** 開けなかった世帯の、直前の世代の時点（直前の世代で開き直せないときは null。0011 の7） */
  previousGeneration(id: string): Promise<PreviousGeneration | null>;
  /** 開けなかった世帯を、直前の世代で開き直す（開けなかったファイルは本体がこの PC の中に別名で残す） */
  openPrevious(id: string): Promise<StoredOpened>;
  save(id: string, body: string, summary: string): Promise<{ generation: number; savedAt: string }>;
  rename(id: string, customerNo: string): Promise<{ customerNo: string; duplicate: boolean }>;
  /** 完全削除（confirm は FP が打った顧客番号。見本は見本の名前。0247） */
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
  /** 見本の棚（保存した見本。名前の順） */
  listSamples(): Promise<StoredHousehold[]>;
  /** 区分を変える（体系の番号は記号だけが変わる） */
  setCategory(id: string, category: string): Promise<{ customerNo: string; duplicate: boolean }>;
  /** 自由な番号の世帯に、区分の記号＋新しい通し番号を付ける */
  assignSerial(id: string): Promise<{ customerNo: string; duplicate: boolean }>;
  /** 顧客の世帯を見本の棚へ移す（「中身は架空です」を確かめた後。番号は付かない。reservedNames は使えない名前。0247） */
  makeSample(id: string, sample: SampleRequest, reservedNames?: string[]): Promise<{ customerNo: string; duplicate: boolean }>;
  /** 架空の世帯をお客さまの世帯にする（一方向。お客さまの世帯を架空にする命令は無い）。印を外したら true */
  makeClient(id: string): Promise<boolean>;
  /** 見本の名前・項目・家族の形・本人の年代を直す（セットの見本を直した版は直せない。0247） */
  updateSample(id: string, name: string, traits: string[], family: number, age: number, reservedNames?: string[]): Promise<void>;
  /**
   * 見本を最初の状態に戻す（0247 の6）。セットの見本を直した版（出どころのある見本）は、直した版を消す（完全削除と同じ消し方。取り消せない）。
   * 顧客の世帯は E_STORE_SAMPLE、自分で作った見本は E_STORE_SAMPLE_NOT_CHANGED で断る（本体が確かめる）
   */
  sampleReset(id: string): Promise<SampleResetOutcome>;
  categories(): Promise<CategorySettings>;
  /** 区分の設定を変える（空は「区分を使わない」。初めの「区分を使いますか？」の答えもこれで書く） */
  setCategories(edits: CategoryEdit[]): Promise<CategorySettings>;
}

// ---- AI接続口（0014・0015）。画面には鍵もパスも渡らない（接続の設定の文面は場所を伏せたもの） ----

/** 共有中の世帯（仮名・顧客番号・残り時間） */
/** AI に渡す中身の確認画面の1世帯（0249）: AI に渡る文（名前を伏せた後）と伏せた所（文字の位置）、名前らしい所が残っていそうな所 */
export interface AiNotesPreview {
  id: string;
  customerNo: string;
  texts: { item: string; author: string; text: string; spans: [number, number][] }[];
  suspects: string[];
}

/** まとめて渡すときに渡さなかった世帯の理由（0248） */
export type AiBulkBlock = "refused" | "withdrawn" | "noBasis" | "sample" | "notSaved" | "readOnly" | "openByOthers" | "unreadable" | "closed" | "notWritten" | "unknown";

/** まとめて渡す確かめ・結果（0248）。ready は確かめでは渡せる世帯、渡した後は渡した世帯（alias は渡した後だけ） */
export interface AiBulkOutcome {
  ready: { id: string; customerNo: string; basis: AiUse; alias: string | null; notes?: AiUse; notesShared?: boolean }[];
  already: { id: string; customerNo: string }[];
  /** households の name は見本の世帯だけ（見本は番号を持たないので、名前で出す。0247） */
  blocked: { reason: AiBulkBlock; households: { id: string; customerNo: string; name?: string }[] }[];
  /** 上限（共有中の世帯と合わせた数） */
  limit: number;
  /** いま共有中の世帯の数（この確かめ・結果の前） */
  active: number;
}

export interface AiShareStatus {
  shareId: string;
  alias: string;
  householdId: string;
  customerNumber: string | null;
  expiresInSec: number;
  /** 共有中にメモ・面談の記録が変わったので、メモと面談の履歴だけ AI に渡すのを止めている（0249 の追記。無い本体は止めていない） */
  notesPaused?: boolean;
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
  /**
   * 事務所の設定で FP が「事務所のプライバシーポリシーに AI の利用を書いている」ことを確かめた日時（0226。確かめていなければ null。無い本体は確かめていないとして扱う）。
   * 確かめていると、外部AIへの提供の同意の答えが無い世帯も AI に渡せる（「同意しない」と答えた世帯・撤回した世帯は渡せない）
   */
  privacyPolicyConfirmedAt?: string | null;
  /** 事務所のプライバシーポリシーに「面談の記録やメモを AI で扱うこと」も書いていることを確かめた日時（0249。無い本体は確かめていない） */
  notesPolicyConfirmedAt?: string | null;
  /** 「メモと面談の履歴も渡す」の印を最初から付けておくか（0249。既定はオフ） */
  notesByDefault?: boolean;
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
  /** AIから届いた、新しい世帯の候補の数（承認待ち。中身は householdCandidates で読む。無い本体は0） */
  householdCandidates?: number;
  /** AIから届いた、表示の設定の案の数（承認待ち。中身は displayCandidates で読む。無い本体は0。0215） */
  displayCandidates?: number;
  /** AIから世帯ごとの表示の設定の案が届いている世帯（承認待ち。中身はその世帯の household の displayProposals。無い本体は空。0213 の段B の後半） */
  householdDisplayCandidates?: AiDisplayPendingHousehold[];
  /** AI接続口から頼まれた Web のヒアリングの発行の仕事の数（画面が hearingJobs で受け取って発行し、hearingJobDone で答える。無い本体は0。0222） */
  hearingJobs?: number;
  /** AIから届いた、Web のヒアリングの事務所のひな形の案の数（承認待ち。中身は hearingTemplateCandidates で読む。無い本体は0。0222） */
  hearingTemplateCandidates?: number;
  /** AIから届いた、送る報告の数（承認待ち。中身は issueReportCandidates で読む。無い本体は0。0259） */
  issueReportCandidates?: number;
}

/** AIがまとめた要望・不具合の報告（0259。1回に何件か。接続口の propose_issue_report。値は信用しない: 送る報告の確認画面で FP が確かめて直す） */
export interface AiIssueReportCandidate {
  candidateId: string;
  receivedAt: string;
  connector?: string | null;
  /** FP が話した内容を AI が1件ずつに分けた物（kind は bug・request・question） */
  items: { kind: string; screen?: string | null; text: string }[];
}

/** AI接続口から頼まれた Web のヒアリングの発行の仕事（0222）。issue は接続口が FP の画面と同じ関数で確かめた選び方（画面も確かめ直す）と、任意の何のための問いか */
export interface AiHearingJob {
  jobId: string;
  issue: { selection: unknown; purpose?: string };
  /** 渡された世帯の依頼ならその世帯（内部ID・顧客番号）。世帯の決まっていない依頼は null */
  householdId: string | null;
  customerNumber: string | null;
  /** 見直しを含む世帯の依頼だけ: 本体の帳面の本文（その世帯を開いていないとき、前回の値を作る） */
  body: string | null;
  connector: string | null;
  receivedAt: string;
}

/** AIからの Web のヒアリングの事務所のひな形の案（0222。値は信用しない: 画面が checkSelection で確かめてから出す。note は AI が書いた理由） */
export interface AiHearingTemplateCandidate {
  candidateId: string;
  receivedAt: string;
  connector: string | null;
  name: string;
  selection: unknown;
  note?: string | null;
}

/** 表示の設定の案が届いている世帯（上の帯に出す。顧客番号は案が届いたときの共有の物） */
export interface AiDisplayPendingHousehold {
  householdId: string;
  customerNumber: string | null;
  /** AIから見えていた呼び名 */
  alias: string;
  /** 承認待ちの設定の数（案をまたいだ合計） */
  count: number;
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
  /** 会社・所在国は前の版で記録した行だけが持つ（今は聞かない。0172） */
  externalAi?: { company?: string; country?: string; noTrainingConfirmed: boolean };
  scope?: string;
  /** 書類の読み取りで書類を AI に渡すことを含む説明（版2〜）で同意した（0157）。無い同意は書類に使わない */
  documents?: boolean;
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
  /** 共有中にメモ・面談の記録が変わって、メモと面談の履歴だけ止めた（いつ・何が変わったか。0249 の 11。前の版の記録には無い） */
  notesPaused?: { at: string; changed: ("memo" | "meetings")[] };
  /** 止めた後に、AI に渡す中身の確認画面で見直して渡し直した共有（止めた共有の ID。0249 の 11） */
  notesResharedAfter?: string;
}

export interface AiProposedDiff {
  id: string;
  target: { object: string } | { plan: "assumptions" };
  item: string;
  /** 入力の欄の場所（0201。同じ対象・同じ入力項目ID で場所だけ違う欄を選ぶ。前の版の候補には無い） */
  at?: string[];
  /** 合成の対策の名前（0201。前の版の候補には無い） */
  lever?: string;
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

/**
 * AI接続口の道具（propose_inputs）で届いた、書類から読んだ値の候補（0151）。本体はメモリの中に置くだけで、世帯ファイルには書かない。
 * 画面が読み口（documents/proposal.ts の readProposal。番号を落とす決まり）を通して読み取りの記録にしてから、takeDocuments で外す
 */
export interface AiDocumentProposal {
  /** 候補の ID（AIに渡した記録の proposals の candidateId。読み取りの記録の ID にする） */
  candidateId: string;
  shareId: string;
  householdId: string;
  receivedAt: string;
  /** AIのアプリの名乗り（自己申告） */
  connector: string | null;
  /** 届いた答え（document-candidates@1。信用しない） */
  answer: unknown;
}

/** 世帯の「同意とAIの記録」 */
export interface AiHouseholdView {
  consentState: "none" | AiConsentDecision;
  /**
   * 今の同意が、書類を AI に渡すことを含む説明（版2〜）でのものか（0157）。`given` で false なら、
   * 計算に要る項目は渡せるが、書類を AI に渡す前に同意を取り直す。無い本体〔古い版・テストの代わり〕は false として扱う
   */
  consentDocuments?: boolean;
  consents: AiConsentRecord[];
  explanation: string;
  explanationRef: string;
  /** 説明文の版（0157） */
  explanationVersion?: number;
  /** ヒアリングシートの同意欄の文（取り方が「ヒアリングシートの同意欄」の同意はこの文で記録し、書類を含まない。0172） */
  hearingSheetExplanation?: string;
  share: AiShareStatus | null;
  records: AiShareRecord[];
  candidates: AiCandidate[];
  /** 届いた書類の候補（画面が受け取るまで。無い本体〔古い版・テストの代わり〕は空として扱う） */
  documentProposals?: AiDocumentProposal[];
  /** 届いた、この世帯の表示の設定の案（承認待ち。無い本体〔古い版・テストの代わり〕は空として扱う。0213 の段B の後半） */
  displayProposals?: AiHouseholdDisplayCandidate[];
  allowlistVersion: string;
  fields: string[];
  saved: boolean;
  /** 架空の世帯（同意の記録が無くても渡せる。無い本体はお客さまの世帯として扱う） */
  fictional?: boolean;
  /**
   * この世帯を AI に渡せるか・その理由（0226。本体の ai_share::ai_use の1か所で決めた判定。画面はこれを見せるだけ）。
   * 無い本体（古い版・テストの代わり）は ai/model.ts の aiUseOf が同意の状態だけで読む（事務所の設定は見ない側）
   */
  aiUse?: AiUse;
  /** 書類（お名前・番号を伏せたもの）を AI に渡せるか・その理由（0157・0226。本体の ai_documents_use） */
  aiDocumentsUse?: AiUse;
  /** 今の同意が、面談の記録やメモを AI に渡すことを含む説明（版3〜）でのものか（0249） */
  consentNotes?: boolean;
  /** メモと面談の履歴を AI に渡せるか・その理由（0249。本体の ai_notes_use） */
  aiNotesUse?: AiUse;
  /** 渡せるメモの行と面談の記録の欄の数（0249） */
  notesCount?: number;
  /** 今の説明文（版3）を出した日（YYYY-MM-DD）。これより前の日付の同意は、メモと面談の記録を含まない同意として記録する */
  explanationSince?: string;
}

/**
 * AI接続を使える・使えない理由（0226）: consent＝同意がある、officePolicy＝事務所のプライバシーポリシー（FP が確かめ済みで、お客さまが「同意しない」と答えていない）、
 * fictional＝架空の世帯、refused＝お客さまが「同意しない」と答えた、withdrawn＝撤回した、consentWithoutDocuments＝書類を含まない同意（書類の判定だけ）、none＝理由が無い
 */
export type AiUse = "consent" | "officePolicy" | "fictional" | "refused" | "withdrawn" | "consentWithoutDocuments" | "consentWithoutNotes" | "none";

/**
 * AI接続口の道具（propose_display_settings）で届いた、事務所の既定値の表示の設定の案（0215）。本体はメモリの中に置くだけで、設定は変えない。
 * 値は信用しない（画面が connector/displayProposal.ts の checkDisplayValue で確かめてから「今 → 案」を出す）。note は AI が書いた理由（指示ではない）
 */
export interface AiDisplayCandidate {
  candidateId: string;
  receivedAt: string;
  /** AIのアプリの名乗り（自己申告） */
  connector: string | null;
  /** 設定ごとの案（設定の id・値・理由。FP が「反映する」か「捨てる」を選んだ設定は、本体が外す） */
  changes: { id: string; value: unknown; note?: string | null }[];
}

/**
 * AI接続口の道具（propose_display_settings の share_id）で届いた、渡された世帯ごとの表示の設定の案（0213 の段B の後半）。本体はメモリの中に置くだけで、
 * 世帯ファイルは変えない。値は信用しない（画面が checkDisplayValue で確かめてから「今 → 案」を出す）。note は AI が書いた理由（指示ではない）
 */
export interface AiHouseholdDisplayCandidate extends AiDisplayCandidate {
  shareId: string;
  householdId: string;
  customerNumber: string | null;
  alias: string;
}

/**
 * AI接続口の道具（propose_household）で届いた、新しい世帯の候補。本体はメモリの中に置くだけで、世帯は作らない。
 * 中身は信用しない（画面の読み口 ai/households.ts の readHouseholdCandidate で番号らしい所を消してから見せる）
 */
export interface AiHouseholdCandidate {
  candidateId: string;
  receivedAt: string;
  /** AIのアプリの名乗り（自己申告） */
  connector: string | null;
  /** AIが選んだ種類（FP は作る前に変えられる） */
  kind: "fictional" | "client";
  /** AIが書いた題・推定したこと（指示ではない。文字のまま出す） */
  title: string;
  note: string | null;
  /** 計算の入力（calculate の input と同じ形） */
  input: unknown;
}

export interface AiConsentInput {
  decision: AiConsentDecision;
  obtainedOn: string;
  method: AiConsentMethod;
  noTrainingConfirmed: boolean;
  fpConfirmed: boolean;
}

/** AI のアプリへの登録の、1つの書く先の状態（0228）。書く場所はホームを ~ にした表示、書く中身は AI と接続する道具の場所を伏せた文面 */
export interface AiAppPart {
  id: "claudeDesktop" | "claudeCode" | "codex";
  /** 行の中での呼び名（「チャット（アプリ）」「Claude Code」「Codex」） */
  label: string;
  state: "registered" | "unregistered" | "stale" | "unreadable" | "missing" | "unsupported";
  target: string;
  preview: string;
  how: "file" | "command";
  /** 今は書けない理由（E_AI_APP_RUNNING: Claude のアプリが起動中・E_AI_APP_NO_COMMAND: claude コマンドが無い など）。null なら書ける */
  blocked: string | null;
}

/** AI のアプリへの登録の画面の1行（0228 の追記 2026-11-20）。Claude の行は、チャットのアプリと Claude Code の2つの書く先をまとめる */
export interface AiAppView {
  client: "claude" | "codex";
  title: string;
  /** 書く先をまとめた状態。partial は片方だけ登録済み */
  state: AiAppPart["state"] | "partial";
  parts: AiAppPart[];
}

export interface AiAppsStatus {
  apps: AiAppView[];
  /** 登録の名前（開発用のビルドは別の名前） */
  serverName: string;
  /** AI と接続する道具の場所の問題（あればどれも登録できない） */
  locationProblem: string | null;
}

/** AI接続口（本体の命令。世帯は内部IDだけで指す） */
export interface AiHost {
  status(): Promise<AiStatus>;
  setEnabled(enabled: boolean): Promise<AiStatus>;
  /** 事務所のプライバシーポリシーに AI の利用を書いていることを確かめた・外した（0226。外すと、それを理由に渡していた共有を取り消す）。無い本体は使えない */
  setPrivacyPolicy?(confirmed: boolean): Promise<AiStatus>;
  /** 接続の設定の文面（本物の場所入り）を本体が OS のクリップボードへ写す */
  copySetup(client: string): Promise<boolean>;
  /** 行（Claude・Codex）ごとの登録の状態（0228。無い本体〔開発用のブラウザ〕は undefined） */
  apps?(): Promise<AiAppsStatus>;
  /** 行の AI のアプリに登録する（すでにあれば場所だけ直す。Claude の行は両方に）。FP が押したときだけ本体が書く */
  registerApp?(client: string): Promise<AiAppsStatus>;
  /** 行の AI のアプリの登録を外す（自分の名前の所だけ。Claude の行は両方から） */
  unregisterApp?(client: string): Promise<AiAppsStatus>;
  household(id: string): Promise<AiHouseholdView>;
  recordConsent(id: string, input: AiConsentInput): Promise<AiHouseholdView>;
  /** notes はメモと面談の履歴も渡すか、words はそのとき伏せる言葉（メモリの上だけで使い、保存しない。0249） */
  startShare(id: string, minutes: number, destination: string, notes?: boolean, words?: string[]): Promise<AiHouseholdView>;
  /** 事務所のプライバシーポリシーの「面談の記録やメモを AI で扱うことも書いている」を確かめた・外した（0249） */
  setNotesPolicy?(confirmed: boolean): Promise<AiStatus>;
  /** 「メモと面談の履歴も渡す」の印を最初から付けておくか（0249） */
  setNotesDefault?(enabled: boolean): Promise<AiStatus>;
  /** AI に渡るメモと面談の履歴を、名前を伏せた形で見る（AI に渡す中身の確認画面。0249） */
  notesPreview?(ids: string[], words: string[]): Promise<AiNotesPreview[]>;
  stopShare(id: string): Promise<AiHouseholdView>;
  /** まとめて渡す前の確かめ（世帯の一覧で選んだ世帯。共有は作らない。0248。無い本体〔開発用のブラウザ〕は使えない） */
  bulkCheck?(ids: string[]): Promise<AiBulkOutcome>;
  /** 選んだ世帯をまとめて渡す（1件ずつと同じ確かめ・期限・申告・記録。渡せない世帯は渡さずに理由を返す。0248） */
  bulkStart?(ids: string[], minutes: number, destination: string, notes?: { ids: string[]; words: string[] }): Promise<AiBulkOutcome>;
  /** 選んだ世帯の共有をまとめて取り消す（取り消した世帯の数。0248） */
  bulkStop?(ids: string[]): Promise<number>;
  /** AIの候補についての FP の判断（accept のときは保存したプランの ID） */
  decide(id: string, candidate: string, accept: boolean, plan: string | null): Promise<AiHouseholdView>;
  /** 読み取りの記録にした（または読めなかった）書類の候補を、本体の承認待ちから外す（0151） */
  takeDocuments(id: string, candidate: string): Promise<AiHouseholdView>;
  /** 新しい世帯の候補（承認待ち） */
  householdCandidates(): Promise<AiHouseholdCandidate[]>;
  /** 新しい世帯の候補を捨てる（世帯は作らない） */
  discardHouseholdCandidate(candidate: string): Promise<AiHouseholdCandidate[]>;
  /** 表示の設定の案（承認待ち。0215） */
  displayCandidates(): Promise<AiDisplayCandidate[]>;
  /** Web のヒアリングの発行の仕事（0222。無い本体は使えない） */
  hearingJobs?(): Promise<AiHearingJob[]>;
  /** 発行の仕事の答え（{ ok: true, requestId, … } か { ok: false, message }）。もう待っていなければ false */
  hearingJobDone?(jobId: string, result: Record<string, unknown>): Promise<boolean>;
  /** Web のヒアリングの事務所のひな形の案（承認待ち。0222） */
  hearingTemplateCandidates?(): Promise<AiHearingTemplateCandidate[]>;
  /** ひな形の案を承認待ちから外す（保存した後か「捨てる」を押したとき。事務所の既定値は変えない） */
  takeHearingTemplate?(candidate: string): Promise<AiHearingTemplateCandidate[]>;
  /** AIがまとめた不具合の報告（承認待ち。0259。無い本体は使えない） */
  issueReportCandidates?(): Promise<AiIssueReportCandidate[]>;
  /** 報告を承認待ちから外す（送った後か「送らずに捨てる」を押したとき。何も送らない） */
  takeIssueReport?(candidate: string): Promise<AiIssueReportCandidate[]>;
  /** 表示の設定の案の1つの設定を承認待ちから外す（FP が「反映する」で事務所の既定値に書いた後か、「捨てる」を押したとき。設定は変えない） */
  takeDisplayChange(candidate: string, setting: string): Promise<AiDisplayCandidate[]>;
  /** 世帯ごとの表示の設定の案の1つの設定を承認待ちから外す（FP が「反映する」でその世帯に書いた後か、「捨てる」を押したとき。設定は変えない） */
  takeHouseholdDisplayChange(id: string, candidate: string, setting: string): Promise<AiHouseholdView>;
  /**
   * 新しい世帯の候補から世帯を作る（FP が確かめて「世帯として作る」を押したときだけ）。kind は FP が選んだ種類、body は候補の入力から
   * 画面が組み立てた本文。本体が出どころの記録を書き、架空なら一覧の札に印を付ける
   */
  createFromCandidate(candidate: string, kind: "fictional" | "client", body: string, summary: string, category?: string): Promise<StoredOpened>;
}

/** 本体の命令（0016 の1: 用途ごとの命令だけ） */
/** お知らせの一覧（0087）: 配信元のお知らせを読む口（1か所）・手元の既読の印と受付番号・要望のフォームを開く */
export interface NoticesHost {
  /** 配信元のお知らせ（本体が署名を確かめた一覧の JSON。無ければ null。今は通信しないので、開発用のビルドの見本だけ） */
  feed(): Promise<string | null>;
  /** 手元の状態（既読の印と受付番号。この PC のアプリのデータ） */
  local(): Promise<unknown>;
  putLocal(value: unknown): Promise<void>;
  /** 要望・不具合のフォームを既定のブラウザで開く（受付番号と、AI がまとめた報告なら印 via=ai だけを渡す。版と OS は本体が入れる。報告の文は渡さない。0259） */
  openForm(code: string, via?: "ai"): Promise<void>;
  /** 送る報告の文をクリップボードに写す（送る報告の確認画面の「送る」。写せたら true。無い本体はブラウザの仕組みで写す。0259） */
  copyReport?(text: string): Promise<boolean>;
  /** 受付番号を写す（クリップボード。写せたら true） */
  copy(code: string): Promise<boolean>;
}

/** エラーの記録（0234。この PC のアプリのデータだけ。本体が文を削ってから残す） */
export interface ErrorLogHost {
  /** 1件足す（種類・画面・操作・文だけ。日時・版・OS は本体が入れる） */
  add(entry: { kind: ErrorKind; place: string; action: string; message: string }): Promise<void>;
  /** 記録（utcOffsetMinutes はこの PC の時差。写す文の日時に使う） */
  get(utcOffsetMinutes: number): Promise<ErrorLogView>;
  /** すべて消す */
  clear(): Promise<ErrorLogView>;
  /** 報告に貼る文を写す（文は本体が記録から作る。写せたら true） */
  copy(): Promise<boolean>;
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
  /** 何番目に出すか（欄の見せ方の設定だけ） */
  order?: number;
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
/** カスタム層の設定の種類（説明の文・名前・欄の見せ方。0016 の 2026-11-02 の追記） */
export type CustomKind = "texts" | "terms" | "fields";
export interface CustomTextsStatus {
  /** どの設定か（古い本体では無い。無ければ説明の文） */
  kind?: CustomKind;
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
/** カスタム層の命令（読み書き・検査・指紋・承認は本体。画面からパスは渡さない）。kind の省略は説明の文 */
export interface CustomHost {
  status(kind?: CustomKind): Promise<CustomTextsStatus>;
  /** 承認待ちの中身を承認する（fingerprint は見せた状態の指紋。その後に変わっていたら E_CUSTOM_CHANGED） */
  approve(fingerprint: string, kind?: CustomKind): Promise<CustomTextsStatus>;
  /** 承認しない（前に承認した文のまま） */
  decline(fingerprint: string, kind?: CustomKind): Promise<CustomTextsStatus>;
  /** 事務所の文を全部やめて公式の文に戻す（ファイルは消さない） */
  revert(kind?: CustomKind): Promise<CustomTextsStatus>;
  /** 更新で公式の文が変わった行: keep なら「このまま使う」、false なら行を外して公式の文に戻す（どちらもその場で承認） */
  rows(ids: string[], keep: boolean, kind?: CustomKind): Promise<CustomTextsStatus>;
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
  /** エラーの記録（0234。無い画面〔テストの代わりの本体など〕では残さない） */
  errors?: ErrorLogHost;
  /** カスタム層（無い画面〔テストの代わりの本体など〕では、事務所の文を当てない） */
  custom?: CustomHost;
  /** Web のヒアリング（0125。無い画面では Web で聞く道具を出さない） */
  hearingWeb?: HearingWebHost;
}

const bytesOf = (b: ArrayBuffer | Uint8Array | number[]): Uint8Array => (b instanceof Uint8Array ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : Uint8Array.from(b));

/** 本体が返す、選んだ明細のファイルの並び（"STMF"・数〔u32 LE〕・それぞれの長さ〔u32 LE〕・中身を続けて）。空は選ばなかった */
export function unpackFiles(b: Uint8Array): Uint8Array[] {
  if (b.length === 0) return [];
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 8 || String.fromCharCode(...b.subarray(0, 4)) !== "STMF") throw "E_STATEMENT_OPEN";
  const n = dv.getUint32(4, true);
  if (n > 100 || 8 + n * 4 > b.length) throw "E_STATEMENT_OPEN";
  const out: Uint8Array[] = [];
  let at = 8 + n * 4;
  for (let i = 0; i < n; i++) {
    const len = dv.getUint32(8 + i * 4, true);
    if (at + len > b.length) throw "E_STATEMENT_OPEN";
    out.push(b.subarray(at, at + len));
    at += len;
  }
  return out;
}

export function tauriHost(): HostApi {
  return {
    kind: "tauri",
    custom: {
      status: (kind = "texts") => invoke<CustomTextsStatus>("custom_texts_status", { kind }),
      approve: (fingerprint, kind = "texts") => invoke<CustomTextsStatus>("custom_texts_approve", { fingerprint, kind }),
      decline: (fingerprint, kind = "texts") => invoke<CustomTextsStatus>("custom_texts_decline", { fingerprint, kind }),
      revert: (kind = "texts") => invoke<CustomTextsStatus>("custom_texts_revert", { kind }),
      rows: (ids, keep, kind = "texts") => invoke<CustomTextsStatus>("custom_texts_rows", { ids, keep, kind }),
      resetLedger: () => invoke<CustomTextsStatus>("custom_ledger_reset"),
      chooseDir: () => invoke<CustomTextsStatus | null>("custom_dir_choose"),
      resetDir: () => invoke<CustomTextsStatus>("custom_dir_reset"),
      createDir: () => invoke<CustomTextsStatus>("custom_dir_create"),
    },
    packs: async () => JSON.stringify(await invoke<unknown[]>("engine_packs")),
    listHouseholds: () => invoke<string[]>("list_households"),
    openHousehold: (id) => invoke<EngineRequest>("open_household", { id }),
    // 時間切れ（パソコンの負荷が高いとき）の枠だけ、待ってからもう一度頼む（0180 の2）
    compute: retryTimedOut((slots) => invoke<ComputeResponse>("compute", { slots })),
    evidence: (request) => invoke<FullResult | EngineError>("evidence", { request }),
    report: {
      render: (input, addressee, accent) => invoke<RenderInfo>("proposal_render", { input, addressee, accent: accent ?? null }),
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
      create: (body, summary, opts) =>
        invoke<StoredOpened>("store_create", { body, summary, category: opts?.category ?? null, sample: opts?.sample ?? null, reservedNames: opts?.reservedNames ?? null }),
      open: (id) => invoke<StoredOpened>("store_open", { id }),
      peekHearing: (id) => invoke<unknown>("store_peek_hearing", { id }),
      previousGeneration: (id) => invoke<PreviousGeneration | null>("store_previous_generation", { id }),
      openPrevious: (id) => invoke<StoredOpened>("store_open_previous", { id }),
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
      makeSample: (id, sample, reservedNames) => invoke<{ customerNo: string; duplicate: boolean }>("store_make_sample", { id, sample, reservedNames: reservedNames ?? null }),
      makeClient: (id) => invoke<boolean>("store_make_client", { id }),
      updateSample: (id, name, traits, family, age, reservedNames) =>
        invoke<void>("store_update_sample", { id, name, traits, family, age, reservedNames: reservedNames ?? null }),
      sampleReset: (id) => invoke<SampleResetOutcome>("store_sample_reset", { id }),
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
      acceptRoster: (key) => invoke<OfficeStatus>("office_accept_roster", { key }),
      defaults: () => invoke<unknown>("office_defaults_get"),
      putDefaults: (value) => invoke<void>("office_defaults_put", { value }),
      hearingRequests: () => invoke<unknown>("office_hearing_get"),
      putHearingRequests: (value) => invoke<void>("office_hearing_put", { value }),
      branding: () => invoke<unknown>("office_branding_get"),
      putBranding: (value) => invoke<unknown>("office_branding_put", { value }),
      pickLogo: () => invoke<unknown>("office_logo_pick"),
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
      openForm: (code, via) => invoke<void>("feedback_form_open", via === "ai" ? { code, via } : { code }),
      copy: (code) => invoke<boolean>("feedback_copy", { code }),
      copyReport: (text) => invoke<boolean>("feedback_report_copy", { text }),
    },
    errors: {
      add: (entry) => invoke<void>("error_log_add", { entry }),
      get: (utcOffsetMinutes) => invoke<ErrorLogView>("error_log_get", { utcOffsetMinutes }),
      clear: () => invoke<ErrorLogView>("error_log_clear"),
      copy: () => invoke<boolean>("error_log_copy"),
    },
    ai: {
      status: () => invoke<AiStatus>("ai_status"),
      setEnabled: (enabled) => invoke<AiStatus>("ai_set_enabled", { enabled }),
      setPrivacyPolicy: (confirmed) => invoke<AiStatus>("ai_set_privacy_policy", { confirmed }),
      copySetup: (client) => invoke<boolean>("ai_setup_copy", { client }),
      apps: () => invoke<AiAppsStatus>("ai_apps_status"),
      registerApp: (client) => invoke<AiAppsStatus>("ai_app_register", { client }),
      unregisterApp: (client) => invoke<AiAppsStatus>("ai_app_unregister", { client }),
      household: (id) => invoke<AiHouseholdView>("ai_household", { id }),
      recordConsent: (id, input) => invoke<AiHouseholdView>("ai_consent_record", { id, input }),
      startShare: (id, minutes, destination, notes, words) => invoke<AiHouseholdView>("ai_share_start", { id, minutes, destination, notes, words }),
      setNotesPolicy: (confirmed) => invoke<AiStatus>("ai_set_notes_policy", { confirmed }),
      setNotesDefault: (enabled) => invoke<AiStatus>("ai_set_notes_default", { enabled }),
      notesPreview: (ids, words) => invoke<AiNotesPreview[]>("ai_notes_preview", { ids, words }),
      stopShare: (id) => invoke<AiHouseholdView>("ai_share_stop", { id }),
      bulkCheck: (ids) => invoke<AiBulkOutcome>("ai_share_bulk_check", { ids }),
      bulkStart: (ids, minutes, destination, notes) => invoke<AiBulkOutcome>("ai_share_bulk_start", { ids, minutes, destination, notes }),
      bulkStop: (ids) => invoke<number>("ai_share_bulk_stop", { ids }),
      decide: (id, candidate, accept, plan) => invoke<AiHouseholdView>("ai_candidate_decide", { id, candidate, accept, plan }),
      takeDocuments: (id, candidate) => invoke<AiHouseholdView>("ai_documents_taken", { id, candidate }),
      householdCandidates: () => invoke<AiHouseholdCandidate[]>("ai_household_candidates"),
      discardHouseholdCandidate: (candidate) => invoke<AiHouseholdCandidate[]>("ai_household_candidate_discard", { candidate }),
      displayCandidates: () => invoke<AiDisplayCandidate[]>("ai_display_candidates"),
      hearingJobs: () => invoke<AiHearingJob[]>("ai_hearing_jobs"),
      hearingJobDone: (job, result) => invoke<boolean>("ai_hearing_job_done", { job, result }),
      hearingTemplateCandidates: () => invoke<AiHearingTemplateCandidate[]>("ai_hearing_template_candidates"),
      takeHearingTemplate: (candidate) => invoke<AiHearingTemplateCandidate[]>("ai_hearing_template_take", { candidate }),
      issueReportCandidates: () => invoke<AiIssueReportCandidate[]>("ai_issue_report_candidates"),
      takeIssueReport: (candidate) => invoke<AiIssueReportCandidate[]>("ai_issue_report_take", { candidate }),
      takeDisplayChange: (candidate, setting) => invoke<AiDisplayCandidate[]>("ai_display_change_take", { candidate, setting }),
      takeHouseholdDisplayChange: (id, candidate, setting) => invoke<AiHouseholdView>("ai_household_display_take", { id, candidate, setting }),
      createFromCandidate: (candidate, kind, body, summary, category) => invoke<StoredOpened>("ai_household_candidate_create", { candidate, kind, body, summary, category }),
    },
    statements: {
      office: () => invoke<StatementOfficeData>("statement_office"),
      learn: (entries, formats) => invoke<StatementOfficeData>("statement_learn", { entries, formats }),
      open: async () => unpackFiles(bytesOf(await invoke<ArrayBuffer>("statement_open"))),
      ocr: async (image) => {
        try {
          return await invoke<OcrPage>("statement_ocr", image);
        } catch (e) {
          throw new OcrFailure(typeof e === "string" ? e : "E_OCR_FAILED");
        }
      },
      saveSheet: (bytes, m) => invoke<SaveOutcome>("statement_sheet_save", bytes, { headers: { "x-customer-no": m.customerNo, "x-exported-on": m.exportedOn } }),
      openSheet: async () => {
        const b = bytesOf(await invoke<ArrayBuffer>("statement_sheet_open"));
        return b.length === 0 ? null : b;
      },
    },
    hearingWeb: {
      config: () => invoke<{ pageUrl: string; dev: boolean }>("hearing_web_config"),
      call: (r) => invoke<RelayResponse>("hearing_web_call", { method: r.method, path: r.path, token: r.token ?? null, body: r.body ?? null }),
      saveDocument: (bytes, m) => invoke<SaveOutcome>("hearing_document_save", bytes, { headers: { "x-file-name": encodeURIComponent(m.fileName) } }),
      // フォルダを本体の OS のダイアログで選び（パスは画面に来ない）、1つずつそのフォルダに書く
      saveDocuments: async (files) => {
        const pick = await invoke<{ picked: boolean; syncFolder: boolean }>("hearing_documents_folder");
        if (!pick.picked) return { picked: false, saved: [], failed: 0, syncFolder: false, via: "folder" };
        const saved: { index: number; fileName: string }[] = [];
        let failed = 0;
        for (const [index, f] of files.entries()) {
          try {
            const out = await invoke<SaveOutcome>("hearing_document_save_into", f.bytes, { headers: { "x-file-name": encodeURIComponent(f.fileName) } });
            if (out.saved) saved.push({ index, fileName: out.fileName ?? f.fileName });
            else failed++;
          } catch {
            failed++;
          }
        }
        return { picked: true, saved, failed, syncFolder: pick.syncFolder, via: "folder" };
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
      status: async (kind = "texts") => devJson<CustomTextsStatus>(await devCustom("status", { kind })),
      approve: async (fingerprint, kind = "texts") => devJson<CustomTextsStatus>(await devCustom("approve", { fingerprint, kind })),
      decline: async (fingerprint, kind = "texts") => devJson<CustomTextsStatus>(await devCustom("decline", { fingerprint, kind })),
      revert: async (kind = "texts") => devJson<CustomTextsStatus>(await devCustom("revert", { kind })),
      rows: async (ids, keep, kind = "texts") => devJson<CustomTextsStatus>(await devCustom("rows", { ids, keep, kind })),
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
      render: async (input, addressee, accent) => devJson<RenderInfo>(await fetch("/__dev/report/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input, addressee, accent: accent ?? null }) })),
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
      create: async (body, summary, opts) =>
        devJson<StoredOpened>(
          await devStore("create", {
            body,
            summary,
            ...(opts?.category !== undefined ? { category: opts.category } : {}),
            ...(opts?.sample !== undefined ? { sample: JSON.stringify(opts.sample) } : {}),
            ...(opts?.reservedNames !== undefined ? { reserved: JSON.stringify(opts.reservedNames) } : {}),
          }),
        ),
      open: async (id) => devJson<StoredOpened>(await devStore("open", { id })),
      peekHearing: async (id) => devJson<unknown>(await devStore("peekHearing", { id })),
      previousGeneration: async (id) => devJson<PreviousGeneration | null>(await devStore("previousGeneration", { id })),
      openPrevious: async (id) => devJson<StoredOpened>(await devStore("openPrevious", { id })),
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
      makeSample: async (id, sample, reservedNames) =>
        devJson<{ customerNo: string; duplicate: boolean }>(await devStore("makeSample", { id, sample: JSON.stringify(sample), reserved: JSON.stringify(reservedNames ?? []) })),
      makeClient: async (id) => devJson<boolean>(await devStore("makeClient", { id })),
      updateSample: async (id, name, traits, family, age, reservedNames) =>
        void (await devJson<unknown>(
          await devStore("updateSample", { id, name, traits: JSON.stringify(traits), family: String(family), age: String(age), reserved: JSON.stringify(reservedNames ?? []) }),
        )),
      sampleReset: async (id) => devJson<SampleResetOutcome>(await devStore("sampleReset", { id })),
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
      acceptRoster: async (code) => devJson<OfficeStatus>(await devOffice("acceptRoster", { code })),
      defaults: async () => devJson<unknown>(await devOffice("defaultsGet")),
      putDefaults: async (value) => void (await devJson<unknown>(await devOffice("defaultsPut", { value }))),
      hearingRequests: async () => devJson<unknown>(await devOffice("hearingGet")),
      putHearingRequests: async (value) => void (await devJson<unknown>(await devOffice("hearingPut", { value }))),
      branding: async () => devJson<unknown>(await devOffice("brandingGet")),
      putBranding: async (value) => devJson<unknown>(await devOffice("brandingPut", { value })),
      pickLogo: async () => devJson<unknown>(await devOffice("logoPick")),
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
      openForm: async (code, via) => void (await devJson<unknown>(await devNotices("openForm", via === "ai" ? { code, via } : { code }))),
      // 開発用のサーバーでは本体で写さない（画面がブラウザの仕組みで写す）
      copy: async () => false,
    },
    // エラーの記録: 開発用のサーバーではページのメモリの中だけ（文は削らない。画面の確かめ用）。写すのは画面がブラウザの仕組みで
    errors: devErrorLog(),
    // AI接続口: 開発用のサーバーのメモリの中の代わり（本物の受け口は開けない。画面の確かめ用）
    ai: {
      status: async () => devJson<AiStatus>(await devAi("status")),
      setEnabled: async (enabled) => devJson<AiStatus>(await devAi("setEnabled", { enabled })),
      setPrivacyPolicy: async (confirmed) => devJson<AiStatus>(await devAi("setPrivacyPolicy", { confirmed })),
      copySetup: async (client) => devJson<boolean>(await devAi("copySetup", { client })),
      household: async (id) => devJson<AiHouseholdView>(await devAi("household", { id })),
      recordConsent: async (id, input) => devJson<AiHouseholdView>(await devAi("recordConsent", { id, input })),
      startShare: async (id, minutes, destination) => devJson<AiHouseholdView>(await devAi("startShare", { id, minutes, destination })),
      stopShare: async (id) => devJson<AiHouseholdView>(await devAi("stopShare", { id })),
      decide: async (id, candidate, accept, plan) => devJson<AiHouseholdView>(await devAi("decide", { id, candidate, accept, plan })),
      takeDocuments: async (id, candidate) => devJson<AiHouseholdView>(await devAi("takeDocuments", { id, candidate })),
      householdCandidates: async () => devJson<AiHouseholdCandidate[]>(await devAi("householdCandidates")),
      discardHouseholdCandidate: async (candidate) => devJson<AiHouseholdCandidate[]>(await devAi("discardHouseholdCandidate", { candidate })),
      displayCandidates: async () => devJson<AiDisplayCandidate[]>(await devAi("displayCandidates")),
      hearingJobs: async () => devJson<AiHearingJob[]>(await devAi("hearingJobs")),
      hearingJobDone: async (job, result) => devJson<boolean>(await devAi("hearingJobDone", { job, result })),
      hearingTemplateCandidates: async () => devJson<AiHearingTemplateCandidate[]>(await devAi("hearingTemplates")),
      takeHearingTemplate: async (candidate) => devJson<AiHearingTemplateCandidate[]>(await devAi("takeHearingTemplate", { candidate })),
      issueReportCandidates: async () => devJson<AiIssueReportCandidate[]>(await devAi("issueReports")),
      takeIssueReport: async (candidate) => devJson<AiIssueReportCandidate[]>(await devAi("takeIssueReport", { candidate })),
      takeDisplayChange: async (candidate, setting) => devJson<AiDisplayCandidate[]>(await devAi("takeDisplayChange", { candidate, setting })),
      takeHouseholdDisplayChange: async (id, candidate, setting) => devJson<AiHouseholdView>(await devAi("takeHouseholdDisplayChange", { id, candidate, setting })),
      createFromCandidate: async (candidate, kind, body, summary, category) => devJson<StoredOpened>(await devAi("createFromCandidate", { candidate, kind, body, summary, ...(category !== undefined ? { category } : {}) })),
    },
    // 明細の取り込み: 覚えた辞書と形は開発用のサーバーのメモリの中だけ。開くは架空の明細（statement/test/fixtures）を順に返す
    statements: {
      office: async () => devJson<StatementOfficeData>(await fetch("/__dev/statement/office", { method: "POST" })),
      learn: async (entries, formats) => devJson<StatementOfficeData>(await fetch("/__dev/statement/learn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ entries, formats }) })),
      open: async () => {
        const res = await fetch("/__dev/statement/open");
        if (res.status === 204) return [];
        if (!res.ok) throw (await res.text()) || `E_DEV_${res.status}`;
        return unpackFiles(new Uint8Array(await res.arrayBuffer()));
      },
      // 文字認識の代わり: 開発用のサーバーが、ビルドした文字認識の道具（crates/statement-ocr の ocr_page。Mac は Vision）を呼ぶ
      ocr: async (image) => {
        const res = await fetch("/__dev/statement/ocr", { method: "POST", body: image as Uint8Array<ArrayBuffer> });
        if (!res.ok) throw new OcrFailure((await res.text()) || "E_OCR_FAILED");
        return (await res.json()) as OcrPage;
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
    // Web のヒアリング: 同じ所の受け付け（開発用のサーバーがメモリの置き場か手元の wrangler dev で受ける）。お客さまのページも同じ所の /h/
    hearingWeb: {
      config: async () => ({ pageUrl: `${location.origin}/h/`, dev: true }),
      call: async (r) => {
        const headers: Record<string, string> = {};
        if (r.token !== undefined) headers.authorization = `Bearer ${r.token}`;
        if (r.body !== undefined) headers["content-type"] = "application/json";
        const res = await fetch(`${API_PREFIX}${r.path}`, { method: r.method, headers, ...(r.body !== undefined ? { body: r.body } : {}), cache: "no-store" });
        return { status: res.status, body: await res.text() };
      },
      // 受け取った書類の保存は、ブラウザの保存の仕組み（フォルダを選べるブラウザはフォルダに、選べなければダウンロード。0191）
      saveDocument: (bytes, m) => browserSaveOne(bytes, m.fileName),
      saveDocuments: (files) => browserSaveAll(files),
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

/** 開発用のサーバーのエラーの記録（ページのメモリの中だけ。同じ文はまとめる） */
function devErrorLog(): ErrorLogHost {
  let view: ErrorLogView = { ...EMPTY_ERROR_LOG, entries: [] };
  const text = (v: ErrorLogView) => (v.entries.length === 0 ? "ファイナンシアのエラーの記録: ありません（開発用のサーバー）" : v.entries.map((e) => `- ${e.line}`).join("\n"));
  return {
    add: async (e) => {
      const now = new Date().toISOString();
      const same = view.entries.find((x) => x.kind === e.kind && x.place === e.place && x.action === e.action && x.message === e.message);
      const kindLabel = e.kind === "screen" ? "画面のエラー" : e.kind === "command" ? "本体の命令の失敗" : "計算できなかった";
      const entry = same !== undefined ? { ...same, count: same.count + 1, lastAt: now } : { firstAt: now, lastAt: now, count: 1, appVersion: "dev", os: "dev", kind: e.kind, kindLabel, place: e.place, action: e.action, message: e.message.slice(0, 300), line: "" };
      entry.line = `${entry.lastAt}・${entry.place}・${entry.action}・${entry.kindLabel}: ${entry.message}${entry.count > 1 ? `（${entry.count}回）` : ""}`;
      const entries = [entry, ...view.entries.filter((x) => x !== same)].slice(0, view.max);
      view = { ...view, entries };
      view = { ...view, text: text(view) };
    },
    get: async () => view,
    clear: async () => {
      view = { ...EMPTY_ERROR_LOG, entries: [] };
      view = { ...view, text: text(view) };
      return view;
    },
    copy: async () => false,
  };
}
