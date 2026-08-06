import { IsString, MinLength, MaxLength } from 'class-validator';

export class ReportDeploymentDto {
  @IsString()
  @MinLength(32)
  @MaxLength(128)
  signature!: string;
}
