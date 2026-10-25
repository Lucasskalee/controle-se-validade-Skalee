# Titanium Glass 2.4 — Checklist de homologação Android

## Status do artefato

- `webDir`: `dist`
- SDK Android: `android-36` disponível
- Build-tools: `35.0.0` e `36.0.0` disponíveis
- Gradle wrapper: `8.14.3`
- APK debug novo: gerado em `android/app/build/outputs/apk/debug/app-debug.apk`
- applicationId/version: `dev.skalee.validades` / `1.0` (`versionCode 1`)
- SHA-256: `7E9CBC7824164EF107F761F15C6F5A3268CAB2240EADC6A1ABAE185FA80466AC`
- Dados fictícios: restritos ao fixture `tools/validate_real_titanium.cjs`

## Testes no dispositivo físico

- [ ] Instalar o APK debug de homologação
- [ ] Inicialização e splash sem tela branca
- [ ] Login, logout e recuperação de sessão
- [ ] Home: contadores, loja selecionada e cards
- [ ] Produtos: busca, filtros, datas, quantidades, oferta e rolagem
- [ ] Cadastro e edição de produto
- [ ] Perfil → Aparência → Temas Skalee
- [ ] Dark, Light, Glass, Industrial, Creative e Executive
- [ ] Fundos Sólido, Texturizado e Dinâmico
- [ ] Aurora WebGL disponível
- [ ] Fallback CSS sem WebGL
- [ ] Modo Econômico
- [ ] `prefers-reduced-motion`
- [ ] Scanner/câmera e permissões
- [ ] Armazenamento local e retomada após reinício
- [ ] Skalito: abertura, fechamento e sobreposição correta
- [ ] Desempenho, rolagem e responsividade em 393×852
- [ ] Auditoria e Relatórios conforme permissões
- [ ] Indicadores de validade preservam seus significados em todos os temas

## Verificações automatizadas desta preparação

- `npm run verify:ui-tokens`: aprovado
- `npm run typecheck`: aprovado
- `node tools/verify_android_web.cjs`: aprovado
- `npm run test:android`: aprovado anteriormente
- `npm run test:mobile`: navegação aprovada; etapa visual limitada por `Chrome page target must be available`
- `gradlew :app:assembleDebug --no-daemon`: aprovado com JDK Temurin 21.0.12.1
