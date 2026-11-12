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

describe("workspace helper parity contracts", () => {
  it("keeps hidden seed records in the known catalog for suppression", () => {
    const hiddenSeed = prospect({ id: "seed-hidden", name: "Casey Morgan" });
    const state = {
      customProspects: [],
      hiddenProspectIds: ["seed-hidden"],
      prospectEdits: {},
      runtime: { "seed-hidden": { optedOut: true } },
      suppressions: {},
    };
    const derived = deriveOptOutSuppressions([hiddenSeed], state);
    expect(Object.keys(derived).length).toBeGreaterThan(0);
    expect(isProspectSuppressed({ runtime: {}, suppressions: derived }, hiddenSeed)).toBe(true);
  });

  it("retains both original and edited identities in the append-only suppression map", () => {
    const original = prospect({ id: "p-edit", name: "Taylor Original" });
    const edited = { name: "Taylor Updated", company: "Updated Company" };
    const previous = { "legacy-fingerprint": "older-record" };
    const suppressions = deriveOptOutSuppressions([original], {
      customProspects: [],
      prospectEdits: { "p-edit": edited },
      runtime: { "p-edit": { optedOut: true } },
      suppressions: previous,
    });
    expect(suppressions["legacy-fingerprint"]).toBe("older-record");
    expect(isProspectSuppressed({ runtime: {}, suppressions }, original)).toBe(true);
    expect(isProspectSuppressed({ runtime: {}, suppressions }, { ...original, ...edited })).toBe(true);
  });

  it("blocks a stored prospect ID even when its current identity fields differ", () => {
    const changed = prospect({ id: "p-id-blocked", name: "Different Person", company: "Different Co" });
    expect(isProspectSuppressed({
      runtime: {},
      suppressions: { "historical-key": "p-id-blocked" },
    }, changed)).toBe(true);
  });

  it("does not mutate caller-owned collection or suppression objects", () => {
    const record = prospect();
    const state = {
      customProspects: [],
      hiddenProspectIds: [],
      prospectEdits: { "p-1": { company: "Local Company" } },
      runtime: { "p-1": { optedOut: true } },
      suppressions: { "existing-key": "older-id" },
    };
    const before = structuredClone(state);
    const result = deriveOptOutSuppressions([record], state);
    expect(state).toEqual(before);
    expect(result).not.toBe(state.suppressions);
  });
});
