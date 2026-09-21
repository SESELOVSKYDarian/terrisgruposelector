/**
 * S-13 name format: surname + first-name initial ("Pérez J."). Profiles store a single
 * `full_name`, so this is a best-effort parse:
 *  - "Apellido, Nombre" -> uses the part before the comma as surname;
 *  - otherwise the LAST word is the surname and the first word gives the initial
 *    ("Juan Carlos Pérez" -> "Pérez J.").
 * Two-surname names are ambiguous without a dedicated column; a future profile field
 * should replace this heuristic.
 */
export function formatConductorName(fullName: string | null | undefined) {
  const name = (fullName ?? "").trim().replace(/\s+/g, " ");
  if (!name) return "";
  const comma = name.indexOf(",");
  if (comma > 0) {
    const surname = name.slice(0, comma).trim();
    const initial = name.slice(comma + 1).trim().charAt(0);
    return initial ? `${surname} ${initial.toUpperCase()}.` : surname;
  }
  const words = name.split(" ");
  if (words.length === 1) return words[0];
  const surname = words[words.length - 1];
  return `${surname} ${words[0].charAt(0).toUpperCase()}.`;
}
