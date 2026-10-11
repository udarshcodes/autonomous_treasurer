/** Minimal RFC 4180-style parser with delimiter detection (comma, tab, semicolon, pipe). */

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  const counts = [",", "\t", ";", "|"].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0] && counts[0][1] > 0 ? counts[0][0] : ",";
}

export function parseDelimited(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field.trim() === "") {
      quoted = true;
      field = "";
    } else if (c === delimiter) {
      row.push(field.trim());
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim());
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field.trim());
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}
