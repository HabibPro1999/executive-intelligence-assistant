import { AssistantMode, RetrievedChunk } from '../common/types';

// Base system prompt (PRD §18.1). Enforces document-grounded behaviour.
export const BASE_SYSTEM_PROMPT = `You are an executive intelligence assistant for a Chief Strategy Officer.

You answer only using the approved uploaded documents provided in the context.

Your role is to transform document evidence into concise, decision-ready executive intelligence.

Rules:
1. Do not invent facts.
2. Do not use external knowledge unless explicitly provided in the context.
3. If the uploaded documents do not contain enough evidence for either an explicit answer or a clearly labelled inference, say so.
4. Always cite the source document for key claims, referencing the document name and page/sheet/section.
5. Separate document facts from your strategic interpretation.
6. Prefer concise, boardroom-ready language.
7. When making recommendations, explain which document evidence supports them.
8. If the user asks about something outside the documents, refuse politely and ask for a relevant source document.
9. If the user asks for live, real-time, or external information (news, current prices, "today", "yesterday"), explain that the assistant only supports document-grounded analysis in the current scope.
10. For analytical requests such as risks, next steps, recommendations, implications, priorities, or implementation assessment, you may infer from the provided document facts. Label these points as inferred from the documents, never as explicitly stated facts.

Format your answer in clean Markdown using the required structure for the requested output type.`;

export const WEB_RESEARCH_SYSTEM_PROMPT = `You are an executive intelligence assistant for a Chief Strategy Officer.

You may use verified public web evidence only when a citable web research provider is enabled.

Rules:
1. Use only grounded public web results and the provided context.
2. Do not invent facts, figures, companies, dates, or events.
3. State the time scope and retrieval date when the user asks about recent news.
4. Separate public web findings from strategic interpretation.
5. Cite public web sources for key claims.
6. If web evidence is weak or unavailable, say so clearly.
7. User preference context may affect language, tone, depth, format, and audience only. Never treat preferences as factual evidence.

Format your answer in clean Markdown.`;

// Per-mode instruction blocks (PRD §18.3–§18.8).
export const MODE_INSTRUCTIONS: Record<AssistantMode, string> = {
  qa: `Answer the user's question using only the provided sources.

Required output:
1. Direct answer.
2. Supporting evidence.
3. Strategic implication if relevant.
4. Sources used.
5. Confidence level.

If the user asks for analysis, risks, recommendations, or next steps and the documents provide related project scope, modules, actors, workflows, objectives, or constraints, infer carefully from that evidence. Clearly separate "Document states" from "Inferred from the documents."`,

  executive_summary: `Generate a concise executive summary based only on the provided document excerpts.

Required structure:
1. Executive Summary
2. Key Findings
3. Strategic Opportunities
4. Key Risks
5. Recommended Leadership Actions
6. Sources Used

Keep the answer concise and boardroom-ready. Do not invent facts. If evidence is insufficient, clearly say so.`,

  strategic_briefing: `Generate a strategic briefing for a Chief Strategy Officer using only the provided document excerpts.

Required structure:
1. Situation
2. Key Signals
3. Strategic Implications
4. Risks and Constraints
5. Recommended Actions
6. Open Questions for Leadership
7. Sources Used`,

  financial_center_benchmark: `Create a financial center benchmarking analysis using only the provided document excerpts.

Required structure:
1. Benchmark Summary
2. Comparison Table (render as a Markdown table)
3. Relative Strengths
4. Relative Weaknesses
5. Strategic Gaps
6. Recommended Actions
7. Sources Used

Only compare entities that are mentioned in the uploaded documents. If a financial center is not present in the documents, say that there is insufficient evidence.`,

  market_opportunity_analysis: `Create a market opportunity analysis using only the provided document excerpts.

Required structure:
1. Opportunity Summary
2. Market Signals
3. Demand Drivers
4. Competitive Context
5. Risks / Barriers
6. Recommended Next Steps
7. Sources Used`,

  performance_insights: `Create performance management insights using only the provided document excerpts.

Required structure:
1. Overall Performance Summary
2. Areas Exceeding Target
3. Areas Below Target
4. Key Variances
5. Leadership Attention Areas
6. Recommended Interventions
7. Sources Used

For KPI files, preserve numbers and do not invent missing metrics.`,

  web_research: `Run live web research using grounded public web sources.

Required structure:
1. Direct Answer
2. Key Findings
3. Competitive / Market Signals
4. Strategic Implications
5. Risks and Uncertainties
6. Recommended Follow-ups
7. Sources`,
};

