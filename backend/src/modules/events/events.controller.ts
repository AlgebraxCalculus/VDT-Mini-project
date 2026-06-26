import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { RoleCode } from '../users/entities/role.entity';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { CloseEventDto } from './dto/close-event.dto';
import { QueryEventsDto } from './dto/query-events.dto';
import { EventsService } from './events.service';

/**
 * Group D — Disaster events. Reads open to any authenticated user; create/update/
 * close require Operator/Admin. Event ids are BIGINT, so they're handled as
 * strings (no ParseIntPipe).
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

  /** API 22 — POST /events. */
  @Roles(RoleCode.OPERATOR, RoleCode.ADMIN)
  @Post()
  create(
    @Body() dto: CreateEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.eventsService.create(dto, user.id);
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
}
