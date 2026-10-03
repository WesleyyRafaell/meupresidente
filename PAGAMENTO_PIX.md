# Ativar o Pix do site

O GitHub Pages continua publicando a página. O backend Pix roda em um Cloudflare Worker separado, que cria e confirma cobranças no Mercado Pago. O Access Token privado fica somente como segredo do Worker.

## Configuração do Mercado Pago

1. Use uma conta de vendedor com uma chave Pix ativa e crie uma aplicação no painel de integrações do Mercado Pago.
2. Copie o Access Token de produção da aplicação. Não o coloque em app.js, payment-config.js, GitHub ou em uma mensagem.
3. Para testar, use primeiro as credenciais de teste e uma conta compradora de teste do Mercado Pago.

O formulário pede e-mail e CPF. A montagem continua no navegador enquanto aguarda o pagamento. Depois da aprovação, o arquivo é enviado ao Worker para conferência e devolvido sem ser gravado.

Referências oficiais: [Integração Pix do Mercado Pago](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix?scope=prod) e [segredos do Cloudflare Workers](https://developers.cloudflare.com/workers/configuration/secrets/).

## Publicar o backend

Com o Wrangler instalado e autenticado na conta Cloudflare, execute na pasta do projeto:

    npx wrangler secret put MP_ACCESS_TOKEN --config worker/wrangler.jsonc
    npx wrangler deploy --config worker/wrangler.jsonc

O comando de publicação informará um endereço workers.dev. Revise ALLOWED_ORIGINS em worker/wrangler.jsonc para incluir exatamente o domínio publicado do site.

## Ligar o site ao Worker

Copie o endereço workers.dev para payment-config.js:

    window.MEU_PRESIDENTE_PIX_API_URL = "https://meu-presidente-pix.SEU-SUBDOMINIO.workers.dev";

Publique index.html, app.js, styles.css, payment-config.js e o Worker. Os botões de download e compartilhamento só liberam o arquivo quando o Worker confirma no Mercado Pago um Pix aprovado de R$ 2 associado ao hash exato da montagem.

## Rotas do Worker

- POST /api/pix/create: cria um Pix de R$ 2 e devolve QR Code e código copia e cola.
- GET /api/pix/status?paymentId=...&artworkHash=...: confirma o status, o valor e a associação com a montagem.
- POST /api/pix/export: recebe a imagem somente depois da aprovação, confere hash e pagamento e devolve o PNG sem armazená-lo.
- GET /health: verifica se o Worker está ativo.
