import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Province } from './entities/province.entity';

@Injectable()
export class ProvincesService {
  constructor(
    @InjectRepository(Province)
    private readonly provincesRepo: Repository<Province>,
  ) {}

  /**
   * Reference list of provinces for filters/dropdowns. boundary/centroid are
   * `select: false` on the entity, so this returns only {id, code, name} — no
   * heavy geometry on the wire.
   */
  findAll(): Promise<Province[]> {
    return this.provincesRepo.find({ order: { name: 'ASC' } });
  }
}
