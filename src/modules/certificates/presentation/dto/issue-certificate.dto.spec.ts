import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IssueCertificateDto } from './issue-certificate.dto';

const baseRequest = {
  externalStudentId: 'student-1',
  courseId: 'course-1',
  deliveryMode: 'online',
  studentName: 'Student Test',
  courseTitle: 'Course Test',
  workloadHours: 12,
  completionDate: '2026-09-29',
};

async function validationErrors(input: Record<string, unknown>) {
  return validate(plainToInstance(IssueCertificateDto, input));
}

describe('IssueCertificateDto', () => {
  it('accepts an online certificate without a class ID', async () => {
    await expect(validationErrors(baseRequest)).resolves.toHaveLength(0);
  });

  it('requires a class ID for in-person certificates', async () => {
    const errors = await validationErrors({
      ...baseRequest,
      deliveryMode: 'in_person',
    });

    expect(errors.some((error) => error.property === 'deliveryMode')).toBe(
      true,
    );
  });

  it('rejects a class ID for online certificates', async () => {
    const errors = await validationErrors({
      ...baseRequest,
      classId: 'class-1',
    });

    expect(errors.some((error) => error.property === 'deliveryMode')).toBe(
      true,
    );
  });

  it('accepts in-person certificates with a class ID', async () => {
    const errors = await validationErrors({
      ...baseRequest,
      deliveryMode: 'in_person',
      classId: 'class-1',
    });

    expect(errors).toHaveLength(0);
  });

  it('requires responsible name and role together', async () => {
    const errors = await validationErrors({
      ...baseRequest,
      responsibleRole: 'Instructor',
    });

    expect(errors.some((error) => error.property === 'responsibleRole')).toBe(
      true,
    );
  });
});
