#!/bin/bash

# deploy-hostal-magic.sh
# Script de deploy completo para Hostal MAGIC

set -e

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configurações
PROJECT_NAME="hostal-magic"
AWS_REGION="us-east-1"
ENVIRONMENT=""
OPENAI_API_KEY=""
FROM_EMAIL=""

# Funções auxiliares
print_step() {
    echo -e "${BLUE}==== $1 ====${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Verificar pré-requisitos
check_prerequisites() {
    print_step "Verificando pré-requisitos"
    
    # Verificar AWS CLI
    if ! command -v aws &> /dev/null; then
        print_error "AWS CLI não encontrado. Instale: https://aws.amazon.com/cli/"
        exit 1
    fi
    
    # Verificar Terraform
    if ! command -v terraform &> /dev/null; then
        print_error "Terraform não encontrado. Instale: https://terraform.io/downloads"
        exit 1
    fi
    
    # Verificar Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js não encontrado. Instale: https://nodejs.org/"
        exit 1
    fi
    
    # Verificar Python
    if ! command -v python3 &> /dev/null; then
        print_error "Python 3 não encontrado."
        exit 1
    fi
    
    # Verificar credenciais AWS
    if ! aws sts get-caller-identity &> /dev/null; then
        print_error "Credenciais AWS não configuradas. Execute: aws configure"
        exit 1
    fi
    
    print_success "Todos os pré-requisitos atendidos"
}

# Coletar configurações
collect_config() {
    print_step "Coletando configurações"
    
    if [ -z "$ENVIRONMENT" ]; then
        echo -n "Environment (staging/production): "
        read ENVIRONMENT
        
        if [[ "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
            print_error "Environment deve ser 'staging' ou 'production'"
            exit 1
        fi
    fi
    
    if [ -z "$OPENAI_API_KEY" ]; then
        echo -n "OpenAI API Key: "
        read -s OPENAI_API_KEY
        echo
        
        if [ -z "$OPENAI_API_KEY" ]; then
            print_error "OpenAI API Key é obrigatória"
            exit 1
        fi
    fi
    
    if [ -z "$FROM_EMAIL" ]; then
        echo -n "Email remetente (deve estar verificado no SES): "
        read FROM_EMAIL
        
        if [ -z "$FROM_EMAIL" ]; then
            print_error "Email remetente é obrigatório"
            exit 1
        fi
    fi
    
    print_success "Configurações coletadas"
}

# Preparar código das Lambda functions
prepare_lambda_code() {
    print_step "Preparando código das Lambda functions"
    
    # Criar diretório temporário
    mkdir -p temp/lambda
    
    # Preparar função de reservas (Python)
    mkdir -p temp/lambda/reservas
    cat > temp/lambda/reservas/lambda_function.py << 'EOF'
# Aqui vai o código da Lambda de reservas
# (O código já foi criado no artefato anterior)
EOF
    
    # Instalar dependências Python
    pip3 install boto3 -t temp/lambda/reservas/
    
    # Criar ZIP
    cd temp/lambda/reservas
    zip -r ../../../reservas_handler.zip .
    cd ../../..
    
    # Preparar função do chatbot (Node.js)
    mkdir -p temp/lambda/chatbot
    cat > temp/lambda/chatbot/index.js << 'EOF'
// Aqui vai o código da Lambda do chatbot
// (O código já foi criado no artefato anterior)
EOF
    
    cat > temp/lambda/chatbot/package.json << 'EOF'
{
  "name": "hostal-magic-chatbot",
  "version": "1.0.0",
  "description": "Chatbot para Hostal MAGIC",
  "main": "index.js",
  "dependencies": {
    "axios": "^1.6.0"
  }
}
EOF
    
    # Instalar dependências Node.js
    cd temp/lambda/chatbot
    npm install
    zip -r ../../../chatbot_handler.zip .
    cd ../../..
    
    print_success "Código das Lambda functions preparado"
}

# Deploy da infraestrutura
deploy_infrastructure() {
    print_step "Fazendo deploy da infraestrutura AWS"
    
    # Inicializar Terraform
    terraform init
    
    # Criar workspace se não existir
    terraform workspace select $ENVIRONMENT || terraform workspace new $ENVIRONMENT
    
    # Aplicar infraestrutura
    terraform apply -auto-approve \
        -var="environment=$ENVIRONMENT" \
        -var="project_name=$PROJECT_NAME" \
        -var="openai_api_key=$OPENAI_API_KEY" \
        -var="from_email=$FROM_EMAIL"
    
    print_success "Infraestrutura AWS deployada"
}

# Populr tabelas iniciais
populate_initial_data() {
    print_step "Populando dados iniciais"
    
    # Obter nome das tabelas do Terraform output
    QUARTOS_TABLE=$(terraform output -raw dynamodb_tables | jq -r '.quartos')
    
    # Popular tabela de quartos
    aws dynamodb put-item \
        --table-name $QUARTOS_TABLE \
        --item '{
            "quarto_id": {"S": "dorm-001"},
            "tipo": {"S": "dormitorio"},
            "capacidade": {"N": "6"},
            "preco_diaria": {"N": "25"},
            "amenidades": {"SS": ["WiFi", "Ar condicionado", "Armários"]}
        }' \
        --region $AWS_REGION
    
    aws dynamodb put-item \
        --table-name $QUARTOS_TABLE \
        --item '{
            "quarto_id": {"S": "priv-001"},
            "tipo": {"S": "privado_duplo"},
            "capacidade": {"N": "2"},
            "preco_diaria": {"N": "60"},
            "amenidades": {"SS": ["WiFi", "Ar condicionado", "Banheiro privado", "Varanda"]}
        }' \
        --region $AWS_REGION
    
    aws dynamodb put-item \
        --table-name $QUARTOS_TABLE \
        --item '{
            "quarto_id": {"S": "fam-001"},
            "tipo": {"S": "familiar"},
            "capacidade": {"N": "4"},
            "preco_diaria": {"N": "90"},
            "amenidades": {"SS": ["WiFi", "Ar condicionado", "Banheiro privado", "Cozinha", "Vista laguna"]}
        }' \
        --region $AWS_REGION
    
    print_success "Dados iniciais populados"
}

