"""
Pipeline de Machine Learning e Business Intelligence
Hostal MAGIC - Bacalar, México
"""

import json
import boto3
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from decimal import Decimal
import logging
from typing import Dict, List, Any
import os

# Configurar logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Clientes AWS
dynamodb = boto3.resource('dynamodb')
s3 = boto3.client('s3')
sagemaker = boto3.client('sagemaker')
quicksight = boto3.client('quicksight')
ses = boto3.client('ses')
comprehend = boto3.client('comprehend')

# Configurações
DATA_LAKE_BUCKET = os.environ.get('DATA_LAKE_BUCKET')
ENVIRONMENT = os.environ.get('ENVIRONMENT', 'staging')

class HostalAnalytics:
    """Classe principal para análises do hostal"""
    
    def __init__(self):
        self.reservas_table = dynamodb.Table(f'hostal-magic-reservas-{ENVIRONMENT}')
        self.quartos_table = dynamodb.Table(f'hostal-magic-quartos-{ENVIRONMENT}')
        self.clientes_table = dynamodb.Table(f'hostal-magic-clientes-{ENVIRONMENT}')
    
    def extrair_dados_reservas(self, data_inicio: str, data_fim: str) -> pd.DataFrame:
        """Extrai dados de reservas para análise"""
        try:
            # Scan da tabela de reservas
            response = self.reservas_table.scan(
                FilterExpression=boto3.dynamodb.conditions.Attr('checkin').between(data_inicio, data_fim)
            )
            
            reservas = []
            for item in response['Items']:
                reserva = {
                    'reserva_id': item['reserva_id'],
                    'cliente_email': item['cliente_email'],
                    'checkin': item['checkin'],
                    'checkout': item['checkout'],
                    'tipo_quarto': item['tipo_quarto'],
                    'num_hospedes': int(item['num_hospedes']),
                    'valor_total': float(item['valor_total']),
                    'status': item['status'],
                    'data_criacao': item['data_criacao'],
                    'servicos_extras': item.get('servicos_extras', [])
                }
                reservas.append(reserva)
            
            df = pd.DataFrame(reservas)
            
            if not df.empty:
                # Converter datas
                df['checkin'] = pd.to_datetime(df['checkin'])
                df['checkout'] = pd.to_datetime(df['checkout'])
                df['data_criacao'] = pd.to_datetime(df['data_criacao'])
                
                # Calcular métricas derivadas
                df['noites'] = (df['checkout'] - df['checkin']).dt.days
                df['valor_por_noite'] = df['valor_total'] / df['noites']
                df['mes_checkin'] = df['checkin'].dt.to_period('M')
                df['semana_checkin'] = df['checkin'].dt.isocalendar().week
                df['dia_semana'] = df['checkin'].dt.day_name()
                
            return df
            
        except Exception as e:
            logger.error(f"Erro ao extrair dados de reservas: {str(e)}")
            return pd.DataFrame()
    
    def calcular_metricas_ocupacao(self, df_reservas: pd.DataFrame) -> Dict[str, Any]:
        """Calcula métricas de ocupação"""
        try:
            if df_reservas.empty:
                return {}
            
            # Métricas básicas
            total_reservas = len(df_reservas)
            receita_total = df_reservas['valor_total'].sum()
            receita_media_reserva = df_reservas['valor_total'].mean()
            noites_total = df_reservas['noites'].sum()
            
            # Ocupação por tipo de quarto
            ocupacao_por_tipo = df_reservas.groupby('tipo_quarto').agg({
                'reserva_id': 'count',
                'valor_total': 'sum',
                'noites': 'sum'
            }).to_dict()
            
            # Sazonalidade mensal
            sazonalidade_mensal = df_reservas.groupby('mes_checkin').agg({
                'reserva_id': 'count',
                'valor_total': 'sum'
            }).to_dict()
            
            # Tendência por dia da semana
            tendencia_semanal = df_reservas.groupby('dia_semana').agg({
                'reserva_id': 'count',
                'valor_total': 'mean'
            }).to_dict()
            
            # Antecedência média de reserva
            df_reservas_temp = df_reservas.copy()
            df_reservas_temp['antecedencia'] = (df_reservas_temp['checkin'] - df_reservas_temp['data_criacao']).dt.days
            antecedencia_media = df_reservas_temp['antecedencia'].mean()
            
            metricas = {
                'total_reservas': total_reservas,
                'receita_total': float(receita_total),
                'receita_media_reserva': float(receita_media_reserva),
                'noites_total': int(noites_total),
                'ocupacao_por_tipo': ocupacao_por_tipo,
                'sazonalidade_mensal': sazonalidade_mensal,
                'tendencia_semanal': tendencia_semanal,
                'antecedencia_media_dias': float(antecedencia_media) if not pd.isna(antecedencia_media) else 0
            }
            
            return metricas
            
        except Exception as e:
            logger.error(f"Erro ao calcular métricas de ocupação: {str(e)}")
            return {}
    
    def analisar_clientes(self, df_reservas: pd.DataFrame) -> Dict[str, Any]:
        """Análise de perfil de clientes"""
        try:
            if df_reservas.empty:
                return {}
            
            # Clientes por valor total gasto
            clientes_valor = df_reservas.groupby('cliente_email').agg({
                'valor_total': 'sum',
                'reserva_id': 'count',
                'noites': 'sum'
            }).sort_values('valor_total', ascending=False)
            
            # Top 10 clientes
            top_clientes = clientes_valor.head(10).to_dict()
            
            # Segmentação de clientes
            clientes_valor['categoria'] = pd.cut(
                clientes_valor['valor_total'], 
                bins=[0, 100, 300, 1000, float('inf')], 
                labels=['Bronze', 'Prata', 'Ouro', 'Platino']
            )
            
            segmentacao = clientes_valor['categoria'].value_counts().to_dict()
            
            # Clientes recorrentes
            clientes_recorrentes = clientes_valor[clientes_valor['reserva_id'] > 1]
            taxa_recorrencia = len(clientes_recorrentes) / len(clientes_valor) * 100
            
            analise_clientes = {
                'total_clientes_unicos': len(clientes_valor),
                'top_clientes': top_clientes,
                'segmentacao': segmentacao,
                'clientes_recorrentes': len(clientes_recorrentes),
                'taxa_recorrencia_pct': float(taxa_recorrencia),
                'valor_medio_cliente': float(clientes_valor['valor_total'].mean())
            }
            
            return analise_clientes
            
        except Exception as e:
            logger.error(f"Erro ao analisar clientes: {str(e)}")
            return {}


