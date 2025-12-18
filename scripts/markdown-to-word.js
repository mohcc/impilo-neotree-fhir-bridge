import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType } from 'docx';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read the markdown file
const markdownPath = join(__dirname, '../docs/FHIR_RESOURCE_MAPPING.md');
const markdownContent = readFileSync(markdownPath, 'utf-8');

// Parse markdown and convert to docx elements
function parseMarkdown(md) {
  const lines = md.split('\n');
  const elements = [];
  let inCodeBlock = false;
  let codeBlockContent = [];
  let codeBlockLang = '';
  let inTable = false;
  let tableRows = [];
  let tableHeaders = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Handle code blocks
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        // End code block
        if (codeBlockContent.length > 0) {
          elements.push(
            new Paragraph({
              text: codeBlockContent.join('\n'),
              style: 'Code',
            })
          );
        }
        codeBlockContent = [];
        inCodeBlock = false;
        codeBlockLang = '';
      } else {
        // Start code block
        codeBlockLang = line.substring(3).trim();
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Handle horizontal rules
    if (trimmed === '---' || trimmed.match(/^[-*_]{3,}$/)) {
      elements.push(new Paragraph({ text: '' }));
      continue;
    }

    // Handle headers
    if (trimmed.startsWith('#')) {
      const level = trimmed.match(/^#+/)[0].length;
      const text = trimmed.substring(level).trim();
      
      if (text) {
        const headingLevel = level === 1 ? HeadingLevel.HEADING_1 :
                           level === 2 ? HeadingLevel.HEADING_2 :
                           level === 3 ? HeadingLevel.HEADING_3 :
                           level === 4 ? HeadingLevel.HEADING_4 :
                           HeadingLevel.HEADING_5;
        
        elements.push(
          new Paragraph({
            text: text,
            heading: headingLevel,
          })
        );
      }
      continue;
    }

    // Handle tables
    if (trimmed.startsWith('|')) {
      const cells = trimmed.split('|').map(c => c.trim()).filter(c => c);
      
      if (cells.length > 0) {
        // Check if it's a separator row (all dashes)
        if (cells.every(c => c.match(/^[-: ]+$/))) {
          inTable = true;
          continue;
        }

        if (!inTable) {
          // First row - headers
          tableHeaders = cells;
          inTable = true;
        } else {
          // Data row
          tableRows.push(cells);
        }
        continue;
      }
    } else {
      // End table if we were in one
      if (inTable && tableHeaders.length > 0) {
        const tableCells = [
          tableHeaders.map(h => new TableCell({ children: [new Paragraph(h)] })),
          ...tableRows.map(row => row.map(cell => new TableCell({ children: [new Paragraph(cell)] })))
        ];

        elements.push(
          new Table({
            rows: tableCells.map(cells => new TableRow({ children: cells })),
            width: { size: 100, type: WidthType.PERCENTAGE },
          })
        );
        tableHeaders = [];
        tableRows = [];
        inTable = false;
      }
    }

    // Handle list items
    if (trimmed.match(/^[-*]\s+/)) {
      const text = trimmed.substring(2).trim();
      elements.push(
        new Paragraph({
          text: text,
          bullet: { level: 0 },
        })
      );
      continue;
    }

    // Handle numbered lists
    if (trimmed.match(/^\d+\.\s+/)) {
      const text = trimmed.replace(/^\d+\.\s+/, '');
      elements.push(
        new Paragraph({
          text: text,
          numbering: { reference: 'default-numbering', level: 0 },
        })
      );
      continue;
    }

    // Handle bold text
    if (trimmed) {
      const parts = [];
      let current = '';
      let inBold = false;
      
      for (let j = 0; j < trimmed.length; j++) {
        if (trimmed.substring(j, j + 2) === '**' && trimmed[j + 2] !== '*') {
          if (current) {
            parts.push(new TextRun({ text: current, bold: inBold }));
            current = '';
          }
          inBold = !inBold;
          j++;
        } else if (trimmed[j] === '`') {
          if (current) {
            parts.push(new TextRun({ text: current, bold: inBold }));
            current = '';
          }
          // Find closing backtick
          let codeText = '';
          j++;
          while (j < trimmed.length && trimmed[j] !== '`') {
            codeText += trimmed[j];
            j++;
          }
          parts.push(new TextRun({ text: codeText, font: 'Courier New' }));
        } else {
          current += trimmed[j];
        }
      }
      
      if (current) {
        parts.push(new TextRun({ text: current, bold: inBold }));
      }

      if (parts.length > 0) {
        elements.push(new Paragraph({ children: parts }));
      } else if (trimmed) {
        elements.push(new Paragraph(trimmed));
      }
    } else {
      // Empty line
      elements.push(new Paragraph({ text: '' }));
    }
  }

  // Handle any remaining table
  if (inTable && tableHeaders.length > 0) {
    const tableCells = [
      tableHeaders.map(h => new TableCell({ children: [new Paragraph(h)] })),
      ...tableRows.map(row => row.map(cell => new TableCell({ children: [new Paragraph(cell)] })))
    ];

    elements.push(
      new Table({
        rows: tableCells.map(cells => new TableRow({ children: cells })),
        width: { size: 100, type: WidthType.PERCENTAGE },
      })
    );
  }

  return elements;
}

// Create the document
const children = parseMarkdown(markdownContent);

const doc = new Document({
  sections: [{
    properties: {},
    children: children,
  }],
  styles: {
    default: {
      document: {
        run: {
          font: 'Calibri',
          size: 22, // 11pt
        },
        paragraph: {
          spacing: { after: 200 },
        },
      },
      heading1: {
        run: {
          font: 'Calibri',
          size: 32, // 16pt
          bold: true,
        },
        paragraph: {
          spacing: { before: 240, after: 120 },
        },
      },
      heading2: {
        run: {
          font: 'Calibri',
          size: 28, // 14pt
          bold: true,
        },
        paragraph: {
          spacing: { before: 240, after: 120 },
        },
      },
      heading3: {
        run: {
          font: 'Calibri',
          size: 24, // 12pt
          bold: true,
        },
        paragraph: {
          spacing: { before: 240, after: 120 },
        },
      },
    },
    paragraphStyles: [
      {
        id: 'Code',
        name: 'Code',
        basedOn: 'Normal',
        run: {
          font: 'Courier New',
          size: 20, // 10pt
        },
        paragraph: {
          shading: { fill: 'F5F5F5' },
          spacing: { before: 120, after: 120 },
        },
      },
    ],
  },
});

// Generate and save the Word document
const outputPath = join(__dirname, '../docs/FHIR_RESOURCE_MAPPING.docx');
Packer.toBuffer(doc).then((buffer) => {
  writeFileSync(outputPath, buffer);
  console.log(`Word document created successfully: ${outputPath}`);
}).catch((error) => {
  console.error('Error creating Word document:', error);
  process.exit(1);
});

