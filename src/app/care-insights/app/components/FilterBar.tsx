'use client';

import { GapFilter, GapWithStatus } from '../types';
import styles from '../care-insights.module.css';

interface Props {
  gaps: GapWithStatus[];
  activeFilter: GapFilter;
  onFilterChange: (filter: GapFilter) => void;
}

export function FilterBar({ gaps, activeFilter, onFilterChange }: Props) {
  const diagnosisCount = gaps.filter(g => g.gap.type === 'diagnosis').length;
  const careCount = gaps.filter(g => g.gap.type === 'care').length;
  const totalCount = gaps.length;

  const filters: { key: GapFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: totalCount },
    { key: 'diagnosis', label: 'Diagnosis Gaps', count: diagnosisCount },
    { key: 'care', label: 'Care Gaps', count: careCount },
  ];

  // Hide filter if only one category is present
  const categories = new Set(gaps.map(g => g.gap.type));
  if (categories.size <= 1) return null;

  return (
    <div className={styles.filterBar}>
      {filters.map(f => (
        <button
          key={f.key}
          className={`${styles.filterBubble} ${activeFilter === f.key ? styles.selected : ''}`}
          onClick={() => onFilterChange(f.key)}
        >
          {f.label}{' '}
          <span className={styles.filterCount}>{f.count}</span>
        </button>
      ))}
    </div>
  );
}
