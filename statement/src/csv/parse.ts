// CSV（と TSV）を欄の表にする（RFC 4180: 二重引用符・欄の中の改行とカンマ・"" は1つの "）。区切りはカンマかタブを最初の数行から決める
export interface CsvLimits {
  readonly maxRows: number;
  readonly maxCells: number;
  readonly maxCellChars: number;
}

export const CSV_LIMITS: CsvLimits = { maxRows: 20000, maxCells: 100, maxCellChars: 500 };

export class CsvError extends Error {}

function delimiterOf(text: string): string {
  const head = text.split(/\r?\n/u, 10).join("\n");
  const tabs = (head.match(/\t/gu) ?? []).length;
  const commas = (head.match(/,/gu) ?? []).length;
  return tabs > commas ? "\t" : ",";
}

/** CSV の文字列を行と欄にする（空の行は飛ばす）。行の番号（1始まり）も返す */
export function parseCsv(text: string, limits: CsvLimits = CSV_LIMITS): { cells: string[][]; lines: number[] } {
  const d = delimiterOf(text);
  const rows: string[][] = [];
  const lines: number[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  const pushCell = () => {
    if (cell.length > limits.maxCellChars) cell = cell.slice(0, limits.maxCellChars);
    row.push(cell);
    cell = "";
    if (row.length > limits.maxCells) throw new CsvError("cells");
  };
  const pushRow = () => {
    pushCell();
    if (row.some((c) => c.trim() !== "")) {
      rows.push(row);
      lines.push(rowLine);
      if (rows.length > limits.maxRows) throw new CsvError("rows");
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === d) pushCell();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      pushRow();
      line++;
      rowLine = line;
    } else if (ch === "\n") {
      pushRow();
      line++;
      rowLine = line;
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) pushRow();
  return { cells: rows, lines };
}
