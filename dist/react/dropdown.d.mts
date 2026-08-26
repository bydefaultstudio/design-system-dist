/* @bydefaultstudio/design-system v4.7.0 */
import * as React from 'react';

export interface DropdownSelectDetail {
  value?: string;
  item: HTMLElement;
  /** true/false for checkable items, null for plain ones. */
  checked: boolean | null;
}

export interface DropdownProps {
  /** A request, not a guarantee — the module flips an axis that would overflow. */
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
  /** Selections from a nested dropdown do not reach this handler. */
  onSelect?: (detail: DropdownSelectDetail) => void;
  id?: string;
  className?: string;
  children?: React.ReactNode;
}
export declare function Dropdown(props: DropdownProps): React.ReactElement;

export interface DropdownTriggerProps {
  /** Adds `.button` so the trigger reads as a standard button. */
  button?: boolean;
  variant?: string;
  /** Pass false alongside `<DropdownMenu role={null}>` — a non-menu panel
   * must not claim menu semantics it does not provide. */
  haspopup?: boolean;
  className?: string;
  'aria-label'?: string;
  children?: React.ReactNode;
}
export declare function DropdownTrigger(props: DropdownTriggerProps): React.ReactElement;

export interface DropdownMenuProps {
  /** Defaults to "menu". Pass null for the header pattern, where the role
   * moves inward onto a `<DropdownGroup menu>`. */
  role?: string | null;
  className?: string;
  children?: React.ReactNode;
}
export declare function DropdownMenu(props: DropdownMenuProps): React.ReactElement;

export interface DropdownItemProps {
  danger?: boolean;
  /** Renders `aria-disabled` and withholds `onClick` — never the `disabled`
   * attribute, which would drop the item out of the keyboard cycle. */
  disabled?: boolean;
  /** Supplying it makes the item checkable and controlled. */
  checked?: boolean;
  /** With `checked`: `menuitemradio` rather than `menuitemcheckbox`. */
  radio?: boolean;
  value?: string;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
  className?: string;
  children?: React.ReactNode;
}
export declare function DropdownItem(props: DropdownItemProps): React.ReactElement;

export interface DropdownSlotProps {
  className?: string;
  id?: string;
  children?: React.ReactNode;
}
export declare function DropdownItemEnd(props: DropdownSlotProps): React.ReactElement;
export declare function DropdownDesc(props: DropdownSlotProps): React.ReactElement;
export declare function DropdownLabel(props: DropdownSlotProps): React.ReactElement;
export declare function DropdownHeader(props: DropdownSlotProps): React.ReactElement;

export interface DropdownGroupProps {
  /** Renders a `.dropdown-label` and points `aria-labelledby` at it. */
  label?: React.ReactNode;
  labelId?: string;
  /** Makes this the inner `role="menu"` wrapper the header pattern needs. */
  menu?: boolean;
  'aria-labelledby'?: string;
  className?: string;
  children?: React.ReactNode;
}
export declare function DropdownGroup(props: DropdownGroupProps): React.ReactElement;

export declare function DropdownDivider(): React.ReactElement;
