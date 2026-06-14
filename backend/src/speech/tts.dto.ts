import { IsString, IsNotEmpty } from 'class-validator';

export class TtsDto {
  @IsString()
  @IsNotEmpty()
  text!: string;
}
