import { CertificateStatus } from '@prisma/client';
import { CertificateNotFoundError } from '../errors/certificate-not-found.error';
import { VerifyPublicCertificateUseCase } from './verify-public-certificate.use-case';

describe('VerifyPublicCertificateUseCase', () => {
  const record = {
    verificationCode: 'verification-code',
    registrationNumber: '2026-000001',
    status: CertificateStatus.ISSUED,
    snapshot: {
      institutionName: 'Instituição de Teste',
      studentName: 'Aluno de Teste',
      courseTitle: 'Curso de Demonstração',
      workloadHours: 20,
      completionDate: '2026-09-29',
      deliveryMode: 'online' as const,
      classId: null,
      responsibleName: null,
      responsibleRole: null,
    },
  };

  it('returns only minimal public fields for an issued certificate', async () => {
    const repository = {
      findPublicByCode: jest.fn().mockResolvedValue(record),
    };
    const useCase = new VerifyPublicCertificateUseCase(repository);

    await expect(useCase.execute('verification-code')).resolves.toEqual({
      status: 'valid',
      studentName: 'Aluno de Teste',
      courseTitle: 'Curso de Demonstração',
      institutionName: 'Instituição de Teste',
    });
  });

  it('maps revoked and superseded certificates to public statuses', async () => {
    const repository = {
      findPublicByCode: jest
        .fn()
        .mockResolvedValueOnce({ ...record, status: CertificateStatus.REVOKED })
        .mockResolvedValueOnce({
          ...record,
          status: CertificateStatus.SUPERSEDED,
        }),
    };
    const useCase = new VerifyPublicCertificateUseCase(repository);

    await expect(useCase.execute('revoked-code')).resolves.toMatchObject({
      status: 'revoked',
    });
    await expect(useCase.execute('superseded-code')).resolves.toMatchObject({
      status: 'replaced',
    });
  });

  it.each([
    null,
    { ...record, status: CertificateStatus.PROCESSING },
    { ...record, status: CertificateStatus.FAILED },
  ])(
    'does not disclose missing or unissued records publicly',
    async (found) => {
      const repository = {
        findPublicByCode: jest.fn().mockResolvedValue(found),
      };
      const useCase = new VerifyPublicCertificateUseCase(repository);

      await expect(useCase.execute('unknown-code')).rejects.toBeInstanceOf(
        CertificateNotFoundError,
      );
    },
  );
});
