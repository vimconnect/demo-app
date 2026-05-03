'use client';

import { PatientData, Insurance } from '../types';
import styles from '../care-insights.module.css';

interface Props {
  patient: PatientData;
  hasEncounter: boolean;
}

export function PatientHeader({ patient, hasEncounter }: Props) {
  const fullName = [patient.firstName, patient.lastName].filter(Boolean).join(' ') || 'Unknown Patient';
  const dob = patient.dateOfBirth ? formatDob(patient.dateOfBirth) : null;
  const primaryInsurance = patient.insurance?.find(i => i.isPrimary) ?? patient.insurance?.[0];

  return (
    <div className={styles.patientHeader}>
      <p className={styles.patientName}>{fullName}</p>
      {dob && <p className={styles.patientMeta}>DOB: {dob}</p>}
      {primaryInsurance && <InsuranceLine insurance={primaryInsurance} />}
      {hasEncounter && (
        <div className={styles.encounterBadge}>
          <span className={styles.encounterDot} />
          Encounter Open
        </div>
      )}
    </div>
  );
}

function InsuranceLine({ insurance }: { insurance: Insurance }) {
  const parts: string[] = [];
  if (insurance.payerName) parts.push(insurance.payerName);
  if (insurance.memberId) parts.push(`ID: ${insurance.memberId}`);
  if (!parts.length) return null;

  return (
    <p className={styles.patientInsurance}>{parts.join(' · ')}</p>
  );
}

function formatDob(dob: string): string {
  try {
    // Handle ISO date strings (YYYY-MM-DD or full ISO)
    const d = new Date(dob);
    if (isNaN(d.getTime())) return dob;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return dob;
  }
}
