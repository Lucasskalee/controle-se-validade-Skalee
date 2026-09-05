const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const context = vm.createContext({ TextDecoder, Uint8Array, DataView });
vm.runInContext(html.slice(html.indexOf('function textoDbf(bytes)'), html.indexOf('function carregarProdutosDbfParaSupabase(buffer)')) +
 html.slice(html.indexOf('function parseNumeroSg(value)'), html.indexOf('function detectarSeparadorEstoque(linha)')), context);
const parse = (buffer) => context.carregarSnapshotsEstoqueDbf(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
function fixture(stockName) {
 const fields = [['CODPROD', 6], [stockName, 12], ['PRVENDA', 12], ['CUSTO', 12]];
 const header = 32 + fields.length * 32 + 1;
 const record = 43;
 const buffer = Buffer.alloc(header + record * 3 + 1, 32);
 buffer[0] = 3; buffer.writeUInt32LE(3, 4); buffer.writeUInt16LE(header, 8); buffer.writeUInt16LE(record, 10);
 fields.forEach(([name, size], i) => {
  const offset = 32 + i * 32;
  buffer.fill(0, offset, offset + 32); buffer.write(name, offset); buffer[offset + 11] = 78; buffer[offset + 16] = size;
 });
 buffer[header - 1] = 13;
 [['123', '0.000', '2.650', '1.818'], ['124', '-12.375', '10.000', '4.100'], ['125', '99.000', '1.000', '1.000']].forEach((values, i) => {
  let offset = header + i * record + 1;
  values.forEach((value, j) => { buffer.write(value.padStart(fields[j][1]), offset); offset += fields[j][1]; });
 });
 buffer[header + record * 2] = 42;
 return buffer;
}
for (const name of ['ESTOQ', 'ESTOQUE', 'SALDO']) {
 const rows = parse(fixture(name));
 assert.equal(rows.length, 2);
 assert.equal(rows[0].internal_code, '123');
 assert.equal(rows[0].stock_quantity, 0);
 assert.equal(rows[0].sale_price, 2.65);
 assert.equal(rows[0].cost_price, 1.818);
 assert.equal(rows[1].stock_quantity, -12.375);
}
for (const file of process.argv.slice(2)) {
 const buffer = fs.readFileSync(file);
 const rows = parse(buffer);
 const header = buffer.readUInt16LE(8), size = buffer.readUInt16LE(10), count = buffer.readUInt32LE(4);
 let rowIndex = 0;
 for (let i = 0; i < count; i++) {
  const start = header + i * size;
  assert.ok(start + size <= buffer.length, 'Arquivo truncado');
  if (buffer[start] === 42) continue;
  let offset = start + 1;
  const raw = {};
  for (let p = 32; p < header - 1 && buffer[p] !== 13; p += 32) {
   const name = buffer.subarray(p, p + 11).toString('latin1').replace(/\0/g, '').trim();
   const length = buffer[p + 16];
   raw[name] = buffer.subarray(offset, offset + length).toString('latin1').trim(); offset += length;
  }
  const row = rows[rowIndex++];
  assert.equal(row.internal_code, raw.CODPROD);
  assert.equal(row.stock_quantity, Number(raw.ESTOQ));
  assert.equal(row.sale_price, Number(raw.PRVENDA));
  assert.equal(row.cost_price, Number(raw.CUSTO));
 }
 assert.equal(rows.length, rowIndex);
 console.log(`PASS: ${path.basename(file)} — ${rows.length} registros conferidos com os campos originais.`);
}
console.log('PASS: ESTOQ, ESTOQUE e SALDO; zeros, decimais, negativos e registros excluídos.');
