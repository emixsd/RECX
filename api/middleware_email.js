const axios = require('axios');

const INDECX_COMPANY_KEY = process.env.INDECX_COMPANY_KEY;
const ZENDESK_SUBDOMAIN  = process.env.ZENDESK_SUBDOMAIN;
const ZENDESK_EMAIL      = process.env.ZENDESK_EMAIL;
const ZENDESK_API_TOKEN  = process.env.ZENDESK_API_TOKEN;

const INDECX_BASE_URL = 'https://indecx.com/v3/integrations';

// TODO: substituir pelos valores reais quando tiver
const TAG_TO_ACTION = {
  'pesquisa-reembolso': 'ACTION_ID_AQUI',
};

const CORPOS_EMAIL = {
  'p-reem-ap': (nome, link) =>
    `Olá, ${nome}!\n\n` +
    `Sua solicitação de reembolso foi concluída.\n` +
    `Queremos muito saber como foi sua experiência com o nosso atendimento.\n\n` +
    `Sua opinião é essencial para melhorarmos cada vez mais!\n\n` +
    `👉 Avaliar experiência: ${link}`,

  'p-reem-neg': (nome, link) =>
    `Olá, ${nome}!\n\n` +
    `Sua solicitação de reembolso foi finalizada.\n` +
    `Sabemos que esse pode não ter sido o resultado esperado, e por isso sua opinião é muito importante para nós. ` +
    `Conte como foi sua experiência com o nosso atendimento.\n\n` +
    `👉 Avaliar experiência: ${link}`,
};

let indecxToken = null;
let tokenExpiry = null;

async function getIndecxToken() {
  if (indecxToken && tokenExpiry && Date.now() < tokenExpiry) {
    return indecxToken;
  }

  const response = await axios.get(INDECX_BASE_URL + '/authorization/token', {
    headers: { 'Company-Key': INDECX_COMPANY_KEY }
  });

  indecxToken = response.data.authToken;
  tokenExpiry = Date.now() + 25 * 60 * 1000;
  return indecxToken;
}

async function gerarLinkPesquisa(actionId, dados) {
  const token = await getIndecxToken();

  const response = await axios.post(
    INDECX_BASE_URL + '/actions/' + actionId + '/invites',
    { customers: [dados] },
    {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data.customers[0].shortUrl;
}

async function enviarEmailZendesk(ticketId, nomeCliente, linkPesquisa, tipoMensagem) {
  const auth = Buffer.from(ZENDESK_EMAIL + '/token:' + ZENDESK_API_TOKEN).toString('base64');

  const templateFn = CORPOS_EMAIL[tipoMensagem] || CORPOS_EMAIL['p-reem-ap'];
  const corpo = templateFn(nomeCliente, linkPesquisa);

  const url = `https://${ZENDESK_SUBDOMAIN}.zendesk.com/api/v2/tickets/${ticketId}.json`;

  try {
    const response = await axios.put(
      url,
      {
        ticket: {
          comment: {
            body: corpo,
            public: true
          }
        }
      },
      {
        headers: {
          Authorization: 'Basic ' + auth,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('ZENDESK OK status:', response.status);
    return response.data;
  } catch (err) {
    console.error('ZENDESK ERRO status:', err.response?.status);
    console.error('ZENDESK ERRO body:', JSON.stringify(err.response?.data || err.message, null, 2));
    throw err;
  }
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({ status: 'ok', message: 'Middleware Zendesk-IndeCX (email) funcionando!' });
  }

  if (req.method === 'POST') {
    try {
      console.log('DADOS RECEBIDOS:', JSON.stringify(req.body));

      const {
        ticket_id,
        cliente_nome,
        cliente_email,
        cliente_telefone,
        tag_pesquisa,
        tipo_mensagem,
        brand,
        codigo_notro,
        destino_viagem,
        analista
      } = req.body;

      const actionId = TAG_TO_ACTION[tag_pesquisa];

      if (!actionId) {
        return res.status(200).json({ success: false, error: 'Tag não mapeada' });
      }

      if (!ticket_id) {
        return res.status(200).json({ success: false, error: 'Ticket ID não informado' });
      }

      const dadosIndecx = {
        nome:           cliente_nome || 'Cliente',
        TicketID:       ticket_id,
        brand:          brand || '',
        codigo_notro:   codigo_notro || '',
        destino_viagem: destino_viagem || '',
        analista:       analista || ''
      };

      if ((cliente_email || '').trim()) {
        dadosIndecx.email = cliente_email.trim();
      }

      if (cliente_telefone) {
        dadosIndecx.telefone = String(cliente_telefone).replace(/\D/g, '');
      }

      const linkPesquisa = await gerarLinkPesquisa(actionId, dadosIndecx);

      await enviarEmailZendesk(ticket_id, cliente_nome || 'Cliente', linkPesquisa, tipo_mensagem);

      return res.status(200).json({
        success: true,
        actionId,
        link: linkPesquisa,
        message: 'Comentário adicionado no ticket — email enviado pelo Zendesk!'
      });

    } catch (error) {
      console.error('ERRO GERAL:', error.response?.data || error.message);
      return res.status(500).json({ success: false, error: error.response?.data || error.message });
    }
  }

  return res.status(405).json({ error: 'Método não permitido' });
};
