# Skalee Validades Android — fundação e câmera

Estado validado em 16/10/2026, na branch `feat/android-capacitor`. Não houve push,
deploy, publicação, migração de banco ou alteração da importação SG.

## Estrutura preservada

A aplicação continua em HTML, CSS e JavaScript. `npm start`, `npm run build`
e `npm run typecheck` mantêm seus significados anteriores. O build TypeScript
continua emitindo os dois módulos existentes na raiz.

`npm run build:web` compila TypeScript e empacota uma lista explícita de arquivos
em `dist`. O build não copia `.env`, ferramentas administrativas, SQL, relatórios,
arquivos de desenvolvimento ou o repositório inteiro. Componentes, imagens,
ícones e fontes locais são incluídos. O Supabase continua usando a URL e a chave
publicável existentes; não são incluídas credenciais administrativas.

O APK usa os arquivos empacotados, não a URL de produção. A configuração é
`appId: dev.skalee.validades`, nome `Skalee Validades`, `webDir: dist`, origem
Android HTTPS local. O identificador ainda deve ser confirmado antes da publicação.

Bibliotecas locais da distribuição:

| Biblioteca | Versão |
| --- | --- |
| Capacitor core/android/CLI | 8.5.3 |
| Capacitor App | 8.1.2 |
| Capacitor Camera | 8.2.5 |
| Supabase JS | 2.55.0, igual à versão do CDN anterior |
| ZXing Browser | 0.2.1 |
| html5-qrcode | 2.3.8 |

O empacotador esbuild inclui Supabase e os proxies JavaScript dos plugins nativos.
O código servido diretamente da raiz mantém as URLs CDN anteriores; somente a
distribuição usa as substituições locais. Nenhuma biblioteca de inicialização do
`dist/index.html` depende de CDN. Consultas ao Supabase e a catálogos externos ainda
precisam de rede. Não foram alterados paginação, cache dos cards ou filtros.

## Rascunhos e recuperação

`product-drafts.js` usa um IndexedDB separado, `skalee-registration-drafts`.
Isso não altera tabelas Supabase nem a versão do armazenamento local anterior.
`registration-draft-ui.js` integra o formulário existente e a identidade UUID
informada pelo evento de autenticação. Senhas e tokens não são guardados no rascunho.

- Campos são persistidos durante a edição, por usuário e loja; seleção sem loja
  tem um espaço temporário até a primeira escolha.
- A imagem original é guardada antes da compressão. Depois, preserva-se o Blob
  comprimido e seus metadados; URLs `blob:` são reconstruídas ao restaurar.
- A compressão existente mantém WebP/JPEG, até 1024 px inicialmente e alvo de
  180 KiB. A captura nativa pede até 1600 px para reduzir pressão de memória.
- Antes de enviar o cadastro, grava-se um checkpoint. Depois do INSERT confirmado,
  grava-se o ID antes do upload. Uma falha da foto permite repetir apenas a atualização
  do produto já criado, com um identificador estável para o objeto de Storage.
- Cadastros offline conservam cópias separadas até a confirmação da sincronização,
  permitindo registrar outros produtos. O botão de pendências permite recuperar
  falhas de foto ou envios com resultado incerto.
- A fila ignora novos cadastros pertencentes a outro UUID. Essa marcação cobre os
  cadastros novos desta implementação; filas antigas sem identificação não foram migradas.
- Resposta perdida durante INSERT não permite repetição automática. Não há garantia
  transacional entre servidor e IndexedDB: nessa situação o operador deve conferir
  a lista e confirmar a ausência do cadastro antes de liberar uma nova tentativa.
- Rascunhos pendentes não são eliminados ao sair da conta. A limpeza explícita é
  permitida para formulários sem envio pendente. Desinstalar o aplicativo ou limpar
  seus dados remove o armazenamento local; ele não é um backup remoto.

## Câmera e scanner

`native-camera.js` intercepta a foto do **novo cadastro** apenas em plataforma
nativa. O seletor web/PWA permanece. Antes de abrir a câmera, a loja deve estar
selecionada e o rascunho deve ter sido persistido com um ticket de captura.

O plugin App recebe `appRestoredResult`. O ticket vincula a foto ao usuário e à
loja de origem; primeiro se persiste a URI, depois o File em IndexedDB, antes de
decodificar a imagem. Resultados já consumidos são ignorados. A imagem não é
aplicada a uma conta ou loja diferente. Cancelamento mantém os campos; erros de
permissão apresentam mensagem. Nenhuma foto é salva automaticamente na galeria.

