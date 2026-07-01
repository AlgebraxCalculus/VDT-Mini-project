import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, Repository } from 'typeorm';
import { CreateStationDto } from './dto/create-station.dto';
import { QueryStationsDto } from './dto/query-stations.dto';
import { SetThresholdsDto } from './dto/set-thresholds.dto';
import { UpdateStationDto } from './dto/update-station.dto';
import { ViewportStationsDto } from './dto/viewport-stations.dto';
import { FloodThreshold } from './entities/flood-threshold.entity';
import { Station } from './entities/station.entity';
import { EventBusService } from '../../event-bus/event-bus.service';
import { EVENT_CHANNELS } from '../../event-bus/event-bus.constants';
import { ProvinceResolverService } from '../provinces/province-resolver.service';

/** Station detail returned to clients: the row + province + threshold tiers. */
export type StationWithThresholds = Station & { thresholds: FloodThreshold[] };

export interface PaginatedStations {
  data: StationWithThresholds[];
  total: number;
  page: number;
  size: number;
}

@Injectable()
export class StationsService {
  private readonly logger = new Logger(StationsService.name);

  constructor(
    @InjectRepository(Station)
    private readonly stationsRepo: Repository<Station>,
    @InjectRepository(FloodThreshold)
    private readonly thresholdsRepo: Repository<FloodThreshold>,
    // Used for transactions + the raw PostGIS statements (ST_MakePoint/ST_Contains).
    private readonly dataSource: DataSource,
    private readonly eventBus: EventBusService,
    // Falls back to reverse-geocoding (and auto-creating a province) when a
    // coordinate lands outside every existing province boundary.
    private readonly provinceResolver: ProvinceResolverService,
  ) {}

  // ----------------------------------------------------------------------------
  // API 14 — POST /stations (the PostGIS create).
  // ----------------------------------------------------------------------------

  /**
   * Create a station and auto-assign its province by point-in-polygon.
   *
   * geom and province_id are set in a single raw statement *after* the insert so
   * that:
   *   - geom always gets SRID 4326 via ST_SetSRID(ST_MakePoint(lng, lat), 4326)
   *     — inserting a bare GeoJSON object can leave SRID 0 and break later
   *     ST_Contains / ST_MakeEnvelope viewport queries;
   *   - province_id is derived with ST_Contains(province.boundary, point) and is
   *     never set by hand. A station outside every boundary keeps province_id NULL.
   * The insert + geom update + thresholds run in one transaction so a partial
   * row can never be observed.
   */
  async create(dto: CreateStationDto): Promise<StationWithThresholds> {
    await this.assertCodeAvailable(dto.stationCode);

    const stationId = await this.dataSource.transaction(async (manager) => {
      const result = await manager.insert(Station, {
        stationCode: dto.stationCode,
        name: dto.name,
        latitude: dto.latitude,
        longitude: dto.longitude,
        elevation: dto.elevation ?? null,
        isDeleted: false,
      });
      const id = result.identifiers[0].id as number;

      await this.applyGeometry(manager, id, dto.longitude, dto.latitude);

      if (dto.thresholds?.length) {
        await manager.insert(
          FloodThreshold,
          dto.thresholds.map((t) => ({
            stationId: id,
            alertLevel: t.alertLevel,
            thresholdValue: t.thresholdValue,
            label: t.label ?? null,
          })),
        );
      }
      return id;
    });

    // applyGeometry assigns province via ST_Contains; if the point is outside
    // every existing province, geocode it and auto-create one (kept out of the
    // transaction above so the network call doesn't hold a DB lock).
    await this.ensureProvince(stationId, dto.longitude, dto.latitude);

    // Seeding thresholds feeds the risk inputs → notify the Risk Engine.
    if (dto.thresholds?.length) this.emitThresholdChanged(stationId);

    return this.findOne(stationId);
  }

  // ----------------------------------------------------------------------------
  // API 12 / 13 — read.
  // ----------------------------------------------------------------------------

