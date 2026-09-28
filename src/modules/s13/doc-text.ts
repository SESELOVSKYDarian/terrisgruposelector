/**
 * Flattens a Google Docs `documents.get` body into readable plain text, for documents that are not
 * necessarily in the S-13 table layout (instructions, older/hand-edited S-13 copies, anything). Tables
 * are rendered row by row with cells separated by " | ", so the structure stays visible in plain text.
 */

type TextRun = { content?: string };
type ParagraphElement = { textRun?: TextRun };
type Paragraph = { elements?: ParagraphElement[] };
type TableCell = { content?: BodyElement[] };
type TableRow = { tableCells?: TableCell[] };
type Table = { tableRows?: TableRow[] };
export type BodyElement = { paragraph?: Paragraph; table?: Table };

function paragraphText(paragraph: Paragraph | undefined): string {
  return (paragraph?.elements ?? []).map((element) => element.textRun?.content ?? "").join("");
}

function cellPlainText(cell: TableCell): string {
  return flatten(cell.content ?? []).join(" ").replace(/\s+/g, " ").trim();
}

function flatten(body: BodyElement[]): string[] {
  const lines: string[] = [];
  for (const element of body) {
    if (element.paragraph) {
      const text = paragraphText(element.paragraph).replace(/\n+$/, "");
      if (text.trim()) lines.push(text);
    } else if (element.table) {
      for (const row of element.table.tableRows ?? []) {
        const cells = (row.tableCells ?? []).map(cellPlainText);
        if (cells.some(Boolean)) lines.push(cells.join(" | "));
      }
      lines.push("");
    }
  }
  return lines;
}

export function documentPlainText(body: BodyElement[]): string {
  return flatten(body).join("\n").trim();
}

/** True when the flattened text has no readable content (e.g. a format conversion silently failed). */
export function isEffectivelyEmpty(text: string) {
  return text.replace(/[|\s]/g, "").length === 0;
}
