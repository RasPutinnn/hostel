import json
import boto3
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
import os

# Inicializar clientes AWS
dynamodb = boto3.resource('dynamodb')
ses = boto3.client('ses')
sqs = boto3.client('sqs')

# Tabelas DynamoDB
reservas_table = dynamodb.Table(os.environ['RESERVAS_TABLE'])
quartos_table = dynamodb.Table(os.environ['QUARTOS_TABLE'])
clientes_table = dynamodb.Table(os.environ['CLIENTES_TABLE'])

def lambda_handler(event, context):
    """
    Handler principal para operações de reserva do hostal MAGIC
    """
    try:
        # Parse do evento
        if 'body' in event:
            body = json.loads(event['body'])
        else:
            body = event
            
        action = body.get('action', '')
        
        # Roteamento baseado na ação
        if action == 'criar_reserva':
            return criar_reserva(body)
        elif action == 'consultar_disponibilidade':
            return consultar_disponibilidade(body)
        elif action == 'listar_reservas':
            return listar_reservas(body)
        elif action == 'cancelar_reserva':
            return cancelar_reserva(body)
        else:
            return {
                'statusCode': 400,
                'headers': headers_cors(),
                'body': json.dumps({'error': 'Ação não reconhecida'})
            }
            
    except Exception as e:
        print(f"Erro no handler: {str(e)}")
        return {
            'statusCode': 500,
            'headers': headers_cors(),
            'body': json.dumps({'error': 'Erro interno do servidor'})
        }

def criar_reserva(data):
    """
    Cria uma nova reserva no sistema
    """
    try:
        # Validação dos dados obrigatórios
        campos_obrigatorios = ['cliente_email', 'checkin', 'checkout', 'tipo_quarto', 'num_hospedes']
        for campo in campos_obrigatorios:
            if campo not in data:
                return erro_response(f'Campo obrigatório: {campo}')
        
        # Verificar disponibilidade
        disponibilidade = verificar_disponibilidade(
            data['checkin'], 
            data['checkout'], 
            data['tipo_quarto']
        )
        
        if not disponibilidade['disponivel']:
            return erro_response('Quarto não disponível para as datas selecionadas')
        
        # Gerar ID único para a reserva
        reserva_id = str(uuid.uuid4())
        
        # Calcular valor total
        valor_total = calcular_valor_reserva(
            data['checkin'], 
            data['checkout'], 
            data['tipo_quarto'],
            data['num_hospedes']
        )
        
        # Criar registro do cliente se não existir
        criar_ou_atualizar_cliente(data)
        
        # Criar reserva
        reserva = {
            'reserva_id': reserva_id,
            'cliente_email': data['cliente_email'],
            'cliente_nome': data.get('cliente_nome', ''),
            'cliente_telefone': data.get('cliente_telefone', ''),
            'checkin': data['checkin'],
            'checkout': data['checkout'],
            'tipo_quarto': data['tipo_quarto'],
            'num_hospedes': int(data['num_hospedes']),
            'valor_total': Decimal(str(valor_total)),
            'status': 'confirmada',
            'data_criacao': datetime.now().isoformat(),
            'servicos_extras': data.get('servicos_extras', []),
            'observacoes': data.get('observacoes', '')
        }
        
        # Salvar no DynamoDB
        reservas_table.put_item(Item=reserva)
        
        # Atualizar disponibilidade do quarto
        atualizar_disponibilidade_quarto(
            data['tipo_quarto'], 
            data['checkin'], 
            data['checkout']
        )
        
        # Enviar email de confirmação
        enviar_email_confirmacao(reserva)
        
        # Enviar para fila de processamento de BI
        enviar_para_fila_bi(reserva)
        
        return {
            'statusCode': 200,
            'headers': headers_cors(),
            'body': json.dumps({
                'success': True,
                'reserva_id': reserva_id,
                'valor_total': float(valor_total),
                'message': 'Reserva criada com sucesso!'
            })
        }
        
    except Exception as e:
        print(f"Erro ao criar reserva: {str(e)}")
        return erro_response('Erro ao processar reserva')

def consultar_disponibilidade(data):
    """
    Consulta disponibilidade de quartos para datas específicas
    """
    try:
        checkin = data['checkin']
        checkout = data['checkout']
        tipo_quarto = data.get('tipo_quarto', 'todos')
        
        # Buscar quartos disponíveis
        quartos_disponiveis = []
        
        # Query nos quartos
        response = quartos_table.scan()
        
        for quarto in response['Items']:
            if tipo_quarto != 'todos' and quarto['tipo'] != tipo_quarto:
                continue
                
            if verificar_quarto_disponivel(quarto['quarto_id'], checkin, checkout):
                quartos_disponiveis.append({
                    'quarto_id': quarto['quarto_id'],
                    'tipo': quarto['tipo'],
                    'capacidade': quarto['capacidade'],
                    'preco_diaria': float(quarto['preco_diaria']),
                    'amenidades': quarto.get('amenidades', [])
                })
        
        return {
            'statusCode': 200,
            'headers': headers_cors(),
            'body': json.dumps({
                'quartos_disponiveis': quartos_disponiveis,
                'total_encontrados': len(quartos_disponiveis)
            })
        }
        
    except Exception as e:
        print(f"Erro ao consultar disponibilidade: {str(e)}")
        return erro_response('Erro ao consultar disponibilidade')

