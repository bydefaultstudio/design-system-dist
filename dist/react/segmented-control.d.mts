/* @bydefaultstudio/design-system v4.7.0 */
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
  /** Omit for the flat button group; "thumb" renders the radio-backed track. */
  variant?: 'thumb';
  label?: string;
  /** Two to five options in the thumb variant. */
  options?: SegmentedOption[];
  /** Controlled value. Supply it from the first render or not at all. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  /** Thumb variant only: the radio group name. Generated when absent. */
  name?: string;
  id?: string;
  className?: string;
}

export declare function SegmentedControl(props: SegmentedControlProps): React.ReactElement;
