'use client';

import { useState } from 'react';
import { GapWithStatus, DiagnosisGap, CareGap } from '../types';
import styles from '../care-insights.module.css';

// ── Icons (from the original DiagnosisGapIcon / QualityIcon, fill="currentColor") ─

function DiagnosisGapIcon() {
  return (
    <svg width="13" height="18" viewBox="0 0 13 18" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M10.25 2.25C10.8023 2.25 11.25 2.69772 11.25 3.25V8.75C11.25 9.30228 10.8023 9.75 10.25 9.75H7.75C7.19772 9.75 6.75 9.30229 6.75 8.75V5.25H5.25C4.00781 5.25 3 6.25781 3 7.5V10.6406C3.62988 10.8691 4.13086 11.3701 4.35938 12H12.75V13.5H4.35938C4.13086 14.1328 3.63281 14.6309 3 14.8594V16.5H12.75V18H0V16.5H1.5V14.8594C0.632812 14.5459 0 13.7197 0 12.75C0 11.7803 0.632812 10.9541 1.5 10.6406V7.5C1.5 5.44043 3.19043 3.75 5.25 3.75H6.75V3.25C6.75 2.69772 7.19772 2.25 7.75 2.25H10.25ZM2.25 12C1.82812 12 1.5 12.3281 1.5 12.75C1.5 13.1719 1.82812 13.5 2.25 13.5C2.67188 13.5 3 13.1719 3 12.75C3 12.3281 2.67188 12 2.25 12ZM8.25 8.25H9.75V3.75H8.25V8.25ZM10.5 1.5H7.5V0H10.5V1.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CareGapIcon() {
  return (
    <svg width="15" height="16" viewBox="0 0 19 20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M15.3684 11.7342C15.5253 11.6436 15.7206 11.6791 15.8364 11.8096L15.881 11.8712L18.1332 15.772L18.1809 15.8629C18.2852 16.0845 18.3361 16.3686 18.1662 16.6136C17.9962 16.8586 17.7124 16.9101 17.4682 16.8897L17.3664 16.8773H17.3657L15.4313 16.5499L14.7656 18.3912L14.7648 18.3919C14.6734 18.6431 14.4799 18.9273 14.1408 18.9588C13.8021 18.9902 13.5599 18.7471 13.4238 18.5172L11.2675 14.8865L11.2353 14.8177C11.1783 14.653 11.2429 14.4656 11.3986 14.3731C11.5544 14.2807 11.7501 14.3136 11.8674 14.4427L11.9121 14.5042L14.0632 18.126L14.8337 16.0006L14.8615 15.9405C14.9386 15.8072 15.0919 15.7325 15.2482 15.7589L17.4763 16.1346L15.2314 12.2462L15.1999 12.1766C15.145 12.0113 15.2118 11.8248 15.3684 11.7342Z"
        fill="currentColor"
      />
      <path
        d="M2.81436 11.8097C2.93008 11.6791 3.12541 11.6436 3.28237 11.7342C3.46154 11.8379 3.52286 12.0669 3.41934 12.2462L1.17373 16.1346L3.40249 15.7589L3.46914 15.7538C3.62272 15.7554 3.76281 15.8513 3.81704 15.9998L4.59121 18.1261L6.73281 14.5042L6.77749 14.4435C6.89448 14.3141 7.09021 14.2803 7.24624 14.3724C7.42452 14.4778 7.48349 14.7083 7.37808 14.8866L4.83291 19.191C4.75911 19.3156 4.6204 19.3866 4.47622 19.3734C4.33182 19.36 4.20797 19.2643 4.15835 19.128L3.21865 16.5499L1.28506 16.8773C1.02242 16.9214 0.678851 16.8938 0.484523 16.6136C0.290457 16.3338 0.384775 16.0026 0.517482 15.7721L2.76968 11.8712L2.81436 11.8097Z"
        fill="currentColor"
      />
      <path
        d="M14.9299 7.13477C14.8823 6.50884 14.4823 5.95913 13.8921 5.72485C13.7602 5.67253 13.6549 5.56878 13.6006 5.43774C13.5463 5.30675 13.5474 5.1593 13.6035 5.02905C13.8712 4.40701 13.7323 3.68419 13.2534 3.20532C12.8044 2.75649 12.1412 2.60672 11.5476 2.81055L11.4304 2.85596C11.3002 2.91202 11.1527 2.91313 11.0217 2.85889C10.8908 2.80463 10.787 2.69978 10.7346 2.56812C10.4843 1.93855 9.87548 1.52516 9.198 1.52515C8.5205 1.52515 7.9117 1.93853 7.66138 2.56812C7.60896 2.69979 7.5052 2.80462 7.37427 2.85889C7.27597 2.89961 7.1685 2.90889 7.06592 2.88745L6.96558 2.85596C6.34369 2.58825 5.62145 2.72671 5.14258 3.20532C4.66371 3.6842 4.52473 4.407 4.79248 5.02905C4.84855 5.15929 4.84969 5.30676 4.79541 5.43774C4.74114 5.5687 4.63635 5.67245 4.50464 5.72485C3.87543 5.97509 3.4624 6.58357 3.4624 7.26074C3.46243 7.93788 3.87545 8.5464 4.50464 8.79663C4.63633 8.84904 4.74115 8.95279 4.79541 9.08374C4.84965 9.2147 4.84854 9.36223 4.79248 9.49243C4.52479 10.1145 4.66374 10.8366 5.14258 11.3154C5.62144 11.7943 6.34357 11.9333 6.96558 11.6655L7.06592 11.6333C7.16847 11.6119 7.276 11.6219 7.37427 11.6626C7.50523 11.7169 7.60898 11.8216 7.66138 11.9534C7.9117 12.583 8.5205 12.9963 9.198 12.9963C9.87548 12.9963 10.4843 12.5829 10.7346 11.9534L10.783 11.8604C10.8403 11.7726 10.9234 11.7034 11.0217 11.6626C11.1527 11.6083 11.3002 11.6095 11.4304 11.6655C12.0524 11.9332 12.7746 11.7943 13.2534 11.3154C13.7322 10.8366 13.8712 10.1144 13.6035 9.49243C13.5475 9.36222 13.5463 9.21471 13.6006 9.08374C13.6549 8.95271 13.7602 8.84895 13.8921 8.79663C14.5215 8.54679 14.9351 7.93801 14.9351 7.26074L14.9299 7.13477Z"
        fill="currentColor"
      />
      <path
        d="M9.20642 3.36353C9.46408 3.36392 9.70278 3.48964 9.84948 3.69605L9.90661 3.7898L9.91394 3.80444L10.6178 5.32056H11.9427C12.2573 5.31348 12.5439 5.50167 12.662 5.79443C12.7795 6.08587 12.7041 6.41757 12.4752 6.63086L12.4759 6.63159L11.3004 7.78809L11.9508 9.28149L11.9537 9.28662L11.9918 9.40527C12.0591 9.68522 11.9678 9.98433 11.7465 10.1787C11.4945 10.3998 11.1305 10.4357 10.8397 10.2695V10.2703L9.20422 9.35107L7.56945 10.2703L7.56872 10.2695C7.278 10.4353 6.9145 10.3996 6.66272 10.1787C6.40974 9.95659 6.3261 9.59743 6.45544 9.28662L6.45837 9.28149L7.10803 7.78882L5.93176 6.63306L5.93322 6.63159C5.70322 6.41832 5.62622 6.08586 5.74426 5.7937C5.86276 5.50053 6.1508 5.31275 6.46569 5.32056H7.79138L8.4967 3.80371L8.50402 3.78833L8.56189 3.69531C8.70907 3.48886 8.94844 3.36325 9.20642 3.36353Z"
        fill="currentColor"
      />
    </svg>
  );
}

function SparkleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2L13.5 8.5L20 10L13.5 11.5L12 18L10.5 11.5L4 10L10.5 8.5L12 2Z"
        fill="currentColor"
      />
      <path
        d="M19 2L19.75 5.25L23 6L19.75 6.75L19 10L18.25 6.75L15 6L18.25 5.25L19 2Z"
        fill="currentColor"
        opacity="0.7"
      />
      <path
        d="M5 16L5.5 18H7.5L5.5 19L5 21L4.5 19L2.5 18L4.5 17L5 16Z"
        fill="currentColor"
        opacity="0.5"
      />
    </svg>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCardTitle(gap: DiagnosisGap | CareGap): string {
  if (gap.type === 'diagnosis') {
    const dg = gap as DiagnosisGap;
    return `ICD-10: ${dg.icdCode} ${dg.icdDescription}`;
  }
  return (gap as CareGap).measureName;
}

function getCardSubtitle(gap: DiagnosisGap | CareGap): string {
  return gap.type === 'diagnosis' ? 'Diagnosis Gap' : 'Care Gap';
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  gapWithStatus: GapWithStatus;
  hasEncounter: boolean;
  onDismiss: (id: string) => void;
  onAddToEncounter: (gap: DiagnosisGap) => void;
}

export function GapCard({ gapWithStatus, hasEncounter, onDismiss, onAddToEncounter }: Props) {
  const { gap, status, autoResolved, errorMessage } = gapWithStatus;
  const [expanded, setExpanded] = useState(false);

  const isDismissed = status === 'dismissed';
  const isAdded = status === 'added';
  const isAdding = status === 'adding';
  const isActioned = isDismissed || isAdded;

  const title = getCardTitle(gap);
  const subtitle = getCardSubtitle(gap);
  const evidence = gap.type === 'diagnosis'
    ? (gap as DiagnosisGap).evidence
    : (gap as CareGap).evidence;

  const isDiagnosis = gap.type === 'diagnosis';
  const dg = isDiagnosis ? (gap as DiagnosisGap) : null;

  const cardClasses = [
    styles.gapCard,
    isAdded ? styles.cardAdded : '',
    isDismissed ? styles.cardDismissed : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cardClasses}>
      {/* ── Header (always visible, click to expand) ─────────────── */}
      <div
        className={`${styles.gapCardHeader} ${expanded ? styles.gapCardHeaderExpanded : ''}`}
        onClick={() => setExpanded(e => !e)}
        role="button"
        tabIndex={0}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setExpanded(ex => !ex)}
        aria-expanded={expanded}
      >
        {/* Icon strip */}
        <div className={`${styles.gapCardIconStrip} ${isDiagnosis ? styles.iconDiagnosis : styles.iconCare}`}>
          {isDiagnosis ? <DiagnosisGapIcon /> : <CareGapIcon />}
        </div>

        {/* Title + subtitle */}
        <div className={styles.gapCardTitleArea}>
          <span className={styles.gapCardTitle}>{title}</span>
          <span className={styles.gapCardSubtitle}>{subtitle}</span>
        </div>

        {/* Chevron */}
        <span className={`${styles.cardArrow} ${expanded ? styles.cardArrowExpanded : ''}`}>
          ›
        </span>
      </div>

      {/* ── Expandable content ────────────────────────────────────── */}
      <div className={expanded ? styles.cardContentVisible : styles.cardContentHidden}>
        {/* Evidence / details rows */}
        <div className={styles.cardDetails}>
          {evidence && (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Evidence</span>
              <span className={styles.detailValue}>{evidence}</span>
            </div>
          )}
          {dg && (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>HCC</span>
              <span className={styles.detailValue}>
                <strong>{dg.hccCode}</strong>{dg.hccModel ? ` (${dg.hccModel})` : ''}
              </span>
            </div>
          )}
          {dg && (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Type</span>
              <span className={styles.detailValue}>
                {dg.background === 'suspected' ? 'Suspected' : 'Confirmed'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Action buttons (always visible when not actioned) ─────── */}
      {!isActioned && (
        <div className={styles.innerActions} onClick={e => e.stopPropagation()}>
          {isDiagnosis && (
            <div className={styles.actionButtonWrap}>
              <button
                className={styles.btnAgree}
                onClick={() => onAddToEncounter(gap as DiagnosisGap)}
                disabled={!hasEncounter || isAdding}
                title={!hasEncounter ? 'Available during an active encounter' : undefined}
              >
                {isAdding ? 'Adding...' : 'Agree'}
              </button>
            </div>
          )}
          <div className={styles.actionButtonWrap}>
            <button
              className={styles.btnDismissOutline}
              onClick={() => onDismiss(gap.id)}
              disabled={isAdding}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* ── Permanent visible status footer ───────────────────────── */}
      {isAdded && (
        <div className={`${styles.gapStatusBar} ${styles.statusAdded}`}>
          {autoResolved
            ? <><span className={styles.statusIcon}><SparkleIcon /></span><strong>Automatically resolved based on documented assessments</strong></>
            : <><span className={styles.statusIcon}>✓</span><strong>Added to chart</strong></>
          }
        </div>
      )}
      {isDismissed && (
        <div className={`${styles.gapStatusBar} ${styles.statusDismissed}`}>
          <span className={styles.statusIcon}>✓</span>
          <strong>Dismissed</strong>
        </div>
      )}
      {status === 'error' && (
        <div className={`${styles.gapStatusBar} ${styles.statusError}`}>
          <span className={styles.statusIcon}>✗</span>
          <strong>{errorMessage || 'Failed to add to chart'}</strong>
        </div>
      )}
    </div>
  );
}
