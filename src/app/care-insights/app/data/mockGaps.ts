import { Gap } from '../types';

/**
 * Mock gap data shown for any patient in context.
 * In a real implementation these would be fetched from the Care Insights BFF
 * using the patient's identifiers.
 */
export const MOCK_GAPS: Gap[] = [
  {
    id: 'dg-001',
    type: 'diagnosis',
    conditionName: 'Chronic Kidney Disease',
    icdCode: 'N18.30',
    icdDescription: 'Chronic kidney disease, stage 3 unspecified',
    hccCode: 'HCC 137',
    hccModel: 'CMS-HCC',
    evidence: 'Based on 2 eGFR lab results below 60 mL/min in the past 12 months',
    background: 'suspected',
  },
  {
    id: 'dg-002',
    type: 'diagnosis',
    conditionName: 'Type 2 Diabetes Mellitus',
    icdCode: 'E11.9',
    icdDescription: 'Type 2 diabetes mellitus, without complications',
    hccCode: 'HCC 19',
    hccModel: 'CMS-HCC',
    evidence: 'Patient has active metformin prescription; relevant A1C results on file',
    background: 'suspected',
  },
  {
    id: 'cg-001',
    type: 'care',
    measureName: 'Annual Wellness Visit',
    description: 'Annual wellness visit (AWV) due',
    evidence: 'Last documented wellness visit was 14 months ago (Feb 2025)',
  },
  {
    id: 'cg-002',
    type: 'care',
    measureName: 'Colorectal Cancer Screening',
    description: 'Colorectal cancer screening overdue',
    evidence: 'No colonoscopy or stool-based test recorded in the past 3 years',
  },
];
