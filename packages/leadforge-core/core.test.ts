import { describe, expect, it } from "vitest";
import { draftStatus, editDraft, reviewDraft } from "./src/drafts";
import { discoverProspects, importOutcome, sizeFilterRange } from "./src/discovery";
import { sha256Hex, identityHashes } from "./src/suppression";
import { dedupeNewProspects, deriveOptOutSuppressions, isProspectSuppressed, listWorkspaceProspects } from "./src/workspace";
import type { ICP, Prospect } from "./src/model";

const prospect = (overrides: Partial<Prospect> = {}): Prospect => ({
  id: "p-1",
  name: "Jordan Lee",
  title: "Founder",
  roleCategory: "decision_maker",
  company: "Northstar Software",
  industry: "B2B SaaS",
  country: "United States",
  city: "Austin",
  employees: 50,
  need: "confirmed",
  needNote: "Hiring growth",
  signals: [],
  channel: "LinkedIn",
  stage: "identified",
  replyStatus: "none",
  lastActivity: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const icp: ICP = {
  industries: ["B2B SaaS"],
  countries: ["United States"],
  sizeMin: 10,
  sizeMax: 200,
  roles: ["Founder"],
  challenges: [],
  services: [],
};

describe("draft review invariants", () => {
  it("increments version and preserves draft status on edit", () => {
    const edited = editDraft(undefined, { prospectId: "p-1", category: "intro", body: "Hello", approved: true });
    expect(edited).toMatchObject({ approved: false, status: "draft", version: 1 });
    expect(draftStatus(edited)).toBe("draft");
  });
  it("makes approval explicit and prevents editing approved content", () => {
    const draft = { prospectId: "p-1", category: "intro", body: "Hello", approved: false, version: 2 };
    const approved = reviewDraft(draft, "approved");
    expect(approved).toMatchObject({ approved: true, status: "approved", version: 3 });
    expect(() => editDraft(approved, { ...approved, body: "Changed" })).toThrow(/read-only/);
  });
  it("does not silently re-review a rejected draft", () => {
    const rejected = reviewDraft({ prospectId: "p-1", category: "intro", body: "No", approved: false }, "rejected");
    expect(rejected.status).toBe("rejected");
    expect(() => reviewDraft(rejected, "approved")).toThrow(/Edit rejected content/);
  });
});

describe("discovery and import invariants", () => {
  it("returns only qualifying prospects in deterministic score order", () => {
    const low = prospect({ id: "p-2", industry: "Retail" });
    const result = discoverProspects(icp, [low, prospect()]);
    expect(result.map(row => row.prospect.id)).toEqual(["p-1"]);
    expect(result[0]?.fit.total).toBe(100);
  });
  it("reports imported duplicates without inflating added count", () => {
    const existing = prospect();
    const incoming = [prospect({ id: "p-1" }), prospect({ id: "p-2" })];
    const outcome = importOutcome([existing], [existing], incoming);
    expect(outcome).toMatchObject({ added: 0, duplicates: 2, rejected: 0, prospectIds: ["p-1"] });
  });
  it("normalizes custom size bounds and rejects non-numeric bounds", () => {
    expect(sizeFilterRange("custom", icp, { min: "200", max: "10" })).toEqual([10, 200]);
    expect(sizeFilterRange("custom", icp, { min: "abc", max: "20" })).toBeNull();
  });
});

describe("identity suppression and workspace isolation", () => {
  it("matches the standard SHA-256 test vector", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("deduplicates by identity and keeps workspace edits local", () => {
    const first = prospect();
    const duplicate = prospect({ id: "p-2" });
    expect(dedupeNewProspects([], [first, duplicate]).map(p => p.id)).toEqual(["p-1"]);
    const visible = listWorkspaceProspects([first], {
      customProspects: [],
      hiddenProspectIds: [],
      prospectEdits: { "p-1": { company: "Edited Co" } },
    });
    expect(visible[0]?.company).toBe("Edited Co");
    expect(first.company).toBe("Northstar Software");
  });
  it("suppresses all known identity fingerprints after opt-out", () => {
    const optedOut = prospect();
    expect(identityHashes(optedOut).length).toBeGreaterThan(0);
    const suppressions = deriveOptOutSuppressions([optedOut], {
      customProspects: [],
      prospectEdits: {},
      runtime: { "p-1": { optedOut: true } },
      suppressions: {},
    });
    expect(Object.keys(suppressions).length).toBeGreaterThan(0);
    expect(isProspectSuppressed({ runtime: {}, suppressions }, optedOut)).toBe(true);
  });
});
