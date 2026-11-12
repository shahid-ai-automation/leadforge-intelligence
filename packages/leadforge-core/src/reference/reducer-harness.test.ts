import { describe, expect, it } from "vitest";
import { DEFAULT_ICP, type Campaign, type Prospect } from "../model";
import { analyzeBuyerIntent } from "../engine";
import { identityHashes } from "../suppression";
import { referenceTransition, type RefState } from "./reducer-harness";

const person = (id = "p-001", overrides: Partial<Prospect> = {}): Prospect => ({
  id, name: "Alex Morgan", title: "Founder", roleCategory: "decision_maker",
  company: "Northstar Systems", industry: "B2B SaaS", country: "United States",
  city: "Austin", employees: 45, need: "confirmed", needNote: "Synthetic test signal",
  signals: ["Synthetic signal"], channel: "Email", stage: "outreach",
  replyStatus: "none", lastActivity: "Synthetic baseline", ...overrides,
});

const campaign = (prospectIds: string[], overrides: Partial<Campaign> = {}) => ({
  id: "cmp-test", name: "Synthetic campaign", objective: "service", status: "running",
  brief: null, prospectIds, templates: [], sequence: [], config: {}, createdAt: "fixed",
  events: [], simCursor: 0, prospectsContacted: 0, repliesDetected: 0, ...overrides,
} as unknown as Campaign);

const state = (overrides: Partial<RefState> = {}): RefState => {
  const p = person();
  return {
    prospects: [p], icp: DEFAULT_ICP,
    runtime: { [p.id]: { stage: p.stage, replyStatus: p.replyStatus, intentScore: null, intentResult: null, optedOut: false, lastActivity: p.lastActivity } },
    campaigns: [], inbox: [], conversations: [], drafts: {}, suppressions: {},
    activity: [], notifications: [], notifHistory: [], selectedProspectId: null,
    hiddenProspectIds: [], prospectEdits: {}, simCursor: 0, simRunning: false,
    ...overrides,
  };
};
const meta = { seed: "parity-seed-", at: "12:34" };

