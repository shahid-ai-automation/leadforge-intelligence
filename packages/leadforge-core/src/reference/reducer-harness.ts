/**
 * Fixture-free reducer reference harness.
 *
 * Behavioral oracle transcribed from the read-only Development Remix source:
 * src/components/outbound-intelligence/state.ts
 * pinned commit: d84685707d15a5f23321d35bdc3f9ddc7a950386
 *
 * This is test-only reference code, not production reducer code. It accepts
 * injected synthetic records and deliberately has no demoData/store/network imports.
 */
import type { ActivityEvent, Campaign, ChatMessage, Conversation, InboxItem, Prospect, PipelineStage, ReplyStatus } from "../model";
import { analyzeBuyerIntent, calculateFitScore, calculateLeadPriority, qualifiesForHandoff, simulationScript, suggestedReplyFor } from "../engine";
import { identityHashes } from "../suppression";
import { editDraft, reviewDraft, type DraftMessage } from "../drafts";

export interface RefRuntime {
  stage: PipelineStage;
  replyStatus: ReplyStatus;
  intentScore: number | null;
  intentResult: ReturnType<typeof analyzeBuyerIntent> | null;
  optedOut: boolean;
  lastActivity: string;
}
export interface RefNotification {
  id: number; title: string; body: string; tone: "info" | "success" | "warn";
  link?: { screen: string; id?: string };
}
export interface RefState {
  prospects: Prospect[];
  icp: import("../model").ICP;
  runtime: Record<string, RefRuntime>;
  campaigns: Campaign[];
  inbox: InboxItem[];
  conversations: Conversation[];
  drafts: Record<string, DraftMessage>;
  suppressions: Record<string, string>;
  activity: ActivityEvent[];
  notifications: RefNotification[];
  notifHistory: RefNotification[];
  selectedProspectId: string | null;
  hiddenProspectIds: string[];
  prospectEdits: Record<string, Partial<Pick<Prospect, "name" | "title" | "company" | "city" | "country">>>;
  simCursor: number;
  simRunning: boolean;
}
export interface RefMeta { seed: string; at: string }
export type RefAction =
  | { type: "SUBMIT_REPLY"; prospectId: string; text: string }
  | { type: "CAMPAIGN_SIM_NEXT"; id: string }
  | { type: "INBOX_APPROVE"; id: string; reply: string }
  | { type: "INBOX_REMINDER"; id: string; days: number }
  | { type: "INBOX_REJECT"; id: string }
  | { type: "INBOX_DISMISS"; id: string }
  | { type: "RESET"; baseline: RefState }
  | { type: "SAVE_DRAFT"; draft: DraftMessage }
  | { type: "REVIEW_DRAFT"; prospectId: string; status: "approved" | "rejected" };

const visibleProspect = (s: RefState, id: string) => {
  const p = s.prospects.find(x => x.id === id && !s.hiddenProspectIds.includes(id));
  return p ? { ...p, ...(s.prospectEdits[id] ?? {}) } : undefined;
};
const optedOut = (s: RefState, id: string) => !!s.runtime[id]?.optedOut;
const isSuppressed = (s: RefState, p: Prospect) =>
  optedOut(s, p.id) || identityHashes(p).some(h => h in s.suppressions) || Object.values(s.suppressions).includes(p.id);