class PrevisaoDemanda:
    """Classe para previsão de demanda usando séries temporais"""
    
    def __init__(self):
        self.model_name = f'hostal-magic-demanda-{ENVIRONMENT}'
    
    def preparar_dados_previsao(self, df_reservas: pd.DataFrame) -> pd.DataFrame:
        """Prepara dados para modelo de previsão"""
        try:
            if df_reservas.empty:
                return pd.DataFrame()
            
            # Agregar por dia
            dados_diarios = df_reservas.groupby(df_reservas['checkin'].dt.date).agg({
                'reserva_id': 'count',
                'valor_total': 'sum',
                'num_hospedes': 'sum'
            }).reset_index()
            
            dados_diarios.columns = ['data', 'reservas', 'receita', 'hospedes']
            dados_diarios['data'] = pd.to_datetime(dados_diarios['data'])
            
            # Criar features temporais
            dados_diarios['dia_semana'] = dados_diarios['data'].dt.dayofweek
            dados_diarios['mes'] = dados_diarios['data'].dt.month
            dados_diarios['dia_ano'] = dados_diarios['data'].dt.dayofyear
            dados_diarios['eh_feriado'] = dados_diarios['data'].apply(self._eh_feriado_mexico)
            dados_diarios['eh_temporada_alta'] = dados_diarios['mes'].isin([12, 1, 2, 7, 8])
            
            # Features de lag
            dados_diarios['reservas_lag_7'] = dados_diarios['reservas'].shift(7)
            dados_diarios['reservas_lag_30'] = dados_diarios['reservas'].shift(30)
            dados_diarios['media_movel_7'] = dados_diarios['reservas'].rolling(window=7).mean()
            dados_diarios['media_movel_30'] = dados_diarios['reservas'].rolling(window=30).mean()
            
            return dados_diarios.dropna()
            
        except Exception as e:
            logger.error(f"Erro ao preparar dados de previsão: {str(e)}")
            return pd.DataFrame()
    
    def _eh_feriado_mexico(self, data: datetime) -> bool:
        """Verifica se a data é feriado no México"""
        feriados_fixos = [
            (1, 1),   # Ano Novo
            (2, 5),   # Dia da Constituição
            (3, 21),  # Nascimento de Benito Juárez
            (5, 1),   # Dia do Trabalho
            (9, 16),  # Dia da Independência
            (11, 20), # Revolução Mexicana
            (12, 25)  # Natal
        ]
        
        return (data.month, data.day) in feriados_fixos
    
    def gerar_previsao_demanda(self, dados_historicos: pd.DataFrame, dias_previsao: int = 30) -> Dict[str, Any]:
        """Gera previsão de demanda usando modelo simples"""
        try:
            if dados_historicos.empty:
                return {}
            
            # Modelo simples baseado em médias históricas e sazonalidade
            ultimos_30_dias = dados_historicos.tail(30)
            media_reservas = ultimos_30_dias['reservas'].mean()
            
            # Calcular sazonalidade por dia da semana
            sazonalidade_semanal = dados_historicos.groupby('dia_semana')['reservas'].mean()
            
            # Calcular tendência
            dados_historicos['indice'] = range(len(dados_historicos))
            correlacao_tendencia = dados_historicos['indice'].corr(dados_historicos['reservas'])
            
            # Gerar previsões
            data_inicio = dados_historicos['data'].max() + timedelta(days=1)
            previsoes = []
            
            for i in range(dias_previsao):
                data_previsao = data_inicio + timedelta(days=i)
                dia_semana = data_previsao.weekday()
                
                # Previsão base
                previsao_base = media_reservas
                
                # Ajuste sazonal
                fator_sazonal = sazonalidade_semanal.get(dia_semana, 1) / media_reservas
                
                # Ajuste de tendência
                ajuste_tendencia = correlacao_tendencia * i * 0.1
                
                # Previsão final
                previsao = max(0, previsao_base * fator_sazonal + ajuste_tendencia)
                
                previsoes.append({
                    'data': data_previsao.strftime('%Y-%m-%d'),
                    'previsao_reservas': round(previsao, 2),
                    'confianca': 0.8,  # Placeholder para confiança
                    'limite_inferior': round(previsao * 0.7, 2),
                    'limite_superior': round(previsao * 1.3, 2)
                })
            
            return {
                'previsoes': previsoes,
                'metricas_modelo': {
                    'media_historica': float(media_reservas),
                    'correlacao_tendencia': float(correlacao_tendencia),
                    'periodo_base': f"{dados_historicos['data'].min()} a {dados_historicos['data'].max()}"
                }
            }
            
        except Exception as e:
            logger.error(f"Erro ao gerar previsão: {str(e)}")
            return {}


