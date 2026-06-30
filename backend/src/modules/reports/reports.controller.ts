import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  StreamableFile,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/types/jwt-payload.interface';
import { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';

/**
 * Group H — report export (APIs 40–43). Read-only over the pre-computed data, so
 * any authenticated user (Viewer+) may export; auth is enforced globally by
 * JwtAuthGuard. The render runs async (BullMQ) and the client polls then
 * downloads — same enqueue/poll contract as the station import.
 */
@Controller('reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  /** API 40 — POST /reports: request a render → 202 { jobId, kind, format }. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @Body() dto: CreateReportDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reportsService.enqueueReport(dto, user.id);
  }

  /** API 41 — GET /reports: recent report jobs (history), newest first. */
  @Get()
  list() {
    return this.reportsService.listRecent();
  }

  /** API 42 — GET /reports/{jobId}: job state + progress + metadata. */
  @Get(':jobId')
  getStatus(@Param('jobId') jobId: string) {
    return this.reportsService.getStatus(jobId);
  }

  /** API 43 — GET /reports/{jobId}/download: stream the rendered file. */
  @Get(':jobId/download')
  async download(@Param('jobId') jobId: string): Promise<StreamableFile> {
    const { buffer, meta } = await this.reportsService.getArtifact(jobId);
    return new StreamableFile(buffer, {
      type: meta.contentType,
      disposition: `attachment; filename="${meta.filename}"`,
      length: buffer.length,
    });
  }
}
