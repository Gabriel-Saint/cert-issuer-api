import { CertificateRendererPort } from '../../application/ports/certificate-renderer.port';
import { PlaywrightCertificateRenderer } from './playwright-certificate.renderer';

describe('PlaywrightCertificateRenderer', () => {
  let renderer: CertificateRendererPort;

  beforeAll(() => {
    renderer = new PlaywrightCertificateRenderer();
  });

  it('renders a marked local test certificate PDF', async () => {
    const pdf = await renderer.render({
      snapshot: {
        institutionName: 'Instituição de Teste',
        studentName: 'Aluno de Teste',
        courseTitle: 'Curso de Demonstração',
        workloadHours: 20,
        completionDate: '2026-09-29',
        deliveryMode: 'online',
        classId: null,
        responsibleName: null,
        responsibleRole: null,
      },
      registrationNumber: '2026-000001',
      verificationCode: 'AAECAwQFBgcICQoLDA0ODw',
      verificationUrl:
        'http://localhost:3000/v1/public/certificates/AAECAwQFBgcICQoLDA0ODw',
      markAsTest: true,
    });

    expect(pdf.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(1_000);
  });
});
