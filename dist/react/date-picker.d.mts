/* @bydefaultstudio/design-system v6.0.1 */
import * as React from 'react';

export interface DatePickerChangeDetail {
  /** Single: the chosen date as `YYYY-MM-DD`, or `""`. Range: `YYYY-MM-DD/YYYY-MM-DD` once both ends are chosen, else `""`. */
  value: string;
  /** The first input's value as `YYYY-MM-DD`, or `""`. */
  from: string;
  /** Range only — the second input's value as `YYYY-MM-DD`, or `""`. */
  to: string;
}

export interface DatePickerProps {
  /** One input (the default) or two, sharing one calendar. */
  mode?: 'single' | 'range';
  /** Months shown side by side in the panel. */
  months?: 1 | 2;
  /** The visible label of the input. In range mode, the first input's label unless `fromLabel` is set. */
  label?: string;
  /** Range only — labels for the two inputs. */
  fromLabel?: string;
  toLabel?: string;
  /** The input's form name. In range mode the two inputs take `name-from` and `name-to` unless named separately. */
  name?: string;
  fromName?: string;
  toName?: string;
  /** Single — seeds the input; date-picker.js owns the value afterwards. `YYYY-MM-DD`. */
  defaultValue?: string;
  /** Range — seed the two inputs. `YYYY-MM-DD`. */
  defaultFrom?: string;
  defaultTo?: string;
  /** Earliest and latest selectable dates, `YYYY-MM-DD`, set on the native inputs.
   * Read once at bind with the two lists below: a change remounts the picker
   * and re-seeds its inputs from the defaults. */
  min?: string;
  max?: string;
  /** Dates the calendar refuses, `YYYY-MM-DD` each. */
  disabledDates?: string[];
  /** Weekdays the calendar refuses: `sun`, `mon`, … `sat`. */
  disabledDays?: string[];
  /** Where the panel opens; the script flips it if that would overflow. */
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
  disabled?: boolean;
  required?: boolean;
  /** Fires when the calendar writes a date or clears; typing into the input fires the input's own events. */
  onChange?: (detail: DatePickerChangeDetail) => void;
  /** id of the input; range inputs take `id-from` and `id-to`. Generated when absent. */
  id?: string;
  className?: string;
}

export declare function DatePicker(props: DatePickerProps): React.ReactElement;
