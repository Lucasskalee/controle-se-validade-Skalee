# Orientações para trabalhar no Skalee

Antes de criar ou alterar qualquer interface (HTML, CSS ou JavaScript de visualização), é **mandatório ler e consultar o [DESIGN.md](DESIGN.md)** e os componentes existentes indicados nele. Utilize o guia para preservar a identidade visual Dark-First proprietária da Skalee, os temas e o comportamento responsivo mobile/desktop.

Regras estritas de Design e Tokens:
- Novos estilos devem utilizar estritamente os tokens oficiais `--sk-*` ou as variáveis legadas autorizadas na camada de compatibilidade do `DESIGN.md`.
- É proibido criar tokens arbitrários fora da convenção ou instalar frameworks externos de UI (como Tailwind, Bootstrap ou Ionic).
- Preserve as áreas de toque mínimas (44 × 44 px), tipografia com números tabulares (`tabular-nums`) e a eliminação de animações rotativas pesadas (`conic-gradient` contínuo).

O projeto usa HTML, CSS e JavaScript Vanilla, com Capacitor no Android. Prefira mudanças localizadas na estrutura atual.

Em alterações visuais, preserve cálculos de validade, contagens, filtros combináveis e fluxos de cadastro. Permissões de Auditoria e Relatórios devem continuar apoiadas no Supabase; a visibilidade de um controle não é uma autorização de acesso.

Execute as verificações adequadas à mudança descritas em `package.json` (incluindo `npm run verify:ui-tokens`, `npm run typecheck`, `npm run test:mobile` e `npm run test:android`) e informe resultados e limitações. Para mudanças apenas na documentação, confira links locais e o diff.

A modernização mobile está em validação local. A instrução atual do usuário é não realizar deploy em produção antes da validação; uma autorização posterior explícita pode alterar essa condição.
