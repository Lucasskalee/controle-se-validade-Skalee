(function (root) {
 'use strict';
 const number = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
 const day = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? Date.parse(value + 'T00:00:00Z') / 86400000 : NaN;
 const fmt = value => Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
 const date = value => String(value || '').split('-').reverse().join('/');
 function analyze(qty, movement, history, days) {
  const m = movement || {};
  const current = m.snapshot_date ? number(m.stock_quantity) : null;
  const previous = m.previous_snapshot_date ? number(m.previous_stock_quantity) : null;
  const percent = current > 0 && number(qty) !== null ? Number(qty) / current * 100 : null;
  const complete = Array.isArray(history);
  const source = complete ? history : [
   { snapshot_date: m.first_snapshot_date, stock_quantity: m.first_stock_quantity },
   { snapshot_date: m.previous_snapshot_date, stock_quantity: m.previous_stock_quantity },
   { snapshot_date: m.snapshot_date, stock_quantity: m.stock_quantity }
  ];
  const byDay = new Map();
  source.forEach(p => {
   const stock = number(p.stock_quantity);
   if (Number.isFinite(day(p.snapshot_date)) && stock !== null) byDay.set(p.snapshot_date, { date: p.snapshot_date, stock });
  });
  const points = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  const interval = day(m.snapshot_date) - day(m.previous_snapshot_date);
  let outflow = null, rate = null;
  if (complete && points.length >= 2) {
   outflow = points.slice(1).reduce((total, p, i) => total + Math.max(0, points[i].stock - p.stock), 0);
   rate = outflow / (day(points.at(-1).date) - day(points[0].date));
  } else if (current !== null && previous !== null && interval > 0) {
   rate = Math.max(0, previous - current) / interval;
  }
  const projection = rate !== null && number(qty) !== null && Number.isFinite(days) && days >= 0 ? Math.max(0, Number(qty) - rate * days) : null;
  return { current, previous, percent, points, complete, outflow, rate, projection,
   change: current !== null && previous !== null ? current - previous : null };
 }
 function chart(a) {
  if (a.points.length < 2) return '<p class="detail-note">Dados insuficientes: são necessárias duas cargas em datas distintas.</p>';
  const points = a.points;
  const min = Math.min(...points.map(p => p.stock)), max = Math.max(...points.map(p => p.stock));
  const start = day(points[0].date), duration = day(points.at(-1).date) - start;
  const coords = points.map(p => ({ x: 28 + (day(p.date) - start) / duration * 264, y: 68 - (p.stock - min) / (max - min || 1) * 42 }));
  return `<svg class="detail-chart" viewBox="0 0 320 106" role="img" aria-label="Histórico de estoque SG: ${points.map(p => `${date(p.date)}: ${fmt(p.stock)} unidades`).join('; ')}">
   <polyline points="${coords.map(p => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.5"/>
   ${coords.map((p, i) => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="currentColor"/>${points.length <= 5 || i === 0 || i === points.length - 1 ? `<text x="${p.x}" y="${p.y - 9}" text-anchor="middle">${fmt(points[i].stock)}</text><text x="${p.x}" y="96" text-anchor="middle">${date(points[i].date).slice(0, 5)}</text>` : ''}`).join('')}
  </svg><p class="detail-note">${a.complete ? 'Cargas diárias disponíveis no período consultado.' : 'Pontos disponíveis: primeira, anterior e atual; histórico completo indisponível.'}</p>`;
 }
 function statistics(a, qty, days) {
  const trend = a.change === null ? 'Dados insuficientes' : a.change < 0 ? '↓ Estoque diminuindo' : a.change > 0 ? '↑ Estoque aumentando' : '→ Estoque estável';
  return `<div class="detail-percentage">${a.percent === null ? '<strong>Estoque SG indisponível</strong>' : `<div class="detail-donut" style="--percentage:${Math.min(100, Math.max(0, a.percent))}%"><strong>${fmt(a.percent)}%</strong></div><div>do estoque está nesta validade<small>${fmt(qty)} de ${fmt(a.current)} unidades</small></div>`}</div>
   ${a.percent > 100 ? '<p class="detail-note">A contagem informada supera o último saldo SG. Confira a contagem e a data da carga.</p>' : ''}
   <div class="detail-metrics"><div><small>Tendência do estoque</small><strong>${trend}</strong></div><div><small>Ritmo médio observado</small><strong>${a.rate === null ? 'Dados insuficientes' : `${fmt(a.rate)} un./dia`}</strong></div></div>
   <div class="detail-projection"><small>Projeção até o vencimento</small><strong>${days < 0 ? 'Produto vencido' : a.projection === null ? 'Dados insuficientes' : `≈ ${fmt(a.projection)} un. restantes`}</strong><p class="detail-note">${days === 0 ? 'Vence hoje: zero dias futuros. ' : ''}Estimativa, sem garantia. Supõe saída deste lote primeiro; o SG não identifica lotes.</p></div>
   <strong class="detail-chart-title">Histórico do estoque SG</strong>${chart(a)}
   <details class="detail-method"><summary>Como calculamos o ritmo</summary><p class="detail-note">${a.complete ? 'Soma das reduções ÷ dias do período consultado' : 'Redução entre as duas últimas cargas ÷ dias entre elas'}. Variação não comprova venda ou perda.</p></details>`;
 }
 function carousel(container) {
  const track = container.querySelector('.detail-carousel');
  const slides = [...track.children];
  const dots = [...container.querySelectorAll('.detail-dot')];
  let active = 0, drag = null;
  const target = i => slides[i].offsetLeft - slides[0].offsetLeft;
  const go = i => track.scrollTo({ left: target(Math.max(0, Math.min(2, i))), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  dots.forEach((dot, i) => dot.addEventListener('click', () => go(i)));
  track.addEventListener('scroll', () => {
   active = slides.reduce((best, _, i) => Math.abs(track.scrollLeft - target(i)) < Math.abs(track.scrollLeft - target(best)) ? i : best, 0);
   dots.forEach((dot, i) => dot.setAttribute('aria-current', String(i === active)));
  }, { passive: true });
  track.addEventListener('keydown', e => {
   if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
   e.preventDefault(); go(e.key === 'Home' ? 0 : e.key === 'End' ? 2 : active + (e.key === 'ArrowRight' ? 1 : -1));
  });
  track.addEventListener('pointerdown', e => {
   if (e.pointerType !== 'mouse' || e.button !== 0 || e.target.closest('button,a,input')) return;
   drag = { x: e.clientX, left: track.scrollLeft };
   track.setPointerCapture(e.pointerId); track.classList.add('dragging');
  });
  track.addEventListener('pointermove', e => { if (drag) track.scrollLeft = drag.left + drag.x - e.clientX; });
  const end = () => { if (!drag) return; drag = null; track.classList.remove('dragging'); go(active); };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
 }
 root.SkaleeProductDetail = { analyze, statistics, carousel, fmt };
 if (typeof module !== 'undefined') module.exports = root.SkaleeProductDetail;
})(typeof window === 'undefined' ? globalThis : window);
