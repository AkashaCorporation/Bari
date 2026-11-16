import { visibleWidth } from '../../rendering/text.js';
import { tuiChalk as chalk, tuiColors as colors } from '../../theme/runtime.js';
import { centerToWidth } from '../frame.js';
import {
  BARI_TERMINAL_MEDIUM_WORDMARK,
  BARI_TERMINAL_MICRO_WORDMARK,
  BARI_TERMINAL_WORDMARK,
  BARI_WELCOME_DESIGN,
} from './design.js';

export function renderTuiWelcomeHero(width: number): string[] {
  const { fullMinWidth, mediumMinWidth, microMinWidth, fallbackTitle } =
    BARI_WELCOME_DESIGN.hero;
  const source =
    width >= fullMinWidth
      ? BARI_TERMINAL_WORDMARK
      : width >= mediumMinWidth
        ? BARI_TERMINAL_MEDIUM_WORDMARK
        : width >= microMinWidth
          ? BARI_TERMINAL_MICRO_WORDMARK
          : [fallbackTitle];
  const isCharacterWordmark = source.length > 1;
  const sourceWidth = Math.max(...source.map((line) => visibleWidth(line)));
  const gradient = [
    colors.wordmarkHighlight,
    colors.wordmarkHighlight,
    colors.brand,
    colors.brand,
    colors.wordmarkShadow,
    colors.wordmarkShadow,
  ];

  const wordmark = source.map((line, index) => {
    const canvasLine = line + ' '.repeat(Math.max(0, sourceWidth - visibleWidth(line)));
    const row = index % 7;
    const color = isCharacterWordmark ? (gradient[row] ?? colors.brand) : colors.brand;
    return centerToWidth(chalk.bold.hex(color)(canvasLine), width);
  });
  const signature =
    width >= fullMinWidth
      ? BARI_WELCOME_DESIGN.identity.signature
      : width >= mediumMinWidth
        ? BARI_WELCOME_DESIGN.identity.compactSignature
        : width >= microMinWidth
          ? BARI_WELCOME_DESIGN.identity.microSignature
          : undefined;
  return signature
    ? [
        ...wordmark,
        centerToWidth(chalk.bold.hex(colors.accent)(signature), width),
      ]
    : wordmark;
}
