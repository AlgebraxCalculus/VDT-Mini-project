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
import { AssignImpactDto } from './dto/assign-impact.dto';
import { QueryEventStationsDto } from './dto/query-event-stations.dto';
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

/** One province in an event's scope. */
export interface ScopeProvince {
  id: number;
  code: string;
  name: string;
}

/** One station in an event's scope (client-facing fields only). */
export interface ScopeStation {
  id: number;
  stationCode: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  riskStatus: string | null;
  provinceName: string | null;
}

/** API 26 payload: the event's provinces + a paginated list of its stations. */
export interface EventScope {
  provinces: ScopeProvince[];
  stations: {
    data: ScopeStation[];
    total: number;
    page: number;
    size: number;
  };
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
  // API 25 — POST /events/{id}/impact.
  // ----------------------------------------------------------------------------

  /**
   * Manually (re)assign an event's affected scope. This REPLACES the existing
   * N-N scope (the auto-ingestion grows it incrementally; an operator override is
   * authoritative). Accepts a province list, a GeoJSON footprint, or both (the
   * footprint constrained to those provinces). Writes via raw PostGIS, then
   * publishes EVENT_SCOPE_ASSIGNED so the Risk Engine recomputes the new stations.
   * Locked once the event is CLOSED.
   */
  async assignImpact(id: string, dto: AssignImpactDto): Promise<EventScope> {
    const event = await this.findEntity(id);
    this.assertEditable(event);

    const provinceIds = dto.provinceIds ?? [];
    const hasProvinces = provinceIds.length > 0;
    const area = dto.affectedArea;
    if (!hasProvinces && !area) {
      throw new BadRequestException(
        'Provide provinceIds, affectedArea, or both',
      );
    }
    if (area && area.type !== 'Polygon' && area.type !== 'MultiPolygon') {
      throw new BadRequestException(
        'affectedArea must be a GeoJSON Polygon or MultiPolygon',
      );
    }
    if (hasProvinces) {
      const found = await this.dataSource.query<{ id: number }[]>(
        `SELECT id FROM provinces WHERE id = ANY($1)`,
        [provinceIds],
      );
      if (found.length !== new Set(provinceIds).size) {
        throw new BadRequestException('One or more provinceIds do not exist');
      }
    }

    const stationIds = await this.dataSource.transaction(async (m) => {
      // Replace: clear the old scope first (stations before provinces is fine —
      // no FK between the two N-N tables).
      await m.query(`DELETE FROM event_stations WHERE event_id = $1`, [id]);
      await m.query(`DELETE FROM event_provinces WHERE event_id = $1`, [id]);

      if (area) {
        const gj = JSON.stringify(area);
        const provFilter = hasProvinces ? 'AND p.id = ANY($3)' : '';
        const stnFilter = hasProvinces ? 'AND s.province_id = ANY($3)' : '';
        const params = hasProvinces ? [id, gj, provinceIds] : [id, gj];

        // Provinces intersecting the footprint (clipped envelope → guaranteed Polygon).
        await m.query(
          `WITH a AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) AS geom)
           INSERT INTO event_provinces (event_id, province_id, affected_area)
           SELECT $1, p.id, ST_Envelope(ST_Intersection(p.boundary, a.geom))
           FROM provinces p, a
           WHERE ST_Intersects(p.boundary, a.geom)
             AND ST_Area(ST_Intersection(p.boundary, a.geom)) > 0 ${provFilter}
           ON CONFLICT (event_id, province_id) DO NOTHING`,
          params,
        );
        // Stations inside the footprint.
        const added = await m.query<{ station_id: number }[]>(
          `WITH a AS (SELECT ST_SetSRID(ST_GeomFromGeoJSON($2), 4326) AS geom)
           INSERT INTO event_stations (event_id, station_id)
           SELECT $1, s.id FROM stations s, a
           WHERE s.is_deleted = false AND ST_Intersects(a.geom, s.geom) ${stnFilter}
           ON CONFLICT (event_id, station_id) DO NOTHING
           RETURNING station_id`,
          params,
        );
        return added.map((r) => Number(r.station_id));
      }

      // Province-only mode: scope to whole provinces (no footprint polygon stored).
      await m.query(
        `INSERT INTO event_provinces (event_id, province_id, affected_area)
         SELECT $1, p.id, NULL FROM provinces p WHERE p.id = ANY($2)
         ON CONFLICT (event_id, province_id) DO NOTHING`,
        [id, provinceIds],
      );
      const added = await m.query<{ station_id: number }[]>(
        `INSERT INTO event_stations (event_id, station_id)
         SELECT $1, s.id FROM stations s
         WHERE s.is_deleted = false AND s.province_id = ANY($2)
         ON CONFLICT (event_id, station_id) DO NOTHING
         RETURNING station_id`,
        [id, provinceIds],
      );
      return added.map((r) => Number(r.station_id));
    });

    this.emitScopeAssigned(id, stationIds);
    // Return the fresh scope (first page) so the caller can render immediately.
    return this.getStations(id, { page: 1, size: 50 });
  }

