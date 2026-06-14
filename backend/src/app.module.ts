import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { DatabaseModule } from './database/database.module';
import { SupabaseModule } from './supabase/supabase.module';
import { ConversationsModule } from './conversations/conversations.module';
import { DocumentsModule } from './documents/documents.module';
import { MessagesModule } from './messages/messages.module';
import { DecksModule } from './decks/decks.module';
import { PreferencesModule } from './preferences/preferences.module';
import { SpeechModule } from './speech/speech.module';

@Module({
  imports: [
    // Global infrastructure
    DatabaseModule,
    SupabaseModule,
    // Feature modules
    ConversationsModule,
    DocumentsModule,
    MessagesModule,
    DecksModule,
    PreferencesModule,
    SpeechModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
