/**
 * LeadForge Intelligence — shared domain model.
 * Reusable types and configuration; no customer or prospect fixtures.
 */

/* ----------------------------- Core types ----------------------------- */

export type NeedStatus = "confirmed" | "partial" | "unknown";
export type ReplyStatus = "none" | "neutral" | "positive" | "negative" | "opted_out";
export type Channel = "LinkedIn" | "Email" | "Both";

export type PipelineStage =
  | "identified"
  | "high_fit"
  | "outreach"
  | "engaged"
  | "interested"
  | "qualified"
  | "meeting";

export const PIPELINE_STAGES: { id: PipelineStage; label: string }[] = [
  { id: "identified", label: "Identified" },
  { id: "high_fit", label: "High Fit" },
  { id: "outreach", label: "Outreach Started" },
  { id: "engaged", label: "Engaged" },
  { id: "interested", label: "Interested" },
  { id: "qualified", label: "Qualified" },
  { id: "meeting", label: "Meeting Requested" },
];

export const STAGE_ORDER: PipelineStage[] = PIPELINE_STAGES.map((s) => s.id);

export interface Prospect {
  id: string;
  name: string;
  title: string;
  /** decision_maker matches ICP roles; influencer scores partial; other scores 0 */
  roleCategory: "decision_maker" | "influencer" | "other";
  company: string;
  industry: string;
  country: string;
  city: string;
  employees: number;
  need: NeedStatus;
  needNote: string;
  signals: string[];
  channel: Channel;
  stage: PipelineStage;
  replyStatus: ReplyStatus;
  lastActivity: string;
  /** Normalized duplicate key for imported prospects (email, else profile URL, else name+company). */
  importKey?: string;
  /** Every strong person identifier known at import (normalized `email:` / `url:` keys). */
  identityKeys?: string[];
}

export interface ICP {
  industries: string[];
  countries: string[];
  sizeMin: number;
  sizeMax: number;
  roles: string[];
  challenges: string[];
  services: string[];
}

export interface ChatMessage {
  from: "prospect" | "you" | "system";
  text: string;
  at: string; // display timestamp
}

export interface Conversation {
  prospectId: string;
  channel: Channel;
  messages: ChatMessage[];
}

export interface ActivityEvent {
  id: string;
  icon: string;
  text: string;
  at: string;
}

export type WorkflowStatus = "pending" | "active" | "done" | "paused" | "skipped";

export interface WorkflowStep {
  id: string;
  label: string;
  actionType: string;
  channel: "System" | "LinkedIn" | "Email" | "Human";
  delayDays: number;
  condition: string;
  message: string;
  status: WorkflowStatus;
  branch?: string; // conditional path description
}

/* ------------------------- ICP configuration ------------------------- */

export const DEFAULT_ICP: ICP = {
  industries: ["B2B SaaS", "Software"],
  countries: ["United States"],
  sizeMin: 11,
  sizeMax: 200,
  roles: ["Founder", "CEO", "VP Sales", "Head of Sales", "CRO"],
  challenges: ["Improving qualified appointment generation"],
  services: ["AI outbound prospecting", "Appointment setting"],
};

export const INDUSTRY_OPTIONS = [
  "Real Estate", "Healthcare",
  "B2B SaaS", "Software", "Recruitment", "Staffing", "Logistics", "Fintech",
  "Healthcare SaaS", "Real Estate Technology", "Financial Services", "Retail",
  "E-commerce", "Manufacturing", "Professional Services", "HR Tech", "Legal Services",
];

export const COUNTRY_OPTIONS = [
  "United States", "United Kingdom", "United Arab Emirates", "Germany",
  "Canada", "Singapore", "Australia", "Netherlands", "Saudi Arabia", "France",
];

export const ROLE_OPTIONS = [
  "Director of Property Operations", "VP Operations", "Managing Broker", "Head of Leasing",
  "Practice Director", "Head of Patient Experience", "Operations Director", "Medical Director",
  "Founder", "CEO", "VP Sales", "Head of Sales", "CRO",
  "Sales Director", "Head of Growth", "VP Marketing", "COO", "Managing Director",
];

export const CHALLENGE_OPTIONS = [
  "Improving qualified appointment generation",
  "Scaling outbound without more headcount",
  "Low reply rates on cold outreach",
  "Inconsistent pipeline",
  "Long sales cycles",
  "Poor lead data quality",
];

export const SERVICE_OPTIONS = [
  "AI outbound prospecting",
  "Appointment setting",
  "LinkedIn outreach",
  "Cold email campaigns",
  "Lead qualification",
  "CRM automation",
];

