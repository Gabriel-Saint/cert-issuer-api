import { DeliveryMode } from '../value-objects/certificate-identity';

export interface CertificateSnapshot {
  institutionName: string;
  studentName: string;
  courseTitle: string;
  workloadHours: number;
  completionDate: string;
  deliveryMode: DeliveryMode;
  classId: string | null;
  responsibleName: string | null;
  responsibleRole: string | null;
}
