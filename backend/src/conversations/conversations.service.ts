import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { ConversationNotFoundError } from '../common/errors';
import { Conversation, DocumentRecord, Message } from '../common/types';

@Injectable()
export class ConversationsService {
  constructor(private readonly db: DatabaseService) {}

  async create(): Promise<Conversation> {
    return this.db.oneOrThrow<Conversation>(
      `insert into conversations (title) values (null) returning *`,
      [],
      'Conversation insert returned no row.',
    );
  }

  async get(id: string): Promise<Conversation> {
    const row = await this.db.one<Conversation>(
      `select * from conversations where id = $1`,
      [id],
    );
    if (!row) throw new ConversationNotFoundError();
    return row;
  }

  // Throws if the conversation does not exist (used to guard nested routes).
  async ensureExists(id: string): Promise<void> {
    const row = await this.db.one(
      `select 1 from conversations where id = $1`,
      [id],
    );
    if (!row) throw new ConversationNotFoundError();
  }

  async listRecent(limit = 20): Promise<Conversation[]> {
    return this.db.rows<Conversation>(
      `select * from conversations order by updated_at desc limit $1`,
      [limit],
    );
  }

  // Full conversation payload for GET /conversations/:id (PRD §15.3).
  async getFull(id: string): Promise<{
    conversation: Conversation;
    messages: Message[];
    documents: DocumentRecord[];
  }> {
    const conversation = await this.get(id);
    const [messages, documents] = await Promise.all([
      this.db.rows<Message>(
        `select * from messages where conversation_id = $1 order by created_at asc`,
        [id],
      ),
      this.db.rows<DocumentRecord>(
        `select * from documents where conversation_id = $1 order by created_at asc`,
        [id],
      ),
    ]);
    return { conversation, messages, documents };
  }

  // Bump updated_at; set a title from the first user message if still empty.
  async touch(id: string, candidateTitle?: string): Promise<void> {
    if (candidateTitle) {
      const title = candidateTitle.trim().slice(0, 80);
      await this.db.query(
        `update conversations
            set updated_at = now(),
                title = coalesce(title, $2)
          where id = $1`,
        [id, title],
      );
    } else {
      await this.db.query(
        `update conversations set updated_at = now() where id = $1`,
        [id],
      );
    }
  }
}
