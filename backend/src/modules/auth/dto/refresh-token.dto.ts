import { IsJWT, IsNotEmpty } from 'class-validator';

/** Used by both POST /auth/refresh and POST /auth/logout. */
export class RefreshTokenDto {
  @IsJWT()
  @IsNotEmpty()
  refresh_token: string;
}