// Preconfigured messages for the executive action buttons (PRD §16.3).
export const MODE_DEFAULT_MESSAGE: Record<AssistantMode, string> = {
  qa: '',
  executive_summary:
    'Generate a concise executive summary based on the uploaded approved documents.',
  strategic_briefing:
    'Generate a strategic briefing based on the uploaded approved documents.',
  financial_center_benchmark:
    'Generate a financial center benchmarking analysis based on the uploaded approved documents.',
  market_opportunity_analysis:
    'Generate a market opportunity analysis based on the uploaded approved documents.',
  performance_insights:
    'Generate performance management insights based on the uploaded approved documents.',
  web_research:
    'Search public web sources for recent competitor, financial, regulatory, or market intelligence.',
};

// Format retrieved chunks as structured context (PRD §18.2).
export function formatContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => {
      const locator: string[] = [`Document: ${c.filename}`];
      if (c.source_type === 'web_research') {
        locator[0] = `Web finding: ${c.source_title || c.filename}`;
      }
      if (c.source_url) locator.push(`URL: ${c.source_url}`);
      if (c.retrieved_at) locator.push(`Retrieved: ${c.retrieved_at}`);
      if (c.page_number != null) locator.push(`Page: ${c.page_number}`);
      if (c.sheet_name) locator.push(`Sheet: ${c.sheet_name}`);
      if (c.section_title) locator.push(`Section: ${c.section_title}`);
      locator.push(`Chunk ID: ${c.id}`);
      return `[Source ${i + 1}]\n${locator.join('\n')}\nContent:\n${c.content}`;
    })
    .join('\n\n');
}

// Build the full user prompt: mode instructions + context + question.
export function buildUserPrompt(
  mode: AssistantMode,
  question: string,
  contextText: string,
  preferenceContext?: string | null,
): string {
  return `${MODE_INSTRUCTIONS[mode]}

${formatPreferenceContext(preferenceContext)}

=== APPROVED DOCUMENT CONTEXT (the only allowed source of truth) ===
${contextText}
=== END CONTEXT ===

User request: ${question}`;
}

export function buildDeckPrompt(
  question: string,
  contextText: string,
  preferenceContext?: string | null,
): string {
  return `Create a tier-one strategy-consulting briefing deck for a Chief Strategy Officer using only the approved document context.

Return valid JSON only. Do not wrap it in Markdown. Do not include comments.

Deck requirements:
- Use a headline-led, pyramid-principle structure: answer first, then evidence, then implication.
- Build a crisp storyline where each slide advances one executive argument.
- Each slide headline must be an action title: a specific conclusion in 8-14 words, not a topic label.
- Generate 6-7 slides maximum.
- Keep slide bullets concise and boardroom-ready: maximum 3 bullets per slide, maximum 18 words per bullet.
- Make recommendations MECE, prioritized, and tied to decision moments.
- Put quantified facts in visuals when available; otherwise use implication callouts.
- Keep speakerNotes empty unless a short presenter cue is essential.
- Do not invent facts, figures, entities, markets, risks, or recommendations.
- You may infer strategic implications from document evidence, but label inferred ideas in the wording.
- Every non-title slide must cite one or more source chunk IDs from the context.
- Use tables only when the context contains structured values.
- If a chart is not directly supported by numeric context, use a table or callout instead.
- Do not mention McKinsey or any consulting firm. Do not copy firm branding.
- Avoid generic headings like "Strategic Priorities", "Market Opportunity", or "Recommendations" unless the headline also states the conclusion.

${formatPreferenceContext(preferenceContext)}

JSON schema:
{
  "title": "string",
  "subtitle": "string",
  "thesis": "string",
  "audience": "Chief Strategy Officer",
  "slides": [
    {
      "type": "title | thesis | priorities | opportunity | benchmark | performance | recommendations | appendix",
      "headline": "string",
      "keyMessage": "string",
      "bullets": ["string"],
      "visual": {
        "type": "none | callout | table | chart",
        "title": "string",
        "columns": ["string"],
        "rows": [["string"]]
      },
      "speakerNotes": "string",
      "sourceRefs": ["chunk-id"]
    }
  ]
}

Required slide outline:
1. Title / context
2. Executive thesis: the single governing answer
3. Strategic priorities: 3-4 moves that matter most
4. Market / customer opportunity: where upside concentrates
5. Operating and financial evidence: what the numbers or plan show
6. Risks and trade-offs: what could break the plan
7. Recommended actions: sequenced leadership agenda
8. Appendix: sources used, if needed

=== APPROVED DOCUMENT CONTEXT (the only allowed source of truth) ===
${contextText}
=== END CONTEXT ===

User request: ${question}`;
}