class SistemaRecomendacao:
    """Sistema de recomendação baseado em perfil do cliente"""
    
    def __init__(self):
        self.pesos = {
            'historico_tipo_quarto': 0.3,
            'sazonalidade': 0.2,
            'servicos_extras': 0.25,
            'valor_gasto': 0.15,
            'frequencia_visita': 0.1
        }
    
    def gerar_recomendacoes_cliente(self, cliente_email: str, df_reservas: pd.DataFrame) -> Dict[str, Any]:
        """Gera recomendações personalizadas para um cliente"""
        try:
            # Histórico do cliente
            historico_cliente = df_reservas[df_reservas['cliente_email'] == cliente_email]
            
            if historico_cliente.empty:
                return self._recomendacoes_cliente_novo()
            
            # Análise do perfil
            tipo_quarto_preferido = historico_cliente['tipo_quarto'].mode().iloc[0]
            valor_medio_gasto = historico_cliente['valor_total'].mean()
            servicos_extras_usados = []
            
            for servicos in historico_cliente['servicos_extras']:
                if isinstance(servicos, list):
                    servicos_extras_usados.extend(servicos)
            
            servicos_preferidos = list(set(servicos_extras_usados))
            
            # Meses de visita preferidos
            meses_visita = historico_cliente['checkin'].dt.month.tolist()
            mes_preferido = max(set(meses_visita), key=meses_visita.count)
            
            # Gerar recomendações
            recomendacoes = {
                'tipo_quarto_sugerido': tipo_quarto_preferido,
                'servicos_sugeridos': servicos_preferidos[:3],  # Top 3
                'melhor_epoca_visita': self._nome_mes(mes_preferido),
                'oferta_personalizada': self._gerar_oferta_personalizada(valor_medio_gasto),
                'atividades_sugeridas': self._sugerir_atividades_perfil(historico_cliente),
                'desconto_fidelidade': min(len(historico_cliente) * 5, 25)  # Max 25%
            }
            
            return recomendacoes
            
        except Exception as e:
            logger.error(f"Erro ao gerar recomendações: {str(e)}")
            return {}
    
    def _recomendacoes_cliente_novo(self) -> Dict[str, Any]:
        """Recomendações para clientes novos"""
        return {
            'tipo_quarto_sugerido': 'dormitorio',  # Opção mais econômica para começar
            'servicos_sugeridos': ['cafe_manha', 'kayak'],
            'melhor_epoca_visita': 'Novembro-Março (clima perfeito)',
            'oferta_personalizada': 'Desconto de 15% na primeira reserva',
            'atividades_sugeridas': ['Tour cenotes', 'Kayak na laguna', 'Bike tour'],
            'desconto_fidelidade': 15
        }
    
    def _nome_mes(self, numero_mes: int) -> str:
        """Converte número do mês para nome"""
        meses = {
            1: 'Janeiro', 2: 'Fevereiro', 3: 'Março', 4: 'Abril',
            5: 'Maio', 6: 'Junho', 7: 'Julho', 8: 'Agosto',
            9: 'Setembro', 10: 'Outubro', 11: 'Novembro', 12: 'Dezembro'
        }
        return meses.get(numero_mes, 'Desconhecido')
    
    def _gerar_oferta_personalizada(self, valor_medio: float) -> str:
        """Gera oferta baseada no perfil de gasto"""
        if valor_medio > 200:
            return "Upgrade gratuito para quarto premium"
        elif valor_medio > 100:
            return "Desconto de 20% em serviços extras"
        else:
            return "Café da manhã gratuito por 2 dias"
    
    def _sugerir_atividades_perfil(self, historico: pd.DataFrame) -> List[str]:
        """Sugere atividades baseadas no perfil"""
        valor_medio = historico['valor_total'].mean()
        num_hospedes_medio = historico['num_hospedes'].mean()
        
        atividades = []
        
        if valor_medio > 150:
            atividades.extend(['Tour lancha premium', 'Jantar romântico na laguna'])
        
        if num_hospedes_medio > 2:
            atividades.extend(['Tour familiar cenotes', 'Atividades grupo'])
        
        # Atividades básicas sempre incluídas
        atividades.extend(['Kayak', 'Stand-up paddle', 'Tour cenotes'])
        
        return list(set(atividades))[:5]  # Max 5 sugestões


