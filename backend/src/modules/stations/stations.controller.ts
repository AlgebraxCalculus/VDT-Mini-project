import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleCode } from '../users/entities/role.entity';
import { CreateStationDto } from './dto/create-station.dto';
import { QueryStationsDto } from './dto/query-stations.dto';
import { SetThresholdsDto } from './dto/set-thresholds.dto';
import { UpdateStationDto } from './dto/update-station.dto';
import { ViewportStationsDto } from './dto/viewport-stations.dto';
import { StationsService } from './stations.service';

/**
 * Group C — Station management. Reads are open to any authenticated user
 * (Viewer+); writes require Operator/Admin per the RBAC matrix. Auth is enforced
 * globally (JwtAuthGuard); @Roles is read by the global RolesGuard.
 */
@Controller('stations')
export class StationsController {
  constructor(private readonly stationsService: StationsService) {}

  /** API 12 — GET /stations. */
  @Get()
  findAll(@Query() query: QueryStationsDto) {
    return this.stationsService.findAll(query);
  }

  /**
   * GET /stations/viewport — map BBOX query (GIST-indexed ST_MakeEnvelope/
   * ST_Contains). Declared before `:id` so the literal path isn't swallowed by
   * the numeric param route. Reads are open to any authenticated user (Viewer+).
   */
  @Get('viewport')
  findInViewport(@Query() query: ViewportStationsDto) {
    return this.stationsService.findInViewport(query);
  }

  /** API 13 — GET /stations/{id}. */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.stationsService.findOne(id);
  }

  /** API 14 — POST /stations (auto-assigns province via ST_Contains). */
  @Roles(RoleCode.OPERATOR, RoleCode.ADMIN)
  @Post()
  create(@Body() dto: CreateStationDto) {
    return this.stationsService.create(dto);
  }

  /** API 15 — PUT /stations/{id}. */
  @Roles(RoleCode.OPERATOR, RoleCode.ADMIN)
  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateStationDto,
  ) {
    return this.stationsService.update(id, dto);
  }

  /** API 16 — DELETE /stations/{id} (soft-delete). */
  @Roles(RoleCode.OPERATOR, RoleCode.ADMIN)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.stationsService.remove(id);
  }

  /** API 17 — PUT /stations/{id}/thresholds. */
  @Roles(RoleCode.OPERATOR, RoleCode.ADMIN)
  @Put(':id/thresholds')
  setThresholds(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetThresholdsDto,
  ) {
    return this.stationsService.setThresholds(id, dto);
  }
}
