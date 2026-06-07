import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from '../common/config';
import { AuthUser } from '../auth/auth.types';

// Wraps the Supabase client. Used only for Storage of original files.
// (All relational + vector data goes through DatabaseService / pg.)
@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private client: SupabaseClient;

  onModuleInit(): void {
    if (!config.supabase.url || !config.supabase.serviceRoleKey) {
      this.logger.warn(
        'Supabase credentials are not set. File storage will fail until configured.',
      );
    }
    this.client = createClient(
      config.supabase.url,
      config.supabase.serviceRoleKey,
      { auth: { persistSession: false } },
    );
  }

  // Upload an original file. Returns the storage path used as the object key.
  async uploadFile(
    conversationId: string,
    documentId: string,
    filename: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const safeName = filename.replace(/[^\w.\-]+/g, '_');
    const path = `${conversationId}/${documentId}/${safeName}`;
    const { error } = await this.client.storage
      .from(config.supabase.bucket)
      .upload(path, buffer, { contentType, upsert: true });
    if (error) {
      throw new Error(`Supabase storage upload failed: ${error.message}`);
    }
    return path;
  }

  // Signed URL for inspecting an original file (used by the source panel / future preview).
  async createSignedUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
    const { data, error } = await this.client.storage
      .from(config.supabase.bucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error) {
      this.logger.error(`Signed URL failed for ${path}: ${error.message}`);
      return null;
    }
    return data.signedUrl;
  }

  async deleteFile(path: string): Promise<void> {
    const { error } = await this.client.storage
      .from(config.supabase.bucket)
      .remove([path]);
    if (error) {
      throw new Error(`Supabase storage delete failed: ${error.message}`);
    }
  }

  async getUserFromToken(token: string): Promise<AuthUser> {
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data.user) {
      throw new Error(error?.message || 'Invalid Supabase access token.');
    }
    return {
      id: data.user.id,
      email: data.user.email ?? null,
    };
  }
}
