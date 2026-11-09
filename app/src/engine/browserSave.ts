// ブラウザ（開発用のサーバーで画面だけを開いたとき）の、受け取った書類の保存（0191）。デスクトップのアプリは本体の平文の書き出しの出口（host.ts）。
// - フォルダを選べるブラウザ（File System Access の showDirectoryPicker）は、選んだフォルダに書く。同じ名前のファイルがあれば、中身が同じならそのまま、
//   違えば番号を足す（上書きしない）
// - 選べないブラウザは、ダウンロード（ブラウザのダウンロードのフォルダ。ブラウザの設定で毎回場所を聞くこともできる）
import type { FolderSaveOutcome, SaveOutcome } from "./host.ts";

interface Writable {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
interface FileHandleLike {
  getFile(): Promise<Blob>;
  createWritable(): Promise<Writable>;
}
interface DirHandleLike {
  getFileHandle(name: string, o?: { create?: boolean }): Promise<FileHandleLike>;
}
interface Pickers {
  showDirectoryPicker?: (o?: { mode?: "readwrite"; id?: string; startIn?: string }) => Promise<DirHandleLike>;
  showSaveFilePicker?: (o?: { suggestedName?: string; id?: string; startIn?: string }) => Promise<FileHandleLike>;
}

const pickers = (): Pickers => globalThis as unknown as Pickers;
const blobOf = (bytes: Uint8Array): Blob => new Blob([bytes as Uint8Array<ArrayBuffer>]);
const aborted = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";

/** ダウンロードで保存する（ブラウザが場所を決める） */
function download(bytes: Uint8Array, name: string): void {
  const url = URL.createObjectURL(blobOf(bytes));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function sameBytes(a: Blob, b: Uint8Array): Promise<boolean> {
  if (a.size !== b.length) return false;
  const x = new Uint8Array(await a.arrayBuffer());
  for (let i = 0; i < x.length; i++) if (x[i] !== b[i]) return false;
  return true;
}

/** 名前に番号を足す（A_源泉徴収票.jpg → A_源泉徴収票_2.jpg） */
const numbered = (name: string, n: number): string => (/\.[A-Za-z0-9]+$/.test(name) ? name.replace(/(\.[A-Za-z0-9]+)$/, `_${n}$1`) : `${name}_${n}`);

/** フォルダに1つ書く。同じ名前で同じ中身ならそのまま、違えば番号を足す。書いた（そのままの）名前を返す */
async function writeInto(dir: DirHandleLike, bytes: Uint8Array, name: string): Promise<string> {
  for (let n = 1; n < 100; n++) {
    const candidate = n === 1 ? name : numbered(name, n);
    const existing = await dir.getFileHandle(candidate).catch(() => null);
    if (existing !== null) {
      if (await sameBytes(await existing.getFile(), bytes)) return candidate;
      continue;
    }
    const h = await dir.getFileHandle(candidate, { create: true });
    const w = await h.createWritable();
    await w.write(blobOf(bytes));
    await w.close();
    return candidate;
  }
  throw new Error("E_SAVE_NAME");
}

export async function browserSaveOne(bytes: Uint8Array, fileName: string): Promise<SaveOutcome> {
  const p = pickers();
  if (typeof p.showSaveFilePicker === "function") {
    try {
      const h = await p.showSaveFilePicker({ suggestedName: fileName, id: "financia-documents", startIn: "documents" });
      const w = await h.createWritable();
      await w.write(blobOf(bytes));
      await w.close();
      return { saved: true, fileName: (h as { name?: string }).name ?? fileName, syncFolder: false, digest: null };
    } catch (e) {
      if (aborted(e)) return { saved: false, fileName: null, syncFolder: false, digest: null };
      throw e;
    }
  }
  download(bytes, fileName);
  return { saved: true, fileName, syncFolder: false, digest: null };
}

export async function browserSaveAll(files: readonly { bytes: Uint8Array; fileName: string }[]): Promise<FolderSaveOutcome> {
  const p = pickers();
  if (typeof p.showDirectoryPicker === "function") {
    let dir: DirHandleLike;
    try {
      dir = await p.showDirectoryPicker({ mode: "readwrite", id: "financia-documents", startIn: "documents" });
    } catch (e) {
      if (aborted(e)) return { picked: false, saved: [], failed: 0, syncFolder: false, via: "folder" };
      throw e;
    }
    const saved: { index: number; fileName: string }[] = [];
    let failed = 0;
    for (const [index, f] of files.entries()) {
      try {
        saved.push({ index, fileName: await writeInto(dir, f.bytes, f.fileName) });
      } catch {
        failed++;
      }
    }
    return { picked: true, saved, failed, syncFolder: false, via: "folder" };
  }
  // フォルダを選べないブラウザ: 1つずつダウンロード（続けてのダウンロードをブラウザが止めないよう、少し間をあける）
  const saved: { index: number; fileName: string }[] = [];
  for (const [index, f] of files.entries()) {
    download(f.bytes, f.fileName);
    saved.push({ index, fileName: f.fileName });
    if (index < files.length - 1) await new Promise((r) => setTimeout(r, 250));
  }
  return { picked: true, saved, failed: 0, syncFolder: false, via: "downloads" };
}
