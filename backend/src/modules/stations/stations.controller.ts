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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { RoleCode } from '../users/entities/role.entity';
import { CreateStationDto } from './dto/create-station.dto';
import { QueryStationsDto } from './dto/query-stations.dto';
import { SetThresholdsDto } from './dto/set-thresholds.dto';
import { UpdateStationDto } from './dto/update-station.dto';
import { ViewportStationsDto } from './dto/viewport-stations.dto';
import { StationsService } from './stations.service';
import { IMPORT_MAX_BYTES } from './import/station-import.constants';
import {
  StationImportService,
  UploadedCsvFile,
} from './import/station-import.service';

/** Group C — Station management. Reads open to any authenticated user; writes require Operator/Admin. */
@Controller('stations')
export class StationsController {
  constructor(
    private readonly stationsService: StationsService,
    private readonly importService: StationImportService,
  ) {}

  /**
   * API 18 — POST /stations/import. Multipart CSV → 202 { jobId }; shape-validated
   * synchronously, then batch-inserted async. Declared before `:id` routes.
   */
  @Roles(RoleCode.OPERATOR, RoleCode.ADMIN)
  @Post('import')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: IMPORT_MAX_BYTES } }))
  import(
    @UploadedFile() file: UploadedCsvFile | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.importService.enqueueImport(file, user.id);
  }

  /** API 19 — GET /stations/import/{jobId} (job state + progress + report). */
  @Roles(RoleCode.OPERATOR, RoleCode.ADMIN)
  @Get('import/:jobId')
  getImportStatus(@Param('jobId') jobId: string) {
    return this.importService.getStatus(jobId);
  }

  /** API 12 — GET /stations. */
  @Get()
  findAll(@Query() query: QueryStationsDto) {
    return this.stationsService.findAll(query);
  }

  /** GET /stations/viewport — map BBOX query. Declared before `:id`. */
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
