import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  Validate,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import type { DeliveryMode } from '../../domain/value-objects/certificate-identity';

interface DeliveryFields {
  deliveryMode: DeliveryMode;
  classId?: string;
}

@ValidatorConstraint({ name: 'deliveryClassMatch', async: false })
class DeliveryClassMatch implements ValidatorConstraintInterface {
  validate(_value: unknown, args?: ValidationArguments): boolean {
    if (!args) {
      return false;
    }
    const input = args.object as DeliveryFields;
    if (input.deliveryMode === 'online') {
      return input.classId === undefined;
    }
    if (input.deliveryMode === 'in_person') {
      return typeof input.classId === 'string' && input.classId.length > 0;
    }
    return false;
  }

  defaultMessage(): string {
    return 'classId must be omitted for online or provided for in_person';
  }
}

interface ResponsibleFields {
  responsibleName?: string;
  responsibleRole?: string;
}

@ValidatorConstraint({ name: 'responsiblePair', async: false })
class ResponsiblePair implements ValidatorConstraintInterface {
  validate(_value: unknown, args?: ValidationArguments): boolean {
    if (!args) {
      return false;
    }
    const input = args.object as ResponsibleFields;
    return (
      (input.responsibleName === undefined) ===
      (input.responsibleRole === undefined)
    );
  }

  defaultMessage(): string {
    return 'responsibleName and responsibleRole must be provided together';
  }
}

export class IssueCertificateDto {
  @IsString()
  @Length(1, 128)
  externalStudentId!: string;

  @IsString()
  @Length(1, 128)
  courseId!: string;

  @IsIn(['online', 'in_person'])
  @Validate(DeliveryClassMatch)
  deliveryMode!: DeliveryMode;

  @IsOptional()
  @IsString()
  @Length(1, 128)
  classId?: string;

  @IsString()
  @Length(1, 200)
  studentName!: string;

  @IsString()
  @Length(1, 300)
  courseTitle!: string;

  @IsInt()
  @Min(1)
  @Max(10_000)
  workloadHours!: number;

  @IsDateString({ strict: true })
  completionDate!: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  @Validate(ResponsiblePair)
  responsibleName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Validate(ResponsiblePair)
  responsibleRole?: string;

  @IsOptional()
  @IsIn(['standard'])
  certificateType?: string;
}
