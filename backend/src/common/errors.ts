import { HttpException, HttpStatus } from '@nestjs/common';

// Domain errors carry user-facing messages that mirror the PRD copy (§22).
// They map to clean HTTP responses without leaking internals.

export class AppError extends HttpException {
  constructor(message: string, status: HttpStatus = HttpStatus.BAD_REQUEST) {
    super({ message, statusCode: status }, status);
  }
}

export const UserMessages = {
  unsupportedFileType:
    'Unsupported file type. Please upload PDF, DOCX, or XLSX files.',
  fileTooLarge:
    'This file is too large for the current demo. Please upload a smaller document.',
  tooManyFiles:
    'You have reached the maximum number of documents for this demo conversation. Please start a new conversation.',
  chunkBudgetExceeded:
    'This conversation has reached the demo indexing limit. Please start a new conversation to add more documents.',
  extractionFailed:
    'The file was uploaded but text extraction failed. Please try another document.',
  embeddingFailed: 'The document could not be indexed. Please retry.',
  aiTimedOut:
    'The AI service took too long to respond. Please try again shortly.',
  documentsProcessing:
    'Your documents are still processing. Please wait until indexing is complete.',
  llmFailed:
    'The assistant could not generate a response right now. Please try again.',
  llmTruncated:
    'The assistant response was too long to complete safely. Please ask a narrower question.',
  llmBlocked:
    'The assistant could not return a response for this request. Please refine your question.',
  rateLimited:
    'The demo AI quota has been temporarily reached. Please try again shortly.',
  noDocuments:
    'No approved documents have been uploaded yet. Please attach one or more documents before asking document-based questions or generating an executive summary.',
  insufficientEvidence:
    'I could not find enough evidence in the uploaded approved documents to answer this confidently. Please upload a relevant source document or refine your question.',
  liveData:
    'I cannot verify live market information from the current uploaded documents. The initial scope only supports document-grounded analysis. External web research can be added as a future mode.',
  webResearchDisabled:
    'Web research is temporarily disabled while the AI provider migration is completed. Please use uploaded documents for now.',
  conversationNotFound: 'Conversation not found.',
} as const;

export class UnsupportedFileTypeError extends AppError {
  constructor() {
    super(UserMessages.unsupportedFileType, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
  }
}

export class FileTooLargeError extends AppError {
  constructor() {
    super(UserMessages.fileTooLarge, HttpStatus.PAYLOAD_TOO_LARGE);
  }
}

export class TooManyFilesError extends AppError {
  constructor() {
    super(UserMessages.tooManyFiles, HttpStatus.CONFLICT);
  }
}

export class ConversationNotFoundError extends AppError {
  constructor() {
    super(UserMessages.conversationNotFound, HttpStatus.NOT_FOUND);
  }
}

export class LlmError extends AppError {
  constructor(message: string = UserMessages.llmFailed) {
    super(message, HttpStatus.BAD_GATEWAY);
  }
}
