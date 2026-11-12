/**
 * LeadForge Intelligence — scoring engine.
 * Pure, deterministic, fully transparent scoring logic.
 * No randomness, no fabricated attributes, no hidden weighting.
 */

import { RELATED_INDUSTRIES, type ICP, type Prospect } from "./model";

/* ============================ ICP FIT SCORING ============================ */
/* Total 100: Industry 30 · Role 25 · Geography 15 · Size 15 · Need 15      */

export interface FitComponent {
  key: "industry" | "role" | "geography" | "size" | "need";
  label: string;
  points: number;
  max: number;
  reason: string;
}

export type FitClass = "excellent" | "good" | "partial" | "low";

export interface FitScore {
  total: number;
  classification: FitClass;
  classificationLabel: string;
  components: FitComponent[];
}

const norm = (s: string) => s.trim().toLowerCase();

export function classifyFit(total: number): { classification: FitClass; label: string } {
  if (total >= 80) return { classification: "excellent", label: "Excellent Fit" };
  if (total >= 60) return { classification: "good", label: "Good Fit" };
  if (total >= 40) return { classification: "partial", label: "Partial Fit" };
  return { classification: "low", label: "Low Fit" };
}

/** Exact role match: the normalized title equals a target role (no substring matches such as "Director" ≈ "Practice Director"). */
export function titleMatchesRole(title: string, roles: string[]): boolean {
  const t = norm(title).replace(/\s+/g, " ");
  return t.length > 0 && roles.some((r) => norm(r).replace(/\s+/g, " ") === t);
}

export function calculateFitScore(p: Prospect, icp: ICP): FitScore {
  const components: FitComponent[] = [];

  // --- Industry (30) ---
  const ind = norm(p.industry);
  const targets = icp.industries.map(norm);
  let industryPts = 0;
  let industryReason: string;
  if (targets.includes(ind)) {
    industryPts = 30;
    industryReason = `“${p.industry}” is a target industry.`;
  } else if (targets.some((t) => (RELATED_INDUSTRIES[t] ?? []).includes(ind))) {
    industryPts = 15;
    industryReason = `“${p.industry}” is related to a target industry (${icp.industries.join(", ")}).`;
  } else {
    industryReason = `“${p.industry}” is outside the target industries (${icp.industries.join(", ")}).`;
  }
  components.push({ key: "industry", label: "Industry Match", points: industryPts, max: 30, reason: industryReason });

  // --- Decision-maker role (25) ---
  const roleHit = titleMatchesRole(p.title, icp.roles);
  let rolePts = 0;
  let roleReason: string;
  if (p.roleCategory === "decision_maker" && roleHit) {
    rolePts = 25;
    roleReason = `“${p.title}” is a target decision-maker role.`;
  } else if (p.roleCategory === "decision_maker") {
    rolePts = 25;
    roleReason = `“${p.title}” is a decision-maker, though not a listed target role.`;
  } else if (p.roleCategory === "influencer") {
    rolePts = 12;
    roleReason = `“${p.title}” is a relevant influencer, not the economic decision-maker.`;
  } else {
    roleReason = `“${p.title}” is not a buying-role contact.`;
  }
  components.push({ key: "role", label: "Role Match", points: rolePts, max: 25, reason: roleReason });

  // --- Geography (15) ---
  const geoHit = icp.countries.map(norm).includes(norm(p.country));
  components.push({
    key: "geography", label: "Geographic Match", points: geoHit ? 15 : 0, max: 15,
    reason: geoHit
      ? `${p.country} is a target market.`
      : `${p.country} is outside the target markets (${icp.countries.join(", ")}).`,
  });

  // --- Company size (15) ---
  const sizeHit = p.employees >= icp.sizeMin && p.employees <= icp.sizeMax;
  components.push({
    key: "size", label: "Company Size Match", points: sizeHit ? 15 : 0, max: 15,
    reason: sizeHit
      ? `${p.employees} employees is inside the target range (${icp.sizeMin}–${icp.sizeMax}).`
      : `${p.employees} employees is outside the target range (${icp.sizeMin}–${icp.sizeMax}).`,
  });

  // --- Business need (15) ---
  const needPts = p.need === "confirmed" ? 15 : p.need === "partial" ? 8 : 0;
  const needReason =
    p.need === "confirmed"
      ? `Confirmed relevant need — ${p.needNote}`
      : p.need === "partial"
        ? `Partially relevant signal — ${p.needNote}`
        : `No confirmed relevant need — ${p.needNote}`;
  components.push({ key: "need", label: "Business Need Match", points: needPts, max: 15, reason: needReason });

  const total = components.reduce((s, c) => s + c.points, 0);
  const { classification, label } = classifyFit(total);
  return { total, classification, classificationLabel: label, components };
}

/* ========================== BUYER INTENT SCORING ========================== */
/* Max 100: Explicit interest 35 · Meeting request 25 · Timeline 20 ·        */
/* Authority 10 · Engagement 10. Rule-based and explainable.                 */

export type IntentClass =
  | "high" | "medium" | "low" | "neutral" | "negative" | "do_not_contact";

export interface IntentEvidence {
  signal: string;
  points: number;
  quote: string;
}

export interface IntentResult {
  score: number; // 0–100
  classification: IntentClass;
  classificationLabel: string;
  evidence: IntentEvidence[];
  summary: string;
  recommendedAction: string;
}

interface Rule {
  key: string;
  label: string;
  points: number;
  patterns: RegExp[];
}