/** Industries considered "related" for partial (15 pt) industry scoring. */
export const RELATED_INDUSTRIES: Record<string, string[]> = {
  "b2b saas": ["software", "hr tech", "fintech", "healthcare saas"],
  software: ["b2b saas", "hr tech", "fintech", "e-commerce"],
  recruitment: ["staffing", "hr tech", "professional services"],
  staffing: ["recruitment", "hr tech", "professional services"],
  logistics: ["manufacturing", "retail", "e-commerce"],
  fintech: ["financial services", "b2b saas", "software"],
  "healthcare saas": ["b2b saas", "software"],
  "real estate technology": ["software", "professional services"],
  "financial services": ["fintech", "professional services", "legal services"],
  retail: ["e-commerce", "logistics"],
  "e-commerce": ["retail", "logistics", "software"],
  manufacturing: ["logistics"],
  "professional services": ["legal services", "recruitment", "financial services"],
  "hr tech": ["b2b saas", "recruitment", "software"],
  "legal services": ["professional services", "financial services"],
};

/* --------------------------- Outreach workflow --------------------------- */

export const DEFAULT_WORKFLOW: WorkflowStep[] = [
  {
    id: "w1", label: "Prospect selected", actionType: "Selection", channel: "System", delayDays: 0,
    condition: "Prospect matches active ICP filters", status: "done",
    message: "Prospect enters the orchestration queue with full attribute profile.",
  },
  {
    id: "w2", label: "Fit score calculated", actionType: "Scoring", channel: "System", delayDays: 0,
    condition: "Always runs", status: "done",
    message: "Deterministic ICP fit scoring across industry, role, geography, size and need.",
  },
  {
    id: "w3", label: "Personalized message prepared", actionType: "Drafting", channel: "System", delayDays: 0,
    condition: "Fit score ≥ 40", status: "done",
    message: "Template-based first line written only from verified prospect attributes.",
  },
  {
    id: "w4", label: "Human approval", actionType: "Approval", channel: "Human", delayDays: 0,
    condition: "A reviewer approves the draft", status: "active",
    message: "No message leaves without human sign-off in Demo Mode.",
  },
  {
    id: "w5", label: "LinkedIn invitation", actionType: "Outreach", channel: "LinkedIn", delayDays: 1,
    condition: "Approval granted", status: "pending",
    message: "Short, relevant connection note referencing a real signal — never a pitch.",
    branch: "IF accepted → continue LinkedIn sequence · IF not accepted in 4 days → switch to email path",
  },
  {
    id: "w6", label: "Follow-up sequence", actionType: "Outreach", channel: "LinkedIn", delayDays: 3,
    condition: "Invitation accepted, no reply yet", status: "pending",
    message: "Value message sharing an insight matched to the prospect's industry.",
    branch: "IF prospect replies → pause automation and classify the response",
  },
  {
    id: "w7", label: "Email outreach", actionType: "Outreach", channel: "Email", delayDays: 2,
    condition: "LinkedIn path exhausted or email-first prospect", status: "pending",
    message: "Deliverability-safe cold email with an AI-written first line.",
  },
  {
    id: "w8", label: "Response received", actionType: "Listening", channel: "System", delayDays: 0,
    condition: "Any prospect reply", status: "pending",
    message: "Reply captured and automation paused immediately.",
    branch: "IF opt-out → stop sequence and suppress contact · IF meeting request → create opportunity",
  },
  {
    id: "w9", label: "Intent classification", actionType: "Analysis", channel: "System", delayDays: 0,
    condition: "Response received", status: "pending",
    message: "Rule-based buyer-intent analysis with transparent evidence.",
  },
  {
    id: "w10", label: "Opportunity qualification", actionType: "Decision", channel: "System", delayDays: 0,
    condition: "Fit ≥ 65 and Intent ≥ 60 and no opt-out", status: "pending",
    message: "Combined lead priority decides qualification.",
  },
  {
    id: "w11", label: "Human sales handoff", actionType: "Handoff", channel: "Human", delayDays: 0,
    condition: "Qualification passed", status: "pending",
    message: "Qualified opportunity routed to a human seller with full context.",
  },
];

/* ------------------------- Integration catalogue ------------------------- */

export const INTEGRATION_STATUS = [
  { name: "Dripify", role: "Outreach execution engine (LinkedIn + Email)", state: "Not Connected" },
  { name: "Google Workspace", role: "Sending identity & calendars", state: "Not Connected" },
  { name: "CRM", role: "Contact & deal sync", state: "Demo Mode" },
  { name: "AI Engine", role: "Message generation & reply classification", state: "Rule-Based Demo" },
  { name: "Analytics", role: "Reporting & attribution", state: "Sample Data" },
] as const;

