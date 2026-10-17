/* @bydefaultstudio/design-system v7.0.0 */
import * as React from 'react';

export interface SegmentedOption {
  value: string;
  /** The visible label, and the `aria-label` when `icon` is set. */
  label?: React.ReactNode;
  /** Renders the icon-only segment. Needs `label` for its accessible name. */
  icon?: React.ReactNode;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  /**
   * Omit for the default button group. "underline" marks the selection with
   * a rule on the same buttons; "faded" renders the radio-backed track.
   * @deprecated "thumb" — the 6.0 name for "faded", still accepted.
   */
  variant?: 'faded' | 'underline' | 'thumb';
  label?: string;
  /** Two to five options in the faded variant. */
  options?: SegmentedOption[];
  /** Controlled value. Supply it from the first render or not at all. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Faded variant only: the radio group name. Generated when absent. */
  name?: string;
  id?: string;
  className?: string;
}

export declare function SegmentedControl(props: SegmentedControlProps): React.ReactElement;
