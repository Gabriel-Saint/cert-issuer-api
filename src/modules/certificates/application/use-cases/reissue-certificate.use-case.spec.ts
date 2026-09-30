import { ReissueCertificateUseCase } from './reissue-certificate.use-case';

const input = {
  actorId: 'admin-1',
  reason: 'Nome corrigido',
  studentName: 'Aluno Corrigido',
  courseTitle: 'Curso de Demonstração',
  workloadHours: 20,
  completionDate: '2026-09-29',
};

const command = {
  integrationId: 'integration-id',
  institutionId: 'local-institution',
  clientDbId: 'client-id',
  clientId: 'client_local_dev',
  certificateId: '123e4567-e89b-42d3-a456-426614174000',
  idempotencyKey: '123e4567-e89b-42d3-a456-426614174001',
  requestHash: 'a'.repeat(64),
  requestId: 'request-id',
  input,
};

describe('ReissueCertificateUseCase', () => {
  const config = {
    environment: 'development',
    institutionName: 'Instituição de Teste',
    templateVersion: 'test-v1',
    verificationBaseUrl: 'http://localhost:3000/v1/public/certificates',
  };

  it('keeps the previous certificate when rendering fails', async () => {
    const repository = {
      reserveReissue: jest.fn().mockResolvedValue({
        certificateId: 'new-id',
        previousCertificateId: 'old-id',
        verificationCode: 'new-code',
        registrationNumber: '2026-000002',
        objectKey: null,
        pdfSha256: null,
        pdfSizeBytes: null,
        status: 'PROCESSING',
        created: true,
        snapshot: {
          institutionName: 'Instituição de Teste',
          studentName: 'Aluno Corrigido',
          courseTitle: 'Curso de Demonstração',
          workloadHours: 20,
          completionDate: '2026-09-29',
          deliveryMode: 'in_person',
          classId: 'class-1',
          responsibleName: null,
          responsibleRole: null,
        },
      }),
      completeReissue: jest.fn(),
      failReissue: jest.fn().mockResolvedValue(undefined),
    };
    const renderer = {
      render: jest.fn().mockRejectedValue(new Error('renderer failed')),
    };
    const storage = { deleteObject: jest.fn() };
    const useCase = new ReissueCertificateUseCase(
      repository,
      renderer,
      storage,
      config,
    );

    await expect(useCase.execute(command)).rejects.toThrow('renderer failed');
    expect(repository.completeReissue).not.toHaveBeenCalled();
    expect(repository.failReissue).toHaveBeenCalledWith(
      expect.objectContaining({ certificateId: 'new-id' }),
    );
    expect(renderer.render).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: {
          institutionName: 'Instituição de Teste',
          studentName: 'Aluno Corrigido',
          courseTitle: 'Curso de Demonstração',
          workloadHours: 20,
          completionDate: '2026-09-29',
          deliveryMode: 'in_person',
          classId: 'class-1',
          responsibleName: null,
          responsibleRole: null,
        },
      }),
    );
  });

  it('supersedes the previous certificate only after the new file is stored', async () => {
    const repository = {
      reserveReissue: jest.fn().mockResolvedValue({
        certificateId: 'new-id',
        previousCertificateId: 'old-id',
        verificationCode: 'new-code',
        registrationNumber: '2026-000002',
        objectKey: null,
        status: 'PROCESSING',
        created: true,
        snapshot: {
          institutionName: 'Instituição de Teste',
          studentName: 'Aluno Corrigido',
          courseTitle: 'Curso de Demonstração',
          workloadHours: 20,
          completionDate: '2026-09-29',
          deliveryMode: 'online',
          classId: null,
          responsibleName: null,
          responsibleRole: null,
        },
      }),
      completeReissue: jest.fn().mockResolvedValue(undefined),
      failReissue: jest.fn(),
    };
    const renderer = {
      render: jest.fn().mockResolvedValue(Buffer.from('%PDF')),
    };
    const storage = {
      putPdf: jest.fn().mockResolvedValue({
        objectKey: 'integration-id/certificates/new-id.pdf',
        sha256: 'a'.repeat(64),
        sizeBytes: 4,
      }),
      createDownloadUrl: jest
        .fn()
        .mockResolvedValue('http://localhost:9000/new.pdf'),
      deleteObject: jest.fn(),
    };
    const useCase = new ReissueCertificateUseCase(
      repository,
      renderer,
      storage,
      config,
    );

    await expect(useCase.execute(command)).resolves.toMatchObject({
      status: 'ISSUED',
      reused: false,
      previousCertificateId: 'old-id',
    });
    expect(repository.completeReissue).toHaveBeenCalledWith(
      expect.objectContaining({ previousCertificateId: 'old-id' }),
    );
    expect(repository.failReissue).not.toHaveBeenCalled();
  });
});
