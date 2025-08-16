// wix-integration.js - Código para integração Wix com AWS API
import wixWindow from 'wix-window';
import wixLocation from 'wix-location';
import { session } from 'wix-storage';
import { timeline } from 'wix-animations';

// Configurações da API
const API_BASE_URL = 'https://your-api-gateway-url.execute-api.region.amazonaws.com/staging';
const RESERVAS_ENDPOINT = `${API_BASE_URL}/reservas`;
const CHATBOT_ENDPOINT = `${API_BASE_URL}/chatbot`;

// Estado global da aplicação
let chatSession = null;
let currentReservation = null;

// Inicialização da página
$w.onReady(function() {
    console.log('Hostal MAGIC - Sistema inicializado');
    
    // Inicializar componentes
    initializePage();
    initializeChatbot();
    initializeReservationSystem();
    initializeAnimations();
});

// ========== SISTEMA DE RESERVAS ==========

async function initializeReservationSystem() {
    // Configurar eventos dos formulários
    $w('#btnConsultarDisponibilidade').onClick(consultarDisponibilidade);
    $w('#btnFazerReserva').onClick(processarReserva);
    $w('#btnCancelarReserva').onClick(cancelarReserva);
    
    // Configurar validações em tempo real
    $w('#inputCheckin').onChange(validarDatas);
    $w('#inputCheckout').onChange(validarDatas);
    $w('#dropdownTipoQuarto').onChange(atualizarPrecos);
    $w('#inputNumHospedes').onChange(calcularValorTotal);
    
    // Carregar dados iniciais
    await carregarTiposQuarto();
    await carregarServicosExtras();
}

async function consultarDisponibilidade() {
    try {
        // Mostrar loading
        $w('#loadingReservas').show();
        $w('#btnConsultarDisponibilidade').disable();
        
        // Coletar dados do formulário
        const dadosConsulta = {
            action: 'consultar_disponibilidade',
            checkin: $w('#inputCheckin').value,
            checkout: $w('#inputCheckout').value,
            tipo_quarto: $w('#dropdownTipoQuarto').value || 'todos'
        };
        
        // Validar dados
        if (!validarDadosReserva(dadosConsulta)) {
            return;
        }
        
        // Fazer requisição
        const response = await fetch(RESERVAS_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(dadosConsulta)
        });
        
        const resultado = await response.json();
        
        if (response.ok) {
            mostrarQuartosDisponiveis(resultado.quartos_disponiveis);
            $w('#secaoResultados').show();
            
            // Animar resultados
            timeline()
                .add($w('#secaoResultados'), { opacity: 0, y: 50 })
                .add($w('#secaoResultados'), { opacity: 1, y: 0 }, { duration: 800 });
                
        } else {
            mostrarErro(resultado.error || 'Erro ao consultar disponibilidade');
        }
        
    } catch (error) {
        console.error('Erro na consulta:', error);
        mostrarErro('Erro de conexão. Tente novamente.');
    } finally {
        $w('#loadingReservas').hide();
        $w('#btnConsultarDisponibilidade').enable();
    }
}

async function processarReserva() {
    try {
        $w('#loadingReservas').show();
        $w('#btnFazerReserva').disable();
        
        // Coletar todos os dados da reserva
        const dadosReserva = {
            action: 'criar_reserva',
            cliente_nome: $w('#inputNome').value,
            cliente_email: $w('#inputEmail').value,
            cliente_telefone: $w('#inputTelefone').value,
            checkin: $w('#inputCheckin').value,
            checkout: $w('#inputCheckout').value,
            tipo_quarto: $w('#dropdownTipoQuarto').value,
            num_hospedes: parseInt($w('#inputNumHospedes').value),
            servicos_extras: obterServicosExtras(),
            observacoes: $w('#textAreaObservacoes').value
        };
        
        // Validar dados completos
        if (!validarDadosReservaCompleta(dadosReserva)) {
            return;
        }
        
        // Fazer requisição
        const response = await fetch(RESERVAS_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(dadosReserva)
        });
        
        const resultado = await response.json();
        
        if (response.ok) {
            currentReservation = resultado;
            mostrarConfirmacaoReserva(resultado);
            limparFormularioReserva();
            
            // Enviar evento para analytics
            enviarEventoAnalytics('reserva_criada', {
                reserva_id: resultado.reserva_id,
                valor_total: resultado.valor_total,
                tipo_quarto: dadosReserva.tipo_quarto
            });
            
        } else {
            mostrarErro(resultado.error || 'Erro ao processar reserva');
        }
        
    } catch (error) {
        console.error('Erro ao processar reserva:', error);
        mostrarErro('Erro de conexão. Tente novamente.');
    } finally {
        $w('#loadingReservas').hide();
        $w('#btnFazerReserva').enable();
    }
}