export function referenceTransition(s: RefState, a: RefAction, meta: RefMeta, notificationStart = 100): RefState {
  let uidN = 0;
  let notifN = notificationStart;
  const uid = () => `${meta.seed}${(uidN++).toString(36)}`;
  const now = () => meta.at;
  const log = (items: ActivityEvent[], icon: string, text: string) =>
    [{ id: `a-${uid()}`, icon, text, at: now() }, ...items].slice(0, 40);
  const push = (items: RefNotification[], n: Omit<RefNotification, "id">) =>
    [...items, { ...n, id: ++notifN }].slice(-3);
  const history = (items: RefNotification[], n: Omit<RefNotification, "id">) =>
    [{ ...n, id: ++notifN }, ...items].slice(0, 50);

  switch (a.type) {
    case "RESET":
      return { ...a.baseline, suppressions: { ...a.baseline.suppressions, ...s.suppressions } };
    case "SAVE_DRAFT": {
      if (optedOut(s, a.draft.prospectId)) return s;
      const draft = editDraft(s.drafts[a.draft.prospectId], a.draft);
      return { ...s, drafts: { ...s.drafts, [draft.prospectId]: draft } };
    }
    case "REVIEW_DRAFT": {
      const old = s.drafts[a.prospectId];
      if (!old) throw new Error("NOT_FOUND: Draft unavailable.");
      if (a.status === "approved" && optedOut(s, a.prospectId)) return s;
      const next = reviewDraft(old, a.status);
      return next === old ? s : { ...s, drafts: { ...s.drafts, [a.prospectId]: next } };
    }
    case "SUBMIT_REPLY": {
      const p = visibleProspect(s, a.prospectId);
      const rt = s.runtime[a.prospectId];
      if (!p || !rt) return s;
      const result = analyzeBuyerIntent(a.text);
      const fit = calculateFitScore(p, s.icp).total;
      const wasOptedOut = rt.optedOut;
      const isOptOutReply = wasOptedOut || result.classification === "do_not_contact";
      const replyStatus: ReplyStatus = isOptOutReply ? "opted_out" : result.classification === "negative" ? "negative" : result.classification === "neutral" ? "neutral" : "positive";
      let stage = rt.stage;
      let activity = s.activity, notifications = s.notifications, notifHistory = s.notifHistory;
      if (wasOptedOut) {
        activity = log(activity, "shield", `Reply recorded for ${p.name} — remains Do Not Contact; outreach stays suppressed`);
      } else if (isOptOutReply) {
        activity = log(activity, "shield", `${p.name} opted out — outreach suppressed across all channels`);
        const n = { tone: "warn" as const, title: "Do Not Contact", body: `${p.name} asked to be removed. All outreach stopped.` };
        notifications = push(notifications, n); notifHistory = history(notifHistory, n);
      } else if (qualifiesForHandoff(fit, result.score, false)) {
        stage = "qualified";
        const priority = calculateLeadPriority(fit, result.score, false);
        activity = log(activity, "gitbranch", `${p.name} qualified — Priority ${priority.score} (Fit ${fit} · Intent ${result.score}) → routed to sales`);
        const n = { tone: "success" as const, title: "Opportunity Qualified", body: `${p.name} · ${p.company} — Priority ${priority.score}. Routed to the pipeline.` };
        notifications = push(notifications, n); notifHistory = history(notifHistory, n);
      } else {
        activity = log(activity, "brain", `Intent analyzed for ${p.name}: ${result.classificationLabel} (${result.score}/100)`);
        if (result.classification === "high") {
          const n = { tone: "info" as const, title: "High Intent Detected", body: `${p.name} scored ${result.score}/100 intent, but fit ${fit} is below the handoff gate (65).` };
          notifications = push(notifications, n); notifHistory = history(notifHistory, n);
        }
      }
      const msg: ChatMessage = { from: "prospect", text: a.text, at: now() };
      const conversations = s.conversations.some(c => c.prospectId === p.id)
        ? s.conversations.map(c => c.prospectId === p.id ? { ...c, messages: [...c.messages, msg] } : c)
        : [...s.conversations, { prospectId: p.id, channel: p.channel, messages: [msg] }];
      const suppressions = isOptOutReply ? Object.assign({ ...s.suppressions }, ...identityHashes(p).map(h => ({ [h]: p.id }))) : s.suppressions;
      return { ...s, conversations, activity, notifications, notifHistory, suppressions,
        runtime: { ...s.runtime, [p.id]: { ...rt, stage, replyStatus, optedOut: isOptOutReply, intentScore: result.score, intentResult: result, lastActivity: `Replied · ${now()}` } } };
    }
    case "CAMPAIGN_SIM_NEXT": {
      const c = s.campaigns.find(x => x.id === a.id);
      if (!c || c.status !== "running") return s;
      const eligible = c.prospectIds.filter(id => !optedOut(s, id));
      if (c.prospectIds.length > 0 && eligible.length === 0) return s;
      const names = eligible.map(id => visibleProspect(s, id)?.name).filter((n): n is string => Boolean(n));
      const script = simulationScript({ ...c, prospectIds: eligible }, names);
      if (c.simCursor >= script.length) return s;
      const text = script[c.simCursor]!;
      const ev = { id: `ev-${uid()}`, at: now(), text };
      const isReply = text.includes("Positive response simulated");
      const isApproval = text.includes("Approval requested");
      const isAccept = text.includes("accepted the connection request");
      let inbox = s.inbox, notifications = s.notifications, notifHistory = s.notifHistory;
      let runtime = s.runtime, conversations = s.conversations;
      let repliesDetected = c.repliesDetected;
      if (isAccept) {
        const id = eligible[0], rt = id ? runtime[id] : undefined;
        if (id && rt && !rt.optedOut) runtime = { ...runtime, [id]: { ...rt, stage: "engaged", lastActivity: `Connection accepted (simulated) · ${now()}` } };
      }
      if (isReply) {
        repliesDetected++;
        const id = eligible[0], p = id ? visibleProspect(s, id) : undefined;
        if (p) {
          const replyText = p.industry === "Real Estate"
            ? "Thanks for connecting. This is exactly what we need — we are evaluating automation for our property operations this quarter. Could we schedule a demo next week? I lead this decision."
            : p.industry === "Healthcare"
              ? "Thanks for reaching out. We are evaluating patient engagement tools this quarter — could we schedule a demo next week? I make this decision."
              : "Thanks for reaching out. We are actively looking for help with this — could we schedule a demo next week? I decide on this.";
          const intent = analyzeBuyerIntent(replyText), rt = runtime[p.id];
          if (rt) runtime = { ...runtime, [p.id]: { ...rt, stage: rt.stage === "qualified" || rt.stage === "meeting" ? rt.stage : "interested", replyStatus: "positive", intentScore: intent.score, intentResult: intent, lastActivity: `Replied · ${now()}` } };
          const msg: ChatMessage = { from: "prospect", text: replyText, at: now() };
          conversations = conversations.some(cv => cv.prospectId === p.id)
            ? conversations.map(cv => cv.prospectId === p.id ? { ...cv, messages: [...cv.messages, msg] } : cv)
            : [...conversations, { prospectId: p.id, channel: p.channel, messages: [msg] }];
          inbox = [{ id: `inbox-${uid()}`, prospectId: p.id, campaignId: c.id, incomingText: replyText, at: now(), intentScore: intent.score, intentLabel: intent.classificationLabel, intentClass: intent.classification, recommendedAction: intent.recommendedAction, suggestedReply: suggestedReplyFor(c.brief, intent.classificationLabel).replaceAll("{firstName}", p.name.split(" ")[0] ?? p.name), category: intent.score >= 60 ? "high" : intent.score >= 35 ? "review" : "none", status: "awaiting" }, ...inbox];
          const n = { tone: "info" as const, title: "New Interested Prospect", body: `${p.name} replied to “${c.name}”. AI has prepared a suggested response.`, link: { screen: "inbox" } };
          notifications = push(notifications, n); notifHistory = history(notifHistory, n);
        }
      }
      if (isApproval) {
        const n = { tone: "warn" as const, title: "Response Awaiting Your Approval", body: `A suggested reply for “${c.name}” is waiting in the Intelligence Inbox.`, link: { screen: "inbox" } };
        notifications = push(notifications, n); notifHistory = history(notifHistory, n);
      }
      const campaigns = s.campaigns.map(x => x.id === a.id ? { ...x, events: [...x.events, ev], simCursor: x.simCursor + 1, prospectsContacted: Math.max(x.prospectsContacted, Math.min(eligible.length, (x.simCursor + 1) * 3)), repliesDetected } : x);
      return { ...s, campaigns, inbox, notifications, notifHistory, runtime, conversations, activity: log(s.activity, "send", `“${c.name}”: ${text}`) };
    }
    case "INBOX_APPROVE": {
      const item = s.inbox.find(i => i.id === a.id);
      if (!item || (item.status !== "awaiting" && item.status !== "reminder") || optedOut(s, item.prospectId)) return s;
      const p = visibleProspect(s, item.prospectId);
      const conversations = p
        ? s.conversations.some(c => c.prospectId === p.id)
          ? s.conversations.map(c => c.prospectId === p.id ? { ...c, messages: [...c.messages, { from: "you" as const, text: a.reply, at: now() }] } : c)
          : [...s.conversations, { prospectId: p.id, channel: p.channel, messages: [{ from: "you" as const, text: a.reply, at: now() }] }]
        : s.conversations;
      const n = { tone: "success" as const, title: "Response Approved", body: `Your reply to ${p?.name ?? "the prospect"} was recorded (simulated send).` };
      const rt = s.runtime[item.prospectId], qualify = !!p && !!rt && !rt.optedOut && item.intentClass === "high";
      const runtime = qualify ? { ...s.runtime, [item.prospectId]: { ...rt!, stage: "qualified" as PipelineStage, lastActivity: `Reply approved · qualified · ${now()}` } } : s.runtime;
      return { ...s, runtime, conversations, inbox: s.inbox.map(i => i.id === a.id ? { ...i, status: "approved", suggestedReply: a.reply } : i),
        notifications: push(s.notifications, n), notifHistory: history(s.notifHistory, n),
        activity: log(s.activity, "check", `Suggested reply approved for ${p?.name ?? item.prospectId} (simulated send)${qualify ? " — marked Qualified" : ""}`) };
    }
    case "INBOX_REMINDER": {
      const item = s.inbox.find(i => i.id === a.id);
      if (!item || (item.status !== "awaiting" && item.status !== "reminder") || optedOut(s, item.prospectId)) return s;
      return { ...s, inbox: s.inbox.map(i => i.id === a.id ? { ...i, status: "reminder", reminderDays: a.days } : i),
        activity: log(s.activity, "calendar", `Follow-up reminder set for ${a.days} days (${item.prospectId})`) };
    }
    case "INBOX_REJECT": {
      const item = s.inbox.find(i => i.id === a.id);
      if (!item || item.status !== "awaiting") return s;
      const p = visibleProspect(s, item.prospectId);
      return { ...s, inbox: s.inbox.map(i => i.id === a.id ? { ...i, status: "rejected" } : i),
        activity: log(s.activity, "shield", `Suggested reply rejected for ${p?.name ?? item.prospectId} — nothing sent`) };
    }
    case "INBOX_DISMISS":
      return { ...s, inbox: s.inbox.map(i => i.id === a.id ? { ...i, status: "dismissed" } : i) };
  }
}
