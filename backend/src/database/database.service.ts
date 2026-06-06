import {
  InternalServerErrorException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { config } from '../common/config';

// Thin wrapper around a single pg connection pool.
// All SQL (including pgvector similarity search) goes through here.
@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: Pool;

  onModuleInit(): void {
    if (!config.databaseUrl) {
      this.logger.warn(
        'DATABASE_URL is not set. Database operations will fail until it is configured.',
      );
    }
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      // Supabase requires SSL; the pooler cert is not in the local trust store.
      ssl: config.databaseUrl.includes('localhost')
        ? false
        : { rejectUnauthorized: false },
      max: 10,
    });
    this.pool.on('error', (err) =>
      this.logger.error(`Idle pg client error: ${err.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }

  async query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, params as any[]);
  }

  // Convenience: return rows only.
  async rows<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.query<T>(text, params);
    return result.rows;
  }

  // Convenience: return the first row or null.
  async one<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] ?? null;
  }

  async oneOrThrow<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: unknown[] = [],
    message = 'Database query returned no rows.',
  ): Promise<T> {
    const result = await this.query<T>(text, params);
    return DatabaseService.requireRow(result, message);
  }

  static requireRow<T extends QueryResultRow = QueryResultRow>(
    result: QueryResult<T>,
    message = 'Database query returned no rows.',
  ): T {
    const row = result.rows[0];
    if (!row) throw new InternalServerErrorException(message);
    return row;
  }

  // Run fn inside a single transaction on one dedicated client.
  // Used to make the count+insert chunk-budget check atomic.
  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (err) {
      await client.query('rollback');
      throw err;
    } finally {
      client.release();
    }
  }

  // pgvector expects the literal form '[0.1,0.2,...]'.
  static toVectorLiteral(values: number[]): string {
    return `[${values.join(',')}]`;
  }
}