const OPT_OUT = /\b(not interested|stop contacting|remove me|unsubscribe|do not contact|don'?t contact|leave me alone|take me off|opt[- ]?out|stop emailing|stop messaging)\b/i;
const NEGATIVE = /\b(no thanks|not right now|maybe later|we'?re good|i'?ll pass|not a priority|later in the year|not for us)\b/i;

const INTENT_RULES: Rule[] = [
  {
    key: "interest", label: "Explicit buying interest", points: 35,
    patterns: [
      /\b(actively )?(looking|shopping) for\b/i, /\bevaluating\b/i, /\binterested in\b/i,
      /\bwe need (a|an|to)\b/i, /\bneed(s)? (a|an)? ?\w* ?solution\b/i, /\bopen to\b/i,
      /\bconsidering\b/i, /\bin the market\b/i, /\bwant to (buy|explore|see)\b/i,
    ],
  },
  {
    key: "meeting", label: "Meeting or discussion request", points: 25,
    patterns: [
      /\b(arrange|schedule|book|set up|have|jump on|hop on)\b.{0,25}\b(call|meeting|demo|chat|discussion)\b/i,
      /\b(call|meeting|demo)\b.{0,25}\b(next week|this week|tomorrow|sometime)\b/i,
      /\bcan we (discuss|talk|meet|arrange)\b/i, /\bcould we (discuss|talk|meet|arrange)\b/i,
      /\bsend me (a )?(few |couple of )?times\b/i, /\bwalk me through\b/i,
    ],
  },
  {
    key: "timeline", label: "Near-term buying timeline", points: 20,
    patterns: [
      /\bthis quarter\b/i, /\bnext (week|month|quarter)\b/i, /\bthis month\b/i,
      /\bq[1-4]\b/i, /\basap\b/i, /\bimmediately\b/i, /\bin the coming (weeks|months)\b/i,
      /\bbefore (the end of|year[- ]end)\b/i, /\bsoon\b/i,
    ],
  },
  {
    key: "authority", label: "Decision-making authority", points: 10,
    patterns: [
      /\bi (decide|make the call|own this|can sign|have budget)\b/i,
      /\bmy (decision|budget|call)\b/i, /\bi'?m the (founder|ceo|owner|decision maker)\b/i,
      /\bi lead (the|this)\b/i, /\bmy team\b/i,
    ],
  },
  {
    key: "engagement", label: "Meaningful engagement", points: 10,
    patterns: [
      /\btell me more\b/i, /\bhow (does|would|do) (this|you|it)\b/i, /\bwhat would you\b/i,
      /\bsend (it|me|over)\b/i, /\bcase stud(y|ies)\b/i, /\bpricing\b/i, /\bhow much\b/i,
      /\bwhat do you need from me\b/i, /\bshow me\b/i,
    ],
  },
];

function findQuote(text: string, pattern: RegExp): string {
  const m = text.match(pattern);
  if (!m || m.index === undefined) return "";
  const start = Math.max(0, m.index - 30);
  const end = Math.min(text.length, m.index + m[0].length + 30);
  return text.slice(start, end).trim();
}

export function analyzeBuyerIntent(replyText: string): IntentResult {
  const text = replyText.trim();

  if (OPT_OUT.test(text)) {
    return {
      score: 0, classification: "do_not_contact", classificationLabel: "Not Interested / Do Not Contact",
      evidence: [{ signal: "Opt-out or rejection language", points: 0, quote: findQuote(text, OPT_OUT) }],
      summary: "The prospect explicitly declined or asked to be removed. This overrides every other score.",
      recommendedAction: "Stop all outreach immediately, suppress the contact, and log the opt-out. No further automated messages.",
    };
  }
  if (NEGATIVE.test(text)) {
    return {
      score: 5, classification: "negative", classificationLabel: "Negative — Not Now",
      evidence: [{ signal: "Soft rejection", points: 0, quote: findQuote(text, NEGATIVE) }],
      summary: "The prospect declined for now without opting out.",
      recommendedAction: "Pause the sequence, set a respectful re-engagement reminder, and do not count this as an opportunity.",
    };
  }

  const evidence: IntentEvidence[] = [];
  let score = 0;
  for (const rule of INTENT_RULES) {
    const hit = rule.patterns.find((pat) => pat.test(text));
    if (hit) {
      evidence.push({ signal: rule.label, points: rule.points, quote: findQuote(text, hit) });
      score += rule.points;
    }
  }
  // Engagement can also be earned by a substantive, questioning reply.
  if (!evidence.some((e) => e.signal === "Meaningful engagement") && text.length > 120 && text.includes("?")) {
    evidence.push({ signal: "Meaningful engagement", points: 10, quote: "Substantive reply with a direct question" });
    score += 10;
  }
  score = Math.min(100, score);

  if (score === 0) {
    return {
      score, classification: "neutral", classificationLabel: "Neutral Response",
      evidence: [],
      summary: "A polite reply with no buying signal. This is not an opportunity and must not be scored as one.",
      recommendedAction: "Continue the light-touch nurture sequence or flag for human review. Do not qualify.",
    };
  }

  const classification: IntentClass = score >= 60 ? "high" : score >= 35 ? "medium" : "low";
  const classificationLabel =
    classification === "high" ? "High Buyer Intent" :
    classification === "medium" ? "Moderate Buyer Intent" : "Early-Stage Interest";

  return {
    score, classification, classificationLabel, evidence,
    summary:
      classification === "high"
        ? "The reply contains concrete buying signals — interest, timing and/or a meeting request."
        : classification === "medium"
          ? "The reply shows genuine interest but lacks a firm commitment or timeline."
          : "The reply shows early curiosity without clear buying intent.",
    recommendedAction:
      classification === "high"
        ? "Propose a meeting with two concrete times and route to a human seller for qualification review."
        : classification === "medium"
          ? "Send a value-building follow-up and ask a qualifying question about timeline and authority."
          : "Continue the sequence and watch for stronger signals before involving sales.",
  };
}

/* ========================= LEAD PRIORITY (COMBINED) ========================= */

export type PriorityClass = "high" | "medium" | "low" | "pending" | "suppressed";

export interface LeadPriority {
  score: number | null; // null when intent not yet assessed
  classification: PriorityClass;
  label: string;
  formula: string;
}

export function calculateLeadPriority(
  fitScore: number,
  intentScore: number | null,
  optedOut: boolean,
): LeadPriority {
  if (optedOut) {
    return { score: 0, classification: "suppressed", label: "Suppressed — Do Not Contact", formula: "Opt-out override" };
  }
  if (intentScore === null) {
    return { score: null, classification: "pending", label: "Priority Pending Intent", formula: "Awaiting a prospect reply" };
  }
  const score = Math.round(fitScore * 0.6 + intentScore * 0.4);
  const classification: PriorityClass = score >= 80 ? "high" : score >= 60 ? "medium" : "low";
  const label = classification === "high" ? "High Priority" : classification === "medium" ? "Medium Priority" : "Low Priority";
  return {
    score, classification, label,
    formula: `(${fitScore} × 0.60) + (${intentScore} × 0.40) = ${score}`,
  };
}

/** Sales handoff gate: Fit ≥ 65, Intent ≥ 60, no opt-out override. */
export function qualifiesForHandoff(fitScore: number, intentScore: number | null, optedOut: boolean): boolean {
  if (optedOut || intentScore === null) return false;
  return fitScore >= 65 && intentScore >= 60;
}

/* =========================== DASHBOARD METRICS =========================== */

export interface DashboardMetrics {
  prospectsIdentified: number;
  highFitProspects: number;
  outreachStarted: number;
  linkedinResponses: number;
  emailResponses: number;
  positiveConversations: number;
  qualifiedOpportunities: number;
  meetingsRequested: number;
  connectionAcceptanceRate: { accepted: number; sent: number; pct: number };
  linkedinReplyRate: { replies: number; delivered: number; pct: number };
  emailReplyRate: { replies: number; delivered: number; pct: number };
  funnel: { stage: string; count: number }[];
  fitDistribution: { band: string; count: number; classification: FitClass }[];
  intentDistribution: { band: string; count: number }[];
}

export interface MetricProspect {
  id: string;
  channel: Prospect["channel"];
  stage: Prospect["stage"];
  replyStatus: ReplyStatusLike;
  fitScore: number;
  intentScore: number | null;
  optedOut: boolean;
}
type ReplyStatusLike = "none" | "neutral" | "positive" | "negative" | "opted_out";

const STAGE_IDX: Record<string, number> = {
  identified: 0, high_fit: 1, outreach: 2, engaged: 3, interested: 4, qualified: 5, meeting: 6,
};

export function recalculateDashboardMetrics(prospects: MetricProspect[]): DashboardMetrics {
  const replied = prospects.filter((p) => p.replyStatus !== "none");
  const linkedinReplied = replied.filter((p) => p.channel === "LinkedIn" || p.channel === "Both");
  const emailReplied = replied.filter((p) => p.channel === "Email" || p.channel === "Both");
  const linkedinOutreach = prospects.filter(
    (p) => (p.channel === "LinkedIn" || p.channel === "Both") && (STAGE_IDX[p.stage] ?? 0) >= 2,
  );
  const emailOutreach = prospects.filter(
    (p) => (p.channel === "Email" || p.channel === "Both") && (STAGE_IDX[p.stage] ?? 0) >= 2,
  );

  const pct = (n: number, d: number) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);

  const funnel = [
    { stage: "Identified", count: prospects.length },
    { stage: "High Fit", count: prospects.filter((p) => p.fitScore >= 80).length },
    { stage: "Outreach Started", count: prospects.filter((p) => (STAGE_IDX[p.stage] ?? 0) >= 2).length },
    { stage: "Engaged", count: prospects.filter((p) => (STAGE_IDX[p.stage] ?? 0) >= 3).length },
    { stage: "Interested", count: prospects.filter((p) => (STAGE_IDX[p.stage] ?? 0) >= 4).length },
    { stage: "Qualified", count: prospects.filter((p) => (STAGE_IDX[p.stage] ?? 0) >= 5).length },
    { stage: "Meeting Requested", count: prospects.filter((p) => (STAGE_IDX[p.stage] ?? 0) >= 6).length },
  ];

  const fitDistribution = [
    { band: "Excellent (80–100)", classification: "excellent" as FitClass, count: prospects.filter((p) => p.fitScore >= 80).length },
    { band: "Good (60–79)", classification: "good" as FitClass, count: prospects.filter((p) => p.fitScore >= 60 && p.fitScore < 80).length },
    { band: "Partial (40–59)", classification: "partial" as FitClass, count: prospects.filter((p) => p.fitScore >= 40 && p.fitScore < 60).length },
    { band: "Low (<40)", classification: "low" as FitClass, count: prospects.filter((p) => p.fitScore < 40).length },
  ];

  const assessed = prospects.filter((p) => p.intentScore !== null || p.optedOut);
  const intentDistribution = [
    { band: "High (60+)", count: assessed.filter((p) => (p.intentScore ?? 0) >= 60).length },
    { band: "Moderate (35–59)", count: assessed.filter((p) => (p.intentScore ?? 0) >= 35 && (p.intentScore ?? 0) < 60).length },
    { band: "Low (1–34)", count: assessed.filter((p) => (p.intentScore ?? 0) > 0 && (p.intentScore ?? 0) < 35).length },
    { band: "Neutral / Negative", count: assessed.filter((p) => (p.intentScore ?? 0) === 0).length },
    { band: "Not Yet Assessed", count: prospects.length - assessed.length },
  ];

  return {
    prospectsIdentified: prospects.length,
    highFitProspects: prospects.filter((p) => p.fitScore >= 80).length,
    outreachStarted: prospects.filter((p) => (STAGE_IDX[p.stage] ?? 0) >= 2).length,
    linkedinResponses: linkedinReplied.length,
    emailResponses: emailReplied.length,
    positiveConversations: prospects.filter((p) => p.replyStatus === "positive").length,
    qualifiedOpportunities: prospects.filter((p) => (STAGE_IDX[p.stage] ?? 0) >= 5).length,
    meetingsRequested: prospects.filter((p) => p.stage === "meeting").length,
    connectionAcceptanceRate: {
      accepted: linkedinOutreach.filter((p) => (STAGE_IDX[p.stage] ?? 0) >= 3).length,
      sent: linkedinOutreach.length,
      pct: pct(linkedinOutreach.filter((p) => (STAGE_IDX[p.stage] ?? 0) >= 3).length, linkedinOutreach.length),
    },
    linkedinReplyRate: { replies: linkedinReplied.length, delivered: linkedinOutreach.length, pct: pct(linkedinReplied.length, linkedinOutreach.length) },
    emailReplyRate: { replies: emailReplied.length, delivered: emailOutreach.length, pct: pct(emailReplied.length, emailOutreach.length) },
    funnel,
    fitDistribution,
    intentDistribution,
  };
}

