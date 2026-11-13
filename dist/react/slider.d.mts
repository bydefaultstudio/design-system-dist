/* @bydefaultstudio/design-system v8.2.0 */
import * as React from 'react';

export interface SliderProps {
  /** The visible label; it names the input. */
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /** Controlled value. Pass with `onChange`. */
  value?: number;
  /** Uncontrolled starting value. Defaults to `min`. */
  defaultValue?: number;
  onChange?: (value: number) => void;
  /** Appended to the readout and to aria-valuetext, e.g. "%" or " px". */
  unit?: string;
  /** One slider in a style other than the house one (set in theme.css). */
  variant?: 'pill' | 'square' | 'needle';
  /** Compact puts the label and value inside the track. */
  layout?: 'default' | 'compact';
  /** true: one stop per step. A number of 2 or more: that many stops. */
  stops?: boolean | number;
  /** Presets that are not evenly spaced, e.g. ["128", "256", "512"]. The
   * input then works in indexes: `value`, `defaultValue` and `onChange`
   * are indexes, and the readout shows values[index]. */
  values?: Array<string | number>;
  /** End labels under the track: [start, end], e.g. ["Cool", "Warm"].
   * The input is also described by a hidden "Cool at 0, Warm at 100". */
  ends?: [string, string];
  /** One label under each stop. Needs `stops`. */
  tickLabels?: string[];
  disabled?: boolean;
  name?: string;
  id?: string;
  /** Id of a hint the input should be described by. */
  describedBy?: string;
  className?: string;
}

export declare function Slider(props: SliderProps): React.ReactElement;
