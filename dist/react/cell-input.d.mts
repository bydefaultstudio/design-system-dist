/* @bydefaultstudio/design-system v4.7.0 */
import * as React from 'react';

export interface CellInputProps {
  /** The shape: "6", "3 4", "2-2-2", "2/2/4". Required unless `static`. */
  format?: string;
  /** Filters input; "digits" also asks for the numeric keypad. */
  mode?: 'letters' | 'digits' | 'any';
  /** The input's accessible name — name the purpose and the shape. */
  label?: string;
  /** Visual masking only. A real secret needs `password`. */
  mask?: boolean;
  size?: 'small';
  /** Verdict colouring. Pair it with a visible `role="status"` outcome. */
  verdict?: 'success' | 'danger';
  /** Display-only cells built from `value`; no input, no module. */
  static?: boolean;
  /** Static variant only — the characters to render. */
  value?: string;
  password?: boolean;
  autoComplete?: string;
  disabled?: boolean;
  /** Paints the danger state and sets `aria-invalid`. */
  error?: boolean;
  onChange?: (value: string, complete: boolean) => void;
  onComplete?: (value: string) => void;
  /** Point this at the `role="status"` region carrying the verdict text. */
  'aria-describedby'?: string;
  id?: string;
  className?: string;
}

export declare function CellInput(props: CellInputProps): React.ReactElement;
