// Generates synthetic (but realistic) demo documents for the assistant.
// Run: npm install && node generate.mjs
// Output files match PRD §24 and feed the demo script in §25.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import * as XLSX from 'xlsx';
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx';

const OUT = path.dirname(fileURLToPath(import.meta.url));

// ---------- helpers ---------------------------------------------------------
function writePdf(filename, sections) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 56, size: 'A4' });
    const stream = fs.createWriteStream(path.join(OUT, filename));
    doc.pipe(stream);
    sections.forEach((sec, i) => {
      if (i > 0 && sec.newPage) doc.addPage();
      if (sec.title) {
        doc.font('Helvetica-Bold').fontSize(sec.h1 ? 18 : 13).text(sec.title);
        doc.moveDown(0.4);
      }
      if (sec.body) {
        doc.font('Helvetica').fontSize(11).text(sec.body, { lineGap: 2 });
        doc.moveDown(0.8);
      }
      if (sec.bullets) {
        doc.font('Helvetica').fontSize(11).list(sec.bullets, { bulletRadius: 2, lineGap: 2 });
        doc.moveDown(0.8);
      }
    });
    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

function writeXlsx(filename, sheets) {
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, path.join(OUT, filename));
}

async function writeDocx(filename, blocks) {
  const children = [];
  for (const b of blocks) {
    if (b.h1) children.push(new Paragraph({ text: b.h1, heading: HeadingLevel.HEADING_1 }));
    else if (b.h2) children.push(new Paragraph({ text: b.h2, heading: HeadingLevel.HEADING_2 }));
    else if (b.p) children.push(new Paragraph({ children: [new TextRun(b.p)], spacing: { after: 160 } }));
    else if (b.li) children.push(new Paragraph({ text: b.li, bullet: { level: 0 } }));
  }
  const doc = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(OUT, filename), buf);
}

// ---------- 1. ADGM Strategic Priorities 2026.pdf ---------------------------
await writePdf('ADGM Strategic Priorities 2026.pdf', [
  {
    h1: true,
    title: 'ADGM Strategic Priorities 2026',
    body: 'Abu Dhabi Global Market (ADGM) sets out its strategic priorities for 2026, focused on consolidating its position as a leading international financial centre in the MENA region. This document summarises the priority pillars, target outcomes, and associated risks for leadership review.',
  },
  {
    title: '1. Strategic Priority Pillars',
    bullets: [
      'Digital Assets & Tokenisation: expand the regulated digital asset framework and attract licensed virtual asset service providers.',
      'Sustainable Finance: grow green and transition-finance assets under administration and launch a regional climate disclosure standard.',
      'Capital Markets Deepening: increase listings, private credit funds, and family-office assets domiciled in ADGM.',
      'Talent & Skills: build a fintech and compliance talent pipeline through partnerships with universities and global firms.',
      'Regulatory Excellence: maintain principles-based, internationally aligned regulation to preserve investor confidence.',
    ],
  },
  {
    newPage: true,
    title: '2. Target Outcomes for 2026',
    bullets: [
      'Increase the number of registered entities by 30% year over year.',
      'Reach USD 150 billion in assets under management across funds domiciled in ADGM.',
      'License at least 25 new digital asset and fintech firms.',
      'Double sustainable-finance assets under administration versus 2024 baseline.',
    ],
  },
  {
    title: '3. Digital Assets Focus',
    body: 'ADGM was an early mover in regulating digital assets and intends to extend this lead. Priorities include tokenisation of real-world assets, a clear stablecoin framework, and custody standards aligned with international best practice. Demand is driven by institutional interest in tokenised funds and regional sovereign wealth allocation to digital infrastructure.',
  },
  {
    title: '4. Key Risks',
    bullets: [
      'Regulatory arbitrage and competition from DIFC, Singapore, and emerging hubs.',
      'Global macro volatility reducing fund inflows.',
      'Talent shortage in specialised compliance and blockchain engineering roles.',
      'Reputational risk if digital asset firms fail without adequate consumer safeguards.',
    ],
  },
  {
    title: '5. Recommended Leadership Actions',
    bullets: [
      'Accelerate the tokenisation regulatory sandbox and publish guidance by Q2 2026.',
      'Establish a dedicated talent fund and regional fintech academy.',
      'Strengthen cross-border MoUs with comparable financial centres.',
    ],
  },
]);