export const ADAPTER_INTERFACES = [
  { name: "CampaignProvider", detail: "Creates, pauses and reports outreach campaigns. Demo adapter simulates; live adapter targets the Dripify API." },
  { name: "ProspectProvider", detail: "Supplies enriched prospect records. Demo adapter serves the fictional dataset." },
  { name: "MessageProvider", detail: "Generates and stores message drafts. Demo adapter uses truthful templates." },
  { name: "LeadScoringService", detail: "Deterministic ICP fit scoring — fully implemented in this demo." },
  { name: "IntentAnalysisService", detail: "Rule-based reply classification in Demo Mode; an LLM can replace it behind the same interface." },
  { name: "AnalyticsService", detail: "Computes funnel, channel and scoring metrics from the shared event stream." },
  { name: "OpportunityService", detail: "Creates and routes qualified opportunities to the pipeline." },
] as const;

/* ------------------------- Orbit module registry ------------------------- */

export type OrbitModuleId =
  | "discovery" | "icp" | "scoring" | "personalization"
  | "outreach" | "intent" | "routing" | "analytics";

export const ORBIT_MODULES: { id: OrbitModuleId; name: string; tagline: string; icon: string }[] = [
  { id: "discovery", name: "Prospect Discovery", tagline: "Find the right accounts", icon: "radar" },
  { id: "icp", name: "ICP Matching", tagline: "Define the ideal customer", icon: "sliders" },
  { id: "scoring", name: "Lead Scoring", tagline: "Transparent fit scores", icon: "gauge" },
  { id: "personalization", name: "AI Personalization", tagline: "Truthful 1:1 messaging", icon: "sparkles" },
  { id: "outreach", name: "Outreach Execution", tagline: "Orchestrated sequences", icon: "send" },
  { id: "intent", name: "Intent Intelligence", tagline: "Read every reply", icon: "brain" },
  { id: "routing", name: "Opportunity Routing", tagline: "Qualified handoffs", icon: "gitbranch" },
  { id: "analytics", name: "Performance Analytics", tagline: "Executive visibility", icon: "chart" },
];

/* ======================= Campaign journey model ======================= */

export type CampaignObjective =
  | "appointments" | "event" | "product" | "service"
  | "partnerships" | "reconnect" | "custom";

export const CAMPAIGN_OBJECTIVES: { id: CampaignObjective; label: string; desc: string; icon: string }[] = [
  { id: "appointments", label: "Generate B2B Appointments", desc: "Book qualified meetings with decision-makers.", icon: "calendar" },
  { id: "event", label: "Promote an Event", desc: "Invite a targeted audience to attend.", icon: "ticket" },
  { id: "product", label: "Introduce a Product", desc: "Launch a product to a defined market.", icon: "box" },
  { id: "service", label: "Promote a Service", desc: "Position a service offer to the right buyers.", icon: "briefcase" },
  { id: "partnerships", label: "Build Strategic Partnerships", desc: "Open collaboration conversations.", icon: "handshake" },
  { id: "reconnect", label: "Reconnect With Existing Prospects", desc: "Re-engage a dormant audience respectfully.", icon: "refresh" },
  { id: "custom", label: "Custom Campaign", desc: "Define your own objective and brief.", icon: "sparkles" },
];

export type CampaignStatus =
  | "draft" | "in_review" | "approved" | "running" | "paused" | "stopped" | "completed";

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  in_review: "In Review",
  approved: "Approved",
  running: "Demo Running",
  paused: "Paused",
  stopped: "Stopped",
  completed: "Completed",
};

export type TemplateStatus = "draft" | "needs_review" | "approved";

export type MessageChannelId =
  | "li_connect" | "li_followup" | "li_message"
  | "email_intro" | "email_followup" | "inmail";

export const MESSAGE_CHANNELS: { id: MessageChannelId; label: string; note?: string }[] = [
  { id: "li_connect", label: "LinkedIn Connection Request" },
  { id: "li_followup", label: "LinkedIn Follow-Up" },
  { id: "li_message", label: "Additional LinkedIn Message" },
  { id: "email_intro", label: "Email Introduction" },
  { id: "email_followup", label: "Email Follow-Up" },
  { id: "inmail", label: "Sales Navigator InMail", note: "Optional channel — requires eligible Sales Navigator access and available InMail credits." },
];

