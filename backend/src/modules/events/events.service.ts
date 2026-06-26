import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { CloseEventDto } from './dto/close-event.dto';
import { QueryEventsDto } from './dto/query-events.dto';
import {
  DisasterEvent,
  EventStatus,
} from './entities/disaster-event.entity';
import { DisasterType } from './entities/disaster-type.entity';
import { EventBusService } from '../../event-bus/event-bus.service';
import { EVENT_CHANNELS } from '../../event-bus/event-bus.constants';

/** Event + scope summary (province/station counts) for list & detail views. */
export type EventWithScope = DisasterEvent & {
  provinceCount: number;
  stationCount: number;
};

export interface PaginatedEvents {
  data: EventWithScope[];
  total: number;
  page: number;
  size: number;
}

@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

  constructor(
    @InjectRepository(DisasterEvent)
    private readonly eventsRepo: Repository<DisasterEvent>,
    @InjectRepository(DisasterType)
    private readonly typesRepo: Repository<DisasterType>,
    private readonly dataSource: DataSource,
    private readonly eventBus: EventBusService,
  ) {}

  // ----------------------------------------------------------------------------
  // API 22 — POST /events.
  // ----------------------------------------------------------------------------

  /**
   * Create an ONGOING event.
   *
   * Duplicate guard: the design forbids two active events of the same type "on
   * the same scope". Scope isn't assigned until API 25, so at creation the
   * effective rule is one ONGOING event per disaster_type — re-check per-province
   * overlap inside the scope-assignment flow once that lands.
   */
  async create(dto: CreateEventDto, userId: number): Promise<EventWithScope> {
    const type = await this.typesRepo.findOne({
      where: { id: dto.disasterTypeId },
    });
    if (!type) {
      throw new BadRequestException(
        `Disaster type ${dto.disasterTypeId} does not exist`,
      );
    }

    const activeDuplicate = await this.eventsRepo.findOne({
      where: {
        disasterTypeId: dto.disasterTypeId,
        status: EventStatus.ONGOING,
      },
    });
    if (activeDuplicate) {
      throw new ConflictException(
        `An ONGOING ${type.code} event already exists (${activeDuplicate.eventCode})`,
      );
    }

    const event = this.eventsRepo.create({
      eventCode: this.buildEventCode(type.code),
      disasterTypeId: dto.disasterTypeId,
      name: dto.name,
      status: EventStatus.ONGOING,
      startTime: dto.startTime ? new Date(dto.startTime) : new Date(),
      description: dto.description ?? null,
      createdBy: userId,
    });

    let saved: DisasterEvent;
    try {
      saved = await this.eventsRepo.save(event);
    } catch (err) {
      // Extremely unlikely event_code collision (UNIQUE) — regenerate once.
      if ((err as { code?: string }).code === '23505') {
        event.eventCode = this.buildEventCode(type.code);
        saved = await this.eventsRepo.save(event);
      } else {
        throw err;
      }
    }

    return this.findOne(saved.id);
  }

  // ----------------------------------------------------------------------------
  // API 20 / 21 — read.
  // ----------------------------------------------------------------------------

  /** GET /events — by status, paginated, with province/station counts. */
  async findAll(query: QueryEventsDto): Promise<PaginatedEvents> {
    const { status, page, size } = query;

    const qb = this.eventsRepo
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.disasterType', 'type')
      .orderBy('event.startTime', 'DESC')
      .skip((page - 1) * size)
      .take(size);

    if (status) {
      qb.andWhere('event.status = :status', { status });
    }

    const [rows, total] = await qb.getManyAndCount();

    // One grouped query per relation for the whole page — no N+1.
    const counts = await this.scopeCounts(rows.map((e) => e.id));
    const data = rows.map((e) => this.withScope(e, counts));

    return { data, total, page, size };
  }

  /** GET /events/{id} — event + type + scope counts. */
  async findOne(id: string): Promise<EventWithScope> {
    const event = await this.findEntity(id, true);
    const counts = await this.scopeCounts([id]);
    return this.withScope(event, counts);
  }

  // ----------------------------------------------------------------------------
  // API 23 — PUT /events/{id}.
  // ----------------------------------------------------------------------------

  /** Edit descriptive fields. Locked once the event is CLOSED (terminal state). */
  async update(id: string, dto: UpdateEventDto): Promise<EventWithScope> {
    const event = await this.findEntity(id);
    this.assertEditable(event);

    if (dto.name !== undefined) event.name = dto.name;
    if (dto.description !== undefined) event.description = dto.description;
    if (dto.startTime !== undefined) event.startTime = new Date(dto.startTime);

    await this.eventsRepo.save(event);
    return this.findOne(id);
  }

  // ----------------------------------------------------------------------------
  // API 24 — POST /events/{id}/close.
  // ----------------------------------------------------------------------------

  /** Transition ONGOING → CLOSED. Idempotency is rejected (already closed). */
  async close(id: string, dto: CloseEventDto): Promise<EventWithScope> {
    const event = await this.findEntity(id);
    if (event.status === EventStatus.CLOSED) {
      throw new ConflictException('Event is already closed');
    }

    event.status = EventStatus.CLOSED;
    event.endTime = dto.endTime ? new Date(dto.endTime) : new Date();
    await this.eventsRepo.save(event);

    // Closing changes what's drawn on the map / scored by the Risk Engine.
    this.emitEventClosed(id);
    return this.findOne(id);
  }

  // ----------------------------------------------------------------------------
  // Internals.
  // ----------------------------------------------------------------------------

  private async findEntity(
    id: string,
    withType = false,
  ): Promise<DisasterEvent> {
    const event = await this.eventsRepo.findOne({
      where: { id },
      relations: withType ? { disasterType: true } : undefined,
    });
    if (!event) {
      throw new NotFoundException(`Event ${id} not found`);
    }
    return event;
  }

  private assertEditable(event: DisasterEvent): void {
    if (event.status === EventStatus.CLOSED) {
      throw new ForbiddenException('A CLOSED event cannot be edited');
    }
  }

  /**
   * Province/station counts for a set of event ids. event_id is BIGINT → keep
   * keys as strings (matches DisasterEvent.id). Returns an empty map for [].
   */
  private async scopeCounts(
    eventIds: string[],
  ): Promise<Map<string, { provinces: number; stations: number }>> {
    const map = new Map<string, { provinces: number; stations: number }>();
    if (eventIds.length === 0) return map;

    const ensure = (id: string) => {
      let entry = map.get(id);
      if (!entry) {
        entry = { provinces: 0, stations: 0 };
        map.set(id, entry);
      }
      return entry;
    };

    const provRows: { event_id: string; c: number }[] =
      await this.dataSource.query(
        `SELECT event_id, COUNT(*)::int AS c
           FROM event_provinces
          WHERE event_id = ANY($1)
          GROUP BY event_id`,
        [eventIds],
      );
    for (const r of provRows) ensure(String(r.event_id)).provinces = r.c;

    const stnRows: { event_id: string; c: number }[] =
      await this.dataSource.query(
        `SELECT event_id, COUNT(*)::int AS c
           FROM event_stations
          WHERE event_id = ANY($1)
          GROUP BY event_id`,
        [eventIds],
      );
    for (const r of stnRows) ensure(String(r.event_id)).stations = r.c;

    return map;
  }

  private withScope(
    event: DisasterEvent,
    counts: Map<string, { provinces: number; stations: number }>,
  ): EventWithScope {
    const c = counts.get(event.id) ?? { provinces: 0, stations: 0 };
    return Object.assign(event, {
      provinceCount: c.provinces,
      stationCount: c.stations,
    });
  }

  /** Human-readable, collision-resistant code, e.g. STORM-20260622-3F9A. */
  private buildEventCode(typeCode: string): string {
    const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `${typeCode}-${ymd}-${rand}`;
  }

  /**
   * Event-driven hook (design): closing an event publishes onto the internal
   * Redis event bus so the map/risk layers refresh for its scope. Fire-and-forget
   * — a publish failure must not undo the state transition that already committed.
   */
  private emitEventClosed(eventId: string): void {
    void this.eventBus
      .publish(EVENT_CHANNELS.EVENT_CLOSED, { eventId })
      .catch((err) =>
        this.logger.error(
          `failed to publish event-closed for event=${eventId}: ${
            (err as Error).message
          }`,
        ),
      );
  }
}
