# Ativa.ai · Radar Tech

Painel interno para TV com notícias de tecnologia e IA do The Guardian. O servidor busca as matérias de um dia fechado, salva a edição localmente e a exibe em rotação automática. A mesma edição alimenta a pauta da newsletter interna.

## Rodar no notebook conectado à TV

Requer Node.js 20 ou superior. Não há dependências para instalar.

1. Copie `.env.example` para `.env`.
2. Coloque as chaves em `GUARDIAN_API_KEY` e `OPENAI_API_KEY`.
3. Execute `npm start` nesta pasta.
4. Abra `http://127.0.0.1:3000` no navegador e pressione **F** para tela cheia.

Deixe o servidor rodando. Para iniciar automaticamente após reiniciar o notebook, configure o gerenciador de inicialização do sistema para executar `npm start` nesta pasta. O painel funciona com a última edição salva quando estiver sem internet.

## Coleta e newsletter

- Na primeira execução, busca **ontem**, que é o último dia completo. Depois verifica diariamente se existe uma nova edição. Se o notebook ficar desligado, recupera em ordem os dias faltantes quando voltar. Falhas são tentadas novamente após 30 minutos.
- O GPT traduz títulos e resumos para português brasileiro em lotes de até 10 notícias. O resultado é salvo junto com o original; a TV só exibe a edição depois que a tradução estiver completa. Edições antigas em inglês são traduzidas ao iniciar o servidor com a chave configurada, sem consultar novamente o Guardian.
- A coleta faz duas buscas diárias no endpoint `https://content.guardianapis.com/search`: todos os resultados da seção `technology` e uma busca ampliada por termos de IA em outras seções. A API suporta operadores `OR`; as matérias da busca ampliada são mantidas somente quando título ou resumo confirmam relação com IA. Os resultados são deduplicados. As buscas usam `from-date`, `to-date`, `use-date=published`, `page-size=100`, `order-by=newest`, `show-fields=headline,trailText,thumbnail,byline` e `show-elements=image`. A data segue o calendário de publicação da API; a virada da coleta usa o fuso de São Paulo.
- O painel usa `thumbnail` e, quando disponível, procura uma imagem nos elementos de mídia retornados pela API. A disponibilidade de mídia depende dos dados do artigo e do nível da chave do Guardian.
- As edições completas ficam em `data/AAAA-MM-DD.json` e não entram no Git.
- A pauta da edição atual está em [`/api/newsletter.md`](http://127.0.0.1:3000/api/newsletter.md), pronta para copiar/editar. Os dados estruturados estão em [`/api/newsletter.json`](http://127.0.0.1:3000/api/newsletter.json). Uma edição específica pode ser acessada em `/api/archive/AAAA-MM-DD`.
- A exportação da pauta responde `503` até que todas as fontes com chave configurada tenham sido coletadas e todas as matérias estejam traduzidas. Consulte `/api/news` para ver `newsletterReady`, estado da coleta e eventuais erros.
- A newsletter separa **IA em foco** e **outras notícias de tecnologia**, identifica o Guardian como fonte e usa título, resumo traduzido e link original. A seleção e a redação final devem passar por revisão editorial; o painel não envia e-mails.

O modelo padrão é `gpt-4o-mini`. Defina `OPENAI_MODEL` no `.env` se sua chave tiver acesso a outro modelo. A tradução consome a cota da API da OpenAI. O texto das manchetes e resumos é enviado à OpenAI para tradução; a chave permanece no servidor e não aparece no navegador.

Controles: **←/→** mudam a notícia, **espaço** pausa, **F** alterna tela cheia. Os botões aparecem ao passar o mouse no canto inferior direito.

## Observação sobre licença

O Guardian informa que a chave **Developer** é para uso não comercial, enquanto usos por empresas se enquadram no acesso **Commercial**. Confirme que a chave do Guardian cobre exibição interna e newsletter antes de usar conteúdo em produção. O painel mantém atribuição e links para as matérias originais.

## Verificação

Execute `npm test` para testar paginação, filtros e tratamento de erro.
