import {
  IsDateString,
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

interface ResponsibleFields {
  responsibleName?: string;
  responsibleRole?: string;
}

@ValidatorConstraint({ name: 'reissueResponsiblePair', async: false })
class ReissueResponsiblePair implements ValidatorConstraintInterface {
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

export class ReissueCertificateDto {
  @IsString()
  @Length(1, 128)
  actorId!: string;

  @IsString()
  @Length(1, 1000)
  reason!: string;

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
  @Validate(ReissueResponsiblePair)
  responsibleName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Validate(ReissueResponsiblePair)
  responsibleRole?: string;
}
