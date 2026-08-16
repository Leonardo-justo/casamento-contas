# Casamento Contas

Controle local de fornecedores e pagamentos do casamento de Leonardo e Bruna.

## Executar

Requer Node.js 18 ou superior.

```powershell
cd C:\Projeto-Github\casamento-contas
npm start
```

Abra `http://127.0.0.1:4301`.

## GitHub Pages

A versão publicada funciona sem servidor e salva as alterações somente no
navegador de quem estiver usando. Na primeira abertura, ela carrega os dados de
`data/contas.json`. Depois disso, o navegador mantém a cópia mais recente.

Para publicar:

1. Crie um repositório e envie este projeto para a branch `main`.
2. No GitHub, abra **Settings > Pages**.
3. Em **Source**, selecione **GitHub Actions**.
4. O workflow `Publicar no GitHub Pages` fará a publicação.

Ao terminar uma sessão de alterações, use **Baixar backup**. O arquivo baixado é
a única forma de transferir as alterações para outro navegador ou aparelho.

## Onde os dados ficam

Localmente, com `npm start`, o arquivo principal é `data/contas.json`. No GitHub
Pages, as alterações ficam no armazenamento do navegador e não modificam o
repositório.

Na primeira abertura na porta 4301, se o JSON estiver vazio e houver dados da
versão antiga no navegador, eles serão migrados automaticamente e um backup será
baixado.

Use **Dados e backup > Baixar JSON** para manter cópias externas periódicas.

## Relatórios

- **Exportar CSV** gera as contas do mês selecionado para abrir no Excel.
- **Imprimir relatório** abre a impressão do navegador e permite salvar em PDF.
- **Relatório total** mostra contrato, histórico pago, datas e saldo de cada
  fornecedor, com opção de incluir ou ocultar o total geral.

## Versão anterior

Os arquivos anteriores à migração estão em `backups/original-2026-08-13`.