function mostrarQuartosDisponiveis(quartos) {
    const container = $w('#repeaterQuartos');
    
    if (quartos.length === 0) {
        $w('#textoSemQuartos').show();
        container.hide();
        return;
    }
    
    $w('#textoSemQuartos').hide();
    container.data = quartos.map(quarto => ({
        _id: quarto.quarto_id,
        tipo: quarto.tipo,
        capacidade: quarto.capacidade,
        preco: `${quarto.preco_diaria}/noite`,
        amenidades: quarto.amenidades.join(', ')
    }));
    
    container.show();
    
    // Configurar eventos dos itens do repeater
    container.onItemReady(($item, itemData) => {
        $item('#btnSelecionarQuarto').onClick(() => {
            selecionarQuarto(itemData);
        });
    });
}

function selecionarQuarto(quarto) {
    $w('#dropdownTipoQuarto').value = quarto.tipo;
    calcularValorTotal();
    
    // Scroll para formulário de reserva
    $w('#secaoFormularioReserva').scrollTo();
    
    // Destacar quarto selecionado
    timeline()
        .add($w('#secaoFormularioReserva'), { 'background-color': '#e8f5e8' })
        .add($w('#secaoFormularioReserva'), { 'background-color': '#ffffff' }, { duration: 1000 });
}

// ========== SISTEMA DE CHATBOT ==========

async function initializeChatbot() {
    // Gerar session ID único
    chatSession = session.getItem('chatSessionId') || generateSessionId();
    session.setItem('chatSessionId', chatSession);
    
    // Configurar eventos
    $w('#btnEnviarMensagem').onClick(enviarMensagemChatbot);
    $w('#inputMensagem').onKeyPress((event) => {
        if (event.key === 'Enter') {
            enviarMensagemChatbot();
        }
    });
    
    $w('#btnFecharChat').onClick(() => {
        $w('#chatContainer').hide();
    });
    
    $w('#btnAbrirChat').onClick(() => {
        $w('#chatContainer').show();
        if ($w('#chatMessages').children.length === 0) {
            enviarMensagemInicial();
        }
    });
}

async function enviarMensagemChatbot() {
    const mensagem = $w('#inputMensagem').value.trim();
    if (!mensagem) return;
    
    // Adicionar mensagem do usuário ao chat
    adicionarMensagemChat('user', mensagem);
    $w('#inputMensagem').value = '';
    
    // Mostrar indicador de digitação
    mostrarIndicadorDigitacao();
    
    try {
        const response = await fetch(CHATBOT_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: mensagem,
                sessionId: chatSession,
                clientInfo: obterInfoCliente()
            })
        });
        
        const resultado = await response.json();
        
        if (response.ok) {
            // Remover indicador de digitação
            removerIndicadorDigitacao();
            
            // Adicionar resposta do bot
            adicionarMensagemChat('bot', resultado.response);
            
            // Processar ações se existirem
            if (resultado.actions && resultado.actions.length > 0) {
                processarAcoesChatbot(resultado.actions);
            }
            
        } else {
            removerIndicadorDigitacao();
            adicionarMensagemChat('bot', 'Desculpe, estou com dificuldades técnicas no momento.');
        }
        
    } catch (error) {
        console.error('Erro no chatbot:', error);
        removerIndicadorDigitacao();
        adicionarMensagemChat('bot', 'Erro de conexão. Tente novamente.');
    }
}

