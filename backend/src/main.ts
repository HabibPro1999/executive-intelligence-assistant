import 'dotenv/config'; // must run before any module reads process.env
import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { config } from './common/config';
import { MulterExceptionFilter } from './common/multer-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false });

  app.enableCors({
    // Explicit allowlist only — fail closed (deny) rather than reflect any
    // origin if the list is somehow empty.
    origin: config.corsOrigins.length ? config.corsOrigins : false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: false,
  });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new MulterExceptionFilter());

  await app.listen(config.port, '0.0.0.0');
  new Logger('Bootstrap').log(
    `Executive Intelligence Assistant API listening on :${config.port}`,
  );
}

bootstrap();
