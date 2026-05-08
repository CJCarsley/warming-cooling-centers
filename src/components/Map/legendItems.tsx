import type { ComponentType } from 'react';

export function FlameSVG() {
  return (
    <svg width="16" height="19" viewBox="0 0 24 28" aria-hidden="true" focusable="false">
      <path
        d="M12 2C12 2 5.5 9 5.5 15.5C5.5 20.2 8.3 24 12 24C15.7 24 18.5 20.2 18.5 15.5C18.5 12.5 16.5 10 15 8.5C15.2 10.5 13.5 12 12 13C10.5 12 9.2 10.5 9.2 8.5C9.2 8.5 12 5 12 2Z"
        fill="#D14B00"
        stroke="white"
        strokeWidth="0.8"
      />
    </svg>
  );
}

export function SnowflakeSVG() {
  return (
    <svg width="18" height="18" viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <g stroke="#1565C0" strokeLinecap="round">
        <line x1="14" y1="2" x2="14" y2="26" strokeWidth="3" />
        <line x1="2" y1="14" x2="26" y2="14" strokeWidth="3" />
        <line x1="5.5" y1="5.5" x2="22.5" y2="22.5" strokeWidth="3" />
        <line x1="22.5" y1="5.5" x2="5.5" y2="22.5" strokeWidth="3" />
        <line x1="10.5" y1="4" x2="14" y2="7.5" strokeWidth="2" />
        <line x1="17.5" y1="4" x2="14" y2="7.5" strokeWidth="2" />
        <line x1="10.5" y1="24" x2="14" y2="20.5" strokeWidth="2" />
        <line x1="17.5" y1="24" x2="14" y2="20.5" strokeWidth="2" />
        <line x1="4" y1="10.5" x2="7.5" y2="14" strokeWidth="2" />
        <line x1="4" y1="17.5" x2="7.5" y2="14" strokeWidth="2" />
        <line x1="24" y1="10.5" x2="20.5" y2="14" strokeWidth="2" />
        <line x1="24" y1="17.5" x2="20.5" y2="14" strokeWidth="2" />
      </g>
      <circle cx="14" cy="14" r="3" fill="#1565C0" />
    </svg>
  );
}

export interface LegendItem {
  key: 'warming' | 'cooling';
  Icon: ComponentType;
}

export const LEGEND_ITEMS: LegendItem[] = [
  { key: 'warming', Icon: FlameSVG },
  { key: 'cooling', Icon: SnowflakeSVG },
];
