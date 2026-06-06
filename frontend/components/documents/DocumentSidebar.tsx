'use client';

import { useRef } from 'react';
import { FileText, FileSpreadsheet, FileType, Upload, Plus } from 'lucide-react';
import { DocumentRecord } from '@/types';
import DocumentStatusBadge from './DocumentStatusBadge';
import DemoNotice from '@/components/DemoNotice';

interface Props {
  documents: DocumentRecord[];
  onUpload: (files: FileList) => void;
  onNewConversation: () => void;
  uploading?: boolean;
}

function FileIcon({ type }: { type: string }) {
  if (type === 'xlsx') return <FileSpreadsheet className="h-4 w-4 text-emerald-600" />;
  if (type === 'docx') return <FileType className="h-4 w-4 text-blue-600" />;
  return <FileText className="h-4 w-4 text-rose-600" />;
}

export default function DocumentSidebar({
  documents,
  onUpload,
  onNewConversation,
  uploading,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-slate-200 bg-slate-50">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Documents</h2>
        <button
          onClick={onNewConversation}
          title="Start a new conversation"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-200 hover:text-slate-700"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {documents.length === 0 ? (
          <p className="px-1 py-6 text-center text-xs text-slate-400">
            No documents yet. Attach PDF, DOCX, or XLSX files to build the
            approved knowledge base.
          </p>
        ) : (
          documents.map((doc) => (
            <div
              key={doc.id}
              className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="flex items-start gap-2">
                <FileIcon type={doc.file_type} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ink" title={doc.filename}>
                    {doc.filename}
                  </p>
                  <div className="mt-1.5">
                    <DocumentStatusBadge status={doc.status} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-400">
                    {doc.page_count != null && `${doc.page_count} pages`}
                    {doc.sheet_count != null && `${doc.sheet_count} sheets`}
                  </p>
                  {doc.status === 'failed' && doc.error_message && (
                    <p className="mt-1 text-[11px] text-rose-600">
                      {doc.error_message}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2 border-t border-slate-200 p-3">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:border-brand hover:text-brand disabled:opacity-50"
        >
          <Upload className="h-4 w-4" />
          {uploading ? 'Uploading…' : 'Upload documents'}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.docx,.xlsx"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onUpload(e.target.files);
            e.target.value = '';
          }}
        />
        <DemoNotice />
      </div>
    </aside>
  );
}
