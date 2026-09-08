# 🚚 Tampermonkey Route Sheet Scripts

Userscripts para aprimorar a interface do Route Sheet (SSD).

## Scripts

### Route Sheet - Enhanced View VSP4

Adiciona informações operacionais à interface do Route Sheet:

- **Ciclo (C1–C10)** — substitui o nome da promise window pelo ciclo correspondente
- **Block Length 1.5HR** — identifica rotas com duração real ≤ 1h30 que o sistema forçou para 2HR
- **Packages + Cycle na impressão** — injeta contagem de pacotes e ciclo na folha de impressão

## Instalação

1. Instale o [Tampermonkey](https://www.tampermonkey.net/)
2. Clique no link abaixo para instalar o script:

   **[⬇️ Instalar route-sheet-enhanced.user.js](https://raw.githubusercontent.com/selmobe/tampermonkey-route-sheet/main/scripts/route-sheet-enhanced/route-sheet-enhanced.user.js)**

3. O Tampermonkey abrirá a tela de instalação — clique em **Install**

## Atualização Automática

O script se atualiza automaticamente via Tampermonkey. Para garantir:

1. Tampermonkey → **Settings** → **Updates**
2. Defina **Check Interval** para `Every day` (ou menor)
3. As atualizações são baixadas automaticamente do branch `main`

Para forçar atualização manual: Tampermonkey → **Installed Userscripts** → clique no script → aba **Settings** → **Check for update**

## Branches

| Branch | Uso |
|--------|-----|
| `main` | Versão estável — auto-update aponta aqui |
| `dev` | Versões em teste — instalar manualmente |

### Instalar versão de teste (dev)

```
https://raw.githubusercontent.com/selmobe/tampermonkey-route-sheet/dev/scripts/route-sheet-enhanced/route-sheet-enhanced.user.js
```

> ⚠️ Para usar a branch `dev`, altere manualmente as URLs `@updateURL` e `@downloadURL` no script instalado.

## Versionamento

Ao publicar uma atualização, **sempre incremente** o `@version` no header do `.user.js` e `.meta.js`. O Tampermonkey compara versões para decidir se atualiza.

```
// @version      8.0  →  8.1
```
