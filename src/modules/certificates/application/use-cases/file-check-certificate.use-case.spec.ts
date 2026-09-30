import { CertificateNotFoundError } from '../errors/certificate-not-found.error';
import { FileCheckCertificateUseCase } from './file-check-certificate.use-case';

describe('FileCheckCertificateUseCase', () => {
  const storedHash = 'ab'.repeat(32);

  it('matches the stored hash without returning it', async () => {
    const repository = {
      findComparableHash: jest.fn().mockResolvedValue(storedHash),
    };
    const useCase = new FileCheckCertificateUseCase(repository);

    await expect(useCase.execute('code', storedHash)).resolves.toEqual({
      match: true,
    });
  });

  it('returns a negative match for a different hash', async () => {
    const repository = {
      findComparableHash: jest.fn().mockResolvedValue(storedHash),
    };
    const useCase = new FileCheckCertificateUseCase(repository);

    await expect(useCase.execute('code', 'cd'.repeat(32))).resolves.toEqual({
      match: false,
    });
  });

  it('does not distinguish an unknown code from a certificate without a file', async () => {
    const repository = {
      findComparableHash: jest.fn().mockResolvedValue(null),
    };
    const useCase = new FileCheckCertificateUseCase(repository);

    await expect(useCase.execute('missing', storedHash)).rejects.toBeInstanceOf(
      CertificateNotFoundError,
    );
  });
});
