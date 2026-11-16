import type { TuiThemePalette } from './contracts.js';

/** Bari's terminal-native dark palette. Backgrounds remain owned by the terminal. */
export const BARI_DARK_THEME: TuiThemePalette = Object.freeze({
  id: 'bari',
  appearance: 'dark',
  colors: Object.freeze({
    brand: '#4CA6E8',
    wordmarkHighlight: '#8FD3FF',
    wordmarkShadow: '#2C5F9E',
    signal: '#58B9F2',
    orbit: '#47C6B1',
    accent: '#D6A85F',
    markdownHeading: '#F0C674',
    markdownCode: '#86EFAC',
    markdownLink: '#7DD3FC',
    userMessageBg: '#20252D',
    diffAddedBg: '#173B2B',
    diffRemovedBg: '#492424',
    text: '#E5E7EB',
    muted: '#A3AAB5',
    dim: '#737B89',
    border: '#353C48',
    line: '#687386',
    success: '#4ADE80',
    warning: '#FBBF24',
    error: '#FB7185',
  }),
});

/** Bari's light palette, tuned for contrast on a terminal-provided light background. */
export const BARI_LIGHT_THEME: TuiThemePalette = Object.freeze({
  id: 'bari',
  appearance: 'light',
  colors: Object.freeze({
    brand: '#245F9E',
    wordmarkHighlight: '#2B74B7',
    wordmarkShadow: '#193F70',
    signal: '#176FA6',
    orbit: '#087A68',
    accent: '#8A5A14',
    markdownHeading: '#8A5A14',
    markdownCode: '#176B35',
    markdownLink: '#005EA8',
    userMessageBg: '#F1F4F7',
    diffAddedBg: '#DAFBE1',
    diffRemovedBg: '#FFEBE9',
    text: '#202630',
    muted: '#555E6C',
    dim: '#747D8A',
    border: '#D8DDE5',
    line: '#717B89',
    success: '#087A36',
    warning: '#815B00',
    error: '#C51F3A',
  }),
});

/** @deprecated Use BARI_DARK_THEME. */
export const MINIMAX_CODE_DARK_THEME = BARI_DARK_THEME;
/** @deprecated Use BARI_LIGHT_THEME. */
export const MINIMAX_CODE_LIGHT_THEME = BARI_LIGHT_THEME;