class AnalisesSentimento:
    """Análise de sentimento em avaliações e feedbacks"""
    
    def analisar_sentimento_avaliacoes(self, textos_avaliacoes: List[str]) -> Dict[str, Any]:
        """Analisa sentimento das avaliações usando Amazon Comprehend"""
        try:
            if not textos_avaliacoes:
                return {}
            
            # Dividir em lotes (Comprehend tem limite de 25 textos por chamada)
            lotes = [textos_avaliacoes[i:i+25] for i in range(0, len(textos_avaliacoes), 25)]
            
            resultados_sentimento = []
            
            for lote in lotes:
                response = comprehend.batch_detect_sentiment(
                    TextList=lote,
                    LanguageCode='pt'  # Português
                )
                
                resultados_sentimento.extend(response['ResultList'])
            
            # Processar resultados
            sentimentos = {
                'POSITIVE': 0,
                'NEGATIVE': 0,
                'NEUTRAL': 0,
                'MIXED': 0
            }
            
            scores_positivos = []
            scores_negativos = []
            avaliacoes_negativas = []
            
            for i, resultado in enumerate(resultados_sentimento):
                sentimento = resultado['Sentiment']
                scores = resultado['SentimentScore']
                
                sentimentos[sentimento] += 1
                scores_positivos.append(scores['Positive'])
                scores_negativos.append(scores['Negative'])
                
                # Coletar avaliações negativas para análise
                if sentimento == 'NEGATIVE' and scores['Negative'] > 0.7:
                    avaliacoes_negativas.append({
                        'texto': textos_avaliacoes[i],
                        'score_negativo': scores['Negative']
                    })
            
            # Calcular métricas
            total_avaliacoes = len(textos_avaliacoes)
            satisfacao_geral = (sentimentos['POSITIVE'] / total_avaliacoes) * 100
            score_medio_positivo = np.mean(scores_positivos)
            
            # Identificar pontos de melhoria
            pontos_melhoria = self._identificar_pontos_melhoria(avaliacoes_negativas)
            
            analise = {
                'total_avaliacoes': total_avaliacoes,
                'distribuicao_sentimentos': sentimentos,
                'satisfacao_geral_pct': float(satisfacao_geral),
                'score_medio_positivo': float(score_medio_positivo),
                'avaliacoes_negativas_count': len(avaliacoes_negativas),
                'pontos_melhoria': pontos_melhoria,
                'recomendacao_acao': self._gerar_recomendacao_acao(satisfacao_geral)
            }
            
            return analise
            
        except Exception as e:
            logger.error(f"Erro na análise de sentimento: {str(e)}")
            return {}
    
    def _identificar_pontos_melhoria(self, avaliacoes_negativas: List[Dict]) -> List[str]:
        """Identifica pontos de melhoria baseados em avaliações negativas"""
        palavras_chave = {
            'limpeza': ['sujo', 'limpo', 'limpeza', 'higiene'],
            'atendimento': ['atendimento', 'staff', 'funcionário', 'serviço'],
            'instalações': ['quarto', 'banheiro', 'instalação', 'estrutura'],
            'wifi': ['wifi', 'internet', 'conexão'],
            'ruído': ['barulho', 'ruído', 'silêncio', 'som'],
            'localização': ['localização', 'local', 'acesso', 'transporte']
        }
        
        problemas_identificados = {}
        
        for avaliacao in avaliacoes_negativas:
            texto = avaliacao['texto'].lower()
            
            for categoria, palavras in palavras_chave.items():
                for palavra in palavras:
                    if palavra in texto:
                        problemas_identificados[categoria] = problemas_identificados.get(categoria, 0) + 1
        
        # Ordenar por frequência
        pontos_melhoria = sorted(problemas_identificados.items(), key=lambda x: x[1], reverse=True)
        
        return [ponto[0] for ponto in pontos_melhoria[:5]]  # Top 5
    
    def _gerar_recomendacao_acao(self, satisfacao_pct: float) -> str:
        """Gera recomendação de ação baseada na satisfação"""
        if satisfacao_pct >= 90:
            return "Excelente! Manter padrão de qualidade atual."
        elif satisfacao_pct >= 80:
            return "Bom nível. Focar em pequenos ajustes identificados."
        elif satisfacao_pct >= 70:
            return "Atenção necessária. Revisar pontos de melhoria urgentemente."
        else:
            return "Ação imediata necessária. Implementar plano de melhoria."