  // ----------------------------------------------------------------------------
  // API 26 — GET /events/{id}/stations.
  // ----------------------------------------------------------------------------

  /** The event's provinces + paginated stations in scope. */
  async getStations(
    id: string,
    query: QueryEventStationsDto,
  ): Promise<EventScope> {
    await this.findEntity(id); // 404 if missing
    const { page, size } = query;

    const provinces = await this.dataSource.query<ScopeProvince[]>(
      `SELECT p.id, p.code, p.name
         FROM event_provinces ep
         JOIN provinces p ON p.id = ep.province_id
        WHERE ep.event_id = $1
        ORDER BY p.name`,
      [id],
    );

    const countRows = await this.dataSource.query<{ c: number }[]>(
      `SELECT COUNT(*)::int AS c
         FROM event_stations es
         JOIN stations s ON s.id = es.station_id
        WHERE es.event_id = $1 AND s.is_deleted = false`,
      [id],
    );
    const total = countRows[0]?.c ?? 0;

    const rows = await this.dataSource.query<
      {
        id: number;
        stationCode: string;
        name: string;
        latitude: string | null;
        longitude: string | null;
        riskStatus: string | null;
        provinceName: string | null;
      }[]
    >(
      `SELECT s.id,
              s.station_code AS "stationCode",
              s.name,
              s.latitude,
              s.longitude,
              s.risk_status  AS "riskStatus",
              p.name         AS "provinceName"
         FROM event_stations es
         JOIN stations s ON s.id = es.station_id
         LEFT JOIN provinces p ON p.id = s.province_id
        WHERE es.event_id = $1 AND s.is_deleted = false
        ORDER BY s.name
        LIMIT $2 OFFSET $3`,
      [id, size, (page - 1) * size],
    );

    const data: ScopeStation[] = rows.map((r) => ({
      id: r.id,
      stationCode: r.stationCode,
      name: r.name,
      latitude: r.latitude != null ? Number(r.latitude) : null,
      longitude: r.longitude != null ? Number(r.longitude) : null,
      riskStatus: r.riskStatus,
      provinceName: r.provinceName,
    }));

    return { provinces, stations: { data, total, page, size } };
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

  /**
   * Scope (re)assigned (API 25) → tell the Risk Engine to recompute the scoped
   * stations. Fire-and-forget after the DB commit; skipped when scope is empty.
   */
  private emitScopeAssigned(eventId: string, stationIds: number[]): void {
    if (stationIds.length === 0) return;
    void this.eventBus
      .publish(EVENT_CHANNELS.EVENT_SCOPE_ASSIGNED, { eventId, stationIds })
      .catch((err) =>
        this.logger.error(
          `failed to publish scope-assigned for event=${eventId}: ${
            (err as Error).message
          }`,
        ),
      );
  }
}
