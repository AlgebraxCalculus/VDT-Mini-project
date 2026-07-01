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

/** Station row + province + threshold tiers. */
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
    // Transactions + raw PostGIS statements (ST_MakePoint/ST_Contains).
    private readonly dataSource: DataSource,
    private readonly eventBus: EventBusService,
    // Reverse-geocodes (and auto-creates a province) when a coord lands outside
    // every existing province boundary.
    private readonly provinceResolver: ProvinceResolverService,
  ) {}

  // --- API 14 — POST /stations ---

  /**
   * Create a station, auto-assigning province by point-in-polygon. geom + province_id
   * are set in one raw statement after the insert so geom keeps SRID 4326 (a bare
   * GeoJSON insert can leave SRID 0 and break viewport queries) and province_id comes
   * only from ST_Contains (NULL if outside all boundaries). All in one transaction.
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

    // ST_Contains missed → geocode + auto-create a province. Outside the txn so
    // the network call doesn't hold a DB lock.
    await this.ensureProvince(stationId, dto.longitude, dto.latitude);

    // Thresholds feed the risk inputs → notify the Risk Engine.
    if (dto.thresholds?.length) this.emitThresholdChanged(stationId);

    return this.findOne(stationId);
  }

  // --- API 12 / 13 — read ---

  /** GET /stations — filter by province/risk/event + free text, paginated. */
  async findAll(query: QueryStationsDto): Promise<PaginatedStations> {
    const { provinceId, riskStatus, eventId, q, page, size } = query;

    const qb = this.stationsRepo
      .createQueryBuilder('station')
      // Province supplies the response name and backs the free-text search; its
      // heavy geometry stays out of the payload via `select: false` (as does geom).
      .leftJoinAndSelect('station.province', 'province')
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
      // Restrict to stations frozen into an event's scope.
      qb.innerJoin(
        'event_stations',
        'es',
        'es.station_id = station.id AND es.event_id = :eventId',
        { eventId },
      );
    }
    if (q) {
      // Search station name, province name, then code. ILIKE is case-insensitive
      // but accent-sensitive (diacritics must match).
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
   * GET /stations/viewport — stations inside the map BBOX. The ST_Contains over
   * ST_MakeEnvelope rides the GIST index's bbox pre-filter, staying fast at 10k+
   * stations. Province is joined for the popup; thresholds aren't. Risk-ordered
   * (DANGER→NORMAL) so the most important rows survive `limit` truncation.
   */
  async findInViewport(dto: ViewportStationsDto): Promise<Station[]> {
    const { minLng, minLat, maxLng, maxLat, riskStatus, limit } = dto;

    const qb = this.stationsRepo
      .createQueryBuilder('station')
      .leftJoinAndSelect('station.province', 'province')
      // Rank via a selected alias — passing this raw CASE to .orderBy() makes
      // TypeORM's alias resolver mis-parse "CASE station.risk_status" and throw.
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

  /** Attach threshold tiers in one batched query (avoids N+1); no tiers → []. */
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

  // --- API 15 — PUT /stations/{id} ---

  /**
   * Update mutable fields. If coords move, geom + province_id are recomputed via
   * the same raw ST_SetSRID statement as create() — never through entity save,
   * which would round-trip GeoJSON and risk dropping the SRID.
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

    if (latProvided && lngProvided) {
      await this.ensureProvince(id, dto.longitude!, dto.latitude!);
    }

    return this.findOne(id);
  }

  // --- API 16 — DELETE /stations/{id} (soft-delete) ---

  /** Soft-delete to preserve report history. */
  async remove(id: number): Promise<void> {
    await this.assertExists(id);
    await this.stationsRepo.update(id, {
      isDeleted: true,
      deletedAt: new Date(),
    });
  }

  // --- API 17 — PUT /stations/{id}/thresholds ---

  /** Replace the station's threshold tiers and re-trigger risk computation. */
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

  // --- Internals ---

  /**
   * Set geom (SRID 4326) and auto-assign province_id by point-in-polygon on the
   * supplied transaction manager. ST_MakePoint(x, y) = (longitude, latitude).
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
   * Ensure the station has a province. Only when applyGeometry's ST_Contains left
   * province_id NULL do we pay for a reverse-geocode that resolves (and creates if
   * needed) the province. Runs outside any transaction.
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
   * Publish a threshold change to the event bus for the Risk Engine. Fire-and-forget:
   * a publish failure must not fail the station mutation that triggered it.
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