  /** GET /stations — filter by province/risk/event + free text, paginated. */
  async findAll(query: QueryStationsDto): Promise<PaginatedStations> {
    const { provinceId, riskStatus, eventId, q, page, size } = query;

    const qb = this.stationsRepo
      .createQueryBuilder('station')
      // Province is always joined: it supplies the province name in the response
      // AND backs the free-text search below. The heavy boundary/centroid
      // geometry is kept out of the payload via `select: false` on the entity
      // (so this stays light even at 10k+ rows); station.geom is excluded the
      // same way.
      .leftJoinAndSelect('station.province', 'province')
      // Soft-deleted stations are excluded everywhere they're read.
      .where('station.isDeleted = false')
      .orderBy('station.createdAt', 'DESC')
      .skip((page - 1) * size)
      .take(size);

    if (provinceId !== undefined) {
      qb.andWhere('station.provinceId = :provinceId', { provinceId });
    }
    if (riskStatus) {
      qb.andWhere('station.riskStatus = :riskStatus', { riskStatus });
    }
    if (eventId) {
      // Restrict to stations frozen into an event's scope (event_stations N-N).
      qb.innerJoin(
        'event_stations',
        'es',
        'es.station_id = station.id AND es.event_id = :eventId',
        { eventId },
      );
    }
    if (q) {
      // Free-text search spans three fields, in order of real-world frequency:
      //   1. station name      — "Trạm Đông Hà" → that station
      //   2. province name     — "Quảng Trị"    → every station in the province
      //   3. station code      — kept for completeness, used far less often
      // ILIKE is case-insensitive but accent-sensitive; typing with Vietnamese
      // diacritics matches as expected (see notes on `unaccent` for diacritic-
      // insensitive search later). province.name is available because the
      // province relation is always joined below.
      const term = `%${q}%`;
      qb.andWhere(
        new Brackets((w) => {
          w.where('station.name ILIKE :term', { term })
            .orWhere('province.name ILIKE :term', { term })
            .orWhere('station.stationCode ILIKE :term', { term });
        }),
      );
    }

    const [rows, total] = await qb.getManyAndCount();
    const data = await this.attachThresholds(rows);
    return { data, total, page, size };
  }

  /**
   * GET /stations/viewport — stations whose point falls inside the map BBOX.
   *
   * `ST_Contains(ST_MakeEnvelope(minLng,minLat,maxLng,maxLat,4326), geom)` is
   * served by the GIST index on station.geom (PostGIS uses the index's bbox
   * `&&` pre-filter before the exact containment test), so this stays fast at
   * 10k+ stations while only returning what's on screen. Lighter than findAll's
   * pagination for the map: province is joined for the marker popup, but
   * thresholds are NOT attached (the map doesn't render tiers). Soft-deleted and
   * geom-less rows are excluded. Rows are risk-ordered (DANGER→WATCH→NORMAL) so
   * if the result hits `limit` the most important stations survive truncation.
   */
  async findInViewport(dto: ViewportStationsDto): Promise<Station[]> {
    const { minLng, minLat, maxLng, maxLat, riskStatus, limit } = dto;

    const qb = this.stationsRepo
      .createQueryBuilder('station')
      .leftJoinAndSelect('station.province', 'province')
      // Rank as a selected expression with its own alias. We can't pass this raw
      // CASE straight to .orderBy(): TypeORM runs the order-by string through its
      // `alias.column` resolver, mis-parses "CASE station.risk_status" as an alias
      // named "CASE station", and throws. Ordering by the bare alias below avoids
      // the resolver entirely (no dot to trip on).
      .addSelect(
        `CASE station.risk_status
            WHEN 'DANGER' THEN 3
            WHEN 'WARNING' THEN 2
            WHEN 'WATCH' THEN 1
            ELSE 0 END`,
        'risk_rank',
      )
      .where('station.isDeleted = false')
      .andWhere('station.geom IS NOT NULL')
      .andWhere(
        'ST_Contains(ST_MakeEnvelope(:minLng, :minLat, :maxLng, :maxLat, 4326), station.geom)',
        { minLng, minLat, maxLng, maxLat },
      )
      .orderBy('risk_rank', 'DESC')
      .take(limit);

    if (riskStatus) {
      qb.andWhere('station.riskStatus = :riskStatus', { riskStatus });
    }

    return qb.getMany();
  }

