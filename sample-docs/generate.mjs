// Generates fictional demo documents for the assistant.
// Run: npm install && node generate.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx';

const OUT = path.dirname(fileURLToPath(import.meta.url));

for (const file of fs.readdirSync(OUT)) {
  if (/\.(pdf|docx|xlsx)$/i.test(file)) fs.rmSync(path.join(OUT, file));
}

function writePdf(filename, sections) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: 'A4', compress: false });
    const stream = fs.createWriteStream(path.join(OUT, filename));
    doc.pipe(stream);
    sections.forEach((section, index) => {
      if (index > 0 && section.newPage) doc.addPage();
      if (section.title) {
        doc.font('Helvetica-Bold').fontSize(section.h1 ? 18 : 13).text(section.title);
        doc.moveDown(0.4);
      }
      if (section.body) {
        doc.font('Helvetica').fontSize(11).text(section.body, { lineGap: 2 });
        doc.moveDown(0.8);
      }
      if (section.bullets) {
        doc.font('Helvetica').fontSize(11).list(section.bullets, {
          bulletRadius: 2,
          lineGap: 2,
        });
        doc.moveDown(0.8);
      }
    });
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

function writeXlsx(filename, sheets) {
  const workbook = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  XLSX.writeFile(workbook, path.join(OUT, filename));
}

async function writeDocx(filename, blocks) {
  const children = blocks.map((block) => {
    if (block.h1) return new Paragraph({ text: block.h1, heading: HeadingLevel.HEADING_1 });
    if (block.h2) return new Paragraph({ text: block.h2, heading: HeadingLevel.HEADING_2 });
    if (block.li) return new Paragraph({ text: block.li, bullet: { level: 0 } });
    return new Paragraph({
      children: [new TextRun(block.p || '')],
      spacing: { after: 160 },
    });
  });
  const doc = new Document({ sections: [{ children }] });
  fs.writeFileSync(path.join(OUT, filename), await Packer.toBuffer(doc));
}

await writePdf('Northstar Ledger Strategy 2027.pdf', [
  {
    h1: true,
    title: 'Northstar Ledger Strategy 2027',
    body:
      'Northstar Ledger is a fictional treasury-infrastructure company serving mid-market exporters. The 2027 strategy focuses on faster settlement, clearer FX risk controls, and partner-led distribution.',
  },
  {
    title: 'Strategic Priorities',
    bullets: [
      'Launch instant multi-currency settlement in three trade corridors by Q3.',
      'Reduce manual reconciliation work by 35% through ledger automation.',
      'Bundle FX risk alerts into the premium treasury workspace.',
      'Use accounting-platform partnerships as the primary acquisition channel.',
    ],
  },
  {
    title: 'Leadership Risks',
    bullets: [
      'Compliance review latency may slow onboarding for larger exporters.',
      'Partner concentration could raise acquisition cost if one platform underperforms.',
      'Treasury users need clearer exception handling before expanding wallet limits.',
    ],
  },
]);

await writePdf('BlueHarbor Payments Expansion Memo.pdf', [
  {
    h1: true,
    title: 'BlueHarbor Payments Expansion Memo',
    body:
      'BlueHarbor Payments is a fictional embedded-payments provider for specialty retailers. The company is evaluating expansion from card acceptance into invoice financing and merchant cash-flow analytics.',
  },
  {
    title: 'Market Signals',
    bullets: [
      'Retailers with seasonal inventory cycles requested short-duration working-capital offers.',
      'Merchants using analytics dashboards showed 18% higher monthly retention.',
      'Support tickets show confusion around settlement timing and chargeback reserves.',
    ],
  },
  {
    title: 'Recommended Actions',
    bullets: [
      'Pilot invoice financing with a capped merchant cohort before broad rollout.',
      'Expose reserve balances and expected release dates inside the dashboard.',
      'Package analytics as a retention feature rather than a standalone upsell.',
    ],
  },
]);

await writeDocx('Meridian Vault Risk Brief.docx', [
  { h1: 'Meridian Vault Risk Brief' },
  {
    p:
      'Meridian Vault is a fictional digital custody platform for private funds. The risk review highlights operational resilience, client reporting, and approval controls.',
  },
  { h2: 'Observed Strengths' },
  { li: 'Dual-control release workflows reduced manual approval exceptions.' },
  { li: 'Client reporting timelines improved after the custody events dashboard launch.' },
  { li: 'Incident drills showed faster coordination between operations and compliance teams.' },
  { h2: 'Open Risks' },
  { li: 'Some institutional clients still require custom monthly reporting packages.' },
  { li: 'Backup signer rotations are not consistently documented for all funds.' },
  { li: 'Expansion into tokenized fund servicing requires clearer escalation runbooks.' },
]);

await writeDocx('QamarPay Product Council Notes.docx', [
  { h1: 'QamarPay Product Council Notes' },
  {
    p:
      'QamarPay is a fictional cross-border wallet company for freelancers and small agencies. Product council notes focus on onboarding, localized support, and premium account adoption.',
  },
  { h2: 'Customer Signals' },
  { li: 'Arabic-speaking users prefer concise answers with direct operational recommendations.' },
  { li: 'Freelancers value predictable withdrawal timing more than a larger list of payout methods.' },
  { li: 'Premium adoption rises when fee savings are shown before checkout.' },
  { h2: 'Next Decisions' },
  { li: 'Prioritize bilingual onboarding for the next launch cohort.' },
  { li: 'Add a payout calendar and proactive delay alerts.' },
  { li: 'Test a premium-savings calculator with high-volume users.' },
]);

writeXlsx('Fictional Fintech KPI Dashboard.xlsx', [
  {
    name: 'Northstar Ledger',
    rows: [
      ['Metric', 'Q1', 'Q2', 'Q3 Target', 'Status'],
      ['Active exporters', 420, 536, 650, 'On track'],
      ['Reconciliation automation rate', '22%', '28%', '35%', 'Needs focus'],
      ['Average onboarding days', 11, 9, 7, 'Improving'],
      ['Premium treasury adoption', '14%', '19%', '25%', 'On track'],
    ],
  },
  {
    name: 'BlueHarbor Payments',
    rows: [
      ['Metric', 'Q1', 'Q2', 'Q3 Target', 'Status'],
      ['Active merchants', 1180, 1325, 1500, 'On track'],
      ['Monthly retention', '88%', '91%', '92%', 'Near target'],
      ['Reserve-related tickets', 240, 198, 140, 'Needs focus'],
      ['Analytics dashboard adoption', '31%', '44%', '55%', 'On track'],
    ],
  },
  {
    name: 'QamarPay',
    rows: [
      ['Metric', 'Q1', 'Q2', 'Q3 Target', 'Status'],
      ['Active wallets', 9400, 11250, 13500, 'On track'],
      ['Arabic onboarding completion', '62%', '71%', '80%', 'Needs focus'],
      ['Payout delay contacts', 530, 460, 320, 'Improving'],
      ['Premium account adoption', '8%', '11%', '15%', 'On track'],
    ],
  },
]);

console.log('Generated fictional fintech demo documents.');