// ---------- 2. Market Opportunity Analysis - Digital Assets.pdf -------------
await writePdf('Market Opportunity Analysis - Digital Assets.pdf', [
  {
    h1: true,
    title: 'Market Opportunity Analysis: Regional Digital Assets',
    body: 'This analysis assesses the digital asset market opportunity for financial centres in the Gulf region, with emphasis on tokenisation and institutional custody. Figures are indicative and intended for strategic planning.',
  },
  {
    title: 'Opportunity Summary',
    body: 'The regional digital asset market is projected to grow from an estimated USD 12 billion in addressable assets in 2024 to USD 45 billion by 2028, a compound annual growth rate of roughly 39%. Tokenised real-world assets and regulated stablecoin settlement represent the largest near-term opportunities.',
  },
  {
    title: 'Market Signals',
    bullets: [
      'Sovereign wealth funds are allocating to digital infrastructure and tokenisation platforms.',
      'Several global custodians have announced regional licences in 2025.',
      'Institutional demand favours regulated venues over offshore exchanges.',
    ],
  },
  {
    newPage: true,
    title: 'Demand Drivers',
    bullets: [
      'Efficiency gains from instant settlement and reduced counterparty risk.',
      'Fractional ownership of real estate, private credit, and infrastructure.',
      'Regional push toward economic diversification away from hydrocarbons.',
    ],
  },
  {
    title: 'Competitive Context',
    body: 'ADGM and DIFC lead regional regulatory clarity. Singapore remains the global benchmark for fintech regulation and talent depth. London retains scale in capital markets but faces post-Brexit competitiveness questions. The window for regional leadership in tokenisation is approximately 18 to 24 months before frameworks converge.',
  },
  {
    title: 'Risks and Barriers',
    bullets: [
      'Fragmented cross-border regulation increasing compliance cost.',
      'Custody and cyber-security risk for institutional adoption.',
      'Volatility undermining confidence in tokenised products.',
    ],
  },
  {
    title: 'Recommended Next Steps',
    bullets: [
      'Prioritise tokenisation of private credit and real estate as flagship use cases.',
      'Partner with one global custodian to anchor institutional confidence.',
      'Publish a regional interoperability standard within 12 months.',
    ],
  },
]);

// ---------- 3. Global Financial Centers Benchmark.xlsx ----------------------
writeXlsx('Global Financial Centers Benchmark.xlsx', [
  {
    name: 'Benchmark',
    rows: [
      ['Financial Center', 'Region', 'Overall Rank', 'Regulatory Score', 'Talent Score', 'Fintech Score', 'AUM (USD bn)'],
      ['Singapore', 'Asia', 1, 92, 90, 94, 4200],
      ['London', 'Europe', 2, 88, 91, 86, 9800],
      ['DIFC', 'Middle East', 3, 85, 80, 83, 700],
      ['ADGM', 'Middle East', 4, 84, 76, 88, 120],
      ['Hong Kong', 'Asia', 5, 86, 84, 80, 4100],
    ],
  },
  {
    name: 'Digital Assets',
    rows: [
      ['Financial Center', 'Digital Asset Framework', 'Licensed VASPs', 'Stablecoin Rules', 'Maturity (1-5)'],
      ['ADGM', 'Comprehensive', 22, 'Yes', 5],
      ['DIFC', 'Comprehensive', 18, 'Yes', 4],
      ['Singapore', 'Comprehensive', 35, 'Yes', 5],
      ['London', 'Developing', 12, 'Partial', 3],
      ['Hong Kong', 'Comprehensive', 25, 'Yes', 4],
    ],
  },
]);

// ---------- 4. Performance Report Q2.xlsx -----------------------------------
writeXlsx('Performance Report Q2.xlsx', [
  {
    name: 'KPI Performance Q2',
    rows: [
      ['Department', 'KPI', 'Target', 'Actual', 'Variance', 'Commentary'],
      ['Market Development', 'New registered entities', 85, 73, -12, 'Underperformance due to delayed partnership pipeline.'],
      ['Digital Assets', 'New VASP licences', 8, 11, 3, 'Ahead of plan; strong institutional demand.'],
      ['Sustainable Finance', 'Green AUM growth %', 20, 14, -6, 'Slower than target; awaiting disclosure standard launch.'],
      ['Talent', 'Fintech roles filled', 40, 38, -2, 'On track; minor lag in compliance hires.'],
      ['Regulatory Affairs', 'Policy consultations closed', 6, 7, 1, 'Exceeded target; sandbox guidance accelerated.'],
      ['Capital Markets', 'New fund domiciliations', 30, 19, -11, 'Macro volatility reduced inflows; pipeline rebuilding.'],
    ],
  },
]);

// ---------- 5. Regulatory Trends Summary.docx -------------------------------
await writeDocx('Regulatory Trends Summary.docx', [
  { h1: 'Regulatory Trends Summary 2026' },
  { p: 'This summary outlines the key regulatory trends shaping international financial centres in 2026, intended to inform strategic planning and risk management for leadership.' },
  { h2: 'Digital Asset Regulation' },
  { p: 'Regulators are converging on comprehensive frameworks for virtual asset service providers, with growing emphasis on stablecoin reserves, custody standards, and consumer protection. Centres with early, principles-based regimes retain a competitive advantage, but the gap is narrowing as more jurisdictions publish guidance.' },
  { h2: 'Sustainable Finance Disclosure' },
  { p: 'Mandatory climate-related disclosure is becoming standard. A regional disclosure standard aligned with international frameworks is expected to launch in 2026, which will increase compliance obligations but improve cross-border comparability of green assets.' },
  { h2: 'Cross-Border Cooperation' },
  { p: 'Memoranda of understanding between financial centres are expanding to cover fintech sandboxes, supervisory information sharing, and talent mobility. This reduces regulatory arbitrage but raises coordination costs.' },
  { h2: 'Key Risks for Leadership' },
  { li: 'Compliance cost inflation from divergent cross-border rules.' },
  { li: 'Reputational exposure from digital asset firm failures.' },
  { li: 'Talent shortages in specialised compliance functions.' },
  { h2: 'Recommended Focus' },
  { p: 'Leadership should prioritise regulatory clarity on tokenisation, invest in compliance talent, and actively shape regional disclosure standards rather than adopt them reactively.' },
]);

console.log('Sample documents generated in', OUT);