# ========== FUNÇÕES LAMBDA PARA STEP FUNCTIONS ==========

def lambda_validar_dados(event, context):
    """Lambda para validar dados de entrada do pipeline"""
    try:
        logger.info("Iniciando validação de dados")
        
        # Validar estrutura dos dados
        required_fields = ['start_date', 'end_date', 'data_source']
        
        for field in required_fields:
            if field not in event:
                raise ValueError(f"Campo obrigatório ausente: {field}")
        
        # Validar datas
        start_date = datetime.strptime(event['start_date'], '%Y-%m-%d')
        end_date = datetime.strptime(event['end_date'], '%Y-%m-%d')
        
        if start_date >= end_date:
            raise ValueError("Data de início deve ser anterior à data de fim")
        
        # Preparar dados para próximas etapas
        processed_event = {
            **event,
            'validation_timestamp': datetime.now().isoformat(),
            'data_key': f"processed_data/{event['data_source']}/{event['start_date']}_to_{event['end_date']}.json",
            'status': 'validated'
        }
        
        logger.info("Validação concluída com sucesso")
        return processed_event
        
    except Exception as e:
        logger.error(f"Erro na validação: {str(e)}")
        raise


def lambda_modelo_recomendacao(event, context):
    """Lambda para modelo de recomendação"""
    try:
        logger.info("Iniciando modelo de recomendação")
        
        analytics = HostalAnalytics()
        recomendacao = SistemaRecomendacao()
        
        # Extrair dados
        df_reservas = analytics.extrair_dados_reservas(
            event['start_date'], 
            event['end_date']
        )
        
        if df_reservas.empty:
            logger.warning("Nenhuma reserva encontrada para o período")
            return {'recomendacoes': []}
        
        # Gerar recomendações para clientes únicos
        clientes_unicos = df_reservas['cliente_email'].unique()
        recomendacoes_geradas = []
        
        for cliente in clientes_unicos[:50]:  # Limitar a 50 para performance
            recom_cliente = recomendacao.gerar_recomendacoes_cliente(cliente, df_reservas)
            recomendacoes_geradas.append({
                'cliente_email': cliente,
                'recomendacoes': recom_cliente
            })
        
        # Salvar resultados no S3
        resultado = {
            'timestamp': datetime.now().isoformat(),
            'total_clientes_processados': len(recomendacoes_geradas),
            'recomendacoes': recomendacoes_geradas
        }
        
        s3_key = f"ml_results/recomendacoes/{datetime.now().strftime('%Y-%m-%d')}.json"
        s3.put_object(
            Bucket=DATA_LAKE_BUCKET,
            Key=s3_key,
            Body=json.dumps(resultado, default=str)
        )
        
        logger.info(f"Modelo de recomendação concluído. Resultados salvos em {s3_key}")
        return resultado
        
    except Exception as e:
        logger.error(f"Erro no modelo de recomendação: {str(e)}")
        raise


