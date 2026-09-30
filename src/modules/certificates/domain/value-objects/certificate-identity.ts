import { createHash } from 'node:crypto';

export type DeliveryMode = 'online' | 'in_person';

export interface CertificateIdentityInput {
  externalStudentId: string;
  courseId: string;
  deliveryMode: DeliveryMode;
  classId?: string;
}

export class CertificateIdentity {
  readonly key: string;

  private constructor(
    readonly externalStudentId: string,
    readonly courseId: string,
    readonly deliveryMode: DeliveryMode,
    readonly classId: string | null,
  ) {
    const canonicalIdentity = JSON.stringify([
      'certificate-identity-v1',
      externalStudentId,
      deliveryMode,
      courseId,
      classId,
    ]);
    this.key = createHash('sha256')
      .update(canonicalIdentity, 'utf8')
      .digest('hex');
  }

  static create(input: CertificateIdentityInput): CertificateIdentity {
    CertificateIdentity.requireOpaqueId(
      input.externalStudentId,
      'externalStudentId',
    );
    CertificateIdentity.requireOpaqueId(input.courseId, 'courseId');

    if (input.deliveryMode !== 'online' && input.deliveryMode !== 'in_person') {
      throw new Error('deliveryMode must be online or in_person');
    }

    if (input.deliveryMode === 'in_person') {
      if (!input.classId) {
        throw new Error('classId is required for in_person delivery');
      }
      CertificateIdentity.requireOpaqueId(input.classId, 'classId');
    } else if (input.classId !== undefined) {
      throw new Error('classId must be omitted for online delivery');
    }

    return new CertificateIdentity(
      input.externalStudentId,
      input.courseId,
      input.deliveryMode,
      input.classId ?? null,
    );
  }

  private static requireOpaqueId(value: string, fieldName: string): void {
    if (
      !value ||
      Buffer.byteLength(value, 'utf8') > 128 ||
      value.trim() !== value
    ) {
      throw new Error(
        `${fieldName} must contain 1-128 characters without outer whitespace`,
      );
    }
  }
}
