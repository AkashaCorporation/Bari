export const BARI_WELCOME_PASTE_IMAGE_SHORTCUT = '{paste-image-shortcut}';

export const BARI_WELCOME_DESIGN = {
  identity: {
    company: 'AKASHA CORPORATION',
    signature: 'AKASHA CORPORATION  //  AGENTIC ENGINEERING',
    compactSignature: 'AKASHA // BARI',
    microSignature: 'AKASHA',
  },
  sectionTitles: {
    tips: 'Operator console',
    news: 'Product surface · /changelog for history',
  },
  tipPool: [
    'Define the outcome, evidence bar, and verification before execution.',
    `Use @ for files; ${BARI_WELCOME_PASTE_IMAGE_SHORTCUT} for images.`,
    'Run /init to add repository guidance for Bari.',
    'Use /campaign to freeze scope and evidence for authorized security research.',
    'Use /team to orchestrate agents and /tasks to inspect active work.',
    'Use /model to inspect or change the selected model.',
    'Use /context to inspect the current session context budget.',
    'Use /sessions to resume earlier work.',
    'Use /history to review and branch from earlier prompts.',
    'Use /goal to keep long-running work focused on a finish line.',
    'Use /permission to choose how Bari handles tool approvals.',
    'Use /feedback to preview a redacted report before upload.',
  ],
  wide: {
    tips: [
      'Define the outcome, evidence bar, and verification.',
      '/campaign scopes research · /team orchestrates agents.',
      `@ files · ${BARI_WELCOME_PASTE_IMAGE_SHORTCUT} images · /tasks active work.`,
    ],
    news: [
      'Security Campaigns preserve scope, evidence, and duplicate review.',
      'Provider catalogs synchronize without inference.',
      'Agent Teams keep roles, ownership, and model policy explicit.',
    ],
  },
  stacked: {
    tips: [
      'Define the outcome, evidence bar, and verification.',
      `/campaign scope · /team agents · @ files · ${BARI_WELCOME_PASTE_IMAGE_SHORTCUT} images`,
    ],
    news: ['Campaigns preserve evidence.', 'Teams preserve ownership · /model routing'],
  },
  compact: {
    tips: [
      `@ files · ${BARI_WELCOME_PASTE_IMAGE_SHORTCUT} images`,
      '/campaign scope · /team agents',
    ],
    news: ['/tasks · /model · /context', '/changelog history'],
  },
  hero: {
    fullMinWidth: 29,
    mediumMinWidth: 12,
    microMinWidth: 8,
    fallbackTitle: 'Bari',
  },
} as const;

export const BARI_TERMINAL_WORDMARK = [
  '██████╗  █████╗ ██████╗ ██╗',
  '██╔══██╗██╔══██╗██╔══██╗██║',
  '██████╔╝███████║██████╔╝██║',
  '██╔══██╗██╔══██║██╔══██╗██║',
  '██████╔╝██║  ██║██║  ██║██║',
  '╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝',
] as const;

export const BARI_TERMINAL_MEDIUM_WORDMARK = ['BARI'] as const;

export const BARI_TERMINAL_MICRO_WORDMARK = [
  '██████╗ ',
  '██╔══██╗',
  '██████╔╝',
  '██╔══██╗',
  '██████╔╝',
  '╚═════╝ ',
] as const;

/** @deprecated Use BARI_WELCOME_PASTE_IMAGE_SHORTCUT. */
export const MINIMAX_CODE_WELCOME_PASTE_IMAGE_SHORTCUT = BARI_WELCOME_PASTE_IMAGE_SHORTCUT;
/** @deprecated Use BARI_WELCOME_DESIGN. */
export const MINIMAX_CODE_WELCOME_DESIGN = BARI_WELCOME_DESIGN;
/** @deprecated Use BARI_TERMINAL_WORDMARK. */
export const MINIMAX_CODE_TERMINAL_WORDMARK = BARI_TERMINAL_WORDMARK;
/** @deprecated Use BARI_TERMINAL_MEDIUM_WORDMARK. */
export const MINIMAX_CODE_TERMINAL_MEDIUM_WORDMARK = BARI_TERMINAL_MEDIUM_WORDMARK;
/** @deprecated Use BARI_TERMINAL_MICRO_WORDMARK. */
export const MINIMAX_CODE_TERMINAL_MICRO_WORDMARK = BARI_TERMINAL_MICRO_WORDMARK;
