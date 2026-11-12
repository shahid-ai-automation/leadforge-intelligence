import { describe, expect, it } from "vitest";
import { DEFAULT_ICP, DEFAULT_WORKFLOW, type Campaign, type Prospect } from "../model";
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
    prospects: [p], icp: DEFAULT_ICP, workflow: DEFAULT_WORKFLOW, customProspects: [],
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

  it("covers every scripted campaign simulation cursor and the terminal boundary", () => {
    const p = person();
    for (let cursor = 0; cursor < 9; cursor++) {
      const s = state({ campaigns: [campaign([p.id], { simCursor: cursor })] });
      const next = referenceTransition(s, { type: "CAMPAIGN_SIM_NEXT", id: "cmp-test" }, meta);
      expect(next.campaigns[0]?.simCursor).toBe(cursor + 1);
      expect(next.campaigns[0]?.events.at(-1)?.id).toBe(`ev-parity-seed-0`);
      expect(next.campaigns[0]?.events.at(-1)?.at).toBe("12:34");
    }
    const terminal = state({ campaigns: [campaign([p.id], { simCursor: 9 })] });
    expect(referenceTransition(terminal, { type: "CAMPAIGN_SIM_NEXT", id: "cmp-test" }, meta)).toBe(terminal);
  });

  it("guards manual stage movement after opt-out and allows valid movement", () => {
    const s = state();
    const moved = referenceTransition(s, { type: "MOVE_STAGE", prospectId: "p-001", stage: "engaged" }, meta);
    expect(moved.runtime["p-001"]?.stage).toBe("engaged");
    const opted = state({ runtime: { "p-001": { ...s.runtime["p-001"]!, optedOut: true, replyStatus: "opted_out" } } });
    expect(referenceTransition(opted, { type: "MOVE_STAGE", prospectId: "p-001", stage: "qualified" }, meta)).toBe(opted);
  });

  it("covers workflow simulation start, pause, restart, tick and terminal behavior", () => {
    const s = state();
    const started = referenceTransition(s, { type: "SIM_START" }, meta);
    expect(started.simRunning).toBe(true);
    const ticked = referenceTransition(started, { type: "SIM_TICK" }, meta);
    expect(ticked.simCursor).toBe(1);
    expect(ticked.workflow[0]?.status).toBe("active");
    const paused = referenceTransition(ticked, { type: "SIM_PAUSE" }, meta);
    expect(referenceTransition(paused, { type: "SIM_TICK" }, meta).simCursor).toBe(1);
    const restarted = referenceTransition(paused, { type: "SIM_RESTART" }, meta);
    expect(restarted.simCursor).toBe(0);
    expect(restarted.workflow.every(w => w.status === "pending")).toBe(true);
    const terminal = referenceTransition({ ...started, simCursor: started.workflow.length }, { type: "SIM_TICK" }, meta);
    expect(terminal.simRunning).toBe(false);
  });

  it("keeps notification queue and history caps", () => {
    const s = state({ notifications: [1,2,3].map(id => ({ id, title: "old", body: "", tone: "info" as const })), notifHistory: Array.from({length:50},(_,i)=>({id:i,title:"old",body:"",tone:"info" as const})) });
    const next = referenceTransition(s, { type: "NOTIFY", n: { id: 99, title: "new", body: "", tone: "success" } }, meta);
    expect(next.notifications).toHaveLength(3);
    expect(next.notifications.at(-1)?.title).toBe("new");
    expect(next.notifHistory).toHaveLength(50);
    expect(next.notifHistory[0]?.title).toBe("new");
    expect(referenceTransition(next, { type: "DISMISS_NOTIFICATION", id: 99 }, meta).notifications.some(n=>n.id===99)).toBe(false);
  });

  it("covers campaign create/update, status and restart transitions", () => {
    const c = campaign(["p-001"]);
    const s = state();
    const created = referenceTransition(s, { type: "SAVE_CAMPAIGN", campaign: c }, meta);
    expect(created.campaigns).toHaveLength(1);
    const updated = referenceTransition(created, { type: "SAVE_CAMPAIGN", campaign: { ...c, name: "Renamed" } }, meta);
    expect(updated.campaigns).toHaveLength(1);
    expect(updated.campaigns[0]?.name).toBe("Renamed");
    const running = referenceTransition(updated, { type: "CAMPAIGN_SET_STATUS", id: c.id, status: "running" }, meta);
    expect(running.campaigns[0]?.status).toBe("running");
    const progressed = { ...running, campaigns: [{ ...running.campaigns[0]!, simCursor: 5, prospectsContacted: 3, repliesDetected: 1, events: [{id:"ev",at:"x",text:"event"}] }] };
    const reset = referenceTransition(progressed, { type: "CAMPAIGN_RESTART", id: c.id }, meta);
    expect(reset.campaigns[0]).toMatchObject({ status: "approved", simCursor: 0, prospectsContacted: 0, repliesDetected: 0, events: [] });
    expect(referenceTransition(reset, { type: "DELETE_CAMPAIGN", id: c.id }, meta).campaigns).toHaveLength(0);
  });

  it("covers prospect edit normalization, delete and hidden sample behavior", () => {
    const s = state({ campaigns: [campaign(["p-001"])] , selectedProspectId: "p-001" });
    const edited = referenceTransition(s, { type: "UPDATE_PROSPECT", id: "p-001", patch: { name: "  Alex Updated  ", company: "  " } }, meta);
    expect(edited.prospectEdits["p-001"]?.name).toBe("Alex Updated");
    expect(edited.prospectEdits["p-001"]?.company).toBeUndefined();
    const deleted = referenceTransition(edited, { type: "DELETE_PROSPECT", id: "p-001" }, meta);
    expect(deleted.hiddenProspectIds).toContain("p-001");
    expect(deleted.selectedProspectId).toBeNull();
    expect(deleted.campaigns[0]?.prospectIds).toEqual([]);
  });

  it("supports hydrate as exact replacement", () => {
    const s = state();
    const hydrated = state({ selectedProspectId: "p-001" });
    expect(referenceTransition(s, { type: "HYDRATE", state: hydrated }, meta)).toBe(hydrated);
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