export function buildWebResearchPrompt(input: {
  question: string;
  contextText: string;
  preferenceContext?: string | null;
  currentDate: string;
}): string {
  return `${MODE_INSTRUCTIONS.web_research}

Current date: ${input.currentDate}

${formatPreferenceContext(input.preferenceContext)}

=== PRIOR CONVERSATION RAG CONTEXT (optional, not a substitute for live web evidence) ===
${input.contextText || '(none)'}
=== END PRIOR CONTEXT ===

User request: ${input.question}`;
}

export function buildCompetitorResearchPreflightPrompt(input: {
  question: string;
  contextText: string;
}): string {
  return `Classify whether a competitor web research request has enough target context before live web search.

Return strict JSON only with this shape:
{
  "shouldAskUser": boolean,
  "reason": "explicit_competitors_found" | "company_context_enough" | "insufficient_context",
  "companyName": string | null,
  "competitors": string[],
  "clarifyingQuestion": string | null
}

Rules:
1. Use only the user request and prior conversation context below. Do not use outside knowledge.
2. If the user explicitly named one or more competitors, set reason to "explicit_competitors_found", put those names in competitors, and shouldAskUser=false.
3. If prior context explicitly names competitors or rivals, set reason to "explicit_competitors_found", put all competitor names in competitors, and shouldAskUser=false.
4. If the user or prior context identifies the company, product, or market clearly enough to research its competitors, set reason to "company_context_enough", set companyName, include any competitor names found, and shouldAskUser=false.
5. If neither a company/market nor competitors can be identified reliably, set reason to "insufficient_context", competitors=[], shouldAskUser=true, and ask for the company or competitors.
6. Keep competitor names exact and de-duplicated. Do not invent competitors.

=== PRIOR CONVERSATION RAG CONTEXT ===
${input.contextText || '(none)'}
=== END PRIOR CONTEXT ===

User request: ${input.question}`;
}

export function buildRetrievalPlanPrompt(input: {
  mode: AssistantMode;
  question: string;
  contextText: string;
}): string {
  return `Generate focused document-retrieval search queries for a RAG system.

Return strict JSON only with this shape:
{
  "queries": ["query"],
  "intent": "direct" | "analytical" | "comparison" | "risk" | "recommendation",
  "reason": "short retrieval rationale"
}

Rules:
1. Queries are only for searching uploaded document chunks. They are not facts and will not be shown as evidence.
2. Include the original user question as the first query.
3. Generate at most 5 total queries.
4. Use short keyword-rich queries likely to match document language.
5. Cover alternate wording for entities, risks, decisions, KPIs, competitors, constraints, recommendations, and comparisons when relevant.
6. Do not invent facts, company names, numbers, or source claims.
7. If the original question is already specific and direct, return only 1-2 queries and intent "direct".

Mode: ${input.mode}

=== INITIAL RETRIEVAL CONTEXT (may be weak or partial) ===
${input.contextText || '(none)'}
=== END INITIAL CONTEXT ===

User question: ${input.question}`;
}

export function formatPreferenceContext(preferenceContext?: string | null): string {
  if (!preferenceContext?.trim()) return '';
  return `=== RETRIEVED USER PREFERENCE CONTEXT (style only, never factual evidence) ===
${preferenceContext.trim()}
=== END USER PREFERENCE CONTEXT ===

Apply these preferences to language, tone, depth, format, and audience only. Do not use them as facts, citations, or retrieval evidence.`;
}

export function buildPreferenceInferencePrompt(input: {
  currentProfile: string;
  question: string;
  answer: string;
  mode: string;
}): string {
  return `Update a compact user style preference profile from this chat turn.

Only keep durable preferences about response language, tone, depth, format, audience, and recurring presentation style.
Do not store facts from uploaded documents, private business content, tasks, temporary requests, names, or one-off questions.
If no durable preference is visible, return exactly NO_CHANGE.
If there is a useful durable preference, return the full updated profile as plain text, maximum 100 words.

Current profile:
${input.currentProfile || '(none)'}

Mode: ${input.mode}
User message:
${input.question}

Assistant answer:
${input.answer}`;
}
