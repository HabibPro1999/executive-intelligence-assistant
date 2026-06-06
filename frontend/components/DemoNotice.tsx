import { ShieldAlert } from 'lucide-react';

// Demo confidentiality disclaimer (PRD §21.3).
export default function DemoNotice() {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        Demo environment: please do not upload confidential documents. Uploaded
        files are used only to answer questions within your current session.
      </span>
    </div>
  );
}
