import { IssueCertificateUseCase } from './issue-certificate.use-case';

const input = {
  externalStudentId: 'student-1',
  courseId: 'course-1',
  deliveryMode: 'online' as const,
  studentName: 'Aluno de Teste',
  courseTitle: 'Curso de Demonstração',
  workloadHours: 20,
  completionDate: '2026-09-29',
  certificateType: 'standard',
};

const command = {
  integrationId: 'integration-id',
  institutionId: 'local-institution',
  clientDbId: 'client-id',
  clientId: 'client_local_dev',
  requestId: 'request-id',
  idempotencyKey: '123e4567-e89b-42d3-a456-426614174000',
  requestHash: 'b'.repeat(64),
  input,
};

function createReservation(overrides: Record<string, unknown> = {}) {
  return {
    certificateId: 'certificate-id',
    verificationCode: 'AAECAwQFBgcICQoLDA0ODw',
    registrationNumber: '2026-000001',
    objectKey: null,
    pdfSha256: null,
    pdfSizeBytes: null,
    status: 'PROCESSING' as const,
    created: true,
    ...overrides,
  };
}

describe('IssueCertificateUseCase', () => {
  const config = {
    environment: 'development',
    institutionName: 'Instituição de Teste',
    templateVersion: 'test-v1',
    verificationBaseUrl: 'http://localhost:3000/v1/public/certificates',
  };

  it('renders, stores and finalizes a newly reserved certificate', async () => {
    const repository = {
      reserve: jest.fn().mockResolvedValue(createReservation()),
      markIssued: jest.fn().mockResolvedValue(undefined),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const renderer = {
      render: jest.fn().mockResolvedValue(Buffer.from('%PDF-test')),
    };
    const storage = {
      putPdf: jest.fn().mockResolvedValue({
        objectKey: 'integration-id/certificates/certificate-id.pdf',
        sha256: 'a'.repeat(64),
        sizeBytes: 9,
      }),
      deleteObject: jest.fn(),
      createDownloadUrl: jest
        .fn()
        .mockResolvedValue('http://localhost:9000/signed.pdf'),
    };
    const useCase = new IssueCertificateUseCase(
      repository,
      renderer,
      storage,
      config,
    );

    const result = await useCase.execute(command);

    expect(result).toMatchObject({ status: 'ISSUED', reused: false });
    expect(renderer.render).toHaveBeenCalledWith(
      expect.objectContaining({ markAsTest: true }),
    );
    expect(repository.markIssued).toHaveBeenCalledWith(
      expect.objectContaining({
        certificateId: 'certificate-id',
        pdfSha256: 'a'.repeat(64),
      }),
    );
  });

  it('reuses an already issued result without rendering another PDF', async () => {
    const repository = {
      reserve: jest.fn().mockResolvedValue(
        createReservation({
          status: 'ISSUED',
          created: false,
          objectKey: 'existing.pdf',
          pdfSha256: 'c'.repeat(64),
          pdfSizeBytes: 100n,
        }),
      ),
    };
    const renderer = { render: jest.fn() };
    const storage = {
      createDownloadUrl: jest
        .fn()
        .mockResolvedValue('http://localhost:9000/existing.pdf'),
    };
    const useCase = new IssueCertificateUseCase(
      repository,
      renderer,
      storage,
      config,
    );

    const result = await useCase.execute(command);

    expect(result).toMatchObject({ status: 'ISSUED', reused: true });
    expect(renderer.render).not.toHaveBeenCalled();
    expect(storage.createDownloadUrl).toHaveBeenCalledWith('existing.pdf', 300);
  });

  it('marks a reserved certificate failed when rendering fails', async () => {
    const repository = {
      reserve: jest.fn().mockResolvedValue(createReservation()),
      markFailed: jest.fn().mockResolvedValue(undefined),
    };
    const renderer = {
      render: jest.fn().mockRejectedValue(new Error('renderer failed')),
    };
    const storage = { deleteObject: jest.fn() };
    const useCase = new IssueCertificateUseCase(
      repository,
      renderer,
      storage,
      config,
    );

    await expect(useCase.execute(command)).rejects.toThrow('renderer failed');
    expect(repository.markFailed).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'ISSUANCE_FAILED' }),
    );
  });
});
