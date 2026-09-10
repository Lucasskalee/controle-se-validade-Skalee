/* Consulta independente: nenhuma gravação no catálogo ou no servidor. */
function parseLocalQueryText(buffer) {
 let text;
 try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
 catch { text = new TextDecoder('windows-1252').decode(buffer); }
 if (text.includes('\0') || /^\s*</.test(text)) throw new Error('Exporte a planilha como CSV antes de importar.');
 const first = text.split(/\r?\n/).find(line => /codigo|código|codprod|cod_int/i.test(line)) || text.split(/\r?\n/)[0];
 const separator = first.includes('\t') ? '\t' : first.includes(';') ? ';' : ',';
 const records = []; let row = [], cell = '', quoted = false;
 for (let i = 0; i < text.length; i++) {
  const c = text[i];
  if (c === '"') {
   if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
   else quoted = !quoted;
  } else if (!quoted && (c === separator || c === '\n' || c === '\r')) {
   row.push(cell.trim()); cell = '';
   if (c !== separator) { records.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
  } else cell += c;
 }
 if (quoted) throw new Error('Arquivo com aspas não fechadas. Corrija o CSV e tente novamente.');
 row.push(cell.trim()); if (row.some(Boolean)) records.push(row);
 const norm = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
 const aliases = {
  internal_code: ['codigo','codprod','codproduto','codigointerno','codinterno','codint'],
  name: ['descricao','descricaodoproduto','produto','nome','descr','nomprod'],
  barcode: ['codigodebarras','codigobarras','codbarras','codbarra','codbar','ean','barras'],
  sale_price: ['preco','precovenda','precodevenda','valorvenda','prvenda','prcven','vlrvenda'],
  stock_quantity: ['estoque','estoq','saldo','saldoestoque','qtdestoque','qtdeestoque','disponivel','qtdest']
 };
 let map;
 const result = [];
 for (const values of records) {
  if (!map) {
   const headers = values.map(norm);
   const candidate = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [key, headers.findIndex(value => names.includes(value))]));
   if (candidate.internal_code >= 0 && candidate.stock_quantity >= 0) map = candidate;
   continue;
  }
  const code = values[map.internal_code];
  if (!code || aliases.internal_code.includes(norm(code))) continue;
  const item = {};
  for (const [key, index] of Object.entries(map)) {
   const value = index < 0 ? '' : values[index] || '';
   item[key] = ['sale_price', 'stock_quantity'].includes(key) ? parseNumeroSg(value.replace(/^R\$\s*/, '')) : value;
  }
  if (item.stock_quantity === null) throw new Error(`Estoque ausente ou inválido no produto ${code}. Confira o arquivo.`);
  if (map.sale_price >= 0 && values[map.sale_price] && item.sale_price === null) throw new Error(`Preço inválido no produto ${code}.`);
  result.push(item);
 }
 if (!map || !result.length) throw new Error('Nenhum produto encontrado. O arquivo precisa de cabeçalhos de código e estoque.');
 return result;
}

