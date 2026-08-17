import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check() {
    let db: 'ok' | 'error' = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'error';
    }

    if (db === 'error') {
      throw new ServiceUnavailableException({
        status: 'error',
        db,
        uptimeSeconds: Math.floor(process.uptime()),
      });
    }

    return {
      status: 'ok',
      db,
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
