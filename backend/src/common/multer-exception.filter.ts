import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';
import { UserMessages } from './errors';

// Multer aborts oversized/invalid uploads at the interceptor layer, before the
// route handler runs. Without this filter those surface as a generic 500.
// Here we translate them into the PRD's friendly, correctly-statused responses.
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(MulterExceptionFilter.name);

  catch(err: MulterError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const isSize = err.code === 'LIMIT_FILE_SIZE';
    const status = isSize
      ? HttpStatus.PAYLOAD_TOO_LARGE
      : HttpStatus.BAD_REQUEST;
    const message = isSize
      ? UserMessages.fileTooLarge
      : 'File upload failed. Please try again with a valid file.';
    this.logger.warn(`Multer error ${err.code}: ${err.message}`);
    res.status(status).json({ statusCode: status, message });
  }
}
