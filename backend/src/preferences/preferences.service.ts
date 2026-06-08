import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { GenerationService } from '../generation/generation.service';
import { UserPreferenceProfile } from '../common/types';

@Injectable()
export class PreferencesService {
  private readonly logger = new Logger(PreferencesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly embeddings: EmbeddingsService,
    private readonly generation: GenerationService,
  ) {}

  async getProfile(userId: string): Promise<UserPreferenceProfile | null> {
    return this.db.one<UserPreferenceProfile>(
      `select user_id, content, metadata, created_at, updated_at
         from user_preference_profiles
        where user_id = $1`,
      [userId],
    );
  }

  async retrieveContext(userId: string, query: string): Promise<string | null> {
    const profile = await this.getProfile(userId);
    if (!profile) return null;

    try {
      const vector = DatabaseService.toVectorLiteral(
        await this.embeddings.embedQuery(query),
      );
      const row = await this.db.one<{ content: string }>(
        `select content
           from user_preference_profiles
          where user_id = $1 and embedding is not null
          order by embedding <=> $2::vector
          limit 1`,
        [userId, vector],
      );
      return row?.content ?? profile.content;
    } catch (err: any) {
      this.logger.warn(`Preference retrieval fallback: ${err?.message}`);
      return profile.content;
    }
  }

  async upsertProfile(
    userId: string,
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const cleaned = content.trim();
    if (!cleaned) return;
    let embedding: string | null = null;
    try {
      embedding = DatabaseService.toVectorLiteral(
        await this.embeddings.embedDocuments([cleaned]).then((rows) => rows[0]),
      );
    } catch (err: any) {
      this.logger.warn(`Preference embedding skipped: ${err?.message}`);
    }
    await this.db.query(
      `insert into user_preference_profiles (user_id, content, embedding, metadata)
       values ($1, $2, $3::vector, $4::jsonb)
       on conflict (user_id) do update
          set content = excluded.content,
              embedding = excluded.embedding,
              metadata = excluded.metadata,
              updated_at = now()`,
      [userId, cleaned, embedding, JSON.stringify(metadata)],
    );
  }

  async saveExplicitPreference(input: {
    userId: string;
    preference: string;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const preference = input.preference.replace(/\s+/g, ' ').trim();
    if (!preference) return '';
    const current = await this.getProfile(input.userId);
    const content = this.mergePreference(current?.content, preference);
    await this.upsertProfile(input.userId, content, {
      ...(current?.metadata ?? {}),
      ...(input.metadata ?? {}),
      learnedBy: 'explicit_user_preference',
    });
    return content;
  }

  async clearProfile(userId: string): Promise<void> {
    await this.db.query(`delete from user_preference_profiles where user_id = $1`, [
      userId,
    ]);
  }

  async learnFromTurn(input: {
    userId: string;
    question: string;
    answer: string;
    mode: string;
  }): Promise<void> {
    const current = await this.getProfile(input.userId);
    const next = await this.generation.inferPreferenceProfile({
      currentProfile: current?.content ?? '',
      question: input.question,
      answer: input.answer,
      mode: input.mode,
    });
    if (!next) return;
    await this.upsertProfile(input.userId, next, {
      learnedBy: 'chat_inference',
      lastMode: input.mode,
    });
  }

  private mergePreference(current: string | undefined, preference: string): string {
    const lines = (current ?? '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const key = preference.toLowerCase();
    if (!lines.some((line) => line.toLowerCase() === key)) {
      lines.push(preference);
    }
    return lines.slice(-8).join('\n');
  }
}
