import { CertificateIdentity } from './certificate-identity';

describe('CertificateIdentity', () => {
  it('creates the same online identity for the same person and course', () => {
    const first = CertificateIdentity.create({
      externalStudentId: 'student-42',
      courseId: 'course-9',
      deliveryMode: 'online',
    });
    const retry = CertificateIdentity.create({
      externalStudentId: 'student-42',
      courseId: 'course-9',
      deliveryMode: 'online',
    });

    expect(first.key).toBe(retry.key);
    expect(first.classId).toBeNull();
  });

  it('distinguishes in-person classes of the same course', () => {
    const morningClass = CertificateIdentity.create({
      externalStudentId: 'student-42',
      courseId: 'course-9',
      deliveryMode: 'in_person',
      classId: 'class-morning',
    });
    const eveningClass = CertificateIdentity.create({
      externalStudentId: 'student-42',
      courseId: 'course-9',
      deliveryMode: 'in_person',
      classId: 'class-evening',
    });

    expect(morningClass.key).not.toBe(eveningClass.key);
  });

  it('distinguishes delivery modes for otherwise equal IDs', () => {
    const online = CertificateIdentity.create({
      externalStudentId: 'student-42',
      courseId: 'course-9',
      deliveryMode: 'online',
    });
    const inPerson = CertificateIdentity.create({
      externalStudentId: 'student-42',
      courseId: 'course-9',
      deliveryMode: 'in_person',
      classId: 'course-9',
    });

    expect(online.key).not.toBe(inPerson.key);
  });

  it('requires a class ID for in-person delivery', () => {
    expect(() =>
      CertificateIdentity.create({
        externalStudentId: 'student-42',
        courseId: 'course-9',
        deliveryMode: 'in_person',
      }),
    ).toThrow('classId is required for in_person delivery');
  });

  it('rejects class IDs for online delivery', () => {
    expect(() =>
      CertificateIdentity.create({
        externalStudentId: 'student-42',
        courseId: 'course-9',
        deliveryMode: 'online',
        classId: 'unexpected-class',
      }),
    ).toThrow('classId must be omitted for online delivery');
  });

  it('rejects an unknown delivery mode at runtime', () => {
    expect(() =>
      CertificateIdentity.create({
        externalStudentId: 'student-42',
        courseId: 'course-9',
        deliveryMode: 'hybrid' as 'online',
      }),
    ).toThrow('deliveryMode must be online or in_person');
  });

  it('rejects IDs that exceed the UTF-8 byte limit', () => {
    expect(() =>
      CertificateIdentity.create({
        externalStudentId: 'ã'.repeat(65),
        courseId: 'course-9',
        deliveryMode: 'online',
      }),
    ).toThrow(
      'externalStudentId must contain 1-128 characters without outer whitespace',
    );
  });
});