function adicionarMensagemChat(tipo, texto) {
    const container = $w('#chatMessages');
    const mensagemId = `msg_${Date.now()}`;
    
    // Criar elemento da mensagem
    const mensagemHtml = `
        <div class="chat-message ${tipo}-message" id="${mensagemId}">
            <div class="message-content">
                ${texto}
            </div>
            <div class="message-time">
                ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </div>
        </div>
    `;
    
    // Adicionar ao container
    container.html += mensagemHtml;
    
    // Scroll para baixo
    container.scrollTo();
    
    // Animar entrada da mensagem
    timeline()
        .add(`#${mensagemId}`, { opacity: 0, x: tipo === 'user' ? 50 : -50 })
        .add(`#${mensagemId}`, { opacity: 1, x: 0 }, { duration: 300 });
}

function processarAcoesChatbot(actions) {
    actions.forEach(action => {
        switch (action.type) {
            case 'redirect_booking':
                // Redirecionar para formulário de reserva
                $w('#secaoFormularioReserva').scrollTo();
                $w('#chatContainer').hide();
                break;
                
            case 'show_availability':
                // Mostrar seção de disponibilidade
                $w('#secaoConsultaDisponibilidade').scrollTo();
                break;
                
            case 'show_activities':
                // Mostrar menu de atividades
                $w('#secaoAtividades').scrollTo();
                break;
        }
    });
}

// ========== SISTEMA DE ANIMAÇÕES ==========

function initializeAnimations() {
    // Animações de entrada na página
    timeline()
        .add($w('#heroSection'), { opacity: 0, y: 100 })
        .add($w('#heroSection'), { opacity: 1, y: 0 }, { duration: 1000 })
        .add($w('#featuresSection'), { opacity: 0, y: 50 }, { delay: 200 })
        .add($w('#featuresSection'), { opacity: 1, y: 0 }, { duration: 800 });
    
    // Animações hover nos botões
    $w('#btnConsultarDisponibilidade').onMouseIn(() => {
        timeline().add($w('#btnConsultarDisponibilidade'), { scale: 1.05 }, { duration: 200 });
    });
    
    $w('#btnConsultarDisponibilidade').onMouseOut(() => {
        timeline().add($w('#btnConsultarDisponibilidade'), { scale: 1 }, { duration: 200 });
    });
    
    // Paralax no hero section
    wixWindow.onScroll(() => {
        const scrollY = wixWindow.scrollY;
        $w('#heroBackground').style.transform = `translateY(${scrollY * 0.5}px)`;
    });
}

// ========== FUNÇÕES AUXILIARES ==========

function validarDadosReserva(dados) {
    if (!dados.checkin || !dados.checkout) {
        mostrarErro('Por favor, selecione as datas de check-in e check-out');
        return false;
    }
    
    const checkinDate = new Date(dados.checkin);
    const checkoutDate = new Date(dados.checkout);
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    if (checkinDate < hoje) {
        mostrarErro('A data de check-in não pode ser anterior a hoje');
        return false;
    }
    
    if (checkoutDate <= checkinDate) {
        mostrarErro('A data de check-out deve ser posterior ao check-in');
        return false;
    }
    
    return true;
}

function validarDadosReservaCompleta(dados) {
    if (!validarDadosReserva(dados)) return false;
    
    if (!dados.cliente_nome || !dados.cliente_email) {
        mostrarErro('Por favor, preencha nome e email');
        return false;
    }
    
    if (!dados.tipo_quarto) {
        mostrarErro('Por favor, selecione o tipo de quarto');
        return false;
    }
    
    if (!dados.num_hospedes || dados.num_hospedes < 1) {
        mostrarErro('Por favor, informe o número de hóspedes');
        return false;
    }
    
    // Validar email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(dados.cliente_email)) {
        mostrarErro('Por favor, insira um email válido');
        return false;
    }
    
    return true;
}

function calcularValorTotal() {
    const checkin = $w('#inputCheckin').value;
    const checkout = $w('#inputCheckout').value;
    const tipoQuarto = $w('#dropdownTipoQuarto').value;
    const numHospedes = parseInt($w('#inputNumHospedes').value) || 1;
    
    if (!checkin || !checkout || !tipoQuarto) return;
    
    const precos = {
        'dormitorio': 25,
        'privado_duplo': 60,
        'familiar': 90
    };
    
    const precoDiaria = precos[tipoQuarto] || 0;
    const noites = Math.ceil((new Date(checkout) - new Date(checkin)) / (1000 * 60 * 60 * 24));
    
    // Taxa extra por hóspede adicional
    const taxaExtra = numHospedes > 2 ? (numHospedes - 2) * 15 : 0;
    
    const valorTotal = (precoDiaria + taxaExtra) * noites;
    
    $w('#textoValorTotal').text = `Valor Total: ${valorTotal} USD`;
    $w('#textoDetalhesCalculo').text = `${noites} noites × ${precoDiaria + taxaExtra}/noite`;
}