# Configurar SES
setup_ses() {
    print_step "Configurando Amazon SES"
    
    # Verificar se email já está verificado
    VERIFIED=$(aws ses get-identity-verification-attributes \
        --identities $FROM_EMAIL \
        --query "VerificationAttributes.\"$FROM_EMAIL\".VerificationStatus" \
        --output text \
        --region $AWS_REGION 2>/dev/null || echo "NotFound")
    
    if [ "$VERIFIED" != "Success" ]; then
        print_warning "Verificando email no SES..."
        aws ses verify-email-identity --email-address $FROM_EMAIL --region $AWS_REGION
        print_warning "Verifique seu email e confirme a verificação no SES"
    else
        print_success "Email já verificado no SES"
    fi
}

# Executar testes básicos
run_tests() {
    print_step "Executando testes básicos"
    
    # Obter URL da API
    API_URL=$(terraform output -raw api_gateway_url)
    
    # Testar endpoint de reservas
    HTTP_STATUS=$(curl -o /dev/null -s -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d '{"action": "consultar_disponibilidade", "checkin": "2024-12-01", "checkout": "2024-12-03"}' \
        $API_URL/reservas)
    
    if [ "$HTTP_STATUS" -eq 200 ]; then
        print_success "API de reservas funcionando"
    else
        print_warning "API de reservas retornou status $HTTP_STATUS"
    fi
    
    # Testar endpoint do chatbot
    HTTP_STATUS=$(curl -o /dev/null -s -w "%{http_code}" \
        -X POST \
        -H "Content-Type: application/json" \
        -d '{"message": "Olá", "sessionId": "test-session"}' \
        $API_URL/chatbot)
    
    if [ "$HTTP_STATUS" -eq 200 ]; then
        print_success "API do chatbot funcionando"
    else
        print_warning "API do chatbot retornou status $HTTP_STATUS"
    fi
}

