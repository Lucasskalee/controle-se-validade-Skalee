# Modal de produto — outubro de 2026

## Arquitetura e preservação

`index.html` mantém abertura, fechamento, permissões, edição, conclusão, exclusão, ofertas, marca, datas e usuário. `product-detail.js` contém cálculos puros, gráfico SVG e navegação. `product-detail.css` define o layout com cabeçalho/rodapé fixos e rolagem apenas nos painéis quando necessária.

`validity_products.quantity` é a quantidade do registro de validade. `product_stock_snapshots.stock_quantity` é o saldo SG por catálogo, loja e dia. O formulário só envia quantidade e alterações de foto para o método existente `updateProduct`. Nenhuma escrita em estoque é adicionada.

O esquema foi inspecionado via consulta somente leitura ao Supabase. Nenhuma migration é necessária. As alterações pré-existentes de importação e primeira carga foram preservadas.

## Dados e fórmulas

- Percentual: quantidade / último estoque SG × 100, com até uma casa decimal. Saldo zero, ausente ou inválido não permite divisão. Valores acima de 100% permanecem visíveis e geram aviso; apenas o desenho do donut é limitado a 100%.
- Tendência: saldo atual menos anterior, sem inferir vendas.
- Histórico: até 90 registros diários mais recentes, filtrados por catálogo e loja resolvidos. Cache por usuário, catálogo, loja e carga, por cinco minutos; invalidado pela importação local. Uma leitura na abertura, nenhuma ao navegar nos slides.
- Saída observada: soma de `max(0, anterior - atual)` entre os registros do período consultado. Não equivale a vendas e difere da variação líquida quando houve reposição.
- Ritmo: saída observada / dias entre primeiro e último registro consultados. Se o histórico não estiver disponível, usa somente a redução entre as duas últimas cargas dividida pelos dias entre elas, explicitamente identificado na interface.
- Projeção: `max(0, quantidade - ritmo × dias restantes)`. No vencimento considera zero dias futuros. Vencidos não recebem projeção. Pressupõe saída prioritária deste lote, sem garantia.

O banco mantém um saldo por produto/loja/dia. Não existe trilha completa de várias cargas no mesmo dia, nem identificação da origem de cada redução ou do lote movimentado. Não é possível calcular vendas, perdas, taxa de giro comercial ou afirmar que um lote saiu. Se faltar catálogo/loja resolvidos, duas datas distintas ou acesso ao histórico, os indicadores dependentes mostram “Dados insuficientes”. O gráfico pode usar primeira/anterior/atual como pontos parciais, com indicação explícita.

O horário da carga é obtido do lote de importação quando disponível; `updated_at` do snapshot é alternativa. A consulta principal pode fornecer somente a data, que é exibida sem inventar horário.

## Imagens

Arquivo e câmera utilizam a mesma compressão existente (WebP com fallback JPEG), bucket privado e URLs assinadas. O arquivo selecionado recebe preview local imediato; salvar é bloqueado durante a conversão. Falha restaura o preview anterior. Revisões descartam resultados de seleções antigas.

Cada upload recebe caminho único dentro da pasta já autorizada do usuário/produto. Assim, falha ao atualizar o registro não sobrescreve o arquivo antigo. O catálogo reutilizável só é atualizado depois do registro. Arquivos antigos não são apagados automaticamente porque podem estar compartilhados; limpeza de órfãos não faz parte desta alteração.

`photo_path = ''` representa remoção explícita neste registro, sem apagar a imagem compartilhada do catálogo. `null` continua significando que pode herdar a imagem do catálogo. Esse estado é tratado no mapeamento e resolução da foto. Não se adiciona Base64 permanente ao banco.

## Verificação

`node tools/test_product_detail.cjs`: fórmulas, ausência de dados, reposição, datas, projeções e imutabilidade do SG.

`node tools/verify_stock_import.js`: regressões de importação/edição e separação SG × validade; percentuais atualizados para uma casa decimal.

`npm run typecheck`: tipos existentes.

`tools/test_product_detail_browser.cjs`: usa uma sessão de navegador de testes via CDP e Playwright disponível no ambiente. Verificou swipe touch emulado, cabeçalho/rodapé fixos, uma única leitura ao navegar, viewport 320 × 568, paisagem 844 × 390, desktop 1366 × 900 e ausência de erros JavaScript.

Também foram exercitados no navegador: navegação por dots, teclado e arraste com mouse; arquivo com preview antes de salvar; percentual 18/47 → 38,3% e 10/47 → 21,3%; falha simulada de upload preservando imagem e SG; nova tentativa bem-sucedida; remoção enviando somente quantidade e ação de imagem. A API desses testes foi simulada, sem gravações em produção. Câmera física e Safari/iOS real não foram usados.

O esquema e as políticas habilitadas de RLS foram conferidos via consultas somente leitura. Upload autenticado real ao Storage não foi executado nesta validação. A publicação em produção não faz parte desta entrega.

## Galeria por código interno

`product-gallery.js` abre uma galeria modal independente ao tocar em “Ver fotos” no cabeçalho. Mantém o slide de informações selecionado ao fechar e permite swipe, arraste, setas e teclado. Escape fecha somente a galeria. A galeria é de consulta: não altera fotos, quantidades ou datas.

`loadProductGallery` usa igualdade exata de `validity_products.product_code` e `catalog_products.internal_code`. Preserva letras, maiúsculas e zeros: `F7` não é `7` nem `F70`. Sem código, usa apenas o vínculo de catálogo; sem ambos, não consulta fotos de outros produtos. As consultas usam o cliente autenticado e RLS existente. Não listam objetos soltos no bucket.

Reaproveita caminhos e URLs assinadas existentes. Deduplica por caminho do Storage ou URL idêntica; não compara pixels de uploads diferentes. Cache por usuário/código/catálogo de 60 segundos, limpo na troca de usuário e edição de imagens. Busca até 100 registros de validade e 20 de catálogo; ao atingir o limite, ou ocorrer falha parcial, informa que exibe as fotos disponíveis da consulta. Pode incluir registros concluídos se o usuário tem acesso a eles. Imagens órfãs, sem vínculo em registros/catálogo, não são recuperadas.

O código 21421 da referência foi consultado sem alterações: três registros, um caminho distinto de foto. Isso resulta em uma imagem, não em três cópias. Novos códigos com múltiplos caminhos distintos formam a galeria.

`node tools/test_product_gallery.cjs` verifica código alfanumérico exato, deduplicação, isolamento do cache por usuário e remoção explícita. O teste de navegador inclui galeria com duas imagens claramente identificadas como testes, swipe/setas, ausência de escrita, fechamento preservando detalhes e erro de consulta preservando a foto atual.
