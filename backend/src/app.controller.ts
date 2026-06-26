import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from './modules/auth/decorators/public.decorator';

@Controller()
export class AppController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Public()
  @Get('health')
  async health() {
    // Confirms the app is up and the DB connection is alive.
    await this.dataSource.query('SELECT 1');
    return { status: 'ok', db: this.dataSource.isInitialized ? 'connected' : 'down' };
  }
}
