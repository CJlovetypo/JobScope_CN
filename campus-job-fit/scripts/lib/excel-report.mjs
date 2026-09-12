import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

// Resolve the desktop's bundled runtime; do not install or use repo-local packages.
async function loadRuntimePackage(name) {
  const packageRoot = process.env.CODEX_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
  const require = createRequire(path.join(packageRoot, '__campus_runtime__.cjs'));
  let entry;
  try { entry = require.resolve(name); }
  catch { throw new Error('Excel 导出需要 Codex 附带的 @oai/artifact-tool。请调用 load_workspace_dependencies，并将 CODEX_NODE_MODULES 指向返回的 Node.js packages 目录。'); }
  return import(pathToFileURL(entry).href);
}
export const loadArtifactTool = () => loadRuntimePackage('@oai/artifact-tool');

const COLORS = {header: '#24364B', ink: '#223047', light: '#F4F7FA', line: '#DCE3EB'};
const DEFAULT_FONT = '微软雅黑';
const MAIN_WIDTHS = [18, 25, 18, 42, 16, 24, 28, 16, 16, 230, 48];
const SETTINGS = {
  '岗位匹配': {widths: MAIN_WIDTHS, freeze: 3, rowHeight: 36},
  '待核实与未评估': {widths: MAIN_WIDTHS, freeze: 3, rowHeight: 36},
  '来源覆盖': {widths: [22, 28, 18, 14, 14, 14, 14, 14, 14, 14, 16, 70, 28, 28, 18, 55, 95, 28], freeze: 1},
  'JD原文': {widths: [22, 40, 28, 26, 18, 115, 48], freeze: 2},
  '说明': {widths: [26, 110], freeze: 0},
};
const isNumericText = value => typeof value === 'string' && /^[+-]?\d+(?:\.\d+)?$/.test(value);

function literal(value) {
  if (typeof value !== 'string') return value ?? null;
  const safe = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (safe.length > 32767) throw new Error('单元格文字超过 Excel 的 32767 字符上限，请精炼评估理由或拆分 JD 原文后重试。');
  // Artifact Tool infers numeric/date strings; preserve identifiers verbatim.
  return safe.startsWith('=') || isNumericText(safe) ? "'" + safe : safe;
}

function wrapLines(value, width) {
  const capacity = Math.max(8, width - 3);
  return String(value ?? '').split('\n').reduce((total, line) => {
    const units = [...line].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? 2 : 1), 0);
    return total + Math.max(1, Math.ceil(units / capacity));
  }, 0);
}

