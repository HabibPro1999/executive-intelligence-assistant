import { Injectable, Logger } from '@nestjs/common';
import { ExtractionResult } from '../common/types';
import { SupportedFileType } from '../common/config';
import { extractPdf } from './pdf-extractor';
import { extractDocx } from './docx-extractor';
import { extractXlsx } from './xlsx-extractor';

// Dispatches extraction by file type and normalises into ExtractionResult.
@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);

  async extract(
    fileType: SupportedFileType,
    buffer: Buffer,
  ): Promise<ExtractionResult> {
    switch (fileType) {
      case 'pdf':
        return extractPdf(buffer);
      case 'docx':
        return extractDocx(buffer);
      case 'xlsx':
        return extractXlsx(buffer);
      default:
        throw new Error(`Unsupported file type for extraction: ${fileType}`);
    }
  }
}