def lambda_processar_sentimento(event, context):
    """Lambda para processar resultados de análise de sentimento"""
    try:
        logger.info("Processando análise de sentimento")
        
        sentiment_results = event['sentiment_results']
        original_reviews = event['original_reviews']
        
        analise_sentimento = AnalisesSentimento()
        
        # Processar resultados (simulação já que os dados viriam do Comprehend)
        textos_exemplo = [
            "Hostal incrível! Localização perfeita e staff muito atencioso.",
            "Quarto estava sujo e o wifi não funcionava bem.",
            "Experiência ok, nada excepcional mas atendeu as expectativas.",
            "Lugar mágico em Bacalar, recomendo muito!"
        ]
        
        resultado_analise = analise_sentimento.analisar_sentimento_avaliacoes(textos_exemplo)
        
        # Salvar no S3
        s3_key = f"ml_results/sentimento/{datetime.now().strftime('%Y-%m-%d')}.json"
        s3.put_object(
            Bucket=DATA_LAKE_BUCKET,
            Key=s3_key,
            Body=json.dumps(resultado_analise, default=str)
        )
        
        logger.info("Análise de sentimento processada com sucesso")
        return resultado_analise
        
    except Exception as e:
        logger.error(f"Erro ao processar sentimento: {str(e)}")
        raise


def lambda_gerar_relatorios(event, context):
    """Lambda para gerar relatórios consolidados"""
    try:
        logger.info("Gerando relatórios consolidados")
        
        analytics = HostalAnalytics()
        previsao = PrevisaoDemanda()
        
        # Calcular período (últimos 30 dias por padrão)
        end_date = datetime.now()
        start_date = end_date - timedelta(days=30)
        
        # Extrair e analisar dados
        df_reservas = analytics.extrair_dados_reservas(
            start_date.strftime('%Y-%m-%d'),
            end_date.strftime('%Y-%m-%d')
        )
        
        metricas_ocupacao = analytics.calcular_metricas_ocupacao(df_reservas)
        analise_clientes = analytics.analisar_clientes(df_reservas)
        
        # Gerar previsão
        dados_previsao = previsao.preparar_dados_previsao(df_reservas)
        previsao_demanda = previsao.gerar_previsao_demanda(dados_previsao)
        
        # Consolidar relatório
        relatorio_consolidado = {
            'periodo_analise': {
                'inicio': start_date.strftime('%Y-%m-%d'),
                'fim': end_date.strftime('%Y-%m-%d')
            },
            'metricas_ocupacao': metricas_ocupacao,
            'analise_clientes': analise_clientes,
            'previsao_demanda': previsao_demanda,
            'insights_principais': gerar_insights_principais(metricas_ocupacao, analise_clientes),
            'alertas': gerar_alertas_gestao(metricas_ocupacao),
            'timestamp': datetime.now().isoformat()
        }
        
        # Salvar relatório no S3
        s3_key = f"reports/relatorio_consolidado_{datetime.now().strftime('%Y-%m-%d')}.json"
        s3.put_object(
            Bucket=DATA_LAKE_BUCKET,
            Key=s3_key,
            Body=json.dumps(relatorio_consolidado, default=str, indent=2)
        )
        
        logger.info(f"Relatório consolidado gerado: {s3_key}")
        return relatorio_consolidado
        
    except Exception as e:
        logger.error(f"Erro ao gerar relatórios: {str(e)}")
        raise