  /**
   * Attach threshold tiers to a page of stations in a single batched query
   * (keyed by station_id) — avoids an N+1 while keeping the list payload self-
   * contained. Stations with no tiers get an empty array.
   */
  private async attachThresholds(
    stations: Station[],
  ): Promise<StationWithThresholds[]> {
    if (stations.length === 0) return [];
    const tiers = await this.thresholdsRepo.find({
      where: { stationId: In(stations.map((s) => s.id)) },
      order: { alertLevel: 'ASC' },
    });
    const byStation = new Map<number, FloodThreshold[]>();
    for (const t of tiers) {
      const arr = byStation.get(t.stationId) ?? [];
      arr.push(t);
      byStation.set(t.stationId, arr);
    }
    return stations.map((s) =>
      Object.assign(s, { thresholds: byStation.get(s.id) ?? [] }),
    );
  }

  /** GET /stations/{id} — station + province + threshold tiers. */
  async findOne(id: number): Promise<StationWithThresholds> {
    const station = await this.stationsRepo.findOne({
      where: { id, isDeleted: false },
      relations: { province: true },
    });
    if (!station) {
      throw new NotFoundException(`Station ${id} not found`);
    }
    const thresholds = await this.thresholdsRepo.find({
      where: { stationId: id },
      order: { alertLevel: 'ASC' },
    });
    return Object.assign(station, { thresholds });
  }

  // ----------------------------------------------------------------------------
  // API 15 — PUT /stations/{id}.
  // ----------------------------------------------------------------------------

  /**
   * Update mutable fields. If the coordinates move, geom + province_id are
   * recomputed via the same PostGIS statement as create(). We never write geom
   * through TypeORM's entity save (which would round-trip GeoJSON and risk
   * dropping the SRID) — only via the raw ST_SetSRID statement.
   */
  async update(id: number, dto: UpdateStationDto): Promise<StationWithThresholds> {
    await this.assertExists(id);

    const latProvided = dto.latitude !== undefined;
    const lngProvided = dto.longitude !== undefined;
    if (latProvided !== lngProvided) {
      throw new BadRequestException(
        'latitude and longitude must be updated together',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const patch: Partial<Station> = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.elevation !== undefined) patch.elevation = dto.elevation;
      if (latProvided && lngProvided) {
        patch.latitude = dto.latitude;
        patch.longitude = dto.longitude;
      }
      if (Object.keys(patch).length > 0) {
        await manager.update(Station, id, patch);
      }
      if (latProvided && lngProvided) {
        await this.applyGeometry(manager, id, dto.longitude!, dto.latitude!);
      }
    });

    // Re-resolve the province (geocode + auto-create on miss) when coords moved.
    if (latProvided && lngProvided) {
      await this.ensureProvince(id, dto.longitude!, dto.latitude!);
    }

