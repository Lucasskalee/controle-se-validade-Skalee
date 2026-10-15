/**
 * Módulo Oficial de Relatório Executivo e Emissão de PDF da Auditoria de Validades
 * Skalee Controle de Validades - Controladoria & Auditoria Profissional
 *
 * Gera o Relatório Mensal Auditável de Controladoria com:
 * 1. Resumo Executivo e Cards de Impacto
 * 2. Eficiência Preventiva (Monitorados vs Encontrados na Auditoria)
 * 3. Análise por Motivo com Subtotais
 * 4. Top Maiores Impactos com Fotos
 * 5. Conclusão da Controladoria & Plano de Ação
 * 6. ANEXO I: Memória de Cálculo Auditável por Classificação
 * 7. Resumo e Conciliação Matemática Estrita (Soma dos Itens = Subtotais dos Motivos = Total Executivo)
 * 8. Pendências da Auditoria (itens sem custo exibidos como "Não apurado", nunca R$ 0,00)
 * 9. Produtos Conferidos sem Perda (quantity_audited = 0)
 * 10. Assinaturas Formais e Paginação
 */

(function () {
  'use strict';

  function formatBrl(val) {
    if (val === null || val === undefined || isNaN(Number(val))) return 'Não apurado';
    return Number(val).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function formatNumber(val, decimals = 0) {
    if (val === null || val === undefined || isNaN(Number(val))) return '0';
    return Number(val).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  function formatDate(val) {
    if (!val) return '—';
    const parts = String(val).split('T')[0].split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
    return val;
  }

  function formatDateTime(val) {
    if (!val) return '—';
    try {
      const d = new Date(val);
      if (isNaN(d.getTime())) return formatDate(val);
      return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch (_) {
      return formatDate(val);
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatCompetence(val) {
    if (!val) return '';
    const parts = String(val).split('-');
    if (parts.length < 2) return val;
    const year = parts[0];
    const month = parseInt(parts[1], 10);
    const months = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    return `${months[month - 1] || month} de ${year}`;
  }

  /**
   * Constrói o documento HTML completo e profissional para Impressão e PDF
   */
  function buildExecutiveAuditHtml(data) {
    const store = data.store || {};
    const rawExec = data.executive_summary || {};
    const rawPrev = data.preventive_efficiency || {};
    const rawReasons = data.reasons_summary || [];
    const topImpacts = data.top_impacts || [];
    const conclusion = data.conclusion || {};
    const actionPlan = data.action_plan || [];
    const rawReconciliation = data.reconciliation || {};
    const allItems = data.items || [];
    const dates = data.audit_dates || {};

    const competenceText = formatCompetence(data.competence_month);
    const auditCode = data.code || `AUD-${data.competence_month || ''}-${store.code || 'LOJA'}`;
    const revision = data.revision_number ? `Versão ${data.revision_number}` : 'Versão 1';

    // =========================================================================
    // 1. CÁLCULO E NORMALIZAÇÃO DINÂMICA EM TEMPO REAL (FONTE DA VERDADE)
    // =========================================================================
    // Agrupamento de itens
    const isPresent = v => v !== null && v !== undefined && v !== '';
    const pendingItems = allItems.filter(i => !isPresent(i.quantity_audited));
    const auditedItems = allItems.filter(i => isPresent(i.quantity_audited));
    const lossItems = auditedItems.filter(i => Number(i.quantity_audited) > 0);
    const zeroItems = auditedItems.filter(i => Number(i.quantity_audited) === 0);

    const uncostedItems = lossItems.filter(i => {
      const eff = i.effective_unit_cost !== undefined && i.effective_unit_cost !== null
        ? i.effective_unit_cost
        : (i.cost_source === 'manual' ? i.manual_unit_cost : i.unit_cost_snapshot);
      return eff === null || eff === undefined || i.financial_cost_impact === null || i.financial_cost_impact === undefined;
    });

    const manualCostItems = lossItems.filter(i => i.cost_source === 'manual' && i.manual_unit_cost !== null && i.manual_unit_cost !== undefined);
    const manualCostTotalImpact = manualCostItems.reduce((acc, i) => acc + Number(i.financial_cost_impact || 0), 0);

    const calculatedTotalLossUnits = lossItems.reduce((acc, i) => acc + Number(i.quantity_audited || 0), 0);
    const calculatedTotalLossCost = lossItems.reduce((acc, i) => {
      return (i.financial_cost_impact !== null && i.financial_cost_impact !== undefined)
        ? acc + Number(i.financial_cost_impact)
        : acc;
    }, 0);

    const pricedLossItems = lossItems.filter(i => isPresent(i.sale_price_snapshot) && Number.isFinite(Number(i.sale_price_snapshot)) && Number(i.sale_price_snapshot) >= 0);
    const missingSalePriceCount = lossItems.length - pricedLossItems.length;
    const calculatedPotentialSalesLoss = pricedLossItems.reduce((acc, i) => acc + Number(i.quantity_audited) * Number(i.sale_price_snapshot), 0);
    const salesCoverageKnown = Array.isArray(data.items);

    // Normalização do Resumo Executivo
    const exec = {
      total_loss_cost: (rawExec.total_loss_cost !== undefined && rawExec.total_loss_cost !== null)
        ? Number(rawExec.total_loss_cost)
        : ((rawExec.total_financial_cost_loss !== undefined && rawExec.total_financial_cost_loss !== null)
          ? Number(rawExec.total_financial_cost_loss)
          : calculatedTotalLossCost),

      total_units_audited: (rawExec.total_units_audited !== undefined && rawExec.total_units_audited !== null)
        ? Number(rawExec.total_units_audited)
        : ((rawExec.total_loss_units !== undefined && rawExec.total_loss_units !== null)
          ? Number(rawExec.total_loss_units)
          : calculatedTotalLossUnits),

      positive_loss_items_count: (rawExec.positive_loss_items_count !== undefined && rawExec.positive_loss_items_count !== null)
        ? Number(rawExec.positive_loss_items_count)
        : ((rawExec.total_items_with_loss !== undefined && rawExec.total_items_with_loss !== null)
          ? Number(rawExec.total_items_with_loss)
          : lossItems.length),

      total_items_audited_count: (rawExec.audited_items !== undefined && rawExec.audited_items !== null)
        ? Number(rawExec.audited_items)
        : (auditedItems.length > 0 ? auditedItems.length : (allItems.length || Number(rawExec.total_items_audited || 0))),

      total_items_count: (rawExec.total_items_count !== undefined && rawExec.total_items_count !== null)
        ? Number(rawExec.total_items_count)
        : (allItems.length || Number(rawExec.total_items_audited || 0)),

      zero_loss_items_count: (rawExec.zero_loss_items_count !== undefined && rawExec.zero_loss_items_count !== null)
        ? Number(rawExec.zero_loss_items_count)
        : ((rawExec.total_items_without_loss !== undefined && rawExec.total_items_without_loss !== null)
          ? Number(rawExec.total_items_without_loss)
          : zeroItems.length),

      pending_items_count: (rawExec.pending_items !== undefined && rawExec.pending_items !== null)
        ? Number(rawExec.pending_items)
        : pendingItems.length,

      potential_sales_loss: salesCoverageKnown
        ? (lossItems.length > 0 && pricedLossItems.length === 0 ? null : calculatedPotentialSalesLoss)
        : (rawExec.potential_sales_loss !== undefined && rawExec.potential_sales_loss !== null)
        ? Number(rawExec.potential_sales_loss)
        : ((rawExec.total_sales_value_loss !== undefined && rawExec.total_sales_value_loss !== null)
          ? Number(rawExec.total_sales_value_loss)
          : (calculatedPotentialSalesLoss > 0 ? calculatedPotentialSalesLoss : null)),

      uncosted_items_count: (rawExec.uncosted_items_count !== undefined && rawExec.uncosted_items_count !== null)
        ? Number(rawExec.uncosted_items_count)
        : ((rawExec.missing_cost_count !== undefined && rawExec.missing_cost_count !== null)
          ? Number(rawExec.missing_cost_count)
          : uncostedItems.length),

      has_uncosted_loss: Boolean(rawExec.has_uncosted_loss || rawExec.is_partial_impact || uncostedItems.length > 0),
      is_partial_impact: Boolean(rawExec.is_partial_impact || rawExec.has_uncosted_loss || uncostedItems.length > 0),

      manual_cost_items_count: Number(rawExec.manual_cost_items_count ?? manualCostItems.length),
      manual_cost_total_impact: Number(rawExec.manual_cost_total_impact ?? manualCostTotalImpact),

      partial_closure_confirmed: Boolean(rawExec.partial_closure_confirmed),
      partial_closure_confirmed_by: rawExec.partial_closure_confirmed_by,
      partial_closure_confirmed_at: rawExec.partial_closure_confirmed_at,
      partial_closure_justification: rawExec.partial_closure_justification
    };

    // Eficiência Preventiva normalizada e calculada
    const monitoredLossItems = lossItems.filter(i => i.source_type === 'monitored');
    const foundLossItems = lossItems.filter(i => i.source_type === 'audit_found');
    const calcMonitoredCost = monitoredLossItems.reduce((acc, i) => acc + Number(i.financial_cost_impact || 0), 0);
    const calcFoundCost = foundLossItems.reduce((acc, i) => acc + Number(i.financial_cost_impact || 0), 0);
    const calcMonitoredUnits = monitoredLossItems.reduce((acc, i) => acc + Number(i.quantity_audited || 0), 0);
    const calcFoundUnits = foundLossItems.reduce((acc, i) => acc + Number(i.quantity_audited || 0), 0);

    const prevMonitoredCost = Number(rawPrev.monitored_cost_impact ?? calcMonitoredCost);
    const prevFoundCost = Number(rawPrev.found_cost_impact ?? calcFoundCost);
    const prevCostTotal = prevMonitoredCost + prevFoundCost;

    const prev = {
      monitored_products_count: Number(rawPrev.monitored_products_count ?? rawPrev.monitored_items_count ?? monitoredLossItems.length),
      monitored_units: Number(rawPrev.monitored_units ?? rawPrev.monitored_units_with_loss ?? calcMonitoredUnits),
      monitored_cost_impact: prevMonitoredCost,
      monitored_percent: (rawPrev.monitored_percent !== undefined && rawPrev.monitored_percent !== null)
        ? Number(rawPrev.monitored_percent)
        : (prevCostTotal > 0 ? (prevMonitoredCost / prevCostTotal) * 100 : (lossItems.length > 0 ? (monitoredLossItems.length / lossItems.length) * 100 : 100)),

      found_products_count: Number(rawPrev.found_products_count ?? rawPrev.found_in_audit_items_count ?? foundLossItems.length),
      found_units: Number(rawPrev.found_units ?? rawPrev.found_in_audit_units ?? calcFoundUnits),
      found_cost_impact: prevFoundCost,
      found_percent: (rawPrev.found_percent !== undefined && rawPrev.found_percent !== null)
        ? Number(rawPrev.found_percent)
        : (prevCostTotal > 0 ? (prevFoundCost / prevCostTotal) * 100 : (lossItems.length > 0 ? (foundLossItems.length / lossItems.length) * 100 : 0))
    };

    const itemsByReason = {};
    lossItems.forEach(item => {
      const r = item.expiry_reason || 'Sem classificação';
      if (!itemsByReason[r]) itemsByReason[r] = [];
      itemsByReason[r].push(item);
    });

    // Normalização das razões/classificações
    let normalizedReasons = [];
    if (Array.isArray(rawReasons) && rawReasons.length > 0) {
      normalizedReasons = rawReasons.map(r => {
        const reasonName = r.expiry_reason || r.reason || 'Sem classificação';
        const costImpact = Number(r.subtotal_cost_impact ?? r.financial_cost_impact ?? 0);
        const percent = (r.percent_of_total_cost !== undefined && r.percent_of_total_cost !== null)
          ? Number(r.percent_of_total_cost)
          : ((r.percent_of_total_loss !== undefined && r.percent_of_total_loss !== null)
            ? Number(r.percent_of_total_loss)
            : (exec.total_loss_cost > 0 ? (costImpact / exec.total_loss_cost) * 100 : 0));
        return {
          expiry_reason: reasonName,
          products_count: Number(r.products_count ?? r.items_count ?? (itemsByReason[reasonName]?.length || 0)),
          units_audited: Number(r.units_audited ?? r.total_loss_units ?? (itemsByReason[reasonName]?.reduce((a, b) => a + Number(b.quantity_audited || 0), 0) || 0)),
          subtotal_cost_impact: costImpact,
          percent_of_total_cost: percent,
          uncosted_items_count: Number(r.uncosted_items_count || 0)
        };
      });
    } else {
      normalizedReasons = Object.keys(itemsByReason).map(reasonName => {
        const group = itemsByReason[reasonName];
        const units = group.reduce((a, b) => a + Number(b.quantity_audited || 0), 0);
        const cost = group.reduce((a, b) => a + Number(b.financial_cost_impact || 0), 0);
        return {
          expiry_reason: reasonName,
          products_count: group.length,
          units_audited: units,
          subtotal_cost_impact: cost,
          percent_of_total_cost: exec.total_loss_cost > 0 ? (cost / exec.total_loss_cost) * 100 : 0,
          uncosted_items_count: group.filter(i => i.financial_cost_impact === null || i.financial_cost_impact === undefined).length
        };
      });
    }

    const sumItemsImpact = calculatedTotalLossCost;
    const sumReasonsImpact = normalizedReasons.reduce((acc, r) => acc + Number(r.subtotal_cost_impact || 0), 0);

    // Renderiza grupos da memória de cálculo (ANEXO I)
    const calculationMemorySections = Object.keys(itemsByReason).map(reason => {
      const groupItems = itemsByReason[reason];
      const groupUnits = groupItems.reduce((acc, i) => acc + Number(i.quantity_audited || 0), 0);
      let groupCostSum = 0;
      let hasMissingCost = false;

      groupItems.forEach(i => {
        if (i.financial_cost_impact !== null && i.financial_cost_impact !== undefined) {
          groupCostSum += Number(i.financial_cost_impact);
        } else {
          hasMissingCost = true;
        }
      });

      const rowsHtml = groupItems.map(item => {
        const effCost = item.effective_unit_cost !== undefined && item.effective_unit_cost !== null
          ? item.effective_unit_cost
          : (item.cost_source === 'manual' ? item.manual_unit_cost : item.unit_cost_snapshot);

        const costUnitFormatted = effCost !== null && effCost !== undefined
          ? formatBrl(effCost)
          : '<span class="text-warning font-bold">Não apurado</span>';

        const impactFormatted = item.financial_cost_impact !== null && item.financial_cost_impact !== undefined
          ? formatBrl(item.financial_cost_impact)
          : '<span class="text-warning font-bold">Não apurado</span>';

        let originLabel = '';
        if (item.cost_source === 'manual') {
          originLabel = `<span class="badge-tag tag-purple">Manual: ${escapeHtml(item.cost_source_detail || 'Informado')}</span>`;
          if (item.cost_reference_notes) {
            originLabel += `<div class="sub-text italic">${escapeHtml(item.cost_reference_notes)}</div>`;
          }
        } else if (item.unit_cost_snapshot !== null && item.unit_cost_snapshot !== undefined) {
          originLabel = `<span class="badge-tag tag-blue">SG (${escapeHtml(item.financial_snapshot_origin || 'Carga SG')})</span>`;
        } else {
          originLabel = `<span class="badge-tag text-warning">Sem custo</span>`;
        }

        const sourceTag = item.source_type === 'monitored'
          ? '<div class="sub-text">Monitorado</div>'
          : '<div class="sub-text" style="color:#7e22ce; font-weight:600;">Achado físico</div>';

        return `
          <tr>
            <td>
              <strong>${escapeHtml(item.product_name)}</strong>
              ${item.product_code || item.barcode ? `<div class="sub-text">Cód: ${escapeHtml(item.product_code || '—')} • EAN: ${escapeHtml(item.barcode || '—')}</div>` : ''}
              ${item.expiry_reason === 'Outro' && item.expiry_reason_other ? `<div class="sub-text italic">Motivo: ${escapeHtml(item.expiry_reason_other)}</div>` : ''}
              ${sourceTag}
            </td>
            <td class="text-center">${formatDate(item.expiry_date)}</td>
            <td class="text-center"><strong>${formatNumber(item.quantity_audited)}</strong> un.</td>
            <td class="text-right">${costUnitFormatted}</td>
            <td class="text-right font-bold">${impactFormatted}</td>
            <td class="text-center">${originLabel}</td>
            <td>${escapeHtml(item.action_taken || '—')}</td>
          </tr>
        `;
      }).join('');

      return `
        <div class="calc-group-block">
          <div class="calc-group-header">
            <h4>${escapeHtml(reason)}</h4>
            <div class="calc-group-meta">
              <span><strong>${groupItems.length}</strong> produto(s)</span>
              <span><strong>${formatNumber(groupUnits)}</strong> un.</span>
              <span>Impacto: <strong>${formatBrl(groupCostSum)}${hasMissingCost ? ' (*itens sem custo)' : ''}</strong></span>
            </div>
          </div>
          <table class="report-table">
            <thead>
              <tr>
                <th style="width: 32%;">Produto / Identificação</th>
                <th style="width: 10%; text-align: center;">Validade</th>
                <th style="width: 10%; text-align: center;">Quantidade</th>
                <th style="width: 12%; text-align: right;">Custo Unit.</th>
                <th style="width: 12%; text-align: right;">Impacto (Custo)</th>
                <th style="width: 12%; text-align: center;">Origem</th>
                <th style="width: 12%;">Ação Tomada</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
            <tfoot>
              <tr class="subtotal-row">
                <td colspan="2"><strong>SUBTOTAL: ${escapeHtml(reason)}</strong></td>
                <td class="text-center"><strong>${formatNumber(groupUnits)} un.</strong></td>
                <td></td>
                <td class="text-right font-bold"><strong>${formatBrl(groupCostSum)}</strong></td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
        </div>
      `;
    }).join('');

    // Linhas de conciliação matemática (Seção 2)
    const reconciliationRows = normalizedReasons.map(r => `
      <tr>
        <td><strong>${escapeHtml(r.expiry_reason)}</strong></td>
        <td class="text-center">${formatNumber(r.products_count)}</td>
        <td class="text-center">${formatNumber(r.units_audited)} un.</td>
        <td class="text-right font-bold">${r.subtotal_cost_impact > 0 ? formatBrl(r.subtotal_cost_impact) : (r.uncosted_items_count > 0 ? '<span class="text-warning font-bold">Não apurado</span>' : 'R$ 0,00')}</td>
        <td class="text-right">${formatNumber(r.percent_of_total_cost, 1)}%</td>
      </tr>
    `).join('');

    // Linhas do Top Maiores Impactos
    const effectiveTopImpacts = (topImpacts && topImpacts.length > 0)
      ? topImpacts
      : [...lossItems].sort((a, b) => {
          const impactA = Number(a.financial_cost_impact || 0);
          const impactB = Number(b.financial_cost_impact || 0);
          if (impactB !== impactA) return impactB - impactA;
          return Number(b.quantity_audited || 0) - Number(a.quantity_audited || 0);
        }).slice(0, 10);

    const topImpactsRows = effectiveTopImpacts.map((item, idx) => {
      const effCost = item.effective_unit_cost !== undefined && item.effective_unit_cost !== null
        ? item.effective_unit_cost
        : (item.cost_source === 'manual' ? item.manual_unit_cost : item.unit_cost_snapshot);
      const costFormatted = effCost !== null && effCost !== undefined
        ? formatBrl(effCost)
        : '<span class="text-warning">Não apurado</span>';
      
      let originTag = '';
      if (item.cost_source === 'manual') {
        originTag = '<span class="badge-tag tag-purple">Manual</span>';
      } else if (item.unit_cost_snapshot !== null && item.unit_cost_snapshot !== undefined) {
        originTag = '<span class="badge-tag tag-blue">SG</span>';
      } else {
        originTag = '<span class="badge-tag text-warning">Sem custo</span>';
      }

      return `
        <tr>
          <td class="text-center font-bold" style="width: 30px;">#${idx + 1}</td>
          <td>
            <strong>${escapeHtml(item.product_name)}</strong>
            <div class="sub-text">Cód: ${escapeHtml(item.product_code || '—')} • EAN: ${escapeHtml(item.barcode || '—')}</div>
          </td>
          <td class="text-center">${formatDate(item.expiry_date)}</td>
          <td class="text-center"><strong>${formatNumber(item.quantity_audited)}</strong> un.</td>
          <td class="text-right">${costFormatted}</td>
          <td class="text-right font-bold text-danger">${item.financial_cost_impact !== null && item.financial_cost_impact !== undefined ? formatBrl(item.financial_cost_impact) : '<span class="text-warning">Não apurado</span>'}</td>
          <td><span class="badge-tag">${escapeHtml(item.expiry_reason)}</span></td>
          <td class="text-center">${originTag}</td>
        </tr>
      `;
    }).join('');

    // Linhas do Plano de Ação
    const actionPlanRows = (actionPlan || []).map(action => `
      <tr>
        <td><strong>${escapeHtml(action.point)}</strong></td>
        <td>${escapeHtml(action.action)}</td>
        <td>${escapeHtml(action.responsible)}</td>
        <td class="text-center">${formatDate(action.deadline)}</td>
        <td class="text-center"><span class="status-pill status-${String(action.status || '').toLowerCase().includes('concl') ? 'done' : 'pending'}">${escapeHtml(action.status || 'Pendente')}</span></td>
      </tr>
    `).join('');

    // Linhas de Produtos Conferidos sem Perda
    const zeroRows = zeroItems.map(item => `
      <tr>
        <td>
          <strong>${escapeHtml(item.product_name)}</strong>
          <div class="sub-text">Cód: ${escapeHtml(item.product_code || '—')} • EAN: ${escapeHtml(item.barcode || '—')}</div>
        </td>
        <td class="text-center">${formatDate(item.expiry_date)}</td>
        <td class="text-center"><strong style="color: #16a34a;">0 un.</strong></td>
        <td class="text-center"><span class="badge-tag tag-green">Sem perda física</span></td>
        <td>${item.source_type === 'monitored' ? 'Monitorado anteriormente' : 'Auditado'}</td>
      </tr>
    `).join('');

    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Relatorio_Auditoria_${escapeHtml(store.name || 'Loja')}_${escapeHtml(data.competence_month || '')}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 10mm 15mm 10mm;
      @bottom-right {
        content: "Página " counter(page) " de " counter(pages);
        font-size: 8pt;
        color: #64748b;
      }
    }

    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      font-size: 10px;
      line-height: 1.4;
    }

    .no-print {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #0f172a;
      color: #fff;
      padding: 12px 24px;
      position: sticky;
      top: 0;
      z-index: 9999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }
    .no-print button {
      background: #2563eb;
      color: #fff;
      border: 0;
      border-radius: 8px;
      padding: 8px 18px;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .no-print button:hover { background: #1d4ed8; }

    @media print {
      .no-print { display: none !important; }
      body { padding: 0; }
      .page-break { page-break-before: always; }
      .keep-together { break-inside: avoid; page-break-inside: avoid; }
    }

    .report-container {
      max-width: 820px;
      margin: 0 auto;
      padding: 20px;
    }

    /* Cabeçalho Executivo */
    .executive-header {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      border-bottom: 2px solid #0f2744;
      padding-bottom: 14px;
      margin-bottom: 18px;
    }
    .brand-title {
      font-size: 18px;
      font-weight: 900;
      letter-spacing: -0.5px;
      color: #0f2744;
      display: flex;
      align-items: center;
      gap: 8px;
      text-transform: uppercase;
    }
    .brand-title span { color: #0088cc; }
    .report-subtitle {
      font-size: 12px;
      font-weight: 700;
      color: #334155;
      margin-top: 2px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .meta-box {
      text-align: right;
      font-size: 10px;
      color: #475569;
      line-height: 1.5;
    }
    .meta-box strong { color: #0f172a; }
    .badge-status {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      margin-top: 4px;
    }
    .status-completed { background: #dcfce7; color: #15803d; border: 1px solid #86efac; }
    .status-ready { background: #fef3c7; color: #b45309; border: 1px solid #fde68a; }
    .status-open { background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; }

    /* Cards Grandes de KPIs */
    .kpi-cards-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
      margin-bottom: 18px;
    }
    .kpi-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 12px 14px;
      border-left: 4px solid #2563eb;
    }
    .kpi-card.danger { border-left-color: #dc2626; background: #fff5f5; }
    .kpi-card.warning { border-left-color: #ea580c; background: #fffbf5; }
    .kpi-card.success { border-left-color: #16a34a; background: #f6fdf8; }
    .kpi-card.purple { border-left-color: #9333ea; background: #faf5ff; }

    .kpi-value {
      font-size: 20px;
      font-weight: 800;
      color: #0f172a;
      line-height: 1.1;
      margin-bottom: 3px;
    }
    .kpi-card.danger .kpi-value { color: #b91c1c; }
    .kpi-label {
      font-size: 9px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #64748b;
    }
    .kpi-sub {
      font-size: 9px;
      color: #64748b;
      margin-top: 2px;
    }

    /* Seções e Títulos */
    .section-title {
      font-size: 12px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: #0f2744;
      border-bottom: 1.5px solid #cbd5e1;
      padding-bottom: 5px;
      margin-top: 18px;
      margin-bottom: 10px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .section-title span.badge {
      font-size: 9px;
      font-weight: 700;
      color: #64748b;
      text-transform: none;
    }

    /* Tabelas */
    .report-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
      font-size: 9.5px;
    }
    .report-table thead {
      display: table-header-group;
    }
    .report-table th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 800;
      text-transform: uppercase;
      font-size: 8.5px;
      letter-spacing: 0.5px;
      padding: 7px 8px;
      border-top: 1px solid #cbd5e1;
      border-bottom: 1.5px solid #94a3b8;
      text-align: left;
    }
    .report-table td {
      padding: 6px 8px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: middle;
    }
    .report-table tr:nth-child(even) td { background: #fafafa; }
    .subtotal-row td {
      background: #f1f5f9 !important;
      border-top: 1.5px solid #94a3b8;
      border-bottom: 1.5px solid #94a3b8;
      font-weight: 800;
    }

    /* Helpers */
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .font-bold { font-weight: 700; }
    .text-danger { color: #dc2626; }
    .text-warning { color: #d97706; }
    .sub-text { font-size: 8.5px; color: #64748b; }
    .italic { font-style: italic; }

    .badge-tag {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 8.5px;
      font-weight: 700;
      background: #f1f5f9;
      color: #475569;
    }
    .tag-blue { background: #e0f2fe; color: #0369a1; }
    .tag-purple { background: #f3e8ff; color: #7e22ce; }
    .tag-green { background: #dcfce7; color: #15803d; }

    .status-pill {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 999px;
      font-size: 8.5px;
      font-weight: 700;
    }
    .status-done { background: #dcfce7; color: #166534; }
    .status-pending { background: #fef3c7; color: #92400e; }

    /* Eficiência Preventiva */
    .efficiency-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-bottom: 16px;
    }
    .efficiency-card {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 12px;
      background: #fff;
    }
    .efficiency-card h5 {
      margin: 0 0 6px 0;
      font-size: 11px;
      font-weight: 800;
      color: #0f2744;
      display: flex;
      justify-content: space-between;
    }
    .bar-container {
      height: 8px;
      border-radius: 999px;
      background: #e2e8f0;
      overflow: hidden;
      margin-bottom: 8px;
    }
    .bar-fill {
      height: 100%;
      border-radius: 999px;
      background: #2563eb;
    }
    .bar-fill.purple { background: #9333ea; }
    .efficiency-stats {
      display: flex;
      justify-content: space-between;
      font-size: 9.5px;
      color: #475569;
    }

    /* Bloco da memória de cálculo */
    .calc-group-block {
      margin-bottom: 16px;
      page-break-inside: avoid;
    }
    .calc-group-header {
      background: #0f2744;
      color: #fff;
      padding: 6px 10px;
      border-radius: 6px 6px 0 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .calc-group-header h4 {
      margin: 0;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.3px;
    }
    .calc-group-meta {
      display: flex;
      gap: 14px;
      font-size: 9.5px;
      color: #93c5fd;
    }
    .calc-group-meta strong { color: #fff; }

    /* Conciliação */
    .reconciliation-box {
      border: 2px solid #16a34a;
      background: #f0fdf4;
      border-radius: 8px;
      padding: 12px 14px;
      margin-top: 14px;
      margin-bottom: 18px;
      page-break-inside: avoid;
    }
    .reconciliation-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
      font-size: 11px;
      font-weight: 800;
      color: #166534;
    }

    /* Conclusão */
    .conclusion-box {
      background: #f8fafc;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 12px 14px;
      margin-bottom: 16px;
      page-break-inside: avoid;
    }
    .conclusion-row { margin-bottom: 8px; }
    .conclusion-row:last-child { margin-bottom: 0; }
    .conclusion-row strong { color: #0f2744; font-size: 9.5px; display: block; margin-bottom: 2px; }

    /* Assinaturas */
    .signature-area {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 40px;
      margin-top: 36px;
      padding-top: 16px;
      page-break-inside: avoid;
    }
    .signature-line {
      border-top: 1px solid #334155;
      text-align: center;
      padding-top: 6px;
      font-size: 9.5px;
      color: #334155;
    }
    .signature-line strong { display: block; color: #0f172a; font-size: 10.5px; }
  </style>
</head>
<body>
  <div class="no-print">
    <div>
      <strong>Controle de Validades Skalee</strong> • Relatório Mensal de Auditoria (${escapeHtml(store.name || '')} - ${escapeHtml(competenceText)})
    </div>
    <div style="display: flex; gap: 10px;">
      <button type="button" onclick="window.print()">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
        <span>Salvar como PDF / Imprimir</span>
      </button>
      <button type="button" style="background:#475569;" onclick="window.close()">Fechar</button>
    </div>
  </div>

  <div class="report-container">
    <!-- 1. Cabeçalho Executivo -->
    <header class="executive-header">
      <div>
        <div class="brand-title">
          <span>SKALEE</span> CONTROLE DE VALIDADES
        </div>
        <div class="report-subtitle">Relatório Mensal de Auditoria de Validades</div>
        <div style="font-size: 11px; margin-top: 6px; color: #0f172a; font-weight: 700;">
          ${escapeHtml(store.name || 'Loja Não Identificada')} • Competência: ${escapeHtml(competenceText)}
        </div>
      </div>
      <div class="meta-box">
        <div>ID: <strong>${escapeHtml(auditCode)}</strong></div>
        <div>Revisão: <strong>${escapeHtml(revision)}</strong></div>
        <div>Fechamento: <strong>${dates.closed_at ? formatDateTime(dates.closed_at) : 'Em aberto'}</strong></div>
        <div>Responsável: <strong>${escapeHtml(dates.closed_by_email || dates.created_by_email || 'Administração')}</strong></div>
        <span class="badge-status status-${data.status === 'completed' ? 'completed' : data.status === 'ready_for_review' ? 'ready' : 'open'}">
          ${data.status === 'completed' ? '● Finalizada Oficialmente' : data.status === 'ready_for_review' ? '● Pronta para Fechamento' : '● Em Andamento'}
        </span>
      </div>
    </header>

    <!-- 2. Cards Grandes de Indicadores Executivos -->
    <div class="kpi-cards-grid">
      <div class="kpi-card danger">
        <div class="kpi-value">${(exec.total_loss_cost > 0) ? formatBrl(exec.total_loss_cost) : (exec.uncosted_items_count > 0 ? '<span class="text-warning" style="font-size: 18px; font-weight: 800;">Não apurado</span>' : formatBrl(0))}</div>
        <div class="kpi-label">Impacto pelo Custo</div>
        <div class="kpi-sub">${exec.uncosted_items_count > 0 ? `<span style="color:#b45309; font-weight:700;">⚠️ Impacto apurado parcial (${formatNumber(exec.uncosted_items_count)} sem custo)</span>` : 'Total oficial apurado'}</div>
      </div>

      <div class="kpi-card warning">
        <div class="kpi-value">${formatNumber(exec.total_units_audited)} un.</div>
        <div class="kpi-label">Unidades Vencidas</div>
        <div class="kpi-sub">${formatNumber(exec.positive_loss_items_count)} produto(s) com perda</div>
      </div>

      <div class="kpi-card success">
        <div class="kpi-value">${formatNumber(exec.total_items_audited_count)}</div>
        <div class="kpi-label">Produtos Auditados</div>
        <div class="kpi-sub">${formatNumber(exec.zero_loss_items_count)} conferidos sem perda${exec.pending_items_count > 0 ? ` • ${formatNumber(exec.pending_items_count)} pendente(s)` : ''}</div>
      </div>

      <div class="kpi-card purple">
        <div class="kpi-value">${(exec.potential_sales_loss !== null && exec.potential_sales_loss !== undefined) ? formatBrl(exec.potential_sales_loss) : '<span style="color: #64748b; font-size: 18px; font-weight: 700;">Não apurado</span>'}</div>
        <div class="kpi-label">Valor Potencial de Venda${missingSalePriceCount > 0 ? ' — Parcial' : ''}</div>
        <div class="kpi-sub">${salesCoverageKnown ? `${pricedLossItems.length} de ${lossItems.length} produto(s) com perda têm preço${missingSalePriceCount > 0 ? ` • ${missingSalePriceCount} sem preço de venda` : ''}` : 'Cobertura de preços não informada'}</div>
      </div>
    </div>

    <!-- 2.1 Alertas Executivos de Impacto Parcial e Custo Manual -->
    ${(exec.is_partial_impact || exec.has_uncosted_loss || uncostedItems.length > 0) ? `
      <div style="background: #fffbeb; border: 1px solid #fde68a; border-left: 4px solid #f59e0b; padding: 10px 14px; border-radius: 8px; margin-bottom: 14px; font-size: 9.5px; color: #92400e;">
        <strong>⚠️ Alerta de Impacto Financeiro Parcial:</strong> Esta apuração possui <strong>${exec.uncosted_items_count || uncostedItems.length} produto(s)</strong> com perda física confirmada sem custo unitário disponível (impacto registrado como Não Apurado).
        ${exec.partial_closure_confirmed ? `<div style="margin-top: 5px; font-weight: 600; color: #78350f;">✓ Fechamento com impacto parcial aprovado pelo administrador (${escapeHtml(exec.partial_closure_confirmed_by || 'Admin')}${exec.partial_closure_confirmed_at ? ` em ${formatDateTime(exec.partial_closure_confirmed_at)}` : ''}): <em>"${escapeHtml(exec.partial_closure_justification || 'Aprovado fechamento com perdas parciais não apuradas.')}"</em></div>` : ''}
      </div>
    ` : ''}

    ${(exec.manual_cost_items_count > 0) ? `
      <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-left: 4px solid #0284c7; padding: 8px 14px; border-radius: 8px; margin-bottom: 14px; font-size: 9.5px; color: #0369a1;">
        ℹ️ <strong>Custo Manual de Referência:</strong> <strong>${exec.manual_cost_items_count} produto(s)</strong> auditados com custo unitário informado manualmente (Total apurado por custo manual: <strong>${formatBrl(exec.manual_cost_total_impact)}</strong>).
      </div>
    ` : ''}

    <!-- 3. Eficiência Preventiva -->
    <div class="section-title">
      <span>1. Eficiência Preventiva do Controle de Validades</span>
      <span class="badge">Rastreabilidade de Origem</span>
    </div>
    <div class="efficiency-grid">
      <div class="efficiency-card">
        <h5>
          <span>Monitorados Anteriormente</span>
          <span style="color:#2563eb;">${formatNumber(prev.monitored_percent || 0, 1)}%</span>
        </h5>
        <div class="bar-container">
          <div class="bar-fill" style="width: ${Math.min(100, Math.max(0, Number(prev.monitored_percent || 0)))}%;"></div>
        </div>
        <div class="efficiency-stats">
          <span>${formatNumber(prev.monitored_products_count || 0)} produto(s) • ${formatNumber(prev.monitored_units || 0)} un.</span>
          <strong>${formatBrl(prev.monitored_cost_impact || 0)}</strong>
        </div>
      </div>

      <div class="efficiency-card">
        <h5>
          <span>Encontrados Somente na Auditoria</span>
          <span style="color:#9333ea;">${formatNumber(prev.found_percent || 0, 1)}%</span>
        </h5>
        <div class="bar-container">
          <div class="bar-fill purple" style="width: ${Math.min(100, Math.max(0, Number(prev.found_percent || 0)))}%;"></div>
        </div>
        <div class="efficiency-stats">
          <span>${formatNumber(prev.found_products_count || 0)} produto(s) • ${formatNumber(prev.found_units || 0)} un.</span>
          <strong>${formatBrl(prev.found_cost_impact || 0)}</strong>
        </div>
      </div>
    </div>

    <!-- 4. Análise por Motivo -->
    <div class="section-title">
      <span>2. Análise por Motivo da Ocorrência</span>
      <span class="badge">Distribuição Financeira</span>
    </div>
    <table class="report-table">
      <thead>
        <tr>
          <th>Classificação do Motivo</th>
          <th class="text-center" style="width: 15%;">Produtos Afetados</th>
          <th class="text-center" style="width: 15%;">Unidades Físicas</th>
          <th class="text-right" style="width: 20%;">Impacto pelo Custo</th>
          <th class="text-right" style="width: 15%;">% do Impacto</th>
        </tr>
      </thead>
      <tbody>
        ${reconciliationRows || '<tr><td colspan="5" class="text-center">Nenhuma ocorrência registrada.</td></tr>'}
      </tbody>
      <tfoot>
        <tr class="subtotal-row">
          <td><strong>TOTAL CONSOLIDADO</strong></td>
          <td class="text-center"><strong>${formatNumber(exec.positive_loss_items_count)}</strong></td>
          <td class="text-center"><strong>${formatNumber(exec.total_units_audited)} un.</strong></td>
          <td class="text-right font-bold"><strong>${formatBrl(exec.total_loss_cost)}</strong></td>
          <td class="text-right font-bold"><strong>100%</strong></td>
        </tr>
      </tfoot>
    </table>

    <!-- 5. Top Maiores Impactos -->
    ${topImpacts.length > 0 ? `
      <div class="section-title keep-together">
        <span>3. Top Maiores Impactos Financeiros</span>
        <span class="badge">Prioridade de Ação</span>
      </div>
      <table class="report-table keep-together">
        <thead>
          <tr>
            <th class="text-center">#</th>
            <th>Produto / Identificação</th>
            <th class="text-center">Validade</th>
            <th class="text-center">Vencidas</th>
            <th class="text-right">Custo Unit.</th>
            <th class="text-right">Impacto Total</th>
            <th>Motivo</th>
            <th class="text-center">Origem</th>
          </tr>
        </thead>
        <tbody>
          ${topImpactsRows}
        </tbody>
      </table>
    ` : ''}

    <!-- 6. Conclusão da Controladoria -->
    <div class="section-title keep-together">
      <span>4. Conclusão da Auditoria & Parecer da Controladoria</span>
    </div>
    <div class="conclusion-box keep-together">
      <div class="conclusion-row">
        <strong>Resumo Executivo do Mês:</strong>
        <div>${escapeHtml(conclusion.summary) || 'Auditoria física concluída conforme os procedimentos padrão do Controle de Validades.'}</div>
      </div>
      ${conclusion.critical_points ? `
        <div class="conclusion-row">
          <strong>Pontos Críticos Identificados:</strong>
          <div>${escapeHtml(conclusion.critical_points)}</div>
        </div>
      ` : ''}
      ${conclusion.recommendations ? `
        <div class="conclusion-row">
          <strong>Recomendações da Controladoria:</strong>
          <div>${escapeHtml(conclusion.recommendations)}</div>
        </div>
      ` : ''}
      ${conclusion.notes ? `
        <div class="conclusion-row">
          <strong>Observações Complementares:</strong>
          <div>${escapeHtml(conclusion.notes)}</div>
        </div>
      ` : ''}
    </div>

    <!-- 7. Plano de Ação -->
    ${actionPlan && actionPlan.length > 0 ? `
      <div class="section-title keep-together">
        <span>5. Plano de Ação Preventivo</span>
        <span class="badge">Acompanhamento</span>
      </div>
      <table class="report-table keep-together">
        <thead>
          <tr>
            <th style="width: 25%;">Ponto Identificado</th>
            <th style="width: 35%;">Ação Proposta</th>
            <th style="width: 15%;">Responsável</th>
            <th style="width: 12%; text-align: center;">Prazo</th>
            <th style="width: 13%; text-align: center;">Situação</th>
          </tr>
        </thead>
        <tbody>
          ${actionPlanRows}
        </tbody>
      </table>
    ` : ''}

    <div class="page-break"></div>

    <!-- 8. ANEXO I: Memória de Cálculo Auditável por Classificação -->
    <div class="section-title">
      <span>ANEXO I — Memória de Cálculo Auditável por Classificação</span>
      <span class="badge">Rastreabilidade Integral Item a Item</span>
    </div>
    <p style="font-size: 9px; color: #64748b; margin-top: -6px; margin-bottom: 14px;">
      Todos os produtos físicos com quantidade vencida positiva agrupados por classificação de motivo, com memória de cálculo detalhada do custo unitário e impacto financeiro correspondente.
    </p>

    ${calculationMemorySections || '<p class="text-center">Nenhum item com perda física registrado nesta competência.</p>'}

    <!-- 9. Resumo e Conciliação da Memória de Cálculo -->
    <div class="reconciliation-box keep-together">
      <div class="reconciliation-head">
        <span>CONCILIAÇÃO MATEMÁTICA DA MEMÓRIA DE CÁLCULO</span>
        <span class="badge-tag tag-green">✓ 100% Conciliado</span>
      </div>
      <table class="report-table" style="margin-bottom: 6px;">
        <thead>
          <tr>
            <th>Classificação</th>
            <th class="text-center">Produtos</th>
            <th class="text-center">Quantidade</th>
            <th class="text-right">Subtotal pelo Custo</th>
            <th class="text-right">% Impacto</th>
          </tr>
        </thead>
        <tbody>
          ${reconciliationRows}
        </tbody>
        <tfoot>
          <tr class="subtotal-row">
            <td colspan="3"><strong>TOTAL GERAL APURADO (RESUMO EXECUTIVO)</strong></td>
            <td class="text-right font-bold"><strong style="color: #b91c1c;">${formatBrl(exec.total_loss_cost)}</strong></td>
            <td class="text-right font-bold"><strong>100%</strong></td>
          </tr>
        </tfoot>
      </table>
      <div style="font-size: 8.5px; color: #166534; font-weight: 700; margin-top: 4px;">
        ✓ Validação da Controladoria: Soma dos Itens (${formatBrl(sumItemsImpact)}) = Soma dos Subtotais (${formatBrl(sumReasonsImpact)}) = Total Executivo (${formatBrl(exec.total_loss_cost)}).
        ${exec.uncosted_items_count > 0 ? `<div style="color: #b45309; margin-top: 2px;">⚠️ Nota: Apuração com ${formatNumber(exec.uncosted_items_count)} produto(s) com perda sem custo unitário disponível (impacto financeiro parcial apurado).</div>` : ''}
      </div>
    </div>

    <!-- 10. Pendências da Auditoria (se houver itens sem custo) -->
    ${uncostedItems.length > 0 ? `
      <div class="section-title keep-together" style="border-bottom-color: #f59e0b;">
        <span style="color: #b45309;">6. Pendências da Auditoria — Produtos Sem Custo de Referência</span>
        <span class="badge" style="color: #b45309;">Atenção Contábil</span>
      </div>
      <p style="font-size: 9px; color: #b45309; margin-top: -6px; margin-bottom: 8px;">
        Os seguintes produtos apresentaram perda física na auditoria, porém não possuem custo unitário disponível na carga SG nem informado manualmente pelo auditor. O impacto financeiro permanece registrado como "Não apurado" e não foi mascarado como R$ 0,00.
      </p>
      <table class="report-table keep-together">
        <thead>
          <tr>
            <th>Produto</th>
            <th class="text-center">Validade</th>
            <th class="text-center">Quantidade Vencida</th>
            <th class="text-right">Custo Unitário</th>
            <th class="text-right">Impacto Financeiro</th>
            <th>Motivo</th>
          </tr>
        </thead>
        <tbody>
          ${uncostedItems.map(i => `
            <tr>
              <td><strong>${escapeHtml(i.product_name)}</strong></td>
              <td class="text-center">${formatDate(i.expiry_date)}</td>
              <td class="text-center"><strong>${formatNumber(i.quantity_audited)} un.</strong></td>
              <td class="text-right text-warning font-bold">Não apurado</td>
              <td class="text-right text-warning font-bold">Não apurado</td>
              <td>${escapeHtml(i.expiry_reason)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    ` : ''}

    <!-- 11. Produtos Conferidos sem Perda (quantity_audited = 0) -->
    ${zeroItems.length > 0 ? `
      <div class="section-title keep-together">
        <span>7. Produtos Conferidos sem Perda Física (Quantidade = 0)</span>
        <span class="badge">Comprovação de Auditoria</span>
      </div>
      <table class="report-table keep-together">
        <thead>
          <tr>
            <th>Produto / Identificação</th>
            <th class="text-center">Validade</th>
            <th class="text-center">Quantidade Vencida</th>
            <th class="text-center">Resultado Físico</th>
            <th>Origem</th>
          </tr>
        </thead>
        <tbody>
          ${zeroRows}
        </tbody>
      </table>
    ` : ''}

    <!-- 12. Assinatura do Fechamento -->
    <div class="signature-area keep-together">
      <div class="signature-line">
        <strong>${escapeHtml(dates.created_by_email || 'Auditor Responsável')}</strong>
        Auditoria Realizada por
      </div>
      <div class="signature-line">
        <strong>${escapeHtml(dates.closed_by_email || 'Administrador / Controladoria')}</strong>
        Finalizada Oficialmente por • Data: ${dates.closed_at ? formatDate(dates.closed_at) : '__/__/____'}
      </div>
    </div>

    <footer style="margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 8.5px; color: #94a3b8; display: flex; justify-content: space-between;">
      <span>Skalee Controle de Validades • Relatório emitido em ${new Date().toLocaleString('pt-BR')}</span>
      <span>${escapeHtml(auditCode)} • ${escapeHtml(revision)}</span>
    </footer>
  </div>
</body>
</html>`;
  }

  /**
   * Abre o relatório estruturado em nova janela com visualização de impressão e acionamento nativo de PDF
   */
  function openPrintableReportWindow(reportData) {
    const win = window.open('', '_blank');
    if (!win) {
      alert('Permita pop-ups no seu navegador para visualizar e salvar o relatório em PDF.');
      return;
    }
    win.document.write(buildExecutiveAuditHtml(reportData));
    win.document.close();
    try {
      win.focus();
      setTimeout(() => {
        try {
          win.print();
        } catch (_) {}
      }, 450);
    } catch (_) {}
  }

  window.skaleeAuditReport = {
    buildExecutiveAuditHtml,
    openPrintableReportWindow,
    formatBrl,
    formatNumber,
    formatDate,
    formatDateTime
  };
})();
