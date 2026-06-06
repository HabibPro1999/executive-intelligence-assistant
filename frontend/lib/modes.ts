import { AssistantMode } from '@/types';

// Executive action buttons (PRD §16.3): each sends a preconfigured message + mode.
export interface ModeAction {
  mode: AssistantMode;
  label: string;
  message: string;
}

export const EXECUTIVE_ACTIONS: ModeAction[] = [
  {
    mode: 'executive_summary',
    label: 'Executive Summary',
    message:
      'Generate a concise executive summary based on the uploaded approved documents.',
  },
  {
    mode: 'strategic_briefing',
    label: 'Strategic Brief',
    message:
      'Generate a strategic briefing based on the uploaded approved documents.',
  },
  {
    mode: 'financial_center_benchmark',
    label: 'Benchmark',
    message:
      'Generate a financial center benchmarking analysis based on the uploaded approved documents.',
  },
  {
    mode: 'market_opportunity_analysis',
    label: 'Market Opportunity',
    message:
      'Generate a market opportunity analysis based on the uploaded approved documents.',
  },
  {
    mode: 'performance_insights',
    label: 'Performance Insights',
    message:
      'Generate performance management insights based on the uploaded approved documents.',
  },
];

export const STRATEGY_DECK_ACTION = {
  label: 'Strategy Deck',
  message:
    'Generate a strategy-consulting presentation deck from the uploaded approved documents.',
} as const;

export const MODE_LABELS: Record<AssistantMode, string> = {
  qa: 'Q&A',
  executive_summary: 'Executive Summary',
  strategic_briefing: 'Strategic Briefing',
  financial_center_benchmark: 'Financial Center Benchmark',
  market_opportunity_analysis: 'Market Opportunity Analysis',
  performance_insights: 'Performance Insights',
};

// Sample questions shown on the empty state (PRD §9 / §25 demo script).
export const SAMPLE_QUESTIONS: string[] = [
  'What are the main strategic priorities mentioned in the uploaded documents?',
  'Compare the financial centers covered in the uploaded benchmark file.',
  'Which departments need leadership attention based on the uploaded KPI file?',
];
