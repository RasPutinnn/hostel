const AWS = require('aws-sdk');
const axios = require('axios');

// Configurar clientes AWS
const dynamodb = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

// Configurações
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RESERVAS_LAMBDA = process.env.RESERVAS_LAMBDA_ARN;

exports.handler = async (event, context) => {
    try {
        const { body } = event;
        const { message, sessionId, clientInfo } = JSON.parse(body);
        
        // Log da conversa
        console.log(`Nova mensagem: ${message} - Session: ${sessionId}`);
        
        // Obter contexto da sessão
        const sessionContext = await getSessionContext(sessionId);
        
        // Processar a mensagem com ChatGPT
        const response = await processWithChatGPT(message, sessionContext, clientInfo);
        
        // Atualizar contexto da sessão
        await updateSessionContext(sessionId, message, response);
        
        // Verificar se precisa executar ações específicas
        const actions = await checkForActions(response, clientInfo);
        
        return {
            statusCode: 200,
            headers: getCorsHeaders(),
            body: JSON.stringify({
                response: response,
                actions: actions,
                sessionId: sessionId
            })
        };
        
    } catch (error) {
        console.error('Erro no chatbot:', error);
        return {
            statusCode: 500,
            headers: getCorsHeaders(),
            body: JSON.stringify({
                response: 'Desculpe, estou com dificuldades técnicas. Tente novamente em alguns momentos.',
                error: true
            })
        };
    }
};

async function getSessionContext(sessionId) {
    try {
        const params = {
            TableName: process.env.SESSIONS_TABLE,
            Key: { sessionId }
        };
        
        const result = await dynamodb.get(params).promise();
        
        if (result.Item) {
            return result.Item.context || [];
        }
        
        return [];
        
    } catch (error) {
        console.error('Erro ao obter contexto:', error);
        return [];
    }
}

async function updateSessionContext(sessionId, userMessage, botResponse) {
    try {
        const timestamp = new Date().toISOString();
        
        const params = {
            TableName: process.env.SESSIONS_TABLE,
            Key: { sessionId },
            UpdateExpression: 'SET #context = list_append(if_not_exists(#context, :empty_list), :new_messages), #lastActivity = :timestamp',
            ExpressionAttributeNames: {
                '#context': 'context',
                '#lastActivity': 'lastActivity'
            },
            ExpressionAttributeValues: {
                ':new_messages': [
                    { role: 'user', content: userMessage, timestamp },
                    { role: 'assistant', content: botResponse, timestamp }
                ],
                ':empty_list': [],
                ':timestamp': timestamp
            }
        };
        
        await dynamodb.update(params).promise();
        
    } catch (error) {
        console.error('Erro ao atualizar contexto:', error);
    }
}

async function processWithChatGPT(message, context, clientInfo = {}) {
    try {
        // Construir prompt do sistema com informações do hostal
        const systemPrompt = `
        Você é Maya, assistente virtual do Hostal MAGIC em Bacalar, México. 
        
        INFORMAÇÕES DO HOSTAL:
        - Localização: Bacalar, Quintana Roo, México (famosa Laguna dos 7 Tons)
        - Tipos de quartos: Dormitório compartilhado (4-6 pessoas), Quarto privado duplo, Quarto privado familiar
        - Preços base: Dormitório $25/noite, Privado duplo $60/noite, Familiar $90/noite
        - Amenidades: WiFi grátis, cozinha compartilhada, área comum, terraço com vista para laguna
        - Atividades: Kayak, stand-up paddle, tour cenotes, tour piratas, passeio de lancha
        
        SERVIÇOS EXTRAS:
        - Café da manhã: $8
        - Aluguel kayak: $15/dia
        - Aluguel bicicleta: $10/dia
        - Lavanderia: $5
        - Tour cenotes: $45
        - Tour lancha: $35
        
        POLÍTICA:
        - Check-in: 15:00 / Check-out: 11:00
        - Cancelamento gratuito até 24h antes
        - Depósito de segurança: $20 (devolvido na saída)
        
        INSTRUÇÕES:
        - Seja amigável, útil e entusiasmada sobre Bacalar
        - Ajude com reservas, informações sobre quartos e atividades
        - Se o cliente quiser fazer reserva, colete: nome, email, telefone, datas, tipo quarto, número de pessoas
        - Recomende atividades baseadas no perfil do cliente
        - Sempre mencione que Bacalar é mágico e único
        - Responda em português se o cliente escrever em português, espanhol se em espanhol, inglês se em inglês
        `;
        
        // Preparar mensagens para a API
        const messages = [
            { role: 'system', content: systemPrompt }
        ];
        
        // Adicionar contexto da conversa (últimas 10 mensagens)
        const recentContext = context.slice(-10);
        messages.push(...recentContext);
        
        // Adicionar mensagem atual
        messages.push({ role: 'user', content: message });
        
        // Chamar API do OpenAI
        const openaiResponse = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
                model: 'gpt-4',
                messages: messages,
                max_tokens: 500,
                temperature: 0.7,
                presence_penalty: 0.1,
                frequency_penalty: 0.1
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        
        return openaiResponse.data.choices[0].message.content;
        
    } catch (error) {
        console.error('Erro na API OpenAI:', error);
        
        // Fallback para resposta padrão
        return getFallbackResponse(message);
    }
}

