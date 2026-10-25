# Controle de Validade Skalee

Sistema para controle de validade e prevenção de perdas de mercadorias em supermercados.

O aplicativo consulta o catálogo de produtos no Supabase, registra produtos e validades no Supabase e oferece relatórios por loja, seleção de produtos e perfis de acesso.

## Como executar

Inicie um servidor HTTP na pasta do projeto:

```powershell
python -m http.server 8000
```

Depois, abra `http://localhost:8000` no navegador.

Autenticação, catálogo de produtos, produtos registrados e permissões são gerenciados pelo Supabase.

## Documentação

- [Arquitetura do módulo de promotores](docs/arquitetura-promotores.md)
- [Android com Capacitor: build, recuperação e validações](docs/android-capacitor.md)
- [Guia de interface do Skalee](DESIGN.md)
- [Validação da modernização mobile](docs/mobile-interface-validation.md)

## Referência de design

O projeto adota o formato `DESIGN.md` apresentado pela coleção
[awesome-design-md, da VoltAgent](https://github.com/VoltAgent/awesome-design-md).
O [guia local](DESIGN.md) descreve as cores, os componentes e a navegação do
Skalee para orientar futuras alterações de interface. O arquivo
[AGENTS.md](AGENTS.md) direciona agentes de desenvolvimento a consultar esse guia.

Para usar, peça: “Siga o DESIGN.md do Skalee ao implementar esta tela”.
Essa integração é documental, sem dependências novas ou sincronização automática
com o repositório externo. As alterações visuais continuam sendo implementadas
e validadas no código do aplicativo.