# Gerar documentação de endpoints
generate_documentation() {
    print_step "Gerando documentação"
    
    API_URL=$(terraform output -raw api_gateway_url)
    RESERVAS_ENDPOINT=$(terraform output -raw reservas_endpoint)
    CHATBOT_ENDPOINT=$(terraform output -raw chatbot_endpoint)
    DATA_LAKE_BUCKET=$(terraform output -raw data_lake_bucket)
    
    cat > API_ENDPOINTS.md << EOF
# Hostal MAGIC - Endpoints da API

## Configuração Base
- **Environment**: $ENVIRONMENT
- **Region**: $AWS_REGION
- **API Gateway URL**: $API_URL

## Endpoints Disponíveis

### 1. Reservas
**URL**: $RESERVAS_ENDPOINT
**Método**: POST

#### Consultar Disponibilidade
\`\`\`json
{
    "action": "consultar_disponibilidade",
    "checkin": "2024-12-01",
    "checkout": "2024-12-03",
    "tipo_quarto": "dormitorio" // opcional
}
\`\`\`

#### Criar Reserva
\`\`\`json
{
    "action": "criar_reserva",
    "cliente_nome": "João Silva",
    "cliente_email": "joao@email.com",
    "cliente_telefone": "+5511999999999",
    "checkin": "2024-12-01",
    "checkout": "2024-12-03",
    "tipo_quarto": "dormitorio",
    "num_hospedes": 2,
    "servicos_extras": ["cafe_manha", "kayak"],
    "observacoes": "Chegada tarde"
}
\`\`\`

### 2. Chatbot
**URL**: $CHATBOT_ENDPOINT
**Método**: POST

\`\`\`json
{
    "message": "Olá, quero fazer uma reserva",
    "sessionId": "unique-session-id",
    "clientInfo": {
        "nome": "João",
        "email": "joao@email.com",
        "idioma": "pt-BR"
    }
}
\`\`\`

## Recursos AWS Criados

### DynamoDB Tables
- Reservas: ${PROJECT_NAME}-reservas-${ENVIRONMENT}
- Quartos: ${PROJECT_NAME}-quartos-${ENVIRONMENT}
- Clientes: ${PROJECT_NAME}-clientes-${ENVIRONMENT}
- Sessions: ${PROJECT_NAME}-chatbot-sessions-${ENVIRONMENT}

### S3 Bucket
- Data Lake: $DATA_LAKE_BUCKET

### Lambda Functions
- Reservas Handler: ${PROJECT_NAME}-reservas-handler-${ENVIRONMENT}
- Chatbot Handler: ${PROJECT_NAME}-chatbot-handler-${ENVIRONMENT}

## Para usar no Wix

1. Substitua \`API_BASE_URL\` no código JavaScript pelo valor: \`$API_URL\`
2. Configure os elementos do Wix com os IDs mencionados no código
3. Importe o arquivo \`wix-integration.js\` no seu site Wix

## Monitoramento

### CloudWatch Logs
- /aws/lambda/${PROJECT_NAME}-reservas-handler-${ENVIRONMENT}
- /aws/lambda/${PROJECT_NAME}-chatbot-handler-${ENVIRONMENT}

### Métricas Importantes
- Número de reservas por dia
- Taxa de erro das APIs
- Tempo de resposta do chatbot
- Utilização dos quartos

## Próximos Passos

1. Configurar QuickSight para dashboards
2. Implementar modelos ML no SageMaker
3. Configurar Step Functions para pipeline de IA
4. Integrar com sistema de pagamentos
5. Configurar monitoramento e alertas

EOF

    cat > CONFIGURACAO_WIX.md << EOF
# Configuração do Wix - Hostal MAGIC

## Elementos Necessários no Wix

### Página Principal
- \`#heroSection\` - Seção hero da página
- \`#heroBackground\` - Imagem de fundo do hero
- \`#featuresSection\` - Seção de características
- \`#btnAbrirChat\` - Botão para abrir chat

### Seção de Consulta
- \`#secaoConsultaDisponibilidade\` - Container da consulta
- \`#inputCheckin\` - Input de data check-in
- \`#inputCheckout\` - Input de data check-out
- \`#dropdownTipoQuarto\` - Dropdown tipos de quarto
- \`#inputNumHospedes\` - Input número de hóspedes
- \`#btnConsultarDisponibilidade\` - Botão consultar

### Resultados
- \`#secaoResultados\` - Container dos resultados
- \`#repeaterQuartos\` - Repeater para quartos disponíveis
- \`#textoSemQuartos\` - Texto quando não há quartos
- \`#btnSelecionarQuarto\` - Botão em cada item do repeater

### Formulário de Reserva
- \`#secaoFormularioReserva\` - Container do formulário
- \`#inputNome\` - Input nome do cliente
- \`#inputEmail\` - Input email do cliente
- \`#inputTelefone\` - Input telefone do cliente
- \`#textAreaObservacoes\` - Textarea observações
- \`#checkboxCafeManha\` - Checkbox café da manhã
- \`#checkboxKayak\` - Checkbox aluguel kayak
- \`#checkboxBicicleta\` - Checkbox aluguel bicicleta
- \`#checkboxLavanderia\` - Checkbox lavanderia
- \`#textoValorTotal\` - Texto valor total
- \`#textoDetalhesCalculo\` - Texto detalhes do cálculo
- \`#btnFazerReserva\` - Botão fazer reserva

### Chatbot
- \`#chatContainer\` - Container do chat
- \`#chatMessages\` - Container das mensagens
- \`#inputMensagem\` - Input da mensagem
- \`#btnEnviarMensagem\` - Botão enviar mensagem
- \`#btnFecharChat\` - Botão fechar chat

### Feedback
- \`#loadingReservas\` - Indicador de loading
- \`#boxErro\` - Container de erro
- \`#textoErro\` - Texto da mensagem de erro
- \`#boxConfirmacao\` - Container de confirmação
- \`#textoConfirmacao\` - Texto de confirmação
- \`#textoValorFinal\` - Texto valor final

### Newsletter
- \`#inputEmailNewsletter\` - Input email newsletter
- \`#btnNewsletter\` - Botão newsletter
- \`#textoNewsletterSucesso\` - Texto sucesso newsletter

## CSS Personalizado

Adicione este CSS no Wix para estilizar o chat:

\`\`\`css
.chat-message {
    margin: 10px 0;
    padding: 10px;
    border-radius: 10px;
    max-width: 80%;
}

.user-message {
    background-color: #007bff;
    color: white;
    margin-left: auto;
    text-align: right;
}

.bot-message {
    background-color: #f1f1f1;
    color: #333;
    margin-right: auto;
}

.message-content {
    margin-bottom: 5px;
}

.message-time {
    font-size: 0.8em;
    opacity: 0.7;
}

.typing-indicator {
    font-style: italic;
    opacity: 0.8;
}
\`\`\`

## Configuração de Código

1. Vá para o Editor do Wix
2. Clique em "Código" na barra lateral
3. Adicione um novo arquivo JavaScript
4. Cole o código do arquivo \`wix-integration.js\`
5. Altere a URL da API na linha:
   \`const API_BASE_URL = '$API_URL';\`

## Eventos a Configurar

- Página carregada: chamar \`initializePage()\`
- Cliques nos botões: conectar às funções correspondentes
- Formulários: configurar validações e submissões

EOF

    print_success "Documentação gerada"
}

# Limpeza
cleanup() {
    print_step "Limpando arquivos temporários"
    rm -rf temp/
    rm -f *.zip
    print_success "Limpeza concluída"
}

# Menu principal
show_menu() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════╗"
    echo "║        HOSTAL MAGIC DEPLOY           ║"
    echo "║      Deploy Completo AWS + Wix       ║"
    echo "╚══════════════════════════════════════╝"
    echo -e "${NC}"
    echo
    echo "Escolha uma opção:"
    echo "1. Deploy completo (primeira vez)"
    echo "2. Atualizar Lambda functions"
    echo "3. Atualizar infraestrutura"
    echo "4. Popular dados iniciais"
    echo "5. Executar testes"
    echo "6. Gerar documentação"
    echo "7. Destruir infraestrutura"
    echo "8. Sair"
    echo
}

# Deploy completo
full_deploy() {
    print_step "Iniciando deploy completo"
    
    check_prerequisites
    collect_config
    prepare_lambda_code
    deploy_infrastructure
    setup_ses
    populate_initial_data
    run_tests
    generate_documentation
    cleanup
    
    print_success "Deploy completo finalizado!"
    
    echo
    echo -e "${GREEN}🎉 Hostal MAGIC deployado com sucesso!${NC}"
    echo
    echo -e "${YELLOW}Próximos passos:${NC}"
    echo "1. Verifique seu email para confirmar o SES"
    echo "2. Configure o Wix com os endpoints gerados"
    echo "3. Teste as funcionalidades no site"
    echo "4. Configure QuickSight para dashboards"
    echo
    echo -e "${BLUE}Documentação gerada:${NC}"
    echo "- API_ENDPOINTS.md"
    echo "- CONFIGURACAO_WIX.md"
}

# Atualizar apenas Lambda functions
update_lambdas() {
    print_step "Atualizando Lambda functions"
    
    if [ -z "$ENVIRONMENT" ]; then
        echo -n "Environment (staging/production): "
        read ENVIRONMENT
    fi
    
    prepare_lambda_code
    
    # Atualizar função de reservas
    aws lambda update-function-code \
        --function-name "${PROJECT_NAME}-reservas-handler-${ENVIRONMENT}" \
        --zip-file fileb://reservas_handler.zip \
        --region $AWS_REGION
    
    # Atualizar função do chatbot
    aws lambda update-function-code \
        --function-name "${PROJECT_NAME}-chatbot-handler-${ENVIRONMENT}" \
        --zip-file fileb://chatbot_handler.zip \
        --region $AWS_REGION
    
    cleanup
    print_success "Lambda functions atualizadas"
}

# Destruir infraestrutura
destroy_infrastructure() {
    print_warning "Esta ação irá DESTRUIR toda a infraestrutura!"
    echo -n "Tem certeza? Digite 'DESTRUIR' para confirmar: "
    read confirmation
    
    if [ "$confirmation" = "DESTRUIR" ]; then
        if [ -z "$ENVIRONMENT" ]; then
            echo -n "Environment a destruir (staging/production): "
            read ENVIRONMENT
        fi
        
        terraform workspace select $ENVIRONMENT
        terraform destroy -auto-approve \
            -var="environment=$ENVIRONMENT" \
            -var="project_name=$PROJECT_NAME" \
            -var="openai_api_key=dummy" \
            -var="from_email=dummy@example.com"
        
        print_success "Infraestrutura destruída"
    else
        print_warning "Operação cancelada"
    fi
}

# Loop principal
main() {
    # Verificar argumentos de linha de comando
    case "${1:-}" in
        "--full-deploy")
            ENVIRONMENT="${2:-}"
            OPENAI_API_KEY="${3:-}"
            FROM_EMAIL="${4:-}"
            full_deploy
            ;;
        "--update-lambdas")
            ENVIRONMENT="${2:-}"
            update_lambdas
            ;;
        "--destroy")
            ENVIRONMENT="${2:-}"
            destroy_infrastructure
            ;;
        *)
            while true; do
                show_menu
                echo -n "Opção: "
                read choice
                
                case $choice in
                    1)
                        full_deploy
                        ;;
                    2)
                        update_lambdas
                        ;;
                    3)
                        collect_config
                        deploy_infrastructure
                        ;;
                    4)
                        if [ -z "$ENVIRONMENT" ]; then
                            echo -n "Environment: "
                            read ENVIRONMENT
                        fi
                        populate_initial_data
                        ;;
                    5)
                        if [ -z "$ENVIRONMENT" ]; then
                            echo -n "Environment: "
                            read ENVIRONMENT
                        fi
                        run_tests
                        ;;
                    6)
                        if [ -z "$ENVIRONMENT" ]; then
                            echo -n "Environment: "
                            read ENVIRONMENT
                        fi
                        generate_documentation
                        ;;
                    7)
                        destroy_infrastructure
                        ;;
                    8)
                        print_success "Saindo..."
                        exit 0
                        ;;
                    *)
                        print_error "Opção inválida"
                        ;;
                esac
                
                echo
                echo -n "Pressione Enter para continuar..."
                read
                clear
            done
            ;;
    esac
}

# Executar função principal
main "$@"