export interface MessageTemplate {
  id: string;
  channel: MessageChannelId;
  label: string;
  body: string; // supports {firstName} {company} {role} {industry} {location} variables
  status: TemplateStatus;
  savedAsTemplate: boolean;
  personalized?: { prospectId: string; body: string; status: TemplateStatus; generatedBy: "ai" | "template" | "manual" }[];
}

/* --------------------------- Campaign brief --------------------------- */

export interface StructuredBrief {
  objective: string;
  targetAudience: string;
  coreMessage: string;
  keyBenefits: string;
  callToAction: string;
  importantDates: string;
  personalizationAngles: string;
}

export interface CampaignBrief {
  objective: CampaignObjective;
  campaignName: string;
  rawInput: string;
  fields: Record<string, string>; // objective-specific form values
  structured: StructuredBrief;
  missing: string[]; // flagged incomplete items — never invented
  /** Who structured the brief: the AI gateway, or the local template fallback. */
  generatedBy?: "ai" | "template" | undefined;
}

/* ------------------------- Follow-up sequence ------------------------- */

export type SequenceStepKind = "action" | "wait" | "condition" | "end";

export interface SequenceStep {
  id: string;
  kind: SequenceStepKind;
  day: number; // campaign day the step occurs on
  label: string;
  channel?: "LinkedIn" | "Email" | "InMail";
  waitDays?: number;
  condition?: { question: string; onYes: string; onNo: string };
  enabled: boolean;
}

export interface CoolingOff {
  enabled: boolean;
  runDays: number;
  breakDays: number;
  resumeDate: string;
  notifyBeforeRestart: boolean;
  requireApproval: boolean;
}

export interface SequenceConfig {
  followUps: number; // 1-4 or custom
  delayValue: number;
  delayUnit: "hours" | "days";
  sendingDays: string; // e.g. "Working days (Mon–Fri)"
  sendingHours: string; // e.g. "09:00–17:00"
  timezone: string;
  startMode: "immediate" | "scheduled";
  duration: "completion" | "date" | "manual";
  stopOnReply: boolean;
  stopOnOptOut: boolean;
  stopOnDecline: boolean;
  stopOnMeeting: boolean;
  stopOnHuman: boolean;
  stopOnInvalid: boolean;
  coolingOff: CoolingOff;
}

/* ------------------------------ Campaign ------------------------------ */

export interface CampaignEvent {
  id: string;
  at: string;
  text: string;
}

export interface Campaign {
  id: string;
  name: string;
  objective: CampaignObjective;
  status: CampaignStatus;
  brief: CampaignBrief | null;
  prospectIds: string[];
  templates: MessageTemplate[];
  sequence: SequenceStep[];
  config: SequenceConfig;
  createdAt: string;
  events: CampaignEvent[];
  simCursor: number; // position in the demo simulation script
  prospectsContacted: number;
  repliesDetected: number;
}

/* --------------------------- Intelligence inbox --------------------------- */

export type InboxCategory = "high" | "review" | "none";
export type InboxStatus = "awaiting" | "approved" | "rejected" | "reminder" | "dismissed" | "suppressed";

export interface InboxItem {
  id: string;
  prospectId: string;
  campaignId: string | null;
  incomingText: string;
  at: string;
  intentScore: number;
  intentLabel: string;
  intentClass: string;
  recommendedAction: string;
  suggestedReply: string;
  category: InboxCategory;
  status: InboxStatus;
  reminderDays?: number;
}

/* --------------------------- Imported prospects --------------------------- */

export interface ImportedRow {
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string;
  location: string;
  industry: string;
  linkedinUrl: string;
  email: string;
  website: string;
  notes: string;
}

export interface ImportResult {
  total: number;
  valid: ImportedRow[];
  duplicates: number;
  /** Rows skipped because the prospect already exists in the workspace. */
  existing: number;
  invalid: { row: ImportedRow; reason: string }[];
  missingLinkedIn: number;
}

/* ------------------------- Discovery (simulated) ------------------------- */

export const DISCOVERY_SOURCES = [
  "Sales Navigator Search",
  "Sales Navigator Saved Search",
  "Sales Navigator Lead List",
  "Public LinkedIn Post Engagement",
] as const;

export const LINKEDIN_IMPORT_SOURCES = [
  "LinkedIn Search",
  "Sales Navigator Search",
  "LinkedIn Recruiter Search",
  "LinkedIn Groups",
  "LinkedIn Events",
  "My Network",
  "LinkedIn Followers",
] as const;