function getFallbackResponse(message) {
    const lowerMessage = message.toLowerCase();
    
    if (lowerMessage.includes('reserva') || lowerMessage.includes('booking')) {
        return `¡Hola! Me encantaría ayudarte con tu reserva en el Hostal MAGIC. 
        Para hacer una reserva necesito:
        - Fechas de check-in y check-out
        - Tipo de habitación preferida
        - Número de huéspedes
        - Tu nombre y email
        
        ¿Cuándo te gustaría visitarnos en la hermosa Bacalar?`;
    }
    
    if (lowerMessage.includes('precio') || lowerMessage.includes('cost')) {
        return `Nuestros precios son:
        🏠 Dormitorio compartilhado: $25 USD/noite
        🛏️ Quarto privado duplo: $60 USD/noite  
        👨‍👩‍👧‍👦 Quarto familiar: $90 USD/noite
        
        ¡Todos incluyen WiFi gratis y acceso a nuestra cocina y área común con vista a la laguna!`;
    }
    
    if (lowerMessage.includes('atividade') || lowerMessage.includes('tour')) {
        return `¡Bacalar es increíble para aventuras! Ofrecemos:
        🚣 Kayak: $15/día
        🚴 Bicicletas: $10/día  
        🏊 Tour cenotes: $45
        🚤 Tour en lancha: $35
        🏴‍☠️ Tour de piratas: $40
        
        ¿Qué tipo de aventura te interesa más?`;
    }
    
    return `¡Hola! Soy Maya del Hostal MAGIC en Bacalar 🏖️
    
    Estoy aquí para ayudarte con:
    ✅ Reservas y disponibilidad
    ✅ Información sobre habitaciones
    ✅ Tours y actividades
    ✅ Servicios del hostal
    
    ¿En qué puedo ayudarte hoy?`;
}

async function checkForActions(response, clientInfo) {
    const actions = [];
    const lowerResponse = response.toLowerCase();
    
    // Verificar se o bot está tentando fazer uma reserva
    if (lowerResponse.includes('fazer reserva') || 
        lowerResponse.includes('confirmar reserva') ||
        lowerResponse.includes('booking confirmed')) {
        
        actions.push({
            type: 'redirect_booking',
            data: {
                clientInfo: clientInfo
            }
        });
    }
    
    // Verificar se precisa mostrar disponibilidade
    if (lowerResponse.includes('verificar disponibilidade') ||
        lowerResponse.includes('check availability')) {
        
        actions.push({
            type: 'show_availability',
            data: {}
        });
    }
    
    // Verificar se deve mostrar menu de atividades
    if (lowerResponse.includes('atividades') || 
        lowerResponse.includes('tours') ||
        lowerResponse.includes('activities')) {
        
        actions.push({
            type: 'show_activities',
            data: {}
        });
    }
    
    return actions;
}

function getCorsHeaders() {
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    };
}