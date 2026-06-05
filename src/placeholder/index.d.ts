export type PaddockLoadingPlaceholderVariant = 'lights' | 'custom';

export interface PaddockLoadingPlaceholderOptions {
  label?: string;
  detail?: string;
  className?: string;
  variant?: PaddockLoadingPlaceholderVariant;
  attributes?: Record<string, string | number | boolean | null | undefined>;
}

export function createPaddockLoadingPlaceholder(options?: PaddockLoadingPlaceholderOptions): string;
