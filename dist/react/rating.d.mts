/* @bydefaultstudio/design-system v4.8.0 */
import * as React from 'react';

export interface RatingProps {
  /** The group's accessible name. On a read-only rating this is the only
   * thing conveying the score — write the value in, as the contract does:
   * "Rating: 4 out of 5". */
  label?: string;
  /** Renders spans rather than buttons; no module involved. */
  readOnly?: boolean;
  /** Read-only only — the displayed score. */
  value?: number;
  /** Seeds the first render; rating.js owns the value afterwards. */
  defaultValue?: number;
  /** Never more than 5. */
  max?: number;
  size?: 'sm' | 'lg';
  onChange?: (value: number) => void;
  id?: string;
  className?: string;
}

export declare function Rating(props: RatingProps): React.ReactElement;
