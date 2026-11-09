import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTenantDto {
  @ApiProperty({
    description: 'Razón social o nombre comercial del Tenant (Empresa Emisora)',
    example: 'Importadora Tecnológica del Ecuador S.A.',
  })
  @IsString()
  @IsNotEmpty({ message: 'La razón social (businessName) es obligatoria.' })
  businessName: string;

  @ApiProperty({
    description: 'RUC de 13 dígitos del contribuyente emisor (terminado en 001)',
    example: '1790011674001',
  })
  @IsString()
  @Length(13, 13, { message: 'El RUC debe tener exactamente 13 dígitos.' })
  @Matches(/^\d{10}001$/, { message: 'El RUC debe tener 13 dígitos numéricos y terminar en 001.' })
  ruc: string;
}
