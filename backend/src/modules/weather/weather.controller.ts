import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { RoleCode } from '../users/entities/role.entity';
import { RefreshWeatherDto } from './dto/refresh-weather.dto';
import { QuerySnapshotDto } from './dto/query-snapshot.dto';
import { WeatherService } from './weather.service';

/**
 * Group F — weather sync. Refresh + job status are operational (Operator/Admin
 * per the RBAC matrix); reading the latest snapshot is open to any authenticated
 * user (Viewer+). Auth is enforced globally; @Roles is read by RolesGuard.
 */
@Controller('weather')
export class WeatherController {
  constructor(private readonly weatherService: WeatherService) {}

  /** API 31 — POST /weather/refresh (debounce+lock, async job → 202). */
  @Roles(RoleCode.OPERATOR, RoleCode.ADMIN)
  @Post('refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  refresh(
    @Body() dto: RefreshWeatherDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.weatherService.enqueueRefresh(dto, user.id);
  }

  /** API 32 — GET /weather/refresh/{jobId}. */
  @Roles(RoleCode.OPERATOR, RoleCode.ADMIN)
  @Get('refresh/:jobId')
  getStatus(@Param('jobId') jobId: string) {
    return this.weatherService.getRefreshStatus(jobId);
  }

  /** API 33 — GET /weather/snapshots/latest?source=. */
  @Get('snapshots/latest')
  getLatest(@Query() query: QuerySnapshotDto) {
    return this.weatherService.getLatestSnapshot(query.source);
  }
}