O scanner continua usando o fluxo existente (BarcodeDetector/ZXing/html5-qrcode).
O Manifest declara CAMERA e hardware opcional; o WebChromeClient do Capacitor
faz a solicitação de acesso do `getUserMedia`. Ao ir para segundo plano, o fluxo
solicita a parada do scanner e a persistência dos campos. A leitura real de códigos,
foco, flash e rotação ainda precisam de teste em dispositivos.

Fotos na edição de um produto existente continuam no fluxo web. A recuperação
durável desta entrega cobre o formulário de novo cadastro, não o modal de edição.

## Comandos

```powershell
npm ci
npm run typecheck
npm run build:web
npm run android:sync
npm run test:android
npm run test:android:browser
npm run android:open
```

O teste de navegador exige Chrome, usa perfil temporário e backend simulado e
bloqueia chamadas externas. `CHROME_PATH` permite informar outro caminho.
`TEST_WEB_ROOT=.` permite executar o mesmo teste sobre a versão web da raiz.

## Ambiente para o APK

O projeto gerado usa JDK **21**, Android SDK **36**, minSdk **24** (Android 7),
Gradle wrapper **8.14.3** e Android Gradle Plugin **8.13.0**.
Instale Android Studio 2025.2.1 ou superior compatível com Capacitor 8; configure
o Gradle JDK 21 e instale SDK Platform 36, Build Tools e Platform Tools.

Nesta máquina, `java` e `adb` não foram encontrados no PATH, Android Studio e SDK
não foram encontrados nos caminhos padrão consultados. `assembleDebug` foi
tentado e parou com `JAVA_HOME is not set and no 'java' command could be found`.
O projeto ainda **não foi compilado em APK**.

Após instalar/localizar as ferramentas, configure `JAVA_HOME` para o JDK 21 e
o caminho do SDK no Android Studio ou em `android/local.properties` (`sdk.dir`).
Esse arquivo é local e ignorado pelo Git. Em seguida:

```powershell
npm run android:sync
.\android\gradlew.bat -p android assembleDebug
```

Saída esperada: `android/app/build/outputs/apk/debug/app-debug.apk`.
Não há assinatura de produção, keystore ou configuração de publicação.
Os arquivos de launcher/splash nativos ainda são os padrões do template Capacitor;
os ícones Skalee da interface web já estão no pacote. Revisar a identidade nativa
antes de distribuir o APK externamente.

## Validações e limites

Passaram: TypeScript, build de distribuição, `cap sync android` reconhecendo App
e Camera, verificação de caminhos e bibliotecas locais, armazenamento de rascunhos,
testes simulados de câmera, segurança do fluxo de salvamento, detalhes de produtos,
galeria e relatório de preços de auditoria. O teste de navegador cobre recarga,
usuário/loja, Blob, compressão real, múltiplos cadastros offline, recuperação de
upload e bloqueio de repetição em resultado incerto.

O teste existente `test_notification_center.cjs` falha na presença/animação do
mascote da comemoração. A mesma falha foi reproduzida usando os arquivos originais
do HEAD em uma cópia temporária. Os números do checklist passaram até essa asserção;
a suíte completa de notificações não está aprovada.

O audit das dependências de execução (`npm audit --omit=dev`) retornou **0** avisos.
O audit completo consultado retornou 37 (1 baixo, 11 moderados, 24 altos, 1 crítico),
incluindo `tar` na cadeia de ferramentas Vercel e `xcode` na CLI Capacitor.
Não foi executado `npm audit fix --force` nem alterada a versão Vercel.

Ainda não validados: login real em dispositivo, políticas e upload reais do Supabase,
APK/Gradle, câmera física, encerramento real do processo e scanner físico. Os testes
não escreveram registros em produção. A central interna de notificações e a PWA
foram preservadas; alertas do sistema Android fora da WebView requerem uma próxima
integração nativa. A navegação inferior planejada também não foi reformulada aqui.

Referências: [instalação Capacitor](https://capacitorjs.com/docs/getting-started),
[ambiente](https://capacitorjs.com/docs/getting-started/environment-setup),
[Camera](https://capacitorjs.com/docs/apis/camera), [App](https://capacitorjs.com/docs/apis/app).
