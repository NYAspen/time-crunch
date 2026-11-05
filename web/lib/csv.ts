// Parses rows copied from Google Sheets/Excel (tab-separated) or a .csv file
// (comma-separated, with "quoted, values"; a quoted value can hold line breaks).
// The first row must be the headers. Blank rows are skipped.
// Returns one object per row keyed by lower-case header name.
export function parseTable(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n"); // Excel starts its files with a BOM
  const firstLine = clean.split("\n").find((line) => line.trim() !== "");
  if (firstLine === undefined) return [];

  const rows = firstLine.includes("\t")
    ? clean.split("\n").map((line) => line.split("\t"))
    : splitCsv(clean);
  const [headerRow, ...dataRows] = rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));

  const headers = headerRow.map((h) => h.trim().toLowerCase());
  return dataRows.map((cells) => Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? "").trim()])));
}

function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(current);
      current = "";
    } else if (ch === "\n") {
      cells.push(current);
      rows.push(cells);
      cells = [];
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  rows.push(cells);
  return rows;
}
