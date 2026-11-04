'use strict';
/* A small .xlsx writer without a library: real worksheets with cell styles, merged cells, column widths, row heights,
   frozen header and filter buttons. The free Excel library used for importing cannot write styles, so exports use this.
   The file is a ZIP of XML parts, stored uncompressed. */

const XL_STYLE = {normal:0, head:1, cell:2, title:3, owner:4, shared:5, free:6, rack:7, door:8, floor:9, note:10, wall:11};
const XL_STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="6"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font>
<font><sz val="9"/><name val="Calibri"/></font><font><b/><sz val="9"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><i/><sz val="9"/><color rgb="FF667085"/><name val="Calibri"/></font></fonts>
<fills count="10"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE9EEF6"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6F4EA"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE4ECFB"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3EAD9"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF3B3F46"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF9A7442"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF7F8FA"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF667085"/></patternFill></fill></fills>
<borders count="4"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFB0B7C3"/></left><right style="thin"><color rgb="FFB0B7C3"/></right><top style="thin"><color rgb="FFB0B7C3"/></top><bottom style="thin"><color rgb="FFB0B7C3"/></bottom><diagonal/></border>
<border><left style="medium"><color rgb="FF555555"/></left><right style="medium"><color rgb="FF555555"/></right><top style="medium"><color rgb="FF555555"/></top><bottom style="medium"><color rgb="FF555555"/></bottom><diagonal/></border>
<border><left style="hair"><color rgb="FFE3E6EB"/></left><right style="hair"><color rgb="FFE3E6EB"/></right><top style="hair"><color rgb="FFE3E6EB"/></top><bottom style="hair"><color rgb="FFE3E6EB"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="4" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="5" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="4" fillId="6" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="7" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="8" borderId="3" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="0"/></xf>
<xf numFmtId="0" fontId="0" fillId="9" borderId="0" xfId="0" applyFill="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

const xlCol = n => { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
const xlRef = (r, c) => xlCol(c) + (r + 1);
const xlEsc = s => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
// a sheet: {name, cells:Map('r,c' → {v, s}), cols:[width], rows:{r:height}, merges:[[r1,c1,r2,c2]], freeze:rows, filter:[r1,c1,r2,c2], landscape}
function xlSheet(name){ return {name, cells:new Map(), cols:[], rows:{}, merges:[], freeze:0, filter:null, landscape:false,
  set(r, c, v, s = 0){ this.cells.set(r + ',' + c, {v, s}); return this; }}; }
function xlSheetXml(sh){
  const byRow = new Map();
  for (const [k, cell] of sh.cells){ const [r, c] = k.split(',').map(Number); if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push([c, cell]); }
  for (const r of Object.keys(sh.rows).map(Number)) if (!byRow.has(r)) byRow.set(r, []);
  const rows = [...byRow.keys()].sort((a, b) => a - b).map(r => {
    const h = sh.rows[r], cells = byRow.get(r).sort((a, b) => a[0] - b[0]).map(([c, {v, s}]) => {
      const ref = xlRef(r, c), st = s ? ` s="${s}"` : '';
      if (v === null || v === undefined || v === '') return `<c r="${ref}"${st}/>`;
      if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
      return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xlEsc(v)}</t></is></c>`;
    }).join('');
    return `<row r="${r + 1}"${h ? ` ht="${h}" customHeight="1"` : ''}>${cells}</row>`;
  }).join('');
  const maxR = Math.max(0, ...[...byRow.keys()]), maxC = Math.max(0, sh.cols.length - 1, ...[...sh.cells.keys()].map(k => +k.split(',')[1]));
  const cols = sh.cols.length ? `<cols>${sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const pane = sh.freeze ? `<pane ySplit="${sh.freeze}" topLeftCell="A${sh.freeze + 1}" activePane="bottomLeft" state="frozen"/>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
${sh.landscape ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : ''}<dimension ref="A1:${xlRef(maxR, maxC)}"/><sheetViews><sheetView workbookViewId="0">${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows}</sheetData>
${sh.filter ? `<autoFilter ref="${xlRef(sh.filter[0], sh.filter[1])}:${xlRef(sh.filter[2], sh.filter[3])}"/>` : ''}
${sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${xlRef(m[0], m[1])}:${xlRef(m[2], m[3])}"/>`).join('')}</mergeCells>` : ''}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>${sh.landscape ? '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>' : ''}</worksheet>`;
}
// ZIP, method "stored"
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zipStore(files){
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  const u16 = v => [v & 255, v >> 8 & 255], u32 = v => [v & 255, v >> 8 & 255, v >> 16 & 255, v >>> 24 & 255];
  for (const [name, text] of files){
    const data = enc.encode(text), nm = enc.encode(name), crc = crc32(data);
    const head = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0)];
    parts.push(new Uint8Array(head), nm, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nm);
    off += head.length + nm.length + data.length;
  }
  const csize = central.reduce((s, b) => s + b.length, 0);
  return new Blob([...parts, ...central, new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(off), ...u16(0)])],
    {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
function xlsxBlob(sheets){
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const names = sheets.map(s => s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
  const defs = sheets.map((s, i) => s.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xlEsc(names[i]).replace(/'/g, "''")}'!$${xlCol(s.filter[1])}$${s.filter[0] + 1}:$${xlCol(s.filter[3])}$${s.filter[2] + 1}</definedName>` : '').join('');
  return zipStore([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${rel}"><sheets>${names.map((n, i) => `<sheet name="${xlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${defs ? `<definedNames>${defs}</definedNames>` : ''}</workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', XL_STYLES_XML],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, xlSheetXml(s)]),
  ]);
}
// a plain table sheet: header row with filter buttons, frozen, sensible widths
function xlTable(name, head, rows, widths){
  const sh = xlSheet(name);
  head.forEach((h, c) => sh.set(0, c, h, XL_STYLE.head));
  rows.forEach((r, i) => r.forEach((v, c) => sh.set(i + 1, c, v, XL_STYLE.cell)));
  sh.cols = widths || head.map((h, c) => Math.min(60, Math.max(10, String(h).length + 2, ...rows.slice(0, 500).map(r => String(r[c] ?? '').length + 2))));
  sh.freeze = 1; sh.filter = [0, 0, Math.max(1, rows.length), head.length - 1];
  return sh;
}
