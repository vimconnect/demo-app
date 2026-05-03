'use client';

import styles from '../care-insights.module.css';

interface Props {
  reason: 'no-patient' | 'no-gaps' | 'all-dismissed';
}

const MESSAGES = {
  'no-patient': {
    icon: '👤',
    title: 'No patient in context',
    subtitle: 'Open a patient chart in the EHR to see care insights',
  },
  'no-gaps': {
    icon: '✅',
    title: 'No gaps found',
    subtitle: 'This patient has no open care or diagnosis gaps',
  },
  'all-dismissed': {
    icon: '✓',
    title: 'All gaps reviewed',
    subtitle: 'All gaps for this patient have been addressed',
  },
};

export function EmptyState({ reason }: Props) {
  const { icon, title, subtitle } = MESSAGES[reason];
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyStateIcon}>{icon}</div>
      <p className={styles.emptyStateTitle}>{title}</p>
      <p className={styles.emptyStateSubtitle}>{subtitle}</p>
    </div>
  );
}
