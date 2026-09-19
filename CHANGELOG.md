# Changelog

Todas as alterações relevantes do script são documentadas aqui.

## [8.5] - 2025-01-20

### Adicionado
- Notificação in-app ao atualizar: exibe as novidades da versão com link para o changelog completo

## [8.4] - 2025-01-20

### Adicionado
- Block Length 1.5HR: identifica rotas com duração real ≤ threshold forçadas para 2HR
- Variável `MAX_1_5HR_MIN` configurável em minutos (padrão 90 = 1h30)

## [8.3] - 2025-01-20

### Alterado
- Botão Auto Print reposicionado para canto inferior direito
- Print Log Panel abre acima do botão

## [8.2] - 2025-01-20

### Adicionado
- Auto Print: botão toggle que seleciona e imprime rotas não impressas automaticamente (cooldown 10s)
- Print Log Panel: painel lateral com histórico de impressões persistido em localStorage
- Registro de rotas impressas com código, pacotes, timestamp e status (ok/error)

## [8.0] - 2025-01-19

### Adicionado
- Ciclo (C1–C10): substitui nome da promise window pelo ciclo correspondente
- Packages + Cycle na impressão: injeta contagem de pacotes e ciclo na folha de impressão
- URLs de update migradas para novo repositório GitHub
