export type GapType = 'diagnosis' | 'care';
export type GapStatus = 'unresolved' | 'dismissed' | 'adding' | 'added' | 'error';
export type GapFilter = 'all' | 'diagnosis' | 'care';

export interface DiagnosisGap {
  id: string;
  type: 'diagnosis';
  conditionName: string;
  icdCode: string;
  icdDescription: string;
  hccCode: string;
  hccModel: string;
  evidence: string;
  background: 'suspected' | 'confirmed';
}

export interface CareGap {
  id: string;
  type: 'care';
  measureName: string;
  description: string;
  evidence: string;
}

export type Gap = DiagnosisGap | CareGap;

export interface GapWithStatus {
  gap: Gap;
  status: GapStatus;
  autoResolved?: boolean;
  errorMessage?: string;
}

export interface Insurance {
  payerName?: string;
  payerId?: string;
  memberId?: string;
  groupId?: string;
  isPrimary?: boolean;
}

export interface PatientData {
  ehrPatientId: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  insurance?: Insurance[];
}