describe("fixture-free reducer reference parity harness", () => {
  it("records incoming replies, classifies intent, and appends conversation messages", () => {
    const s = state();
    const text = "We are actively looking for help. Can we schedule a demo next week?";
    const next = referenceTransition(s, { type: "SUBMIT_REPLY", prospectId: "p-001", text }, meta);
    expect(next.runtime["p-001"]?.intentResult).toEqual(analyzeBuyerIntent(text));
    expect(next.conversations).toHaveLength(1);
    expect(next.conversations[0]?.messages.at(-1)).toMatchObject({ from: "prospect", text, at: "12:34" });
    expect(next.activity[0]?.id).toBe("a-parity-seed-0");
  });

  it("makes opt-out sticky and stores identity fingerprints", () => {
    const s = state();
    const next = referenceTransition(s, { type: "SUBMIT_REPLY", prospectId: "p-001", text: "Please remove me and do not contact me again." }, meta);
    expect(next.runtime["p-001"]?.optedOut).toBe(true);
    expect(next.runtime["p-001"]?.replyStatus).toBe("opted_out");
    for (const hash of identityHashes(s.prospects[0]!)) expect(next.suppressions[hash]).toBe("p-001");
    const later = referenceTransition(next, { type: "SUBMIT_REPLY", prospectId: "p-001", text: "Actually, tell me more." }, meta);
    expect(later.runtime["p-001"]?.optedOut).toBe(true);
    expect(later.runtime["p-001"]?.replyStatus).toBe("opted_out");
  });

  it("simulates connection acceptance with deterministic event metadata", () => {
    const p = person();
    const s = state({ campaigns: [campaign([p.id], { simCursor: 3 })] });
    const a = { type: "CAMPAIGN_SIM_NEXT" as const, id: "cmp-test" };
    const left = referenceTransition(s, a, meta);
    const right = referenceTransition(s, a, meta);
    expect(left).toEqual(right);
    expect(left.campaigns[0]?.simCursor).toBe(4);
    expect(left.runtime[p.id]?.stage).toBe("engaged");
    expect(left.campaigns[0]?.events[0]).toMatchObject({ id: "ev-parity-seed-0", at: "12:34" });
  });

  it("creates an inbox item and intent update at the scripted reply transition", () => {
    const p = person();
    const s = state({ campaigns: [campaign([p.id], { simCursor: 5 })] });
    const next = referenceTransition(s, { type: "CAMPAIGN_SIM_NEXT", id: "cmp-test" }, meta);
    expect(next.campaigns[0]?.simCursor).toBe(6);
    expect(next.campaigns[0]?.repliesDetected).toBe(1);
    expect(next.inbox[0]).toMatchObject({ prospectId: p.id, campaignId: "cmp-test", status: "awaiting" });
    expect(next.runtime[p.id]?.replyStatus).toBe("positive");
    expect(next.notifications.at(-1)?.title).toBe("New Interested Prospect");
  });

  it("blocks campaign simulation for stopped campaigns and fully suppressed audiences", () => {
    const p = person();
    const stopped = state({ campaigns: [campaign([p.id], { status: "paused" })] });
    expect(referenceTransition(stopped, { type: "CAMPAIGN_SIM_NEXT", id: "cmp-test" }, meta)).toBe(stopped);
    const blocked = state({
      campaigns: [campaign([p.id])],
      runtime: { [p.id]: { stage: p.stage, replyStatus: "opted_out", intentScore: null, intentResult: null, optedOut: true, lastActivity: "opted out" } },
    });
    expect(referenceTransition(blocked, { type: "CAMPAIGN_SIM_NEXT", id: "cmp-test" }, meta)).toBe(blocked);
  });

  it("approves an awaiting inbox reply, records simulated conversation and notification", () => {
    const p = person();
    const item = { id: "in-1", prospectId: p.id, campaignId: "cmp-test", incomingText: "Interested", at: "11:00",
      intentScore: 80, intentLabel: "High Intent", intentClass: "high", recommendedAction: "Book a meeting",
      suggestedReply: "Original suggestion", category: "high", status: "awaiting" } as const;
    const s = state({ inbox: [item as any] });
    const next = referenceTransition(s, { type: "INBOX_APPROVE", id: item.id, reply: "Edited approved reply" }, meta);
    expect(next.inbox[0]).toMatchObject({ status: "approved", suggestedReply: "Edited approved reply" });
    expect(next.conversations[0]?.messages[0]).toMatchObject({ from: "you", text: "Edited approved reply", at: "12:34" });
    expect(next.notifications.at(-1)?.title).toBe("Response Approved");
    expect(next.runtime[p.id]?.stage).toBe("qualified");
  });

  it("enforces reminder, reject, dismiss and DNC approval guards", () => {
    const p = person();
    const item = { id: "in-2", prospectId: p.id, campaignId: null, incomingText: "Maybe", at: "11:00",
      intentScore: 20, intentLabel: "Low", intentClass: "negative", recommendedAction: "Follow up later",
      suggestedReply: "Thanks", category: "none", status: "awaiting" } as const;
    const s = state({ inbox: [item as any] });
    const reminder = referenceTransition(s, { type: "INBOX_REMINDER", id: item.id, days: 30 }, meta);
    expect(reminder.inbox[0]).toMatchObject({ status: "reminder", reminderDays: 30 });
    const rejected = referenceTransition(s, { type: "INBOX_REJECT", id: item.id }, meta);
    expect(rejected.inbox[0]?.status).toBe("rejected");
    const dismissed = referenceTransition(s, { type: "INBOX_DISMISS", id: item.id }, meta);
    expect(dismissed.inbox[0]?.status).toBe("dismissed");
    const optedOut = state({
      inbox: [item as any],
      runtime: { [p.id]: { stage: p.stage, replyStatus: "opted_out", intentScore: null, intentResult: null, optedOut: true, lastActivity: "opted out" } },
    });
    expect(referenceTransition(optedOut, { type: "INBOX_APPROVE", id: item.id, reply: "Must not send" }, meta)).toBe(optedOut);
    expect(referenceTransition(optedOut, { type: "INBOX_REMINDER", id: item.id, days: 7 }, meta)).toBe(optedOut);
  });

  it("preserves permanent DNC identities across reset", () => {
    const p = person();
    const hashes = Object.fromEntries(identityHashes(p).map(h => [h, p.id]));
    const current = state({ suppressions: hashes, selectedProspectId: p.id });
    const baseline = state({ selectedProspectId: null, suppressions: {} });
    const next = referenceTransition(current, { type: "RESET", baseline }, meta);
    expect(next.selectedProspectId).toBeNull();
    expect(next.suppressions).toEqual(hashes);
  });

  it("preserves draft approval state machine and blocks approvals after opt-out", () => {
    const p = person();
    const s = state();
    const draft = { prospectId: p.id, category: "intro", body: "Draft", approved: false, status: "draft" as const, version: 1 };
    const saved = referenceTransition(s, { type: "SAVE_DRAFT", draft }, meta);
    const approved = referenceTransition(saved, { type: "REVIEW_DRAFT", prospectId: p.id, status: "approved" }, meta);
    expect(approved.drafts[p.id]).toMatchObject({ approved: true, status: "approved", version: 2 });
    expect(() => referenceTransition(approved, { type: "SAVE_DRAFT", draft }, meta)).toThrow(/read-only/);
    const optedOut = state({
      runtime: { [p.id]: { stage: p.stage, replyStatus: "opted_out", intentScore: null, intentResult: null, optedOut: true, lastActivity: "opted out" } },
      drafts: { [p.id]: draft },
    });
    expect(referenceTransition(optedOut, { type: "REVIEW_DRAFT", prospectId: p.id, status: "approved" }, meta)).toBe(optedOut);
  });

  it("produces byte-for-byte stable ids and timestamps for identical action metadata", () => {
    const s = state();
    const action = { type: "SUBMIT_REPLY" as const, prospectId: "p-001", text: "Please remove me from your list." };
    const a = referenceTransition(s, action, meta);
    const b = referenceTransition(s, action, meta);
    expect(a.activity[0]?.id).toBe("a-parity-seed-0");
    expect(a.activity[0]?.at).toBe("12:34");
    expect(a).toEqual(b);
  });
});