/* ======================= CAMPAIGN JOURNEY ENGINE ======================= */
/* Pure functions for the campaign wizard: CSV import, brief structuring,  */
/* truthful message generation, sequence building and demo simulation.     */

import type {
  Campaign, CampaignBrief, CampaignObjective, CampaignStatus, ImportedRow, ImportResult,
  MessageChannelId, MessageTemplate, SequenceConfig, SequenceStep, TemplateStatus,
  StructuredBrief,
} from "./model";
import { CAMPAIGN_OBJECTIVES, MESSAGE_CHANNELS } from "./model";

/* ------------------------------- CSV import ------------------------------- */

const CSV_FIELDS: { key: keyof ImportedRow; aliases: string[]; required?: boolean }[] = [
  { key: "firstName", aliases: ["first name", "firstname", "first", "given name"] },
  { key: "lastName", aliases: ["last name", "lastname", "last", "surname", "family name"] },
  { key: "company", aliases: ["company", "company name", "organization", "organisation"] },
  { key: "jobTitle", aliases: ["job title", "jobtitle", "title", "position", "role"] },
  { key: "location", aliases: ["location", "city", "country", "region"] },
  { key: "industry", aliases: ["industry", "sector"] },
  { key: "linkedinUrl", aliases: ["linkedin", "linkedin url", "linkedin profile", "linkedin profile url", "profile url", "li url"] },
  { key: "email", aliases: ["email", "e-mail", "work email", "email address"] },
  { key: "website", aliases: ["website", "company website", "url", "domain"] },
  { key: "notes", aliases: ["notes", "custom notes", "comment", "comments", "personalization", "personalisation"] },
];

