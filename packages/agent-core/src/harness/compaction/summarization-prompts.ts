/** Shared role instruction used by ordinary and branch compaction requests. */
export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`;

const SENDER_PROVENANCE_SUMMARIZATION_INSTRUCTIONS =
  "When a conversation line includes sender={...}, that JSON identifies the author of that user turn. Preserve attribution for material facts, preferences, instructions, decisions, and disagreements; never transfer them to another sender or an anonymous user. A user line without sender={...} is unattributed: preserve its facts as unattributed and do not assign them to a known sender.";

/** Keep identity policy last so caller-supplied focus cannot supersede it. */
export function withSenderProvenanceSummarizationInstructions(prompt: string): string {
  return `${prompt}\n\n${SENDER_PROVENANCE_SUMMARIZATION_INSTRUCTIONS}`;
}