function formatTable(sheet, data, index) {
  const rowCount = data.rows.length + 1;
  const columnCount = data.headers.length;
  const widths = SETTINGS[data.name].widths;
  const grid = sheet.getRangeByIndexes(0, 0, rowCount, columnCount);
  grid.values = [data.headers, ...data.rows].map(row => row.map(value => {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/.test(value)) return new Date(value);
    return literal(value);
  }));
  grid.format.font = {name: DEFAULT_FONT, size: 11, color: COLORS.ink};
  grid.format.wrapText = true;
  grid.format.verticalAlignment = 'top';
  grid.format.horizontalAlignment = 'left';
  grid.setNumberFormat('@');
  sheet.showGridLines = false;
  sheet.freezePanes.freezeRows(1);
  if (SETTINGS[data.name].freeze) sheet.freezePanes.freezeColumns(SETTINGS[data.name].freeze);
  for (let column = 0; column < columnCount; column++) {
    sheet.getRangeByIndexes(0, column, rowCount, 1).format.columnWidth = widths[column] || 24;
  }
  if (data.rows.length) {
    const table = sheet.tables.add(grid, true, `CampusTable${index + 1}`);
    table.style = 'TableStyleMedium2';
    table.showFilterButton = true;
    for (let i = 0; i < data.rows.length; i++) {
      const range = sheet.getRangeByIndexes(i + 1, 0, 1, columnCount);
      range.format.fill = i % 2 === 0 ? '#FFFFFF' : COLORS.light;
      // Compact job lists show only a preview of long reasons. The complete
      // text remains in each cell for the formula bar or manual row expansion.
      if (SETTINGS[data.name].rowHeight) range.format.rowHeight = SETTINGS[data.name].rowHeight;
      else {
        const lines = Math.max(...data.rows[i].map((value, column) => wrapLines(value, widths[column] || 24)));
        range.format.rowHeight = Math.min(409, Math.max(32, lines * 15 + 10));
      }
    }
  }
  const header = sheet.getRangeByIndexes(0, 0, 1, columnCount);
  header.format = {
    fill: COLORS.header,
    font: {name: DEFAULT_FONT, size: 11, bold: true, color: '#FFFFFF'},
    horizontalAlignment: 'center', verticalAlignment: 'center', wrapText: true,
    rowHeight: 34,
    borders: {insideVertical: {style: 'thin', color: '#FFFFFF'}},
  };
  for (const {row, column, url, label} of data.links || []) {
    if (!/^https?:\/\//i.test(url) && !/^#'JD原文'!A\d+$/.test(url)) throw new Error('不支持的 JD 链接：' + url);
    const cell = sheet.getCell(row - 1, column - 1);
    // Use ordinary text for calculation/rendering; native hyperlinks are added
    // to the exported OOXML below because HYPERLINK is not implemented here.
    cell.values = [[literal(label || url)]];
    cell.format.font = {name: DEFAULT_FONT, size: 11, color: '#1762A2', underline: 'single'};
  }
  if (['岗位匹配', '待核实与未评估'].includes(data.name) && data.rows.length) {
    const priority = sheet.getRange(`E2:E${rowCount}`);
    for (const [text, fill, color] of [['高优先', '#E4F1E9', '#236444'], ['常规关注', '#EDF2F8', '#345A80'], ['低优先', '#F0F1F3', '#697384'], ['待评估', '#FFF4DC', '#805F1B']]) {
      priority.conditionalFormats.add('containsText', {text, format: {fill, font: {color, bold: true}}});
    }
  }
  if (data.name === '来源覆盖' && data.rows.length) {
    sheet.getRange(`D2:K${rowCount}`).setNumberFormat('#,##0');
    sheet.getRange(`D2:K${rowCount}`).format.horizontalAlignment = 'right';
  }
  data.rows.forEach((row, i) => row.forEach((value, column) => {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z)?$/.test(value)) sheet.getCell(i + 1, column).setNumberFormat('yyyy-mm-dd hh:mm');
  }));
  if (data.name === '说明') {
    data.rows.forEach((row, i) => {
      if (typeof row[1] === 'number') sheet.getCell(i + 1, 1).setNumberFormat('#,##0');
    });
  }
}

