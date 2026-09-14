/* @bydefaultstudio/design-system v4.8.0 */
import * as React from 'react';

export interface ChipOption {
  value: string;
  label?: React.ReactNode;
  disabled?: boolean;
}

export interface ChipGroupProps {
  /** Names the group. Use `labelledBy` instead when a visible question names it. */
  label?: string;
  /** id of the element that names this group — the question prompt, usually. */
  labelledBy?: string;
  options?: ChipOption[];
  /** Controlled value. Supply it from the first render or not at all. */
  value?: string;
  defaultValue?: string;
  /** Fires with the chosen value, or `undefined` when a clearable group clears. */
  onChange?: (value: string | undefined) => void;
  /** Re-clicking the selected chip clears it. Requires chip.js. */
  clearable?: boolean;
  /** "scale" renders even stops for an ordered set; omit for content width. */
  layout?: 'scale';
  /** Draws the unanswered-group border and sets `aria-invalid`. Pair it with a visible message via `aria-describedby`. */
  error?: boolean;
  /** id of the error message that explains an unanswered group. */
  'aria-describedby'?: string;
  /** The radio group name. Generated when absent. */
  name?: string;
  id?: string;
  className?: string;
}

export declare function ChipGroup(props: ChipGroupProps): React.ReactElement;
