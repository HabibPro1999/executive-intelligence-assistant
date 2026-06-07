import { Controller, Delete, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.types';
import { SupabaseJwtGuard } from '../auth/supabase-jwt.guard';
import { PreferencesService } from './preferences.service';

@Controller('me/preferences')
@UseGuards(SupabaseJwtGuard)
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  @Get()
  async get(@CurrentUser() user: AuthUser) {
    return { profile: await this.preferences.getProfile(user.id) };
  }

  @Delete()
  async reset(@CurrentUser() user: AuthUser) {
    await this.preferences.clearProfile(user.id);
    return { profile: null };
  }
}
