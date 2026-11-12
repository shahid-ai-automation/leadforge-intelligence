/** Pure discovery and import helpers. This module never collects data or calls a provider. */
import { calculateFitScore, prospectIdentity, sameIdentity, titleMatchesRole, type FitScore } from "./engine";
import type { ICP, Prospect } from "./model";

export type DiscoveryRow = { prospect: Prospect; fit: FitScore };
/** Filter caller-supplied records against the selected ICP; no fixtures are generated. */
export function discoverProspects(icp: ICP, prospects: Prospect[]): DiscoveryRow[] {
  return prospects.map(prospect => ({ prospect, fit: calculateFitScore(prospect, icp) })).filter(({ prospect, fit }) => {
    const points = (key: string) => fit.components.find(c => c.key === key)?.points ?? 0;
    const role = icp.roles.length === 0 ? prospect.roleCategory === "decision_maker" : titleMatchesRole(prospect.title, icp.roles);
    const size = prospect.employees >= icp.sizeMin && prospect.employees <= icp.sizeMax;
    return role && prospect.roleCategory !== "other" && points("industry") > 0 && points("geography") > 0 && size && ["excellent", "good"].includes(fit.classification);
  }).sort((a, b) => b.fit.total - a.fit.total || a.prospect.id.localeCompare(b.prospect.id));
}
export function discoveryEmptyCriteria(icp: ICP): string[] {
  return [icp.industries.length ? "target industries" : "select an industry", icp.countries.length ? "target countries" : "select a country", icp.roles.length ? "decision-maker titles" : "decision-maker roles", `employee range (${icp.sizeMin}–${icp.sizeMax})`];
}
export const sameIcp = (a: ICP, b: ICP) => JSON.stringify(a) === JSON.stringify(b);

export const SIZE_FILTER_PRESETS: { value: string; label: string; range: [number, number] }[] = [
  { value: "1-50", label: "1–50", range: [1, 50] },
  { value: "51-200", label: "51–200", range: [51, 200] },
  { value: "201-1000", label: "201–1,000", range: [201, 1000] },
  { value: "1001+", label: "1,001+", range: [1001, Number.MAX_SAFE_INTEGER] },
];
export function sizeFilterRange(option: string, icp: Pick<ICP, "sizeMin" | "sizeMax">, custom: { min: string; max: string }): [number, number] | null {
  if (option === "icp") return [icp.sizeMin, icp.sizeMax];
  if (option === "custom") {
    const min = custom.min.trim() === "" ? 0 : Number(custom.min);
    const max = custom.max.trim() === "" ? Number.MAX_SAFE_INTEGER : Number(custom.max);
    return Number.isFinite(min) && Number.isFinite(max) ? [Math.min(min, max), Math.max(min, max)] : null;
  }
  return SIZE_FILTER_PRESETS.find(p => p.value === option)?.range ?? null;
}

export interface ImportOutcome { added: number; duplicates: number; rejected: number; prospectIds: string[]; /** Blocked: identity previously opted out (Do Not Contact). */ suppressed?: number }
/** IDs returned are authoritative visible IDs, including existing duplicates; never merge records. */
export function importOutcome(before: Prospect[], after: Prospect[], incoming: Prospect[], wasSuppressed: (p: Prospect) => boolean = () => false): ImportOutcome {
  const old = new Set(before.map(p => p.id));
  const ids = new Set<string>();
  let added = 0;
  let rejected = 0;
  let suppressed = 0;
  for (const p of incoming) {
    // Suppressed identities are reported separately and never offered for campaign selection.
    if (wasSuppressed(p)) { suppressed++; continue; }
    const match = after.find(x => x.id === p.id || sameIdentity(prospectIdentity(x), prospectIdentity(p)));
    if (!match) { rejected++; continue; }
    if (ids.has(match.id)) continue;
    ids.add(match.id);
    if (!old.has(match.id)) added++;
  }
  return { added, duplicates: incoming.length - added - rejected - suppressed, rejected, prospectIds: [...ids], ...(suppressed ? { suppressed } : {}) };
}
export function importFailure(e: unknown): string {
  return e instanceof Error && e.message.includes("CONFLICT")
    ? "Another demo user saved a change. The latest workspace has been refreshed. Your reviewed prospects are kept; retry the import."
    : "Import was not confirmed. Check the connection, then retry the same reviewed prospects; duplicates will be skipped.";
}