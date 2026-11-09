import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UploadCertificateDto {
  @ApiProperty({
    description:
      'RUC de 13 dígitos del emisor (debe coincidir con el RUC del tenant o registrarse)',
    example: '1790011674001',
  })
  @IsString()
  @IsNotEmpty()
  @Length(13, 13, { message: 'El RUC debe tener exactamente 13 dígitos.' })
  @Matches(/^\d{13}$/, { message: 'El RUC debe contener únicamente dígitos numéricos.' })
  ruc: string;

  @ApiProperty({
    description: 'Contraseña del archivo de firma electrónica (.p12 / .pfx)',
    example: 'MiClaveSeguraP12_2026',
  })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña del certificado (.p12) es obligatoria.' })
  password: string;
}

export { CreateTenantDto } from './create-tenant.dto';
