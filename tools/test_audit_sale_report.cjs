const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, '../audit-report-generator.js'), 'utf8'), context);
const build = context.window.skaleeAuditReport.buildExecutiveAuditHtml;
function card(items) {
  const html = build({ items, executive_summary: { potential_sales_loss: 999 }, competence_month: '2026-09-01' });
  return html.split('<div class="kpi-card purple">')[1].split('<!-- 2.1')[0];
}
const priced = { quantity_audited: 4, sale_price_snapshot: 12.5, financial_cost_impact: 30, product_name: 'Teste' };
let result = card([priced, { ...priced, sale_price_snapshot: null }]);
assert.match(result, /50,00/);
assert.match(result, /Parcial/);
assert.match(result, /1 de 2 produto/);
assert.match(result, /1 sem preço de venda/);
result = card([priced, { ...priced, sale_price_snapshot: 20 }]);
assert.match(result, /130,00/);
assert.doesNotMatch(result, /Parcial/);
assert.match(card([{ ...priced, sale_price_snapshot: 0 }]), /0,00/);
assert.match(card([{ ...priced, sale_price_snapshot: null }]), /Não apurado/);
assert.match(card([{ ...priced, quantity_audited: 0, sale_price_snapshot: null }]), /0,00/);
assert.match(card([priced, { ...priced, quantity_audited: null, sale_price_snapshot: null }]), /1 de 1 produto/);
console.log('PASS: relatório com preços completos, parciais, ausentes, zero e itens pendentes; resumo antigo não prevalece sobre os itens.');
