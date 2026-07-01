import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleCode } from '../users/entities/role.entity';
import { UpdateEventDto } from './dto/update-event.dto';
import { CloseEventDto } from './dto/close-event.dto';
import { QueryEventsDto } from './dto/query-events.dto';
import { AssignImpactDto } from './dto/assign-impact.dto';
import { QueryEventStationsDto } from './dto/query-event-stations.dto';
import { EventsService } from './events.service';

/**
 * Group D — Disaster events. Reads open to any authenticated user; update/close
 * require Operator/Admin. Ids are BIGINT, handled as strings. No manual create
 * (API 22 removed) — events are auto-tracked by {@link EventIngestionService}.
 */
@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  /** API 20 — GET /events. */
  @Get()
  findAll(@Query() query: QueryEventsDto) {
    return this.eventsService.findAll(query);
  }

  /** API 21 — GET /events/{id}. */
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.eventsService.findOne(id);
  }

  /** API 23 — PUT /events/{id}. */
  @Roles(RoleCode.OPERATOR, RoleCode.ADMIN)
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateEventDto) {
    return this.eventsService.update(id, dto);
  }

  /** API 24 — POST /events/{id}/close. */
  @Roles(RoleCode.OPERATOR, RoleCode.ADMIN)
  @Post(':id/close')
  close(@Param('id') id: string, @Body() dto: CloseEventDto) {
    return this.eventsService.close(id, dto);
  }

  /** API 25 — POST /events/{id}/impact. (Re)assign scope, replacing the auto-assigned one. */
  @Roles(RoleCode.OPERATOR, RoleCode.ADMIN)
  @Post(':id/impact')
  assignImpact(@Param('id') id: string, @Body() dto: AssignImpactDto) {
    return this.eventsService.assignImpact(id, dto);
  }

  /** API 26 — GET /events/{id}/stations: provinces + paginated stations in scope. */
  @Get(':id/stations')
  getStations(
    @Param('id') id: string,
    @Query() query: QueryEventStationsDto,
  ) {
    return this.eventsService.getStations(id, query);
  }
}
