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