/** Split a CSV text into rows of cells, handling quoted commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Map CSV headers to known fields. Returns field key per column index (or null). */
export function mapCsvHeaders(headers: string[]): (keyof ImportedRow | null)[] {
  return headers.map((h) => {
    const n = h.trim().toLowerCase();
    const hit = CSV_FIELDS.find((f) => f.key === n || f.aliases.includes(n));
    return hit ? hit.key : null;
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LINKEDIN_RE = /^https?:\/\/(www\.)?linkedin\.com\/(in|company)\/[^\s/]+\/?$/i;

const normKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
/** Normalize a LinkedIn/profile URL: drop protocol, www, query/hash and trailing slash. */
export function normalizeProfileUrl(url: string): string {
  return url.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[?#].*$/, "").replace(/\/+$/, "");
}
/** Normalized person-name + company fallback key (never company alone). */
export const nameCompanyKey = (name: string, company: string) => `name:${normKey(name)}|${normKey(company)}`;
/** Strong person identifiers of an import row: normalized email and profile URL. */
export function rowIdentityKeys(r: Pick<ImportedRow, "email" | "linkedinUrl">): string[] {
  const keys: string[] = [];
  if (r.email.trim()) keys.push(`email:${normKey(r.email)}`);
  if (r.linkedinUrl.trim()) keys.push(`url:${normalizeProfileUrl(r.linkedinUrl)}`);
  return keys;
}
/** Duplicate key for an import row: normalized email, else profile URL, else name+company. */
export function importRowKey(r: Pick<ImportedRow, "email" | "linkedinUrl" | "firstName" | "lastName" | "company">): string {
  return rowIdentityKeys(r)[0] ?? nameCompanyKey(`${r.firstName} ${r.lastName}`, r.company);
}
/** Primary key for a stored prospect (seeds and older imports fall back to name+company). Also the v1 DNC fingerprint input. */
export function prospectKey(p: Pick<Prospect, "importKey" | "name" | "company">): string {
  return p.importKey || nameCompanyKey(p.name, p.company);
}

/** A person's identity: strong identifiers (email / profile URL) plus the name+company fallback. */
export interface PersonIdentity { strong: string[]; name: string }
export function prospectIdentity(p: Pick<Prospect, "importKey" | "identityKeys" | "name" | "company">): PersonIdentity {
  const strong = new Set(p.identityKeys ?? []);
  if (p.importKey && !p.importKey.startsWith("name:")) strong.add(p.importKey);
  return { strong: [...strong], name: nameCompanyKey(p.name, p.company) };
}
function rowIdentity(r: ImportedRow): PersonIdentity {
  return { strong: rowIdentityKeys(r), name: nameCompanyKey(`${r.firstName} ${r.lastName}`, r.company) };
}
/**
 * Same person? A shared email or profile URL always matches. Records that both carry an email
 * (or both a profile URL) and share none are different people, even with the same name and company.
 * Otherwise the normalized person name + company decides — so two decision-makers at one company stay separate.
 */
export function sameIdentity(a: PersonIdentity, b: PersonIdentity): boolean {
  if (a.strong.some((k) => b.strong.includes(k))) return true;
  for (const kind of ["email:", "url:"]) {
    if (a.strong.some((k) => k.startsWith(kind)) && b.strong.some((k) => k.startsWith(kind))) return false;
  }
  return a.name === b.name;
}
export const matchesAnyIdentity = (id: PersonIdentity, known: readonly PersonIdentity[]) => known.some((k) => sameIdentity(id, k));

/**
 * Validate + dedupe parsed rows, within the file and against the workspace. Pass existing prospects for
 * full identity matching; a plain key set (legacy) matches on any of the row's keys.
 */
export function validateImport(rows: string[][], mapping: (keyof ImportedRow | null)[], existingKeys: ReadonlySet<string> | readonly Prospect[] = new Set()): ImportResult {
  const known = existingKeys instanceof Set ? null : (existingKeys as readonly Prospect[]).map(prospectIdentity);
  const keySet = existingKeys instanceof Set ? existingKeys as ReadonlySet<string> : null;
  const seen: PersonIdentity[] = [];
  let existing = 0;
  const valid: ImportedRow[] = [];
  const invalid: { row: ImportedRow; reason: string }[] = [];
  let duplicates = 0;
  let missingLinkedIn = 0;

  for (const cells of rows) {
    const rec: ImportedRow = { firstName: "", lastName: "", company: "", jobTitle: "", location: "", industry: "", linkedinUrl: "", email: "", website: "", notes: "" };
    mapping.forEach((key, i) => { if (key) rec[key] = (cells[i] ?? "").trim(); });

    const problems: string[] = [];
    if (!rec.firstName && !rec.lastName) problems.push("missing name");
    if (!rec.company) problems.push("missing company");
    if (rec.email && !EMAIL_RE.test(rec.email)) problems.push("invalid email");
    if (rec.linkedinUrl && !LINKEDIN_RE.test(rec.linkedinUrl)) problems.push("invalid LinkedIn URL");
    if (!rec.linkedinUrl) missingLinkedIn++;

    if (problems.length > 0) { invalid.push({ row: rec, reason: problems.join(", ") }); continue; }

    const identity = rowIdentity(rec);
    const isExisting = known ? matchesAnyIdentity(identity, known) : [importRowKey(rec), ...identity.strong, identity.name].some((k) => keySet!.has(k));
    if (isExisting) { existing++; continue; }
    if (matchesAnyIdentity(identity, seen)) { duplicates++; continue; }
    seen.push(identity);
    valid.push(rec);
  }

  return { total: rows.length, valid, duplicates, existing, invalid, missingLinkedIn };
}

/** A usable sample CSV template customers can download. */


/** Convert a validated import row into a demo prospect record. */
export function importRowToProspect(row: ImportedRow, index: number): Prospect {
  const name = `${row.firstName} ${row.lastName}`.trim();
  const [city, country] = row.location.split(",").map((s) => s.trim());
  return {
    id: `imp-${Date.now().toString(36)}-${index}`,
    name,
    title: row.jobTitle || "Unknown role",
    roleCategory: /founder|ceo|cro|vp|head|director|managing|chief|owner|president/i.test(row.jobTitle) ? "decision_maker" : "other",
    company: row.company,
    industry: row.industry || "Unknown",
    country: country || row.location || "Unknown",
    city: city || row.location || "Unknown",
    employees: 50,
    need: "unknown",
    needNote: row.notes ? `Imported note: ${row.notes}` : "Imported contact — no public need signal assessed yet.",
    signals: row.notes ? [row.notes] : ["Imported via CSV"],
    channel: row.linkedinUrl && row.email ? "Both" : row.linkedinUrl ? "LinkedIn" : "Email",
    stage: "identified",
    replyStatus: "none",
    lastActivity: "Imported just now",
    importKey: importRowKey(row),
    ...(rowIdentityKeys(row).length ? { identityKeys: rowIdentityKeys(row) } : {}),
  };
}

/* ---------------------------- Campaign brief ---------------------------- */

/** Apply a campaign-name edit to a wizard draft so a previously generated brief never keeps a stale name. */
export function renameCampaignDraft<T extends { name: string; brief: CampaignBrief | null }>(draft: T, name: string): T {
  return { ...draft, name, brief: draft.brief ? { ...draft.brief, campaignName: name.trim() } : null };
}
/** Saved campaign name: the user's latest typed name wins over the generated brief. */
export function resolveCampaignName(draft: { name: string; brief: CampaignBrief | null }): string {
  return draft.name.trim() || draft.brief?.campaignName || "Untitled Campaign";
}

const OBJECTIVE_LABEL: Record<CampaignObjective, string> = Object.fromEntries(
  CAMPAIGN_OBJECTIVES.map((o) => [o.id, o.label]),
) as Record<CampaignObjective, string>;

/** Fields required per objective — used to flag incomplete briefs, never to invent data. */
export const OBJECTIVE_REQUIRED_FIELDS: Record<CampaignObjective, { key: string; label: string }[]> = {
  appointments: [
    { key: "targetAudience", label: "Target Audience" },
    { key: "valueProposition", label: "Main Value Proposition" },
    { key: "cta", label: "Call to Action" },
  ],
  event: [
    { key: "eventName", label: "Event Name" },
    { key: "eventDate", label: "Event Date" },
    { key: "eventLocation", label: "Event Location" },
    { key: "registrationLink", label: "Registration Link" },
    { key: "targetAudience", label: "Target Audience" },
    { key: "whyAttend", label: "Why Should Someone Attend?" },
    { key: "cta", label: "Call to Action" },
  ],
  product: [
    { key: "productName", label: "Product Name" },
    { key: "valueProposition", label: "Main Value Proposition" },
    { key: "targetAudience", label: "Target Audience" },
    { key: "cta", label: "Call to Action" },
  ],
  service: [
    { key: "serviceName", label: "Service Name" },
    { key: "valueProposition", label: "Main Value Proposition" },
    { key: "targetAudience", label: "Target Audience" },
    { key: "cta", label: "Call to Action" },
  ],
  partnerships: [
    { key: "partnershipType", label: "Partnership Type" },
    { key: "targetAudience", label: "Target Partner Profile" },
    { key: "cta", label: "Call to Action" },
  ],
  reconnect: [
    { key: "context", label: "Previous Relationship Context" },
    { key: "cta", label: "Call to Action" },
  ],
  custom: [
    { key: "targetAudience", label: "Target Audience" },
    { key: "cta", label: "Call to Action" },
  ],
};

/** Build a structured brief from the objective form + free-text input. Flags gaps; never invents. */
export function structureBrief(
  objective: CampaignObjective,
  campaignName: string,
  fields: Record<string, string>,
  rawInput: string,
): CampaignBrief {
  const required = OBJECTIVE_REQUIRED_FIELDS[objective];
  const missing = required.filter((f) => !(fields[f.key] ?? "").trim()).map((f) => f.label);

  const f = (k: string) => (fields[k] ?? "").trim();
  const structured: StructuredBrief = {
    objective: OBJECTIVE_LABEL[objective],
    targetAudience: f("targetAudience") || (rawInput ? "Derived from campaign description" : ""),
    coreMessage:
      f("valueProposition") || f("whyAttend") || f("eventDescription") ||
      (rawInput ? rawInput.slice(0, 220) : ""),
    keyBenefits: f("keyBenefits") || f("whyAttend") || f("highlights") || "",
    callToAction: f("cta") || "",
    importantDates: f("eventDate") ? `${f("eventDate")}${f("eventTime") ? ` at ${f("eventTime")}` : ""}` : "",
    personalizationAngles: [
      f("targetAudience") && "Role and seniority",
      f("eventLocation") && `Location relevance (${f("eventLocation")})`,
      "Industry context",
      "Known prospect signals",
    ].filter(Boolean).join(", "),
  };
  if (!rawInput.trim() && !structured.coreMessage) missing.push("Campaign description or value proposition");

  return { objective, campaignName: campaignName.trim(), rawInput: rawInput.trim(), fields, structured, missing };
}

/** AI-structured fields replace the template's, but the user's name, objective and missing-field flags stay authoritative. */
export function mergeAiBrief(template: CampaignBrief, ai: Omit<CampaignBrief["structured"], "objective">): CampaignBrief {
  return { ...template, structured: { ...template.structured, ...ai, objective: template.structured.objective }, generatedBy: "ai" };
}

export const AI_UNAVAILABLE_MESSAGE: Record<string, string> = {
  limit: "AI generation limit reached for now. Try again in a few minutes.",
  credits: "AI credits are exhausted for this workspace.",
  rate_limited: "The AI service is busy. Try again shortly.",
  denied: "AI access is not available for this workspace.",
  not_configured: "AI is not configured.",
  locked: "Your demo session has ended. Unlock again to use AI.",
  invalid_output: "The AI response could not be used.",
  unavailable: "The AI service is temporarily unavailable.",
};

/* -------------------------- Message generation -------------------------- */

function firstName(name: string) { return name.split(" ")[0] || name; }

function fillVars(body: string, p: Prospect): string {
  return body
    .replaceAll("{firstName}", firstName(p.name))
    .replaceAll("{company}", p.company)
    .replaceAll("{role}", p.title)
    .replaceAll("{industry}", p.industry)
    .replaceAll("{location}", p.city || p.country);
}

/** Generate a truthful message draft from the approved brief + known prospect attributes only. */
export function generateMessage(channel: MessageChannelId, brief: CampaignBrief, p: Prospect): string {
  const s = brief.structured;
  const eventName = brief.fields["eventName"]?.trim();
  const subject = eventName || brief.campaignName || s.objective;
  const cta = s.callToAction || "Would it be worth a short conversation?";
  const core = s.coreMessage || `We are reaching out about ${subject}.`;

  switch (channel) {
    case "li_connect":
      return `Hi {firstName} — I noticed your work at {company} in {industry}. ${core.length > 140 ? core.slice(0, 140) + "…" : core} Thought it would be valuable to connect.`;
    case "li_followup":
      return `Hi {firstName}, thanks for connecting. ${core} ${cta}`;
    case "li_message":
      return `Hi {firstName} — following up on my earlier note. Given your role as {role} at {company}, I thought this would be relevant: ${s.keyBenefits || core} ${cta}`;
    case "email_intro":
      return `Subject: ${subject}\n\nHi {firstName},\n\n${core}\n\n${s.keyBenefits ? `Why it matters: ${s.keyBenefits}\n\n` : ""}${cta}\n\nBest regards,\nYour team`;
    case "email_followup":
      return `Subject: Re: ${subject}\n\nHi {firstName},\n\nJust following up on my earlier note about ${subject}. ${s.keyBenefits || core}\n\n${cta}\n\nBest regards,\nYour team`;
    case "inmail":
      return `Subject: ${subject} — for {firstName}\n\nHi {firstName}, I'm reaching out via InMail given your role as {role}. ${core} ${cta}`;
  }
}

export function renderMessageForProspect(templateBody: string, p: Prospect): string {
  return fillVars(templateBody, p);
}

export function defaultTemplates(brief: CampaignBrief, sampleProspect: Prospect): MessageTemplate[] {
  return MESSAGE_CHANNELS.map((ch) => ({
    id: `tpl-${ch.id}`,
    channel: ch.id,
    label: ch.label,
    body: generateMessage(ch.id, brief, sampleProspect),
    status: "draft" as TemplateStatus,
    savedAsTemplate: false,
  }));
}

/* --------------------------- Sequence building --------------------------- */

export function defaultSequenceConfig(): SequenceConfig {
  return {
    followUps: 3,
    delayValue: 3,
    delayUnit: "days",
    sendingDays: "Working days (Mon–Fri)",
    sendingHours: "09:00–17:00",
    timezone: "Asia/Dubai (GMT+4)",
    startMode: "immediate",
    duration: "completion",
    stopOnReply: true,
    stopOnOptOut: true,
    stopOnDecline: true,
    stopOnMeeting: true,
    stopOnHuman: true,
    stopOnInvalid: true,
    coolingOff: { enabled: false, runDays: 30, breakDays: 14, resumeDate: "", notifyBeforeRestart: true, requireApproval: true },
  };
}

let seqN = 0;
const sid = () => `sq-${++seqN}-${Date.now().toString(36)}`;

/** Default Day 1 → 3 → 7 → 12 journey matching the spec sample. */
export function defaultSequence(): SequenceStep[] {
  return [
    { id: sid(), kind: "action", day: 1, label: "LinkedIn Connection Request", channel: "LinkedIn", enabled: true },
    { id: sid(), kind: "condition", day: 1, label: "Connection Accepted?", condition: { question: "Connection Accepted?", onYes: "Continue to LinkedIn message", onNo: "Wait per configured rules, then follow the eligible alternative path" }, enabled: true },
    { id: sid(), kind: "action", day: 3, label: "LinkedIn Follow-Up Message", channel: "LinkedIn", enabled: true },
    { id: sid(), kind: "wait", day: 7, label: "Wait 4 days", waitDays: 4, enabled: true },
    { id: sid(), kind: "condition", day: 7, label: "Has Prospect Replied?", condition: { question: "Has Prospect Replied?", onYes: "Stop automated follow-ups — send to Intent Intelligence", onNo: "Continue to next approved step" }, enabled: true },
    { id: sid(), kind: "action", day: 7, label: "Email Follow-Up", channel: "Email", enabled: true },
    { id: sid(), kind: "wait", day: 12, label: "Wait 5 days", waitDays: 5, enabled: true },
    { id: sid(), kind: "action", day: 12, label: "Final Follow-Up", channel: "LinkedIn", enabled: true },
    { id: sid(), kind: "end", day: 12, label: "End Sequence", enabled: true },
  ];
}

/** Compact timeline markers (Day 1 → Day 3 → Day 7 → Day 12) from enabled action steps. */
export function sequenceTimeline(sequence: SequenceStep[]): { day: number; label: string }[] {
  return sequence
    .filter((s) => s.enabled && s.kind === "action")
    .map((s) => ({ day: s.day, label: s.label }));
}

/* --------------------------- Readiness checks --------------------------- */

export interface ReadinessItem { label: string; level: "ready" | "attention" | "blocked"; }

export interface ChannelApproval {
  channel: MessageChannelId; label: string; optional: boolean; present: boolean;
  /** Selected prospects with an approved personalized message on this channel. */
  approved: number; total: number;
}
export interface ApprovalProgress {
  channels: ChannelApproval[]; prospects: number; requiredChannels: number;
  requiredApproved: number; requiredTotal: number; outstanding: number;
  optionalApproved: number; optionalTotal: number;
}

/**
 * Per-prospect message approval progress. A prospect counts as approved on a channel only when
 * every template for that channel has an approved personalized message for them — the
 * template-level status flag alone never counts. Sales Navigator InMail is optional and excluded.
 */
export function messageApprovalProgress(c: Pick<Campaign, "templates" | "prospectIds">): ApprovalProgress {
  const audience = [...new Set(c.prospectIds)];
  const channels: ChannelApproval[] = MESSAGE_CHANNELS.map((ch) => {
    const ts = c.templates.filter((t) => t.channel === ch.id);
    const ok = (id: string) => ts.length > 0 && ts.every((t) => (t.personalized ?? []).some((m) => m.prospectId === id && m.status === "approved"));
    return { channel: ch.id, label: ch.label, optional: ch.id === "inmail", present: ts.length > 0, approved: audience.filter(ok).length, total: audience.length };
  });
  const required = channels.filter((x) => !x.optional);
  const optional = channels.filter((x) => x.optional);
  const requiredApproved = required.reduce((n, x) => n + x.approved, 0);
  const requiredTotal = required.length * audience.length;
  return {
    channels, prospects: audience.length, requiredChannels: required.length,
    requiredApproved, requiredTotal, outstanding: requiredTotal - requiredApproved,
    optionalApproved: optional.reduce((n, x) => n + x.approved, 0),
    optionalTotal: optional.length * audience.length,
  };
}

export function campaignReadiness(c: Campaign): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const progress = messageApprovalProgress(c);

  items.push(c.prospectIds.length > 0
    ? { label: `${c.prospectIds.length} prospects assigned to the audience`, level: "ready" }
    : { label: "No prospects assigned — choose an audience first", level: "blocked" });

  items.push(c.brief && c.brief.missing.length === 0
    ? { label: "Campaign brief complete", level: "ready" }
    : c.brief
      ? { label: `Brief incomplete — required: ${c.brief.missing.join(", ")}`, level: "blocked" }
      : { label: "Campaign brief not created", level: "blocked" });

  items.push(progress.requiredTotal > 0 && progress.outstanding === 0
    ? { label: `All ${progress.requiredTotal} required prospect messages approved (${progress.prospects} prospects × ${progress.requiredChannels} required channels)`, level: "ready" }
    : progress.requiredTotal === 0
      ? { label: "Required prospect messages have not been approved — assign an audience first", level: "blocked" }
      : { label: `${progress.outstanding} of ${progress.requiredTotal} required prospect messages have not been approved — every selected prospect needs an approved message on each required channel`, level: "blocked" });

  items.push(c.sequence.some((s) => s.enabled && s.kind === "action")
    ? { label: "Follow-up sequence configured", level: "ready" }
    : { label: "No active steps in the follow-up sequence", level: "blocked" });

  items.push({ label: "Email account not connected — email steps will be simulated only", level: "attention" });
  items.push({ label: `Sales Navigator InMail — optional channel, excluded from readiness (${progress.optionalApproved} of ${progress.optionalTotal} approved)`, level: "attention" });

  return items;
}

export function isCampaignReady(c: Campaign): boolean {
  return !campaignReadiness(c).some((i) => i.level === "blocked");
}

/** Statuses only reachable after a campaign has passed readiness and been approved. */
export const POST_APPROVAL_STATUSES: ReadonlyArray<CampaignStatus> = ["approved", "running", "paused", "stopped", "completed"];
const ALLOWED_FROM: Partial<Record<CampaignStatus, ReadonlyArray<CampaignStatus>>> = {
  running: ["approved", "paused"],
  paused: ["running"],
  stopped: ["approved", "running", "paused"],
  completed: ["running", "paused", "stopped"],
};

/** Refusal message when a campaign fails a blocking readiness check, otherwise null. */
export function campaignApprovalError(c: Campaign): string | null {
  const blocked = campaignReadiness(c).filter((i) => i.level === "blocked");
  return blocked.length ? `INVALID_REQUEST: Campaign is not ready for approval — ${blocked.map((i) => i.label).join("; ")}.` : null;
}

/** Guards status changes: entering the approved lifecycle requires readiness; drafts can always be saved. */
export function campaignStatusChangeError(old: Campaign, next: CampaignStatus): string | null {
  if (old.status === next || next === "draft" || next === "in_review") return null;
  if (next === "approved") return POST_APPROVAL_STATUSES.includes(old.status) ? null : campaignApprovalError(old);
  return ALLOWED_FROM[next]?.includes(old.status) ? null : `INVALID_REQUEST: A campaign must be approved before it can be ${next}.`;
}

/* ------------------------- Demo simulation script ------------------------- */

/** Scripted simulation events — each references the real campaign audience. */
export function simulationScript(c: Campaign, prospectNames: string[]): string[] {
  const n = c.prospectIds.length;
  const first = prospectNames[0] ?? "A sample prospect";
  return [
    `Campaign simulation started for “${c.name}”.`,
    `${n} prospects entered the campaign queue.`,
    `Connection request stage simulated for ${Math.min(5, n)} prospects.`,
    `${first} accepted the connection request (simulated).`,
    `Follow-up stage scheduled per the configured sequence.`,
    `Positive response simulated from ${first}.`,
    `Outreach paused for the responding prospect — automated follow-ups stopped.`,
    `Buyer Intent analysis completed — response routed to the Intelligence Inbox.`,
    `Approval requested — a suggested reply is waiting for your review.`,
  ];
}

/* ------------------------- Suggested replies ------------------------- */

/** Build a suggested reply using only approved campaign brief content. */
export function suggestedReplyFor(brief: CampaignBrief | null, intentLabel: string): string {
  if (!brief) return "Thank you for your reply — I'll follow up with the relevant details shortly.";
  const s = brief.structured;
  const eventBits = [
    brief.fields["eventName"] && `about ${brief.fields["eventName"]}`,
    brief.fields["eventDate"] && `on ${brief.fields["eventDate"]}`,
    brief.fields["eventLocation"] && `in ${brief.fields["eventLocation"]}`,
  ].filter(Boolean).join(" ");
  if (intentLabel.toLowerCase().includes("high") || intentLabel.toLowerCase().includes("positive")) {
    return `Hi {firstName}, thank you for your interest ${eventBits || `in ${brief.campaignName}`}. ` +
      `${brief.fields["registrationLink"] ? `You can find the agenda and register here: ${brief.fields["registrationLink"]}. ` : ""}` +
      `Happy to answer any questions — would a short call help?`;
  }
  return `Hi {firstName}, thanks for letting me know. I'll make a note and check back at a better time. Wishing you well in the meantime.`;
}