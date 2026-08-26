/* @bydefaultstudio/design-system v4.7.0 */
import * as React from 'react';

export interface TabItem {
  label: React.ReactNode;
  content?: React.ReactNode;
  /** Explicit tab id. A panel id is derived from it unless `panelId` is set. */
  id?: string;
  panelId?: string;
}

export interface TabsProps {
  /** Names the tablist. Required for a meaningful accessible name. */
  label?: string;
  items?: TabItem[];
  /** Seeds the first render only — tabs.js owns the active tab afterwards. */
  defaultActive?: number;
  onChange?: (index: number, item: TabItem) => void;
  id?: string;
  className?: string;
}

export declare function Tabs(props: TabsProps): React.ReactElement;