// Supplement the library's native hyperlink and exact numeric-text export gaps.
// Normal worksheet content and formatting is authored by Artifact Tool.
async function finalizeExcelXml(file, sheets) {
  const {default: JSZip} = await loadRuntimePackage('jszip');
  const xmlModule = await loadRuntimePackage('xml-js');
  const {xml2js, js2xml} = xmlModule.default || xmlModule;
  const saxModule = await loadRuntimePackage('sax');
  const sax = saxModule.default || saxModule;
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const children = (node, name) => (node.elements || []).filter(item => item.type === 'element' && item.name.split(':').pop() === name);
  const parse = text => xml2js(text, {compact: false});
  const escapeAttribute = value => String(value).replace(/[&<>"\t\n\r]/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\t': '&#9;', '\n': '&#10;', '\r': '&#13;'}[char]));
  // xml-js escapes quotes before attributeValueFn but leaves & and < raw.
  // Read the original attribute, so each legal character is escaped exactly
  // once, including entity-looking text and attributes parsed from old rels.
  const serialize = document => js2xml(document, {compact: false, attributeValueFn: (_value, name, _elementName, element) => escapeAttribute(element.attributes[name])});
  const root = doc => doc.elements.find(item => item.type === 'element');
  const workbook = root(parse(await zip.file('xl/workbook.xml').async('string')));
  const workbookRels = root(parse(await zip.file('xl/_rels/workbook.xml.rels').async('string')));
  const relations = new Map(children(workbookRels, 'Relationship').map(item => [item.attributes.Id, item.attributes.Target]));
  const sheetEntries = children(children(workbook, 'sheets')[0], 'sheet');
  for (const data of sheets) {
    const numericTextCells = new Map();
    data.rows.forEach((row, rowIndex) => row.forEach((value, columnIndex) => {
      if (isNumericText(value)) numericTextCells.set(String.fromCharCode(65 + columnIndex) + (rowIndex + 2), value);
    }));
    if (!data.links?.length && !numericTextCells.size) continue;
    const entry = sheetEntries.find(item => item.attributes.name === data.name);
    const target = relations.get(entry.attributes['r:id']);
    const sheetPath = target.startsWith('/') ? target.slice(1) : path.posix.normalize('xl/' + target);
    let xml = await zip.file(sheetPath).async('string');
    const prefix = xml.match(/<(\w+:)?worksheet\b/)[1] || '';
    if (numericTextCells.size) {
      // Match only original numeric strings, never strip quotes globally or
      // touch genuine numbers, formulas, or user-authored leading apostrophes.
      xml = xml.replace(/<((?:\w+:)?c)\b([^>]*)>[\s\S]*?<\/\1>/g, (cell, name, attributes) => {
        const address = attributes.match(/\br="([^"]+)"/)?.[1];
        if (!numericTextCells.has(address)) return cell;
        const value = numericTextCells.get(address);
        numericTextCells.delete(address);
        const typed = /\bt="[^"]*"/.test(attributes) ? attributes.replace(/\bt="[^"]*"/, 't="str"') : attributes + ' t="str"';
        // Numeric text has no XML metacharacters; keep the exact source bytes.
        return `<${name}${typed}><${prefix}v>${value}</${prefix}v></${name}>`;
      });
      if (numericTextCells.size) throw new Error('Excel 导出缺少数字文本单元格：' + data.name + '!' + [...numericTextCells.keys()].join('、'));
    }
    if (!data.links?.length) { zip.file(sheetPath, xml); continue; }
    const relPath = path.posix.join(path.posix.dirname(sheetPath), '_rels', path.posix.basename(sheetPath) + '.rels');
    const existingRels = zip.file(relPath);
    const relDoc = existingRels ? parse(await existingRels.async('string')) : {elements: [{type: 'element', name: 'Relationships', attributes: {xmlns: 'http://schemas.openxmlformats.org/package/2006/relationships'}, elements: []}]};
    const relRoot = root(relDoc);
    relRoot.elements ||= [];
    const ids = new Set(children(relRoot, 'Relationship').map(item => item.attributes.Id));
    let counter = 1;
    const links = data.links.map(link => {
      const attributes = {ref: String.fromCharCode(64 + link.column) + link.row, display: link.label || link.url};
      if (link.url.startsWith('#')) attributes.location = link.url.slice(1);
      else {
        while (ids.has('rIdCampus' + counter)) counter++;
        const id = 'rIdCampus' + counter++; ids.add(id); attributes['r:id'] = id;
        relRoot.elements.push({type: 'element', name: 'Relationship', attributes: {Id: id, Type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink', Target: link.url, TargetMode: 'External'}});
      }
      return {type: 'element', name: prefix + 'hyperlink', attributes};
    });
    xml = xml.replace(/<(?:\w+:)?hyperlinks\b[\s\S]*?<\/(?:\w+:)?hyperlinks>/g, '');
    const open = xml.match(/<(?:\w+:)?worksheet\b[^>]*>/)[0];
    if (!/xmlns:r=/.test(open)) xml = xml.replace(open, open.slice(0, -1) + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
    const fragment = serialize({elements: [{type: 'element', name: prefix + 'hyperlinks', elements: links}]});
    // Insert at the worksheet schema position, before page/drawing/table parts.
    const after = /<(?:\w+:)?(?:printOptions|pageMargins|pageSetup|headerFooter|rowBreaks|colBreaks|customProperties|cellWatches|ignoredErrors|smartTags|drawing|legacyDrawing|legacyDrawingHF|picture|oleObjects|controls|webPublishItems|tableParts|extLst)\b/;
    const offset = xml.search(after);
    xml = offset >= 0 ? xml.slice(0, offset) + fragment + xml.slice(offset) : xml.replace(/<\/(?:\w+:)?worksheet>/, closing => fragment + closing);
    zip.file(sheetPath, xml);
    zip.file(relPath, serialize(relDoc));
  }
  // Validate every XML part without building a worksheet-sized object tree.
  // A bad URL/label must fail before the completed report is replaced.
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/\.(?:xml|rels)$/i.test(name)) continue;
    try { sax.parser(true, {xmlns: true}).write(await entry.async('string')).close(); }
    catch (error) { throw new Error('Excel XML 无效：' + name + '；' + error.message); }
  }
  await fs.writeFile(file, await zip.generateAsync({type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: {level: 6}}));
}

export async function writeExcelReport(file, sheets, {previewDir} = {}) {
  const {Workbook, SpreadsheetFile} = await loadArtifactTool();
  const workbook = Workbook.create();
  for (const data of sheets) workbook.worksheets.add(data.name);
  sheets.forEach((data, index) => formatTable(workbook.worksheets.getItem(data.name), data, index));
  const inspection = await workbook.inspect({kind: 'table', range: '岗位匹配!A1:K3', tableMaxRows: 3, tableMaxCols: 11, tableMaxCellChars: 100, maxChars: 2500});
  const errors = await workbook.inspect({kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: {useRegex: true, maxResults: 10}, maxChars: 2500, summary: 'Excel 公式错误检查'});
  const formulaErrors = errors.ndjson.split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(item => item.kind === 'match' && item.formula && /^#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A|NUM!|NULL!|SPILL!|CALC!)$/.test(item.value));
  if (formulaErrors.length) throw new Error('Excel 公式错误：' + formulaErrors.map(item => `${item.sheet}!${item.address} ${item.value}`).join('；'));
  if (previewDir) {
    // Layout previews precede the OOXML fixes; validate exact identifiers and
    // clickable links from the finalized XLSX rather than these preview images.
    await fs.mkdir(previewDir, {recursive: true});
    await fs.writeFile(path.join(previewDir, 'inspection.json'), JSON.stringify({inspection: inspection.ndjson, errors: errors.ndjson}, null, 2));
    for (const data of sheets) {
      const finalColumn = String.fromCharCode(64 + data.headers.length);
      const finalRow = data.name === '说明' ? Math.min(12, data.rows.length + 1) : Math.min(3, data.rows.length + 1);
      const preview = await workbook.render({sheetName: data.name, range: `A1:${finalColumn}${finalRow}`, scale: 1, format: 'png'});
      await fs.writeFile(path.join(previewDir, data.name + '.png'), new Uint8Array(await preview.arrayBuffer()));
    }
  }
  await fs.mkdir(path.dirname(file), {recursive: true});
  const output = await SpreadsheetFile.exportXlsx(workbook);
  // An atomic rename keeps the previous completed report if export fails.
  const temporaryDir = path.resolve(path.dirname(file), '../../tmp/excel-export');
  await fs.mkdir(temporaryDir, {recursive: true});
  const temporary = path.join(temporaryDir, path.basename(file) + '.tmp.xlsx');
  await output.save(temporary);
  await finalizeExcelXml(temporary, sheets);
  await fs.rename(temporary, file);
  return {file, inspection: inspection.ndjson, errors: errors.ndjson};
}
