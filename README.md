# Controle de Validade Skalee

Sistema para controle de validade e prevenção de perdas de mercadorias em supermercados.

O aplicativo consulta o catálogo `consulta03.dbf`, registra produtos e validades no Supabase e oferece relatórios por loja, seleção de produtos e perfis de acesso.

## Como executar

Inicie um servidor HTTP na pasta do projeto:

```powershell
.\.venv\Scripts\python.exe -m http.server 8000
```

Depois, abra `http://localhost:8000` no navegador.

O DBF é usado somente como catálogo de consulta e seu arquivo original não é modificado. Autenticação, produtos e permissões são gerenciados pelo Supabase.