    return this.findOne(id);
  }

  // ----------------------------------------------------------------------------
  // API 16 — DELETE /stations/{id} (soft-delete).
  // ----------------------------------------------------------------------------

  /** Soft-delete: flip is_deleted / deleted_at to preserve report history. */
  async remove(id: number): Promise<void> {
    await this.assertExists(id);
    await this.stationsRepo.update(id, {
      isDeleted: true,
      deletedAt: new Date(),
    });
  }

  // ----------------------------------------------------------------------------
  // API 17 — PUT /stations/{id}/thresholds.
  // ----------------------------------------------------------------------------

  /**
   * Replace the station's threshold tiers and re-trigger risk computation.
   * (Replace-current strategy; the schema also supports versioning by
   * effective_from if append-only history is needed later.)
   */
  async setThresholds(
    id: number,
    dto: SetThresholdsDto,
  ): Promise<FloodThreshold[]> {
    await this.assertExists(id);
    this.assertDistinctLevels(dto);

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(FloodThreshold, { stationId: id });
      if (dto.thresholds.length > 0) {
        await manager.insert(
          FloodThreshold,
          dto.thresholds.map((t) => ({
            stationId: id,
            alertLevel: t.alertLevel,
            thresholdValue: t.thresholdValue,
            label: t.label ?? null,
          })),
        );
      }
    });

    this.emitThresholdChanged(id);
    return this.thresholdsRepo.find({
      where: { stationId: id },
      order: { alertLevel: 'ASC' },
    });
  }

  // ----------------------------------------------------------------------------
  // Internals.
  // ----------------------------------------------------------------------------

  /**
   * Set geom (SRID 4326) and auto-assign province_id by point-in-polygon.
   * Runs on the supplied transaction manager. lng/lat order matches
   * ST_MakePoint(x, y) = (longitude, latitude).
   */
  private applyGeometry(
    manager: { query: (sql: string, params: unknown[]) => Promise<unknown> },
    stationId: number,
    longitude: number,
    latitude: number,
  ): Promise<unknown> {
    return manager.query(
      `UPDATE stations
          SET geom = ST_SetSRID(ST_MakePoint($1, $2), 4326),
              province_id = (
                SELECT p.id
                  FROM provinces p
                 WHERE p.boundary IS NOT NULL
                   AND ST_Contains(p.boundary, ST_SetSRID(ST_MakePoint($1, $2), 4326))
                 LIMIT 1
              )
        WHERE id = $3`,
      [longitude, latitude, stationId],
    );
  }

  /**
   * Ensure the station has a province. applyGeometry already tried the spatial
   * fast-path (ST_Contains over existing boundaries); only when that left
   * province_id NULL do we pay for a reverse-geocode that resolves — and if
   * needed creates — the province. Runs outside any transaction.
   */
  private async ensureProvince(
    stationId: number,
    longitude: number,
    latitude: number,
  ): Promise<void> {
    const rows = await this.dataSource.query<{ province_id: number | null }[]>(
      `SELECT province_id FROM stations WHERE id = $1`,
      [stationId],
    );
    if (rows[0]?.province_id != null) return;

    const provinceId = await this.provinceResolver.resolveProvinceId(
      latitude,
      longitude,
    );
    if (provinceId != null) {
      await this.dataSource.query(
        `UPDATE stations SET province_id = $1 WHERE id = $2`,
        [provinceId, stationId],
      );
    }
  }

  /** station_code is UNIQUE across ALL rows, including soft-deleted ones. */
  private async assertCodeAvailable(stationCode: string): Promise<void> {
    const clash = await this.stationsRepo.exists({ where: { stationCode } });
    if (clash) {
      throw new ConflictException(
        `Station code "${stationCode}" is already in use`,
      );
    }
  }

  private async assertExists(id: number): Promise<void> {
    const exists = await this.stationsRepo.exists({
      where: { id, isDeleted: false },
    });
    if (!exists) {
      throw new NotFoundException(`Station ${id} not found`);
    }
  }

  private assertDistinctLevels(dto: SetThresholdsDto): void {
    const levels = dto.thresholds.map((t) => t.alertLevel);
    if (new Set(levels).size !== levels.length) {
      throw new BadRequestException('Duplicate alert_level in thresholds');
    }
  }

  /**
   * Event-driven hook (design): a threshold change publishes onto the internal
   * Redis event bus. The Risk Engine (future) subscribes, recomputes, and emits
   * a RISK_DELTA the gateway forwards to clients. Fire-and-forget: a publish
   * failure must not fail the station mutation that triggered it.
   */
  private emitThresholdChanged(stationId: number): void {
    void this.eventBus
      .publish(EVENT_CHANNELS.THRESHOLD_CHANGED, { stationId })
      .catch((err) =>
        this.logger.error(
          `failed to publish threshold-changed for station=${stationId}: ${
            (err as Error).message
          }`,
        ),
      );
  }
}
