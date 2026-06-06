import { Controller, Get } from '@nestjs/common';

// Lightweight health endpoint for Render / uptime checks (GET /api/health).
@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok', service: 'executive-intelligence-assistant' };
  }
}
