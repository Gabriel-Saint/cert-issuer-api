import { IsString, Length } from 'class-validator';

export class RevokeCertificateDto {
  @IsString()
  @Length(1, 128)
  actorId!: string;

  @IsString()
  @Length(1, 1000)
  reason!: string;
}