def verificar_disponibilidade(checkin, checkout, tipo_quarto):
    """
    Verifica se há quartos disponíveis do tipo solicitado
    """
    try:
        # Buscar quartos do tipo solicitado
        response = quartos_table.query(
            IndexName='tipo-index',
            KeyConditionExpression=boto3.dynamodb.conditions.Key('tipo').eq(tipo_quarto)
        )
        
        for quarto in response['Items']:
            if verificar_quarto_disponivel(quarto['quarto_id'], checkin, checkout):
                return {'disponivel': True, 'quarto_id': quarto['quarto_id']}
        
        return {'disponivel': False}
        
    except Exception as e:
        print(f"Erro ao verificar disponibilidade: {str(e)}")
        return {'disponivel': False}

def verificar_quarto_disponivel(quarto_id, checkin, checkout):
    """
    Verifica se um quarto específico está disponível
    """
    try:
        # Buscar reservas existentes para o quarto
        response = reservas_table.query(
            IndexName='quarto-data-index',
            KeyConditionExpression=boto3.dynamodb.conditions.Key('quarto_id').eq(quarto_id),
            FilterExpression=boto3.dynamodb.conditions.Attr('status').eq('confirmada')
        )
        
        checkin_date = datetime.fromisoformat(checkin)
        checkout_date = datetime.fromisoformat(checkout)
        
        for reserva in response['Items']:
            reserva_checkin = datetime.fromisoformat(reserva['checkin'])
            reserva_checkout = datetime.fromisoformat(reserva['checkout'])
            
            # Verificar sobreposição de datas
            if (checkin_date < reserva_checkout and checkout_date > reserva_checkin):
                return False
        
        return True
        
    except Exception as e:
        print(f"Erro ao verificar quarto: {str(e)}")
        return False

def calcular_valor_reserva(checkin, checkout, tipo_quarto, num_hospedes):
    """
    Calcula o valor total da reserva
    """
    try:
        # Obter preço do tipo de quarto
        response = quartos_table.query(
            IndexName='tipo-index',
            KeyConditionExpression=boto3.dynamodb.conditions.Key('tipo').eq(tipo_quarto),
            Limit=1
        )
        
        if not response['Items']:
            return 0
        
        preco_diaria = float(response['Items'][0]['preco_diaria'])
        
        # Calcular número de noites
        checkin_date = datetime.fromisoformat(checkin)
        checkout_date = datetime.fromisoformat(checkout)
        noites = (checkout_date - checkin_date).days
        
        # Taxa extra por hóspede adicional (acima de 2)
        taxa_extra_hospede = 0
        if num_hospedes > 2:
            taxa_extra_hospede = (num_hospedes - 2) * 15  # $15 por hóspede adicional por noite
        
        valor_total = (preco_diaria + taxa_extra_hospede) * noites
        
        return valor_total
        
    except Exception as e:
        print(f"Erro ao calcular valor: {str(e)}")
        return 0

def criar_ou_atualizar_cliente(data):
    """
    Cria ou atualiza dados do cliente
    """
    try:
        cliente = {
            'email': data['cliente_email'],
            'nome': data.get('cliente_nome', ''),
            'telefone': data.get('cliente_telefone', ''),
            'ultima_atualizacao': datetime.now().isoformat()
        }
        
        clientes_table.put_item(Item=cliente)
        
    except Exception as e:
        print(f"Erro ao salvar cliente: {str(e)}")

def enviar_email_confirmacao(reserva):
    """
    Envia email de confirmação da reserva
    """
    try:
        html_template = f"""
        <html>
        <body>
            <h2>Confirmação de Reserva - Hostal MAGIC</h2>
            <p>Olá {reserva['cliente_nome']},</p>
            <p>Sua reserva foi confirmada com sucesso!</p>
            
            <h3>Detalhes da Reserva:</h3>
            <ul>
                <li><strong>ID da Reserva:</strong> {reserva['reserva_id']}</li>
                <li><strong>Check-in:</strong> {reserva['checkin']}</li>
                <li><strong>Check-out:</strong> {reserva['checkout']}</li>
                <li><strong>Tipo de Quarto:</strong> {reserva['tipo_quarto']}</li>
                <li><strong>Número de Hóspedes:</strong> {reserva['num_hospedes']}</li>
                <li><strong>Valor Total:</strong> ${reserva['valor_total']}</li>
            </ul>
            
            <p>Estamos ansiosos para recebê-lo em Bacalar!</p>
            <p>Hostal MAGIC Team</p>
        </body>
        </html>
        """
        
        ses.send_email(
            Source=os.environ['FROM_EMAIL'],
            Destination={'ToAddresses': [reserva['cliente_email']]},
            Message={
                'Subject': {'Data': 'Confirmação de Reserva - Hostal MAGIC'},
                'Body': {'Html': {'Data': html_template}}
            }
        )
        
    except Exception as e:
        print(f"Erro ao enviar email: {str(e)}")

def enviar_para_fila_bi(reserva):
    """
    Envia dados da reserva para fila de processamento de BI
    """
    try:
        message = {
            'tipo': 'nova_reserva',
            'data': json.dumps(reserva, default=str),
            'timestamp': datetime.now().isoformat()
        }
        
        sqs.send_message(
            QueueUrl=os.environ['BI_QUEUE_URL'],
            MessageBody=json.dumps(message)
        )
        
    except Exception as e:
        print(f"Erro ao enviar para fila BI: {str(e)}")

def headers_cors():
    """
    Headers CORS para integração com Wix
    """
    return {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,PUT,DELETE'
    }

def erro_response(mensagem):
    """
    Padroniza respostas de erro
    """
    return {
        'statusCode': 400,
        'headers': headers_cors(),
        'body': json.dumps({'error': mensagem})
    }