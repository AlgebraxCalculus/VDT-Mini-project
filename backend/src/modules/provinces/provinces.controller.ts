import { Controller, Get } from '@nestjs/common';
import { ProvincesService } from './provinces.service';

/**
 * Province reference data. Read-only and open to any authenticated user
 * (Viewer+) — used by the station list province filter and, later, event scope
 * assignment. Auth is enforced globally by JwtAuthGuard.
 */
@Controller('provinces')
export class ProvincesController {
  constructor(private readonly provincesService: ProvincesService) {}

  /** GET /provinces — [{ id, code, name }] sorted by name. */
  @Get()
  findAll() {
    return this.provincesService.findAll();
  }
}