def lambda_atualizar_quicksight(event, context):
    """Lambda para atualizar dashboards do QuickSight"""
    try:
        logger.info("Atualizando dashboards QuickSight")
        
        dashboard_ids = event['dashboard_ids']
        account_id = context.invoked_function_arn.split(':')[4]
        
        resultados_refresh = []
        
        for dashboard_id in dashboard_ids:
            try:
                # Atualizar dataset (exemplo)
                response = quicksight.create_refresh_schedule(
                    DataSetId=f'hostal-magic-dataset-{ENVIRONMENT}',
                    AwsAccountId=account_id,
                    ScheduleId=f'refresh-{datetime.now().strftime("%Y%m%d%H%M%S")}',
                    Schedule={
                        'ScheduleFrequency': 'DAILY',
                        'RefreshType': 'FULL_REFRESH'
                    }
                )
                
                resultados_refresh.append({
                    'dashboard_id': dashboard_id,
                    'status': 'success',
                    'refresh_id': response.get('ScheduleId')
                })
                
            except Exception as dashboard_error:
                logger.error(f"Erro ao atualizar dashboard {dashboard_id}: {str(dashboard_error)}")
                resultados_refresh.append({
                    'dashboard_id': dashboard_id,
                    'status': 'error',
                    'error': str(dashboard_error)
                })
        
        logger.info("Atualização do QuickSight concluída")
        return {
            'refresh_results': resultados_refresh,
            'timestamp': datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Erro ao atualizar QuickSight: {str(e)}")
        raise


def lambda_notificar_gestores(event, context):
    """Lambda para notificar gestores com insights e alertas"""
    try:
        logger.info("Enviando notificações para gestores")
        
        insights = event.get('insights', [])
        alertas = event.get('alertas', [])
        metricas = event.get('metricas', {})
        
        # Preparar email
        html_body = gerar_email_relatorio(insights, alertas, metricas)
        
        # Enviar email
        response = ses.send_email(
            Source=os.environ.get('FROM_EMAIL'),
            Destination={
                'ToAddresses': [
                    'gestor@hostalmagic.com',  # Substituir por email real
                    'analytics@hostalmagic.com'
                ]
            },
            Message={
                'Subject': {
                    'Data': f'Relatório Diário - Hostal MAGIC - {datetime.now().strftime("%d/%m/%Y")}'
                },
                'Body': {
                    'Html': {'Data': html_body}
                }
            }
        )
        
        logger.info("Notificações enviadas com sucesso")
        return {
            'email_sent': True,
            'message_id': response['MessageId'],
            'timestamp': datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Erro ao enviar notificações: {str(e)}")
        raise


def lambda_tratar_erro(event, context):
    """Lambda para tratar erros do pipeline"""
    try:
        logger.error("Tratando erro do pipeline")
        
        error_info = event.get('error', {})
        input_data = event.get('input', {})
        
        # Log detalhado do erro
        logger.error(f"Erro no pipeline: {error_info}")
        logger.error(f"Dados de entrada: {input_data}")
        
        # Notificar equipe técnica
        ses.send_email(
            Source=os.environ.get('FROM_EMAIL'),
            Destination={
                'ToAddresses': ['tech@hostalmagic.com']  # Substituir por email real
            },
            Message={
                'Subject': {'Data': 'ERRO - Pipeline ML/BI Hostal MAGIC'},
                'Body': {
                    'Text': {
                        'Data': f"""
                        Erro detectado no pipeline de ML/BI:
                        
                        Timestamp: {datetime.now().isoformat()}
                        Erro: {error_info}
                        Dados de entrada: {input_data}
                        
                        Verifique os logs do CloudWatch para mais detalhes.
                        """
                    }
                }
            }
        )
        
        return {
            'error_handled': True,
            'timestamp': datetime.now().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Erro ao tratar erro do pipeline: {str(e)}")
        raise


# ========== FUNÇÕES AUXILIARES ==========

def gerar_insights_principais(metricas_ocupacao: Dict, analise_clientes: Dict) -> List[str]:
    """Gera insights principais baseados nas métricas"""
    insights = []
    
    try:
        if metricas_ocupacao.get('receita_total', 0) > 0:
            receita_total = metricas_ocupacao['receita_total']
            total_reservas = metricas_ocupacao['total_reservas']
            
            insights.append(f"Receita total do período: ${receita_total:.2f} com {total_reservas} reservas")
            
            if metricas_ocupacao.get('receita_media_reserva'):
                media = metricas_ocupacao['receita_media_reserva']
                insights.append(f"Ticket médio por reserva: ${media:.2f}")
            
            if metricas_ocupacao.get('antecedencia_media_dias'):
                antecedencia = metricas_ocupacao['antecedencia_media_dias']
                insights.append(f"Antecedência média de reserva: {antecedencia:.1f} dias")
        
        if analise_clientes.get('taxa_recorrencia_pct'):
            taxa = analise_clientes['taxa_recorrencia_pct']
            insights.append(f"Taxa de clientes recorrentes: {taxa:.1f}%")
        
        # Insights sobre tipos de quarto mais populares
        ocupacao_por_tipo = metricas_ocupacao.get('ocupacao_por_tipo', {})
        if ocupacao_por_tipo:
            tipo_mais_popular = max(ocupacao_por_tipo.get('reserva_id', {}), key=ocupacao_por_tipo.get('reserva_id', {}).get)
            insights.append(f"Tipo de quarto mais popular: {tipo_mais_popular}")
    
    except Exception as e:
        logger.error(f"Erro ao gerar insights: {str(e)}")
        insights.append("Erro ao calcular insights principais")
    
    return insights


def gerar_alertas_gestao(metricas_ocupacao: Dict) -> List[Dict]:
    """Gera alertas para a gestão"""
    alertas = []
    
    try:
        receita_total = metricas_ocupacao.get('receita_total', 0)
        total_reservas = metricas_ocupacao.get('total_reservas', 0)
        
        # Alerta de baixa receita
        if receita_total < 1000:  # Threshold configurável
            alertas.append({
                'tipo': 'receita_baixa',
                'prioridade': 'alta',
                'mensagem': f'Receita abaixo do esperado: ${receita_total:.2f}',
                'acao_sugerida': 'Revisar estratégia de preços e promoções'
            })
        
        # Alerta de poucas reservas
        if total_reservas < 10:  # Threshold configurável
            alertas.append({
                'tipo': 'baixa_ocupacao',
                'prioridade': 'media',
                'mensagem': f'Apenas {total_reservas} reservas no período',
                'acao_sugerida': 'Intensificar marketing digital e promoções'
            })
        
        # Alerta de antecedência de reserva
        antecedencia = metricas_ocupacao.get('antecedencia_media_dias', 0)
        if antecedencia < 3:
            alertas.append({
                'tipo': 'reservas_ultima_hora',
                'prioridade': 'baixa',
                'mensagem': f'Muitas reservas de última hora (média: {antecedencia:.1f} dias)',
                'acao_sugerida': 'Incentivar reservas antecipadas com desconto'
            })
    
    except Exception as e:
        logger.error(f"Erro ao gerar alertas: {str(e)}")
    
    return alertas


def gerar_email_relatorio(insights: List[str], alertas: List[Dict], metricas: Dict) -> str:
    """Gera HTML do email com relatório"""
    
    html = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{ font-family: Arial, sans-serif; margin: 20px; }}
            .header {{ background-color: #2E86AB; color: white; padding: 20px; text-align: center; }}
            .section {{ margin: 20px 0; padding: 15px; border-left: 4px solid #2E86AB; }}
            .alert-alta {{ background-color: #ffebee; border-left-color: #f44336; }}
            .alert-media {{ background-color: #fff3e0; border-left-color: #ff9800; }}
            .alert-baixa {{ background-color: #e8f5e9; border-left-color: #4caf50; }}
            .metric {{ background-color: #f5f5f5; padding: 10px; margin: 5px 0; border-radius: 5px; }}
            ul {{ padding-left: 20px; }}
            li {{ margin: 8px 0; }}
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🏖️ Hostal MAGIC - Relatório Diário</h1>
            <p>{datetime.now().strftime('%d de %B de %Y')}</p>
        </div>
        
        <div class="section">
            <h2>📊 Insights Principais</h2>
            <ul>
    """
    
    for insight in insights:
        html += f"<li>{insight}</li>"
    
    html += """
            </ul>
        </div>
    """
    
    if alertas:
        html += """
        <div class="section">
            <h2>⚠️ Alertas</h2>
        """
        
        for alerta in alertas:
            prioridade_class = f"alert-{alerta.get('prioridade', 'baixa')}"
            html += f"""
            <div class="metric {prioridade_class}">
                <strong>{alerta.get('tipo', '').upper()}</strong><br>
                {alerta.get('mensagem', '')}<br>
                <em>Ação sugerida: {alerta.get('acao_sugerida', '')}</em>
            </div>
            """
        
        html += "</div>"
    
    # Adicionar métricas se disponíveis
    if metricas:
        html += """
        <div class="section">
            <h2>📈 Métricas Resumidas</h2>
        """
        
        for chave, valor in metricas.items():
            if isinstance(valor, (int, float)):
                html += f'<div class="metric"><strong>{chave.replace("_", " ").title()}:</strong> {valor}</div>'
        
        html += "</div>"
    
    html += """
        <div class="section">
            <p><em>Este relatório foi gerado automaticamente pelo sistema de BI do Hostal MAGIC.</em></p>
            <p>Para mais detalhes, acesse o dashboard no QuickSight.</p>
        </div>
    </body>
    </html>
    """
    
    return html


# Função principal para testes locais
if __name__ == "__main__":
    # Teste das classes principais
    analytics = HostalAnalytics()
    
    # Simular dados para teste
    dados_teste = pd.DataFrame({
        'reserva_id': ['res_001', 'res_002', 'res_003'],
        'cliente_email': ['teste1@email.com', 'teste2@email.com', 'teste1@email.com'],
        'checkin': ['2024-01-15', '2024-01-20', '2024-02-10'],
        'checkout': ['2024-01-18', '2024-01-23', '2024-02-13'],
        'tipo_quarto': ['dormitorio', 'privado_duplo', 'dormitorio'],
        'num_hospedes': [2, 2, 1],
        'valor_total': [75, 180, 75],
        'status': ['confirmada', 'confirmada', 'confirmada'],
        'data_criacao': ['2024-01-10', '2024-01-15', '2024-02-05'],
        'servicos_extras': [['cafe_manha'], ['kayak', 'cafe_manha'], ['cafe_manha']]
    })
    
    print("Testando análises...")
    metricas = analytics.calcular_metricas_ocupacao(dados_teste)
    print("Métricas de ocupação:", json.dumps(metricas, indent=2, default=str))
    
    analise_clientes = analytics.analisar_clientes(dados_teste)
    print("Análise de clientes:", json.dumps(analise_clientes, indent=2, default=str))