(() => {
 const byId = id => document.getElementById(id);
 const form = byId('localQueryImport'), filter = byId('localQueryFilter'), search = byId('localQuerySearch');
 const status = byId('localQueryStatus'), remove = byId('localQueryDelete'), more = byId('localQueryMore');
 let batches = [], limit = 100, database;
 const normalize = value => String(value).trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
 const style = document.createElement('style');
 style.textContent = '.local-query-controls{display:flex;flex-wrap:wrap;gap:14px;align-items:end;margin:20px 0}.local-query-controls label{display:grid;gap:7px;flex:1 1 220px;min-width:0}.local-query-controls input,.local-query-controls select{width:100%;min-height:44px}.local-query-table{width:100%;border-collapse:collapse}.local-query-table th,.local-query-table td{text-align:left;padding:12px;border-bottom:1px solid var(--line,#ddd)}.local-query-table th{white-space:nowrap}#local-query .settings-note{line-height:1.5}';
 document.head.append(style);
 function db() {
  if (!database) database = new Promise((resolve, reject) => {
   const request = indexedDB.open('skalee-local-query', 1);
   request.onupgradeneeded = () => request.result.createObjectStore('stores', { keyPath: 'id' });
   request.onsuccess = () => resolve(request.result);
   request.onerror = () => reject(request.error);
   request.onblocked = () => reject(new Error('Feche outras abas do aplicativo e tente novamente.'));
  }).catch(error => { database = null; throw error; });
  return database;
 }
 async function operation(mode, action) {
  const connection = await db();
  return new Promise((resolve, reject) => {
   const tx = connection.transaction('stores', mode);
   const request = action(tx.objectStore('stores'));
   tx.oncomplete = () => resolve(request.result);
   tx.onabort = tx.onerror = () => reject(tx.error || new Error('Não foi possível salvar no aparelho.'));
  });
 }
 function render() {
  const selected = filter.value, query = normalize(search.value);
  remove.disabled = !selected;
  const rows = [];
  let total = 0;
  for (const batch of batches) {
   if (selected && batch.id !== selected) continue;
   for (const item of batch.rows) {
    if (query && !normalize([item.name, item.internal_code, item.barcode].join(' ')).includes(query)) continue;
    total++;
    if (rows.length < limit) rows.push({ batch, item });
   }
  }
  const fragment = document.createDocumentFragment();
  for (const { batch, item } of rows) {
   const tr = document.createElement('tr');
   const price = item.sale_price == null ? 'Não informado' : item.sale_price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
   for (const value of [batch.name, item.internal_code, item.name || 'Sem descrição', item.barcode || '—', price, item.stock_quantity == null ? 'Não informado' : item.stock_quantity.toLocaleString('pt-BR')]) {
    const td = document.createElement('td'); td.textContent = value; tr.append(td);
   }
   fragment.append(tr);
  }
  byId('localQueryRows').replaceChildren(fragment);
  const batch = batches.find(item => item.id === selected);
  byId('localQuerySummary').textContent = batches.length ? `${rows.length} de ${total} produtos encontrados.${batch ? ` Arquivo: ${batch.filename} • Importado em ${new Date(batch.date).toLocaleString('pt-BR')}.` : ''}` : 'Nenhuma consulta salva. Selecione uma loja e importe o primeiro arquivo.';
  more.hidden = total <= limit;
 }
 async function reload(selected = filter.value) {
  batches = await operation('readonly', store => store.getAll());
  batches.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  filter.replaceChildren(new Option('Todas as lojas', ''));
  for (const batch of batches) filter.add(new Option(batch.name, batch.id));
  filter.value = batches.some(batch => batch.id === selected) ? selected : '';
  limit = 100; render();
 }
 function failure(error) {
  status.textContent = error.name === 'QuotaExceededError' ? 'Espaço insuficiente no aparelho. Exclua uma consulta antiga e tente novamente.' : `Não foi possível concluir: ${error.message}`;
 }
 form.addEventListener('submit', async event => {
  event.preventDefault();
  const name = byId('localQueryStore').value.trim(), file = byId('localQueryFile').files[0];
  if (!name || !file) return;
  const controls = [...form.elements]; controls.forEach(control => { control.disabled = true; });
  status.textContent = 'Lendo e salvando arquivo no aparelho…';
  try {
   // iOS may disable DBF files when the input has an accept filter.
   // Keep the native picker unrestricted and validate the extension here.
   if (!/\.(dbf|csv|tsv|txt|xls)$/i.test(file.name)) throw new Error('Selecione um arquivo DBF, CSV, TSV, TXT ou XLS em texto.');
   const buffer = await file.arrayBuffer();
   const rows = /\.dbf$/i.test(file.name) ? carregarSnapshotsEstoqueDbf(buffer) : parseLocalQueryText(buffer);
   if (!rows.length || rows.some(row => !row.internal_code || row.stock_quantity === null || row.stock_invalid)) throw new Error('Existem produtos sem código ou com estoque inválido. Confira o arquivo.');
   const id = normalize(name);
   await operation('readwrite', store => store.put({ id, name, filename: file.name, date: new Date().toISOString(), rows }));
   search.value = '';
   await reload(id);
   status.textContent = `${rows.length} produtos de ${name} salvos neste aparelho.`;
   byId('localQueryFile').value = '';
  } catch (error) { failure(error); }
  finally { controls.forEach(control => { control.disabled = false; }); }
 });
 filter.addEventListener('change', () => { limit = 100; render(); });
 search.addEventListener('input', () => { limit = 100; render(); });
 more.addEventListener('click', () => { limit += 100; render(); });
 remove.addEventListener('click', async () => {
  const id = filter.value, batch = batches.find(item => item.id === id);
  if (!batch || !confirm(`Excluir a consulta de ${batch.name} deste aparelho?`)) return;
  remove.disabled = true;
  try { await operation('readwrite', store => store.delete(id)); await reload(''); status.textContent = 'Consulta excluída deste aparelho.'; }
  catch (error) { failure(error); render(); }
 });
 reload().catch(failure);
})();