function obterServicosExtras() {
    const servicos = [];
    if ($w('#checkboxCafeManha').checked) servicos.push('cafe_manha');
    if ($w('#checkboxKayak').checked) servicos.push('kayak');
    if ($w('#checkboxBicicleta').checked) servicos.push('bicicleta');
    if ($w('#checkboxLavanderia').checked) servicos.push('lavanderia');
    return servicos;
}

function obterInfoCliente() {
    return {
        nome: $w('#inputNome').value || '',
        email: $w('#inputEmail').value || '',
        telefone: $w('#inputTelefone').value || '',
        idioma: 'pt-BR',
        url_atual: wixLocation.url
    };
}

function mostrarErro(mensagem) {
    $w('#textoErro').text = mensagem;
    $w('#boxErro').show();
    
    // Auto-hide após 5 segundos
    setTimeout(() => {
        $w('#boxErro').hide();
    }, 5000);
    
    // Animar erro
    timeline()
        .add($w('#boxErro'), { opacity: 0, y: -20 })
        .add($w('#boxErro'), { opacity: 1, y: 0 }, { duration: 300 });
}

function mostrarConfirmacaoReserva(resultado) {
    $w('#textoConfirmacao').text = `Reserva confirmada! ID: ${resultado.reserva_id}`;
    $w('#textoValorFinal').text = `Valor total: ${resultado.valor_total} USD`;
    $w('#boxConfirmacao').show();
    
    // Scroll para confirmação
    $w('#boxConfirmacao').scrollTo();
    
    // Animar confirmação
    timeline()
        .add($w('#boxConfirmacao'), { scale: 0.8, opacity: 0 })
        .add($w('#boxConfirmacao'), { scale: 1, opacity: 1 }, { duration: 500 });
}

function limparFormularioReserva() {
    $w('#inputNome').value = '';
    $w('#inputEmail').value = '';
    $w('#inputTelefone').value = '';
    $w('#textAreaObservacoes').value = '';
    $w('#checkboxCafeManha').checked = false;
    $w('#checkboxKayak').checked = false;
    $w('#checkboxBicicleta').checked = false;
    $w('#checkboxLavanderia').checked = false;
}

function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function enviarEventoAnalytics(evento, dados) {
    // Integração com Google Analytics ou similar
    if (typeof gtag !== 'undefined') {
        gtag('event', evento, dados);
    }
    
    // Log local para debugging
    console.log('Analytics Event:', evento, dados);
}

function mostrarIndicadorDigitacao() {
    adicionarMensagemChat('bot', '<div class="typing-indicator">Maya está digitando...</div>');
}

function removerIndicadorDigitacao() {
    // Remove o último elemento de digitação
    const container = $w('#chatMessages');
    const mensagens = container.children;
    if (mensagens.length > 0) {
        const ultimaMensagem = mensagens[mensagens.length - 1];
        if (ultimaMensagem.html.includes('typing-indicator')) {
            ultimaMensagem.remove();
        }
    }
}

async function enviarMensagemInicial() {
    setTimeout(() => {
        adicionarMensagemChat('bot', '¡Hola! Soy Maya, tu asistente virtual del Hostal MAGIC en Bacalar 🏖️\n\n¿En qué puedo ayudarte hoy?');
    }, 1000);
}

function initializePage() {
    // Configurações iniciais da página
    $w('#chatContainer').hide();
    $w('#boxErro').hide();
    $w('#boxConfirmacao').hide();
    $w('#loadingReservas').hide();
    
    // Configurar formulário de newsletter
    $w('#btnNewsletter').onClick(async () => {
        const email = $w('#inputEmailNewsletter').value;
        if (email) {
            // Aqui você pode integrar com um serviço de newsletter
            $w('#textoNewsletterSucesso').show();
            $w('#inputEmailNewsletter').value = '';
        }
    });
}

// Exportar funções para uso global
export {
    consultarDisponibilidade,
    processarReserva,
    enviarMensagemChatbot,
    calcularValorTotal
};