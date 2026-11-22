// Minimal .xlsx reader/writer for Connecteam Shift Report imports. No extra dependencies.
'use strict';

const zlib = require('zlib');
const crypto = require('crypto');

function readU32(buf, i) { return buf.readUInt32LE(i); }
function readU16(buf, i) { return buf.readUInt16LE(i); }

function unzip(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let eocd = -1;
  for (let i = Math.max(0, buf.length - 22); i >= Math.max(0, buf.length - 0x10000); i--) {
    if (readU32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip/xlsx file');
  const count = readU16(buf, eocd + 8);
  let cd = readU32(buf, eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (readU32(buf, cd) !== 0x02014b50) throw new Error('Invalid zip directory');
    const method = readU16(buf, cd + 10);
    const compSize = readU32(buf, cd + 20);
    const nameLen = readU16(buf, cd + 28);
    const extraLen = readU16(buf, cd + 30);
    const commentLen = readU16(buf, cd + 32);
    const localOff = readU32(buf, cd + 42);
    const name = buf.slice(cd + 46, cd + 46 + nameLen).toString('utf8');
    const localNameLen = readU16(buf, localOff + 26);
    const localExtra = readU16(buf, localOff + 28);
    const dataStart = localOff + 30 + localNameLen + localExtra;
    const data = buf.slice(dataStart, dataStart + compSize);
    let out;
    if (method === 0) out = data;
    else if (method === 8) out = zlib.inflateRawSync(data);
    else throw new Error('Unsupported zip method ' + method);
    files[name] = out;
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function xmlText(xml, tag) {
  const re = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)</' + tag + '>', 'i');
  const m = String(xml).match(re);
  return m ? decode(m[1]) : '';
}

function decode(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function sharedStrings(xml) {
  const out = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const texts = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
    let tm;
    while ((tm = tRe.exec(m[1]))) texts.push(decode(tm[1]));
    out.push(texts.join(''));
  }
  return out;
}

function colRow(ref) {
  const m = String(ref).match(/^([A-Z]+)(\d+)$/i);
  if (!m) return {col: 0, row: 0};
  const letters = m[1].toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i++) col = col * 26 + (letters.charCodeAt(i) - 64);
  return {col: col - 1, row: Number(m[2]) - 1};
}

function excelSerialToIso(n) {
  if (!Number.isFinite(n)) return '';
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString();
}

function sheetRows(sheetXml, strings) {
  const rows = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
  let rm;
  while ((rm = rowRe.exec(sheetXml))) {
    const row = [];
    const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/gi;
    let cm;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1] || cm[3] || '';
      const inner = cm[2] || '';
      const ref = (attrs.match(/\br="([^"]+)"/) || [])[1];
      const typ = (attrs.match(/\bt="([^"]+)"/) || [])[1] || '';
      const vMatch = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
      const isMatch = inner.match(/<is\b[^>]*>([\s\S]*?)<\/is>/);
      let val = '';
      if (typ === 's' && vMatch) val = strings[Number(decode(vMatch[1]))] || '';
      else if (typ === 'inlineStr' && isMatch) {
        const t = isMatch[1].match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
        val = t ? decode(t[1]) : '';
      } else if (vMatch) val = decode(vMatch[1]);
      if (ref) {
        const {col, row: r} = colRow(ref);
        while (rows.length <= r) rows.push([]);
        while (row.length <= col) row.push('');
        // keep numeric strings as numbers when they are plain serials; caller decides
        row[col] = val;
        rows[r] = row;
      }
    }
    if (row.length) {
      // row index might already have been placed via ref
    }
  }
  return rows;
}

function rowsToObjects(rows) {
  if (!rows.length) return [];
  const headers = (rows[0] || []).map((h) => String(h || '').trim());
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const rec = {};
    let any = false;
    headers.forEach((h, idx) => {
      if (!h) return;
      let val = rows[i] && rows[i][idx] != null ? rows[i][idx] : '';
      rec[h] = val;
      if (String(val).trim()) any = true;
    });
    if (any) out.push(rec);
  }
  return out;
}

function readXlsx(buffer) {
  const files = unzip(buffer);
  const ssFile = Object.keys(files).find((k) => /xl\/sharedStrings\.xml$/i.test(k));
  const strings = ssFile ? sharedStrings(files[ssFile].toString('utf8')) : [];
  const sheetName = Object.keys(files).sort().find((k) => /xl\/worksheets\/sheet1\.xml$/i.test(k))
    || Object.keys(files).sort().find((k) => /xl\/worksheets\/sheet\d+\.xml$/i.test(k));
  if (!sheetName) throw new Error('xlsx has no worksheet');
  const rows = sheetRows(files[sheetName].toString('utf8'), strings);
  return rowsToObjects(rows);
}

function xmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function zipStore(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const nbuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30 + nbuf.length + data.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nbuf.length, 26);
    local.writeUInt16LE(0, 28);
    nbuf.copy(local, 30);
    data.copy(local, 30 + nbuf.length);
    const central = Buffer.alloc(46 + nbuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nbuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nbuf.copy(central, 46);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(locals.length, 8);
  eocd.writeUInt16LE(locals.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}

function writeXlsx(objects) {
  const headers = [];
  for (const row of objects) {
    for (const k of Object.keys(row)) if (!headers.includes(k)) headers.push(k);
  }
  const cell = (ref, val) => `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(val)}</t></is></c>`;
  const colLetter = (i) => {
    let n = i + 1, s = '';
    while (n) { n--; s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26); }
    return s;
  };
  const rowXml = (ridx, values) => {
    const cells = values.map((v, i) => cell(colLetter(i) + ridx, v == null ? '' : String(v))).join('');
    return `<row r="${ridx}">${cells}</row>`;
  };
  const sheetRowsXml = [rowXml(1, headers)].concat(objects.map((obj, i) => rowXml(i + 2, headers.map((h) => obj[h]))));
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRowsXml.join('')}</sheetData></worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Shift Report" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
  return zipStore({
    '[Content_Types].xml': types,
    '_rels/.rels': rels,
    'xl/workbook.xml': workbook,
    'xl/_rels/workbook.xml.rels': wbRels,
    'xl/worksheets/sheet1.xml': sheet
  });
}

module.exports = {readXlsx, writeXlsx, excelSerialToIso, unzip};
