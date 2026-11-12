import { describe, expect, it } from "vitest";
import { analyzeBuyerIntent, calculateLeadPriority, qualifiesForHandoff, simulationScript, suggestedReplyFor } from "./src/engine";
import { identityHashes } from "./src/suppression";
import { dedupeNewProspects, isProspectSuppressed } from "./src/workspace";
import type { Campaign, Prospect } from "./src/model";

const prospect = (overrides: Partial<Prospect> = {}): Prospect => ({
  id: "prospect-1", name: "Alex Morgan", title: "Founder", roleCategory: "decision_maker",
  company: "Northstar Systems", industry: "B2B SaaS", country: "United States", city: "Austin",
  employees: 80, need: "confirmed", needNote: "Expansion initiative", signals: [],
  channel: "LinkedIn", stage: "identified", replyStatus: "none", lastActivity: "2026-01-01T09:00:00.000Z",
  ...overrides,
});
const campaign = (overrides: Partial<Campaign> = {}): Campaign => ({
  id: "campaign-1", name: "Q1 Demo Campaign", objective: "appointments", status: "running",
  brief: null, prospectIds: ["prospect-1", "prospect-2"], templates: [], sequence: [],
  config: { followUps: 2, delayValue: 3, delayUnit: "days", sendingDays: "Working days",
    sendingHours: "09:00–17:00", timezone: "UTC", startMode: "immediate", duration: "manual",
    stopOnReply: true, stopOnOptOut: true, stopOnDecline: true, stopOnMeeting: true,
    stopOnHuman: true, stopOnInvalid: true,
    coolingOff: { enabled: false, runDays: 0, breakDays: 0, resumeDate: "", notifyBeforeRestart: false, requireApproval: true } },
  createdAt: "2026-01-01T00:00:00.000Z", events: [], simCursor: 0, prospectsContacted: 0, repliesDetected: 0,
  ...overrides,
});

describe("reply and buyer-intent parity contracts", () => {
  it("gives explicit opt-out precedence over simultaneous buying signals", () => {
    const result = analyzeBuyerIntent("We are actively evaluating this and can schedule a demo next week. Please remove me.");
    expect(result).toMatchObject({ score: 0, classification: "do_not_contact" });
    expect(result.recommendedAction).toMatch(/Stop all outreach immediately/);
  });
  it("distinguishes soft negative, neutral, early interest and high intent", () => {
    expect(analyzeBuyerIntent("No thanks, not right now.").classification).toBe("negative");
    expect(analyzeBuyerIntent("Thanks for connecting.").classification).toBe("neutral");
    expect(analyzeBuyerIntent("We are considering this solution.").classification).toBe("low");
    const high = analyzeBuyerIntent("We are actively looking for a solution this quarter. Can we schedule a demo next week? I make the decision.");
    expect(high.classification).toBe("high");
    expect(high.score).toBe(100);
  });
  it("applies the strict fit + intent handoff gate and opt-out override", () => {
    expect(qualifiesForHandoff(65, 60, false)).toBe(true);
    expect(qualifiesForHandoff(64, 100, false)).toBe(false);
    expect(qualifiesForHandoff(100, 59, false)).toBe(false);
    expect(qualifiesForHandoff(100, 100, true)).toBe(false);
    expect(qualifiesForHandoff(100, null, false)).toBe(false);
  });
  it("calculates priority deterministically and suppresses opted-out contacts", () => {
    expect(calculateLeadPriority(80, 60, false)).toMatchObject({ score: 72, classification: "medium" });
    expect(calculateLeadPriority(100, 100, true)).toMatchObject({ score: 0, classification: "suppressed" });
    expect(calculateLeadPriority(80, null, false).classification).toBe("pending");
  });
});
describe("campaign simulation and inbox response contracts", () => {
  it("produces a stable nine-event demo journey without sending messages", () => {
    const script = simulationScript(campaign(), ["Alex"]);
    expect(script).toHaveLength(9);
    expect(script[0]).toContain("simulation started");
    expect(script[3]).toContain("accepted the connection request (simulated)");
    expect(script[5]).toContain("Positive response simulated");
    expect(script[6]).toContain("automated follow-ups stopped");
    expect(script[8]).toContain("waiting for your review");
    expect(simulationScript(campaign(), ["Alex"])).toEqual(script);
  });
  it("does not invent campaign details when no approved brief is present", () => {
    expect(suggestedReplyFor(null, "High Buyer Intent")).toBe("Thank you for your reply — I'll follow up with the relevant details shortly.");
  });
  it("keeps suggested reply tone respectful for non-high intent", () => {
    expect(suggestedReplyFor(null, "Neutral Response")).not.toMatch(/book now|limited offer|guaranteed/i);
  });
});
describe("DNC identity and re-import contracts", () => {
  it("blocks identity fingerprints and stored prospect IDs", () => {
    const p = prospect();
    const fingerprints = identityHashes(p);
    expect(fingerprints.length).toBeGreaterThan(1);
    expect(isProspectSuppressed({ runtime: {}, suppressions: { [fingerprints[0]!]: p.id } }, p)).toBe(true);
    expect(isProspectSuppressed({ runtime: {}, suppressions: { "legacy-key": p.id } }, p)).toBe(true);
  });
  it("does not re-add an opted-out identity under a new record ID", () => {
    const optedOut = prospect();
    const reimported = prospect({ id: "prospect-reimported", importKey: optedOut.importKey, identityKeys: optedOut.identityKeys });
    expect(dedupeNewProspects([optedOut], [reimported])).toEqual([]);
  });
});
