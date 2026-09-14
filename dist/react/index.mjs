/* @bydefaultstudio/design-system v4.8.0 */
/**
 * @bydefaultstudio/design-system/react — Tier 2 React adapters.
 *
 * Thin 'use client' wrappers over the documented markup contracts. The
 * stylesheet and the component JS modules still arrive the standard way
 * (pin + bd-sync; see cms/react.md) — these components render the
 * contracts and bridge the modules' events to props. Import from this
 * index, or deep-import a single adapter:
 *
 *   import { Sheet } from '@bydefaultstudio/design-system/react';
 *   import { Tabs } from '@bydefaultstudio/design-system/react/tabs.mjs';
 */
export { Dialog } from './dialog.mjs';
export { Sheet, Drawer } from './sheet.mjs';
export { Tabs } from './tabs.mjs';
export { SegmentedControl } from './segmented-control.mjs';
export {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownItemEnd,
  DropdownDesc,
  DropdownLabel,
  DropdownGroup,
  DropdownHeader,
  DropdownDivider,
} from './dropdown.mjs';
export { showToast } from './toast.mjs';
export { Rating } from './rating.mjs';
export { CellInput } from './cell-input.mjs';
export { ChipGroup } from './chip.mjs';
